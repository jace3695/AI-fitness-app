-- Additive handwriting-only boundary. Installation does not change records,
-- tables, RLS, table grants, or reset behavior. Apply before the new client.
-- Storage uploads are outside this transaction: growth reset intentionally
-- preserves resources and private objects. Never delete them on save failure.
create function public.save_handwriting_attempt(
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
  lesson jsonb;
  worksheet jsonb;
  mode text;
  page integer;
  wanted_session public.growth_sessions;
  wanted_resource public.growth_resources;
  existing_session public.growth_sessions;
  existing_resource public.growth_resources;
  session_exists boolean;
  resource_exists boolean := false;
  session_columns constant text[] := array[
    'id','user_id','routine_id','session_date','status','planned_minutes',
    'actual_minutes','memo','source','metrics','started_at','ended_at','updated_at'
  ];
  resource_columns constant text[] := array[
    'id','user_id','routine_id','title','category','storage_path','mime_type',
    'size_bytes','classification','notes','created_at','updated_at'
  ];
  metric_columns text[] := array[
    'courseId','lessonId','pdfPage','lessonCompleted','mode','practiceMode',
    'selfChecks','lessonSnapshot','worksheet'
  ];
begin
  if owner_id is null or p_expected_owner is distinct from owner_id then
    raise exception 'handwriting_owner_changed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_session) is distinct from 'object'
    or octet_length(p_session::text) > 12000 then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  if jsonb_typeof(p_session->'user_id') is distinct from 'string'
    or p_session->>'user_id' is distinct from owner_id::text then
    raise exception 'handwriting_owner_changed' using errcode = '42501';
  end if;
  if not (p_session ?& session_columns) or (p_session - session_columns) <> '{}'::jsonb
    or length(p_expected_reset_marker) > 200 then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  foreach field in array array['id','routine_id','session_date','status','memo','source','updated_at'] loop
    if jsonb_typeof(p_session->field) is distinct from 'string' then
      raise exception 'handwriting_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  if p_session->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_session->>'routine_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_session->>'source' <> 'handwriting' or p_session->>'status' <> 'completed'
    or p_session->>'session_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or char_length(p_session->>'memo') > 500
    or p_session->'started_at' is distinct from 'null'::jsonb
    or p_session->'ended_at' is distinct from 'null'::jsonb
    or p_session->>'updated_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  foreach field in array array['planned_minutes','actual_minutes'] loop
    if jsonb_typeof(p_session->field) is distinct from 'number'
      or p_session->>field !~ '^[0-9]+$' then
      raise exception 'handwriting_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  if (p_session->>'planned_minutes')::numeric not between 0 and 240
    or (p_session->>'actual_minutes')::numeric not between 0 and 1440 then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  metrics := p_session->'metrics';
  -- Preserve the existing table's 4,000-byte metrics constraint. Snapshots hold
  -- wording and identity, not worksheet/image bytes or arbitrary extensions.
  if jsonb_typeof(metrics) is distinct from 'object' or octet_length(metrics::text) > 4000 then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  mode := metrics->>'mode';
  if mode is null or mode not in ('paper','screen') then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  metric_columns := metric_columns || case when mode='paper' then array['timeSource']
    else array['resourceId','strokes','activeSeconds','pngSha256'] end;
  if not (metrics ?& metric_columns) or (metrics - metric_columns) <> '{}'::jsonb
    or metrics->>'courseId' is distinct from 'film-handwriting-v1'
    or metrics->'lessonCompleted' is distinct from 'true'::jsonb
    or metrics->'selfChecks' is distinct from '[true,true]'::jsonb
    or jsonb_typeof(metrics->'pdfPage') is distinct from 'number'
    or metrics->>'pdfPage' !~ '^[0-9]+$'
    or jsonb_typeof(metrics->'lessonId') is distinct from 'string'
    or jsonb_typeof(metrics->'practiceMode') is distinct from 'string' then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  if (metrics->>'pdfPage')::numeric not between 2 and 54 then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  page := (metrics->>'pdfPage')::integer;
  if metrics->>'lessonId' <> 'film-p' || page::text then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  lesson := metrics->'lessonSnapshot';
  worksheet := metrics->'worksheet';
  if jsonb_typeof(lesson) is distinct from 'object'
    or jsonb_typeof(worksheet) is distinct from 'object' then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  if not (lesson ?& array['id','number','pdfPage','stage','title','goal','steps','checks'])
    or (lesson - array['id','number','pdfPage','stage','title','goal','steps','checks']) <> '{}'::jsonb
    or lesson->'id' is distinct from metrics->'lessonId'
    or lesson->'pdfPage' is distinct from metrics->'pdfPage'
    or lesson->'number' is distinct from to_jsonb(page-1)
    or jsonb_typeof(lesson->'steps') is distinct from 'array'
    or jsonb_typeof(lesson->'checks') is distinct from 'array'
    or not (worksheet ?& array['path','version','sha256'])
    or (worksheet - array['path','version','sha256']) <> '{}'::jsonb then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  foreach field in array array['stage','title','goal'] loop
    if jsonb_typeof(lesson->field) is distinct from 'string'
      or char_length(lesson->>field) not between 1 and 500 then
      raise exception 'handwriting_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(lesson->'steps') not between 1 and 12
    or jsonb_array_length(lesson->'checks') <> 2
    or exists(select 1 from jsonb_array_elements((lesson->'steps') || (lesson->'checks')) value
      where jsonb_typeof(value) <> 'string' or char_length(value#>>'{}') not between 1 and 500) then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;
  foreach field in array array['path','version','sha256'] loop
    if jsonb_typeof(worksheet->field) is distinct from 'string' then
      raise exception 'handwriting_invalid_payload' using errcode = '22023';
    end if;
  end loop;
  if worksheet->>'path' <> owner_id::text || '/learning/film-v1/page-' || lpad(page::text,2,'0') || '.webp'
    or char_length(worksheet->>'version') not between 1 and 100
    or worksheet->>'sha256' !~ '^[0-9a-f]{64}$' then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;

  if mode='paper' then
    if (p_resource is not null and p_resource <> 'null'::jsonb)
      or metrics->>'practiceMode' <> 'paper' or metrics->>'timeSource' is distinct from 'self-reported'
      or (p_session->>'actual_minutes')::numeric not between 1 and 240 then
      raise exception 'handwriting_invalid_payload' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(p_resource) is distinct from 'object' or octet_length(p_resource::text) > 6000 then
      raise exception 'handwriting_invalid_payload' using errcode = '22023';
    end if;
    if jsonb_typeof(p_resource->'user_id') is distinct from 'string'
      or p_resource->>'user_id' is distinct from owner_id::text then
      raise exception 'handwriting_owner_changed' using errcode = '42501';
    end if;
    if not (p_resource ?& resource_columns) or (p_resource - resource_columns) <> '{}'::jsonb
      or metrics->>'practiceMode' not in ('trace','copy') then
      raise exception 'handwriting_invalid_payload' using errcode = '22023';
    end if;
    foreach field in array array['id','routine_id','title','category','storage_path','mime_type','classification','notes','created_at','updated_at'] loop
      if jsonb_typeof(p_resource->field) is distinct from 'string' then
        raise exception 'handwriting_invalid_payload' using errcode = '22023';
      end if;
    end loop;
    foreach field in array array['strokes','activeSeconds'] loop
      if jsonb_typeof(metrics->field) is distinct from 'number' or metrics->>field !~ '^[0-9]+$' then
        raise exception 'handwriting_invalid_payload' using errcode = '22023';
      end if;
    end loop;
    if (metrics->>'strokes')::numeric not between 1 and 1000000
      or (metrics->>'activeSeconds')::numeric not between 0 and 86400
      or (p_session->>'actual_minutes')::numeric <> round((metrics->>'activeSeconds')::numeric / 60)
      or jsonb_typeof(metrics->'pngSha256') is distinct from 'string'
      or metrics->>'pngSha256' !~ '^[0-9a-f]{64}$'
      or metrics->'resourceId' is distinct from p_resource->'id'
      or p_resource->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or p_resource->'routine_id' is distinct from p_session->'routine_id'
      or char_length(p_resource->>'title') not between 1 and 120
      or p_resource->>'category' <> 'handwriting'
      or p_resource->>'storage_path' <> owner_id::text || '/' || (p_session->>'session_date') || '/handwriting-' || (p_resource->>'id') || '.png'
      or p_resource->>'mime_type' <> 'image/png' or p_resource->>'classification' <> 'direct'
      or char_length(p_resource->>'notes') > 500
      or jsonb_typeof(p_resource->'size_bytes') is distinct from 'number'
      or p_resource->>'size_bytes' !~ '^[0-9]+$'
      or p_resource->'updated_at' is distinct from p_resource->'created_at'
      or p_resource->>'created_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'handwriting_invalid_payload' using errcode = '22023';
    end if;
    if (p_resource->>'size_bytes')::numeric not between 1 and 10485760 then
      raise exception 'handwriting_invalid_payload' using errcode = '22023';
    end if;
  end if;

  -- Convert only after the exact shape and bounded values have been checked.
  -- Compare timestamps as instants, because PostgreSQL normalizes ISO spellings.
  begin
    wanted_session := jsonb_populate_record(null::public.growth_sessions, p_session);
    if mode='screen' then
      wanted_resource := jsonb_populate_record(null::public.growth_resources, p_resource);
    end if;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end;
  if not isfinite(wanted_session.updated_at) or not isfinite(wanted_session.session_date)
    or (mode='screen' and not isfinite(wanted_resource.created_at)) then
    raise exception 'handwriting_invalid_payload' using errcode = '22023';
  end if;

  -- Exact same owner transaction lock as reset_my_app_records. Under normal
  -- READ COMMITTED, generation is read after obtaining the lock, before replay
  -- or INSERT. Save -> reset removes sessions; reset -> stale save rejects.
  perform pg_advisory_xact_lock(hashtextextended('app-record-reset:' || owner_id::text, 0));
  select state->>'ai-fitness-record-reset-growth' into current_reset_marker
    from public.user_app_state where user_id=owner_id;
  if current_reset_marker is distinct from p_expected_reset_marker then
    raise exception 'handwriting_reset_changed' using errcode = '40001';
  end if;
  perform 1 from public.growth_routines
    where id=wanted_session.routine_id and user_id=owner_id and category='handwriting' for share;
  if not found then
    raise exception 'handwriting_routine_invalid' using errcode = '42501';
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
    raise exception 'handwriting_session_conflict' using errcode = '23505';
  end if;
  if mode='screen' then
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
      raise exception 'handwriting_resource_conflict' using errcode = '23505';
    end if;
    if exists(select 1 from public.growth_resources where storage_path=wanted_resource.storage_path and id<>wanted_resource.id) then
      raise exception 'handwriting_resource_conflict' using errcode = '23505';
    end if;
    -- An existing image may finish only its own attempt. Reusing it with a
    -- different session UUID must not turn replay into a duplicate completion.
    if exists(select 1 from public.growth_sessions linked
      where linked.user_id=owner_id and linked.source='handwriting' and linked.id<>wanted_session.id
        and linked.metrics->>'resourceId'=wanted_resource.id::text) then
      raise exception 'handwriting_resource_conflict' using errcode = '23505';
    end if;
    if session_exists and not resource_exists then
      raise exception 'handwriting_resource_missing' using errcode = '23503';
    end if;
  end if;
  -- Exact replay is a no-op. A resource-only partial attempt may finish with
  -- the same immutable metadata. Never UPDATE/upsert either existing row.
  if session_exists then return; end if;
  if mode='screen' and not resource_exists then
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

revoke all on function public.save_handwriting_attempt(jsonb,jsonb,uuid,text) from public, anon;
grant execute on function public.save_handwriting_attempt(jsonb,jsonb,uuid,text) to authenticated;
