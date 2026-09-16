-- Only the reviewed date is changed. No planned exercises, sets, repetitions,
-- pain answers, recovery decisions, or plan settings are inferred by this command.
create table public.assistant_workout_command_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null, record_date date not null, payload_hash text not null,
  before_values jsonb not null, after_values jsonb not null,
  store_format text not null check(store_format in ('missing','object','string')),
  created_at timestamptz not null default clock_timestamp(), undone_at timestamptz,
  primary key(user_id,id)
);
create index assistant_workout_command_history_created_idx on public.assistant_workout_command_history(user_id,created_at desc,id);
alter table public.assistant_workout_command_history enable row level security;
create policy assistant_workout_command_history_owner on public.assistant_workout_command_history for all to authenticated
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.assistant_workout_command_history from public,anon,authenticated;
grant select,insert,update,delete on public.assistant_workout_command_history to authenticated;
grant all on public.assistant_workout_command_history to service_role;

create function public.assistant_workout_store(p_state jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare records jsonb := p_state->'ai-fitness-workout-completed-days';
begin
  if records is null then return '{}'::jsonb; end if;
  if jsonb_typeof(records)='string' then records := (records#>>'{}')::jsonb; end if;
  if jsonb_typeof(records)<>'object' then raise exception '운동 기록 형식을 확인하지 못했습니다. 운동 화면에서 확인해 주세요.'; end if;
  return records;
exception when invalid_text_representation then
  raise exception '운동 기록 형식을 확인하지 못했습니다. 운동 화면에서 확인해 주세요.';
end;
$$;
revoke all on function public.assistant_workout_store(jsonb) from public,anon;
grant execute on function public.assistant_workout_store(jsonb) to authenticated;

create function public.apply_assistant_workout_command(
  p_request_id uuid,p_day date,p_expected jsonb,p_reset_markers jsonb,p_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_workout_command_history;
  current_state jsonb; records jsonb; entry jsonb; current_values jsonb; next_values jsonb;
  request_hash text; original_format text;
  record_key text := 'ai-fitness-workout-completed-days';
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_request_id is null or p_day is null or p_expected is null or jsonb_typeof(p_expected)<>'object'
    or (p_expected-'record')<>'{}' or octet_length(p_expected::text)>500000
    or p_reset_markers is null or jsonb_typeof(p_reset_markers)<>'object' then raise exception '확인할 운동 내용을 다시 불러와 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  request_hash := md5(jsonb_build_array(p_day,p_expected,p_reset_markers,p_expires_at)::text);
  select * into receipt from public.assistant_workout_command_history where user_id=owner_id and id=p_request_id;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 요청입니다. 실행 이력을 확인해 주세요.'; end if;
    return to_jsonb(receipt);
  end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '20 minutes' then raise exception '확인 시간이 지났습니다. 명령을 다시 입력해 주세요.'; end if;
  if p_day<>(clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception '운동 날짜가 바뀌었습니다. 오늘 운동 명령을 다시 입력해 주세요.'; end if;
  insert into public.user_app_state(user_id,state) values(owner_id,'{}') on conflict(user_id) do nothing;
  select state into current_state from public.user_app_state where user_id=owner_id for update;
  if current_state is null or jsonb_typeof(current_state)<>'object' then raise exception '운동 기록을 확인하지 못했습니다.'; end if;
  if p_reset_markers is distinct from jsonb_build_object('fitness',current_state->>'ai-fitness-record-reset-fitness','assistant',current_state->>'ai-fitness-record-reset-assistant') then raise exception '기록이 초기화되었습니다. 명령을 다시 입력해 주세요.'; end if;
  original_format := coalesce(jsonb_typeof(current_state->record_key),'missing');
  records := public.assistant_workout_store(current_state);
  current_values := case when records ? p_day::text then jsonb_build_object('record',records->p_day::text) else '{}' end;
  if current_values is distinct from p_expected then raise exception '다른 곳에서 오늘 운동 기록이 변경되었습니다. 명령을 다시 입력해 주세요.'; end if;
  entry := records->p_day::text;
  if entry is not null and jsonb_typeof(entry) not in ('boolean','object') then raise exception '오늘 운동 기록을 확인하지 못했습니다.'; end if;
  if entry->>'workoutStatus' in ('partial','stopped') then raise exception '오늘의 일부 완료·중단 기록이 있습니다. 운동 화면에서 확인하고 수정해 주세요.'; end if;
  if entry='true'::jsonb or entry->'workoutDone'='true'::jsonb or entry->>'workoutStatus'='completed' then raise exception '오늘 운동은 이미 완료로 기록되어 있습니다.'; end if;
  if jsonb_typeof(entry)='object' then
    if exists(select 1 from jsonb_each(entry) where key='exerciseRecords' or (left(key,7)='workout' and not(key='workoutDone' and value='false'::jsonb))) then
      raise exception '오늘의 수행·통증 등 상세 기록이 있습니다. 운동 화면에서 확인하고 수정해 주세요.';
    end if;
  else entry := '{}'; end if;
  entry := entry || jsonb_build_object('workoutDone',true,'workoutStatus','completed','workoutRoutineName','직접 완료 기록','workoutRecordedAt',clock_timestamp());
  next_values := jsonb_build_object('record',entry);
  records := records || jsonb_build_object(p_day::text,entry);
  update public.user_app_state set state=current_state||jsonb_build_object(record_key,case when original_format='string' then to_jsonb(records::text) else records end),updated_at=clock_timestamp() where user_id=owner_id;
  if not found then raise exception '운동 기록을 저장하지 못했습니다.'; end if;
  insert into public.assistant_workout_command_history(user_id,id,record_date,payload_hash,before_values,after_values,store_format)
    values(owner_id,p_request_id,p_day,request_hash,current_values,next_values,original_format) returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.apply_assistant_workout_command(uuid,date,jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.apply_assistant_workout_command(uuid,date,jsonb,jsonb,timestamptz) to authenticated;

create function public.undo_assistant_workout_command(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_workout_command_history;
  current_state jsonb; records jsonb; current_values jsonb;
  record_key text := 'ai-fitness-workout-completed-days';
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  select * into receipt from public.assistant_workout_command_history where user_id=owner_id and id=p_request_id for update;
  if not found then raise exception '실행 이력을 찾을 수 없습니다.'; end if;
  if receipt.undone_at is not null then return to_jsonb(receipt); end if;
  select state into current_state from public.user_app_state where user_id=owner_id for update;
  if not found then raise exception '운동 기록이 삭제되었습니다. 되돌리지 않았습니다.'; end if;
  records := public.assistant_workout_store(current_state);
  current_values := case when records ? receipt.record_date::text then jsonb_build_object('record',records->receipt.record_date::text) else '{}' end;
  if current_values is distinct from receipt.after_values then raise exception '이후에 오늘 운동 기록이 변경되었습니다. 새 기록을 보호하기 위해 되돌리지 않았습니다.'; end if;
  records := records-receipt.record_date::text;
  if receipt.before_values ? 'record' then records := records||jsonb_build_object(receipt.record_date::text,receipt.before_values->'record'); end if;
  current_state := case when records='{}'::jsonb and receipt.store_format='missing' then current_state-record_key
    else current_state||jsonb_build_object(record_key,case when jsonb_typeof(current_state->record_key)='string' then to_jsonb(records::text) else records end) end;
  update public.user_app_state set state=current_state,updated_at=clock_timestamp() where user_id=owner_id;
  if not found then raise exception '운동 기록을 되돌리지 못했습니다.'; end if;
  update public.assistant_workout_command_history set undone_at=clock_timestamp() where user_id=owner_id and id=p_request_id returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.undo_assistant_workout_command(uuid) from public,anon;
grant execute on function public.undo_assistant_workout_command(uuid) to authenticated;

-- Auth deletion uses ON DELETE CASCADE; the restricted Auth role never needs
-- application ledger privileges. Only explicit record resets run this trigger.
create function public.clear_assistant_workout_command_history()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.state->>'ai-fitness-record-reset-fitness' is distinct from new.state->>'ai-fitness-record-reset-fitness'
    or old.state->>'ai-fitness-record-reset-assistant' is distinct from new.state->>'ai-fitness-record-reset-assistant' then
    delete from public.assistant_workout_command_history where user_id=new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_assistant_workout_command_history() from public,anon;
grant execute on function public.clear_assistant_workout_command_history() to authenticated,service_role;
create trigger assistant_workout_history_reset after update of state on public.user_app_state
  for each row execute function public.clear_assistant_workout_command_history();
