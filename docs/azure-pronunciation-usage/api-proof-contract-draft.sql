-- LOCAL CONTRACT CANDIDATE ONLY. Not a migration or replacement for the reviewed
-- direct-DB candidate. No role/credential is created. Applying this draft WOULD
-- create API-callable functions if this schema is exposed; it is not applied.
-- Requires separately reviewed Data API boundaries and secret provisioning.
begin;
do $$
begin
 if exists(select 1 from pg_namespace where nspname='yeoni_speech_proof_candidate') then raise exception 'Speech API schema already exists; inspect rather than overwrite';end if;
 if not exists(select 1 from pg_roles where rolname='authenticated' and not rolcanlogin and not rolsuper and not rolbypassrls)
  or not exists(select 1 from pg_roles where rolname='anon' and not rolcanlogin and not rolsuper and not rolbypassrls)
  or not exists(select 1 from pg_roles where rolname='service_role') then raise exception 'Unexpected API role boundary';end if;
 if exists(select 1 from pg_roles where (rolsuper or rolbypassrls or rolcanlogin) and rolname<>'authenticated' and pg_has_role('authenticated',oid,'MEMBER')) then raise exception 'API role inherits privileged membership';end if;
 if to_regprocedure('auth.uid()') is null or to_regclass('auth.users') is null
  or to_regprocedure('extensions.hmac(bytea,bytea,text)') is null
  or to_regprocedure('extensions.digest(text,text)') is null or to_regclass('vault.decrypted_secrets') is null then raise exception 'Required existing auth/pgcrypto/Vault capability missing';end if;
 if has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') or has_table_privilege('anon','vault.decrypted_secrets','SELECT') then raise exception 'Unexpected API access to Vault secrets';end if;
end $$;
create schema yeoni_speech_proof_candidate;
revoke all on schema yeoni_speech_proof_candidate from public,anon,authenticated,service_role;
create table yeoni_speech_proof_candidate.keys (
  key_id text primary key check(key_id ~ '^[a-z0-9_-]{1,40}$'),
  vault_secret_id uuid not null,
  enabled boolean not null default false
);
create table yeoni_speech_proof_candidate.policy (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  allowed_owner uuid references auth.users(id) on delete set null,
  active_key_id text references yeoni_speech_proof_candidate.keys(key_id),
  policy_id text,
  api_boundary_reviewed_at timestamptz
);
insert into yeoni_speech_proof_candidate.policy(singleton) values(true);
alter table yeoni_speech_proof_candidate.keys enable row level security;
alter table yeoni_speech_proof_candidate.policy enable row level security;
revoke all on all tables in schema yeoni_speech_proof_candidate from public,anon,authenticated,service_role;

create function yeoni_speech_proof_candidate.authorized(
  p_action text,p_request_id uuid,p_payload_hash text,p_issued_at bigint,
  p_expires_at bigint,p_key_id text,p_mac text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); seconds bigint:=floor(extract(epoch from clock_timestamp()));
  secret bytea; encoded_key text; expected bytea; supplied bytea; content text; diff integer:=0; i integer;
begin
  if uid is null or p_action is null or p_action not in ('ready','consume','finish')
    or p_request_id is null or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or p_key_id is null or p_key_id !~ '^[a-z0-9_-]{1,40}$'
    or p_mac is null or p_mac !~ '^[0-9a-f]{64}$'
    or p_issued_at is null or p_expires_at is null or p_issued_at<0
    or p_expires_at>9007199254740991 or p_issued_at>seconds
    or p_expires_at<=seconds or p_expires_at<=p_issued_at or p_expires_at-p_issued_at>30
    then return false;end if;
  select v.decrypted_secret into encoded_key from yeoni_speech_proof_candidate.policy p
    join yeoni_speech_proof_candidate.keys k on k.key_id=p.active_key_id
    join vault.decrypted_secrets v on v.id=k.vault_secret_id
    where p.singleton and p.enabled and p.allowed_owner=uid and k.enabled
      and p.active_key_id=p_key_id and p.policy_id='trial-metadata-policy-v1'
      and p.api_boundary_reviewed_at is not null and p.api_boundary_reviewed_at<=clock_timestamp();
  if not found then return false;end if;
  if encoded_key is null or length(encoded_key)>88 or encoded_key !~ '^[A-Za-z0-9+/]+={0,2}$' then return false;end if;
  begin
   secret:=decode(encoded_key,'base64');
   if octet_length(secret)<32 or octet_length(secret)>64 or replace(encode(secret,'base64'),chr(10),'')<>encoded_key then return false;end if;
  exception when others then return false;end;
  content:='yeoni-speech-proof-v1'||chr(10)||p_key_id||chr(10)||p_action||chr(10)||uid::text
    ||chr(10)||p_request_id::text||chr(10)||p_payload_hash||chr(10)||p_issued_at::text
    ||chr(10)||p_expires_at::text||chr(10)||'trial-metadata-policy-v1';
  expected:=extensions.hmac(convert_to(content,'UTF8'),secret,'sha256');
  supplied:=decode(p_mac,'hex');
  -- Compare all 32 bytes without a prefix-dependent early return. This is not a
  -- claim of constant-time execution by the PostgreSQL engine/interpreter.
  for i in 0..31 loop diff:=diff | (get_byte(expected,i) # get_byte(supplied,i));end loop;
  return diff=0;
end $$;
revoke all on function yeoni_speech_proof_candidate.authorized(text,uuid,text,bigint,bigint,text,text) from public,anon,authenticated,service_role;
grant usage on schema yeoni_speech_proof_candidate to authenticated;
-- authorized remains private; only the three guarded wrappers are API-callable.

-- The wrappers below derive owner from auth.uid(), recompute the hash from their
-- exact typed arguments, verify BEFORE mutation and atomically deduplicate.

-- Separate API-boundary prototype: no LOGIN role and no direct table access.
-- Not approved for application. Policy/key provisioning remains a separate action.
create table yeoni_speech_proof_candidate.total (
 singleton boolean primary key default true check(singleton),
 consumed boolean not null default false,
 request_id uuid,
 payload_hash text,
 duration_ms integer,
 consumed_at timestamptz,
 finished boolean not null default false
);
insert into yeoni_speech_proof_candidate.total(singleton) values(true);
alter table yeoni_speech_proof_candidate.total enable row level security;
revoke all on yeoni_speech_proof_candidate.total from public,anon,authenticated,service_role;
create function yeoni_speech_proof_candidate.payload(p_duration integer,p_text text,p_audio_hash text)
returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to('trial-v1'||chr(10)||p_duration::text||chr(10)||p_text||chr(10)||p_audio_hash,'UTF8'),'sha256'),'hex')
$$;
revoke all on function yeoni_speech_proof_candidate.payload(integer,text,text) from public,anon,authenticated,service_role;
create function yeoni_speech_proof_candidate.consume(
 p_request_id uuid,p_duration integer,p_text text,p_audio_hash text,
 p_issued_at bigint,p_expires_at bigint,p_key_id text,p_mac text
) returns text language plpgsql security definer set search_path='' as $$
declare fingerprint text; previous yeoni_speech_proof_candidate.total%rowtype;
begin
 if p_duration is null or p_duration<1 or p_duration>5000 or p_text is distinct from 'こんにちは。'
  or p_audio_hash is null or p_audio_hash !~ '^[0-9a-f]{64}$' then return 'denied';end if;
 fingerprint:=yeoni_speech_proof_candidate.payload(p_duration,p_text,p_audio_hash);
 if not yeoni_speech_proof_candidate.authorized('consume',p_request_id,fingerprint,p_issued_at,p_expires_at,p_key_id,p_mac)
 then return 'denied';end if;
 select * into previous from yeoni_speech_proof_candidate.total where singleton for update;
 if not found then return 'denied';end if;
 if previous.consumed then
  if previous.request_id=p_request_id and previous.payload_hash=fingerprint then return 'duplicate';end if;
  return 'limit';
 end if;
 update yeoni_speech_proof_candidate.total set consumed=true,request_id=p_request_id,payload_hash=fingerprint,duration_ms=p_duration,consumed_at=clock_timestamp() where singleton;
 return 'accepted';
end $$;
revoke all on function yeoni_speech_proof_candidate.consume(uuid,integer,text,text,bigint,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function yeoni_speech_proof_candidate.consume(uuid,integer,text,text,bigint,bigint,text,text) to authenticated;
create function yeoni_speech_proof_candidate.ready(p_request_id uuid,p_issued_at bigint,p_expires_at bigint,p_key_id text,p_mac text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not yeoni_speech_proof_candidate.authorized('ready',p_request_id,encode(extensions.digest('ready','sha256'),'hex'),p_issued_at,p_expires_at,p_key_id,p_mac) then return false;end if;
 return exists(select 1 from yeoni_speech_proof_candidate.total where singleton and not consumed);
end $$;
create function yeoni_speech_proof_candidate.finish(p_request_id uuid,p_payload_hash text,p_issued_at bigint,p_expires_at bigint,p_key_id text,p_mac text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not yeoni_speech_proof_candidate.authorized('finish',p_request_id,p_payload_hash,p_issued_at,p_expires_at,p_key_id,p_mac) then return false;end if;
 update yeoni_speech_proof_candidate.total set finished=true where singleton and consumed and request_id=p_request_id and payload_hash=p_payload_hash;
 return found;
end $$;
revoke all on function yeoni_speech_proof_candidate.ready(uuid,bigint,bigint,text,text),yeoni_speech_proof_candidate.finish(uuid,text,bigint,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function yeoni_speech_proof_candidate.ready(uuid,bigint,bigint,text,text),yeoni_speech_proof_candidate.finish(uuid,text,bigint,bigint,text,text) to authenticated;
-- total contains no account identifier/FK: deleting an account or receipt cannot
-- refund the one-shot consumption. No TTL-based automatic refund is provided.
do $$
declare who text; object regclass; fn record;
begin
 foreach who in array array['anon','authenticated','service_role'] loop
  if has_schema_privilege(who,'yeoni_speech_proof_candidate','CREATE') then raise exception 'Unexpected API schema write access';end if;
  if who<>'authenticated' and has_schema_privilege(who,'yeoni_speech_proof_candidate','USAGE') then raise exception 'Unexpected API schema visibility';end if;
  foreach object in array array['yeoni_speech_proof_candidate.keys'::regclass,'yeoni_speech_proof_candidate.policy'::regclass,'yeoni_speech_proof_candidate.total'::regclass] loop
   if has_table_privilege(who,object,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Unexpected direct usage table access';end if;
  end loop;
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='yeoni_speech_proof_candidate' loop
   if has_function_privilege(who,fn.oid,'EXECUTE') is distinct from (who='authenticated' and fn.proname in ('ready','consume','finish')) then raise exception 'Unexpected API function access';end if;
  end loop;
 end loop;
 if exists(select 1 from yeoni_speech_proof_candidate.policy where enabled or allowed_owner is not null or active_key_id is not null or policy_id is not null or api_boundary_reviewed_at is not null)
  or exists(select 1 from yeoni_speech_proof_candidate.keys) then raise exception 'Migration must remain disabled without secrets';end if;
end $$;
commit;
