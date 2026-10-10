-- P3 LOCAL CANDIDATE ONLY. Do not apply to hosted/shared databases without approval.
-- Additive append-only preparation drafts. Existing P1/P2 and legacy state are untouched.
-- The source manifest is an exact version vector, not a cryptographic authenticity proof.

create function public.language_live_preparation_is_valid(p_payload jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
  p jsonb; s jsonb; r jsonb; e jsonb; f jsonb; seen jsonb; seen_events jsonb; key text;
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  input_keys text[]:=array['requestId','preparationId','expectedRevision','preparation','editedText','reviewed'];
  prep_keys text[]:=array['templateVersion','policyVersion','forDate','timezone','maxItems','source','references','selected','warnings','generatedText'];
  field_keys text[]:=array['lessonDate','topic','stage','kana','vocabulary','grammar','expressions','listening','speaking','reading','writing','errors','corrections','recurringDifficulties','confidentContent','reviewNeeds','nextLessonRecommendations','aiAssessmentNotes','previousReviewResults','forgettingObservations','relearningActivities','reassessments','stateChanges','nextReviewRecommendations','evidenceAndUncertainty'];
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4000000 or
    not(p_payload ?& input_keys) or p_payload-input_keys<>'{}'::jsonb then return false; end if;
  if coalesce(p_payload->>'requestId','') !~ uuid_pattern or coalesce(p_payload->>'preparationId','') !~ uuid_pattern or
    jsonb_typeof(p_payload->'expectedRevision') is distinct from 'number' or (p_payload->>'expectedRevision') !~ '^[0-9]+$' or (p_payload->>'expectedRevision')::numeric not between 0 and 2147483646 or
    p_payload->'reviewed' is distinct from 'true'::jsonb or jsonb_typeof(p_payload->'editedText') is distinct from 'string' or
    length(public.language_live_trim(p_payload->>'editedText'))=0 or public.language_live_utf16_length(p_payload->>'editedText')>60000 then return false; end if;
  p:=p_payload->'preparation';
  if jsonb_typeof(p) is distinct from 'object' or not(p ?& prep_keys) or p-prep_keys<>'{}'::jsonb or
    p->>'templateVersion' is distinct from 'live-preparation-v1' or p->>'policyVersion' is distinct from 'live-review-v1' or p->>'timezone' is distinct from 'Asia/Seoul' or
    p->'forDate'='null'::jsonb or not public.language_live_iso_date_is_valid(p->'forDate') or
    jsonb_typeof(p->'maxItems') is distinct from 'number' or (p->>'maxItems') !~ '^[0-9]+$' or (p->>'maxItems')::numeric not between 1 and 10 or
    jsonb_typeof(p->'generatedText') is distinct from 'string' or length(public.language_live_trim(p->>'generatedText'))=0 or public.language_live_utf16_length(p->>'generatedText')>60000 or
    jsonb_typeof(p->'references') is distinct from 'array' or jsonb_array_length(p->'references')>1000 or
    jsonb_typeof(p->'selected') is distinct from 'array' or jsonb_array_length(p->'selected')>(p->>'maxItems')::integer or
    jsonb_typeof(p->'warnings') is distinct from 'array' or jsonb_array_length(p->'warnings')>20 then return false; end if;
  s:=p->'source';
  if jsonb_typeof(s) is distinct from 'object' or not(s ?& array['ownerId','lessons','batches']) or s-array['ownerId','lessons','batches']<>'{}'::jsonb or
    coalesce(s->>'ownerId','') !~ uuid_pattern or jsonb_typeof(s->'lessons') is distinct from 'array' or jsonb_array_length(s->'lessons')>1000 or
    jsonb_typeof(s->'batches') is distinct from 'array' or jsonb_array_length(s->'batches')>2000 then return false; end if;
  seen:='{}';
  for r in select value from jsonb_array_elements(s->'lessons') loop
    if jsonb_typeof(r)<>'object' or not(r ?& array['lessonId','revision','operation','payloadHash']) or r-array['lessonId','revision','operation','payloadHash']<>'{}'::jsonb or
      coalesce(r->>'lessonId','') !~ uuid_pattern or jsonb_typeof(r->'revision') is distinct from 'number' or (r->>'revision') !~ '^[0-9]+$' or (r->>'revision')::numeric not between 1 and 2147483647 or
      coalesce(r->>'operation','') not in ('create','edit','delete','restore') or jsonb_typeof(r->'payloadHash') is distinct from 'string' or public.language_live_utf16_length(r->>'payloadHash')>200 or length(public.language_live_trim(r->>'payloadHash'))=0 or
      seen ? (r->>'lessonId') then return false; end if;
    seen:=seen||jsonb_build_object(r->>'lessonId',true);
  end loop;
  seen:='{}';
  for r in select value from jsonb_array_elements(s->'batches') loop
    if jsonb_typeof(r)<>'object' or not(r ?& array['lessonId','lessonRevision','version','payloadHash']) or r-array['lessonId','lessonRevision','version','payloadHash']<>'{}'::jsonb or
      coalesce(r->>'lessonId','') !~ uuid_pattern or jsonb_typeof(r->'lessonRevision') is distinct from 'number' or (r->>'lessonRevision') !~ '^[0-9]+$' or (r->>'lessonRevision')::numeric not between 1 and 2147483647 or
      jsonb_typeof(r->'version') is distinct from 'number' or (r->>'version') !~ '^[0-9]+$' or (r->>'version')::numeric not between 1 and 2147483647 or
      jsonb_typeof(r->'payloadHash') is distinct from 'string' or public.language_live_utf16_length(r->>'payloadHash')>200 or length(public.language_live_trim(r->>'payloadHash'))=0 then return false; end if;
    if not exists(select 1 from jsonb_array_elements(s->'lessons') l where l->>'lessonId'=r->>'lessonId' and (l->>'revision')::integer>=(r->>'lessonRevision')::integer) then return false; end if;
    key:=(r->>'lessonId')||':'||(r->>'lessonRevision')||':'||(r->>'version');
    if seen ? key then return false; end if;
    seen:=seen||jsonb_build_object(key,true);
  end loop;
  seen:='{}';
  for r in select value from jsonb_array_elements(p->'references') loop
    if jsonb_typeof(r)<>'object' or not(r ?& array['lessonId','lessonRevision','fields']) or r-array['lessonId','lessonRevision','fields']<>'{}'::jsonb or
      coalesce(r->>'lessonId','') !~ uuid_pattern or jsonb_typeof(r->'lessonRevision') is distinct from 'number' or (r->>'lessonRevision') !~ '^[0-9]+$' or (r->>'lessonRevision')::numeric not between 1 and 2147483647 or
      jsonb_typeof(r->'fields') is distinct from 'array' or jsonb_array_length(r->'fields') not between 1 and 25 or seen ? (r->>'lessonId') then return false; end if;
    seen:=seen||jsonb_build_object(r->>'lessonId',true);
    if not exists(select 1 from jsonb_array_elements(s->'lessons') l where l->>'lessonId'=r->>'lessonId' and l->'revision'=r->'lessonRevision' and l->>'operation'<>'delete') then return false; end if;
    seen_events:='{}';
    for f in select value from jsonb_array_elements(r->'fields') loop
      if jsonb_typeof(f)<>'string' or not((f#>>'{}')=any(field_keys)) or seen_events ? (f#>>'{}') then return false; end if;
      seen_events:=seen_events||jsonb_build_object(f#>>'{}',true);
    end loop;
  end loop;
  seen:='{}';
  for r in select value from jsonb_array_elements(p->'selected') loop
    if jsonb_typeof(r)<>'object' or not(r ?& array['itemId','text','skill','status','nextDue','reason','events']) or r-array['itemId','text','skill','status','nextDue','reason','events']<>'{}'::jsonb or
      coalesce(r->>'itemId','') !~ uuid_pattern or jsonb_typeof(r->'text') is distinct from 'string' or length(public.language_live_trim(r->>'text'))=0 or public.language_live_utf16_length(r->>'text')>500 or
      coalesce(r->>'skill','') not in ('listening','speaking','reading','writing') or
      (r->'status'<>'null'::jsonb and coalesce(r->>'status','') not in ('unlearned','learning','review_due','relearn_needed','mastery_confirmed')) or
      not public.language_live_iso_date_is_valid(r->'nextDue') or jsonb_typeof(r->'reason') is distinct from 'string' or length(public.language_live_trim(r->>'reason'))=0 or public.language_live_utf16_length(r->>'reason')>2000 or
      jsonb_typeof(r->'events') is distinct from 'array' or jsonb_array_length(r->'events') not between 1 and 21 then return false; end if;
    key:=(r->>'itemId')||':'||(r->>'skill');
    if seen ? key then return false; end if;
    seen:=seen||jsonb_build_object(key,true); seen_events:='{}';
    for e in select value from jsonb_array_elements(r->'events') loop
      if jsonb_typeof(e)<>'object' or not(e ?& array['lessonId','lessonRevision','batchVersion','eventId']) or e-array['lessonId','lessonRevision','batchVersion','eventId']<>'{}'::jsonb or
        coalesce(e->>'lessonId','') !~ uuid_pattern or coalesce(e->>'eventId','') !~ uuid_pattern or
        jsonb_typeof(e->'lessonRevision') is distinct from 'number' or (e->>'lessonRevision') !~ '^[0-9]+$' or (e->>'lessonRevision')::numeric not between 1 and 2147483647 or
        jsonb_typeof(e->'batchVersion') is distinct from 'number' or (e->>'batchVersion') !~ '^[0-9]+$' or (e->>'batchVersion')::numeric not between 1 and 2147483647 then return false; end if;
      key:=(e->>'lessonId')||':'||(e->>'lessonRevision')||':'||(e->>'batchVersion')||':'||(e->>'eventId');
      if seen_events ? key then return false; end if;
      seen_events:=seen_events||jsonb_build_object(key,true);
      if not exists(select 1 from jsonb_array_elements(p->'references') reference where reference->>'lessonId'=e->>'lessonId' and reference->'lessonRevision'=e->'lessonRevision') then return false; end if;
      if not exists(select 1 from jsonb_array_elements(s->'batches') b where b->>'lessonId'=e->>'lessonId' and b->'lessonRevision'=e->'lessonRevision' and b->'version'=e->'batchVersion') then return false; end if;
    end loop;
  end loop;
  for r in select value from jsonb_array_elements(p->'warnings') loop
    if jsonb_typeof(r)<>'string' or length(public.language_live_trim(r#>>'{}'))=0 or public.language_live_utf16_length(r#>>'{}')>2000 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.language_live_preparations (
  user_id uuid not null references auth.users(id) on delete cascade,
  preparation_id uuid not null,
  revision integer not null check(revision>0),
  previous_revision integer not null check(previous_revision>=0 and revision=previous_revision+1),
  request_id uuid not null,
  payload jsonb not null check(public.language_live_preparation_is_valid(payload)),
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,preparation_id,revision),
  unique(user_id,request_id)
);
create index language_live_preparations_latest on public.language_live_preparations(user_id,preparation_id,revision desc);
alter table public.language_live_preparations enable row level security;
revoke all on public.language_live_preparations from public,anon,authenticated;
grant select,insert on public.language_live_preparations to authenticated;
create policy language_live_preparations_owner_select on public.language_live_preparations for select to authenticated using((select auth.uid())=user_id);
create policy language_live_preparations_owner_insert on public.language_live_preparations for insert to authenticated with check((select auth.uid())=user_id);

create function public.validate_language_live_preparation()
returns trigger language plpgsql security invoker set search_path='' as $$
declare prior_revision integer; snapshot jsonb; manifest jsonb; r jsonb; e jsonb;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then raise exception 'LIVE_AUTH' using errcode='42501'; end if;
  -- Same per-owner lock as P1 and P2 serializes source changes and preparation writes.
  perform pg_advisory_xact_lock(hashtextextended('language-live:'||new.user_id::text,0));
  if not public.language_live_preparation_is_valid(new.payload) or new.preparation_id::text is distinct from new.payload->>'preparationId' or
    new.request_id::text is distinct from new.payload->>'requestId' or new.previous_revision is distinct from (new.payload->>'expectedRevision')::integer or
    new.user_id::text is distinct from new.payload->'preparation'->'source'->>'ownerId' then raise exception 'LIVE_VALIDATION preparation payload'; end if;
  select max(revision) into prior_revision from public.language_live_preparations where user_id=new.user_id and preparation_id=new.preparation_id;
  if new.previous_revision is distinct from coalesce(prior_revision,0) or new.revision is distinct from coalesce(prior_revision,0)+1 then raise exception 'LIVE_CONFLICT preparation revision'; end if;
  snapshot:=public.read_language_live_learning(new.user_id);
  select jsonb_build_object('ownerId',new.user_id,
    'lessons',coalesce((select jsonb_agg(jsonb_build_object('lessonId',l->'lesson_id','revision',l->'revision','operation',l->'operation','payloadHash',l->'payload_hash') order by l->>'lesson_id') from jsonb_array_elements(snapshot->'lessons') l),'[]'::jsonb),
    'batches',coalesce((select jsonb_agg(jsonb_build_object('lessonId',b->'lesson_id','lessonRevision',b->'lesson_revision','version',b->'version','payloadHash',b->'payload_hash') order by b->>'lesson_id',(b->>'lesson_revision')::integer,(b->>'version')::integer) from jsonb_array_elements(snapshot->'batches') b),'[]'::jsonb)) into manifest;
  if new.payload->'preparation'->'source' is distinct from manifest then raise exception 'LIVE_CONFLICT preparation source'; end if;
  -- References are exact owner-scoped current evidence. Text is a reviewed draft,
  -- not a server-verified reproduction of the local template or a proficiency score.
  for r in select value from jsonb_array_elements(new.payload->'preparation'->'selected') loop
    for e in select value from jsonb_array_elements(r->'events') loop
      if not exists(select 1 from public.language_live_active_learning_batches b
        join public.language_live_current_lessons l on l.user_id=b.user_id and l.lesson_id=b.lesson_id and l.revision=b.lesson_revision
        cross join lateral jsonb_array_elements(b.payload->'events') event
        where b.user_id=new.user_id and b.lesson_id::text=e->>'lessonId' and b.lesson_revision=(e->>'lessonRevision')::integer and b.version=(e->>'batchVersion')::integer
          and (l.report->'lessonDate'='null'::jsonb or l.report->>'lessonDate'<=new.payload->'preparation'->>'forDate')
          and (event->'occurredDate'='null'::jsonb or event->>'occurredDate'<=new.payload->'preparation'->>'forDate')
          and event->>'eventId'=e->>'eventId' and event->'item'->>'itemId'=r->>'itemId' and event->'item'->>'text'=r->>'text' and event->>'skill'=r->>'skill') then
        raise exception 'LIVE_VALIDATION preparation event';
      end if;
    end loop;
  end loop;
  new.payload_hash:=md5(new.payload::text);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
create trigger language_live_validate_preparation before insert on public.language_live_preparations for each row execute function public.validate_language_live_preparation();

create function public.save_language_live_preparation(p_payload jsonb,p_expected_owner uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); receipt public.language_live_preparations;
begin
  if owner_id is null then raise exception 'LIVE_AUTH' using errcode='42501'; end if;
  if p_expected_owner is distinct from owner_id then raise exception 'LIVE_ACCOUNT_CHANGED' using errcode='42501'; end if;
  if not public.language_live_preparation_is_valid(p_payload) then raise exception 'LIVE_VALIDATION preparation payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('language-live:'||owner_id::text,0));
  select * into receipt from public.language_live_preparations where user_id=owner_id and request_id=(p_payload->>'requestId')::uuid;
  if receipt.request_id is not null then
    if receipt.payload is distinct from p_payload then raise exception 'LIVE_CONFLICT preparation request'; end if;
    return to_jsonb(receipt); -- Retry an already committed request BEFORE source freshness/CAS checks.
  end if;
  insert into public.language_live_preparations(user_id,preparation_id,revision,previous_revision,request_id,payload,payload_hash)
    values(owner_id,(p_payload->>'preparationId')::uuid,(p_payload->>'expectedRevision')::integer+1,(p_payload->>'expectedRevision')::integer,(p_payload->>'requestId')::uuid,p_payload,'') returning * into receipt;
  return to_jsonb(receipt);
end;
$$;

-- Single-statement stable snapshot: every historical revision or an explicit overflow error.
create function public.read_language_live_preparations(p_expected_owner uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); row_count bigint; bytes bigint;
begin
  if owner_id is null then raise exception 'LIVE_AUTH' using errcode='42501'; end if;
  if p_expected_owner is distinct from owner_id then raise exception 'LIVE_ACCOUNT_CHANGED' using errcode='42501'; end if;
  select count(*),coalesce(sum(octet_length(to_jsonb(p)::text)),0) into row_count,bytes from public.language_live_preparations p where user_id=owner_id;
  if row_count>1000 or bytes>10000000 then raise exception 'LIVE_LIMIT preparation history'; end if;
  return jsonb_build_object('ownerId',owner_id,'count',row_count,
    'records',coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,preparation_id,revision desc) from public.language_live_preparations p where user_id=owner_id),'[]'::jsonb));
end;
$$;

revoke all on function public.language_live_preparation_is_valid(jsonb),public.validate_language_live_preparation(),public.save_language_live_preparation(jsonb,uuid),public.read_language_live_preparations(uuid) from public,anon,authenticated;
grant execute on function public.language_live_preparation_is_valid(jsonb),public.validate_language_live_preparation(),public.save_language_live_preparation(jsonb,uuid),public.read_language_live_preparations(uuid) to authenticated;
