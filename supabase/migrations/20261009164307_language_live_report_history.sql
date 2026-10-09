-- P1 ONLY: additive Live history. Do not apply to hosted/shared production without approval.
-- Existing language_user_state, command/reset functions and all legacy data are untouched.
-- One append-only row is both the immutable revision and its idempotent request receipt.

-- String bounds use UTF-16 code units, matching JavaScript String.length exactly.
create function public.language_live_utf16_length(p_text text)
returns integer language sql immutable strict security invoker set search_path = '' as $$
  select length(p_text) + regexp_count(p_text, E'[\U00010000-\U0010FFFF]');
$$;

create function public.language_live_trim(p_text text)
returns text language sql immutable strict security invoker set search_path = '' as $$
  -- ECMAScript trim includes Japanese full-width space and BOM.
  select btrim(p_text,E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF');
$$;

create function public.language_live_report_is_valid(p_report jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  field_keys text[] := array['lessonDate','topic','stage','kana','vocabulary','grammar','expressions','listening','speaking','reading','writing','errors','corrections','recurringDifficulties','confidentContent','reviewNeeds','nextLessonRecommendations','aiAssessmentNotes','previousReviewResults','forgettingObservations','relearningActivities','reassessments','stateChanges','nextReviewRecommendations','evidenceAndUncertainty'];
  key text; field jsonb; date_text text; parts text[]; expected_date date;
begin
  if p_report is null or jsonb_typeof(p_report) <> 'object' or octet_length(p_report::text) > 2000000 then return false; end if;
  if jsonb_typeof(p_report->'rawText') is distinct from 'string' or length(public.language_live_trim(p_report->>'rawText'))=0 or public.language_live_utf16_length(p_report->>'rawText')>100000 then return false; end if;
  if coalesce(p_report->>'reportVersion','') not in ('v1','v1.1','unknown') or jsonb_typeof(p_report->'parserVersion') is distinct from 'string' or public.language_live_utf16_length(p_report->>'parserVersion') not between 1 and 50 then return false; end if;
  if p_report->>'source' is distinct from 'chatgpt_live_manual' or p_report->>'importFormat' is distinct from 'labelled_text' or p_report->'structuredSchemaVersion' is distinct from '1'::jsonb then return false; end if;
  if jsonb_typeof(p_report->'fields') is distinct from 'object' or ((p_report->'fields') - field_keys) <> '{}'::jsonb then return false; end if;
  foreach key in array field_keys loop
    field := p_report->'fields'->key;
    if field is null or jsonb_typeof(field) <> 'object' or jsonb_typeof(field->'text') is distinct from 'string' or public.language_live_utf16_length(field->>'text')>100000 or coalesce(field->>'presence','') not in ('reported','unknown','none','not_learned') then return false; end if;
    if field ? 'sourceBlocks' then
      if jsonb_typeof(field->'sourceBlocks') <> 'array' then return false; end if;
      if exists(select 1 from jsonb_array_elements(field->'sourceBlocks') v where jsonb_typeof(v) <> 'string' or public.language_live_utf16_length(v#>>'{}')>100000) then return false; end if;
    end if;
  end loop;
  if jsonb_typeof(p_report->'topic') is distinct from 'string' or jsonb_typeof(p_report->'stage') is distinct from 'string'
    or p_report->>'topic' is distinct from public.language_live_trim(p_report->'fields'->'topic'->>'text')
    or p_report->>'stage' is distinct from public.language_live_trim(p_report->'fields'->'stage'->>'text') then return false; end if;
  if jsonb_typeof(p_report->'lessonTimezone') is distinct from 'string' or public.language_live_utf16_length(p_report->>'lessonTimezone') not between 1 and 100 then return false; end if;
  if jsonb_typeof(p_report->'warnings') is distinct from 'array' or jsonb_array_length(p_report->'warnings')>100 then return false; end if;
  if exists(select 1 from jsonb_array_elements(p_report->'warnings') v where jsonb_typeof(v) <> 'string' or public.language_live_utf16_length(v#>>'{}')>1000) then return false; end if;
  if jsonb_typeof(p_report->'unparsedText') is distinct from 'string' or public.language_live_utf16_length(p_report->>'unparsedText')>100000 then return false; end if;
  date_text := public.language_live_trim(p_report->'fields'->'lessonDate'->>'text');
  parts := regexp_match(date_text,'^([0-9]{4})[-./]([0-9]{1,2})[-./]([0-9]{1,2})\.?$');
  if parts is null then parts := regexp_match(date_text,'^([0-9]{4})년\s*([0-9]{1,2})월\s*([0-9]{1,2})일$'); end if;
  if parts is not null then
    expected_date := make_date(parts[1]::integer,parts[2]::integer,parts[3]::integer);
    if p_report->>'lessonDate' is distinct from to_char(expected_date,'YYYY-MM-DD') then return false; end if;
  else
    if date_text !~* '^((미확인|확인\s*필요|알\s*수\s*없음|기록\s*없음|미기재|미상|unknown|n/?a)[.!。]?)?$' or p_report->'lessonDate' is distinct from 'null'::jsonb then return false; end if;
  end if;
  return true;
exception when others then return false;
end;
$$;

create table public.language_live_lessons (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null,
  revision integer not null check(revision>0),
  previous_revision integer not null check(previous_revision>=0 and revision=previous_revision+1),
  operation text not null check(operation in ('create','edit','delete','restore')),
  report jsonb not null check(public.language_live_report_is_valid(report)),
  request_id uuid not null,
  payload_hash text not null,
  restored_from_revision integer,
  duplicate_reason text,
  mutation jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,lesson_id,revision),
  unique(user_id,request_id),
  check(duplicate_reason is null or (public.language_live_utf16_length(duplicate_reason) between 3 and 500 and duplicate_reason=public.language_live_trim(duplicate_reason))),
  check((operation='restore')=(restored_from_revision is not null))
);
create index language_live_lessons_owner_latest on public.language_live_lessons(user_id,lesson_id,revision desc);
create index language_live_lessons_owner_created on public.language_live_lessons(user_id,created_at desc);
alter table public.language_live_lessons enable row level security;
revoke all on public.language_live_lessons from public,anon,authenticated;
grant select,insert on public.language_live_lessons to authenticated;
create policy language_live_lessons_owner_select on public.language_live_lessons for select to authenticated using((select auth.uid())=user_id);
create policy language_live_lessons_owner_insert on public.language_live_lessons for insert to authenticated with check((select auth.uid())=user_id);

create function public.validate_language_live_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare prior public.language_live_lessons; restored public.language_live_lessons; supplied_report jsonb; canonical_mutation jsonb;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then raise exception 'LIVE_AUTH' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('language-live:'||new.user_id::text,0));
  if not public.language_live_report_is_valid(new.report) then raise exception 'LIVE_VALIDATION report'; end if;
  if new.operation not in ('create','edit') and new.duplicate_reason is not null then raise exception 'LIVE_VALIDATION duplicate reason'; end if;
  if not exists(select 1 from pg_timezone_names where name=new.report->>'lessonTimezone') then raise exception 'LIVE_VALIDATION timezone'; end if;
  select * into prior from public.language_live_lessons where user_id=new.user_id and lesson_id=new.lesson_id order by revision desc limit 1;
  if new.previous_revision is distinct from coalesce(prior.revision,0) or new.revision is distinct from coalesce(prior.revision,0)+1 then raise exception 'LIVE_CONFLICT revision'; end if;
  if new.operation='create' then
    if prior.revision is not null then raise exception 'LIVE_CONFLICT exists'; end if;
  elsif new.operation in ('edit','delete') then
    if prior.revision is null or prior.operation='delete' then raise exception 'LIVE_CONFLICT unavailable'; end if;
    if new.operation='delete' and new.report is distinct from prior.report then raise exception 'LIVE_VALIDATION delete report'; end if;
  elsif new.operation='restore' then
    -- Restore can undo an edit as well as a tombstone; the old revisions stay intact.
    if prior.revision is null or new.restored_from_revision is null or new.restored_from_revision>prior.revision then raise exception 'LIVE_CONFLICT restore'; end if;
    select * into restored from public.language_live_lessons where user_id=new.user_id and lesson_id=new.lesson_id and revision=new.restored_from_revision and operation<>'delete';
    if restored.revision is null or restored.report is distinct from new.report then raise exception 'LIVE_VALIDATION restore report'; end if;
  else raise exception 'LIVE_VALIDATION operation'; end if;
  if new.operation in ('create','edit') then supplied_report:=new.report; else supplied_report:=null; end if;
  canonical_mutation := jsonb_build_object('lessonId',new.lesson_id,'expectedRevision',new.previous_revision,'operation',new.operation,'report',supplied_report,'restoreRevision',new.restored_from_revision,'allowDuplicate',new.duplicate_reason is not null,'duplicateReason',new.duplicate_reason);
  if new.mutation is distinct from canonical_mutation then raise exception 'LIVE_VALIDATION mutation'; end if;
  -- A table-direct insert receives the same guards as RPC. No RPC-only audit bypass.
  if new.operation in ('create','edit') and new.duplicate_reason is null and exists (
    select 1 from (select distinct on (lesson_id) lesson_id,operation,report from public.language_live_lessons where user_id=new.user_id order by lesson_id,revision desc) current_rows
    where current_rows.lesson_id<>new.lesson_id and current_rows.operation<>'delete'
      and current_rows.report->>'rawText'=new.report->>'rawText'
      and current_rows.report->'lessonDate' is not distinct from new.report->'lessonDate'
  ) then raise exception 'LIVE_DUPLICATE'; end if;
  new.payload_hash := md5(canonical_mutation::text); -- idempotency equality, not authorization/cryptography.
  new.created_at := clock_timestamp();
  return new;
end;
$$;
create trigger language_live_validate_revision before insert on public.language_live_lessons for each row execute function public.validate_language_live_revision();

create view public.language_live_current_lessons with(security_invoker=true) as
  select distinct on (user_id,lesson_id) user_id,lesson_id,revision,previous_revision,operation,report,created_at,request_id,payload_hash,restored_from_revision,duplicate_reason
  from public.language_live_lessons order by user_id,lesson_id,revision desc;
-- Tombstones remain in the latest view; callers filter only after selecting latest.
create view public.language_live_mutations with(security_invoker=true) as
  select user_id,request_id,lesson_id,revision,operation,payload_hash,created_at from public.language_live_lessons;
revoke all on public.language_live_current_lessons,public.language_live_mutations from public,anon,authenticated;
grant select on public.language_live_current_lessons,public.language_live_mutations to authenticated;

create function public.save_language_live_lesson(
  p_request_id uuid,p_lesson_id uuid,p_expected_revision integer,p_operation text,p_report jsonb default null,
  p_restore_revision integer default null,p_allow_duplicate boolean default false,p_duplicate_reason text default null,
  p_expected_owner uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid(); canonical_mutation jsonb; wanted_hash text;
  receipt public.language_live_lessons; prior public.language_live_lessons; saved_report jsonb; duplicate_note text;
begin
  if owner_id is null then raise exception 'LIVE_AUTH' using errcode='42501'; end if;
  -- A session may change after the browser's getUser preflight and before this RPC.
  -- Reject rather than saving one account's pending draft into the new account.
  if p_expected_owner is distinct from owner_id then raise exception 'LIVE_ACCOUNT_CHANGED' using errcode='42501'; end if;
  if p_request_id is null or p_lesson_id is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 or p_operation is null or p_operation not in ('create','edit','delete','restore') or p_allow_duplicate is null then raise exception 'LIVE_VALIDATION target'; end if;
  if p_allow_duplicate then
    duplicate_note:=public.language_live_trim(p_duplicate_reason);
    if duplicate_note is null or public.language_live_utf16_length(duplicate_note) not between 3 and 500 or p_operation not in ('create','edit') then raise exception 'LIVE_VALIDATION duplicate reason'; end if;
  elsif p_duplicate_reason is not null then raise exception 'LIVE_VALIDATION unexpected reason'; end if;
  if (p_operation in ('create','edit') and p_report is null) or (p_operation in ('delete','restore') and p_report is not null)
    or (p_operation='restore' and (p_restore_revision is null or p_restore_revision<1 or p_restore_revision>p_expected_revision))
    or (p_operation<>'restore' and p_restore_revision is not null) then raise exception 'LIVE_VALIDATION operation payload'; end if;
  canonical_mutation:=jsonb_build_object('lessonId',p_lesson_id,'expectedRevision',p_expected_revision,'operation',p_operation,'report',p_report,'restoreRevision',p_restore_revision,'allowDuplicate',p_allow_duplicate,'duplicateReason',duplicate_note);
  wanted_hash:=md5(canonical_mutation::text);
  perform pg_advisory_xact_lock(hashtextextended('language-live:'||owner_id::text,0));
  select * into receipt from public.language_live_lessons where user_id=owner_id and request_id=p_request_id;
  if found then
    if receipt.payload_hash<>wanted_hash or receipt.mutation is distinct from canonical_mutation then raise exception 'LIVE_CONFLICT request'; end if;
    return to_jsonb(receipt)-'mutation';
  end if;
  select * into prior from public.language_live_lessons where user_id=owner_id and lesson_id=p_lesson_id order by revision desc limit 1;
  if coalesce(prior.revision,0)<>p_expected_revision then raise exception 'LIVE_CONFLICT revision'; end if;
  if p_operation='delete' then saved_report:=prior.report;
  elsif p_operation='restore' then
    select report into saved_report from public.language_live_lessons where user_id=owner_id and lesson_id=p_lesson_id and revision=p_restore_revision and operation<>'delete';
  else saved_report:=p_report; end if;
  if saved_report is null then raise exception 'LIVE_CONFLICT unavailable'; end if;
  insert into public.language_live_lessons(user_id,lesson_id,revision,previous_revision,operation,report,request_id,payload_hash,restored_from_revision,duplicate_reason,mutation)
    values(owner_id,p_lesson_id,p_expected_revision+1,p_expected_revision,p_operation,saved_report,p_request_id,wanted_hash,p_restore_revision,duplicate_note,canonical_mutation)
    returning * into receipt;
  return to_jsonb(receipt)-'mutation';
end;
$$;

revoke execute on function public.language_live_utf16_length(text) from public,anon;
revoke execute on function public.language_live_trim(text) from public,anon;
revoke execute on function public.language_live_report_is_valid(jsonb) from public,anon;
revoke execute on function public.validate_language_live_revision() from public,anon;
revoke execute on function public.save_language_live_lesson(uuid,uuid,integer,text,jsonb,integer,boolean,text,uuid) from public,anon;
grant execute on function public.language_live_utf16_length(text) to authenticated;
grant execute on function public.language_live_trim(text) to authenticated;
grant execute on function public.language_live_report_is_valid(jsonb) to authenticated;
grant execute on function public.validate_language_live_revision() to authenticated;
grant execute on function public.save_language_live_lesson(uuid,uuid,integer,text,jsonb,integer,boolean,text,uuid) to authenticated;
