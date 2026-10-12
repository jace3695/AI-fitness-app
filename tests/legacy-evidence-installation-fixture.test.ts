/** Actual authored SQL under a NOSUPERUSER session. Single-connection PGlite,
 * PostgreSQL 18.x; this is not acceptance of the disposable Supabase PG17 stack. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EXECUTOR_DEPENDENCIES, AUTH_INSTALLER_CAPABILITIES, createLegacyEvidenceDiagnostics } from '../scripts/legacy-evidence-ci-diagnostics.mjs';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildLegacyEvidenceInstallationFixture } from '../scripts/legacy-evidence-installation-fixture.mjs';
import { DISPOSABLE_WRITE_FUNCTIONS } from '../scripts/qa-legacy-evidence-postgres.mjs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ledger = read('supabase/migrations/20261010025109_language_legacy_evidence_ledger.sql');
const enrollment = read('supabase/migrations/20261010040739_language_legacy_evidence_enrollment.sql');
const generated = buildLegacyEvidenceInstallationFixture(ledger, enrollment);
const firstCommit = generated.indexOf('\ncommit;\n') + '\ncommit;\n'.length;
const ledgerFixture = generated.slice(0, firstCommit), enrollmentFixture = generated.slice(firstCommit);
const executor = 'language_legacy_evidence_executor';
const resetExecutor = 'language_legacy_evidence_reset_executor';
const membershipSql = `select coalesce(jsonb_agg(to_jsonb(m) order by m.oid),'[]'::jsonb) value from pg_auth_members m
  where m.roleid in (select oid from pg_roles where rolname in ('${executor}','${resetExecutor}'))
     or m.member in (select oid from pg_roles where rolname in ('${executor}','${resetExecutor}'))`;
const cleanupAnchor = '\ndo $ci_install_scope$ declare saved record; target record; actual_memberships';

test('disposable auth USAGE uses only preexisting authority and restores exact scope state', async t => {
  for (const authority of ['absent', 'owner-set', 'direct-option', 'inherited-only']) await t.test(authority, async () => {
    const db = new PGlite();
    const scalar = async <T>(sql: string) => Object.values((await db.query(sql)).rows[0] as Record<string, unknown>)[0] as T;
    const snapshot = () => scalar(`select jsonb_build_object(
      'identity',jsonb_build_array(current_user,session_user),
      'memberships',(select jsonb_agg(to_jsonb(m) order by oid) from pg_auth_members m),
      'roles',(select jsonb_agg(to_jsonb(r) order by oid) from pg_roles r),
      'schemas',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',nspowner,'acl',nspacl) order by oid) from pg_namespace where nspname in ('auth','public','language_legacy_evidence_private')),
      'uid',(select jsonb_build_object('owner',proowner,'acl',proacl) from pg_proc where oid='auth.uid()'::regprocedure),
      'authRelations',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl) order by oid) from pg_class where relnamespace='auth'::regnamespace),
      'authColumns',(select jsonb_agg(jsonb_build_object('relation',a.attrelid,'number',a.attnum,'acl',a.attacl) order by a.attrelid,a.attnum)
        from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='auth'::regnamespace and a.attnum>0))`);
    try {
      // Auth is independently owned; the installer stays NOSUPERUSER, and every
      // usable authority below is established before installing either migration.
      await db.exec(`create role restricted_installer login nosuperuser createdb createrole noreplication bypassrls inherit;
        grant all on schema public to restricted_installer; grant create on database postgres to restricted_installer;
        create role authenticated; create role anon; create role service_role; create role synthetic_auth_admin; create role auth_grant_holder;
        grant authenticated to restricted_installer with inherit false,set true;
        create schema auth;
        create table auth.users(id uuid primary key,banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
        create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
        create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
        grant usage on schema auth,public to authenticated,anon;
        grant execute on function auth.uid(),auth.jwt() to authenticated,anon;
        grant usage on schema auth to synthetic_auth_admin; grant select,delete on auth.users to synthetic_auth_admin;
        alter schema auth owner to synthetic_auth_admin;
        alter table auth.users owner to synthetic_auth_admin; alter table auth.sessions owner to synthetic_auth_admin;
        alter function auth.uid() owner to synthetic_auth_admin; alter function auth.jwt() owner to synthetic_auth_admin;
        grant usage on schema auth to restricted_installer ${authority === 'direct-option' ? 'with grant option' : ''};
        ${authority === 'owner-set' ? 'grant synthetic_auth_admin to restricted_installer with inherit false,set true;' : ''}
        ${authority === 'inherited-only' ? 'grant usage on schema auth to auth_grant_holder with grant option; grant auth_grant_holder to restricted_installer with inherit true,set false;' : ''}
        grant all on all tables in schema auth to restricted_installer;
        set session authorization restricted_installer; set createrole_self_grant='';
        alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
      assert.equal(await scalar("select rolsuper from pg_roles where rolname=current_user"), false);
      assert.equal(await scalar("select pg_has_role(current_user,'synthetic_auth_admin','SET')"), authority === 'owner-set');
      await db.exec(read('tests/e2e/schema.sql'));
      for (const name of ['20260915034857_assistant_task_command_history.sql', '20260915052413_chatgpt_scoped_connection.sql',
        '20260916043619_assistant_language_commands.sql', '20260916045546_language_history_reset_triggers.sql']) await db.exec(read(`supabase/migrations/${name}`));
      const baseline = await snapshot(), openAnchor = '\n-- BEGIN DISPOSABLE CI INSTALLER SCOPE\n';
      // Original authored GRANT already succeeds for a direct/inherited option.
      // Remove its two grants in the test transaction to exercise the adapter's
      // actual direct-grant branch or its conservative inherited-only refusal.
      const forceMissing = authority === 'direct-option' || authority === 'inherited-only' ? `revoke usage on schema auth from ${executor},${resetExecutor};\n` : '';
      const fixture = ledgerFixture.replace(openAnchor, '\n' + forceMissing + openAnchor);
      if (authority === 'absent' || authority === 'inherited-only') {
        await assert.rejects(db.exec(fixture), { code: '42501', message: 'disposable_auth_usage_authority_unavailable' });
        await db.exec('rollback'); assert.deepEqual(await snapshot(), baseline);
        assert.equal(await scalar(`select to_regrole('${executor}')`), null);
        return;
      }
      // Prove both grants really occur before an injected error, then that a
      // failed transaction restores identity, all memberships and every ACL.
      await db.exec(fixture.slice(0, fixture.indexOf(cleanupAnchor)));
      for (const role of [executor, resetExecutor]) assert.equal(await scalar(`select has_schema_privilege('${role}','auth','USAGE')`), true);
      assert.equal(await scalar('select current_user=session_user'), true);
      await assert.rejects(db.exec('select 1/0'), { code: '22012' });
      await db.exec('rollback'); assert.deepEqual(await snapshot(), baseline);
      await assert.rejects(db.exec(fixture.replace("execute pg_catalog.format('set local role %I',saved.installer);",
        "perform 1/0; execute pg_catalog.format('set local role %I',saved.installer);")), { code: '22012' });
      await db.exec('rollback'); assert.deepEqual(await snapshot(), baseline);
      await assert.rejects(db.exec(fixture.replace(cleanupAnchor, "\nupdate pg_temp.legacy_evidence_ci_install_scope set auth_expected_acl='[]';" + cleanupAnchor)), { code: '42501', message: 'disposable_auth_usage_restoration_mismatch' });
      await db.exec('rollback'); assert.deepEqual(await snapshot(), baseline);
      const asGrantor = (sql: string) => authority === 'owner-set' ? `set local role synthetic_auth_admin;${sql};set local role restricted_installer;` : sql + ';';
      if (authority === 'owner-set') {
        const columnGrant = asGrantor('grant select(id) on auth.users to authenticated');
        await assert.rejects(db.exec(fixture.replace(cleanupAnchor, '\n' + columnGrant + cleanupAnchor)), { code: '42501', message: 'disposable_auth_usage_restoration_mismatch' });
        await db.exec('rollback'); assert.deepEqual(await snapshot(), baseline);
      }
      for (const forbidden of [...(authority === 'owner-set' ? [`grant create on schema auth to ${executor}`] : []), `grant usage on schema auth to ${executor} with grant option`]) {
        await assert.rejects(db.exec(fixture.replace(openAnchor, '\n' + asGrantor(forbidden) + openAnchor)), { code: '42501', message: 'disposable_auth_usage_unsupported_target' });
        await db.exec('rollback'); assert.deepEqual(await snapshot(), baseline);
      }
      await assert.rejects(db.exec(fixture.replace(openAnchor, `\nalter role ${executor} login;` + openAnchor)), /disposable installer identity or executor attributes changed/);
      await db.exec('rollback'); assert.deepEqual(await snapshot(), baseline);
      // A pre-satisfied target retains its existing grant; only the other target
      // is added. Neither target receives CREATE or grant option.
      await db.exec(fixture.replace(openAnchor, '\n' + asGrantor(`grant usage on schema auth to ${executor}`) + openAnchor));
      const grants = await scalar<Array<{ role: string; grantor: string; privilege: string; grantable: boolean }>>(`select jsonb_agg(jsonb_build_object('role',r.rolname,'grantor',g.rolname,'privilege',a.privilege_type,'grantable',a.is_grantable) order by r.rolname)
        from pg_namespace n cross join lateral aclexplode(n.nspacl) a join pg_roles r on r.oid=a.grantee join pg_roles g on g.oid=a.grantor
        where n.nspname='auth' and r.rolname in ('${executor}','${resetExecutor}')`);
      assert.deepEqual(grants, [executor, resetExecutor].sort().map(role => ({ role, grantor: authority === 'owner-set' ? 'synthetic_auth_admin' : 'restricted_installer', privilege: 'USAGE', grantable: false })));
      const afterLedger = await snapshot(); await db.exec(enrollmentFixture); assert.deepEqual(await snapshot(), afterLedger);
      for (const field of ['uid', 'authRelations', 'authColumns']) assert.deepEqual((afterLedger as Record<string, unknown>)[field], (baseline as Record<string, unknown>)[field]);
      const driver = read('scripts/qa-legacy-evidence-postgres.mjs');
      const begin = driver.indexOf('    const schema = await observer.scalar('), end = driver.indexOf('    fixtures = await createSyntheticAccounts(', begin);
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      const audit = new AsyncFunction('observer', 'assert', 'report', 'sha', 'DISPOSABLE_WRITE_FUNCTIONS', 'diagnostics', 'EXECUTOR_DEPENDENCIES', 'AUTH_INSTALLER_CAPABILITIES', driver.slice(begin, end));
      const lines: string[] = [];
      await audit({ scalar }, assert, { digests: {} }, () => 'synthetic', DISPOSABLE_WRITE_FUNCTIONS,
        createLegacyEvidenceDiagnostics((line: string) => lines.push(line)), EXECUTOR_DEPENDENCIES, AUTH_INSTALLER_CAPABILITIES);
      const capabilities = lines.map(line => JSON.parse(line.slice('[legacy-evidence-ci] '.length))).filter(row => row.capability);
      assert.deepEqual(capabilities.map(row => [row.capability, row.available]), [
        ['installer_auth_owner_set', authority === 'owner-set'], ['installer_auth_grant_option', authority === 'direct-option'], ['installer_auth_direct_grant_option', authority === 'direct-option'],
      ]);
      const wrapper = driver.match(/else await this\.query\(`(create function pg_temp\.qa_call[\s\S]*?)`\);/);
      assert.ok(wrapper); await db.exec(wrapper[1]);
      await db.exec("set role authenticated; set app.test_user='11111111-1111-4111-8111-111111111111';");
      const command = "select language_legacy_evidence_private.read_context('22222222-2222-4222-8222-222222222222'::uuid,null::uuid,'139c003cd7b99e71a62dae22bd49d63524329c292bea6f953a9d1811a4045c0c')";
      const result = (await db.query<{ result: unknown }>('select pg_temp.qa_call($1) result', [command])).rows[0].result;
      assert.deepEqual(result, { ok: false, sqlstate: '42501', error: 'legacy_auth_mismatch' });
      for (const signature of DISPOSABLE_WRITE_FUNCTIONS) assert.equal(await scalar(`select has_function_privilege('authenticated','${signature}','EXECUTE')`), false);
    } finally { await db.close(); }
  });
});

test('disposable adapter preserves authored bytes and refuses changed transaction/DDL anchors', () => {
  const restored = generated
    .replace(/\n-- BEGIN DISPOSABLE CI INSTALLER SCOPE[\s\S]*?end \$ci_install_scope\$;\n/g, '')
    .replace(/\ndo \$ci_install_scope\$ declare saved record; target record; actual_memberships[\s\S]*?-- END DISPOSABLE CI INSTALLER SCOPE\n/g, '');
  assert.equal(restored, ledger + '\n' + enrollment);
  assert.equal((generated.match(/-- END DISPOSABLE CI INSTALLER SCOPE\ncommit;/g) ?? []).length, 2);
  const firstOwner = 'alter function language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text) owner to language_legacy_evidence_executor;';
  for (const changed of [ledger.replace(firstOwner, ''), ledger.replace(firstOwner, firstOwner + '\n' + firstOwner),
    ledger.replace('commit;', 'commit;\nselect 1;'), ledger.replace('begin;', 'begin;\nbegin;'),
    ledger.replace(' nologin nosuperuser ', ' login nosuperuser '), ledger.replace('create schema language_legacy_evidence_private;', '')]) {
    assert.throws(() => buildLegacyEvidenceInstallationFixture(changed, enrollment), /disposable seed/);
  }
  assert.throws(() => buildLegacyEvidenceInstallationFixture(ledger, enrollment.replace('begin;', 'BEGIN;')), /disposable seed/);
  assert.throws(() => buildLegacyEvidenceInstallationFixture(ledger, enrollment.replace('commit;', 'commit;\ncommit;')), /disposable seed/);
  assert.throws(() => buildLegacyEvidenceInstallationFixture(ledger, enrollment.replace('begin;', 'begin; COMMIT; BEGIN;')), /disposable seed/);
  const launcher = read('scripts/e2e-stack.mjs');
  assert.ok(launcher.indexOf("process.env.GITHUB_ACTIONS !== 'true'") < launcher.indexOf('buildLegacyEvidenceInstallationFixture('));
  assert.doesNotMatch(generated, /alter role\s|disable row level security|nobypassrls\s*;/i);
});

test('restricted installer reproduces failure, restores each transaction and passes the real catalog audit', async t => {
  const db = new PGlite();
  const scalar = async <T>(sql: string) => Object.values((await db.query(sql)).rows[0] as Record<string, unknown>)[0] as T;
  const state = async () => ({ memberships: await scalar(membershipSql), acl: await scalar("select to_jsonb(nspacl) from pg_namespace where nspname='language_legacy_evidence_private'") });
  try {
    // Bootstrap ONLY establishes the synthetic installer. Every tested migration,
    // catalog audit and negative control runs with both session/current user below.
    await db.exec(`create role restricted_installer login nosuperuser createdb createrole noreplication bypassrls inherit;
      grant all on schema public to restricted_installer; grant create on database postgres to restricted_installer;
      set session authorization restricted_installer; set createrole_self_grant='';
      create role authenticated; create role anon; create role service_role; create role synthetic_auth_admin;
      grant authenticated to restricted_installer with inherit false,set true;
      create schema auth;
      create table auth.users(id uuid primary key,banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid(),auth.jwt() to authenticated,anon;
      grant usage on schema auth to synthetic_auth_admin; grant select,delete on auth.users to synthetic_auth_admin;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
    await db.exec(read('tests/e2e/schema.sql'));
    for (const name of ['20260915034857_assistant_task_command_history.sql', '20260915052413_chatgpt_scoped_connection.sql',
      '20260916043619_assistant_language_commands.sql', '20260916045546_language_history_reset_triggers.sql']) await db.exec(read(`supabase/migrations/${name}`));
    const identity = await scalar<{ current: string; session: string; superuser: boolean; createrole: boolean; bypassrls: boolean }>(`select jsonb_build_object('current',current_user,'session',session_user,'superuser',rolsuper,'createrole',rolcreaterole,'bypassrls',rolbypassrls) from pg_roles where rolname=current_user`);
    assert.deepEqual(identity, { current: 'restricted_installer', session: 'restricted_installer', superuser: false, createrole: true, bypassrls: true });
    t.diagnostic(`Synthetic engine ${await scalar('show server_version')}; Supabase PostgreSQL 17 execution is a separate required check.`);

    await t.test('original first ownership DDL fails with the actual SET ROLE SQLSTATE', async () => {
      const at = ledger.indexOf('alter function language_legacy_evidence_private.get_context(');
      await db.exec(ledger.slice(0, at));
      await assert.rejects(db.exec(ledger.slice(at, ledger.indexOf('\n', at))), { code: '42501', message: `must be able to SET ROLE "${executor}"` });
      await db.exec('rollback');
      assert.equal(await scalar(`select to_regrole('${executor}')`), null);
    });

    await t.test('ledger alone commits with only the original inert creator-admin memberships', async () => {
      await db.exec(ledgerFixture);
      const rows = await scalar<Array<{ admin_option: boolean; inherit_option: boolean; set_option: boolean; grantor: string }>>(membershipSql);
      assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.admin_option && !row.inherit_option && !row.set_option && Number(row.grantor) === 10));
      for (const role of [executor, resetExecutor]) {
        assert.equal(await scalar(`select has_schema_privilege('${role}','language_legacy_evidence_private','CREATE')`), false);
        await assert.rejects(db.exec(`set role ${role}`), { code: '42501' });
      }
      assert.equal(await scalar("select to_regclass('pg_temp.legacy_evidence_ci_install_scope')"), null);
    });

    await t.test('enrollment error rolls back authored DDL and temporary access', async () => {
      const baseline = await state();
      await assert.rejects(db.exec(enrollmentFixture.replace(cleanupAnchor, '\nselect 1/0;' + cleanupAnchor)), { code: '22012' });
      await db.exec('rollback');
      assert.deepEqual(await state(), baseline);
      assert.equal(await scalar("select to_regclass('public.language_legacy_evidence_enrollments')"), null);
      assert.equal(await scalar("select to_regclass('pg_temp.legacy_evidence_ci_install_scope')"), null);
    });

    await t.test('restoration mismatch and unsupported installer/role states abort without committed privilege drift', async () => {
      for (const modified of [
        enrollmentFixture.replace(cleanupAnchor, "\nupdate pg_temp.legacy_evidence_ci_install_scope set schema_acl='[]'::jsonb;" + cleanupAnchor),
        enrollmentFixture.replace(cleanupAnchor, "\nupdate pg_temp.legacy_evidence_ci_install_scope set installer='authenticated';" + cleanupAnchor),
        enrollmentFixture.replace('begin;\n', `begin;\nalter role ${executor} login;\n`),
        enrollmentFixture.replace('begin;\n', 'begin;\nset role authenticated;\n'),
      ]) {
        const baseline = await state();
        await assert.rejects(db.exec(modified), /disposable installer/);
        await db.exec('rollback');
        assert.deepEqual(await state(), baseline);
        assert.equal(await scalar('select current_user'), 'restricted_installer');
        assert.equal(await scalar(`select rolcanlogin from pg_roles where rolname='${executor}'`), false);
        assert.equal(await scalar("select to_regclass('public.language_legacy_evidence_enrollments')"), null);
      }
    });

    await t.test('enrollment restores preexisting own-grant options/OID and complete schema ACL', async () => {
      await db.exec(`grant ${executor} to restricted_installer with inherit false,set true granted by restricted_installer;
        grant ${resetExecutor} to restricted_installer with inherit true,set false granted by restricted_installer;
        grant create on schema language_legacy_evidence_private to ${executor};`);
      const baseline = await state();
      await db.exec(enrollmentFixture);
      assert.deepEqual(await state(), baseline);
      await db.exec(`revoke ${executor},${resetExecutor} from restricted_installer granted by restricted_installer restrict;
        revoke create on schema language_legacy_evidence_private from ${executor} restrict;`);
    });

    const driver = read('scripts/qa-legacy-evidence-postgres.mjs');
    const begin = driver.indexOf('    const schema = await observer.scalar(');
    const end = driver.indexOf('    fixtures = await createSyntheticAccounts(', begin);
    assert.ok(begin >= 0 && end > begin);
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const audit = new AsyncFunction('observer', 'assert', 'report', 'sha', 'DISPOSABLE_WRITE_FUNCTIONS', 'diagnostics', 'EXECUTOR_DEPENDENCIES', 'AUTH_INSTALLER_CAPABILITIES', driver.slice(begin, end));
    const runAudit = async () => {
      const report: { digests: Record<string, unknown>; installationRoleAudit?: { installerSuperuser: boolean; nonSuperuserInstallerRoleAccess: boolean } } = { digests: {} };
      await audit({ scalar }, assert, report, () => 'synthetic-restricted-audit', DISPOSABLE_WRITE_FUNCTIONS, createLegacyEvidenceDiagnostics(() => {}), EXECUTOR_DEPENDENCIES, AUTH_INSTALLER_CAPABILITIES);
      assert.equal(report.installationRoleAudit?.installerSuperuser, false);
      assert.equal(report.installationRoleAudit?.nonSuperuserInstallerRoleAccess, false);
    };
    await t.test('authored CI audit passes under the non-superuser installer', runAudit);

    await t.test('authored CI audit rejects unexpected direct, inert-admin and indirect app memberships', async () => {
      for (const mutation of [
        `grant ${executor} to authenticated with inherit false,set false`,
        `create role unexpected_admin; grant ${executor} to unexpected_admin with admin true,inherit false,set false`,
        `create role unexpected_bridge; grant ${executor} to unexpected_bridge with inherit true,set true; grant unexpected_bridge to authenticated with inherit true,set true`,
        `grant ${executor} to restricted_installer with inherit false,set false granted by restricted_installer`,
        `grant ${executor} to restricted_installer with inherit true,set true granted by restricted_installer`,
        `grant synthetic_auth_admin to ${executor}`,
        `grant create on schema language_legacy_evidence_private to ${executor}`,
      ]) {
        await db.exec('begin;' + mutation);
        await assert.rejects(runAudit());
        await db.exec('rollback');
        await runAudit();
      }
    });

    await t.test('restricted-session catalog audit rejects each accidentally reactivated write route', async () => {
      for (const signature of DISPOSABLE_WRITE_FUNCTIONS) {
        // The installer needs a temporary owner grant to make this negative
        // control. Roll it back before comparing the baseline after each case.
        await db.exec(`begin; grant ${executor} to restricted_installer with inherit true,set true granted by restricted_installer;
          grant execute on function ${signature} to authenticated;
          revoke ${executor} from restricted_installer granted by restricted_installer restrict;`);
        await assert.rejects(runAudit());
        await db.exec('rollback');
        await runAudit();
      }
    });

    await t.test('authenticated session cannot SET executor roles or call any default-disabled write function', async () => {
      await db.exec('set role authenticated');
      assert.equal(await scalar('select current_user'), 'authenticated');
      assert.equal(await scalar('select session_user'), 'restricted_installer');
      for (const role of [executor, resetExecutor]) await assert.rejects(db.exec(`set role ${role}`), { code: '42501' });
      for (const signature of DISPOSABLE_WRITE_FUNCTIONS) {
        const call = signature.replace(/\((.*)\)/, (_: string, args: string) => '(' + args.split(',').map(type => `null::${type}`).join(',') + ')');
        await assert.rejects(db.exec(`select ${call}`), { code: '42501' });
      }
      await db.exec('reset role');
      await runAudit();
    });
  } finally { await db.close(); }
});
