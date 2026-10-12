-- Gate A source only. Installation is NOT capture activation.
-- Review hosted history/adoption before installation. Once ANY write endpoint is enabled,
-- every supported release/rollback must retain protocol-required reset cleanup.
begin;

-- Deliberately survives language-row deletion and generation rotation. Account deletion
-- alone cascades this minimal protocol witness; it contains no learner evidence.
create table public.language_legacy_evidence_enrollments (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  creation_request_id uuid not null,
  initial_generation_id uuid not null
);
alter table public.language_legacy_evidence_enrollments enable row level security;
alter table public.language_legacy_evidence_enrollments force row level security;
revoke all on public.language_legacy_evidence_enrollments from public,anon,authenticated,service_role;
grant select,insert on public.language_legacy_evidence_enrollments to language_legacy_evidence_executor;
grant select(owner_id) on public.language_legacy_evidence_enrollments to language_legacy_evidence_reset_executor;
create policy legacy_evidence_enrollment_read on public.language_legacy_evidence_enrollments
  for select to language_legacy_evidence_executor using(auth.uid() is not null and auth.uid()=owner_id);
create policy legacy_evidence_enrollment_insert on public.language_legacy_evidence_enrollments
  for insert to language_legacy_evidence_executor with check(auth.uid() is not null and auth.uid()=owner_id);
-- R4: the uncallable trigger needs existence only before checking the authenticated owner.
create policy legacy_evidence_reset_enrollment_probe on public.language_legacy_evidence_enrollments
  for select to language_legacy_evidence_reset_executor using(true);

-- Compatibility adoption records the actual extant generation, never an invented event
-- or historical timestamp. Its server nonce cannot satisfy a locally frozen new request.
insert into public.language_legacy_evidence_enrollments(owner_id,creation_request_id,initial_generation_id)
  select owner_id,pg_catalog.gen_random_uuid(),generation_id from public.language_legacy_evidence_generations;
-- Deferred so first generation+witness can be inserted together in either statement
-- order. Also rejects a pre-installation old initializer that was already in flight
-- and later attempts to commit a generation without an adopted/new witness.
-- No FK points from initial_generation_id to the rotating/deletable current context.
alter table public.language_legacy_evidence_generations
  add constraint legacy_evidence_generation_enrollment_owner_fk foreign key(owner_id)
  references public.language_legacy_evidence_enrollments(owner_id) deferrable initially deferred;

-- A single statement snapshot observes row, witness and current context together.
-- SQL NULL expected_marker means no assertion; the explicit {present,value} object
-- distinguishes an absent reset key from a present JSON null reset value.
create function language_legacy_evidence_private.read_status(expected_owner uuid,expected_marker jsonb) returns jsonb
language plpgsql stable security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare result jsonb;
begin
  perform language_legacy_evidence_private.assert_request(expected_owner,'139c003cd7b99e71a62dae22bd49d63524329c292bea6f953a9d1811a4045c0c');
  select pg_catalog.jsonb_build_object(
    'version',1,'ownerId',auth.uid(),'protocol','legacy-evidence-server-v1',
    'manifestRelease','legacy-curriculum-identity-v1','manifestDigest','139c003cd7b99e71a62dae22bd49d63524329c292bea6f953a9d1811a4045c0c',
    'statePresent',s.user_id is not null,'resetMarker',language_legacy_evidence_private.marker(s.state->'languageRecordResetV1'),
    'status',case when w.owner_id is null then 'unenrolled' when g.owner_id is null then 'enrolled_generation_missing' else 'enrolled' end,
    'enrollment',case when w.owner_id is null then null else pg_catalog.jsonb_build_object('creationRequestId',w.creation_request_id,'initialGenerationId',w.initial_generation_id) end,
    'currentContext',case when g.owner_id is null then null else language_legacy_evidence_private.context_json(g,pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp())) end,
    'integrity',not(g.owner_id is not null and w.owner_id is null)
       and (g.owner_id is null or (g.reset_marker is not distinct from s.state->'languageRecordResetV1'
         and g.protocol='legacy-evidence-server-v1' and language_legacy_evidence_private.timezone_valid(g.study_day_timezone)))
       and exists(select 1 from public.language_legacy_evidence_manifests m where m.release_id='legacy-curriculum-identity-v1'
         and m.manifest_digest='139c003cd7b99e71a62dae22bd49d63524329c292bea6f953a9d1811a4045c0c' and m.protocol='legacy-evidence-server-v1'))
  into result from (values(1)) q(n)
    left join public.language_user_state s on s.user_id=auth.uid()
    left join public.language_legacy_evidence_enrollments w on w.owner_id=auth.uid()
    left join public.language_legacy_evidence_generations g on g.owner_id=auth.uid();
  if result->'statePresent' is distinct from 'true'::jsonb then raise exception 'legacy_state_not_ready'; end if;
  if result->'integrity' is distinct from 'true'::jsonb then raise exception 'legacy_enrollment_integrity'; end if;
  if expected_marker is not null and result->'resetMarker' is distinct from expected_marker then raise exception 'legacy_marker_conflict'; end if;
  return result-'integrity';
end $$;

-- First enrollment and its witness commit atomically. Lock order stays owner advisory,
-- language row, generation row. No language row or lost enrolled generation is repaired.
create function language_legacy_evidence_private.enroll_v1(expected_owner uuid,creation_request_id uuid,expected_marker jsonb,proposed_timezone text,protocol text,manifest_release text,manifest_digest text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare marker jsonb; g public.language_legacy_evidence_generations; w public.language_legacy_evidence_enrollments;
  generation_present boolean; witness_present boolean; outcome text;
begin
  perform language_legacy_evidence_private.assert_request(expected_owner,manifest_digest);
  if protocol is distinct from 'legacy-evidence-server-v1' then raise exception 'legacy_unsupported_protocol'; end if;
  if manifest_release is distinct from 'legacy-curriculum-identity-v1' or not exists(
    select 1 from public.language_legacy_evidence_manifests m where m.release_id=manifest_release and m.manifest_digest=enroll_v1.manifest_digest and m.protocol=enroll_v1.protocol
  ) then raise exception 'legacy_unsupported_manifest'; end if;
  if creation_request_id is null or not language_legacy_evidence_private.timezone_valid(proposed_timezone) then raise exception 'legacy_invalid_enrollment'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-record-reset:'||auth.uid()::text,0));
  select s.state->'languageRecordResetV1' into marker from public.language_user_state s where s.user_id=auth.uid() for update;
  if not found then raise exception 'legacy_state_not_ready'; end if;
  if language_legacy_evidence_private.marker(marker) is distinct from expected_marker then raise exception 'legacy_marker_conflict'; end if;
  select * into g from public.language_legacy_evidence_generations x where x.owner_id=auth.uid() for update;
  generation_present:=found;
  select * into w from public.language_legacy_evidence_enrollments x where x.owner_id=auth.uid();
  witness_present:=found;
  if generation_present and not witness_present then raise exception 'legacy_enrollment_integrity'; end if;
  if witness_present then
    if not generation_present then
      if w.creation_request_id=creation_request_id then raise exception 'legacy_enrollment_stale'; end if;
      raise exception 'legacy_enrolled_generation_missing';
    end if;
    if g.reset_marker is distinct from marker or g.protocol is distinct from protocol or not language_legacy_evidence_private.timezone_valid(g.study_day_timezone) then raise exception 'legacy_enrollment_integrity'; end if;
    if w.creation_request_id=creation_request_id then
      if w.initial_generation_id<>g.generation_id then raise exception 'legacy_enrollment_stale'; end if;
      if g.study_day_timezone is distinct from proposed_timezone then raise exception 'legacy_enrollment_conflict'; end if;
      outcome:='enrolled';
    else outcome:='existing_enrollment'; end if;
  else
    insert into public.language_legacy_evidence_generations(owner_id,reset_marker,study_day_timezone,protocol)
      values(auth.uid(),marker,proposed_timezone,protocol) returning * into g;
    insert into public.language_legacy_evidence_enrollments(owner_id,creation_request_id,initial_generation_id)
      values(auth.uid(),creation_request_id,g.generation_id) returning * into w;
    outcome:='enrolled';
  end if;
  return pg_catalog.jsonb_build_object('version',1,'status',outcome,'creationRequestId',w.creation_request_id,
    'initialGenerationId',w.initial_generation_id,'currentContext',language_legacy_evidence_private.context_json(g,pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp())));
end $$;

-- Preserve the old context response shape if explicitly enabled later, but never
-- permit this compatibility initializer to avoid the witness or repair enrolled loss.
create or replace function language_legacy_evidence_private.get_context(expected_owner uuid,expected_marker jsonb,proposed_timezone text,protocol text,manifest_digest text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
begin
  return language_legacy_evidence_private.enroll_v1(expected_owner,pg_catalog.gen_random_uuid(),expected_marker,proposed_timezone,protocol,'legacy-curriculum-identity-v1',manifest_digest)->'currentContext';
end $$;

-- R4 remains exact-owner for EVERY enrolled marker change, including generation loss.
-- Unenrolled administrative marker changes still pass. This trigger never enrolls,
-- creates a generation, or acquires the advisory lock behind an already-held row lock.
create or replace function language_legacy_evidence_private.marker_reset() returns trigger
language plpgsql security definer set search_path='' as $$
declare existing_generation uuid; locked_generation uuid; witnessed boolean;
begin
  if tg_table_schema<>'public' or tg_table_name<>'language_user_state' or tg_relid<>'public.language_user_state'::pg_catalog.regclass or tg_op<>'UPDATE' or tg_when<>'AFTER' or tg_level<>'ROW' or old.user_id is distinct from new.user_id then raise exception 'legacy_auth_mismatch' using errcode='42501'; end if;
  if old.state->'languageRecordResetV1' is not distinct from new.state->'languageRecordResetV1' then return new; end if;
  select exists(select 1 from public.language_legacy_evidence_enrollments w where w.owner_id=new.user_id) into witnessed;
  select x.generation_id into existing_generation from public.language_legacy_evidence_generations x where x.owner_id=new.user_id;
  if not witnessed and existing_generation is null then return new; end if;
  if auth.uid() is null or auth.uid()<>old.user_id then raise exception 'legacy_auth_mismatch' using errcode='42501'; end if;
  if not witnessed then raise exception 'legacy_enrollment_integrity'; end if;
  if existing_generation is null then return new; end if;
  select x.generation_id into locked_generation from public.language_legacy_evidence_generations x where x.owner_id=new.user_id for update;
  if not found or locked_generation is distinct from existing_generation then raise exception 'legacy_stale_generation'; end if;
  delete from public.language_legacy_evidence_events x where x.owner_id=new.user_id and x.generation_id=locked_generation;
  update public.language_legacy_evidence_generations x set generation_id=pg_catalog.gen_random_uuid(),reset_marker=new.state->'languageRecordResetV1',prospective_started_at=pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()),last_server_sequence=0 where x.owner_id=new.user_id;
  if not found then raise exception 'legacy_stale_generation'; end if;
  return new;
end $$;

create function public.read_language_legacy_evidence_status(expected_owner uuid,expected_marker jsonb default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select language_legacy_evidence_private.read_status(expected_owner,expected_marker) $$;
create function public.enroll_language_legacy_evidence_v1(expected_owner uuid,creation_request_id uuid,expected_marker jsonb,proposed_timezone text,protocol text,manifest_release text,manifest_digest text) returns jsonb
language sql security invoker set search_path='' as $$ select language_legacy_evidence_private.enroll_v1(expected_owner,creation_request_id,expected_marker,proposed_timezone,protocol,manifest_release,manifest_digest) $$;

alter function language_legacy_evidence_private.read_status(uuid,jsonb) owner to language_legacy_evidence_executor;
alter function language_legacy_evidence_private.enroll_v1(uuid,uuid,jsonb,text,text,text,text) owner to language_legacy_evidence_executor;
-- Replacement preserves existing owners; assert those exact narrow owners explicitly.
alter function language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text) owner to language_legacy_evidence_executor;
alter function language_legacy_evidence_private.marker_reset() owner to language_legacy_evidence_reset_executor;
revoke all on function public.read_language_legacy_evidence_status(uuid,jsonb),language_legacy_evidence_private.read_status(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_language_legacy_evidence_status(uuid,jsonb),language_legacy_evidence_private.read_status(uuid,jsonb) to authenticated;

-- Server-side default denial, both schemas, old and new routes. Merely installing
-- this migration cannot cross the protocol-required rollback floor. No blanket grant.
revoke all on function
  public.get_language_legacy_evidence_context(uuid,jsonb,text,text,text),
  language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text),
  public.enroll_language_legacy_evidence_v1(uuid,uuid,jsonb,text,text,text,text),
  language_legacy_evidence_private.enroll_v1(uuid,uuid,jsonb,text,text,text,text),
  public.append_language_legacy_evidence(uuid,uuid,text,uuid,text,jsonb,text[]),
  language_legacy_evidence_private.append_events(uuid,uuid,text,uuid,text,jsonb,text[])
from public,anon,authenticated,service_role;
commit;
