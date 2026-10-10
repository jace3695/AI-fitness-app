/** Approved disposable-only bootstrap. Pure constants; never opens a connection. */
export const AUTH_OWNER_READY = 'legacy_evidence_auth_owner_fixture_ready';
const roles = "'language_legacy_evidence_executor','language_legacy_evidence_reset_executor'";
const writes = [
  'public.get_language_legacy_evidence_context(uuid,jsonb,text,text,text)',
  'language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text)',
  'public.enroll_language_legacy_evidence_v1(uuid,uuid,jsonb,text,text,text,text)',
  'language_legacy_evidence_private.enroll_v1(uuid,uuid,jsonb,text,text,text,text)',
  'public.append_language_legacy_evidence(uuid,uuid,text,uuid,text,jsonb,text[])',
  'language_legacy_evidence_private.append_events(uuid,uuid,text,uuid,text,jsonb,text[])',
];
const memberships = `select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.oid),'[]'::jsonb) from pg_catalog.pg_auth_members m`;
const acl = `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by pg_catalog.to_jsonb(a)::text)
  from pg_catalog.pg_namespace n cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a where n.nspname='auth'`;
const protectedState = `select pg_catalog.jsonb_build_object(
  'schemas',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid',oid,'owner',nspowner,'acl',case when nspname='auth' then null else nspacl end) order by oid)
    from pg_catalog.pg_namespace where nspname in ('auth','public','language_legacy_evidence_private')),
  'functions',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig) order by p.oid)
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public','language_legacy_evidence_private')),
  'relations',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl) order by oid) from pg_catalog.pg_class where relnamespace='auth'::regnamespace),
  'columns',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('relation',a.attrelid,'number',a.attnum,'acl',a.attacl) order by a.attrelid,a.attnum)
    from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid where c.relnamespace='auth'::regnamespace and a.attnum>0),
  'roles',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.oid) from pg_catalog.pg_roles r))`;

export const AUTH_OWNER_SQL = `begin;
set local search_path='';
set local statement_timeout='10s';
set local lock_timeout='5s';
set local idle_in_transaction_session_timeout='10s';
do $ci_auth_owner$ declare before_memberships jsonb; expected_acl jsonb; protected_state jsonb; target record; begin
  if current_user<>'supabase_admin' or current_user<>session_user or not exists(
    select 1 from pg_catalog.pg_namespace n join pg_catalog.pg_roles r on r.oid=n.nspowner
    where n.nspname='auth' and r.rolname=current_user and r.rolsuper and r.rolcanlogin) then
    raise exception 'disposable_auth_owner_identity_invalid' using errcode='42501';
  end if;
  if not exists(select 1 from pg_catalog.pg_namespace n join pg_catalog.pg_roles r on r.oid=n.nspowner
    where n.nspname='language_legacy_evidence_private' and r.rolname='postgres' and not r.rolsuper and r.rolcreaterole)
    or (select count(*) from pg_catalog.pg_roles where rolname in (${roles}) and not rolcanlogin and not rolsuper
      and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls and not rolinherit)<>2 then
    raise exception 'disposable_auth_owner_target_invalid' using errcode='42501';
  end if;
  if exists(select 1 from pg_catalog.pg_roles r where r.rolname in (${roles}) and (
    pg_catalog.has_schema_privilege(r.oid,'auth','CREATE') or pg_catalog.has_schema_privilege(r.oid,'auth','USAGE WITH GRANT OPTION')
    or not pg_catalog.has_function_privilege(r.oid,'auth.uid()','EXECUTE')))
    or exists(select 1 from pg_catalog.pg_auth_members m where m.member in (select oid from pg_catalog.pg_roles where rolname in (${roles})))
    or exists(select 1 from (values ('anon'),('authenticated'),('service_role')) app(role) cross join pg_catalog.pg_roles r
      where r.rolname in (${roles}) and (pg_catalog.pg_has_role(app.role,r.oid,'MEMBER') or pg_catalog.pg_has_role(app.role,r.oid,'SET') or pg_catalog.pg_has_role(app.role,r.oid,'USAGE'))) then
    raise exception 'disposable_auth_owner_dependency_invalid' using errcode='42501';
  end if;
  if exists(select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid=m.roleid
    where r.rolname in (${roles}) and not (m.member=(select nspowner from pg_catalog.pg_namespace where nspname='language_legacy_evidence_private')
      and m.admin_option and not m.inherit_option and not m.set_option and m.grantor=10
      and exists(select 1 from pg_catalog.pg_roles g where g.oid=m.grantor and g.rolsuper)))
    or exists(select 1 from pg_catalog.pg_roles r cross join pg_catalog.pg_namespace n
      where r.rolname in (${roles}) and n.nspname='language_legacy_evidence_private'
      and (pg_catalog.pg_has_role(n.nspowner,r.oid,'SET') or pg_catalog.pg_has_role(n.nspowner,r.oid,'USAGE'))) then
    raise exception 'disposable_auth_owner_membership_invalid' using errcode='42501';
  end if;
  if exists(select 1 from (values ${writes.map(signature => `('${signature}')`).join(',')}) f(signature)
    cross join (values ('anon'),('authenticated'),('service_role')) app(role)
    where pg_catalog.has_function_privilege(app.role,f.signature,'EXECUTE')) then
    raise exception 'disposable_auth_owner_writes_not_denied' using errcode='42501';
  end if;
  select (${memberships}),(${acl}),(${protectedState}) into before_memberships,expected_acl,protected_state;
  for target in select oid,rolname from pg_catalog.pg_roles where rolname in (${roles})
    and not pg_catalog.has_schema_privilege(oid,'auth','USAGE') order by oid loop
    expected_acl:=expected_acl||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'grantor',current_user::regrole::oid,'grantee',target.oid,'privilege_type','USAGE','is_grantable',false));
    execute pg_catalog.format('grant usage on schema auth to %I',target.rolname);
  end loop;
  select pg_catalog.jsonb_agg(value order by value::text) into expected_acl from pg_catalog.jsonb_array_elements(expected_acl);
  -- No other ACL, role attribute, ownership or membership may change.
  if current_user<>'supabase_admin' or current_user<>session_user
    or before_memberships is distinct from (${memberships}) or expected_acl is distinct from (${acl})
    or protected_state is distinct from (${protectedState})
    or exists(select 1 from pg_catalog.pg_roles r where rolname in (${roles}) and (
      not pg_catalog.has_schema_privilege(r.oid,'auth','USAGE') or pg_catalog.has_schema_privilege(r.oid,'auth','CREATE')
      or pg_catalog.has_schema_privilege(r.oid,'auth','USAGE WITH GRANT OPTION'))) then
    raise exception 'disposable_auth_owner_delta_mismatch' using errcode='42501';
  end if;
end $ci_auth_owner$;
commit;
select '${AUTH_OWNER_READY}';
`;

// Explicit keyword options fail on an unsupported client; no retry may omit them.
// PG17 libpq: https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNECT-REQUIRE-AUTH
export const AUTH_OWNER_CONNECTION = 'host=/var/run/postgresql port=5432 dbname=postgres user=supabase_admin require_auth=none sslmode=disable gssencmode=disable passfile=/dev/null connect_timeout=5';
export function authOwnerInvocation(containerId) {
  if (typeof containerId !== 'string' || !/^[0-9a-f]{64}$/.test(containerId)) throw new Error('invalid disposable container identity');
  return Object.freeze({
    args: Object.freeze(['--context', 'default', 'exec', '-i', containerId, 'env', '-i',
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/postgresql/17/bin',
      'HOME=/nonexistent', 'PGPASSFILE=/dev/null', 'PGSERVICEFILE=/dev/null', 'PGSYSCONFDIR=/nonexistent',
      'psql', '-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', AUTH_OWNER_CONNECTION]),
    options: Object.freeze({ input: AUTH_OWNER_SQL, encoding: 'utf8', timeout: 25_000, maxBuffer: 16_384, stdio: ['pipe', 'pipe', 'pipe'] }),
  });
}
