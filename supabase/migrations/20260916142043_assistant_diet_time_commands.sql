-- Confirmed last-meal clock; time-of-day never implies fasting completion.
create function public.assistant_diet_fasting_value(p_value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare parsed jsonb := p_value; raw text;
begin
  if p_value is null then return '""'::jsonb; end if;
  if jsonb_typeof(p_value)='string' then
    raw := p_value#>>'{}';
    if raw='' or raw ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return p_value; end if;
    begin parsed := raw::jsonb; exception when others then raise exception '기존 공복 시작 시각을 식단 화면에서 확인해 주세요.'; end;
  end if;
  if jsonb_typeof(parsed)='object' or (jsonb_typeof(parsed)='string' and (parsed='""' or parsed#>>'{}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) then return parsed; end if;
  raise exception '기존 공복 시작 시각을 식단 화면에서 확인해 주세요.';
end;
$$;
create function public.assistant_diet_time_snapshot(p_state jsonb,p_day date)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb := public.assistant_diet_snapshot(p_state,p_day); field text; record_key text; records jsonb; entry jsonb; parsed jsonb; clock_value jsonb;
begin
  for field,record_key in select * from (values ('meal','ai-fitness-diet-meal-log'),('dinnerTime','ai-fitness-diet-dinner-completed-time')) mapping loop
    records := public.assistant_diet_store(p_state,record_key);
    if records ? p_day::text then
      entry := records->p_day::text;
      if field='meal' and jsonb_typeof(entry)<>'object' then raise exception '기존 식사 시각을 식단 화면에서 확인해 주세요.'; end if;
      result := result||jsonb_build_object(field,entry);
    end if;
  end loop;
  if p_state ? 'ai-fitness-fasting-start-time' then result := result||jsonb_build_object('fastingStart',p_state->'ai-fitness-fasting-start-time'); end if;
  parsed := public.assistant_diet_fasting_value(result->'fastingStart');
  foreach clock_value in array array[result#>'{record,lastMealTime}',result#>'{meal,lastMealTime}',result->'dinnerTime',case when jsonb_typeof(parsed)='object' then parsed->p_day::text else parsed end] loop
    if clock_value is not null and (jsonb_typeof(clock_value)<>'string' or (clock_value<>'""' and clock_value#>>'{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) then raise exception '기존 식사 시각을 식단 화면에서 확인해 주세요.'; end if;
  end loop;
  return result;
end;
$$;
create function public.assistant_diet_time_next(p_before jsonb,p_change jsonb,p_day date)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare meal_time text := p_change->>'time'; parsed jsonb := public.assistant_diet_fasting_value(p_before->'fastingStart');
begin
  if p_day is null or p_change is null or jsonb_typeof(p_change)<>'object' or p_change->>'kind' is distinct from 'time'
    or (p_change-'kind'-'time')<>'{}' or jsonb_typeof(p_change->'time') is distinct from 'string'
    or meal_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception '마지막 식사 시각은 00:00~23:59의 24시간제로 입력해 주세요.'; end if;
  return p_before||jsonb_build_object(
    'record',coalesce(p_before->'record','{}')||jsonb_build_object('lastMealTime',meal_time,'dinnerBefore1830',meal_time<='18:30'),
    'meal',coalesce(p_before->'meal','{}')||jsonb_build_object('lastMealTime',meal_time),'dinnerTime',meal_time,
    'fastingStart',(case when jsonb_typeof(parsed)='object' then parsed else '{}'::jsonb end)||jsonb_build_object(p_day::text,meal_time));
end;
$$;
create function public.apply_assistant_diet_time_command(
  p_request_id uuid,p_day date,p_change jsonb,p_expected jsonb,p_reset_markers jsonb,p_expires_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := auth.uid(); receipt public.assistant_diet_command_history;
  current_state jsonb; current_values jsonb; next_values jsonb; records jsonb;
  request_hash text; formats jsonb := '{}'; field text; record_key text; original_format text;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  if p_request_id is null or p_day is null or p_expected is null or jsonb_typeof(p_expected)<>'object' or octet_length(p_expected::text)>500000
    or p_reset_markers is null or jsonb_typeof(p_reset_markers)<>'object' then raise exception '확인할 식단 내용을 다시 불러와 주세요.'; end if;
  perform public.assistant_diet_time_next(p_expected,p_change,p_day);
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  request_hash := md5(jsonb_build_array(p_day,p_change,p_expected,p_reset_markers,p_expires_at)::text);
  select * into receipt from public.assistant_diet_command_history where user_id=owner_id and id=p_request_id;
  if found then
    if receipt.payload_hash<>request_hash then raise exception '이미 사용한 요청입니다. 실행 이력을 확인해 주세요.'; end if;
    return to_jsonb(receipt);
  end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '20 minutes' then raise exception '확인 시간이 지났습니다. 명령을 다시 입력해 주세요.'; end if;
  if p_day<>(clock_timestamp() at time zone 'Asia/Seoul')::date then raise exception '식단 날짜가 바뀌었습니다. 오늘 기록 명령을 다시 입력해 주세요.'; end if;
  if (p_change->>'time')::time>(clock_timestamp() at time zone 'Asia/Seoul')::time then raise exception '아직 지나지 않은 시각입니다. 오늘 실제로 마지막 음식을 드신 시각을 24시간제로 입력해 주세요.'; end if;
  insert into public.user_app_state(user_id,state) values(owner_id,'{}') on conflict(user_id) do nothing;
  select state into current_state from public.user_app_state where user_id=owner_id for update;
  if current_state is null or jsonb_typeof(current_state)<>'object' then raise exception '식단 기록을 확인하지 못했습니다.'; end if;
  if p_reset_markers is distinct from jsonb_build_object('diet',current_state->>'ai-fitness-record-reset-diet','assistant',current_state->>'ai-fitness-record-reset-assistant') then raise exception '기록이 초기화되었습니다. 명령을 다시 입력해 주세요.'; end if;
  current_values := public.assistant_diet_time_snapshot(current_state,p_day);
  if current_values is distinct from p_expected then raise exception '다른 곳에서 오늘 식단 기록이 변경되었습니다. 명령을 다시 입력해 주세요.'; end if;
  next_values := public.assistant_diet_time_next(current_values,p_change,p_day);
  for field,record_key in select * from (values ('record','ai-fitness-diet-completed-days'),('meal','ai-fitness-diet-meal-log'),('dinnerTime','ai-fitness-diet-dinner-completed-time')) mapping loop
    original_format := coalesce(jsonb_typeof(current_state->record_key),'missing');
    formats := formats||jsonb_build_object(field,original_format);
    records := public.assistant_diet_store(current_state,record_key)||jsonb_build_object(p_day::text,next_values->field);
    current_state := current_state||jsonb_build_object(record_key,case when original_format='string' then to_jsonb(records::text) else records end);
  end loop;
  current_state := current_state||jsonb_build_object('ai-fitness-fasting-start-time',next_values->'fastingStart');
  update public.user_app_state set state=current_state,updated_at=clock_timestamp() where user_id=owner_id;
  if not found then raise exception '식단 기록을 저장하지 못했습니다.'; end if;
  insert into public.assistant_diet_command_history(user_id,id,record_date,payload_hash,change,before_values,after_values,store_formats)
    values(owner_id,p_request_id,p_day,request_hash,p_change,current_values,next_values,formats) returning * into receipt;
  return to_jsonb(receipt);
end;
$$;

create or replace function public.undo_assistant_diet_command(p_request_id uuid)
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
  if (case when receipt.change->>'kind'='time' then public.assistant_diet_time_snapshot(current_state,receipt.record_date) when receipt.change->>'kind'='meal' then public.assistant_diet_meal_snapshot(current_state,receipt.record_date) else public.assistant_diet_snapshot(current_state,receipt.record_date) end) is distinct from receipt.after_values then raise exception '이후에 오늘 식단 기록이 변경되었습니다. 새 기록을 보호하기 위해 되돌리지 않았습니다.'; end if;
  for field,record_key in select * from (values ('record','ai-fitness-diet-completed-days'),('water','ai-fitness-water-intake'),('meal','ai-fitness-diet-meal-log'),('lunchCarb','ai-fitness-lunch-carb-choice'),('dinnerCarb','ai-fitness-dinner-carb-choice'),('proteinTotal','ai-fitness-protein-total'),('dinnerTime','ai-fitness-diet-dinner-completed-time')) mapping loop
    if not(receipt.store_formats ? field) then continue; end if;
    records := public.assistant_diet_store(current_state,record_key)-receipt.record_date::text;
    if receipt.before_values ? field then records := records||jsonb_build_object(receipt.record_date::text,receipt.before_values->field); end if;
    current_state := case when records='{}'::jsonb and receipt.store_formats->>field='missing' then current_state-record_key
      else current_state||jsonb_build_object(record_key,case when jsonb_typeof(current_state->record_key)='string' then to_jsonb(records::text) else records end) end;
  end loop;
  if receipt.change->>'kind'='time' then
    current_state := case when receipt.before_values ? 'fastingStart' then current_state||jsonb_build_object('ai-fitness-fasting-start-time',receipt.before_values->'fastingStart') else current_state-'ai-fitness-fasting-start-time' end;
  end if;
  update public.user_app_state set state=current_state,updated_at=clock_timestamp() where user_id=owner_id;
  if not found then raise exception '식단 기록을 되돌리지 못했습니다.'; end if;
  update public.assistant_diet_command_history set undone_at=clock_timestamp() where user_id=owner_id and id=p_request_id returning * into receipt;
  return to_jsonb(receipt);
end;
$$;
revoke all on function public.undo_assistant_diet_command(uuid) from public,anon;
grant execute on function public.undo_assistant_diet_command(uuid) to authenticated;

revoke all on function public.assistant_diet_fasting_value(jsonb) from public,anon;
grant execute on function public.assistant_diet_fasting_value(jsonb) to authenticated;
revoke all on function public.assistant_diet_time_snapshot(jsonb,date) from public,anon;
grant execute on function public.assistant_diet_time_snapshot(jsonb,date) to authenticated;
revoke all on function public.assistant_diet_time_next(jsonb,jsonb,date) from public,anon;
grant execute on function public.assistant_diet_time_next(jsonb,jsonb,date) to authenticated;
revoke all on function public.apply_assistant_diet_time_command(uuid,date,jsonb,jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.apply_assistant_diet_time_command(uuid,date,jsonb,jsonb,jsonb,timestamptz) to authenticated;
