-- Explicit daily water total or literal memo append. No food, nutrition,
-- fasting, meal completion or health assessment is inferred.
create table public.assistant_diet_command_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null, record_date date not null, payload_hash text not null,
  change jsonb not null, before_values jsonb not null, after_values jsonb not null,
  store_formats jsonb not null,
  created_at timestamptz not null default clock_timestamp(), undone_at timestamptz,
  primary key(user_id,id)
);
create index assistant_diet_command_history_created_idx on public.assistant_diet_command_history(user_id,created_at desc,id);
alter table public.assistant_diet_command_history enable row level security;
create policy assistant_diet_command_history_owner on public.assistant_diet_command_history for all to authenticated
  using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.assistant_diet_command_history from public,anon,authenticated;
grant select,insert,update,delete on public.assistant_diet_command_history to authenticated;
grant all on public.assistant_diet_command_history to service_role;

create function public.assistant_diet_store(p_state jsonb,p_key text)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare records jsonb := p_state->p_key;
begin
  if records is null then return '{}'::jsonb; end if;
  if jsonb_typeof(records)='string' then records := (records#>>'{}')::jsonb; end if;
  if jsonb_typeof(records)<>'object' then raise exception '식단 기록 형식을 확인하지 못했습니다. 식단 화면에서 확인해 주세요.'; end if;
  return records;
exception when invalid_text_representation then
  raise exception '식단 기록 형식을 확인하지 못했습니다. 식단 화면에서 확인해 주세요.';
end;
$$;
revoke all on function public.assistant_diet_store(jsonb,text) from public,anon;
grant execute on function public.assistant_diet_store(jsonb,text) to authenticated;

create function public.assistant_diet_snapshot(p_state jsonb,p_day date)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb := '{}'; field text; record_key text; records jsonb; entry jsonb;
begin
  for field,record_key in select * from (values ('record','ai-fitness-diet-completed-days'),('water','ai-fitness-water-intake')) mapping loop
    records := public.assistant_diet_store(p_state,record_key);
    if records ? p_day::text then
      entry := records->p_day::text;
      if field='record' and jsonb_typeof(entry)<>'object' then raise exception '오늘 식단 기록을 확인하지 못했습니다.'; end if;
      if field='water' then
        if jsonb_typeof(entry)<>'number' then raise exception '오늘 수분 기록을 확인하지 못했습니다.'; end if;
        if (entry::text)::numeric<0 or (entry::text)::numeric>9007199254740991 or trunc((entry::text)::numeric)<>(entry::text)::numeric then raise exception '오늘 수분 기록을 확인하지 못했습니다.'; end if;
      end if;
      result := result||jsonb_build_object(field,entry);
    end if;
  end loop;
  return result;
end;
$$;
revoke all on function public.assistant_diet_snapshot(jsonb,date) from public,anon;
grant execute on function public.assistant_diet_snapshot(jsonb,date) to authenticated;

create function public.apply_assistant_diet_command(
  p_request_id uuid,p_day date,p_change jsonb,p_expected jsonb,p_reset_markers jsonb,p_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_diet_command_history;
  current_state jsonb; records jsonb; entry jsonb; current_values jsonb; next_values jsonb;
  request_hash text; formats jsonb := '{}'; field text; record_key text; original_format text;
  total_ml numeric; memo_text text; previous_memo text;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_request_id is null or p_day is null or p_expected is null or jsonb_typeof(p_expected)<>'object'
    or (p_expected-'record'-'water')<>'{}' or octet_length(p_expected::text)>500000
    or p_reset_markers is null or jsonb_typeof(p_reset_markers)<>'object'
    or p_change is null or jsonb_typeof(p_change)<>'object' then raise exception '확인할 식단 내용을 다시 불러와 주세요.'; end if;
  if p_change->>'kind'='water' then
    if (p_change-'kind'-'totalMl')<>'{}' or jsonb_typeof(p_change->'totalMl') is distinct from 'number' then raise exception '수분 총량을 다시 확인해 주세요.'; end if;
    total_ml := (p_change->>'totalMl')::numeric;
    if total_ml<0 or total_ml>10000 or trunc(total_ml)<>total_ml then raise exception '물 총량은 0~10,000mL 사이의 정수로 입력해 주세요.'; end if;
  elsif p_change->>'kind'='memo' then
    if (p_change-'kind'-'text')<>'{}' or jsonb_typeof(p_change->'text') is distinct from 'string' then raise exception '추가할 메모를 다시 확인해 주세요.'; end if;
    memo_text := p_change->>'text';
    if length(btrim(memo_text,E' \n\r\t'))=0 or length(memo_text)>400 or memo_text<>btrim(memo_text,E' \n\r\t') then raise exception '추가할 식단 메모는 1~400자로 입력해 주세요.'; end if;
  else raise exception '수분 총량 기록 또는 식단 메모 추가만 지원합니다.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  request_hash := md5(jsonb_build_array(p_day,p_change,p_expected,p_reset_markers,p_expires_at)::text);
  select * into receipt from public.assistant_diet_command_history where user_id=owner_id and id=p_request_id;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 요청입니다. 실행 이력을 확인해 주세요.'; end if;
    return to_jsonb(receipt);
  end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '20 minutes' then raise exception '확인 시간이 지났습니다. 명령을 다시 입력해 주세요.'; end if;
  if p_day<>(clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception '식단 날짜가 바뀌었습니다. 오늘 기록 명령을 다시 입력해 주세요.'; end if;
  insert into public.user_app_state(user_id,state) values(owner_id,'{}') on conflict(user_id) do nothing;
  select state into current_state from public.user_app_state where user_id=owner_id for update;
  if current_state is null or jsonb_typeof(current_state)<>'object' then raise exception '식단 기록을 확인하지 못했습니다.'; end if;
  if p_reset_markers is distinct from jsonb_build_object('diet',current_state->>'ai-fitness-record-reset-diet','assistant',current_state->>'ai-fitness-record-reset-assistant') then raise exception '기록이 초기화되었습니다. 명령을 다시 입력해 주세요.'; end if;
  current_values := public.assistant_diet_snapshot(current_state,p_day);
  if current_values is distinct from p_expected then raise exception '다른 곳에서 오늘 식단 기록이 변경되었습니다. 명령을 다시 입력해 주세요.'; end if;
  entry := coalesce(current_values->'record','{}');
  if p_change->>'kind'='water' then
    entry := entry||jsonb_build_object('waterMl',total_ml,'water2l',total_ml>=2000);
    next_values := current_values||jsonb_build_object('record',entry,'water',total_ml);
  else
    if entry ? 'dietMemo' and jsonb_typeof(entry->'dietMemo')<>'string' then raise exception '기존 식단 메모 형식을 식단 화면에서 확인해 주세요.'; end if;
    previous_memo := coalesce(entry->>'dietMemo','');
    memo_text := case when previous_memo='' then memo_text else previous_memo||E'\n'||memo_text end;
    if length(memo_text)>4000 then raise exception '메모가 길어 추가하지 못했습니다. 식단 화면에서 기존 메모를 확인해 주세요.'; end if;
    next_values := current_values||jsonb_build_object('record',entry||jsonb_build_object('dietMemo',memo_text));
  end if;
  for field,record_key in select * from (values ('record','ai-fitness-diet-completed-days'),('water','ai-fitness-water-intake')) mapping loop
    -- A memo never rewrites or normalizes the water store.
    if field='water' and p_change->>'kind'='memo' then continue; end if;
    original_format := coalesce(jsonb_typeof(current_state->record_key),'missing');
    formats := formats||jsonb_build_object(field,original_format);
    records := public.assistant_diet_store(current_state,record_key)||jsonb_build_object(p_day::text,next_values->field);
    current_state := current_state||jsonb_build_object(record_key,case when original_format='string' then to_jsonb(records::text) else records end);
  end loop;
  update public.user_app_state set state=current_state,updated_at=clock_timestamp() where user_id=owner_id;
  if not found then raise exception '식단 기록을 저장하지 못했습니다.'; end if;
  insert into public.assistant_diet_command_history(user_id,id,record_date,payload_hash,change,before_values,after_values,store_formats)
    values(owner_id,p_request_id,p_day,request_hash,p_change,current_values,next_values,formats) returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.apply_assistant_diet_command(uuid,date,jsonb,jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.apply_assistant_diet_command(uuid,date,jsonb,jsonb,jsonb,timestamptz) to authenticated;

create function public.undo_assistant_diet_command(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_diet_command_history;
  current_state jsonb; records jsonb; field text; record_key text;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  select * into receipt from public.assistant_diet_command_history where user_id=owner_id and id=p_request_id for update;
  if not found then raise exception '실행 이력을 찾을 수 없습니다.'; end if;
  if receipt.undone_at is not null then return to_jsonb(receipt); end if;
  select state into current_state from public.user_app_state where user_id=owner_id for update;
  if not found then raise exception '식단 기록이 삭제되었습니다. 되돌리지 않았습니다.'; end if;
  if public.assistant_diet_snapshot(current_state,receipt.record_date) is distinct from receipt.after_values then raise exception '이후에 오늘 식단 기록이 변경되었습니다. 새 기록을 보호하기 위해 되돌리지 않았습니다.'; end if;
  for field,record_key in select * from (values ('record','ai-fitness-diet-completed-days'),('water','ai-fitness-water-intake')) mapping loop
    if not(receipt.store_formats ? field) then continue; end if;
    records := public.assistant_diet_store(current_state,record_key)-receipt.record_date::text;
    if receipt.before_values ? field then records := records||jsonb_build_object(receipt.record_date::text,receipt.before_values->field); end if;
    current_state := case when records='{}'::jsonb and receipt.store_formats->>field='missing' then current_state-record_key
      else current_state||jsonb_build_object(record_key,case when jsonb_typeof(current_state->record_key)='string' then to_jsonb(records::text) else records end) end;
  end loop;
  update public.user_app_state set state=current_state,updated_at=clock_timestamp() where user_id=owner_id;
  if not found then raise exception '식단 기록을 되돌리지 못했습니다.'; end if;
  update public.assistant_diet_command_history set undone_at=clock_timestamp() where user_id=owner_id and id=p_request_id returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.undo_assistant_diet_command(uuid) from public,anon;
grant execute on function public.undo_assistant_diet_command(uuid) to authenticated;

create function public.clear_assistant_diet_command_history()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.state->>'ai-fitness-record-reset-diet' is distinct from new.state->>'ai-fitness-record-reset-diet'
    or old.state->>'ai-fitness-record-reset-assistant' is distinct from new.state->>'ai-fitness-record-reset-assistant' then
    delete from public.assistant_diet_command_history where user_id=new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_assistant_diet_command_history() from public,anon;
grant execute on function public.clear_assistant_diet_command_history() to authenticated,service_role;
-- Auth deletion is handled by the foreign key, never by an invoker DELETE trigger.
create trigger assistant_diet_history_reset after update of state on public.user_app_state
  for each row execute function public.clear_assistant_diet_command_history();
