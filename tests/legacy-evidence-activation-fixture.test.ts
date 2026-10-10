import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { AUTH_OWNER_SQL } from '../scripts/legacy-evidence-auth-owner-fixture.mjs';
import { buildLegacyEvidenceInstallationFixture } from '../scripts/legacy-evidence-installation-fixture.mjs';
import { DISPOSABLE_WRITE_FUNCTIONS, DISPOSABLE_EVIDENCE_RELEASE } from '../scripts/qa-legacy-evidence-postgres.mjs';
import { createLegacyEvidenceDiagnostics, diagnosticAssert, rememberSqlDenial } from '../scripts/legacy-evidence-ci-diagnostics.mjs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const executor = 'language_legacy_evidence_executor', resetExecutor = 'language_legacy_evidence_reset_executor';

import { DISPOSABLE_ACTIVATION_SQL } from '../scripts/legacy-evidence-activation-fixture.mjs';
test('restricted disposable activation restores exact authority and grants only six authenticated EXECUTEs', async t => {
  const db = new PGlite(), ledger = read('supabase/migrations/20261010025109_language_legacy_evidence_ledger.sql'), enrollment = read('supabase/migrations/20261010040739_language_legacy_evidence_enrollment.sql');
  const scalar = async <T>(sql: string) => Object.values((await db.query(sql)).rows[0] as Record<string, unknown>)[0] as T;
  const inventory = () => scalar<Record<string, unknown>>(`select jsonb_build_object(
    'identity',jsonb_build_array(current_user,session_user),
    'memberships',(select jsonb_agg(to_jsonb(m) order by oid) from pg_auth_members m),
    'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),
    'schemas',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',nspowner,'acl',nspacl) order by oid) from pg_namespace where nspname in ('auth','public','language_legacy_evidence_private')),
    'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',proowner,'acl',proacl,'config',proconfig) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public','language_legacy_evidence_private')),
    'tables',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl) order by oid) from pg_class where relnamespace in ('auth'::regnamespace,'public'::regnamespace,'language_legacy_evidence_private'::regnamespace)),
    'columns',(select jsonb_agg(jsonb_build_object('table',a.attrelid,'number',a.attnum,'acl',a.attacl) order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace in ('auth'::regnamespace,'public'::regnamespace,'language_legacy_evidence_private'::regnamespace) and attnum>0))`);
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
    await db.exec('reset session authorization; set session authorization supabase_admin;');
    await db.exec(AUTH_OWNER_SQL); await db.exec('set session authorization postgres;');
    const baseline = await inventory();
    // The exact old statement fails before granting any of the six functions.
    await assert.rejects(db.exec(`grant execute on function ${DISPOSABLE_WRITE_FUNCTIONS.join(',')} to authenticated;`), { code: '42501', message: 'permission denied for function get_context' });
    assert.deepEqual(await inventory(), baseline);
    type Outcome = { ok: boolean; sqlstate?: string; error?: string };
    const run = async (sql = DISPOSABLE_ACTIVATION_SQL): Promise<Outcome> => {
      await db.exec(sql);
      assert.equal(await scalar("select prosecdef from pg_proc where oid='pg_temp.qa_activate()'::regprocedure"), false);
      const outcome = await scalar<Outcome>('select pg_temp.qa_activate();');
      await db.exec('drop function pg_temp.qa_activate();'); return outcome;
    };
    const expectedFailure = (error: string, sqlstate = '42501') => ({ ok: false, error, sqlstate });
    await db.exec(DISPOSABLE_ACTIVATION_SQL);
    await db.exec('set role authenticated;');
    assert.deepEqual(await scalar('select pg_temp.qa_activate();'), expectedFailure('legacy_activation_identity'));
    await db.exec('reset role; drop function pg_temp.qa_activate();');
    assert.deepEqual(await inventory(), baseline);
    const inject = (statement: string) => DISPOSABLE_ACTIVATION_SQL.replace('target record; begin', 'target record; begin\n' + statement);
    for (const [sql, error] of [
      [inject('set local role authenticated;'), 'legacy_activation_identity'],
      [inject(`alter role ${executor} login;`), 'legacy_activation_authority'],
      [inject(`grant ${executor} to postgres with inherit false,set false granted by postgres;`), 'legacy_activation_authority'],
      [inject(`grant ${executor} to authenticated with inherit false,set false granted by postgres;`), 'legacy_activation_authority'],
      ...DISPOSABLE_WRITE_FUNCTIONS.filter(value => value.startsWith('public.')).map(signature => [inject(`grant execute on function ${signature} to authenticated;`), 'legacy_activation_baseline']),
      ...DISPOSABLE_WRITE_FUNCTIONS.filter(value => !value.startsWith('public.')).map(signature => [inject(`grant ${executor} to postgres with inherit false,set true granted by postgres;
        set local role ${executor}; grant execute on function ${signature} to authenticated; set local role postgres;
        revoke ${executor} from postgres granted by postgres restrict;`), 'legacy_activation_baseline']),
      [inject(`alter function ${DISPOSABLE_WRITE_FUNCTIONS[0]} security definer;`), 'legacy_activation_baseline'],
    ]) {
      assert.deepEqual(await run(sql), expectedFailure(error)); assert.deepEqual(await inventory(), baseline);
    }
    // A bad preexisting baseline must remain unchanged by a refused activation.
    // Synthetic bootstrap changes are outside the helper and rolled back here.
    for (const mutation of [
      ...DISPOSABLE_WRITE_FUNCTIONS.map(signature => `grant execute on function ${signature} to authenticated;`),
      `alter function ${DISPOSABLE_WRITE_FUNCTIONS[1]} owner to supabase_admin;`,
      `alter function ${DISPOSABLE_WRITE_FUNCTIONS[0]} security definer;`,
    ]) {
      await db.exec('set session authorization synthetic_bootstrap_admin; begin;');
      await db.exec(mutation + 'set session authorization postgres;');
      const invalid = await inventory();
      assert.deepEqual(await run(), expectedFailure('legacy_activation_baseline')); assert.deepEqual(await inventory(), invalid);
      await db.exec('rollback; set session authorization postgres;'); assert.deepEqual(await inventory(), baseline);
    }
    const marker = '  -- Restoration and the exact six grants must be proved before this call commits.';
    for (const mutation of [
      'grant select on public.language_legacy_evidence_manifests to authenticated;',
      'grant select(manifest_digest) on public.language_legacy_evidence_manifests to authenticated;',
      'grant usage on schema language_legacy_evidence_private to service_role;',
      `grant ${executor} to authenticated with inherit false,set false granted by postgres;`,
      `alter role ${resetExecutor} login;`,
      "grant execute on function public.read_language_legacy_evidence_context(uuid,uuid,text) to anon;",
    ]) {
      assert.deepEqual(await run(DISPOSABLE_ACTIVATION_SQL.replace(marker, mutation + '\n' + marker)), expectedFailure('legacy_activation_delta'));
      assert.deepEqual(await inventory(), baseline);
    }
    // Error while switched to the executor rolls back the self-grant and all ACLs.
    const elevatedFailure = DISPOSABLE_ACTIVATION_SQL.replace('  set local role postgres;', "  raise exception 'synthetic hidden SQL error' using errcode='42501';\n  set local role postgres;");
    const failed = await run(elevatedFailure);
    assert.deepEqual(failed, expectedFailure('sql_error')); assert.deepEqual(await inventory(), baseline);
    const lines: string[] = [], diagnostics = createLegacyEvidenceDiagnostics((line: string) => lines.push(line));
    diagnostics.start('audit', 'disposable_activation');
    let original: unknown;
    try { diagnosticAssert.equal(failed.ok, true); } catch (error) { original = error; rememberSqlDenial(error, failed); diagnostics.failed(error); }
    assert.ok(original); assert.ok(lines.some(line => line.includes('"sqlstate":"42501"') && line.includes('"error":"sql_error"')));
    assert.ok(lines.every(line => !line.includes('hidden SQL') && line.length <= 512));
    // Restoration/proof errors cannot commit the grant even after identity reset.
    for (const sql of [DISPOSABLE_ACTIVATION_SQL.replace(marker, "raise exception 'synthetic';\n" + marker),
      DISPOSABLE_ACTIVATION_SQL.replace('  revoke language_legacy_evidence_executor from postgres granted by postgres restrict;', '')]) {
      assert.equal((await run(sql)).ok, false); assert.deepEqual(await inventory(), baseline);
    }
    const driver = read('scripts/qa-legacy-evidence-postgres.mjs');
    const start = driver.indexOf('    assertVerifiedStack(stack);', driver.indexOf("diagnostics.start('audit', 'disposable_activation')"));
    const end = driver.indexOf('    diagnostics.passed();', start);
    assert.ok(start > 0 && end > start);
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const slice = new AsyncFunction('a', 'observer', 'stack', 'assertVerifiedStack', 'DISPOSABLE_ACTIVATION_SQL', 'success', 'rememberSqlDenial', 'assert', 'DISPOSABLE_WRITE_FUNCTIONS', 'literal', 'report', 'DISPOSABLE_EVIDENCE_RELEASE', driver.slice(start, end));
    const stack = Object.freeze({ synthetic: true }), report: Record<string, unknown> = {}; let queries = 0;
    const activate = (sql: string, capability: unknown = stack) => slice({ query: (command: string) => { queries++; return db.exec(command); }, scalar }, { scalar }, capability,
      (value: unknown) => { assert.equal(value, stack); }, sql, (result: Outcome) => { diagnosticAssert.equal(result.ok, true); }, rememberSqlDenial,
      assert, DISPOSABLE_WRITE_FUNCTIONS, (value: string) => `'${value}'`, report, DISPOSABLE_EVIDENCE_RELEASE);
    await assert.rejects(activate(DISPOSABLE_ACTIVATION_SQL, { ...stack }), { code: 'ERR_ASSERTION' }); assert.equal(queries, 0);
    try { await activate(elevatedFailure); assert.fail('activation should reject'); } catch (error) {
      assert.equal((error as { code?: string }).code, 'ERR_ASSERTION'); diagnostics.failed(error);
    }
    assert.equal(await scalar("select to_regprocedure('pg_temp.qa_activate()')"), null);
    assert.deepEqual(await inventory(), baseline);
    assert.ok(lines.at(-1)!.includes('"sqlstate":"42501"') && lines.at(-1)!.includes('"error":"sql_error"'));
    await activate(DISPOSABLE_ACTIVATION_SQL); const after = await inventory();
    assert.equal(await scalar("select to_regprocedure('pg_temp.qa_activate()')"), null);
    assert.deepEqual(report.disposableWriteActivation, { functions: [...DISPOSABLE_WRITE_FUNCTIONS], release: DISPOSABLE_EVIDENCE_RELEASE });
    for (const key of ['identity', 'memberships', 'roles', 'schemas', 'tables', 'columns']) assert.deepEqual(after[key], baseline[key]);
    const grants = await scalar(`select jsonb_agg(jsonb_build_object('signature',f.signature,'grantor',g.rolname,'privilege',a.privilege_type,'grantable',a.is_grantable) order by f.signature)
      from (values ${DISPOSABLE_WRITE_FUNCTIONS.map(value => `('${value}')`).join(',')}) f(signature)
      join pg_proc p on p.oid=f.signature::regprocedure cross join lateral aclexplode(p.proacl) a join pg_roles g on g.oid=a.grantor where a.grantee='authenticated'::regrole`);
    assert.deepEqual(grants, [...DISPOSABLE_WRITE_FUNCTIONS].sort().map(signature => ({ signature, grantor: signature.startsWith('public.') ? 'postgres' : executor, privilege: 'EXECUTE', grantable: false })));
    for (const signature of DISPOSABLE_WRITE_FUNCTIONS) assert.equal(await scalar(`select has_function_privilege('authenticated','${signature}','EXECUTE WITH GRANT OPTION')`), false);
    assert.equal(await scalar(`select pg_has_role(current_user,'${executor}','SET') or pg_has_role(current_user,'${executor}','USAGE')`), false);
    assert.deepEqual(await run(), expectedFailure('legacy_activation_baseline')); assert.deepEqual(await inventory(), after);
    // Remove the creator ADMIN capability in this synthetic DB only. Activation
    // must refuse rather than invent authority or change the invalid baseline.
    await db.exec('set session authorization synthetic_bootstrap_admin;');
    await db.exec(`revoke ${executor} from postgres granted by synthetic_bootstrap_admin; set session authorization postgres;`);
    const noAuthority = await inventory();
    assert.deepEqual(await run(), expectedFailure('legacy_activation_authority')); assert.deepEqual(await inventory(), noAuthority);
    t.diagnostic('PGlite 18.3 proof only; actual PostgreSQL 17 activation and race/HTTP/browser acceptance remain separate.');
  } finally { await db.close(); }
});
