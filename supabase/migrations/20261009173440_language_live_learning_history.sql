-- P2 LOCAL CANDIDATE ONLY. Do not apply to hosted/shared databases without approval.
-- Additive evidence history; legacy state, reset generations, schedules and grants stay intact.
-- A batch is the complete confirmed evidence for one exact source revision. An empty batch
-- is a scoped tombstone. Corrections/clears advance CAS, retaining every prior event.

create function public.language_live_iso_date_is_valid(p_date jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare date_text text;
begin
  if p_date='null'::jsonb then return true; end if;
  if jsonb_typeof(p_date) is distinct from 'string' then return false; end if;
  date_text:=p_date#>>'{}';
  return date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and
    to_char(make_date(substring(date_text,1,4)::int,substring(date_text,6,2)::int,substring(date_text,9,2)::int),'YYYY-MM-DD')=date_text;
exception when others then return false;
end;
$$;

create function public.language_live_learning_is_valid(p_payload jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
  e jsonb; i jsonb; identity jsonb; linked jsonb;
  item_by_id jsonb:='{}'; id_by_identity jsonb:='{}'; seen_events jsonb:='{}';
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  input_keys text[]:=array['requestId','lessonId','lessonRevision','expectedVersion','confirmed','policyVersion','events','changeReason'];
  event_keys text[]:=array['eventId','item','skill','kind','result','occurredDate','certainty','independent','hintUsed','forgettingConfirmed','evidenceText','sourceField','reason','relearningText','linkedRelearningEventId','teacherRecommendedDue','teacherRecommendationConfirmed'];
  field_keys text[]:=array['lessonDate','topic','stage','kana','vocabulary','grammar','expressions','listening','speaking','reading','writing','errors','corrections','recurringDifficulties','confidentContent','reviewNeeds','nextLessonRecommendations','aiAssessmentNotes','previousReviewResults','forgettingObservations','relearningActivities','reassessments','stateChanges','nextReviewRecommendations','evidenceAndUncertainty'];
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>250000 or
    not(p_payload ?& input_keys) or p_payload-input_keys<>'{}'::jsonb then return false; end if;
  if coalesce(p_payload->>'requestId','') !~ uuid_pattern or coalesce(p_payload->>'lessonId','') !~ uuid_pattern or
    jsonb_typeof(p_payload->'lessonRevision') is distinct from 'number' or (p_payload->>'lessonRevision') !~ '^[0-9]+$' or (p_payload->>'lessonRevision')::numeric not between 1 and 2147483647 or
    jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion') !~ '^[0-9]+$' or (p_payload->>'expectedVersion')::numeric not between 0 and 2147483646 or
    p_payload->'confirmed' is distinct from 'true'::jsonb or p_payload->>'policyVersion' is distinct from 'live-review-v1' or
    jsonb_typeof(p_payload->'changeReason') is distinct from 'string' or length(public.language_live_trim(p_payload->>'changeReason'))=0 or public.language_live_utf16_length(p_payload->>'changeReason')>1000 or
    jsonb_typeof(p_payload->'events') is distinct from 'array' or jsonb_array_length(p_payload->'events')>100 then return false; end if;
  for e in select value from jsonb_array_elements(p_payload->'events') loop
    if jsonb_typeof(e)<>'object' or not(e ?& event_keys) or e-event_keys<>'{}'::jsonb then return false; end if;
    i:=e->'item';
    if jsonb_typeof(i) is distinct from 'object' or not(i ?& array['itemId','kind','text','meaning']) or i-array['itemId','kind','text','meaning']<>'{}'::jsonb then return false; end if;
    if coalesce(i->>'itemId','') !~ uuid_pattern or coalesce(i->>'kind','') not in ('kana','word','grammar','expression','sentence','other') or
      jsonb_typeof(i->'text') is distinct from 'string' or length(public.language_live_trim(i->>'text'))=0 or public.language_live_utf16_length(i->>'text')>500 or
      jsonb_typeof(i->'meaning') is distinct from 'string' or public.language_live_utf16_length(i->>'meaning')>1000 then return false; end if;
    identity:=i-'itemId';
    if (item_by_id ? (i->>'itemId') and item_by_id->(i->>'itemId') is distinct from identity) or
      (id_by_identity ? identity::text and id_by_identity->>identity::text is distinct from i->>'itemId') then return false; end if;
    item_by_id:=item_by_id||jsonb_build_object(i->>'itemId',identity);
    id_by_identity:=id_by_identity||jsonb_build_object(identity::text,i->>'itemId');
    if coalesce(e->>'eventId','') !~ uuid_pattern or seen_events ? (e->>'eventId') then return false; end if;
    seen_events:=seen_events||jsonb_build_object(e->>'eventId',true);
    if coalesce(e->>'skill','') not in ('listening','speaking','reading','writing') or coalesce(e->>'kind','') not in ('not_learned','learn','review','forgetting','relearn','reassessment') or
      coalesce(e->>'result','') not in ('independent_correct','hinted_correct','incorrect','cannot_recall','uncertain','not_assessed') or
      not public.language_live_iso_date_is_valid(e->'occurredDate') or coalesce(e->>'certainty','') not in ('confirmed','uncertain') or
      jsonb_typeof(e->'independent') not in ('boolean','null') or jsonb_typeof(e->'hintUsed') not in ('boolean','null') or
      jsonb_typeof(e->'forgettingConfirmed') is distinct from 'boolean' or jsonb_typeof(e->'teacherRecommendationConfirmed') is distinct from 'boolean' or
      jsonb_typeof(e->'evidenceText') is distinct from 'string' or length(public.language_live_trim(e->>'evidenceText'))=0 or public.language_live_utf16_length(e->>'evidenceText')>5000 or
      jsonb_typeof(e->'reason') is distinct from 'string' or length(public.language_live_trim(e->>'reason'))=0 or public.language_live_utf16_length(e->>'reason')>1000 or
      jsonb_typeof(e->'relearningText') is distinct from 'string' or public.language_live_utf16_length(e->>'relearningText')>5000 or
      not(coalesce(e->>'sourceField','')=any(field_keys)) or not public.language_live_iso_date_is_valid(e->'teacherRecommendedDue') then return false; end if;
    if e->'linkedRelearningEventId'<>'null'::jsonb and (jsonb_typeof(e->'linkedRelearningEventId') is distinct from 'string' or (e->>'linkedRelearningEventId')!~uuid_pattern) then return false; end if;
    if e->>'result'='independent_correct' and (e->'independent'<>'true'::jsonb or e->'hintUsed'<>'false'::jsonb) then return false; end if;
    if e->>'result'='hinted_correct' and (e->'independent'<>'false'::jsonb or e->'hintUsed'<>'true'::jsonb) then return false; end if;
    if e->>'result'<>'independent_correct' and e->'independent'='true'::jsonb then return false; end if;
    if e->>'kind' in ('learn','not_learned','relearn') and e->>'result'<>'not_assessed' then return false; end if;
    if e->>'kind'='not_learned' and e->>'certainty'<>'confirmed' then return false; end if;
    if e->>'kind'='relearn' and length(public.language_live_trim(e->>'relearningText'))=0 then return false; end if;
    if e->'forgettingConfirmed'='true'::jsonb and (e->>'certainty'<>'confirmed' or e->>'result' not in ('incorrect','cannot_recall')) then return false; end if;
    if (e->>'kind'='reassessment')<>(e->'linkedRelearningEventId'<>'null'::jsonb) or e->>'linkedRelearningEventId'=e->>'eventId' then return false; end if;
    if e->'teacherRecommendationConfirmed'='true'::jsonb and (e->'teacherRecommendedDue'='null'::jsonb or e->'occurredDate'='null'::jsonb or e->>'teacherRecommendedDue'<e->>'occurredDate') then return false; end if;
    if e->'linkedRelearningEventId'<>'null'::jsonb then
      select value into linked from jsonb_array_elements(p_payload->'events') where value->>'eventId'=e->>'linkedRelearningEventId';
      if linked is not null and (linked->>'kind'<>'relearn' or linked->'item'->>'itemId'<>i->>'itemId' or linked->>'skill'<>e->>'skill' or linked->>'occurredDate'>e->>'occurredDate') then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.language_live_learning_batches (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null,
  lesson_revision integer not null,
  version integer not null check(version>0),
  previous_version integer not null check(previous_version>=0 and version=previous_version+1),
  request_id uuid not null,
  payload jsonb not null check(public.language_live_learning_is_valid(payload)),
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,lesson_id,lesson_revision,version),
  unique(user_id,request_id),
  foreign key(user_id,lesson_id,lesson_revision) references public.language_live_lessons(user_id,lesson_id,revision)
);
create index language_live_learning_latest on public.language_live_learning_batches(user_id,lesson_id,lesson_revision,version desc);
alter table public.language_live_learning_batches enable row level security;
revoke all on public.language_live_learning_batches from public,anon,authenticated;
grant select,insert on public.language_live_learning_batches to authenticated;
create policy language_live_learning_owner_select on public.language_live_learning_batches for select to authenticated using((select auth.uid())=user_id);
create policy language_live_learning_owner_insert on public.language_live_learning_batches for insert to authenticated with check((select auth.uid())=user_id);

create function public.validate_language_live_learning_batch()
returns trigger language plpgsql security invoker set search_path='' as $$
declare source public.language_live_lessons; prior_version integer; e jsonb; linked jsonb;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then raise exception 'LIVE_AUTH' using errcode='42501'; end if;
  -- Same owner lock as P1 makes lesson deletion/edit versus evaluation atomic.
  perform pg_advisory_xact_lock(hashtextextended('language-live:'||new.user_id::text,0));
  if not public.language_live_learning_is_valid(new.payload) or new.lesson_id::text is distinct from new.payload->>'lessonId' or
    new.lesson_revision is distinct from (new.payload->>'lessonRevision')::integer or new.request_id::text is distinct from new.payload->>'requestId' or
    new.previous_version is distinct from (new.payload->>'expectedVersion')::integer then raise exception 'LIVE_VALIDATION learning payload'; end if;
  select * into source from public.language_live_lessons where user_id=new.user_id and lesson_id=new.lesson_id order by revision desc limit 1;
  if source.revision is distinct from new.lesson_revision or source.operation='delete' then raise exception 'LIVE_CONFLICT learning source'; end if;
  select max(version) into prior_version from public.language_live_learning_batches where user_id=new.user_id and lesson_id=new.lesson_id and lesson_revision=new.lesson_revision;
  if new.previous_version is distinct from coalesce(prior_version,0) or new.version is distinct from coalesce(prior_version,0)+1 then raise exception 'LIVE_CONFLICT learning version'; end if;
  for e in select value from jsonb_array_elements(new.payload->'events') loop
    if strpos(source.report->'fields'->(e->>'sourceField')->>'text',e->>'evidenceText')=0 or
      (source.report->'fields'->(e->>'sourceField')->>'presence' in ('none','unknown') and e->>'certainty'<>'uncertain' and e->>'result'<>'uncertain') or
      (source.report->'fields'->(e->>'sourceField')->>'presence'='not_learned' and e->>'kind'<>'not_learned' and e->>'certainty'<>'uncertain' and e->>'result'<>'uncertain') then
      raise exception 'LIVE_VALIDATION source evidence';
    end if;
    -- Never bind a different owner. Preserve immutable identity across corrections and deletion.
    if exists(select 1 from public.language_live_learning_batches b cross join lateral jsonb_array_elements(b.payload->'events') historical_event
      where b.user_id=new.user_id and ((historical_event->'item'->>'itemId'=e->'item'->>'itemId' and historical_event->'item' is distinct from e->'item') or
        (((historical_event->'item')-'itemId')=((e->'item')-'itemId') and historical_event->'item'->>'itemId'<>e->'item'->>'itemId') or
        (historical_event->>'eventId'=e->>'eventId' and b.lesson_id<>new.lesson_id))) then raise exception 'LIVE_CONFLICT learning identity'; end if;
    if e->'linkedRelearningEventId'<>'null'::jsonb then
      select value into linked from jsonb_array_elements(new.payload->'events') where value->>'eventId'=e->>'linkedRelearningEventId';
      if linked is null then
        select historical_event into linked from public.language_live_learning_batches b cross join lateral jsonb_array_elements(b.payload->'events') historical_event
          join public.language_live_current_lessons l on l.user_id=b.user_id and l.lesson_id=b.lesson_id and l.revision=b.lesson_revision and l.operation<>'delete'
          where b.user_id=new.user_id and b.lesson_id<>new.lesson_id and historical_event->>'eventId'=e->>'linkedRelearningEventId'
            and not exists(select 1 from public.language_live_learning_batches newer where newer.user_id=b.user_id and newer.lesson_id=b.lesson_id and newer.lesson_revision=b.lesson_revision and newer.version>b.version)
          limit 1;
      end if;
      if linked is null or linked->>'kind'<>'relearn' or linked->'item'->>'itemId'<>e->'item'->>'itemId' or linked->>'skill'<>e->>'skill' or linked->>'occurredDate'>e->>'occurredDate' then raise exception 'LIVE_VALIDATION relearning link'; end if;
    end if;
  end loop;
  new.payload_hash:=md5(new.payload::text);
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
create trigger language_live_validate_learning before insert on public.language_live_learning_batches for each row execute function public.validate_language_live_learning_batch();

create view public.language_live_current_learning_batches with(security_invoker=true) as
  select distinct on(user_id,lesson_id,lesson_revision) * from public.language_live_learning_batches
  order by user_id,lesson_id,lesson_revision,version desc;
create view public.language_live_active_learning_batches with(security_invoker=true) as
  select b.* from public.language_live_current_learning_batches b join public.language_live_current_lessons l
  on l.user_id=b.user_id and l.lesson_id=b.lesson_id and l.revision=b.lesson_revision where l.operation<>'delete';
revoke all on public.language_live_current_learning_batches,public.language_live_active_learning_batches from public,anon,authenticated;
grant select on public.language_live_current_learning_batches,public.language_live_active_learning_batches to authenticated;

create function public.save_language_live_learning(p_payload jsonb,p_expected_owner uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); receipt public.language_live_learning_batches;
begin
  if owner_id is null then raise exception 'LIVE_AUTH' using errcode='42501'; end if;
  if p_expected_owner is distinct from owner_id then raise exception 'LIVE_ACCOUNT_CHANGED' using errcode='42501'; end if;
  if not public.language_live_learning_is_valid(p_payload) then raise exception 'LIVE_VALIDATION learning payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('language-live:'||owner_id::text,0));
  select * into receipt from public.language_live_learning_batches where user_id=owner_id and request_id=(p_payload->>'requestId')::uuid;
  if receipt.request_id is not null then
    if receipt.payload is distinct from p_payload then raise exception 'LIVE_CONFLICT learning request'; end if;
    return to_jsonb(receipt); -- Lost responses recover even after later correction/clear/deletion.
  end if;
  insert into public.language_live_learning_batches(user_id,lesson_id,lesson_revision,version,previous_version,request_id,payload,payload_hash)
    values(owner_id,(p_payload->>'lessonId')::uuid,(p_payload->>'lessonRevision')::integer,(p_payload->>'expectedVersion')::integer+1,(p_payload->>'expectedVersion')::integer,(p_payload->>'requestId')::uuid,p_payload,'') returning * into receipt;
  return to_jsonb(receipt);
end;
$$;

-- One SQL-statement snapshot avoids mixing old lesson heads with new evaluations across pages.
-- Explicit limits fail closed; never silently return a partial learning state as current.
create function public.read_language_live_learning(p_expected_owner uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); lesson_count bigint; batch_count bigint; bytes bigint;
begin
  if owner_id is null then raise exception 'LIVE_AUTH' using errcode='42501'; end if;
  if p_expected_owner is distinct from owner_id then raise exception 'LIVE_ACCOUNT_CHANGED' using errcode='42501'; end if;
  select count(*),coalesce(sum(octet_length(to_jsonb(l)::text)),0) into lesson_count,bytes from public.language_live_current_lessons l where user_id=owner_id;
  select count(*),bytes+coalesce(sum(octet_length(to_jsonb(b)::text)),0) into batch_count,bytes from public.language_live_learning_batches b where user_id=owner_id;
  if lesson_count>1000 or batch_count>2000 or bytes>10000000 then raise exception 'LIVE_LIMIT learning snapshot'; end if;
  return jsonb_build_object('ownerId',owner_id,
    'lessons',coalesce((select jsonb_agg(to_jsonb(l) order by lesson_id) from public.language_live_current_lessons l where user_id=owner_id),'[]'::jsonb),
    'batches',coalesce((select jsonb_agg(to_jsonb(b) order by lesson_id,lesson_revision,version) from public.language_live_learning_batches b where user_id=owner_id),'[]'::jsonb));
end;
$$;

revoke all on function public.language_live_iso_date_is_valid(jsonb),public.language_live_learning_is_valid(jsonb),public.validate_language_live_learning_batch(),public.save_language_live_learning(jsonb,uuid),public.read_language_live_learning(uuid) from public,anon,authenticated;
grant execute on function public.language_live_iso_date_is_valid(jsonb),public.language_live_learning_is_valid(jsonb),public.validate_language_live_learning_batch(),public.save_language_live_learning(jsonb,uuid),public.read_language_live_learning(uuid) to authenticated;
