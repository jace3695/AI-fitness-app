/** Pure SQL adapter for the disposable CI seed only. Never a hosted migration. */
import { createHash } from 'node:crypto';

// This is deliberately not a general migration rewriter. Any authored change,
// including an extra transaction statement, requires another fixture review.
const INPUT_DIGESTS = [
  '259c1bb8987134af38c23039d699ed798fca578c8a430c0e1e50a356a7f9a4e6',
  'd73d49d5fc5293109b540239c8f16602f575fd9e133326bed9a427eb0dbdf2a1',
];
const ROLES = "'language_legacy_evidence_executor','language_legacy_evidence_reset_executor'";
const memberships = `select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.oid),'[]'::jsonb)
  from pg_catalog.pg_auth_members m
  where m.roleid in (select oid from pg_catalog.pg_roles where rolname in (${ROLES}))
     or m.member in (select oid from pg_catalog.pg_roles where rolname in (${ROLES}))`;
const allMemberships = `select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.oid),'[]'::jsonb) from pg_catalog.pg_auth_members m`;
const authAcl = `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by pg_catalog.to_jsonb(a)::text)
  from pg_catalog.pg_namespace n cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a where n.nspname='auth'`;
const authProtected = `select pg_catalog.jsonb_build_object(
  'owner',(select nspowner from pg_catalog.pg_namespace where nspname='auth'),
  'uid',(select pg_catalog.jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl) from pg_catalog.pg_proc where oid='auth.uid()'::regprocedure),
  'relations',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl) order by oid) from pg_catalog.pg_class where relnamespace='auth'::regnamespace),
  'columns',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('relation',a.attrelid,'number',a.attnum,'acl',a.attacl) order by a.attrelid,a.attnum)
    from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid where c.relnamespace='auth'::regnamespace and a.attnum>0),
  'public',(select pg_catalog.to_jsonb(nspacl) from pg_catalog.pg_namespace where nspname='public'),
  'roles',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by oid) from pg_catalog.pg_roles r where rolname in (${ROLES})))`;

// Both additions and their removal occur inside EACH authored transaction. Nothing
// added for ownership installation may commit. Only the two auth-schema USAGE
// grants below last for the disposable fixture's lifetime. No new authority is
// acquired to issue them. PostgreSQL's preexisting creator-ADMIN
// membership belongs to its bootstrap superuser; it must never be revoked.
const openScope = authUsageMode => `
-- BEGIN DISPOSABLE CI INSTALLER SCOPE
create temporary table legacy_evidence_ci_install_scope on commit drop as
select current_user::text installer, (${memberships}) memberships,
  (${allMemberships}) all_memberships, (${authAcl}) auth_expected_acl, (${authProtected}) auth_protected,
  (select pg_catalog.to_jsonb(nspacl) from pg_catalog.pg_namespace where nspname='language_legacy_evidence_private') schema_acl,
  (select pg_catalog.jsonb_object_agg(r.rolname,pg_catalog.jsonb_build_object(
    'create',pg_catalog.has_schema_privilege(r.oid,'language_legacy_evidence_private','CREATE'),
    'own',(select pg_catalog.to_jsonb(m) from pg_catalog.pg_auth_members m
      where m.roleid=r.oid and m.member=current_user::regrole::oid and m.grantor=current_user::regrole::oid)))
    from pg_catalog.pg_roles r where r.rolname in (${ROLES})) original;
do $ci_install_scope$ declare saved record; target record; auth_owner oid; grantor oid; expected_acl jsonb; begin
  select * into strict saved from pg_temp.legacy_evidence_ci_install_scope;
  if current_user<>session_user or not exists(select 1 from pg_catalog.pg_roles
      where rolname=current_user and not rolsuper and rolcreaterole
      and rolname not in ('anon','authenticated','service_role',${ROLES}))
    or not exists(select 1 from pg_catalog.pg_namespace where nspname='language_legacy_evidence_private' and nspowner=current_user::regrole::oid)
    or (select count(*) from pg_catalog.pg_roles where rolname in (${ROLES})
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls and not rolinherit)<>2 then
    raise exception 'disposable installer identity or executor attributes changed';
  end if;
  -- Repair only the observed schema-USAGE prerequisite, using existing authority.
  -- Neither membership nor grant option is ever added to the installer/targets.
  if exists(select 1 from pg_catalog.pg_roles r where rolname in (${ROLES}) and (
      pg_catalog.has_schema_privilege(r.oid,'auth','CREATE') or
      pg_catalog.has_schema_privilege(r.oid,'auth','USAGE WITH GRANT OPTION') or
      not pg_catalog.has_function_privilege(r.oid,'auth.uid()','EXECUTE'))) then
    raise exception 'disposable_auth_usage_unsupported_target' using errcode='42501';
  end if;
  -- Deferred mode is an incomplete, default-write-denied installation. Only the
  -- guarded launcher may finish it with the approved owner transaction.
  if ${authUsageMode === 'deferred-owner-stage' ? 'false' : 'true'} and exists(select 1 from pg_catalog.pg_roles r where rolname in (${ROLES}) and not pg_catalog.has_schema_privilege(r.oid,'auth','USAGE')) then
    select nspowner into strict auth_owner from pg_catalog.pg_namespace where nspname='auth';
    if pg_catalog.pg_has_role(session_user,auth_owner,'SET') then
      grantor:=auth_owner;
    elsif exists(select 1 from pg_catalog.pg_namespace n cross join lateral pg_catalog.aclexplode(n.nspacl) a
      where n.nspname='auth' and a.grantee=current_user::regrole::oid and a.privilege_type='USAGE' and a.is_grantable)
      and not pg_catalog.pg_has_role(current_user,auth_owner,'USAGE') then
      -- Inherited ownership can change PostgreSQL's selected grantor. Refuse
      -- that ambiguous path rather than assuming an installer-granted ACL.
      grantor:=current_user::regrole::oid;
    else
      raise exception 'disposable_auth_usage_authority_unavailable' using errcode='42501';
    end if;
    expected_acl:=saved.auth_expected_acl;
    for target in select oid,rolname from pg_catalog.pg_roles where rolname in (${ROLES})
      and not pg_catalog.has_schema_privilege(oid,'auth','USAGE') order by oid loop
      expected_acl:=expected_acl||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'grantor',grantor,'grantee',target.oid,'privilege_type','USAGE','is_grantable',false));
    end loop;
    -- Store the missing targets before switching; the auth owner has no access
    -- to the installer's temporary snapshot. The record remains transaction-local.
    select pg_catalog.jsonb_agg(value order by value::text) into expected_acl from pg_catalog.jsonb_array_elements(expected_acl);
    update pg_temp.legacy_evidence_ci_install_scope set auth_expected_acl=expected_acl;
    for target in select oid,rolname from pg_catalog.pg_roles where rolname in (${ROLES})
      and not pg_catalog.has_schema_privilege(oid,'auth','USAGE') order by oid loop
      if grantor=auth_owner then execute pg_catalog.format('set local role %I',pg_catalog.pg_get_userbyid(auth_owner)); end if;
      execute pg_catalog.format('grant usage on schema auth to %I',target.rolname);
      execute pg_catalog.format('set local role %I',saved.installer);
    end loop;
  end if;
  if current_user<>saved.installer or current_user<>session_user then
    raise exception 'disposable_auth_usage_identity_not_restored' using errcode='42501';
  end if;
  if (select auth_expected_acl from pg_temp.legacy_evidence_ci_install_scope) is distinct from (${authAcl})
    or saved.all_memberships is distinct from (${allMemberships}) or saved.auth_protected is distinct from (${authProtected}) then
    raise exception 'disposable_auth_usage_delta_mismatch' using errcode='42501';
  end if;
  for target in select * from pg_catalog.jsonb_each(saved.original) loop
    execute pg_catalog.format('grant %I to %I with inherit true, set true granted by %I',target.key,saved.installer,saved.installer);
    if not (target.value->>'create')::boolean then
      execute pg_catalog.format('grant create on schema language_legacy_evidence_private to %I',target.key);
    end if;
  end loop;
end $ci_install_scope$;
`;

const closeScope = `
do $ci_install_scope$ declare saved record; target record; actual_memberships jsonb; actual_acl jsonb; begin
  select * into strict saved from pg_temp.legacy_evidence_ci_install_scope;
  if saved.installer<>current_user or current_user<>session_user then raise exception 'disposable installer changed'; end if;
  for target in select * from pg_catalog.jsonb_each(saved.original) loop
    if target.value->'own'='null'::jsonb then
      execute pg_catalog.format('revoke %I from %I granted by %I restrict',target.key,saved.installer,saved.installer);
    else
      -- ADMIN was never changed. Restore the exact preexisting SET/INHERIT flags
      -- on the same grantor row, rather than deleting and recreating that row.
      execute pg_catalog.format('grant %I to %I with inherit %s, set %s granted by %I',target.key,saved.installer,
        target.value#>>'{own,inherit_option}',target.value#>>'{own,set_option}',saved.installer);
    end if;
    if not (target.value->>'create')::boolean then
      execute pg_catalog.format('revoke create on schema language_legacy_evidence_private from %I restrict',target.key);
    end if;
  end loop;
  select (${memberships}) into actual_memberships;
  select pg_catalog.to_jsonb(nspacl) into actual_acl from pg_catalog.pg_namespace where nspname='language_legacy_evidence_private';
  if saved.memberships is distinct from actual_memberships or saved.schema_acl is distinct from actual_acl then
    raise exception 'disposable installer membership or schema ACL was not restored';
  end if;
  if saved.all_memberships is distinct from (${allMemberships}) or saved.auth_expected_acl is distinct from (${authAcl})
    or saved.auth_protected is distinct from (${authProtected}) then
    raise exception 'disposable_auth_usage_restoration_mismatch' using errcode='42501';
  end if;
end $ci_install_scope$;
-- END DISPOSABLE CI INSTALLER SCOPE
`;

function uniquePosition(sql, anchor) {
  const first = sql.indexOf(anchor);
  if (first < 0 || sql.indexOf(anchor, first + anchor.length) !== -1) throw new Error('disposable seed anchor missing or ambiguous');
  return first;
}

function instrument(sql, anchor, afterAnchor, authUsageMode) {
  if (typeof sql !== 'string') throw new Error('disposable seed requires authored SQL');
  const begins = [...sql.matchAll(/^begin;$/gm)], commits = [...sql.matchAll(/^commit;$/gm)];
  if (begins.length !== 1 || commits.length !== 1 || sql.slice(commits[0].index + 7).trim()) throw new Error('disposable seed transaction boundaries changed');
  const at = uniquePosition(sql, anchor) + (afterAnchor ? anchor.length : 0);
  if (at < begins[0].index + 6 || at >= commits[0].index) throw new Error('disposable seed scope outside authored transaction');
  return sql.slice(0, at) + openScope(authUsageMode) + sql.slice(at, commits[0].index) + closeScope + sql.slice(commits[0].index);
}

/** Keeps every byte of both inactive migrations, inserting only bounded fixture SQL. */
export function buildLegacyEvidenceInstallationFixture(ledgerSql, enrollmentSql, authUsageMode = 'existing-authority') {
  if (!['existing-authority', 'deferred-owner-stage'].includes(authUsageMode)) throw new Error('disposable seed auth usage mode unsupported');
  for (const [index, sql] of [ledgerSql, enrollmentSql].entries()) {
    if (typeof sql !== 'string' || createHash('sha256').update(sql).digest('hex') !== INPUT_DIGESTS[index]) {
      throw new Error('disposable seed authored input changed; review required');
    }
  }
  for (const role of ['language_legacy_evidence_executor', 'language_legacy_evidence_reset_executor']) {
    uniquePosition(ledgerSql, `create role ${role} nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;`);
  }
  uniquePosition(ledgerSql, 'create schema language_legacy_evidence_private;');
  return instrument(ledgerSql, 'alter function language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text) owner to language_legacy_evidence_executor;', false, authUsageMode)
    + '\n' + instrument(enrollmentSql, 'begin;\n', true, authUsageMode);
}
