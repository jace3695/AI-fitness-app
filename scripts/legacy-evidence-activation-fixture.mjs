/** Fixed disposable-only activation on the existing restricted installer session. */
export const DISPOSABLE_WRITE_FUNCTIONS = Object.freeze([
  'public.get_language_legacy_evidence_context(uuid,jsonb,text,text,text)',
  'language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text)',
  'public.enroll_language_legacy_evidence_v1(uuid,uuid,jsonb,text,text,text,text)',
  'language_legacy_evidence_private.enroll_v1(uuid,uuid,jsonb,text,text,text,text)',
  'public.append_language_legacy_evidence(uuid,uuid,text,uuid,text,jsonb,text[])',
  'language_legacy_evidence_private.append_events(uuid,uuid,text,uuid,text,jsonb,text[])',
]);
const targets = `array[${DISPOSABLE_WRITE_FUNCTIONS.map(value => `'${value}'::regprocedure::oid`).join(',')}]`;
const members = `select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.oid),'[]'::jsonb) from pg_catalog.pg_auth_members m`;
const acl = `select pg_catalog.jsonb_agg(value order by value::text) from (
  select pg_catalog.to_jsonb(a)||pg_catalog.jsonb_build_object('function',p.oid) value
  from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  where p.oid=any(${targets})) entries`;
const protectedState = `select pg_catalog.jsonb_build_object(
  'roles',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by oid) from pg_catalog.pg_roles r),
  'schemas',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid',oid,'owner',nspowner,'acl',nspacl) order by oid) from pg_catalog.pg_namespace
    where nspname in ('auth','public','language_legacy_evidence_private')),
  'functions',(select pg_catalog.jsonb_agg((pg_catalog.to_jsonb(p)-'proacl')||pg_catalog.jsonb_build_object('proacl',case when p.oid=any(${targets}) then null else p.proacl end) order by p.oid)
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public','language_legacy_evidence_private')),
  'relations',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity) order by c.oid)
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','language_legacy_evidence_private')),
  'columns',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('table',a.attrelid,'number',a.attnum,'acl',a.attacl) order by a.attrelid,a.attnum)
    from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('auth','public','language_legacy_evidence_private') and a.attnum>0))`;

// No arbitrary command argument and no SECURITY DEFINER. The exception block
// rolls back every mutation on failure while returning only fixed classifications.
export const DISPOSABLE_ACTIVATION_SQL = `create function pg_temp.qa_activate() returns jsonb language plpgsql security invoker set search_path='' as $ci_activate$
declare before_memberships jsonb; expected_acl jsonb; protected_state jsonb; target record; begin
  if current_user<>'postgres' or current_user<>session_user or not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and not rolsuper and rolcreaterole)
    or not exists(select 1 from pg_catalog.pg_namespace where nspname='language_legacy_evidence_private' and nspowner=current_user::regrole::oid) then
    raise exception 'legacy_activation_identity' using errcode='42501';
  end if;
  if (select count(*) from pg_catalog.pg_roles where rolname in ('language_legacy_evidence_executor','language_legacy_evidence_reset_executor')
    and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls and not rolinherit)<>2
    or not exists(select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid=m.grantor
      where m.roleid='language_legacy_evidence_executor'::regrole and m.member=current_user::regrole and m.grantor=10 and g.rolsuper
        and m.admin_option and not m.set_option and not m.inherit_option)
    or exists(select 1 from pg_catalog.pg_auth_members m where m.member in ('language_legacy_evidence_executor'::regrole,'language_legacy_evidence_reset_executor'::regrole)
      or (m.roleid in ('language_legacy_evidence_executor'::regrole,'language_legacy_evidence_reset_executor'::regrole)
        and not (m.member=current_user::regrole and m.grantor=10 and m.admin_option and not m.set_option and not m.inherit_option)))
    or pg_catalog.pg_has_role(current_user,'language_legacy_evidence_executor','SET')
    or pg_catalog.pg_has_role(current_user,'language_legacy_evidence_executor','USAGE') then
    raise exception 'legacy_activation_authority' using errcode='42501';
  end if;
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where p.oid=any(${targets})
      and ((n.nspname='public' and p.proowner='postgres'::regrole and not p.prosecdef)
        or (n.nspname='language_legacy_evidence_private' and p.proowner='language_legacy_evidence_executor'::regrole and p.prosecdef)))<>6
    or exists(select 1 from pg_catalog.pg_proc p cross join (values ('anon'),('authenticated'),('service_role')) app(role)
      where p.oid=any(${targets}) and pg_catalog.has_function_privilege(app.role,p.oid,'EXECUTE')) then
    raise exception 'legacy_activation_baseline' using errcode='42501';
  end if;
  select (${members}),(${acl}),(${protectedState}) into before_memberships,expected_acl,protected_state;
  for target in select oid,proowner from pg_catalog.pg_proc where oid=any(${targets}) loop
    expected_acl:=expected_acl||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'function',target.oid,'grantor',target.proowner,'grantee','authenticated'::regrole::oid,'privilege_type','EXECUTE','is_grantable',false));
  end loop;
  select pg_catalog.jsonb_agg(value order by value::text) into expected_acl from pg_catalog.jsonb_array_elements(expected_acl);
  grant language_legacy_evidence_executor to postgres with inherit false,set true granted by postgres;
  grant execute on function ${DISPOSABLE_WRITE_FUNCTIONS.filter(value => value.startsWith('public.')).join(',')} to authenticated;
  set local role language_legacy_evidence_executor;
  grant execute on function ${DISPOSABLE_WRITE_FUNCTIONS.filter(value => !value.startsWith('public.')).join(',')} to authenticated;
  set local role postgres;
  revoke language_legacy_evidence_executor from postgres granted by postgres restrict;
  -- Restoration and the exact six grants must be proved before this call commits.
  if current_user<>'postgres' or current_user<>session_user or before_memberships is distinct from (${members})
    or expected_acl is distinct from (${acl}) or protected_state is distinct from (${protectedState})
    or pg_catalog.pg_has_role(current_user,'language_legacy_evidence_executor','SET')
    or pg_catalog.pg_has_role(current_user,'language_legacy_evidence_executor','USAGE')
    or exists(select 1 from pg_catalog.pg_proc p where p.oid=any(${targets}) and (
      not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE WITH GRANT OPTION')
      or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') or pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'))) then
    raise exception 'legacy_activation_delta' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object('ok',true);
exception when others then return pg_catalog.jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'error',
  case when SQLERRM in ('legacy_activation_identity','legacy_activation_authority','legacy_activation_baseline','legacy_activation_delta') then SQLERRM else 'sql_error' end);
end $ci_activate$;`;
