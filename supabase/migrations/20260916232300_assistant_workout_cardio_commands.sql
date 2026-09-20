-- Reuse the owner-scoped workout ledger and exact-date undo/reset behavior.
-- The original completion RPC and its pending requests remain compatible.
alter table public.assistant_workout_command_history
  add column command_kind text not null default 'completion' check(command_kind in ('completion','cardio'));

create function public.assistant_workout_cardio_next(p_snapshot jsonb,p_change jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare entry jsonb := p_snapshot->'record'; minutes numeric;
begin
  if p_change is null or jsonb_typeof(p_change)<>'object'
    or p_change->>'kind' is distinct from 'cardio'
    or not(p_change ?& array['kind','type','minutes']) or (p_change-array['kind','type','minutes'])<>'{}'
    or p_change->>'type' not in ('실내 걷기','야외 걷기','제자리 걷기','스트레칭 + 가벼운 움직임','고정식 자전거','가벼운 계단 오르기','슬라이딩보드','기타')
    or jsonb_typeof(p_change->'type') is distinct from 'string'
    or jsonb_typeof(p_change->'minutes') is distinct from 'number' then
    raise exception '유산소 종류와 오늘 총시간을 다시 확인해 주세요. 시간은 1~300분의 정수로 입력해 주세요.';
  end if;
  minutes := (p_change->>'minutes')::numeric;
  if minutes<1 or minutes>300 or minutes<>trunc(minutes) then
    raise exception '유산소 시간은 1~300분의 정수로 입력해 주세요.';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or (p_snapshot-'record')<>'{}'
    or (entry is not null and jsonb_typeof(entry) not in ('boolean','object')) then
    raise exception '오늘 유산소 기록 형식을 확인하지 못했습니다. 운동 화면에서 확인해 주세요.';
  end if;
  if jsonb_typeof(entry)='object' then
    if (entry ? 'cardioDone' and jsonb_typeof(entry->'cardioDone')<>'boolean')
      or (entry ? 'cardioType' and (jsonb_typeof(entry->'cardioType')<>'string' or char_length(entry->>'cardioType')>200))
      or (entry ? 'cardioMinutes' and jsonb_typeof(entry->'cardioMinutes')<>'number') then
      raise exception '오늘 유산소 기록 형식을 확인하지 못했습니다. 운동 화면에서 확인해 주세요.';
    end if;
    if entry ? 'cardioMinutes' and (entry->>'cardioMinutes')::numeric<0 then
      raise exception '오늘 유산소 기록 형식을 확인하지 못했습니다. 운동 화면에서 확인해 주세요.';
    end if;
  elsif jsonb_typeof(entry)='boolean' then entry := jsonb_build_object('workoutDone',entry);
  else entry := '{}'; end if;
  return jsonb_build_object('record',entry||jsonb_build_object('cardioDone',true,'cardioType',p_change->>'type','cardioMinutes',minutes));
end;
$$;
revoke all on function public.assistant_workout_cardio_next(jsonb,jsonb) from public,anon;
grant execute on function public.assistant_workout_cardio_next(jsonb,jsonb) to authenticated;

create function public.apply_assistant_workout_cardio_command(
  p_request_id uuid,p_day date,p_change jsonb,p_expected jsonb,p_reset_markers jsonb,p_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_workout_command_history;
  current_state jsonb; records jsonb; current_values jsonb; next_values jsonb;
  request_hash text; original_format text;
  record_key text := 'ai-fitness-workout-completed-days';
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_request_id is null or p_day is null or p_expected is null or octet_length(p_expected::text)>500000
    or p_reset_markers is null or jsonb_typeof(p_reset_markers)<>'object' then raise exception '확인할 유산소 내용을 다시 불러와 주세요.'; end if;
  next_values := public.assistant_workout_cardio_next(p_expected,p_change);
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  request_hash := md5(jsonb_build_array('cardio',p_day,p_change,p_expected,p_reset_markers,p_expires_at)::text);
  select * into receipt from public.assistant_workout_command_history where user_id=owner_id and id=p_request_id;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 요청입니다. 실행 이력을 확인해 주세요.'; end if;
    return to_jsonb(receipt);
  end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '20 minutes' then raise exception '확인 시간이 지났습니다. 명령을 다시 입력해 주세요.'; end if;
  if p_day<>(clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception '운동 날짜가 바뀌었습니다. 오늘 유산소 명령을 다시 입력해 주세요.'; end if;
  insert into public.user_app_state(user_id,state) values(owner_id,'{}') on conflict(user_id) do nothing;
  select state into current_state from public.user_app_state where user_id=owner_id for update;
  if current_state is null or jsonb_typeof(current_state)<>'object' then raise exception '운동 기록을 확인하지 못했습니다.'; end if;
  if p_reset_markers is distinct from jsonb_build_object('fitness',current_state->>'ai-fitness-record-reset-fitness','assistant',current_state->>'ai-fitness-record-reset-assistant') then raise exception '기록이 초기화되었습니다. 명령을 다시 입력해 주세요.'; end if;
  original_format := coalesce(jsonb_typeof(current_state->record_key),'missing');
  records := public.assistant_workout_store(current_state);
  current_values := case when records ? p_day::text then jsonb_build_object('record',records->p_day::text) else '{}' end;
  if current_values is distinct from p_expected then raise exception '다른 곳에서 오늘 운동 기록이 변경되었습니다. 명령을 다시 입력해 주세요.'; end if;
  if next_values=current_values then raise exception '오늘 유산소 종류와 총시간은 이미 같은 값으로 기록되어 있습니다.'; end if;
  records := records || jsonb_build_object(p_day::text,next_values->'record');
  update public.user_app_state set state=current_state||jsonb_build_object(record_key,case when original_format='string' then to_jsonb(records::text) else records end),updated_at=clock_timestamp() where user_id=owner_id;
  if not found then raise exception '유산소 기록을 저장하지 못했습니다.'; end if;
  insert into public.assistant_workout_command_history(user_id,id,record_date,command_kind,payload_hash,before_values,after_values,store_format)
    values(owner_id,p_request_id,p_day,'cardio',request_hash,current_values,next_values,original_format) returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.apply_assistant_workout_cardio_command(uuid,date,jsonb,jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.apply_assistant_workout_cardio_command(uuid,date,jsonb,jsonb,jsonb,timestamptz) to authenticated;
