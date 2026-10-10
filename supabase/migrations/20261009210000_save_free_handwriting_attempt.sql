-- Additive free-handwriting boundary, separate from the lesson/course RPC.
-- Installation changes no existing rows, table grants, RLS, or reset behavior.
-- Private Storage uploads remain outside this transaction and are never deleted
-- by save failure or growth reset. Apply this migration before the new client.
create function public.save_free_handwriting_attempt(
  p_session jsonb,
  p_resource jsonb,
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
  metrics jsonb;
  pressure jsonb;
  wanted_session public.growth_sessions;
  wanted_resource public.growth_resources;
  existing_session public.growth_sessions;
  existing_resource public.growth_resources;
  session_exists boolean;
  resource_exists boolean;
  session_columns constant text[] := array[
    'id','user_id','routine_id','session_date','status','planned_minutes',
    'actual_minutes','memo','source','metrics','started_at','ended_at','updated_at'
  ];
  resource_columns constant text[] := array[
    'id','user_id','routine_id','title','category','storage_path','mime_type',
    'size_bytes','classification','notes','created_at','updated_at'
  ];
  metric_columns constant text[] := array[
    'practiceKind','resourceId','guideText','strokes','activeSeconds',
    'occupiedWidth','occupiedHeight','pressureRange','pngSha256'
  ];
begin
  if owner_id is null or p_expected_owner is distinct from owner_id then
    raise exception 'free_handwriting_owner_changed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_session) is distinct from 'object'
    or octet_length(p_session::text) > 12000
    or jsonb_typeof(p_resource) is distinct from 'object'
    or octet_length(p_resource::text) > 6000 then
    raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
  end if;
  if jsonb_typeof(p_session->'user_id') is distinct from 'string'
    or p_session->>'user_id' is distinct from owner_id::text
    or jsonb_typeof(p_resource->'user_id') is distinct from 'string'
    or p_resource->>'user_id' is distinct from owner_id::text then
    raise exception 'free_handwriting_owner_changed' using errcode = '42501';
  end if;
  if not (p_session ?& session_columns) or (p_session - session_columns) <> '{}'::jsonb
    or not (p_resource ?& resource_columns) or (p_resource - resource_columns) <> '{}'::jsonb
    or length(p_expected_reset_marker) > 200 then
    raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
  end if;
  foreach field in array array['id','routine_id','session_date','status','memo','source','updated_at'] loop
    if jsonb_typeof(p_session->field) is distinct from 'string' then
      raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  foreach field in array array['id','routine_id','title','category','storage_path','mime_type','classification','notes','created_at','updated_at'] loop
    if jsonb_typeof(p_resource->field) is distinct from 'string' then
      raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  if p_session->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_session->>'routine_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_resource->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_session->>'source' <> 'handwriting' or p_session->>'status' <> 'completed'
    or p_session->>'session_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or p_session->'started_at' is distinct from 'null'::jsonb
    or p_session->'ended_at' is distinct from 'null'::jsonb
    or p_session->>'updated_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-][0-9]{2}:[0-5][0-9])$'
    or p_resource->'routine_id' is distinct from p_session->'routine_id'
    or p_resource->>'title' <> '손글씨 연습 ' || (p_session->>'session_date')
    or p_resource->>'category' <> 'handwriting'
    or p_resource->>'storage_path' <> owner_id::text || '/' || (p_session->>'session_date') || '/free-handwriting-' || (p_resource->>'id') || '.png'
    or p_resource->>'mime_type' <> 'image/png' or p_resource->>'classification' <> 'direct'
    or p_resource->'notes' is distinct from p_session->'memo'
    or p_resource->'created_at' is distinct from p_session->'updated_at'
    or p_resource->'updated_at' is distinct from p_session->'updated_at' then
    raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
  end if;
  foreach field in array array['planned_minutes','actual_minutes'] loop
    if jsonb_typeof(p_session->field) is distinct from 'number'
      or p_session->>field !~ '^[0-9]+$' then
      raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  if (p_session->>'planned_minutes')::numeric not between 0 and 240
    or (p_session->>'actual_minutes')::numeric not between 0 and 1440
    or jsonb_typeof(p_resource->'size_bytes') is distinct from 'number'
    or p_resource->>'size_bytes' !~ '^[0-9]+$' then
    raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
  end if;
  if (p_resource->>'size_bytes')::numeric not between 1 and 10485760 then
    raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
  end if;
  metrics := p_session->'metrics';
  if jsonb_typeof(metrics) is distinct from 'object'
    or octet_length(metrics::text) > 4000 then
    raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
  end if;
  -- This closed shape deliberately forbids lesson/course completion evidence.
  if not (metrics ?& metric_columns) or (metrics - metric_columns) <> '{}'::jsonb
    or metrics->>'practiceKind' is distinct from 'free-handwriting-v1'
    or metrics->'resourceId' is distinct from p_resource->'id'
    or jsonb_typeof(metrics->'guideText') is distinct from 'string'
    or char_length(metrics->>'guideText') not between 1 and 300
    or metrics->'guideText' is distinct from p_session->'memo'
    or jsonb_typeof(metrics->'pngSha256') is distinct from 'string'
    or metrics->>'pngSha256' !~ '^[0-9a-f]{64}$' then
    raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
  end if;
  foreach field in array array['strokes','activeSeconds','occupiedWidth','occupiedHeight'] loop
    if jsonb_typeof(metrics->field) is distinct from 'number'
      or metrics->>field !~ '^[0-9]+$' then
      raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  if (metrics->>'strokes')::numeric not between 1 and 1000000
    or (metrics->>'activeSeconds')::numeric not between 0 and 86400
    or (metrics->>'occupiedWidth')::numeric not between 0 and 100
    or (metrics->>'occupiedHeight')::numeric not between 0 and 100
    or (p_session->>'actual_minutes')::numeric <> round((metrics->>'activeSeconds')::numeric / 60) then
    raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
  end if;
  pressure := metrics->'pressureRange';
  if pressure <> 'null'::jsonb then
    if jsonb_typeof(pressure) is distinct from 'array' then
      raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
    end if;
    if jsonb_array_length(pressure) <> 2
      or jsonb_typeof(pressure->0) is distinct from 'number'
      or jsonb_typeof(pressure->1) is distinct from 'number' then
      raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
    end if;
    if (pressure->>0)::numeric <= 0 or (pressure->>0)::numeric >= (pressure->>1)::numeric
      or (pressure->>1)::numeric > 1 then
      raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
    end if;
  end if;

  -- Shape/bounds precede casts; PostgreSQL rejects impossible dates/offsets.
  -- Replay compares timestamp instants after PostgreSQL normalization.
  begin
    wanted_session := jsonb_populate_record(null::public.growth_sessions, p_session);
    wanted_resource := jsonb_populate_record(null::public.growth_resources, p_resource);
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
    or sqlstate '22009' or numeric_value_out_of_range then
    raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
  end;
  if not isfinite(wanted_session.updated_at) or not isfinite(wanted_session.session_date)
    or not isfinite(wanted_resource.created_at) or not isfinite(wanted_resource.updated_at) then
    raise exception 'free_handwriting_invalid_payload' using errcode = '22023';
  end if;

  -- Same owner transaction lock as reset_my_app_records and the course RPC.
  -- Under READ COMMITTED, read the authoritative generation after locking and
  -- before replay or INSERT. Save -> reset removes sessions; stale save rejects.
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:' || owner_id::text, 0));
  select state->>'ai-fitness-record-reset-growth' into current_reset_marker
    from public.user_app_state where user_id=owner_id;
  if current_reset_marker is distinct from p_expected_reset_marker then
    raise exception 'free_handwriting_reset_changed' using errcode = '40001';
  end if;
  perform 1 from public.growth_routines
    where id=wanted_session.routine_id and user_id=owner_id and category='handwriting' for share;
  if not found then
    raise exception 'free_handwriting_routine_invalid' using errcode = '42501';
  end if;

  select * into existing_session from public.growth_sessions where id=wanted_session.id for share;
  session_exists := found;
  if session_exists and row(
    existing_session.id,existing_session.user_id,existing_session.routine_id,existing_session.session_date,
    existing_session.status,existing_session.planned_minutes,existing_session.actual_minutes,
    existing_session.memo,existing_session.source,existing_session.metrics,existing_session.started_at,
    existing_session.ended_at,existing_session.updated_at
  ) is distinct from row(
    wanted_session.id,wanted_session.user_id,wanted_session.routine_id,wanted_session.session_date,
    wanted_session.status,wanted_session.planned_minutes,wanted_session.actual_minutes,
    wanted_session.memo,wanted_session.source,wanted_session.metrics,wanted_session.started_at,
    wanted_session.ended_at,wanted_session.updated_at
  ) then
    raise exception 'free_handwriting_session_conflict' using errcode = '23505';
  end if;
  select * into existing_resource from public.growth_resources where id=wanted_resource.id for share;
  resource_exists := found;
  if resource_exists and row(
    existing_resource.id,existing_resource.user_id,existing_resource.routine_id,existing_resource.title,
    existing_resource.category,existing_resource.storage_path,existing_resource.mime_type,
    existing_resource.size_bytes,existing_resource.classification,existing_resource.notes,existing_resource.created_at,existing_resource.updated_at
  ) is distinct from row(
    wanted_resource.id,wanted_resource.user_id,wanted_resource.routine_id,wanted_resource.title,
    wanted_resource.category,wanted_resource.storage_path,wanted_resource.mime_type,
    wanted_resource.size_bytes,wanted_resource.classification,wanted_resource.notes,wanted_resource.created_at,wanted_resource.updated_at
  ) then
    raise exception 'free_handwriting_resource_conflict' using errcode = '23505';
  end if;
  if exists(select 1 from public.growth_resources where storage_path=wanted_resource.storage_path and id<>wanted_resource.id)
    or exists(select 1 from public.growth_sessions linked
      where linked.user_id=owner_id and linked.source='handwriting' and linked.id<>wanted_session.id
        and linked.metrics->>'resourceId'=wanted_resource.id::text) then
    raise exception 'free_handwriting_resource_conflict' using errcode = '23505';
  end if;
  if session_exists and not resource_exists then
    raise exception 'free_handwriting_resource_missing' using errcode = '23503';
  end if;
  -- Exact replay never UPDATEs either row, preserving non-requested fields.
  -- A matching resource-only partial attempt may finish its original session.
  if session_exists then return; end if;
  if not resource_exists then
    insert into public.growth_resources (
      id,user_id,routine_id,title,category,storage_path,mime_type,size_bytes,classification,notes,created_at,updated_at
    ) values (
      wanted_resource.id,wanted_resource.user_id,wanted_resource.routine_id,wanted_resource.title,
      wanted_resource.category,wanted_resource.storage_path,wanted_resource.mime_type,
      wanted_resource.size_bytes,wanted_resource.classification,wanted_resource.notes,wanted_resource.created_at,wanted_resource.updated_at
    );
  end if;
  insert into public.growth_sessions (
    id,user_id,routine_id,session_date,status,planned_minutes,actual_minutes,memo,source,metrics,started_at,ended_at,updated_at
  ) values (
    wanted_session.id,wanted_session.user_id,wanted_session.routine_id,wanted_session.session_date,
    wanted_session.status,wanted_session.planned_minutes,wanted_session.actual_minutes,
    wanted_session.memo,wanted_session.source,wanted_session.metrics,null,null,wanted_session.updated_at
  );
end;
$$;

revoke all on function public.save_free_handwriting_attempt(jsonb,jsonb,uuid,text) from public, anon;
grant execute on function public.save_free_handwriting_attempt(jsonb,jsonb,uuid,text) to authenticated;
