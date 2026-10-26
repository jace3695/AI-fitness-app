-- REVIEW DRAFT ONLY. Not in supabase/migrations. Never applied to user DB.
-- No audio, reference text, provider key or evaluation scores are stored.
-- Provisioning proposal only: no role/token/connection is created by application code.
begin;
create role yeoni_speech_usage_api nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
-- No password in the draft. Login remains unusable until separately provisioned securely.
create role yeoni_speech_usage_login login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 1;
grant yeoni_speech_usage_api to yeoni_speech_usage_login;
grant connect on database postgres to yeoni_speech_usage_login;
create schema yeoni_speech_usage;
revoke all on schema yeoni_speech_usage from public, anon, authenticated;
create table yeoni_speech_usage.policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  f0_reviewed_at timestamptz,
  trial_owner_id uuid references auth.users(id) on delete set null,
  data_policy_id text,
  data_policy_reviewed_at timestamptz,
  trial_consumed boolean not null default false,
  resource_name text,
  region text,
  shared_month_ms bigint check(shared_month_ms = 5000),
  owner_month_ms bigint check(owner_month_ms = 5000),
  shared_month_requests bigint check(shared_month_requests = 1),
  owner_month_requests bigint check(owner_month_requests = 1),
  check (owner_month_ms <= shared_month_ms),
  check (owner_month_requests <= shared_month_requests)
);
insert into yeoni_speech_usage.policy(singleton) values(true);
-- Anonymous shared counters have no account FK. Account/receipt deletion never refunds them.
create table yeoni_speech_usage.shared_totals (
  month_start timestamptz primary key,
  consumed_ms bigint not null default 0 check(consumed_ms>=0),
  consumed_requests bigint not null default 0 check(consumed_requests>=0)
);
create table yeoni_speech_usage.receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check(request_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  duration_ms integer not null check(duration_ms between 1 and 30000),
  consumed_at timestamptz not null default clock_timestamp(),
  primary key(user_id,request_id)
);
create index speech_usage_month on yeoni_speech_usage.receipts(consumed_at);
create index speech_usage_owner_month on yeoni_speech_usage.receipts(user_id,consumed_at);
create table yeoni_speech_usage.lease (
  singleton boolean primary key default true check(singleton),
  user_id uuid references auth.users(id) on delete set null,
  request_id text,
  token_hash text,
  claimed_at timestamptz,
  check ((user_id is null and request_id is null and token_hash is null and claimed_at is null)
    or (request_id is not null and token_hash is not null and claimed_at is not null))
);
insert into yeoni_speech_usage.lease(singleton) values(true);
alter table yeoni_speech_usage.shared_totals enable row level security;
alter table yeoni_speech_usage.policy enable row level security;
alter table yeoni_speech_usage.receipts enable row level security;
alter table yeoni_speech_usage.lease enable row level security;
revoke all on all tables in schema yeoni_speech_usage from public,anon,authenticated,service_role,yeoni_speech_usage_api;

create function yeoni_speech_usage.consume(p_owner_id uuid,p_request_id text,p_fingerprint text,p_duration_ms integer,p_resource_name text,p_region text,p_lease_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := p_owner_id;
  policy yeoni_speech_usage.policy%rowtype;
  start_month timestamptz;
  global_ms bigint; owner_ms bigint; global_count bigint; owner_count bigint;
  active_request text;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_request_id is null or p_request_id !~ '^[a-zA-Z0-9_-]{1,100}$' or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_duration_ms is null or p_duration_ms < 1 or p_duration_ms > 5000 or p_lease_token is null or p_lease_token !~ '^[a-zA-Z0-9_-]{32,100}$' then return 'limit'; end if;
  -- Serializes all reservations, including different accounts and server instances.
  select * into policy from yeoni_speech_usage.policy where singleton for update;
  if not found then return 'limit'; end if;
  if exists(select 1 from yeoni_speech_usage.receipts where user_id=uid and request_id=p_request_id) then return 'duplicate'; end if;
  if not policy.enabled or policy.trial_owner_id is distinct from uid or policy.data_policy_id is distinct from 'trial-metadata-policy-v1' or policy.data_policy_reviewed_at is null or policy.data_policy_reviewed_at>clock_timestamp() or not exists(select 1 from auth.users where id=uid) or policy.f0_reviewed_at is null or policy.f0_reviewed_at>clock_timestamp() or policy.f0_reviewed_at<clock_timestamp()-interval '1 day' or policy.resource_name is distinct from 'yeoni-speech-jace' or policy.region is distinct from 'koreacentral' or p_resource_name is distinct from policy.resource_name or p_region is distinct from policy.region or policy.shared_month_ms is null or policy.owner_month_ms is null or policy.shared_month_requests is null or policy.owner_month_requests is null then return 'limit'; end if;
  select request_id into active_request from yeoni_speech_usage.lease where singleton for update;
  if not found or active_request is not null then return 'busy'; end if;
  if policy.trial_consumed then return 'limit'; end if;
  start_month := date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  insert into yeoni_speech_usage.shared_totals(month_start) values(start_month) on conflict do nothing;
  select consumed_ms,consumed_requests into global_ms,global_count from yeoni_speech_usage.shared_totals where month_start=start_month for update;
  select coalesce(sum(duration_ms),0),count(*) into owner_ms,owner_count from yeoni_speech_usage.receipts
    where user_id=uid and consumed_at>=start_month and consumed_at<start_month+interval '1 month';
  if global_ms+p_duration_ms > policy.shared_month_ms or owner_ms+p_duration_ms > policy.owner_month_ms or global_count+1 > policy.shared_month_requests or owner_count+1 > policy.owner_month_requests then return 'limit'; end if;
  -- Consume before external dispatch. No refund API: uncertain/aborted calls stay counted.
  insert into yeoni_speech_usage.receipts(user_id,request_id,fingerprint,duration_ms) values(uid,p_request_id,p_fingerprint,p_duration_ms);
  update yeoni_speech_usage.policy set trial_consumed=true where singleton;
  update yeoni_speech_usage.shared_totals set consumed_ms=consumed_ms+p_duration_ms,consumed_requests=consumed_requests+1 where month_start=start_month;
  update yeoni_speech_usage.lease set user_id=uid,request_id=p_request_id,token_hash=md5(p_lease_token),claimed_at=clock_timestamp() where singleton;
  return 'accepted';
end $$;
revoke all on function yeoni_speech_usage.consume(uuid,text,text,integer,text,text,text) from public,anon,authenticated,service_role,yeoni_speech_usage_api;
grant usage on schema yeoni_speech_usage to yeoni_speech_usage_api;
grant execute on function yeoni_speech_usage.consume(uuid,text,text,integer,text,text,text) to yeoni_speech_usage_api;
-- Only the dedicated database login inherits these three function grants.
-- No authenticator membership, JWT signing key or Data API wrapper is required.
-- No timeout/expiry refund: a lost worker or uncertain provider outcome remains blocked.
-- Known completed/not-sent work may release its own lease using an unexposed random token.
create function yeoni_speech_usage.finish(p_owner_id uuid,p_request_id text,p_lease_token text)
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=p_owner_id; n integer;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_lease_token is null or p_lease_token !~ '^[a-zA-Z0-9_-]{32,100}$' then return false; end if;
  perform 1 from yeoni_speech_usage.policy where singleton for update;
  update yeoni_speech_usage.lease set user_id=null,request_id=null,token_hash=null,claimed_at=null
    where singleton and user_id=uid and request_id=p_request_id and token_hash=md5(p_lease_token);
  get diagnostics n=row_count;return n=1;
end $$;
revoke all on function yeoni_speech_usage.finish(uuid,text,text) from public,anon,authenticated,service_role,yeoni_speech_usage_api;
grant execute on function yeoni_speech_usage.finish(uuid,text,text) to yeoni_speech_usage_api;
create function yeoni_speech_usage.ready(p_owner_id uuid,p_resource_name text,p_region text)
returns boolean language sql security definer set search_path='' as $$
 select coalesce(p_owner_id is not null and exists(select 1 from auth.users where id=p_owner_id) and exists(select 1 from yeoni_speech_usage.policy p
   join yeoni_speech_usage.lease l on l.singleton=p.singleton
   where p.singleton and p.enabled and not p.trial_consumed and p.trial_owner_id=p_owner_id and p.data_policy_id='trial-metadata-policy-v1' and p.data_policy_reviewed_at is not null and p.data_policy_reviewed_at<=clock_timestamp() and p.f0_reviewed_at is not null and p.f0_reviewed_at<=clock_timestamp() and p.f0_reviewed_at>=clock_timestamp()-interval '1 day'
   and p.resource_name='yeoni-speech-jace' and p.region='koreacentral'
   and p.resource_name=p_resource_name and p.region=p_region and l.request_id is null
   and p.shared_month_ms is not null and p.owner_month_ms is not null
   and p.shared_month_requests is not null and p.owner_month_requests is not null
   and not exists(select 1 from yeoni_speech_usage.shared_totals t where t.month_start=(date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC') and (t.consumed_requests>=p.shared_month_requests or t.consumed_ms>=p.shared_month_ms))),false)
$$;
revoke all on function yeoni_speech_usage.ready(uuid,text,text) from public,anon,authenticated,service_role,yeoni_speech_usage_api;
grant execute on function yeoni_speech_usage.ready(uuid,text,text) to yeoni_speech_usage_api;
-- Operator-only reconciliation draft; never exposed as an app/public RPC.
-- Proof must be reviewed out of band: elapsed time alone is NOT evidence.
create table yeoni_speech_usage.reconciliations (
  request_id text not null,
  resolution text not null check(resolution in ('verified-not-sent','verified-finished')),
  evidence_ref text not null check(length(evidence_ref) between 1 and 120),
  resolved_at timestamptz not null default clock_timestamp()
);
alter table yeoni_speech_usage.reconciliations enable row level security;
revoke all on yeoni_speech_usage.reconciliations from public,anon,authenticated,service_role,yeoni_speech_usage_api;
create function yeoni_speech_usage.reconcile(
  p_owner_id uuid,p_request_id text,p_claimed_at timestamptz,p_token_hash text,
  p_resolution text,p_evidence_ref text
) returns boolean language plpgsql security definer set search_path='' as $$
declare active yeoni_speech_usage.lease%rowtype;
begin
  -- Lock policy first, in the same order as consume/finish.
  perform 1 from yeoni_speech_usage.policy where singleton and not enabled for update;
  if not found then return false; end if;
  if p_resolution not in ('verified-not-sent','verified-finished') or p_resolution is null
    or p_evidence_ref is null or p_evidence_ref !~ '^[a-zA-Z0-9_./:-]{1,120}$' then return false; end if;
  select * into active from yeoni_speech_usage.lease where singleton for update;
  if not found or active.request_id is null or active.user_id is distinct from p_owner_id
    or active.request_id is distinct from p_request_id or active.claimed_at is distinct from p_claimed_at
    or active.token_hash is distinct from p_token_hash then return false; end if;
  insert into yeoni_speech_usage.reconciliations(request_id,resolution,evidence_ref)
    values(p_request_id,p_resolution,p_evidence_ref);
  update yeoni_speech_usage.lease set user_id=null,request_id=null,token_hash=null,claimed_at=null where singleton;
  -- Deliberately retain consumed receipt: reconciliation never refunds quota.
  return true;
end $$;
revoke all on function yeoni_speech_usage.reconcile(uuid,text,timestamptz,text,text,text) from public,anon,authenticated,service_role,yeoni_speech_usage_api;
-- Database owner/operator only; no API grant or public wrapper.

-- Fail the whole draft rather than changing inherited PUBLIC grants on existing apps.
do $$begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and c.relkind in ('r','p','v','m','f')
   and has_schema_privilege('yeoni_speech_usage_login',n.oid,'USAGE')
   and has_table_privilege('yeoni_speech_usage_login',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 then raise exception 'Dedicated speech login inherits application table access';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname !~ '^pg_' and n.nspname<>'information_schema'
   and case when c.relkind='S' then has_sequence_privilege('yeoni_speech_usage_login',c.oid,'USAGE,SELECT,UPDATE') else false end)
 then raise exception 'Dedicated speech login inherits application sequence access';end if;
 if exists(select 1 from pg_namespace n where n.nspname !~ '^pg_' and n.nspname<>'information_schema'
   and has_schema_privilege('yeoni_speech_usage_login',n.oid,'CREATE'))
 then raise exception 'Dedicated speech login inherits application schema CREATE';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and p.prosecdef
   and has_schema_privilege('yeoni_speech_usage_login',n.oid,'USAGE')
   and has_function_privilege('yeoni_speech_usage_login',p.oid,'EXECUTE')
   and not (n.nspname='yeoni_speech_usage' and p.proname in ('ready','consume','finish')))
 then raise exception 'Dedicated speech login inherits another privileged function';end if;
end $$;
commit;
