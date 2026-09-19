-- Explicit grams for one meal. Reuse the existing owner-scoped diet history,
-- reset lock and receipts; older water/memo proposals keep their original shape.
create function public.assistant_diet_meal_snapshot(p_state jsonb,p_day date)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb := public.assistant_diet_snapshot(p_state,p_day); field text; record_key text; records jsonb; entry jsonb;
begin
  for field,record_key in select * from (values
    ('meal','ai-fitness-diet-meal-log'),('lunchCarb','ai-fitness-lunch-carb-choice'),('dinnerCarb','ai-fitness-dinner-carb-choice'),
    ('supplement','ai-fitness-lunch-protein-choice'),('proteinTotal','ai-fitness-protein-total'),('social','ai-fitness-social-meal-mode')) mapping loop
    records := public.assistant_diet_store(p_state,record_key);
    if records ? p_day::text then
      entry := records->p_day::text;
      if (field='meal' and jsonb_typeof(entry)<>'object')
        or (field in ('lunchCarb','dinnerCarb','supplement') and jsonb_typeof(entry) not in ('object','number','string'))
        or (field='social' and (jsonb_typeof(entry)<>'string' or entry#>>'{}' not in ('none','lunch','dinner','all-day','travel'))) then
        raise exception '오늘 식단 기록을 확인하지 못했습니다. 식단 화면에서 확인해 주세요.';
      end if;
      if field='proteinTotal' or jsonb_typeof(entry)='number' then
        if jsonb_typeof(entry)<>'number' then raise exception '오늘 식단 수치를 확인하지 못했습니다.'; end if;
        if (entry::text)::numeric<0 or (entry::text)::numeric>100000 then raise exception '오늘 식단 수치를 확인하지 못했습니다.'; end if;
      end if;
      result := result||jsonb_build_object(field,entry);
    end if;
  end loop;
  return result;
end;
$$;

create function public.assistant_diet_shake_grams(p_value jsonb)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
begin
  if p_value is null or p_value='"none"' then return 0; end if;
  if p_value='"half"' then return 16; end if;
  if p_value='"full"' then return 31; end if;
  raise exception '기존 끼니별 식단 수치나 합계를 확인하지 못했습니다. 식단 화면에서 확인한 뒤 다시 말씀해 주세요.';
end;
$$;
create function public.assistant_diet_food_grams(p_meal jsonb,p_slot text)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare choice jsonb := p_meal->(p_slot||'ProteinChoice'); custom_value jsonb := p_meal->(p_slot||'ProteinCustom');
begin
  if choice is null or choice='"none"' then return 0; end if;
  if choice in ('"20"','"25"','"30"') then return (choice#>>'{}')::numeric; end if;
  if choice='"custom"' and jsonb_typeof(custom_value)='number' then
    if (custom_value::text)::numeric between 0 and 100000 then return (custom_value::text)::numeric; end if;
  end if;
  raise exception '기존 끼니별 식단 수치나 합계를 확인하지 못했습니다. 식단 화면에서 확인한 뒤 다시 말씀해 주세요.';
end;
$$;
create function public.assistant_diet_supplement_grams(p_value jsonb)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare custom_value jsonb;
begin
  if p_value is null then return 0; end if;
  if jsonb_typeof(p_value)='string' then return public.assistant_diet_shake_grams(p_value); end if;
  if jsonb_typeof(p_value)='number' then custom_value := p_value;
  elsif jsonb_typeof(p_value)='object' then
    if p_value->>'type'='custom' then custom_value := coalesce(nullif(p_value->'customProtein','null'::jsonb),p_value->'protein');
    else return public.assistant_diet_shake_grams(p_value->'type'); end if;
  end if;
  if jsonb_typeof(custom_value)='number' then
    if (custom_value::text)::numeric between 0 and 100000 then return floor((custom_value::text)::numeric); end if;
  end if;
  raise exception '기존 끼니별 식단 수치나 합계를 확인하지 못했습니다. 식단 화면에서 확인한 뒤 다시 말씀해 주세요.';
end;
$$;
create function public.assistant_diet_recorded_protein(p_values jsonb)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare meal jsonb := coalesce(p_values->'meal','{}');
begin
  if meal ? 'breakfastShake' and jsonb_typeof(meal->'breakfastShake')<>'boolean' then
    raise exception '기존 끼니별 식단 수치나 합계를 확인하지 못했습니다. 식단 화면에서 확인한 뒤 다시 말씀해 주세요.';
  end if;
  return (case when meal->'breakfastShake'='true' then 31 else 0 end)
    +public.assistant_diet_shake_grams(meal->'afternoonShake')+public.assistant_diet_shake_grams(meal->'afterDinnerShake')
    +public.assistant_diet_food_grams(meal,'lunch')+public.assistant_diet_food_grams(meal,'dinner')
    +public.assistant_diet_supplement_grams(p_values->'supplement');
end;
$$;

create function public.assistant_diet_meal_next(p_before jsonb,p_change jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  slot text := p_change->>'slot'; field text := p_change->>'field'; grams numeric;
  meal jsonb := coalesce(p_before->'meal','{}'); entry jsonb := coalesce(p_before->'record','{}');
  old_total numeric; total numeric; stored_total jsonb; carb_key text; carb jsonb; next_values jsonb;
begin
  if p_change is null or jsonb_typeof(p_change)<>'object' or p_change->>'kind' is distinct from 'meal'
    or (p_change-'kind'-'slot'-'field'-'grams')<>'{}'
    or slot is null or slot not in ('lunch','dinner') or field is null or field not in ('protein','rice')
    or jsonb_typeof(p_change->'grams') is distinct from 'number' then raise exception '끼니별 단백질 또는 조리된 밥량을 다시 확인해 주세요.'; end if;
  grams := (p_change->>'grams')::numeric;
  if grams<0 or grams>(case when field='protein' then 100 else 1000 end) or trunc(grams)<>grams then
    raise exception '식품 단백질은 0~100g, 조리된 밥량은 0~1,000g 사이의 정수로 입력해 주세요.';
  end if;
  if field='protein' then
    old_total := public.assistant_diet_recorded_protein(p_before);
    foreach stored_total in array array[p_before->'proteinTotal',entry->'proteinTotal'] loop
      if stored_total is not null then
        if jsonb_typeof(stored_total)<>'number' then raise exception '기존 끼니별 식단 수치나 합계를 확인하지 못했습니다. 식단 화면에서 확인한 뒤 다시 말씀해 주세요.'; end if;
        if abs((stored_total::text)::numeric-old_total)>0.000001 then raise exception '기존 끼니별 식단 수치나 합계를 확인하지 못했습니다. 식단 화면에서 확인한 뒤 다시 말씀해 주세요.'; end if;
      end if;
    end loop;
    meal := meal||jsonb_build_object(slot||'ProteinChoice',case when grams=0 then 'none' else 'custom' end,slot||'ProteinCustom',grams);
    total := public.assistant_diet_recorded_protein(p_before||jsonb_build_object('meal',meal));
    entry := entry||jsonb_build_object('proteinTotal',total,'proteinDone',total>=100);
    if slot='lunch' then entry := entry||jsonb_build_object('lunchProtein',grams>0 or public.assistant_diet_supplement_grams(p_before->'supplement')>0); end if;
    return p_before||jsonb_build_object('meal',meal,'record',entry,'proteinTotal',total);
  end if;
  carb_key := case when slot='lunch' then 'lunchCarb' else 'dinnerCarb' end;
  carb := case when jsonb_typeof(p_before->carb_key)='object' then p_before->carb_key else '{}'::jsonb end;
  if carb ? 'riceType' and (jsonb_typeof(carb->'riceType')<>'string' or carb->>'riceType' not in ('흰쌀밥','잡곡밥','현미밥','통곡물밥','곤약밥','기타')) then
    raise exception '기존 끼니별 식단 수치나 합계를 확인하지 못했습니다. 식단 화면에서 확인한 뒤 다시 말씀해 주세요.';
  end if;
  if not(carb ? 'riceType') then carb := carb||jsonb_build_object('riceType','기타','customRiceType','종류 미기록'); end if;
  carb := carb||jsonb_build_object('amountType',case when grams=0 then 'none' else 'custom' end,'grams',grams,'estimatedCarbs',round(grams*0.3));
  meal := meal||case when slot='lunch' then jsonb_build_object('lunchRice',grams>0) else jsonb_build_object('dinnerCarb',carb->'amountType') end;
  next_values := p_before||jsonb_build_object('meal',meal,carb_key,carb);
  if slot='dinner' then next_values := next_values||jsonb_build_object('record',entry||jsonb_build_object('noDinnerCarbs',grams=0 or grams between 50 and 80)); end if;
  return next_values;
end;
$$;

create function public.apply_assistant_diet_meal_command(
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
  perform public.assistant_diet_meal_next(p_expected,p_change);
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
  current_values := public.assistant_diet_meal_snapshot(current_state,p_day);
  if current_values is distinct from p_expected then raise exception '다른 곳에서 오늘 식단 기록이 변경되었습니다. 명령을 다시 입력해 주세요.'; end if;
  next_values := public.assistant_diet_meal_next(current_values,p_change);
  for field,record_key in select * from (values ('record','ai-fitness-diet-completed-days'),('meal','ai-fitness-diet-meal-log'),
    ('lunchCarb','ai-fitness-lunch-carb-choice'),('dinnerCarb','ai-fitness-dinner-carb-choice'),('proteinTotal','ai-fitness-protein-total')) mapping loop
    if p_change->>'field'='protein' and field not in ('record','meal','proteinTotal') then continue; end if;
    if p_change->>'field'='rice' and field not in ('meal',case when p_change->>'slot'='lunch' then 'lunchCarb' else 'dinnerCarb' end,case when p_change->>'slot'='dinner' then 'record' else 'meal' end) then continue; end if;
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
  if (case when receipt.change->>'kind'='meal' then public.assistant_diet_meal_snapshot(current_state,receipt.record_date) else public.assistant_diet_snapshot(current_state,receipt.record_date) end) is distinct from receipt.after_values then raise exception '이후에 오늘 식단 기록이 변경되었습니다. 새 기록을 보호하기 위해 되돌리지 않았습니다.'; end if;
  for field,record_key in select * from (values ('record','ai-fitness-diet-completed-days'),('water','ai-fitness-water-intake'),('meal','ai-fitness-diet-meal-log'),('lunchCarb','ai-fitness-lunch-carb-choice'),('dinnerCarb','ai-fitness-dinner-carb-choice'),('proteinTotal','ai-fitness-protein-total')) mapping loop
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

revoke all on function public.assistant_diet_meal_snapshot(jsonb,date) from public,anon;
grant execute on function public.assistant_diet_meal_snapshot(jsonb,date) to authenticated;
revoke all on function public.assistant_diet_shake_grams(jsonb) from public,anon;
grant execute on function public.assistant_diet_shake_grams(jsonb) to authenticated;
revoke all on function public.assistant_diet_food_grams(jsonb,text) from public,anon;
grant execute on function public.assistant_diet_food_grams(jsonb,text) to authenticated;
revoke all on function public.assistant_diet_supplement_grams(jsonb) from public,anon;
grant execute on function public.assistant_diet_supplement_grams(jsonb) to authenticated;
revoke all on function public.assistant_diet_recorded_protein(jsonb) from public,anon;
grant execute on function public.assistant_diet_recorded_protein(jsonb) to authenticated;
revoke all on function public.assistant_diet_meal_next(jsonb,jsonb) from public,anon;
grant execute on function public.assistant_diet_meal_next(jsonb,jsonb) to authenticated;
revoke all on function public.apply_assistant_diet_meal_command(uuid,date,jsonb,jsonb,jsonb,timestamptz) from public,anon;
grant execute on function public.apply_assistant_diet_meal_command(uuid,date,jsonb,jsonb,jsonb,timestamptz) to authenticated;
