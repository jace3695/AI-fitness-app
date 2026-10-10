import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DISPOSABLE_EVIDENCE_RELEASE, DISPOSABLE_WRITE_FUNCTIONS, SOURCE_INPUTS, CASES, createSyntheticAccounts, runPostgresHarness, loopbackFetch, selectDatabaseContainer, validateEnvironment } from '../scripts/qa-legacy-evidence-postgres.mjs';

const config = 'project_id = "isolated_stack"\n[api]\nport = 54321\n[db]\nport = 54322\nmajor_version = 17\n[auth]\nenabled = true\n';
const env = { GITHUB_ACTIONS: 'true', RUNNER_TEMP: '/tmp/synthetic-runner', GITHUB_RUN_ID: '123', GITHUB_JOB: 'isolated' };
const status = { API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'synthetic-anon', SERVICE_ROLE_KEY: 'synthetic-service', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54322/postgres' };
const metadata = () => ({ Id: 'a'.repeat(64), Name: '/supabase_db_isolated_stack', State: { Running: true },
  Config: { Labels: { 'com.supabase.cli.project': 'isolated_stack' }, Image: 'public.ecr.aws/supabase/postgres:17.6.1.063' }, Image: `sha256:${'b'.repeat(64)}`,
  NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54322' }] } } });

test('CI harness preflight is pure and refuses ordinary execution before files or subprocesses', () => {
  assert.throws(() => validateEnvironment({}, config, status), /disposable GitHub Actions runner required/);
  assert.deepEqual(validateEnvironment(env, config, status), { projectId: 'isolated_stack', major: '17', apiUrl: 'http://127.0.0.1:54321' });
  for (const patch of [{ GITHUB_ACTIONS: 'false' }, { RUNNER_TEMP: '' }, { GITHUB_RUN_ID: '' }, { GITHUB_JOB: '' },
    { DATABASE_URL: status.DB_URL }, { PGHOST: '127.0.0.1' }, { SUPABASE_ACCESS_TOKEN: 'not-a-token' }, { DOCKER_HOST: 'tcp://example.invalid:2375' }, { DOCKER_CONTEXT: 'remote' }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'external-key' },
    { SUPABASE_URL: 'https://example.invalid' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid' }]) {
    assert.throws(() => validateEnvironment({ ...env, ...patch }, config, status), /harness-refused/);
  }
});

test('CI harness refuses hosted, ambiguous, wrong-port and credential-bearing URL routes', () => {
  for (const API_URL of ['http://localhost:54321', 'https://127.0.0.1:54321', 'https://example.invalid', 'http://127.0.0.1:54322']) {
    assert.throws(() => validateEnvironment(env, config, { ...status, API_URL }), /harness-refused/);
  }
  for (const DB_URL of ['postgresql://postgres:synthetic@example.invalid:54322/postgres', 'postgresql://postgres:synthetic@127.0.0.1:5432/postgres',
    'postgresql://postgres:synthetic@127.0.0.1:54322/production', 'postgresql://other:synthetic@127.0.0.1:54322/postgres',
    `${status.DB_URL}?host=example.invalid`, `${status.DB_URL}#fragment`]) {
    assert.throws(() => validateEnvironment(env, config, { ...status, DB_URL }), /harness-refused/);
  }
  for (const invalid of [config.replace('54321', '54320'), config.replace('54322', '54323'), `${config}\nproject_id = "second"\n`, config.replace('isolated_stack', '../stack')]) {
    assert.throws(() => validateEnvironment(env, invalid, status), /harness-refused/);
  }
});

test('Docker discovery requires exact immutable container identity, label, image, running state and port', () => {
  const expected = validateEnvironment(env, config, status), row = metadata();
  assert.equal(selectDatabaseContainer([row], expected).id, row.Id);
  assert.throws(() => selectDatabaseContainer([], expected), /ambiguous/);
  assert.throws(() => selectDatabaseContainer([row, row], expected), /ambiguous/);
  for (const mutate of [
    (value: ReturnType<typeof metadata>) => { value.Id = 'short-id'; },
    (value: ReturnType<typeof metadata>) => { value.Name = '/supabase_db_other'; },
    (value: ReturnType<typeof metadata>) => { value.State.Running = false; },
    (value: ReturnType<typeof metadata>) => { value.Config.Labels['com.supabase.cli.project'] = 'other'; },
    (value: ReturnType<typeof metadata>) => { value.Config.Image = 'untrusted/postgres:17.6.1'; },
    (value: ReturnType<typeof metadata>) => { value.Config.Image = 'supabase/postgres:16.1'; },
    (value: ReturnType<typeof metadata>) => { value.Image = 'latest'; },
    (value: ReturnType<typeof metadata>) => { value.NetworkSettings.Ports['5432/tcp'][0].HostPort = '5432'; },
  ]) { const invalid = metadata(); mutate(invalid); assert.throws(() => selectDatabaseContainer([invalid], expected), /harness-refused/); }
});

test('HTTP origin barrier rejects providers, redirects and credentials before invoking fetch', async () => {
  let requests = 0;
  const transport = loopbackFetch(async (_input: unknown, init: RequestInit) => { requests++; assert.equal(init.redirect, 'error'); return new Response('{}'); });
  for (const url of ['https://example.invalid/rest/v1/rpc/x', 'http://localhost:54321/auth/v1/token', 'http://user:pass@127.0.0.1:54321/auth/v1/token',
    'http://127.0.0.1:54321/functions/v1/provider', 'http://127.0.0.1:54321/storage/v1/object']) await assert.rejects(transport(url), /harness-refused/);
  assert.equal(requests, 0); await transport('http://127.0.0.1:54321/auth/v1/token'); assert.equal(requests, 1);
});

test('inactive source contains all eleven bounded schedules and independent HTTP entry point', () => {
  const source = readFileSync(new URL('../scripts/qa-legacy-evidence-postgres.mjs', import.meta.url), 'utf8');
  const http = readFileSync(new URL('../scripts/qa-legacy-evidence-http.mjs', import.meta.url), 'utf8');
  const discovery = readFileSync(new URL('../scripts/test.mjs', import.meta.url), 'utf8');
  assert.equal(CASES.length, 11); assert.equal(new Set(CASES).size, 11);
  for (let index = 0; index < CASES.length; index++) assert.ok(source.includes(`await run(CASES[${index}]`));
  assert.match(source, /pg_catalog\.pg_blocking_pids/); assert.match(source, /statement_timeout = '12s'/);
  assert.match(source, /new PsqlSession\(stack.container, 'legacy_evidence_qa_a'\)/);
  assert.match(source, /new PsqlSession\(stack.container, 'legacy_evidence_qa_b'\)/);
  assert.match(source, /new PsqlSession\(stack.container, 'legacy_evidence_qa_observer'\)/);
  assert.match(source, /set default_transaction_read_only = on/);
  assert.match(source, /await b\.rollback\(\); assert\.equal\(\(await state\(second.owner\)\)\.generation, null\)/);
  assert.match(source, /sameMarkerPreserved: true/); assert.match(source, /fixtures.deleteAccount/);
  assert.match(discovery, /endsWith\('\.test\.ts'\)/);
  assert.doesNotMatch(source + http, /supabase\s+(?:login|link|db\s+push)|https:\/\//);
  assert.match(http, /const stack = verifyDisposableStack\(diagnostics\)/);
  assert.match(http, /loadLegacyEvidenceRepository\(client, DISPOSABLE_EVIDENCE_RELEASE\)/);
  assert.match(http, /createLanguageSyncCoordinator/); assert.match(http, /await response\.json\(\)/);
  assert.match(http, /dropReadAfterAppend/); assert.match(http, /await coordinator\.resume\(\)/);
  assert.match(http, /mode: 'existing'/); assert.doesNotMatch(http, /as AuthenticatedReceipt|registerAuthenticatedReceiptReadback/);
});

test('authored catalog audit executes against actual migration in PGlite, without claiming real roles or races', async () => {
  const { createLegacyEvidenceSqlFixture } = await import('./helpers/legacy-evidence-sql.ts');
  const fixture = await createLegacyEvidenceSqlFixture();
  try {
    const source = readFileSync(new URL('../scripts/qa-legacy-evidence-postgres.mjs', import.meta.url), 'utf8');
    const begin = source.indexOf('    const schema = await observer.scalar('), end = source.indexOf('    fixtures = await createSyntheticAccounts(', begin);
    assert.ok(begin >= 0 && end > begin);
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const audit = new AsyncFunction('observer', 'assert', 'report', 'sha', 'DISPOSABLE_WRITE_FUNCTIONS', 'diagnostics', source.slice(begin, end));
    const diagnostics = { start() {}, passed() {} };
    const report: { digests: Record<string, unknown>; installationRoleAudit?: { installerSuperuser: boolean } } = { digests: {} };
    await audit({ async scalar(sql: string) { const result = await fixture.db.query(sql); assert.equal(result.rows.length, 1); return Object.values(result.rows[0] as Record<string, unknown>)[0]; } }, assert, report, () => 'synthetic-audit-digest', DISPOSABLE_WRITE_FUNCTIONS, diagnostics);
    assert.ok('installedPrivilegeAudit' in report.digests);
    assert.equal(report.installationRoleAudit?.installerSuperuser, true);
    // The same catalog audit must reject even one accidentally re-enabled route.
    for (const signature of DISPOSABLE_WRITE_FUNCTIONS) {
      await fixture.db.exec(`grant execute on function ${signature} to authenticated`);
      await assert.rejects(audit({ async scalar(sql: string) {
        const result = await fixture.db.query(sql); return Object.values(result.rows[0] as Record<string, unknown>)[0];
      } }, assert, { digests: {} }, () => 'synthetic-audit-digest', DISPOSABLE_WRITE_FUNCTIONS, diagnostics));
      await fixture.db.exec(`revoke execute on function ${signature} from authenticated`);
    }

    // Execute only the authored error-boundary SQL on this synthetic connection.
    // Its exception block is a real subtransaction, so ON_ERROR_STOP need not be disabled.
    const wrapper = source.match(/else await this\.query\(`(create function pg_temp\.qa_call[\s\S]*?)`\);/);
    assert.ok(wrapper); await fixture.db.exec(wrapper[1]);
    const owner = await fixture.addOwner();
    await fixture.db.exec('begin');
    const failed = await fixture.db.query<{ result: { ok: boolean; sqlstate: string } }>('select pg_temp.qa_call($1) result', ['select null::jsonb from public.language_legacy_evidence_events']);
    assert.equal(failed.rows[0].result.ok, false); assert.equal(failed.rows[0].result.sqlstate, '42501');
    const success = await fixture.db.query<{ result: { ok: boolean; value: string } }>('select pg_temp.qa_call($1) result', [`select to_jsonb(auth.uid())`]);
    assert.equal(success.rows[0].result.ok, true); assert.equal(success.rows[0].result.value, owner);
    await fixture.db.exec('rollback');
  } finally { await fixture.close(); }
});


test('fabricated or copied stack objects cannot spawn psql or create HTTP accounts', async () => {
  const forged = Object.freeze({ projectId: 'isolated_stack', apiUrl: status.API_URL, container: { id: 'a'.repeat(64) }, status });
  let fetchCalls = 0;
  await assert.rejects(runPostgresHarness(forged), /unverified disposable stack capability/);
  await assert.rejects(createSyntheticAccounts(forged, 1, async () => { fetchCalls++; return new Response('{}'); }), /unverified disposable stack capability/);
  await assert.rejects(runPostgresHarness({ ...forged }), /unverified disposable stack capability/);
  assert.equal(fetchCalls, 0);
});


test('fixture opt-in is exact, private and after actual default-denial checks', () => {
  assert.deepEqual(DISPOSABLE_EVIDENCE_RELEASE, { resetProtocol: 'protocol-required', enrollmentEnabled: true, captureEnabled: true });
  assert.deepEqual(DISPOSABLE_WRITE_FUNCTIONS, [
    'public.get_language_legacy_evidence_context(uuid,jsonb,text,text,text)',
    'language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text)',
    'public.enroll_language_legacy_evidence_v1(uuid,uuid,jsonb,text,text,text,text)',
    'language_legacy_evidence_private.enroll_v1(uuid,uuid,jsonb,text,text,text,text)',
    'public.append_language_legacy_evidence(uuid,uuid,text,uuid,text,jsonb,text[])',
    'language_legacy_evidence_private.append_events(uuid,uuid,text,uuid,text,jsonb,text[])',
  ]);
  const driver = readFileSync(new URL('../scripts/qa-legacy-evidence-postgres.mjs', import.meta.url), 'utf8');
  const denied = driver.indexOf("report.defaultWriteDenial = 'passed'");
  const grant = driver.indexOf('await a.query(`grant execute on function');
  assert.ok(denied > 0 && grant > denied);
  assert.match(driver.slice(denied, grant), /assertVerifiedStack\(stack\)/);
  assert.match(driver.slice(grant), /DISPOSABLE_WRITE_FUNCTIONS.join\(','\)/);
  assert.doesNotMatch(driver, /grant execute on all functions|grant all/);
  assert.ok(driver.includes('oldInitializerCannotRepair: true'));
  assert.ok(driver.includes('markerRollbackCannotRevive: true'));
  assert.ok(driver.includes('competingNonceNotFirstAdmission: true'));
  const http = readFileSync(new URL('../scripts/qa-legacy-evidence-http.mjs', import.meta.url), 'utf8');
  for (const contract of ['firstEnrollmentRequest.creation_request_id', 'dropEnrollment', 'read_language_legacy_evidence_status',
    'loadResetAppRecords', "resetProtocol: 'inactive'", 'captureEnabled: false', 'resetApi.fence().evidenceCleanup.status',
    'reset_carry', 'completedResetRetryPreservesCurrentGeneration', 'local_continuity_unknown']) assert.ok(http.includes(contract), contract);
  assert.doesNotMatch(http, /repository\.cleanupAfterReset|registerAuthenticatedFirstAdmission|registerAuthenticatedResetEvidenceState/);
});

test('candidate source digests cover additive migration and the exact release/reset/admission contract', () => {
  assert.deepEqual(SOURCE_INPUTS, [...SOURCE_INPUTS].sort()); assert.equal(new Set(SOURCE_INPUTS).size, SOURCE_INPUTS.length);
  for (const path of ['supabase/migrations/20261010040739_language_legacy_evidence_enrollment.sql',
    'scripts/e2e-stack.mjs', 'scripts/legacy-evidence-ci-diagnostics.mjs', 'scripts/legacy-evidence-installation-fixture.mjs', 'scripts/qa-legacy-evidence-postgres.mjs', 'scripts/qa-legacy-evidence-http.mjs',
    'tests/legacy-evidence-installation-fixture.test.ts', 'tests/legacy-evidence-ci-harness.test.ts', 'tests/legacy-evidence-ci-diagnostics.test.ts', 'tests/legacy-evidence-ci-wiring.test.ts',
    'app/data/languageLegacyEvidenceRelease.ts', 'app/data/languageLegacyEvidenceRepository.ts', 'app/lib/resetAppRecords.ts',
    'app/data/languageResetFence.ts', 'app/data/languageStorageBoundary.ts', 'lib/language-legacy-evidence/local-store.ts',
    'lib/language-legacy-evidence/store-admission-types.ts', 'lib/language-legacy-evidence/receipt-proof.ts',
    'lib/language-legacy-evidence/canonical-hash.ts', 'lib/language-legacy-evidence/validation.ts',
    'lib/language-legacy-evidence/server-types.ts', 'lib/language-legacy-evidence/capture.ts',
    'lib/language-legacy-evidence/idb-test-adapter.ts', 'app/data/authenticatedStorageOwner.ts',
    'app/data/languageSyncCoordinator.ts', 'tests/helpers/languageFixture.ts', 'tests/helpers/storageProtocol.ts', 'package-lock.json']) assert.ok(SOURCE_INPUTS.includes(path), path);
  for (const path of SOURCE_INPUTS) assert.ok(readFileSync(new URL(`../${path}`, import.meta.url)).length);
});
