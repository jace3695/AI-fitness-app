-- Additive RPC hardening for explicit routine progression. No stored rows,
-- tables, columns, RLS policies, or grants are expanded. Apply before enabling
-- evidence-backed progression; browser preflight alone is not atomic.
create or replace function public.decide_growth_review(p_review_id uuid, p_selection jsonb, p_expected_routines jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  review public.growth_ai_reviews;
  routine public.growth_routines;
  suggestion jsonb;
  target_id uuid;
  next_minutes integer;
  choice_count integer;
  chosen_count integer := 0;
  changed_ids uuid[] := '{}';
  evidence jsonb;
  evidence_ids uuid[];
  evidence_dates date[];
  matched_dates date[];
  matched_count integer;
  today_seoul date := (current_timestamp at time zone 'Asia/Seoul')::date;
begin
  if owner_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_selection is null or jsonb_typeof(p_selection) <> 'array' or jsonb_array_length(p_selection)>6 then raise exception '선택한 제안을 확인해 주세요.'; end if;
  choice_count := jsonb_array_length(p_selection);
  if (select count(distinct value) from jsonb_array_elements_text(p_selection)) <> choice_count then raise exception '중복된 선택입니다.'; end if;
  -- Match reset_my_app_records/save_sentence_typing_session before taking row
  -- locks, so a record reset cannot interleave with the decision transaction.
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:' || owner_id::text, 0));
  select * into review from public.growth_ai_reviews where id=p_review_id and user_id=owner_id for update;
  if not found then raise exception '코칭을 찾을 수 없습니다.'; end if;
  if review.decision is not null then
    if review.decision_selection @> p_selection and p_selection @> review.decision_selection then return to_jsonb(review); end if;
    raise exception '이미 결정한 코칭입니다. 다시 불러와 주세요.';
  end if;
  -- Lock routines in stable order, including overlapping selections from another review.
  perform 1 from public.growth_routines where user_id=owner_id and id in
    (select (value->>'routineId')::uuid from jsonb_array_elements(review.suggestions) where p_selection ? (value->>'id'))
    order by id for update;
  -- Only new evidence-backed entries need session locks. Lock all sessions of
  -- those routines, including older rows that could be moved into the window.
  -- The existing routine FOR UPDATE locks also exclude new FK-linked inserts.
  -- A direct edit may hold a session lock first; fail closed rather than wait
  -- in the opposite order. No decision/target write has happened yet.
  begin
    perform 1 from public.growth_sessions where user_id=owner_id and routine_id in
      (select (value->>'routineId')::uuid from jsonb_array_elements(review.suggestions)
        where p_selection ? (value->>'id') and (value ? 'progression' or value->>'id' like 'local-next-step-%'))
      order by id for share nowait;
  exception when lock_not_available then
    raise exception '기록이 다른 화면에서 변경 중이에요. 최신 기록을 다시 불러온 뒤 적용해 주세요.' using errcode='40001';
  end;
  for suggestion in select value from jsonb_array_elements(review.suggestions) where p_selection ? (value->>'id') loop
    target_id := (suggestion->>'routineId')::uuid;
    next_minutes := (suggestion->>'recommendedMinutes')::integer;
    if target_id is null or next_minutes is null or next_minutes not between 5 and 240 or target_id = any(changed_ids) then
      raise exception '적용할 루틴과 시간을 확인해 주세요.';
    end if;
    select * into routine from public.growth_routines where id=target_id and user_id=owner_id and enabled;
    if not found then raise exception '사용할 수 없는 루틴입니다. 다시 불러와 주세요.'; end if;
    if p_expected_routines->>target_id::text is null or routine.updated_at is distinct from (p_expected_routines->>target_id::text)::timestamptz then
      raise exception '루틴이 변경되었습니다. 최신 내용을 확인한 뒤 적용해 주세요.';
    end if;
    -- Legacy reviews retain their previous semantics. New progression entries
    -- must carry the original preview's exact evidence; the client cannot
    -- replace missing sessions with other recent completions.
    if suggestion ? 'progression' or suggestion->>'id' like 'local-next-step-%' then
      evidence := suggestion->'progression';
      if jsonb_typeof(evidence) is distinct from 'object'
        or jsonb_typeof(evidence->'targetMinutes') is distinct from 'number'
        or jsonb_typeof(evidence->'routineUpdatedAt') is distinct from 'string'
        or jsonb_typeof(evidence->'dates') is distinct from 'array'
        or jsonb_typeof(evidence->'sessionIds') is distinct from 'array' then
        raise exception '제안의 근거 형식을 확인하지 못했어요. 새로 분석해 주세요.' using errcode='22023';
      end if;
      if jsonb_array_length(evidence->'dates') < 3 or jsonb_array_length(evidence->'sessionIds') < 3
        or exists(select 1 from jsonb_array_elements(evidence->'dates') value
          where jsonb_typeof(value) <> 'string' or value#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        or exists(select 1 from jsonb_array_elements(evidence->'sessionIds') value
          where jsonb_typeof(value) <> 'string' or value#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
        raise exception '제안의 근거 형식을 확인하지 못했어요. 새로 분석해 주세요.' using errcode='22023';
      end if;
      begin
        select array_agg(value::uuid order by value::uuid) into evidence_ids from jsonb_array_elements_text(evidence->'sessionIds');
        select array_agg(value::date order by value::date) into evidence_dates from jsonb_array_elements_text(evidence->'dates');
        if (evidence->>'targetMinutes')::numeric is distinct from routine.target_minutes
          or (evidence->>'routineUpdatedAt')::timestamptz is distinct from routine.updated_at
          or routine.target_minutes >= 240 or next_minutes <> least(240,routine.target_minutes+5) then
          raise exception '제안의 현재 목표가 달라졌어요. 새로 분석한 뒤 확인해 주세요.' using errcode='40001';
        end if;
      exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
        raise exception '제안의 근거 형식을 확인하지 못했어요. 새로 분석해 주세요.' using errcode='22023';
      end;
      if cardinality(evidence_ids) <> (select count(distinct id) from unnest(evidence_ids) id)
        or cardinality(evidence_dates) <> (select count(distinct day) from unnest(evidence_dates) day)
        or exists(select 1 from unnest(evidence_dates) day where day < today_seoul-13 or day > today_seoul) then
        raise exception '제안의 근거 날짜가 달라졌어요. 새로 분석한 뒤 확인해 주세요.' using errcode='40001';
      end if;
      select count(*), array_agg(distinct session_date order by session_date) into matched_count,matched_dates
        from public.growth_sessions
        where user_id=owner_id and routine_id=target_id and id=any(evidence_ids)
          and status='completed' and planned_minutes=routine.target_minutes and actual_minutes>=routine.target_minutes
          and metrics->>'routineDifficulty'='too_easy'
          and session_date between today_seoul-13 and today_seoul;
      if matched_count <> cardinality(evidence_ids) or matched_dates is distinct from evidence_dates
        or exists(select 1 from public.growth_sessions where user_id=owner_id and routine_id=target_id
          and session_date between today_seoul-13 and today_seoul
          and (status<>'completed' or (planned_minutes=routine.target_minutes and metrics->>'routineDifficulty' in ('appropriate','difficult')))) then
        raise exception '제안의 근거나 현재 목표가 달라졌어요. 새로 분석한 뒤 확인해 주세요.' using errcode='40001';
      end if;
    end if;
    update public.growth_routines set target_minutes=next_minutes,updated_at=now() where id=target_id and user_id=owner_id;
    chosen_count := chosen_count+1;
    changed_ids := array_append(changed_ids,target_id);
  end loop;
  if chosen_count <> choice_count then raise exception '선택한 제안을 찾을 수 없습니다.'; end if;
  update public.growth_ai_reviews set decision=case when choice_count=0 then 'kept'
      when choice_count=jsonb_array_length(review.suggestions) then 'applied' else 'partial' end,
    decision_selection=p_selection, decided_at=now()
    where id=review.id and user_id=owner_id returning * into review;
  return to_jsonb(review);
end;
$$;
revoke all on function public.decide_growth_review(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.decide_growth_review(uuid,jsonb,jsonb) to authenticated;
