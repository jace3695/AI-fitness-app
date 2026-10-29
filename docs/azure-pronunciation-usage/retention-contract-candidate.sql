-- LOCAL RETENTION CONTRACT CANDIDATE — NOT AN APPLIED MIGRATION OR ACTIVATION.
-- Distinct v2 schema/proof; the current v1 deployment remains unchanged.
-- No credentials, login role, scheduler or reviewed policy values are installed.
-- The global marker starts consumed=true: installing this file cannot open a trial.
begin;
do $$
begin
 if exists(select 1 from pg_namespace where nspname='yeoni_speech_retention_candidate') then raise exception 'Speech API schema already exists; inspect rather than overwrite';end if;
 if not exists(select 1 from pg_roles where rolname='authenticated' and not rolcanlogin and not rolsuper and not rolbypassrls)
  or not exists(select 1 from pg_roles where rolname='anon' and not rolcanlogin and not rolsuper and not rolbypassrls)
  or not exists(select 1 from pg_roles where rolname='service_role') then raise exception 'Unexpected API role boundary';end if;
 if exists(select 1 from pg_roles where (rolsuper or rolbypassrls or rolcanlogin) and rolname<>'authenticated' and pg_has_role('authenticated',oid,'MEMBER')) then raise exception 'API role inherits privileged membership';end if;
 if to_regprocedure('auth.uid()') is null or to_regclass('auth.users') is null
  or to_regprocedure('extensions.hmac(bytea,bytea,text)') is null
  or to_regprocedure('extensions.digest(text,text)') is null or to_regclass('vault.decrypted_secrets') is null then raise exception 'Required existing auth/pgcrypto/Vault capability missing';end if;
 if has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') or has_table_privilege('anon','vault.decrypted_secrets','SELECT') then raise exception 'Unexpected API access to Vault secrets';end if;
end $$;
create schema yeoni_speech_retention_candidate;
revoke all on schema yeoni_speech_retention_candidate from public,anon,authenticated,service_role;
create table yeoni_speech_retention_candidate.keys (
  key_id text primary key check(key_id ~ '^[a-z0-9_-]{1,40}$'),
  vault_secret_id uuid not null,
  enabled boolean not null default false
);
create table yeoni_speech_retention_candidate.policy (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 allowed_owner uuid references auth.users(id) on delete cascade,
 active_key_id text references yeoni_speech_retention_candidate.keys(key_id),
 policy_id text,
 -- NULL is deliberate. No retention duration or permission is chosen here.
 metadata_retention_seconds integer check(metadata_retention_seconds > 30),
 authorization_expires_at timestamptz check(authorization_expires_at = date_trunc('second',authorization_expires_at)),
 review_artifact_sha256 text check(review_artifact_sha256 ~ '^[0-9a-f]{64}$'),
 api_boundary_reviewed_at timestamptz,
 deletion_path_reviewed_at timestamptz,
 cleanup_interval_seconds integer check(cleanup_interval_seconds>0),
 cleanup_start_delay_seconds integer check(cleanup_start_delay_seconds>=0),
 cleanup_run_timeout_seconds integer check(cleanup_run_timeout_seconds>0),
 cleanup_schedule_generation uuid,
 cleanup_last_completed_at timestamptz,
 cleanup_policy_hash text check(cleanup_policy_hash ~ '^[0-9a-f]{64}$')
);
insert into yeoni_speech_retention_candidate.policy(singleton) values(true);
-- No owner, request ID, payload/audio hash, timestamp, duration or score.
-- This is a global trial budget, NOT a per-person anonymous identifier.
create table yeoni_speech_retention_candidate.total (
 singleton boolean primary key default true check(singleton),
 consumed boolean not null default true
);
insert into yeoni_speech_retention_candidate.total(singleton) values(true);
create table yeoni_speech_retention_candidate.receipt (
 singleton boolean primary key default true check(singleton),
 owner_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
 duration_ms integer not null check(duration_ms between 1 and 5000),
 consumed_at timestamptz not null,
 expires_at timestamptz not null check(expires_at > consumed_at)
);
alter table yeoni_speech_retention_candidate.keys enable row level security;
alter table yeoni_speech_retention_candidate.policy enable row level security;
alter table yeoni_speech_retention_candidate.total enable row level security;
alter table yeoni_speech_retention_candidate.receipt enable row level security;
revoke all on all tables in schema yeoni_speech_retention_candidate from public,anon,authenticated,service_role;

create function yeoni_speech_retention_candidate.policy_hash(p_seconds integer,p_until timestamptz,p_review text,p_interval integer,p_delay integer,p_timeout integer)
returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to('trial-retention-policy-v2'||chr(10)||p_seconds::text||chr(10)
  ||floor(extract(epoch from p_until))::bigint::text||chr(10)||p_review||chr(10)||p_interval::text||chr(10)||p_delay::text||chr(10)||p_timeout::text,'UTF8'),'sha256'),'hex')
$$;
-- Operational schedule state contains no owner/request/audio fields. It is
-- independent of account deletion; policy must explicitly name its generation.
-- No schedule, generation or period is selected by installation.
create table yeoni_speech_retention_candidate.cleanup_health (
 singleton boolean primary key default true check(singleton),
 policy_hash text check(policy_hash ~ '^[0-9a-f]{64}$'),
 generation uuid,
 next_due_ms bigint check(next_due_ms between 0 and 9007199254740991),
 last_due_ms bigint check(last_due_ms between 0 and 9007199254740991),
 attempt_token uuid,
 attempt_started_ms bigint,
 attempt_deadline_ms bigint,
 healthy_until_ms bigint,
 last_observed_ms bigint,
 state text not null default 'unconfigured' check(state in ('unconfigured','closed','running','healthy','faulted'))
);
insert into yeoni_speech_retention_candidate.cleanup_health(singleton) values(true);
alter table yeoni_speech_retention_candidate.cleanup_health enable row level security;
revoke all on yeoni_speech_retention_candidate.cleanup_health from public,anon,authenticated,service_role;

-- Actual policy deletion clears only its matching operational generation. This
-- does not claim every later account deletion cascades: finish/purge may already
-- have detached allowed_owner. The global consumed marker is never touched.
create function yeoni_speech_retention_candidate.clear_deleted_policy_health()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update yeoni_speech_retention_candidate.cleanup_health set policy_hash=null,generation=null,next_due_ms=null,last_due_ms=null,
  attempt_token=null,attempt_started_ms=null,attempt_deadline_ms=null,healthy_until_ms=null,last_observed_ms=null,state='unconfigured'
  where singleton and generation=old.cleanup_schedule_generation;
 return old;
end $$;
create trigger clear_deleted_policy_health after delete on yeoni_speech_retention_candidate.policy
 for each row execute function yeoni_speech_retention_candidate.clear_deleted_policy_health();

-- Private helper, not an API endpoint. All paths take policy -> health locks.
-- Clock comparisons are observations of the DB wall clock, not a claim that SQL
-- can detect an unobserved clock jump or replace a reviewed clock/scheduler.
create function yeoni_speech_retention_candidate.cleanup_ready(p_policy_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare p yeoni_speech_retention_candidate.policy%rowtype; h yeoni_speech_retention_candidate.cleanup_health%rowtype; n bigint;
begin
 select * into p from yeoni_speech_retention_candidate.policy where singleton for update;
 if not found then return false;end if;
 select * into h from yeoni_speech_retention_candidate.cleanup_health where singleton for update;
 if not found then return false;end if;
 n:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 -- Reading health must never repair an incomplete certificate (for example a
 -- NULL observation becoming fresh on a second ready call). Latch malformed
 -- healthy rows before updating any clock observation.
 if h.state='healthy' and not coalesce(
   h.last_observed_ms is not null and h.last_due_ms is not null
   and h.attempt_started_ms is not null and h.attempt_deadline_ms is not null
   and h.last_observed_ms>=h.attempt_started_ms and h.attempt_started_ms>=h.last_due_ms
   and h.attempt_started_ms<=h.last_due_ms+p.cleanup_start_delay_seconds::bigint*1000
   and h.attempt_deadline_ms>h.attempt_started_ms
   and h.attempt_deadline_ms<=least(h.attempt_started_ms+p.cleanup_run_timeout_seconds::bigint*1000,h.last_due_ms+(p.cleanup_start_delay_seconds::bigint+p.cleanup_run_timeout_seconds::bigint)*1000)
   and h.healthy_until_ms is not null and h.healthy_until_ms<=9007199254740991
   and p.cleanup_schedule_generation is not null and p.cleanup_schedule_generation=h.generation
   and h.policy_hash=p_policy_hash and h.attempt_token is null
   and h.healthy_until_ms=h.last_due_ms+(p.cleanup_interval_seconds::bigint+p.cleanup_start_delay_seconds::bigint+p.cleanup_run_timeout_seconds::bigint)*1000
   and h.next_due_ms=h.last_due_ms+p.cleanup_interval_seconds::bigint*1000,false) then
  update yeoni_speech_retention_candidate.cleanup_health set state='faulted',healthy_until_ms=null,attempt_token=null where singleton;
  return false;
 end if;
 if h.last_observed_ms is not null and n<h.last_observed_ms then
  update yeoni_speech_retention_candidate.cleanup_health set state='faulted',healthy_until_ms=null,attempt_token=null where singleton;
  return false;
 end if;
 update yeoni_speech_retention_candidate.cleanup_health set last_observed_ms=n where singleton;
 return h.state='healthy' and h.last_observed_ms is not null and h.last_observed_ms>=h.last_due_ms
  and h.healthy_until_ms is not null and h.healthy_until_ms<=9007199254740991
  and p.cleanup_schedule_generation is not null
  and p.cleanup_schedule_generation=h.generation and h.policy_hash=p_policy_hash
  and h.attempt_token is null and h.last_due_ms is not null
  and h.healthy_until_ms=h.last_due_ms+(p.cleanup_interval_seconds::bigint+p.cleanup_start_delay_seconds::bigint+p.cleanup_run_timeout_seconds::bigint)*1000
  and h.next_due_ms=h.last_due_ms+p.cleanup_interval_seconds::bigint*1000
  and n>=h.last_due_ms and n<h.healthy_until_ms;
end $$;

create function yeoni_speech_retention_candidate.authorized(
 p_action text,p_request_id uuid,p_payload_hash text,p_policy_hash text,p_issued_at bigint,
 p_expires_at bigint,p_key_id text,p_mac text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); seconds bigint:=floor(extract(epoch from clock_timestamp()));
 policy yeoni_speech_retention_candidate.policy%rowtype;
 secret bytea; encoded_key text; expected bytea; supplied bytea; content text; diff integer:=0; i integer;
begin
 if uid is null or p_action is null or p_action not in ('ready','consume','finish')
  or p_request_id is null or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
  or p_policy_hash is null or p_policy_hash !~ '^[0-9a-f]{64}$'
  or p_key_id is null or p_key_id !~ '^[a-z0-9_-]{1,40}$'
  or p_mac is null or p_mac !~ '^[0-9a-f]{64}$'
  or p_issued_at is null or p_expires_at is null or p_issued_at<0
  or p_expires_at>9007199254740991 or p_issued_at>seconds
  or p_expires_at<=seconds or p_expires_at<=p_issued_at or p_expires_at-p_issued_at>30
  then return false;end if;
 -- A stale JWT for a hard-deleted account is insufficient. Keep the user row
 -- through this transaction so receipt creation cannot race a completed delete.
 perform 1 from auth.users where id=uid for key share;
 if not found then return false;end if;
 -- Lock in one order before consume/finish. This does not attest to remote
 -- multi-session stress testing; it is a candidate transaction design.
 select * into policy from yeoni_speech_retention_candidate.policy where singleton for update;
 if not found or not policy.enabled or policy.allowed_owner is distinct from uid
  or policy.policy_id is distinct from 'trial-retention-policy-v2'
  or policy.metadata_retention_seconds is null or policy.metadata_retention_seconds<=30
  or policy.authorization_expires_at is null or policy.authorization_expires_at<=clock_timestamp()
  or policy.review_artifact_sha256 is null
  or policy.api_boundary_reviewed_at is null or policy.api_boundary_reviewed_at>clock_timestamp()
  or policy.deletion_path_reviewed_at is null or policy.deletion_path_reviewed_at>clock_timestamp()
  or policy.cleanup_interval_seconds is null or policy.cleanup_start_delay_seconds is null or policy.cleanup_run_timeout_seconds is null
  or p_policy_hash is distinct from yeoni_speech_retention_candidate.policy_hash(policy.metadata_retention_seconds,policy.authorization_expires_at,policy.review_artifact_sha256,policy.cleanup_interval_seconds,policy.cleanup_start_delay_seconds,policy.cleanup_run_timeout_seconds)
  then return false;end if;
 -- Dispatch requires a certified nominal-due lease, never recent purge alone.
 -- Finish remains independent so stale scheduler health cannot block deletion.
 if p_action<>'finish' and not coalesce(yeoni_speech_retention_candidate.cleanup_ready(p_policy_hash),false) then return false;end if;
 select v.decrypted_secret into encoded_key from yeoni_speech_retention_candidate.keys k
  join vault.decrypted_secrets v on v.id=k.vault_secret_id
  where k.key_id=policy.active_key_id and k.key_id=p_key_id and k.enabled;
 if not found then return false;end if;
 if encoded_key is null or length(encoded_key)>88 or encoded_key !~ '^[A-Za-z0-9+/]+={0,2}$' then return false;end if;
 begin
  secret:=decode(encoded_key,'base64');
  if octet_length(secret)<32 or octet_length(secret)>64 or replace(encode(secret,'base64'),chr(10),'')<>encoded_key then return false;end if;
 exception when others then return false;end;
 content:='yeoni-speech-retention-proof-v2'||chr(10)||p_key_id||chr(10)||p_action||chr(10)||uid::text
  ||chr(10)||p_request_id::text||chr(10)||p_payload_hash||chr(10)||p_issued_at::text
  ||chr(10)||p_expires_at::text||chr(10)||'trial-retention-policy-v2'||chr(10)||p_policy_hash;
 expected:=extensions.hmac(convert_to(content,'UTF8'),secret,'sha256');supplied:=decode(p_mac,'hex');
 for i in 0..31 loop diff:=diff | (get_byte(expected,i) # get_byte(supplied,i));end loop;
 -- All bytes compared; no claim of constant-time PostgreSQL execution.
 -- Locks may have waited after the entry check. Never authenticate an expired
 -- proof merely because it was fresh before waiting.
 seconds:=floor(extract(epoch from clock_timestamp()));
 return diff=0 and p_issued_at<=seconds and p_expires_at>seconds;
end $$;
create function yeoni_speech_retention_candidate.payload(p_duration integer,p_text text,p_audio_hash text)
returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to('trial-v1'||chr(10)||p_duration::text||chr(10)||p_text||chr(10)||p_audio_hash,'UTF8'),'sha256'),'hex')
$$;
create function yeoni_speech_retention_candidate.consume(
 p_request_id uuid,p_duration integer,p_text text,p_audio_hash text,p_policy_hash text,
 p_issued_at bigint,p_expires_at bigint,p_key_id text,p_mac text
) returns text language plpgsql security definer set search_path='' as $$
declare fingerprint text; previous boolean; policy yeoni_speech_retention_candidate.policy%rowtype; at_time timestamptz;
begin
 if p_duration is null or p_duration<1 or p_duration>5000 or p_text is distinct from 'こんにちは。'
  or p_audio_hash is null or p_audio_hash !~ '^[0-9a-f]{64}$' then return 'denied';end if;
 fingerprint:=yeoni_speech_retention_candidate.payload(p_duration,p_text,p_audio_hash);
 if not yeoni_speech_retention_candidate.authorized('consume',p_request_id,fingerprint,p_policy_hash,p_issued_at,p_expires_at,p_key_id,p_mac) then return 'denied';end if;
 select consumed into previous from yeoni_speech_retention_candidate.total where singleton for update;
 if not found then return 'denied';end if;
 if p_issued_at>floor(extract(epoch from clock_timestamp())) or p_expires_at<=floor(extract(epoch from clock_timestamp())) then return 'denied';end if;
 if not coalesce(yeoni_speech_retention_candidate.cleanup_ready(p_policy_hash),false) then return 'denied';end if;
 -- Recheck after all locks, immediately before duplicate/consumption decisions.
 if p_expires_at<=floor(extract(epoch from clock_timestamp())) then return 'denied';end if;
 if previous then
  if exists(select 1 from yeoni_speech_retention_candidate.receipt where singleton and owner_id=auth.uid()
   and request_id=p_request_id and payload_hash=fingerprint and expires_at>clock_timestamp()) then return 'duplicate';end if;
  return 'limit';
 end if;
 if exists(select 1 from yeoni_speech_retention_candidate.receipt) then return 'denied';end if;
 select * into policy from yeoni_speech_retention_candidate.policy where singleton;
 at_time:=clock_timestamp();
 -- The existing handler has a 30-second total deadline; do not start near the
 -- authorization window's end. This is a technical minimum, not a chosen TTL.
 if policy.authorization_expires_at<=at_time+interval '30 seconds' then return 'denied';end if;
 update yeoni_speech_retention_candidate.total set consumed=true where singleton;
 insert into yeoni_speech_retention_candidate.receipt(singleton,owner_id,request_id,payload_hash,duration_ms,consumed_at,expires_at)
  values(true,auth.uid(),p_request_id,fingerprint,p_duration,at_time,
   least(at_time+make_interval(secs=>policy.metadata_retention_seconds),policy.authorization_expires_at));
 return 'accepted';
end $$;
create function yeoni_speech_retention_candidate.ready(p_request_id uuid,p_policy_hash text,p_issued_at bigint,p_expires_at bigint,p_key_id text,p_mac text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not yeoni_speech_retention_candidate.authorized('ready',p_request_id,encode(extensions.digest('ready','sha256'),'hex'),p_policy_hash,p_issued_at,p_expires_at,p_key_id,p_mac) then return false;end if;
 return p_expires_at>floor(extract(epoch from clock_timestamp()))
  and coalesce(yeoni_speech_retention_candidate.cleanup_ready(p_policy_hash),false)
  and exists(select 1 from yeoni_speech_retention_candidate.total where singleton and not consumed)
  and not exists(select 1 from yeoni_speech_retention_candidate.receipt)
  and exists(select 1 from yeoni_speech_retention_candidate.policy where singleton and authorization_expires_at>clock_timestamp()+interval '30 seconds');
end $$;
create function yeoni_speech_retention_candidate.finish(p_request_id uuid,p_payload_hash text,p_policy_hash text,p_issued_at bigint,p_expires_at bigint,p_key_id text,p_mac text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not yeoni_speech_retention_candidate.authorized('finish',p_request_id,p_payload_hash,p_policy_hash,p_issued_at,p_expires_at,p_key_id,p_mac) then return false;end if;
 if not exists(select 1 from yeoni_speech_retention_candidate.total where singleton and consumed) then return false;end if;
 delete from yeoni_speech_retention_candidate.receipt where singleton and owner_id=auth.uid()
  and request_id=p_request_id and payload_hash=p_payload_hash and expires_at>clock_timestamp();
 if not found then return false;end if;
 -- Finish erases request metadata rather than retaining a finished flag.
 -- A lost response remains uncertain; repeating finish does not reconstruct it.
 update yeoni_speech_retention_candidate.policy set enabled=false,allowed_owner=null where singleton;
 return true;
end $$;
-- Owner/maintenance only. No scheduler is installed, and no hard deletion
-- deadline is claimed until a runner, maximum delay and alerts are reviewed.
-- Runs while policy/key is OFF; never refunds the global consumed marker.
create function yeoni_speech_retention_candidate.purge_expired()
returns integer language plpgsql security definer set search_path='' as $$
declare deleted integer; at_time timestamptz;
begin
 perform 1 from yeoni_speech_retention_candidate.policy where singleton for update;
 at_time:=clock_timestamp();
 delete from yeoni_speech_retention_candidate.receipt where expires_at<=at_time;
 get diagnostics deleted=row_count;
 update yeoni_speech_retention_candidate.policy set enabled=false,allowed_owner=null
  where singleton and (deleted>0 or authorization_expires_at<=at_time);
 -- Deletion alone must not refresh readiness under an unreviewed/old runner.
 return deleted;
end $$;
-- Fixed private bridge for an injected, separately authorized maintenance
-- capability. It is NOT exposed to authenticated/anon/service_role callers.
-- Recent completion is necessary, not proof of timely/future scheduler health.
-- The local runner independently tracks nominal due time; no scheduler is installed.
create function yeoni_speech_retention_candidate.maintenance(p_policy_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare started_at timestamptz:=clock_timestamp(); deleted integer; confirmed text;
 current_policy yeoni_speech_retention_candidate.policy%rowtype; completed_at timestamptz;
begin
 if p_policy_hash is null or p_policy_hash !~ '^[0-9a-f]{64}$' then
  return jsonb_build_object('policyHash',null,'deletedRows',0);
 end if;
 -- Hold the same policy lock while checking the requested contract, deleting,
 -- and publishing a heartbeat. An old runner may delete expired metadata but
 -- cannot make a newly configured policy ready.
 select * into current_policy from yeoni_speech_retention_candidate.policy where singleton for update;
 deleted:=yeoni_speech_retention_candidate.purge_expired();
 completed_at:=clock_timestamp();
 if current_policy.metadata_retention_seconds is not null and current_policy.authorization_expires_at is not null
  and current_policy.review_artifact_sha256 is not null and current_policy.cleanup_interval_seconds is not null
  and current_policy.cleanup_start_delay_seconds is not null and current_policy.cleanup_run_timeout_seconds is not null
  and completed_at>=started_at and completed_at<=started_at+make_interval(secs=>current_policy.cleanup_run_timeout_seconds)
  and p_policy_hash=yeoni_speech_retention_candidate.policy_hash(current_policy.metadata_retention_seconds,current_policy.authorization_expires_at,current_policy.review_artifact_sha256,current_policy.cleanup_interval_seconds,current_policy.cleanup_start_delay_seconds,current_policy.cleanup_run_timeout_seconds) then
  update yeoni_speech_retention_candidate.policy set cleanup_last_completed_at=completed_at,cleanup_policy_hash=p_policy_hash where singleton;
  confirmed:=p_policy_hash;
 end if;
 return jsonb_build_object('policyHash',confirmed,'deletedRows',deleted);
end $$;
-- Two separately committed calls are required by the reviewed driver contract.
-- A begin first closes health, then attempts deletion. Ordinary purge failures
-- roll back only that inner block, so a returned failure can commit closed state.
-- Transport/transaction cancellation can still be uncertain: prior leases expire.
create function yeoni_speech_retention_candidate.maintenance_begin(p_policy_hash text,p_generation uuid,p_due_ms bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entered_ms bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 n bigint; observed_ms bigint; deadline bigint; until_ms bigint; deleted integer:=0; token uuid;
 p yeoni_speech_retention_candidate.policy%rowtype; h yeoni_speech_retention_candidate.cleanup_health%rowtype;
 denied jsonb:=jsonb_build_object('policyHash',p_policy_hash,'generation',p_generation,'token',null,'dueAtMs',p_due_ms,'deadlineAtMs',null,'validUntilMs',null,'deletedRows',0);
begin
 if p_policy_hash is null or p_policy_hash !~ '^[0-9a-f]{64}$' or p_generation is null or p_due_ms is null or p_due_ms<0 or p_due_ms>9007199254740991 then return denied;end if;
 select * into p from yeoni_speech_retention_candidate.policy where singleton for update;
 select * into h from yeoni_speech_retention_candidate.cleanup_health where singleton for update;
 if not found or p.singleton is null or p.cleanup_schedule_generation is distinct from p_generation
  or h.generation is distinct from p_generation or h.policy_hash is distinct from p_policy_hash
  or p_policy_hash is distinct from yeoni_speech_retention_candidate.policy_hash(p.metadata_retention_seconds,p.authorization_expires_at,p.review_artifact_sha256,p.cleanup_interval_seconds,p.cleanup_start_delay_seconds,p.cleanup_run_timeout_seconds) then
  -- Wrong generations must not revoke a newer runner's lease. Deletion remains
  -- independently available via private purge; this call cannot certify health.
  return denied;
 end if;
 n:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 update yeoni_speech_retention_candidate.cleanup_health set state='closed',healthy_until_ms=null,attempt_token=null where singleton;
 if h.state='faulted' or n<entered_ms or (h.last_observed_ms is not null and n<h.last_observed_ms) then
  update yeoni_speech_retention_candidate.cleanup_health set state='faulted' where singleton;
  return denied;
 end if;
 update yeoni_speech_retention_candidate.cleanup_health set last_observed_ms=n where singleton;
 observed_ms:=n;
 begin
  deleted:=yeoni_speech_retention_candidate.purge_expired();
 exception when others then
  -- No raw error/row/body is returned. The outer close is not in this block.
  return denied;
 end;
 denied:=jsonb_set(denied,'{deletedRows}',to_jsonb(deleted));
 n:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if n<observed_ms then update yeoni_speech_retention_candidate.cleanup_health set state='faulted' where singleton;return denied;end if;
 deadline:=least(entered_ms+p.cleanup_run_timeout_seconds::bigint*1000,p_due_ms+(p.cleanup_start_delay_seconds::bigint+p.cleanup_run_timeout_seconds::bigint)*1000);
 until_ms:=p_due_ms+(p.cleanup_interval_seconds::bigint+p.cleanup_start_delay_seconds::bigint+p.cleanup_run_timeout_seconds::bigint)*1000;
 if h.next_due_ms is distinct from p_due_ms or h.state='unconfigured'
  or (h.state='running' and (h.attempt_token is null or h.attempt_started_ms is null or h.attempt_deadline_ms is null
    or h.last_due_ms is null or h.last_observed_ms is null or h.attempt_deadline_ms<=h.attempt_started_ms
    or h.next_due_ms is distinct from h.last_due_ms+p.cleanup_interval_seconds::bigint*1000
    or h.attempt_deadline_ms>entered_ms))
  or entered_ms<p_due_ms or entered_ms>p_due_ms+p.cleanup_start_delay_seconds::bigint*1000
  or n<entered_ms or n>=deadline or until_ms>9007199254740991
  or p_due_ms+p.cleanup_interval_seconds::bigint*1000>9007199254740991 then return denied;end if;
 token:=pg_catalog.gen_random_uuid();
 update yeoni_speech_retention_candidate.cleanup_health set state='running',last_due_ms=p_due_ms,
  next_due_ms=p_due_ms+p.cleanup_interval_seconds::bigint*1000,attempt_token=token,
  attempt_started_ms=entered_ms,attempt_deadline_ms=deadline,last_observed_ms=n where singleton;
 return jsonb_build_object('policyHash',p_policy_hash,'generation',p_generation,'token',token,'dueAtMs',p_due_ms,'deadlineAtMs',deadline,'validUntilMs',until_ms,'deletedRows',deleted);
end $$;
create function yeoni_speech_retention_candidate.maintenance_finalize(p_policy_hash text,p_generation uuid,p_token uuid,p_due_ms bigint,p_healthy boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p yeoni_speech_retention_candidate.policy%rowtype; h yeoni_speech_retention_candidate.cleanup_health%rowtype; n bigint; until_ms bigint;
 denied jsonb:=jsonb_build_object('confirmed',false,'validUntilMs',null);
begin
 if p_policy_hash is null or p_policy_hash !~ '^[0-9a-f]{64}$' or p_generation is null or p_token is null or p_due_ms is null or p_due_ms<0 or p_due_ms>9007199254740991 then return denied;end if;
 select * into p from yeoni_speech_retention_candidate.policy where singleton for update;
 select * into h from yeoni_speech_retention_candidate.cleanup_health where singleton for update;
 if not found or p.singleton is null or p.cleanup_schedule_generation is distinct from p_generation
  or h.generation is distinct from p_generation or h.policy_hash is distinct from p_policy_hash
  or h.attempt_token is null or h.attempt_token is distinct from p_token or h.last_due_ms is distinct from p_due_ms
  or h.state<>'running' then return denied;end if;
 n:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 update yeoni_speech_retention_candidate.cleanup_health set state='closed',healthy_until_ms=null,attempt_token=null where singleton;
 if h.attempt_started_ms is null or h.attempt_deadline_ms is null or h.last_observed_ms is null
  or h.attempt_started_ms<p_due_ms or h.attempt_started_ms>p_due_ms+p.cleanup_start_delay_seconds::bigint*1000
  or h.attempt_deadline_ms<=h.attempt_started_ms
  or h.attempt_deadline_ms>least(h.attempt_started_ms+p.cleanup_run_timeout_seconds::bigint*1000,p_due_ms+(p.cleanup_start_delay_seconds::bigint+p.cleanup_run_timeout_seconds::bigint)*1000)
  or h.last_observed_ms<h.attempt_started_ms then return denied;end if;
 if n<h.last_observed_ms or n<h.attempt_started_ms then
  update yeoni_speech_retention_candidate.cleanup_health set state='faulted' where singleton;return denied;
 end if;
 update yeoni_speech_retention_candidate.cleanup_health set last_observed_ms=n where singleton;
 until_ms:=p_due_ms+(p.cleanup_interval_seconds::bigint+p.cleanup_start_delay_seconds::bigint+p.cleanup_run_timeout_seconds::bigint)*1000;
 if p_healthy is distinct from true or n>=h.attempt_deadline_ms or n>=until_ms
  or p_policy_hash is distinct from yeoni_speech_retention_candidate.policy_hash(p.metadata_retention_seconds,p.authorization_expires_at,p.review_artifact_sha256,p.cleanup_interval_seconds,p.cleanup_start_delay_seconds,p.cleanup_run_timeout_seconds)
  or h.next_due_ms is distinct from p_due_ms+p.cleanup_interval_seconds::bigint*1000 then return denied;end if;
 update yeoni_speech_retention_candidate.cleanup_health set state='healthy',healthy_until_ms=until_ms where singleton;
 return jsonb_build_object('confirmed',true,'validUntilMs',until_ms);
end $$;

revoke all on all functions in schema yeoni_speech_retention_candidate from public,anon,authenticated,service_role;
grant usage on schema yeoni_speech_retention_candidate to authenticated;
grant execute on function yeoni_speech_retention_candidate.consume(uuid,integer,text,text,text,bigint,bigint,text,text),
 yeoni_speech_retention_candidate.ready(uuid,text,bigint,bigint,text,text),
 yeoni_speech_retention_candidate.finish(uuid,text,text,bigint,bigint,text,text) to authenticated;
do $$
declare who text; object regclass; fn record;
begin
 foreach who in array array['anon','authenticated','service_role'] loop
  if has_schema_privilege(who,'yeoni_speech_retention_candidate','CREATE') then raise exception 'Unexpected API schema write access';end if;
  if who<>'authenticated' and has_schema_privilege(who,'yeoni_speech_retention_candidate','USAGE') then raise exception 'Unexpected API schema visibility';end if;
  foreach object in array array['yeoni_speech_retention_candidate.keys'::regclass,'yeoni_speech_retention_candidate.policy'::regclass,'yeoni_speech_retention_candidate.total'::regclass,'yeoni_speech_retention_candidate.receipt'::regclass,'yeoni_speech_retention_candidate.cleanup_health'::regclass] loop
   if has_table_privilege(who,object,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Unexpected direct usage table access';end if;
  end loop;
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='yeoni_speech_retention_candidate' loop
   if has_function_privilege(who,fn.oid,'EXECUTE') is distinct from (who='authenticated' and fn.proname in ('ready','consume','finish')) then raise exception 'Unexpected API function access';end if;
  end loop;
 end loop;
 if exists(select 1 from yeoni_speech_retention_candidate.policy where enabled or allowed_owner is not null or active_key_id is not null
  or policy_id is not null or metadata_retention_seconds is not null or authorization_expires_at is not null
  or review_artifact_sha256 is not null or api_boundary_reviewed_at is not null or deletion_path_reviewed_at is not null
  or cleanup_schedule_generation is not null or cleanup_interval_seconds is not null or cleanup_start_delay_seconds is not null or cleanup_run_timeout_seconds is not null or cleanup_last_completed_at is not null or cleanup_policy_hash is not null)
  or not exists(select 1 from yeoni_speech_retention_candidate.cleanup_health where singleton and state='unconfigured' and policy_hash is null and generation is null and next_due_ms is null and last_due_ms is null and attempt_token is null and attempt_started_ms is null and attempt_deadline_ms is null and healthy_until_ms is null and last_observed_ms is null)
  or exists(select 1 from yeoni_speech_retention_candidate.keys)
  or exists(select 1 from yeoni_speech_retention_candidate.receipt)
  or not exists(select 1 from yeoni_speech_retention_candidate.total where singleton and consumed)
  then raise exception 'Candidate must install disabled and consumed, without policy or secrets';end if;
end $$;
commit;
