-- Additive sentence-typing save boundary. Installation changes no records,
-- policies, table privileges, or existing reset functions. Legacy direct INSERT
-- clients are unchanged and do not acquire this generation fence.
create function public.save_sentence_typing_session(
  p_payload jsonb,
  p_expected_owner uuid,
  p_expected_reset_marker text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  current_reset_marker text;
  field text;
  started timestamptz;
  ended timestamptz;
  updated timestamptz;
begin
  if owner_id is null or p_expected_owner is distinct from owner_id then
    raise exception 'typing_owner_changed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'typing_invalid_payload' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'user_id') is distinct from 'string'
    or lower(p_payload->>'user_id') is distinct from owner_id::text then
    raise exception 'typing_owner_changed' using errcode = '42501';
  end if;

  -- The whole frozen payload must be explicit; no omitted fields are silently
  -- defaulted and no client-supplied extra columns reach the INSERT.
  if not (p_payload ?& array[
      'id','user_id','routine_id','session_date','status','planned_minutes',
      'actual_minutes','memo','source','metrics','started_at','ended_at','updated_at'
    ]) or (p_payload - array[
      'id','user_id','routine_id','session_date','status','planned_minutes',
      'actual_minutes','memo','source','metrics','started_at','ended_at','updated_at'
    ]) <> '{}'::jsonb
    or length(p_expected_reset_marker) > 200 then
    raise exception 'typing_invalid_payload' using errcode = '22023';
  end if;
  foreach field in array array[
    'id','routine_id','session_date','status','memo','source','started_at','ended_at','updated_at'
  ] loop
    if jsonb_typeof(p_payload->field) is distinct from 'string' then
      raise exception 'typing_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  if p_payload->>'source' <> 'typing'
    or p_payload->>'status' not in ('partial','completed')
    or p_payload->>'session_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or char_length(p_payload->>'memo') > 500
    or jsonb_typeof(p_payload->'planned_minutes') is distinct from 'number'
    or p_payload->>'planned_minutes' !~ '^[0-9]+$'
    or jsonb_typeof(p_payload->'actual_minutes') is distinct from 'number'
    or p_payload->>'actual_minutes' !~ '^[0-9]+$'
    or jsonb_typeof(p_payload->'metrics') is distinct from 'object'
    or octet_length((p_payload->'metrics')::text) > 4000 then
    raise exception 'typing_invalid_payload' using errcode = '22023';
  end if;
  if (p_payload->>'planned_minutes')::numeric not between 0 and 240
    or (p_payload->>'actual_minutes')::numeric not between 0 and 1440 then
    raise exception 'typing_invalid_payload' using errcode = '22023';
  end if;
  foreach field in array array['started_at','ended_at','updated_at'] loop
    if p_payload->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'typing_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  started := (p_payload->>'started_at')::timestamptz;
  ended := (p_payload->>'ended_at')::timestamptz;
  updated := (p_payload->>'updated_at')::timestamptz;
  if not isfinite(started) or not isfinite(ended) or not isfinite(updated)
    or ended < started or updated is distinct from ended then
    raise exception 'typing_invalid_payload' using errcode = '22023';
  end if;

  -- Same per-owner transaction lock as reset_my_app_records. Under the RPC's
  -- normal READ COMMITTED isolation, check the generation after acquiring it.
  -- save -> reset deletes this row; reset -> stale save rejects this INSERT.
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:' || auth.uid()::text, 0));
  select state->>'ai-fitness-record-reset-growth' into current_reset_marker
    from public.user_app_state where user_id = owner_id;
  if current_reset_marker is distinct from p_expected_reset_marker then
    raise exception 'typing_reset_changed' using errcode = '40001';
  end if;

  -- Intentionally plain INSERT: a duplicate ID never mutates an existing row.
  -- The caller must independently read back and compare the frozen payload.
  -- SECURITY INVOKER keeps the existing owner and routine-link RLS checks.
  insert into public.growth_sessions (
    id,user_id,routine_id,session_date,status,planned_minutes,actual_minutes,
    memo,source,metrics,started_at,ended_at,updated_at
  ) values (
    (p_payload->>'id')::uuid,(p_payload->>'user_id')::uuid,
    (p_payload->>'routine_id')::uuid,(p_payload->>'session_date')::date,
    p_payload->>'status',(p_payload->>'planned_minutes')::integer,
    (p_payload->>'actual_minutes')::integer,p_payload->>'memo',
    p_payload->>'source',p_payload->'metrics',started,ended,updated
  );
end;
$$;

revoke all on function public.save_sentence_typing_session(jsonb, uuid, text) from public, anon;
grant execute on function public.save_sentence_typing_session(jsonb, uuid, text) to authenticated;
