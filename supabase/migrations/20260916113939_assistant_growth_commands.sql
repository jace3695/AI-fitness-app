-- Additive command ledger. Installing this migration never rewrites existing sessions.
create table public.assistant_growth_command_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  record_date date not null,
  payload_hash text not null,
  routine_snapshot jsonb not null check (jsonb_typeof(routine_snapshot)='object'),
  session_snapshot jsonb not null check (jsonb_typeof(session_snapshot)='object'),
  created_at timestamptz not null default clock_timestamp(),
  undone_at timestamptz,
  primary key (user_id,id)
);
create index assistant_growth_history_owner_created_idx on public.assistant_growth_command_history(user_id,created_at desc,id);
alter table public.assistant_growth_command_history enable row level security;
create policy growth_command_owner on public.assistant_growth_command_history to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.assistant_growth_command_history from anon,authenticated;
grant select,insert,delete on public.assistant_growth_command_history to authenticated;
grant update(undone_at) on public.assistant_growth_command_history to authenticated;
grant all on public.assistant_growth_command_history to service_role;

create function public.apply_assistant_growth_command(
  p_request_id uuid, p_day date, p_expected jsonb, p_actual_minutes integer, p_reset_markers jsonb, p_expires_at timestamptz
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_growth_command_history;
  current_state jsonb; routine public.growth_routines; session public.growth_sessions;
  snapshot jsonb; request_hash text;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_request_id is null or p_day is null or p_expires_at is null
    or jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_expected::text)>8000
    or jsonb_typeof(p_reset_markers) is distinct from 'object' or octet_length(p_reset_markers::text)>500
    or (select array_agg(key order by key) from jsonb_object_keys(p_reset_markers) key) is distinct from array['assistant','growth']
    or exists(select 1 from jsonb_each(p_reset_markers) where jsonb_typeof(value) not in ('null','string'))
    or (p_actual_minutes is not null and p_actual_minutes not between 1 and 1440)
    then raise exception '자기계발 확인 내용을 다시 확인해 주세요.'; end if;
  request_hash := md5(jsonb_build_object('day',p_day,'expected',p_expected,'minutes',p_actual_minutes,'resets',p_reset_markers,'expires',p_expires_at)::text);
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  -- Same order as reset: state, then dependent records. No state row is created by this command.
  select state into current_state from public.user_app_state where user_id=owner_id for update;
  current_state := coalesce(current_state,'{}'::jsonb);
  select * into receipt from public.assistant_growth_command_history where user_id=owner_id and id=p_request_id for update;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 요청 번호입니다. 실행 이력을 확인해 주세요.'; end if;
    return to_jsonb(receipt);
  end if;
  if p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '15 minutes 5 seconds'
    then raise exception '확인 시간이 지났습니다. 명령을 다시 입력해 주세요.'; end if;
  if p_day<>(clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception '날짜가 바뀌었습니다. 오늘 명령을 다시 입력해 주세요.'; end if;
  if jsonb_typeof(current_state) is distinct from 'object' then raise exception '기록 상태를 확인하지 못했습니다.'; end if;
  if p_reset_markers is distinct from jsonb_build_object('growth',current_state->'ai-fitness-record-reset-growth','assistant',current_state->'ai-fitness-record-reset-assistant')
    then raise exception '기록이 초기화되었습니다. 명령을 다시 입력해 주세요.'; end if;
  select * into routine from public.growth_routines where id=(p_expected->>'id')::uuid and user_id=owner_id for update;
  if not found or not routine.enabled or btrim(routine.title)='28회 그림 기초 연습' then raise exception '사용할 수 없는 루틴입니다. 자기계발 화면에서 확인해 주세요.'; end if;
  snapshot := jsonb_build_object('id',routine.id,'title',routine.title,'category',routine.category,'target_minutes',routine.target_minutes,
    'preferred_days',routine.preferred_days,'target_sessions_per_week',routine.target_sessions_per_week,'enabled',routine.enabled,'updated_at',routine.updated_at);
  -- Compare timestamps as timestamps: PostgREST and jsonb emit equivalent offsets differently.
  if (snapshot-'updated_at') is distinct from (p_expected-'updated_at')
    or routine.updated_at is distinct from (p_expected->>'updated_at')::timestamptz
    then raise exception '다른 곳에서 루틴이 변경되었습니다. 최신 내용을 다시 확인해 주세요.'; end if;
  if exists(select 1 from public.growth_sessions where user_id=owner_id and routine_id=routine.id and session_date=p_day)
    then raise exception '오늘 이 루틴의 기록이 이미 있습니다. 기존 기록을 보호하기 위해 저장하지 않았습니다.'; end if;
  insert into public.growth_sessions(user_id,routine_id,session_date,status,planned_minutes,actual_minutes,memo,source,metrics)
    values(owner_id,routine.id,p_day,'completed',routine.target_minutes,coalesce(p_actual_minutes,0),'','assistant',
      jsonb_build_object('actualMinutesRecorded',p_actual_minutes is not null)) returning * into session;
  insert into public.assistant_growth_command_history(user_id,id,record_date,payload_hash,routine_snapshot,session_snapshot)
    values(owner_id,p_request_id,p_day,request_hash,snapshot,to_jsonb(session)) returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.apply_assistant_growth_command(uuid,date,jsonb,integer,jsonb,timestamptz) from public,anon;
grant execute on function public.apply_assistant_growth_command(uuid,date,jsonb,integer,jsonb,timestamptz) to authenticated;

create function public.undo_assistant_growth_command(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_growth_command_history;
  session public.growth_sessions;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  perform 1 from public.user_app_state where user_id=owner_id for update;
  select * into receipt from public.assistant_growth_command_history where user_id=owner_id and id=p_request_id for update;
  if not found then raise exception '실행 이력을 찾을 수 없습니다.'; end if;
  if receipt.undone_at is not null then return to_jsonb(receipt); end if;
  perform 1 from public.growth_routines where user_id=owner_id and id=(receipt.routine_snapshot->>'id')::uuid for update;
  select * into session from public.growth_sessions where user_id=owner_id and id=(receipt.session_snapshot->>'id')::uuid for update;
  if not found or to_jsonb(session) is distinct from receipt.session_snapshot
    or exists(select 1 from public.growth_sessions where user_id=owner_id and routine_id=(receipt.routine_snapshot->>'id')::uuid
      and session_date=receipt.record_date and id<>session.id)
    then raise exception '이후에 자기계발 기록이 변경되었습니다. 새 기록을 보호하기 위해 되돌리지 않았습니다.'; end if;
  delete from public.growth_sessions where user_id=owner_id and id=session.id;
  if not found then raise exception '자기계발 기록을 되돌리지 못했습니다.'; end if;
  update public.assistant_growth_command_history set undone_at=clock_timestamp() where user_id=owner_id and id=p_request_id returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.undo_assistant_growth_command(uuid) from public,anon;
grant execute on function public.undo_assistant_growth_command(uuid) to authenticated;

-- Auth user deletion is handled by FK cascade, without application grants for Auth internals.
create function public.clear_assistant_growth_command_history()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.state->>'ai-fitness-record-reset-growth' is distinct from new.state->>'ai-fitness-record-reset-growth'
    or old.state->>'ai-fitness-record-reset-assistant' is distinct from new.state->>'ai-fitness-record-reset-assistant' then
    delete from public.assistant_growth_command_history where user_id=new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_assistant_growth_command_history() from public,anon;
grant execute on function public.clear_assistant_growth_command_history() to authenticated,service_role;
create trigger assistant_growth_history_reset after update of state on public.user_app_state
  for each row execute function public.clear_assistant_growth_command_history();
