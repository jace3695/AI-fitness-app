import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { AUTH_OWNER_CONNECTION, AUTH_OWNER_READY, AUTH_OWNER_SQL, authOwnerInvocation } from '../scripts/legacy-evidence-auth-owner-fixture.mjs';
import { buildLegacyEvidenceInstallationFixture } from '../scripts/legacy-evidence-installation-fixture.mjs';
import { DISPOSABLE_WRITE_FUNCTIONS, provisionDisposableAuthUsage } from '../scripts/qa-legacy-evidence-postgres.mjs';
import { createLegacyEvidenceDiagnostics } from '../scripts/legacy-evidence-ci-diagnostics.mjs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const executor = 'language_legacy_evidence_executor', resetExecutor = 'language_legacy_evidence_reset_executor';

test('owner transport is fixed socket/no-challenge/no-credential and requires an unforgeable stack before spawning', () => {
  const invocation = authOwnerInvocation('a'.repeat(64));
  assert.equal(AUTH_OWNER_CONNECTION, 'host=/var/run/postgresql port=5432 dbname=postgres user=supabase_admin require_auth=none sslmode=disable gssencmode=disable passfile=/dev/null connect_timeout=5');
  assert.deepEqual(invocation.args.slice(0, 7), ['--context', 'default', 'exec', '-i', 'a'.repeat(64), 'env', '-i']);
  for (const flag of ['-X', '-w', 'ON_ERROR_STOP=1', 'HOME=/nonexistent', 'PGPASSFILE=/dev/null', 'PGSERVICEFILE=/dev/null', 'PGSYSCONFDIR=/nonexistent']) assert.ok(invocation.args.includes(flag));
  assert.equal(invocation.args.at(-1), AUTH_OWNER_CONNECTION);
  assert.equal(invocation.options.input, AUTH_OWNER_SQL); assert.equal(invocation.options.timeout, 25_000);
  assert.deepEqual(invocation.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.doesNotMatch(invocation.args.join(' '), /PGPASSWORD|PGSERVICE=|--password|https?:|postgresql:\/\//);
  for (const invalid of ['localhost', 'a'.repeat(63), 'a'.repeat(64) + ';', undefined]) assert.throws(() => authOwnerInvocation(invalid));
  const forged = Object.freeze({ container: { id: 'a'.repeat(64) } });
  for (const stack of [forged, { ...forged }, null]) assert.throws(() => provisionDisposableAuthUsage(stack), /unverified disposable stack capability/);
});

test('exact owner wrapper waits for process exit and refuses failures without raw output or fallback', () => {
  const source = read('scripts/qa-legacy-evidence-postgres.mjs');
  const start = source.indexOf('export function provisionDisposableAuthUsage('), end = source.indexOf('\nexport function loopbackFetch', start);
  assert.ok(start >= 0 && end > start);
  const cap = { container: { id: 'a'.repeat(64) } }, lines: string[] = []; let calls = 0, active = false;
  const guard = (value: unknown) => { if (value !== cap) throw new Error('unverified'); };
  const wrapper = (run: (...args: unknown[]) => unknown) => new Function('assertVerifiedStack', 'createLegacyEvidenceDiagnostics', 'authOwnerInvocation', 'execFileSync', 'AUTH_OWNER_READY',
    source.slice(start, end).replace('export function', 'function') + '\nreturn provisionDisposableAuthUsage;')(
    guard, createLegacyEvidenceDiagnostics, authOwnerInvocation, run, AUTH_OWNER_READY);
  const diagnostics = createLegacyEvidenceDiagnostics((line: string) => { if (line.includes('"passed"')) assert.equal(active, false); lines.push(line); });
  wrapper((command, args, options) => {
    calls++; active = true; assert.equal(command, 'docker'); assert.deepEqual(args, authOwnerInvocation(cap.container.id).args);
    assert.deepEqual(options, authOwnerInvocation(cap.container.id).options); active = false; return AUTH_OWNER_READY + '\n';
  })(cap, diagnostics);
  assert.equal(calls, 1);
  for (const output of ['private-output', '', AUTH_OWNER_READY + '\n' + AUTH_OWNER_READY, null]) {
    const before: number = calls;
    assert.throws(() => wrapper(() => { calls++; if (output === null) throw Object.assign(new Error('private-password'), { stderr: 'private-sql' }); return output; })(cap, diagnostics), { code: 'legacy_auth_owner_fixture_failed', message: 'disposable auth owner fixture failed' });
    assert.equal(calls, before + 1);
  }
  assert.equal(lines.join('\n').includes('private-'), false);
  assert.throws(() => wrapper(() => { calls++; })(structuredClone(cap), diagnostics), /unverified/);
  assert.equal(calls, 5);
});

test('deferred seed stays default-denied and one owner transaction changes only exact auth USAGE', async t => {
  const db = new PGlite(), ledger = read('supabase/migrations/20261010025109_language_legacy_evidence_ledger.sql'), enrollment = read('supabase/migrations/20261010040739_language_legacy_evidence_enrollment.sql');
  const scalar = async <T>(sql: string) => Object.values((await db.query(sql)).rows[0] as Record<string, unknown>)[0] as T;
  const inventory = () => scalar<Record<string, unknown>>(`select jsonb_build_object(
    'identity',jsonb_build_array(current_user,session_user),
    'memberships',(select jsonb_agg(to_jsonb(m) order by oid) from pg_auth_members m),
    'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),
    'schemas',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',nspowner,'acl',nspacl) order by oid) from pg_namespace where nspname in ('auth','public','language_legacy_evidence_private')),
    'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',proowner,'acl',proacl,'config',proconfig) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public','language_legacy_evidence_private')),
    'tables',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl) order by oid) from pg_class where relnamespace='auth'::regnamespace),
    'columns',(select jsonb_agg(jsonb_build_object('table',a.attrelid,'number',a.attnum,'acl',a.attacl) order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='auth'::regnamespace and attnum>0))`);
  try {
    await db.exec(`create role supabase_admin login superuser;
      set session authorization supabase_admin; alter role postgres rename to synthetic_bootstrap_admin;
      create role wrong_installer nosuperuser createrole;
      create role postgres login nosuperuser createdb createrole bypassrls;
      grant all on schema public to postgres; grant create on database postgres to postgres;
      create role authenticated; create role anon; create role service_role; create role synthetic_auth_admin;
      grant authenticated to postgres with inherit false,set true;
      create schema auth authorization supabase_admin;
      create table auth.users(id uuid primary key,banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      grant usage on schema auth,public to authenticated,anon;
      grant usage on schema auth to postgres,synthetic_auth_admin;
      grant all on all tables in schema auth to postgres;
      grant select,delete on auth.users to synthetic_auth_admin;
      set session authorization postgres; set createrole_self_grant='';
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
    await db.exec(read('tests/e2e/schema.sql'));
    for (const name of ['20260915034857_assistant_task_command_history.sql', '20260915052413_chatgpt_scoped_connection.sql', '20260916043619_assistant_language_commands.sql', '20260916045546_language_history_reset_triggers.sql']) await db.exec(read('supabase/migrations/' + name));
    await assert.rejects(db.exec(buildLegacyEvidenceInstallationFixture(ledger, enrollment)), { code: '42501', message: 'disposable_auth_usage_authority_unavailable' });
    await db.exec('rollback'); assert.equal(await scalar(`select to_regrole('${executor}')`), null);
    assert.throws(() => buildLegacyEvidenceInstallationFixture(ledger, enrollment, 'fallback'), /unsupported/);
    await db.exec(buildLegacyEvidenceInstallationFixture(ledger, enrollment, 'deferred-owner-stage'));
    for (const role of [executor, resetExecutor]) assert.equal(await scalar(`select has_schema_privilege('${role}','auth','USAGE')`), false);
    for (const signature of DISPOSABLE_WRITE_FUNCTIONS) assert.equal(await scalar(`select has_function_privilege('authenticated','${signature}','EXECUTE')`), false);
    const restricted = await inventory();
    await assert.rejects(db.exec(AUTH_OWNER_SQL), { code: '42501', message: 'disposable_auth_owner_identity_invalid' });
    await db.exec('rollback'); assert.deepEqual(await inventory(), restricted);
    await db.exec('reset session authorization; set session authorization supabase_admin;');
    const baseline = await inventory(), marker = '  -- No other ACL, role attribute, ownership or membership may change.';
    for (const [mutation, message] of [
      ["alter schema language_legacy_evidence_private owner to wrong_installer;", 'disposable_auth_owner_target_invalid'],
      ["alter schema auth owner to postgres;", 'disposable_auth_owner_identity_invalid'],
      [`alter role ${executor} login;`, 'disposable_auth_owner_target_invalid'],
      [`grant create on schema auth to ${executor};`, 'disposable_auth_owner_dependency_invalid'],
      [`grant usage on schema auth to ${executor} with grant option;`, 'disposable_auth_owner_dependency_invalid'],
      [`grant ${executor} to authenticated with inherit false,set false;`, 'disposable_auth_owner_dependency_invalid'],
      ...DISPOSABLE_WRITE_FUNCTIONS.map(signature => [`grant execute on function ${signature} to authenticated;`, 'disposable_auth_owner_writes_not_denied']),
    ]) {
      await assert.rejects(db.exec(AUTH_OWNER_SQL.replace('do $ci_auth_owner$', mutation + '\ndo $ci_auth_owner$')), { code: '42501', message });
      await db.exec('rollback'); assert.deepEqual(await inventory(), baseline);
    }
    for (const mutation of ["execute 'grant select(id) on auth.users to authenticated';", `execute 'alter role ${executor} login';`, "execute 'alter role synthetic_auth_admin superuser';", `execute 'grant ${executor} to authenticated with inherit false,set false';`, "execute 'grant usage on schema auth to service_role';", "execute 'revoke execute on function auth.uid() from public';"]) {
      await assert.rejects(db.exec(AUTH_OWNER_SQL.replace(marker, mutation + '\n' + marker)), { code: '42501', message: 'disposable_auth_owner_delta_mismatch' });
      await db.exec('rollback'); assert.deepEqual(await inventory(), baseline);
    }
    await assert.rejects(db.exec(AUTH_OWNER_SQL.replace(marker, 'perform 1/0;\n' + marker)), { code: '22012' });
    await db.exec('rollback'); assert.deepEqual(await inventory(), baseline);
    const targetGrants = () => scalar(`select jsonb_agg(jsonb_build_object('role',r.rolname,'grantor',g.rolname,'privilege',a.privilege_type,'grantable',a.is_grantable) order by r.rolname)
      from pg_namespace n cross join lateral aclexplode(n.nspacl) a join pg_roles r on r.oid=a.grantee join pg_roles g on g.oid=a.grantor where n.nspname='auth' and r.rolname in ('${executor}','${resetExecutor}')`);
    const expectedGrants = [executor, resetExecutor].sort().map(role => ({ role, grantor: 'supabase_admin', privilege: 'USAGE', grantable: false }));
    // The real staging path starts with both dependencies missing.
    await db.exec(AUTH_OWNER_SQL); const fresh = await inventory();
    assert.deepEqual(await targetGrants(), expectedGrants);
    for (const key of ['identity', 'memberships', 'roles', 'functions', 'tables', 'columns']) assert.deepEqual(fresh[key], baseline[key]);
    // Synthetic-only reset proves an exact baseline before the partial-grant case.
    await db.exec(`revoke usage on schema auth from ${executor},${resetExecutor};`);
    assert.deepEqual(await inventory(), baseline);
    // Preserve one preexisting target grant and add only the missing one.
    await db.exec(`grant usage on schema auth to ${executor};`);
    const before = await inventory(); await db.exec(AUTH_OWNER_SQL); const after = await inventory();
    for (const key of ['identity', 'memberships', 'roles', 'functions', 'tables', 'columns']) assert.deepEqual(after[key], before[key]);
    assert.deepEqual(await targetGrants(), expectedGrants);
    await db.exec(AUTH_OWNER_SQL); assert.deepEqual(await inventory(), after);
    for (const role of [executor, resetExecutor]) for (const table of ['auth.users', 'auth.sessions']) assert.equal(await scalar(`select has_table_privilege('${role}','${table}','SELECT') or has_any_column_privilege('${role}','${table}','SELECT')`), false);
    await db.exec('set session authorization postgres;');
    assert.equal(await scalar('select current_user=session_user and not rolsuper from pg_roles where rolname=current_user'), true);
    for (const signature of DISPOSABLE_WRITE_FUNCTIONS) assert.equal(await scalar(`select has_function_privilege('authenticated','${signature}','EXECUTE')`), false);
    const source = read('scripts/qa-legacy-evidence-postgres.mjs'), wrapper = source.match(/else await this\.query\(`(create function pg_temp\.qa_call[\s\S]*?)`\);/);
    assert.ok(wrapper); await db.exec(wrapper[1]);
    await db.exec("set role authenticated; set app.test_user='11111111-1111-4111-8111-111111111111';");
    const result = (await db.query<{ result: unknown }>('select pg_temp.qa_call($1) result', ["select language_legacy_evidence_private.read_context('22222222-2222-4222-8222-222222222222'::uuid,null::uuid,'139c003cd7b99e71a62dae22bd49d63524329c292bea6f953a9d1811a4045c0c')"])).rows[0].result;
    assert.deepEqual(result, { ok: false, sqlstate: '42501', error: 'legacy_auth_mismatch' });
    t.diagnostic('PGlite 18.3 role/ACL proof only; passwordless Unix-socket authentication and actual PostgreSQL 17 remain unrun.');
  } finally { await db.close(); }
});
