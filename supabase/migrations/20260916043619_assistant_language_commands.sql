-- Installation only adds the owner-scoped command ledger and invoker functions.
-- Each confirmed completion and its receipt commit atomically. Only the two
-- learning record keys are compared/replaced; other settings remain untouched.
create table public.assistant_language_command_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null, routine_id text not null check(routine_id in ('kana','words','sentences','grammar','review')),
  record_date date not null, payload_hash text not null,
  before_values jsonb not null, after_values jsonb not null,
  created_at timestamptz not null default clock_timestamp(), undone_at timestamptz,
  primary key(user_id,id)
);
create index assistant_language_command_history_created_idx on public.assistant_language_command_history(user_id,created_at desc,id);
alter table public.assistant_language_command_history enable row level security;
create policy assistant_language_command_history_owner on public.assistant_language_command_history for all to authenticated
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.assistant_language_command_history from public,anon,authenticated;
grant select,insert,update,delete on public.assistant_language_command_history to authenticated;
grant all on public.assistant_language_command_history to service_role;

create function public.assistant_language_completed_ids(p_records jsonb,p_day date)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  progress jsonb := p_records->'dailyRoutineProgress';
  history jsonb := p_records->'dailyLearningHistory';
  ids jsonb := '[]'; entry jsonb;
begin
  if jsonb_typeof(progress)='string' then progress := (progress#>>'{}')::jsonb; end if;
  if jsonb_typeof(history)='string' then history := (history#>>'{}')::jsonb; end if;
  if progress is not null then
    if jsonb_typeof(progress)<>'object' or coalesce(jsonb_typeof(progress->'date'),'')<>'string'
      or coalesce(jsonb_typeof(progress->'completedIds'),'')<>'array' then raise exception '학습 완료 목록을 확인하지 못했습니다.'; end if;
    if exists(select 1 from jsonb_array_elements(progress->'completedIds') v where v not in ('"kana"','"words"','"sentences"','"grammar"','"review"')) then raise exception '학습 완료 목록을 확인하지 못했습니다.'; end if;
    if progress->>'date'=p_day::text then ids := progress->'completedIds'; end if;
  end if;
  if history is not null and jsonb_typeof(history)<>'object' then raise exception '학습 이력을 확인하지 못했습니다.'; end if;
  entry := history->p_day::text;
  if entry is not null then
    if jsonb_typeof(entry)<>'object' or coalesce(jsonb_typeof(entry->'completedIds'),'')<>'array' then raise exception '오늘 학습 이력을 확인하지 못했습니다.'; end if;
    ids := ids || (entry->'completedIds');
  end if;
  if exists(select 1 from jsonb_array_elements(ids) v where v not in ('"kana"','"words"','"sentences"','"grammar"','"review"')) then raise exception '학습 완료 목록을 확인하지 못했습니다.'; end if;
  return (select coalesce(jsonb_agg(v order by first_seen),'[]') from (select v,min(n) first_seen from jsonb_array_elements(ids) with ordinality a(v,n) group by v) distinct_ids);
end;
$$;
revoke all on function public.assistant_language_completed_ids(jsonb,date) from public,anon;
grant execute on function public.assistant_language_completed_ids(jsonb,date) to authenticated;

create function public.apply_assistant_language_command(
  p_request_id uuid,p_routine_id text,p_day date,p_expected jsonb,p_reset_markers jsonb,p_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_language_command_history;
  current_state jsonb; current_values jsonb; next_values jsonb; history jsonb;
  ids jsonb; request_hash text; assistant_marker text;
  record_keys text[] := array['dailyRoutineProgress','dailyLearningHistory'];
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_request_id is null or p_routine_id is null or p_routine_id not in ('kana','words','sentences','grammar','review')
    or p_day is null or p_expected is null or jsonb_typeof(p_expected)<>'object'
    or (p_expected-record_keys)<>'{}' or octet_length(p_expected::text)>500000
    or p_reset_markers is null or jsonb_typeof(p_reset_markers)<>'object' then raise exception '확인할 학습 내용을 다시 불러와 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  request_hash := md5(jsonb_build_array(p_routine_id,p_day,p_expected,p_reset_markers,p_expires_at)::text);
  select * into receipt from public.assistant_language_command_history where user_id=owner_id and id=p_request_id;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 요청입니다. 실행 이력을 확인해 주세요.'; end if;
    return to_jsonb(receipt);
  end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '20 minutes' then raise exception '확인 시간이 지났습니다. 명령을 다시 입력해 주세요.'; end if;
  if p_day<>(clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception '학습 날짜가 바뀌었습니다. 오늘 학습 명령을 다시 입력해 주세요.'; end if;
  select state->>'ai-fitness-record-reset-assistant' into assistant_marker from public.user_app_state where user_id=owner_id;
  insert into public.language_user_state(user_id,state) values(owner_id,'{}') on conflict(user_id) do nothing;
  select state into current_state from public.language_user_state where user_id=owner_id for update;
  if current_state is null or jsonb_typeof(current_state)<>'object' then raise exception '학습 기록을 확인하지 못했습니다.'; end if;
  if p_reset_markers is distinct from jsonb_build_object('language',current_state->>'languageRecordResetV1','assistant',assistant_marker) then raise exception '기록이 초기화되었습니다. 명령을 다시 입력해 주세요.'; end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into current_values from jsonb_each(current_state) where key=any(record_keys);
  if current_values is distinct from p_expected then raise exception '다른 곳에서 학습 기록이 변경되었습니다. 명령을 다시 입력해 주세요.'; end if;
  ids := public.assistant_language_completed_ids(current_values,p_day);
  if ids ? p_routine_id then raise exception '이미 완료한 학습입니다. 오늘 학습 현황을 확인해 주세요.'; end if;
  ids := ids || to_jsonb(p_routine_id);
  history := current_state->'dailyLearningHistory';
  if jsonb_typeof(history)='string' then history := (history#>>'{}')::jsonb; end if;
  history := coalesce(history,'{}') || jsonb_build_object(p_day::text,
    coalesce(history->p_day::text,'{}') || jsonb_build_object('completedIds',ids,'completedCount',jsonb_array_length(ids),'totalCount',5,'updatedAt',clock_timestamp()));
  next_values := jsonb_build_object('dailyRoutineProgress',jsonb_build_object('date',p_day::text,'completedIds',ids)::text,'dailyLearningHistory',history::text);
  update public.language_user_state set state=(current_state-record_keys)||next_values,updated_at=clock_timestamp() where user_id=owner_id;
  if not found then raise exception '학습 기록을 저장하지 못했습니다.'; end if;
  insert into public.assistant_language_command_history(user_id,id,routine_id,record_date,payload_hash,before_values,after_values)
    values(owner_id,p_request_id,p_routine_id,p_day,request_hash,current_values,next_values) returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.apply_assistant_language_command(uuid,text,date,jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.apply_assistant_language_command(uuid,text,date,jsonb,jsonb,timestamptz) to authenticated;

create function public.undo_assistant_language_command(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_language_command_history;
  current_state jsonb; current_values jsonb;
  record_keys text[] := array['dailyRoutineProgress','dailyLearningHistory'];
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  select * into receipt from public.assistant_language_command_history where user_id=owner_id and id=p_request_id for update;
  if not found then raise exception '실행 이력을 찾을 수 없습니다.'; end if;
  if receipt.undone_at is not null then return to_jsonb(receipt); end if;
  select state into current_state from public.language_user_state where user_id=owner_id for update;
  if not found then raise exception '학습 기록이 삭제되었습니다. 되돌리지 않았습니다.'; end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into current_values from jsonb_each(current_state) where key=any(record_keys);
  if current_values is distinct from receipt.after_values then raise exception '이후에 학습 기록이 변경되었습니다. 새 기록을 보호하기 위해 되돌리지 않았습니다.'; end if;
  update public.language_user_state set state=(current_state-record_keys)||receipt.before_values,updated_at=clock_timestamp() where user_id=owner_id;
  if not found then raise exception '학습 기록을 되돌리지 못했습니다.'; end if;
  update public.assistant_language_command_history set undone_at=clock_timestamp() where user_id=owner_id and id=p_request_id returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.undo_assistant_language_command(uuid) from public,anon;
grant execute on function public.undo_assistant_language_command(uuid) to authenticated;

-- Record reset erases snapshots in the same transaction. No replacement of
-- reset_my_app_records is needed; its existing owner lock also covers commands.
create function public.clear_assistant_language_command_history()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    delete from public.assistant_language_command_history where user_id=old.user_id;
    return old;
  end if;
  if old.state->>tg_argv[0] is distinct from new.state->>tg_argv[0] then
    delete from public.assistant_language_command_history where user_id=new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_assistant_language_command_history() from public,anon;
grant execute on function public.clear_assistant_language_command_history() to authenticated,service_role;
create trigger assistant_language_history_language_reset after update of state or delete on public.language_user_state
  for each row execute function public.clear_assistant_language_command_history('languageRecordResetV1');
create trigger assistant_language_history_assistant_reset after update of state or delete on public.user_app_state
  for each row execute function public.clear_assistant_language_command_history('ai-fitness-record-reset-assistant');
