-- LOCAL, UNAPPLIED EXECUTOR CANDIDATE. NOT AN APPROVED INSTALLATION/MIGRATION.
-- Depends on frozen 8066 retention schema/functions. No role, GRANT, cron job,
-- network call, credential, policy value, generation or schedule is installed.
-- Runtime invocation must be exactly ONE top-level CALL, not BEGIN/CALL/COMMIT
-- and not SET ...; CALL ... in one pg_cron command. Never execute this file live
-- merely because static/pure tests pass.
begin;
do $preflight$
begin
 if pg_catalog.to_regprocedure('yeoni_speech_retention_candidate.maintenance_begin(text,uuid,bigint)') is null
  or pg_catalog.to_regprocedure('yeoni_speech_retention_candidate.maintenance_finalize(text,uuid,uuid,bigint,boolean)') is null
  or pg_catalog.to_regprocedure('yeoni_speech_retention_candidate.purge_expired()') is null
  then raise exception 'Required frozen retention contract missing';end if;
 if pg_catalog.to_regprocedure('yeoni_speech_retention_candidate.db_executor_begin_candidate()') is not null
  or pg_catalog.to_regprocedure('yeoni_speech_retention_candidate.db_executor_finalize_candidate(jsonb)') is not null
  or pg_catalog.to_regprocedure('yeoni_speech_retention_candidate.db_executor_tick_candidate()') is not null
  then raise exception 'Executor candidate already exists; inspect rather than overwrite';end if;
end $preflight$;

-- A no-argument definer capability reads only the fixed schedule, never an
-- arbitrary due/current-time substitution supplied by a caller. It does not
-- expose owner/request/audio/score or credentials.
create function yeoni_speech_retention_candidate.db_executor_begin_candidate()
returns jsonb language plpgsql security definer set search_path='' as $begin_phase$
declare p record; h yeoni_speech_retention_candidate.cleanup_health%rowtype; requested_hash text;
begin
 select singleton,metadata_retention_seconds,authorization_expires_at,review_artifact_sha256,
  cleanup_interval_seconds,cleanup_start_delay_seconds,cleanup_run_timeout_seconds,cleanup_schedule_generation
 into p from yeoni_speech_retention_candidate.policy where singleton for update;
 select * into h from yeoni_speech_retention_candidate.cleanup_health where singleton for update;
 requested_hash:=yeoni_speech_retention_candidate.policy_hash(p.metadata_retention_seconds,p.authorization_expires_at,p.review_artifact_sha256,
  p.cleanup_interval_seconds,p.cleanup_start_delay_seconds,p.cleanup_run_timeout_seconds);
 if p.singleton is null or h.singleton is null or requested_hash is null
  or p.cleanup_schedule_generation is null or h.generation is distinct from p.cleanup_schedule_generation
  or h.policy_hash is distinct from requested_hash or h.next_due_ms is null or h.state in ('unconfigured','faulted') then
  -- Cleanup is independent of admission/provider/key flags. No certification is
  -- attempted when the schedule is unarmed/faulted. This is one best-effort purge,
  -- not an automatic retry of a failed maintenance_begin.
  begin
   perform yeoni_speech_retention_candidate.purge_expired();
  exception when others then
   return null; -- Outer procedure commits only work that actually survived.
  end;
  return null;
 end if;
 -- Existing begin closes health before its isolated purge block and enforces
 -- persisted nominal due/generation. It does not shift a missed due to now().
 return yeoni_speech_retention_candidate.maintenance_begin(requested_hash,h.generation,h.next_due_ms);
end $begin_phase$;

-- No caller-supplied healthy=true. This DB-only alternative evaluates a wall
-- clock contract itself. It is NOT equivalent to the TS wall+monotonic runner.
-- A reviewed executor/clock artifact must be bound through existing policy
-- review/hash before any future activation; no such approval is created here.
create function yeoni_speech_retention_candidate.db_executor_finalize_candidate(p_lease jsonb)
returns boolean language plpgsql security definer set search_path='' as $finalize_phase$
declare key_count integer; keys_ok boolean; due_ms bigint; deadline_ms bigint; until_ms bigint;
 n bigint; call_started_ms bigint; q integer; timeout_ms bigint; healthy boolean; result jsonb;
begin
 if p_lease is null or pg_catalog.jsonb_typeof(p_lease) is distinct from 'object' then return false;end if;
 select count(*),bool_and(key in ('policyHash','generation','token','dueAtMs','deadlineAtMs','validUntilMs','deletedRows'))
 into key_count,keys_ok from pg_catalog.jsonb_object_keys(p_lease) as fields(key);
 if key_count<>7 or not keys_ok
  or pg_catalog.jsonb_typeof(p_lease->'policyHash') is distinct from 'string'
  or (p_lease->>'policyHash') !~ '^[0-9a-f]{64}$'
  or pg_catalog.jsonb_typeof(p_lease->'generation') is distinct from 'string'
  or (p_lease->>'generation') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or pg_catalog.jsonb_typeof(p_lease->'token') is distinct from 'string'
  or (p_lease->>'token') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or pg_catalog.jsonb_typeof(p_lease->'dueAtMs') is distinct from 'number'
  or pg_catalog.jsonb_typeof(p_lease->'deadlineAtMs') is distinct from 'number'
  or pg_catalog.jsonb_typeof(p_lease->'validUntilMs') is distinct from 'number'
  or (p_lease->>'dueAtMs') !~ '^[0-9]{1,16}$'
  or (p_lease->>'deadlineAtMs') !~ '^[0-9]{1,16}$'
  or (p_lease->>'validUntilMs') !~ '^[0-9]{1,16}$'
  or p_lease->'deletedRows' not in ('0'::jsonb,'1'::jsonb) then return false;end if;
 due_ms:=(p_lease->>'dueAtMs')::bigint;deadline_ms:=(p_lease->>'deadlineAtMs')::bigint;until_ms:=(p_lease->>'validUntilMs')::bigint;
 if due_ms>9007199254740991 or deadline_ms>9007199254740991 or until_ms>9007199254740991 then return false;end if;
 select cleanup_run_timeout_seconds into q from yeoni_speech_retention_candidate.policy where singleton for update;
 -- Read only the nonsecret timer metadata. This does NOT configure a timeout or
 -- prove that the managed cron launch mode armed it; that needs actual testing.
 select case when setting ~ '^[0-9]+$' and unit='ms' then setting::bigint else null end
 into timeout_ms from pg_catalog.pg_settings where name='statement_timeout';
 n:=floor(extract(epoch from pg_catalog.clock_timestamp())*1000)::bigint;
 call_started_ms:=floor(extract(epoch from pg_catalog.statement_timestamp())*1000)::bigint;
 healthy:=coalesce(q>0 and timeout_ms>0 and timeout_ms<=q::bigint*1000
  and n>=call_started_ms and n-call_started_ms<q::bigint*1000
  and n>=due_ms and n<deadline_ms and n<until_ms,false);
 -- The frozen function rechecks current policy/hash, generation, one-shot token,
 -- stored deadline, observed clock and nominal arithmetic under its locks.
 result:=yeoni_speech_retention_candidate.maintenance_finalize(p_lease->>'policyHash',(p_lease->>'generation')::uuid,
  (p_lease->>'token')::uuid,due_ms,healthy);
 return coalesce(result->'confirmed'='true'::jsonb,false);
end $finalize_phase$;

-- SECURITY INVOKER and NO procedure SET clause are deliberate PostgreSQL
-- requirements for internal COMMIT. Full object qualification avoids adding a
-- procedure SET search_path clause. Each exception block ends BEFORE COMMIT.
create procedure yeoni_speech_retention_candidate.db_executor_tick_candidate()
language plpgsql security invoker as $driver$
declare lease pg_catalog.jsonb; confirmed boolean:=false; phase_failed boolean:=false;
begin
 begin
  lease:=yeoni_speech_retention_candidate.db_executor_begin_candidate();
 exception when others then
  phase_failed:=true;
 end;
 commit; -- First durable boundary: purge/closed state that survived phase one.
 if phase_failed or lease is null or pg_catalog.jsonb_extract_path_text(lease,'token') is null then
  raise exception 'Retention maintenance unconfirmed';
 end if;
 begin
  confirmed:=yeoni_speech_retention_candidate.db_executor_finalize_candidate(lease);
 exception when others then
  phase_failed:=true;
 end;
 commit; -- Second durable boundary. Ack loss is NOT rollback of this commit.
 if phase_failed or not confirmed then raise exception 'Retention maintenance unconfirmed';end if;
 -- No token/body/score output or success notice. A late/unknown final commit can
 -- leave a finite lease; this does not promise Q-bound physical commit completion.
end $driver$;

-- No execution capability is granted. Future minimum-role grants are a separate
-- reviewed installation, not part of this candidate. Existing API roles stay out.
revoke all on function yeoni_speech_retention_candidate.db_executor_begin_candidate(),
 yeoni_speech_retention_candidate.db_executor_finalize_candidate(jsonb)
 from public,anon,authenticated,service_role;
revoke all on procedure yeoni_speech_retention_candidate.db_executor_tick_candidate()
 from public,anon,authenticated,service_role;
-- REVOKE is not enough if an API role inherits a default-granted capability.
-- Abort the whole install rather than changing role membership/default grants.
do $postcondition$
declare who text; routine text;
begin
 foreach who in array array['anon','authenticated','service_role'] loop
  foreach routine in array array['db_executor_begin_candidate()','db_executor_finalize_candidate(jsonb)','db_executor_tick_candidate()'] loop
   if pg_catalog.has_function_privilege(who,'yeoni_speech_retention_candidate.'||routine,'EXECUTE') then
    raise exception 'Unexpected API executor access';
   end if;
  end loop;
 end loop;
end $postcondition$;
commit;
