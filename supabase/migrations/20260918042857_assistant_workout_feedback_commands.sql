-- Add direct feedback commands to the same atomic ledger and undo protection.
alter table public.assistant_workout_command_history drop constraint assistant_workout_command_history_command_kind_check;
alter table public.assistant_workout_command_history add constraint assistant_workout_command_history_command_kind_check check(command_kind in ('completion','cardio','feedback'));
create function public.assistant_workout_feedback_next(p_snapshot jsonb,p_change jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare entry jsonb := p_snapshot->'record'; field text := p_change->>'field'; value jsonb := p_change->'value'; number numeric;
begin
 if p_change is null or jsonb_typeof(p_change)<>'object' or p_change->>'kind' is distinct from 'feedback'
 or not(p_change ?& array['kind','field','value']) or (p_change-array['kind','field','value'])<>'{}'
 or field is null or field not in ('workoutFatigue','workoutDifficulty','workoutLastSetRpe','workoutPainArea','workoutStatus') then raise exception '운동 상세 기록 값을 다시 확인해 주세요.'; end if;
 if field in ('workoutFatigue','workoutLastSetRpe') then
  if jsonb_typeof(value) is distinct from 'number' then raise exception '정수로 입력해 주세요.'; end if;
  number := (p_change->>'value')::numeric;
  if number<1 or number>(case when field='workoutFatigue' then 5 else 10 end) or number<>trunc(number) then raise exception '운동 상세 기록 값의 범위를 확인해 주세요.'; end if;
 else
  if jsonb_typeof(value) is distinct from 'string' or not(
   field='workoutDifficulty' and p_change->>'value' in ('easy','moderate','hard') or
   field='workoutPainArea' and p_change->>'value' in ('허리','골반','무릎','발목','어깨','손목','기타') or
   field='workoutStatus' and p_change->>'value' in ('partial','stopped')) then raise exception '지원하는 운동 상세 값을 확인해 주세요.'; end if;
 end if;
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or (p_snapshot-'record')<>'{}' or (entry is not null and jsonb_typeof(entry) not in ('boolean','object')) then raise exception '기존 운동 기록 형식을 확인하지 못했습니다.'; end if;
 if jsonb_typeof(entry)='boolean' then entry:=jsonb_build_object('workoutDone',entry); elsif entry is null then entry:='{}'; end if;
 entry:=entry||jsonb_build_object(field,value);
 if field='workoutStatus' then entry:=entry||'{"workoutDone":false}'::jsonb; end if;
 if field='workoutPainArea' then entry:=entry||'{"workoutPain":true}'::jsonb; end if;
 return jsonb_build_object('record',entry);
end;
$$;
revoke all on function public.assistant_workout_feedback_next(jsonb,jsonb) from public,anon;
grant execute on function public.assistant_workout_feedback_next(jsonb,jsonb) to authenticated;

create function public.apply_assistant_workout_feedback_command(
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
    or p_reset_markers is null or jsonb_typeof(p_reset_markers)<>'object' then raise exception '확인할 운동 상세 내용을 다시 불러와 주세요.'; end if;
  next_values := public.assistant_workout_feedback_next(p_expected,p_change);
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  request_hash := md5(jsonb_build_array('feedback',p_day,p_change,p_expected,p_reset_markers,p_expires_at)::text);
  select * into receipt from public.assistant_workout_command_history where user_id=owner_id and id=p_request_id;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 요청입니다. 실행 이력을 확인해 주세요.'; end if;
    return to_jsonb(receipt);
  end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '20 minutes' then raise exception '확인 시간이 지났습니다. 명령을 다시 입력해 주세요.'; end if;
  if p_day<>(clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception '운동 날짜가 바뀌었습니다. 오늘 운동 상세 명령을 다시 입력해 주세요.'; end if;
  insert into public.user_app_state(user_id,state) values(owner_id,'{}') on conflict(user_id) do nothing;
  select state into current_state from public.user_app_state where user_id=owner_id for update;
  if current_state is null or jsonb_typeof(current_state)<>'object' then raise exception '운동 기록을 확인하지 못했습니다.'; end if;
  if p_reset_markers is distinct from jsonb_build_object('fitness',current_state->>'ai-fitness-record-reset-fitness','assistant',current_state->>'ai-fitness-record-reset-assistant') then raise exception '기록이 초기화되었습니다. 명령을 다시 입력해 주세요.'; end if;
  original_format := coalesce(jsonb_typeof(current_state->record_key),'missing');
  records := public.assistant_workout_store(current_state);
  current_values := case when records ? p_day::text then jsonb_build_object('record',records->p_day::text) else '{}' end;
  if current_values is distinct from p_expected then raise exception '다른 곳에서 오늘 운동 기록이 변경되었습니다. 명령을 다시 입력해 주세요.'; end if;
  if next_values=current_values then raise exception '오늘 운동 상세 값은 이미 같은 값으로 기록되어 있습니다.'; end if;
  records := records || jsonb_build_object(p_day::text,next_values->'record');
  update public.user_app_state set state=current_state||jsonb_build_object(record_key,case when original_format='string' then to_jsonb(records::text) else records end),updated_at=clock_timestamp() where user_id=owner_id;
  if not found then raise exception '운동 상세 기록을 저장하지 못했습니다.'; end if;
  insert into public.assistant_workout_command_history(user_id,id,record_date,command_kind,payload_hash,before_values,after_values,store_format)
    values(owner_id,p_request_id,p_day,'feedback',request_hash,current_values,next_values,original_format) returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.apply_assistant_workout_feedback_command(uuid,date,jsonb,jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.apply_assistant_workout_feedback_command(uuid,date,jsonb,jsonb,jsonb,timestamptz) to authenticated;
