-- Additive, routine-only immutable save. No existing records, RLS, table grants,
-- or reset definitions change. Older direct INSERT clients remain unfenced.
create function public.save_routine_session(p_payload jsonb, p_expected_owner uuid, p_expected_reset_marker text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid(); current_marker text; field text; mode text;
  wanted public.growth_sessions; existing public.growth_sessions;
  columns text[] := array['id','user_id','routine_id','session_date','status','planned_minutes','actual_minutes','memo','source','metrics','started_at','ended_at','updated_at'];
  metrics jsonb;
begin
  if owner_id is null or p_expected_owner is distinct from owner_id then
    raise exception 'routine_owner_changed' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>12000
    or not (p_payload ?& columns) or (p_payload-columns)<>'{}'::jsonb or length(p_expected_reset_marker)>200 then
    raise exception 'routine_invalid_payload' using errcode='22023';
  end if;
  if jsonb_typeof(p_payload->'user_id') is distinct from 'string' or p_payload->>'user_id' is distinct from owner_id::text then
    raise exception 'routine_owner_changed' using errcode='42501';
  end if;
  foreach field in array array['id','routine_id','session_date','status','memo','source','updated_at'] loop
    if jsonb_typeof(p_payload->field) is distinct from 'string' then
      raise exception 'routine_invalid_payload' using errcode='22023';
    end if;
  end loop;
  if p_payload->>'id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or p_payload->>'routine_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or p_payload->>'session_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_payload->>'source'<>'manual' or p_payload->>'status' not in ('completed','partial','stopped')
    or char_length(p_payload->>'memo')>500 then
    raise exception 'routine_invalid_payload' using errcode='22023';
  end if;
  foreach field in array array['planned_minutes','actual_minutes'] loop
    if jsonb_typeof(p_payload->field) is distinct from 'number' or p_payload->>field !~ '^[0-9]+$' then
      raise exception 'routine_invalid_payload' using errcode='22023';
    end if;
  end loop;
  if (p_payload->>'planned_minutes')::numeric not between 0 and 240 or (p_payload->>'actual_minutes')::numeric not between 0 and 1440 then
    raise exception 'routine_invalid_payload' using errcode='22023';
  end if;
  metrics:=p_payload->'metrics'; mode:=metrics->>'recordMode';
  if jsonb_typeof(metrics) is distinct from 'object'
    or not (metrics ?& array['recordMode','actualMinutesRecorded'])
    or (metrics-array['recordMode','actualMinutesRecorded','routineDifficulty','stopReason'])<>'{}'::jsonb
    or jsonb_typeof(metrics->'recordMode') is distinct from 'string' or mode not in ('active','manual','quick')
    or jsonb_typeof(metrics->'actualMinutesRecorded') is distinct from 'boolean' then
    raise exception 'routine_invalid_payload' using errcode='22023';
  end if;
  if metrics ? 'routineDifficulty' then
    if p_payload->>'status'<>'completed' or jsonb_typeof(metrics->'routineDifficulty') is distinct from 'string'
      or metrics->>'routineDifficulty' not in ('too_easy','appropriate','difficult') then
      raise exception 'routine_invalid_payload' using errcode='22023';
    end if;
  end if;
  if metrics ? 'stopReason' then
    if p_payload->>'status'='completed' or jsonb_typeof(metrics->'stopReason') is distinct from 'string'
      or metrics->>'stopReason' not in ('unrecorded','time','tired','difficult','distracted','interrupted','illness','forgot','no_motivation') then
      raise exception 'routine_invalid_payload' using errcode='22023';
    end if;
  end if;
  if mode='quick' then
    if metrics->'actualMinutesRecorded'<>'false'::jsonb or metrics-array['recordMode','actualMinutesRecorded']<>'{}'::jsonb
      or p_payload->>'status'<>'completed' or (p_payload->>'actual_minutes')::numeric<>0 then
      raise exception 'routine_invalid_payload' using errcode='22023';
    end if;
  elsif metrics->'actualMinutesRecorded'<>'true'::jsonb or (p_payload->>'status'<>'completed' and not (metrics ? 'stopReason')) then
    raise exception 'routine_invalid_payload' using errcode='22023';
  end if;
  if mode='active' then
    foreach field in array array['started_at','ended_at'] loop
      if jsonb_typeof(p_payload->field) is distinct from 'string'
        or p_payload->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception 'routine_invalid_payload' using errcode='22023';
      end if;
    end loop;
  elsif p_payload->'started_at'<>'null'::jsonb or p_payload->'ended_at'<>'null'::jsonb then
    raise exception 'routine_invalid_payload' using errcode='22023';
  end if;
  if p_payload->>'updated_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'routine_invalid_payload' using errcode='22023';
  end if;
  begin
    wanted:=jsonb_populate_record(null::public.growth_sessions,p_payload);
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'routine_invalid_payload' using errcode='22023';
  end;
  if not isfinite(wanted.session_date) or not isfinite(wanted.updated_at)
    or to_char(wanted.session_date,'YYYY-MM-DD')<>p_payload->>'session_date'
    or (mode='active' and (not isfinite(wanted.started_at) or not isfinite(wanted.ended_at)
      or wanted.ended_at<wanted.started_at or extract(epoch from wanted.ended_at-wanted.started_at)>86400 or wanted.updated_at<>wanted.ended_at
      or round(extract(epoch from wanted.ended_at-wanted.started_at)/60)<>wanted.actual_minutes)) then
    raise exception 'routine_invalid_payload' using errcode='22023';
  end if;
  -- Same transaction lock as reset_my_app_records; generation checked AFTER lock.
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:'||owner_id::text,0));
  select state->>'ai-fitness-record-reset-growth' into current_marker from public.user_app_state where user_id=owner_id;
  if current_marker is distinct from p_expected_reset_marker then
    raise exception 'routine_reset_changed' using errcode='40001';
  end if;
  perform 1 from public.growth_routines where id=wanted.routine_id and user_id=owner_id for share;
  if not found then raise exception 'routine_routine_invalid' using errcode='42501'; end if;
  select * into existing from public.growth_sessions where id=wanted.id for share;
  if found then
    if row(existing.id,existing.user_id,existing.routine_id,existing.session_date,existing.status,existing.planned_minutes,existing.actual_minutes,existing.memo,existing.source,existing.metrics,existing.started_at,existing.ended_at,existing.updated_at)
      is distinct from row(wanted.id,wanted.user_id,wanted.routine_id,wanted.session_date,wanted.status,wanted.planned_minutes,wanted.actual_minutes,wanted.memo,wanted.source,wanted.metrics,wanted.started_at,wanted.ended_at,wanted.updated_at) then
      raise exception 'routine_save_conflict' using errcode='23505';
    end if;
    return;
  end if;
  insert into public.growth_sessions(id,user_id,routine_id,session_date,status,planned_minutes,actual_minutes,memo,source,metrics,started_at,ended_at,updated_at)
    values(wanted.id,wanted.user_id,wanted.routine_id,wanted.session_date,wanted.status,wanted.planned_minutes,wanted.actual_minutes,wanted.memo,wanted.source,wanted.metrics,wanted.started_at,wanted.ended_at,wanted.updated_at);
end;
$$;
revoke all on function public.save_routine_session(jsonb,uuid,text) from public,anon;
grant execute on function public.save_routine_session(jsonb,uuid,text) to authenticated;
