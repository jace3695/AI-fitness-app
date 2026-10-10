/** Inactive CI gate. Never imported for its side effects and never a *.test.ts. */
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { CASES, REFUSALS, EXECUTOR_DEPENDENCIES, AUTH_INSTALLER_CAPABILITIES, createLegacyEvidenceDiagnostics, diagnosticAssert as assert, rememberSqlDenial, safeCode } from './legacy-evidence-ci-diagnostics.mjs';
import { AUTH_OWNER_READY, authOwnerInvocation } from './legacy-evidence-auth-owner-fixture.mjs';
export { CASES } from './legacy-evidence-ci-diagnostics.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = 'supabase/migrations/20261010025109_language_legacy_evidence_ledger.sql';
const ENROLLMENT_MIGRATION = 'supabase/migrations/20261010040739_language_legacy_evidence_enrollment.sql';
// Explicit fixture-only release. Never written to the built app or environment.
export const DISPOSABLE_EVIDENCE_RELEASE = Object.freeze({ resetProtocol: 'protocol-required', enrollmentEnabled: true, captureEnabled: true });
export const DISPOSABLE_WRITE_FUNCTIONS = Object.freeze([
  'public.get_language_legacy_evidence_context(uuid,jsonb,text,text,text)',
  'language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text)',
  'public.enroll_language_legacy_evidence_v1(uuid,uuid,jsonb,text,text,text,text)',
  'language_legacy_evidence_private.enroll_v1(uuid,uuid,jsonb,text,text,text,text)',
  'public.append_language_legacy_evidence(uuid,uuid,text,uuid,text,jsonb,text[])',
  'language_legacy_evidence_private.append_events(uuid,uuid,text,uuid,text,jsonb,text[])',
]);
const DEPENDENCIES = [
  'supabase/migrations/20260915034857_assistant_task_command_history.sql',
  'supabase/migrations/20260915052413_chatgpt_scoped_connection.sql',
  'supabase/migrations/20260916043619_assistant_language_commands.sql',
  'supabase/migrations/20260916045546_language_history_reset_triggers.sql',
];
export const SOURCE_INPUTS = Object.freeze([MIGRATION, ENROLLMENT_MIGRATION, ...DEPENDENCIES,
  'scripts/e2e-stack.mjs', 'scripts/legacy-evidence-ci-diagnostics.mjs', 'scripts/legacy-evidence-installation-fixture.mjs', 'scripts/qa-legacy-evidence-postgres.mjs', 'scripts/qa-legacy-evidence-http.mjs',
  'scripts/legacy-evidence-auth-owner-fixture.mjs', 'tests/legacy-evidence-auth-owner-fixture.test.ts',
  'app/data/languageLegacyEvidenceRelease.ts', 'app/data/languageLegacyEvidenceRepository.ts',
  'app/data/languageResetFence.ts', 'app/data/languageStorageBoundary.ts', 'app/lib/resetAppRecords.ts',
  'lib/language-legacy-evidence/local-store.ts', 'lib/language-legacy-evidence/store-admission-types.ts',
  'lib/language-legacy-evidence/receipt-proof.ts', 'tests/helpers/legacyEvidenceRepositoryHarness.ts',
  'app/data/authenticatedStorageOwner.ts', 'app/data/storageTransaction.ts', 'app/data/cloudSync.ts',
  'app/data/cloudSyncConflicts.ts', 'app/data/languageCloudSync.ts', 'app/data/languageSyncCoordinator.ts',
  'app/data/languageLocalParticipants.ts', 'app/data/appRecordReset.ts', 'app/data/growthRoutines.ts',
  'app/budget/lib/pending-save.ts', 'lib/conversation-session/contracts.ts',
  'lib/language-legacy-evidence/canonical-hash.ts', 'lib/language-legacy-evidence/validation.ts',
  'lib/language-legacy-evidence/server-types.ts', 'lib/language-legacy-evidence/persistence-types.ts',
  'lib/language-legacy-evidence/types.ts', 'lib/language-legacy-evidence/capture.ts',
  'lib/language-legacy-evidence/outbox.ts', 'lib/language-legacy-evidence/projection.ts',
  'lib/language-legacy-evidence/study-policy.ts', 'lib/language-legacy-evidence/catalogue.ts',
  'lib/language-legacy-evidence/identity-manifest.ts', 'lib/language-legacy-evidence/idb-test-adapter.ts',
  'tests/helpers/languageFixture.ts', 'tests/helpers/storageProtocol.ts', 'tests/e2e/schema.sql',
  'tests/legacy-evidence-installation-fixture.test.ts', 'tests/legacy-evidence-ci-harness.test.ts', 'tests/legacy-evidence-ci-diagnostics.test.ts', 'tests/legacy-evidence-ci-wiring.test.ts',
  'package.json', 'package-lock.json',
].sort());
const API = 'http://127.0.0.1:54321';
const verifiedStacks = new WeakSet();
const assertVerifiedStack = stack => { if (!stack || !verifiedStacks.has(stack)) refuse('unverified disposable stack capability'); };
const sha = value => createHash('sha256').update(value).digest('hex');
const refuse = message => { throw Object.assign(new Error(`legacy-evidence-harness-refused: ${message}`), { code: 'legacy_harness_refused', refusal: Object.hasOwn(REFUSALS, message) ? REFUSALS[message] : undefined }); };
const scalar = (text, expression) => { const matches = [...text.matchAll(expression)]; if (matches.length !== 1) refuse('ambiguous generated config'); return matches[0][1]; };

/** Pure preflight; safe refusal tests must not spawn Docker or contact HTTP. */
export function validateEnvironment(env, config, status, root = ROOT) {
  if (env.GITHUB_ACTIONS !== 'true' || !env.RUNNER_TEMP?.trim()) refuse('disposable GitHub Actions runner required');
  if (env.GITHUB_WORKSPACE && resolve(env.GITHUB_WORKSPACE) !== resolve(root)) refuse('wrong checkout');
  if (!env.GITHUB_RUN_ID || !/^\d+$/.test(env.GITHUB_RUN_ID) || !env.GITHUB_JOB) refuse('missing Actions run identity');
  for (const key of ['DATABASE_URL', 'SUPABASE_DB_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_KEY', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_REF', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) {
    if (env[key]) refuse('external database or credential override');
  }
  for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) if (env[key] && env[key] !== API) refuse('external API override');
  const projectId = scalar(config, /^project_id\s*=\s*"([A-Za-z0-9_-]{1,80})"\s*$/gm);
  const section = name => { const match = config.match(new RegExp(`^\\[${name}\\]\\s*\\n([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm')); if (!match) refuse('missing generated config section'); return match[1]; };
  if (scalar(section('api'), /^port\s*=\s*(\d+)\s*$/gm) !== '54321' || scalar(section('db'), /^port\s*=\s*(\d+)\s*$/gm) !== '54322') refuse('unexpected disposable ports');
  const major = scalar(section('db'), /^major_version\s*=\s*(\d+)\s*$/gm);
  if (status.API_URL !== API || typeof status.ANON_KEY !== 'string' || !status.ANON_KEY || typeof status.SERVICE_ROLE_KEY !== 'string' || !status.SERVICE_ROLE_KEY) refuse('missing local stack status');
  for (const key of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY']) if (env[key] && env[key] !== status.ANON_KEY) refuse('external public credential override');
  if (status.DB_URL) {
    let url; try { url = new URL(status.DB_URL); } catch { refuse('invalid generated database URL'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port !== '54322' || url.pathname !== '/postgres' || url.username !== 'postgres' || url.search || url.hash) refuse('non-disposable database URL');
  }
  return Object.freeze({ projectId, major, apiUrl: API });
}

export function selectDatabaseContainer(inspections, config) {
  if (!Array.isArray(inspections)) refuse('invalid Docker inspection');
  const expected = `/supabase_db_${config.projectId}`;
  const candidates = inspections.filter(row => row?.Name === expected || (row?.Config?.Labels?.['com.supabase.cli.project'] === config.projectId && /(?:^|\/)supabase_db_/.test(row?.Name ?? '')));
  if (candidates.length !== 1) refuse('missing or ambiguous disposable database container');
  const row = candidates[0];
  if (!/^[0-9a-f]{64}$/.test(row.Id) || row.Name !== expected || row.State?.Running !== true || row.Config?.Labels?.['com.supabase.cli.project'] !== config.projectId ||
      !new RegExp(`^(?:public\\.ecr\\.aws/supabase/|supabase/)postgres:${config.major}\\.[A-Za-z0-9._-]+$`).test(row.Config?.Image ?? '') ||
      !/^sha256:[0-9a-f]{64}$/.test(row.Image ?? '')) refuse('database image or project metadata mismatch');
  const ports = row.NetworkSettings?.Ports?.['5432/tcp'];
  if (!Array.isArray(ports) || !ports.length || ports.some(port => port.HostPort !== '54322' || !['127.0.0.1', '::1', '0.0.0.0', '::'].includes(port.HostIp))) refuse('database port metadata mismatch');
  return Object.freeze({ id: row.Id, imageDigest: row.Image, projectId: config.projectId });
}

/** Only generated ignored runner files are accepted; no URL/key CLI arguments. */
export function verifyDisposableStack(diagnostics = createLegacyEvidenceDiagnostics()) {
  const root = ROOT, env = process.env;
  if (env.GITHUB_ACTIONS !== 'true' || !env.RUNNER_TEMP?.trim()) refuse('disposable GitHub Actions runner required');
  diagnostics.start('preflight', 'generated_files');
  const configPath = resolve(root, '.e2e/stack/supabase/config.toml'), statusPath = resolve(root, '.e2e/stack-status.json');
  if (!existsSync(configPath) || !existsSync(statusPath) || !statSync(configPath).isFile() || !statSync(statusPath).isFile()) refuse('generated stack files absent');
  if (realpathSync(configPath) !== configPath || realpathSync(statusPath) !== statusPath || (statSync(statusPath).mode & 0o077) !== 0) refuse('unsafe generated stack file');
  diagnostics.start('preflight', 'status_and_config');
  const status = JSON.parse(readFileSync(statusPath, 'utf8'));
  const config = validateEnvironment(env, readFileSync(configPath, 'utf8'), status, root);
  const docker = args => execFileSync('docker', ['--context', 'default', ...args], { encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  diagnostics.start('preflight', 'docker_context');
  const endpoints = JSON.parse(docker(['context', 'inspect', 'default']));
  if (endpoints.length !== 1 || endpoints[0]?.Endpoints?.docker?.Host !== 'unix:///var/run/docker.sock') refuse('nonlocal Docker context');
  diagnostics.start('preflight', 'container_discovery');
  const ids = docker(['ps', '--no-trunc', '--filter', `label=com.supabase.cli.project=${config.projectId}`, '--format', '{{.ID}}']).trim().split('\n').filter(Boolean);
  if (!ids.length || ids.some(id => !/^[0-9a-f]{64}$/.test(id))) refuse('invalid container discovery');
  diagnostics.start('preflight', 'container_identity');
  const container = selectDatabaseContainer(JSON.parse(docker(['inspect', ...ids])), config);
  const stack = Object.freeze({ ...config, container, status: Object.freeze(status) });
  verifiedStacks.add(stack); return stack;
}

/** The sole privileged fixture process must exit before the launcher is ready.
 * No credentials, role overrides, retries, fallback, raw output or error causes. */
export function provisionDisposableAuthUsage(stack, diagnostics = createLegacyEvidenceDiagnostics()) {
  assertVerifiedStack(stack);
  diagnostics.start('postgres', 'auth_owner_fixture');
  const invocation = authOwnerInvocation(stack.container.id);
  try {
    const output = execFileSync('docker', invocation.args, invocation.options);
    if (output.trim() !== AUTH_OWNER_READY) throw new Error('unexpected owner fixture result');
  } catch {
    const error = Object.assign(new Error('disposable auth owner fixture failed'), { code: 'legacy_auth_owner_fixture_failed' });
    diagnostics.failed(error); throw error;
  }
  diagnostics.passed();
}

export function loopbackFetch(fetchImpl, onRequest = () => {}) {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== API || url.username || url.password || !/^\/(?:auth\/v1|rest\/v1)(?:\/|$)/.test(url.pathname)) refuse('nonlocal or provider request');
    onRequest(url, init);
    return fetchImpl(input, { ...init, redirect: 'error', signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(15_000)]) });
  };
}
export async function createSyntheticAccounts(stack, count = 1, fetchImpl = fetch) {
  assertVerifiedStack(stack);
  if (!Number.isSafeInteger(count) || count < 1 || count > 16) refuse('synthetic account bound exceeded');
  const { createClient } = await import('@supabase/supabase-js');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: loopbackFetch(fetchImpl) } };
  const admin = createClient(API, stack.status.SERVICE_ROLE_KEY, options), accounts = [];
  const cleanup = async () => {
    const failed = [];
    for (const account of [...accounts].reverse()) {
      if (account.deleted) continue;
      await account.client.auth.signOut({ scope: 'global' }).catch(() => {});
      const { error } = await admin.auth.admin.deleteUser(account.id);
      if (error) failed.push(account.id); else account.deleted = true;
    }
    if (failed.length) throw Object.assign(new Error('synthetic account cleanup failed'), { code: 'legacy_cleanup_failed' });
  };
  try {
    for (let i = 0; i < count; i++) {
      const email = `legacy-evidence-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url');
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error('synthetic account creation failed');
      const client = createClient(API, stack.status.ANON_KEY, options), account = { id: created.data.user.id, client, deleted: false };
      accounts.push(account);
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error || signed.data.user?.id !== account.id || !signed.data.session) throw new Error('synthetic sign-in failed');
      // Only the synthetic session ID is used for the actual connector FK fixture.
      const claims = JSON.parse(Buffer.from(signed.data.session.access_token.split('.')[1], 'base64url').toString('utf8'));
      if (!/^[0-9a-f-]{36}$/.test(claims.session_id ?? '')) throw new Error('missing synthetic session');
      account.sessionId = claims.session_id;
      const inserted = await client.from('language_user_state').insert({ user_id: account.id, state: { japaneseAppSettings: '{"qa":"preserve"}' } });
      if (inserted.error) throw new Error('synthetic language setup failed');
    }
    return { accounts, cleanup, async deleteAccount(account) { const result = await admin.auth.admin.deleteUser(account.id); if (result.error) throw new Error('synthetic account deletion failed'); account.deleted = true; } };
  } catch (error) { await cleanup(); throw error; }
}

const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => value === null ? 'null::jsonb' : `${literal(JSON.stringify(value))}::jsonb`;
const uuid = value => { assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); return `${literal(value)}::uuid`; };

/** Three OS processes, each one persistent backend; never Promise.all on one DB. */
class PsqlSession {
  constructor(container, name) {
    this.name = name; this.pending = null; this.buffer = ''; this.closed = false;
    this.child = spawn('docker', ['--context', 'default', 'exec', '-i', container.id, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8'); this.child.stdout.on('data', text => this.receive(text));
    // SQL may contain a canonical event. Do not log stderr, query text or bodies.
    this.child.stderr.on('data', () => {});
    this.child.on('error', () => this.fail(new Error('psql process unavailable')));
    this.child.on('close', code => { this.closed = true; if (this.pending) this.fail(new Error(`psql closed before barrier (${code})`)); });
  }
  fail(error) { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; } }
  receive(text) {
    this.buffer += text;
    if (this.buffer.length > 4 * 1024 * 1024) return this.fail(new Error('bounded psql output exceeded'));
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, ''); this.buffer = this.buffer.slice(end + 1);
      if (!this.pending) continue;
      if (line === this.pending.end) { const current = this.pending; this.pending = null; clearTimeout(current.timer); current.resolve(current.lines.filter(Boolean)); }
      else this.pending.lines.push(line);
    }
  }
  query(sql) {
    if (this.closed || this.pending) return Promise.reject(new Error('overlapping or closed psql command'));
    // psql's echo does not execute a buffered SQL statement. Require an authored
    // terminator before scheduling a barrier; never append or replay SQL here.
    if (typeof sql !== 'string' || !sql.trimEnd().endsWith(';')) return Promise.reject(new Error('unterminated psql command'));
    return new Promise((resolveResult, reject) => {
      const end = `qa_end_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(() => { this.fail(Object.assign(new Error('psql barrier timeout'), { code: '57014' })); this.child.stdin.end(); }, 18_000);
      this.pending = { end, timer, lines: [], resolve: resolveResult, reject };
      this.child.stdin.write(`${sql}\n\\echo ${end}\n`);
    });
  }
  async scalar(sql) { const lines = await this.query(sql); assert.equal(lines.length, 1, 'expected exactly one scalar row'); return JSON.parse(lines[0]); }
  async start(observer = false) {
    await this.query(`set application_name = ${literal(this.name)}; set statement_timeout = '12s'; set lock_timeout = '10s'; set idle_in_transaction_session_timeout = '20s';`);
    this.pid = await this.scalar('select pg_catalog.pg_backend_pid();');
    if (observer) await this.query('set default_transaction_read_only = on;');
    else await this.query(`create function pg_temp.qa_call(command text) returns jsonb language plpgsql security invoker set search_path='' as $qa$ declare result jsonb; begin execute command into result; return pg_catalog.jsonb_build_object('ok',true,'value',result); exception when others then return pg_catalog.jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'error',case when SQLERRM ~ '^legacy_[a-z_]+$' then SQLERRM else 'sql_error' end); end $qa$;`);
  }
  async begin(owner) { await this.query(`begin; set local role authenticated; set local request.jwt.claim.sub = ${literal(owner)}; set local request.jwt.claim.role = 'authenticated'; set local request.jwt.claims = ${literal(JSON.stringify({ sub: owner, role: 'authenticated' }))};`); }
  call(sql) { const result = this.scalar(`select pg_temp.qa_call(${literal(sql)});`); void result.catch(() => {}); return result; }
  commit() { return this.query('commit;'); }
  rollback() { return this.query('rollback;'); }
  async close() {
    if (this.closed) return;
    if (!this.pending) { try { await this.query('rollback;'); } catch {} }
    this.child.stdin.end('\\q\n');
    await Promise.race([new Promise(resolveDone => this.child.once('close', resolveDone)), delay(2_000)]);
    if (!this.closed) this.child.kill('SIGTERM');
  }
}
function success(result) { assert.equal(result.ok, true, 'SQL RPC failed'); return result.value; }
function denied(result, codes) {
  try {
    assert.equal(result.ok, false, 'expected SQL denial');
    assert.ok(codes.includes(result.error) || codes.includes(result.sqlstate), 'wrong typed SQL denial');
  } catch (error) { rememberSqlDenial(error, result); throw error; }
  return result.error === 'sql_error' ? result.sqlstate : result.error;
}

async function waitForBlock(observer, waiter, blocker, proof, requireAdvisory = false) {
  const started = performance.now();
  while (performance.now() - started < 8_000) {
    const state = await observer.scalar(`select pg_catalog.jsonb_build_object('blocked',${blocker.pid}=any(pg_catalog.pg_blocking_pids(${waiter.pid})),'waiterPid',${waiter.pid},'blockerPid',${blocker.pid},'waitType',a.wait_event_type,'waitEvent',a.wait_event,'advisoryHeld',exists(select 1 from pg_catalog.pg_locks where pid=${waiter.pid} and locktype='advisory' and granted)) from pg_catalog.pg_stat_activity a where a.pid=${waiter.pid} and a.application_name=${literal(waiter.name)};`);
    if (state.blocked && state.waitType === 'Lock' && (!requireAdvisory || state.advisoryHeld)) { proof.push({ ...state, elapsedMs: Math.ceil(performance.now() - started) }); return; }
    // Poll pacing is never proof; only observed pg_blocking_pids is a barrier.
    await delay(20);
  }
  throw new Error('required backend blocking relationship not observed');
}

export async function runPostgresHarness(stack, diagnostics = createLegacyEvidenceDiagnostics()) {
  assertVerifiedStack(stack);
  diagnostics.start('postgres', 'imports');
  const manifest = await import('../lib/language-legacy-evidence/identity-manifest.ts');
  const { LEGACY_EVIDENCE_CATALOGUE } = await import('../lib/language-legacy-evidence/catalogue.ts');
  const { makeSourceSlotKey, canonicalEvidence } = await import('../lib/language-legacy-evidence/validation.ts');
  const protocol = manifest.LEGACY_EVIDENCE_SERVER_PROTOCOL, digest = manifest.LEGACY_EVIDENCE_MANIFEST_DIGEST;
  diagnostics.start('postgres', 'source_digests');
  const report = { schemaVersion: 2, kind: 'real-disposable-postgres', status: 'running', cases: CASES.map(name => ({ name, status: 'unrun' })), waits: [], backends: [],
    digests: { sourceScope: 'Selected authored SQL, codec, authority, reset and fixture sources; not a full checkout or installed dependency tree digest.', manifest: digest, sources: Object.fromEntries(SOURCE_INPUTS.map(path => [path, sha(readFileSync(resolve(ROOT, path)))])) }, limitations: ['Synthetic JWT claims in psql; Auth checked separately over HTTP.', 'Fake IndexedDB is not browser persistence.', 'Inactive source harness; no hosted or capture acceptance.'] };
  const a = new PsqlSession(stack.container, 'legacy_evidence_qa_a'), b = new PsqlSession(stack.container, 'legacy_evidence_qa_b'), observer = new PsqlSession(stack.container, 'legacy_evidence_qa_observer');
  let fixtures;
  const getContext = (owner, marker = { present: false, value: null }) => `select public.get_language_legacy_evidence_context(${uuid(owner)},${json(marker)},'Asia/Seoul',${literal(protocol)},${literal(digest)})`;
  const readContext = (owner, generation = null) => `select public.read_language_legacy_evidence_context(${uuid(owner)},${generation ? uuid(generation) : 'null::uuid'},${literal(digest)})`;
  const readStatus = (owner, marker = null) => `select public.read_language_legacy_evidence_status(${uuid(owner)},${json(marker)})`;
  const enroll = (owner, request, marker = { present: false, value: null }, timezone = 'Asia/Seoul') => `select public.enroll_language_legacy_evidence_v1(${uuid(owner)},${uuid(request)},${json(marker)},${literal(timezone)},${literal(protocol)},${literal(manifest.LEGACY_EVIDENCE_MANIFEST_RELEASE)},${literal(digest)})`;
  const reset = (owner, request = randomUUID()) => `select public.reset_my_app_records('language',${uuid(request)},'초기화')`;
  const append = (owner, context, batch) => `select public.append_language_legacy_evidence(${uuid(owner)},${uuid(context.generationId)},${literal(digest)},${uuid(batch.id)},${literal(batch.slot)},${json(batch.predecessor)},array[${batch.events.map(event => literal(canonicalEvidence(event))).join(',')}]::text[])`;
  const makeBatch = (owner, context, session = randomUUID()) => {
    const task = LEGACY_EVIDENCE_CATALOGUE.find(value => value.legacyQuestionId === 'f01:2'); assert.ok(task);
    const binding = task.bindings.find(value => value.source === 'course_lesson' && value.taskFormat === 'meaning_choice'); assert.ok(binding);
    const event = { schemaVersion: 1, eventId: randomUUID(), generationId: context.generationId, episodeId: randomUUID(), sourceSlotKey: '', sequence: 0, source: binding.source,
      itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId, lessonId: task.lessonId, legacyQuestionId: task.legacyQuestionId, lessonSessionId: session,
      gradingVersion: binding.gradingVersion, taskFormat: binding.taskFormat, occurredAt: context.serverTime, recordTimezone: context.studyDayTimezone,
      hintUsed: false, answerPreviouslyRevealed: false, isRetry: false, responseMs: null, timingComplete: false,
      audio: { status: 'not_requested', promptMatchesTask: null }, textVisibility: { targetText: true, reading: false, meaning: false, choices: true }, kind: 'exercise_presented', correct: null };
    event.sourceSlotKey = makeSourceSlotKey(owner, event);
    return { id: randomUUID(), slot: event.sourceSlotKey, predecessor: null, events: [event] };
  };
  const transaction = async (session, owner, command) => { await session.begin(owner); try { const result = await session.call(command); await session.commit(); return result; } catch (error) { await session.rollback(); throw error; } };
  const state = async owner => observer.scalar(`select pg_catalog.jsonb_build_object('generation',(select generation_id from public.language_legacy_evidence_generations where owner_id=${uuid(owner)}),'highWater',coalesce((select last_server_sequence from public.language_legacy_evidence_generations where owner_id=${uuid(owner)}),0),'sequences',coalesce((select pg_catalog.jsonb_agg(server_sequence order by server_sequence) from public.language_legacy_evidence_events where owner_id=${uuid(owner)}),'[]'::jsonb),'settings',(select state->>'japaneseAppSettings' from public.language_user_state where user_id=${uuid(owner)}),'marker',(select pg_catalog.jsonb_build_object('present',state?'languageRecordResetV1','value',state->'languageRecordResetV1') from public.language_user_state where user_id=${uuid(owner)}));`);
  const gapFree = value => { assert.deepEqual(value.sequences, Array.from({ length: value.highWater }, (_, i) => i + 1)); };
  async function run(name, callback) {
    return diagnostics.run('scenario', 'execute', async () => {
      const row = report.cases.find(value => value.name === name); row.status = 'running'; const start = performance.now();
      try { row.assertions = await callback(); row.status = 'passed'; }
      catch (error) { row.status = 'failed'; row.failureCode = safeCode(error); throw error; }
      finally { row.durationMs = Math.ceil(performance.now() - start); await Promise.all([a.rollback().catch(() => {}), b.rollback().catch(() => {})]); }
    }, name);
  }
  try {
    diagnostics.start('postgres', 'sessions');
    await Promise.all([a.start(), b.start(), observer.start(true)]);
    report.backends = [a.pid, b.pid, observer.pid]; assert.equal(new Set(report.backends).size, 3);
    diagnostics.passed(); diagnostics.start('audit', 'schema');
    const schema = await observer.scalar(`select pg_catalog.jsonb_build_object('tables',(select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('language_legacy_evidence_manifests','language_legacy_evidence_manifest_tasks','language_legacy_evidence_generations','language_legacy_evidence_events','language_legacy_evidence_enrollments') and c.relrowsecurity),'roles',(select count(*) from pg_catalog.pg_roles where rolname in ('language_legacy_evidence_executor','language_legacy_evidence_reset_executor') and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls and not rolinherit),'memberships',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',r.rolname,'member',member.rolname,'grantor',grantor.rolname,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option,'trustedCreatorAdmin',r.rolname in ('language_legacy_evidence_executor','language_legacy_evidence_reset_executor') and m.member=current_user::regrole::oid and current_user=session_user and not member.rolsuper and member.rolcreaterole and member.rolname not in ('anon','authenticated','service_role') and m.admin_option and not m.inherit_option and not m.set_option and m.grantor=10 and grantor.rolsuper and exists(select 1 from pg_catalog.pg_namespace n where n.nspname='language_legacy_evidence_private' and n.nspowner=m.member)) order by m.oid),'[]'::jsonb) from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid=m.roleid join pg_catalog.pg_roles member on member.oid=m.member join pg_catalog.pg_roles grantor on grantor.oid=m.grantor where r.rolname in ('language_legacy_evidence_executor','language_legacy_evidence_reset_executor') or member.rolname in ('language_legacy_evidence_executor','language_legacy_evidence_reset_executor')),
      'applicationRoleAccess',exists(select 1 from (values ('anon'),('authenticated'),('service_role')) app(role) cross join pg_catalog.pg_roles r where r.rolname in ('language_legacy_evidence_executor','language_legacy_evidence_reset_executor') and (pg_catalog.pg_has_role(app.role,r.oid,'MEMBER') or pg_catalog.pg_has_role(app.role,r.oid,'SET') or pg_catalog.pg_has_role(app.role,r.oid,'USAGE'))),
      'installerSuperuser',(select rolsuper from pg_catalog.pg_roles where rolname=current_user),
      'nonSuperuserInstallerRoleAccess',exists(select 1 from pg_catalog.pg_roles r where r.rolname in ('language_legacy_evidence_executor','language_legacy_evidence_reset_executor') and not (select rolsuper from pg_catalog.pg_roles where rolname=current_user) and (pg_catalog.pg_has_role(current_user,r.oid,'SET') or pg_catalog.pg_has_role(current_user,r.oid,'USAGE'))),
      'executorSchemaCreate',(select count(*) from pg_catalog.pg_roles r where r.rolname in ('language_legacy_evidence_executor','language_legacy_evidence_reset_executor') and pg_catalog.has_schema_privilege(r.oid,'language_legacy_evidence_private','CREATE')),'triggers',(select pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid) order by t.tgname) from pg_catalog.pg_trigger t where t.tgrelid='public.language_user_state'::regclass and not t.tgisinternal),'functions',(select pg_catalog.jsonb_agg(pg_catalog.pg_get_functiondef(p.oid) order by n.nspname,p.proname,pg_catalog.oidvectortypes(p.proargtypes)) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='language_legacy_evidence_private'));`);
    assert.equal(schema.tables, 5); assert.equal(schema.roles, 2);
    // PG17 CREATEROLE creates bootstrap-superuser-granted ADMIN-only rows for
    // its trusted installer. These confer neither SET nor inherited privileges.
    // Every other direct edge and every effective application-role path is denied.
    // Historical superuser-created fixtures are labeled explicitly; a superuser
    // is not claimed to lack SET/USAGE. The real seed adapter refuses SUPERUSER.
    assert.ok(schema.memberships.every(row => row.trustedCreatorAdmin === true));
    assert.equal(schema.applicationRoleAccess, false); assert.equal(schema.nonSuperuserInstallerRoleAccess, false); assert.equal(schema.executorSchemaCreate, 0);
    report.installationRoleAudit = { memberships: schema.memberships, applicationRoleAccess: schema.applicationRoleAccess, installerSuperuser: schema.installerSuperuser, nonSuperuserInstallerRoleAccess: schema.nonSuperuserInstallerRoleAccess, executorSchemaCreate: schema.executorSchemaCreate };
    report.digests.installedMembershipAudit = sha(JSON.stringify(schema.memberships));
    for (const name of ['assistant_language_history_language_reset', 'chatgpt_reset_language', 'language_legacy_evidence_marker_reset']) assert.ok(schema.triggers.some(text => text.includes(name) && text.includes('AFTER UPDATE OF state') && !text.includes('DELETE')));
    assert.ok(schema.functions?.length); report.digests.installedFunctions = sha(JSON.stringify(schema.functions)); report.digests.installedTriggers = sha(JSON.stringify(schema.triggers));
    diagnostics.passed(); diagnostics.start('audit', 'privileges');
    const privilegeAudit = await observer.scalar(`select pg_catalog.jsonb_build_object(
      'tables',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',c.relname,'forced',c.relforcerowsecurity,'owner',r.rolname,'applicationAccess',exists(select 1 from (values ('anon'),('authenticated'),('service_role')) app(role) cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege) where pg_catalog.has_table_privilege(app.role,c.oid,p.privilege) or (case when p.privilege in ('SELECT','INSERT','UPDATE','REFERENCES') then pg_catalog.has_any_column_privilege(app.role,c.oid,p.privilege) else false end)))) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_roles r on r.oid=c.relowner where n.nspname='public' and c.relname like 'language_legacy_evidence_%' and c.relkind='r'),
      'privateSchema',(select pg_catalog.jsonb_build_object('authUsage',pg_catalog.has_schema_privilege('authenticated',oid,'USAGE'),'authCreate',pg_catalog.has_schema_privilege('authenticated',oid,'CREATE'),'anonUsage',pg_catalog.has_schema_privilege('anon',oid,'USAGE'),'anonCreate',pg_catalog.has_schema_privilege('anon',oid,'CREATE'),'serviceCreate',pg_catalog.has_schema_privilege('service_role',oid,'CREATE'),'serviceUsage',pg_catalog.has_schema_privilege('service_role',oid,'USAGE')) from pg_catalog.pg_namespace where nspname='language_legacy_evidence_private'),
      'functions',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',n.nspname||'.'||p.proname||'('||replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')','owner',r.rolname,'definer',p.prosecdef,'config',p.proconfig,'auth',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),'service',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'),'public',exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE'))) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace join pg_catalog.pg_roles r on r.oid=p.proowner where n.nspname='language_legacy_evidence_private' or (n.nspname='public' and p.proname in ('get_language_legacy_evidence_context','append_language_legacy_evidence','read_language_legacy_evidence_context','read_language_legacy_evidence_events','read_language_legacy_evidence_page','read_language_legacy_evidence_status','enroll_language_legacy_evidence_v1'))),
      'columns',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',attname,'executorUpdate',pg_catalog.has_column_privilege('language_legacy_evidence_executor','public.language_user_state',attname,'UPDATE'))) from pg_catalog.pg_attribute where attrelid='public.language_user_state'::regclass and attnum>0 and not attisdropped),
      'resetGenerationColumns',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',attname,'select',pg_catalog.has_column_privilege('language_legacy_evidence_reset_executor','public.language_legacy_evidence_generations',attname,'SELECT'),'update',pg_catalog.has_column_privilege('language_legacy_evidence_reset_executor','public.language_legacy_evidence_generations',attname,'UPDATE'))) from pg_catalog.pg_attribute where attrelid='public.language_legacy_evidence_generations'::regclass and attnum>0 and not attisdropped),
      'enrollmentColumns',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',attname,'executorSelect',pg_catalog.has_column_privilege('language_legacy_evidence_executor','public.language_legacy_evidence_enrollments',attname,'SELECT'),'executorInsert',pg_catalog.has_column_privilege('language_legacy_evidence_executor','public.language_legacy_evidence_enrollments',attname,'INSERT'),'executorUpdate',pg_catalog.has_column_privilege('language_legacy_evidence_executor','public.language_legacy_evidence_enrollments',attname,'UPDATE'),'resetSelect',pg_catalog.has_column_privilege('language_legacy_evidence_reset_executor','public.language_legacy_evidence_enrollments',attname,'SELECT'),'resetInsert',pg_catalog.has_column_privilege('language_legacy_evidence_reset_executor','public.language_legacy_evidence_enrollments',attname,'INSERT'),'resetUpdate',pg_catalog.has_column_privilege('language_legacy_evidence_reset_executor','public.language_legacy_evidence_enrollments',attname,'UPDATE')) order by attname) from pg_catalog.pg_attribute where attrelid='public.language_legacy_evidence_enrollments'::regclass and attnum>0 and not attisdropped),
      'enrollmentPolicies',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',p.polname,'command',p.polcmd,'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'roles',(select pg_catalog.jsonb_agg(r.rolname order by r.rolname) from pg_catalog.pg_roles r where r.oid=any(p.polroles))) order by p.polname) from pg_catalog.pg_policy p where p.polrelid='public.language_legacy_evidence_enrollments'::regclass),
      'witnessExecutorDelete',pg_catalog.has_table_privilege('language_legacy_evidence_executor','public.language_legacy_evidence_enrollments','DELETE'),
      'witnessResetDelete',pg_catalog.has_table_privilege('language_legacy_evidence_reset_executor','public.language_legacy_evidence_enrollments','DELETE'),
      'resetMetadataPolicy',(select count(*) from pg_catalog.pg_policy p where p.polrelid='public.language_legacy_evidence_generations'::regclass and p.polcmd='r' and pg_catalog.pg_get_expr(p.polqual,p.polrelid)='true' and p.polroles=array[(select oid from pg_catalog.pg_roles where rolname='language_legacy_evidence_reset_executor')]),
      'eventExecutorUpdate',pg_catalog.has_table_privilege('language_legacy_evidence_executor','public.language_legacy_evidence_events','UPDATE'),
      'eventExecutorDelete',pg_catalog.has_table_privilege('language_legacy_evidence_executor','public.language_legacy_evidence_events','DELETE'),
      'generationExecutorUpdate',pg_catalog.has_table_privilege('language_legacy_evidence_executor','public.language_legacy_evidence_generations','UPDATE'),
      'generationCounterUpdate',pg_catalog.has_column_privilege('language_legacy_evidence_executor','public.language_legacy_evidence_generations','last_server_sequence','UPDATE'),
      'eventResetInsert',pg_catalog.has_table_privilege('language_legacy_evidence_reset_executor','public.language_legacy_evidence_events','INSERT'),
      'eventResetUpdate',pg_catalog.has_table_privilege('language_legacy_evidence_reset_executor','public.language_legacy_evidence_events','UPDATE'));
    `);
    assert.equal(privilegeAudit.tables.length, 5);
    for (const table of privilegeAudit.tables) { assert.equal(table.forced, true); assert.equal(table.applicationAccess, false); assert.ok(!table.owner.startsWith('language_legacy_evidence_')); }
    assert.deepEqual(privilegeAudit.privateSchema, { authUsage: true, authCreate: false, anonUsage: false, anonCreate: false, serviceCreate: false, serviceUsage: false });
    const entryNames = new Set(['get_context', 'enroll_v1', 'append_events', 'read_context', 'read_events', 'read_page', 'read_status']);
    const writeEndpoints = new Set(DISPOSABLE_WRITE_FUNCTIONS);
    assert.deepEqual(privilegeAudit.functions.filter(fn => writeEndpoints.has(fn.signature)).map(fn => fn.signature).sort(), [...DISPOSABLE_WRITE_FUNCTIONS].sort());
    for (const fn of privilegeAudit.functions) {
      assert.equal(fn.public, false); assert.equal(fn.anon, false); assert.equal(fn.service, false); assert.ok(fn.config?.some(value => value === 'search_path=\"\"' || value === 'search_path='));
      if (fn.schema === 'public') { assert.equal(fn.definer, false); assert.equal(fn.auth, !writeEndpoints.has(fn.signature)); }
      else if (entryNames.has(fn.name)) { assert.equal(fn.definer, true); assert.equal(fn.auth, !writeEndpoints.has(fn.signature)); assert.equal(fn.owner, 'language_legacy_evidence_executor'); }
      else { assert.equal(fn.auth, false); if (fn.name === 'marker_reset') { assert.equal(fn.definer, true); assert.equal(fn.owner, 'language_legacy_evidence_reset_executor'); } }
    }
    assert.equal(privilegeAudit.functions.filter(fn => fn.schema === 'public').length, 7);
    assert.equal(privilegeAudit.functions.filter(fn => fn.schema === 'language_legacy_evidence_private' && entryNames.has(fn.name)).length, 7);
    for (const column of privilegeAudit.columns) assert.equal(column.executorUpdate, column.name === 'updated_at');
    for (const column of privilegeAudit.resetGenerationColumns) { assert.equal(column.select, ['owner_id','generation_id'].includes(column.name)); assert.equal(column.update, ['generation_id','reset_marker','prospective_started_at','last_server_sequence'].includes(column.name)); }
    assert.deepEqual(privilegeAudit.enrollmentColumns.map(column => column.name), ['creation_request_id', 'initial_generation_id', 'owner_id']);
    for (const column of privilegeAudit.enrollmentColumns) {
      assert.equal(column.executorSelect, true); assert.equal(column.executorInsert, true); assert.equal(column.executorUpdate, false);
      assert.equal(column.resetSelect, column.name === 'owner_id'); assert.equal(column.resetInsert, false); assert.equal(column.resetUpdate, false);
    }
    assert.deepEqual(privilegeAudit.enrollmentPolicies, [
      { name: 'legacy_evidence_enrollment_insert', command: 'a', using: null, check: '((auth.uid() IS NOT NULL) AND (auth.uid() = owner_id))', roles: ['language_legacy_evidence_executor'] },
      { name: 'legacy_evidence_enrollment_read', command: 'r', using: '((auth.uid() IS NOT NULL) AND (auth.uid() = owner_id))', check: null, roles: ['language_legacy_evidence_executor'] },
      { name: 'legacy_evidence_reset_enrollment_probe', command: 'r', using: 'true', check: null, roles: ['language_legacy_evidence_reset_executor'] },
    ]);
    assert.equal(privilegeAudit.witnessExecutorDelete, false); assert.equal(privilegeAudit.witnessResetDelete, false);
    assert.equal(privilegeAudit.resetMetadataPolicy, 1);
    for (const key of ['eventExecutorUpdate','eventExecutorDelete','generationExecutorUpdate','eventResetInsert','eventResetUpdate']) assert.equal(privilegeAudit[key], false);
    assert.equal(privilegeAudit.generationCounterUpdate, true); report.digests.installedPrivilegeAudit = sha(JSON.stringify(privilegeAudit));
    diagnostics.passed(); diagnostics.start('audit', 'dependencies');
    const installerAuthCapabilities = await observer.scalar(`select pg_catalog.jsonb_build_object(
      'installer_auth_owner_set',pg_catalog.pg_has_role(current_user,n.nspowner,'SET'),
      'installer_auth_grant_option',pg_catalog.has_schema_privilege(current_user,n.oid,'USAGE WITH GRANT OPTION'),
      'installer_auth_direct_grant_option',exists(select 1 from pg_catalog.aclexplode(n.nspacl) a
        where a.grantee=current_user::regrole::oid and a.privilege_type='USAGE' and a.is_grantable)
        and not pg_catalog.pg_has_role(current_user,n.nspowner,'USAGE')) from pg_catalog.pg_namespace n where n.nspname='auth';`);
    assert.deepEqual(Object.keys(installerAuthCapabilities).sort(), [...AUTH_INSTALLER_CAPABILITIES].sort());
    for (const name of AUTH_INSTALLER_CAPABILITIES) diagnostics.capability(name, installerAuthCapabilities[name]);
    report.installerAuthCapabilities = installerAuthCapabilities;
    // GRANT can be ineffective when a restricted installer lacks grant option.
    // Check effective runtime dependencies, separately from app-facing denial.
    // Fixed keys prevent SQL-returned identities from entering diagnostics.
    const dependencyAudit = await observer.scalar(`select pg_catalog.jsonb_build_object(
      'executor_auth_usage',pg_catalog.has_schema_privilege('language_legacy_evidence_executor','auth','USAGE'),
      'executor_public_usage',pg_catalog.has_schema_privilege('language_legacy_evidence_executor','public','USAGE'),
      'executor_private_usage',pg_catalog.has_schema_privilege('language_legacy_evidence_executor','language_legacy_evidence_private','USAGE'),
      'executor_auth_uid',pg_catalog.has_function_privilege('language_legacy_evidence_executor','auth.uid()','EXECUTE'),
      'reset_auth_usage',pg_catalog.has_schema_privilege('language_legacy_evidence_reset_executor','auth','USAGE'),
      'reset_public_usage',pg_catalog.has_schema_privilege('language_legacy_evidence_reset_executor','public','USAGE'),
      'reset_private_usage',pg_catalog.has_schema_privilege('language_legacy_evidence_reset_executor','language_legacy_evidence_private','USAGE'),
      'reset_auth_uid',pg_catalog.has_function_privilege('language_legacy_evidence_reset_executor','auth.uid()','EXECUTE'),
      'executor_canonical',pg_catalog.has_function_privilege('language_legacy_evidence_executor','language_legacy_evidence_private.canonical(jsonb)','EXECUTE'),
      'executor_instant',pg_catalog.has_function_privilege('language_legacy_evidence_executor','language_legacy_evidence_private.instant(timestamptz)','EXECUTE'),
      'executor_marker',pg_catalog.has_function_privilege('language_legacy_evidence_executor','language_legacy_evidence_private.marker(jsonb)','EXECUTE'),
      'executor_timezone_valid',pg_catalog.has_function_privilege('language_legacy_evidence_executor','language_legacy_evidence_private.timezone_valid(text)','EXECUTE'),
      'executor_assert_request',pg_catalog.has_function_privilege('language_legacy_evidence_executor','language_legacy_evidence_private.assert_request(uuid,text)','EXECUTE'),
      'executor_context_json',pg_catalog.has_function_privilege('language_legacy_evidence_executor','language_legacy_evidence_private.context_json(public.language_legacy_evidence_generations,timestamptz)','EXECUTE'),
      'executor_receipt',pg_catalog.has_function_privilege('language_legacy_evidence_executor','language_legacy_evidence_private.receipt(public.language_legacy_evidence_events)','EXECUTE'),
      'executor_validate_event',pg_catalog.has_function_privilege('language_legacy_evidence_executor','language_legacy_evidence_private.validate_event(text,uuid,public.language_legacy_evidence_generations,timestamptz,text)','EXECUTE'),
      'executor_check_read',pg_catalog.has_function_privilege('language_legacy_evidence_executor','language_legacy_evidence_private.check_read(jsonb,uuid)','EXECUTE'));`);
    assert.deepEqual(Object.keys(dependencyAudit).sort(), [...EXECUTOR_DEPENDENCIES].sort());
    for (const name of EXECUTOR_DEPENDENCIES) diagnostics.dependency(name, dependencyAudit[name]);
    for (const name of EXECUTOR_DEPENDENCIES) assert.equal(dependencyAudit[name], true);
    report.executorDependencyAudit = dependencyAudit;
    diagnostics.passed(); diagnostics.start('postgres', 'synthetic_accounts');
    fixtures = await createSyntheticAccounts(stack, 16); const accounts = fixtures.accounts; let next = 0;
    const fresh = async (initialize = true) => { const owner = accounts[next++].id, request = randomUUID(); const context = initialize ? success(await transaction(a, owner, enroll(owner, request))).currentContext : null; return { owner, context, request }; };
    // Actual restricted-role smoke checks, including Supabase's real default ACLs.
    diagnostics.passed(); diagnostics.start('audit', 'restricted_roles');
    const securityOwner = accounts[0].id;
    await a.begin(securityOwner);
    for (const table of ['language_legacy_evidence_manifests','language_legacy_evidence_manifest_tasks','language_legacy_evidence_generations','language_legacy_evidence_events','language_legacy_evidence_enrollments']) {
      for (const statement of [`select null::jsonb from public.${table}`, `insert into public.${table} default values returning null::jsonb`, `delete from public.${table} returning null::jsonb`, `update public.${table} set ${table.endsWith('_events') ? 'payload_hash=payload_hash' : table.endsWith('_generations') ? 'last_server_sequence=last_server_sequence' : table.endsWith('_enrollments') ? 'creation_request_id=creation_request_id' : 'manifest_digest=manifest_digest'} returning null::jsonb`, `truncate public.${table}`]) denied(await a.call(statement), ['42501']);
    }
    for (const command of [getContext(securityOwner), enroll(securityOwner, randomUUID()),
      `select public.append_language_legacy_evidence(${uuid(securityOwner)},${uuid(randomUUID())},${literal(digest)},${uuid(randomUUID())},'unused',null::jsonb,array[]::text[])`]) {
      denied(await a.call(command), ['42501']);
      const privateCommand = command.replace('public.get_language_legacy_evidence_context', 'language_legacy_evidence_private.get_context')
        .replace('public.enroll_language_legacy_evidence_v1', 'language_legacy_evidence_private.enroll_v1')
        .replace('public.append_language_legacy_evidence', 'language_legacy_evidence_private.append_events');
      denied(await a.call(privateCommand), ['42501']);
    }
    denied(await a.call(`select language_legacy_evidence_private.canonical('{}'::jsonb)`), ['42501']);
    denied(await a.call(`select language_legacy_evidence_private.marker_reset()`), ['42501']);
    denied(await a.call(`select language_legacy_evidence_private.read_context(${uuid(accounts[1].id)},null::uuid,${literal(digest)})`), ['legacy_auth_mismatch']);
    await a.commit(); report.restrictedRoleDenials = 'passed';
    report.defaultWriteDenial = 'passed';
    diagnostics.passed(); diagnostics.start('audit', 'disposable_activation');
    // This privilege change is impossible without the verified disposable capability,
    // and happens only after both catalog and actual restricted-role denial checks.
    assertVerifiedStack(stack);
    await a.query(`grant execute on function ${DISPOSABLE_WRITE_FUNCTIONS.join(',')} to authenticated;`);
    const activated = await observer.scalar(`select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signature',f.signature,'auth',pg_catalog.has_function_privilege('authenticated',f.signature,'EXECUTE'),'anon',pg_catalog.has_function_privilege('anon',f.signature,'EXECUTE'),'service',pg_catalog.has_function_privilege('service_role',f.signature,'EXECUTE')) order by f.signature) from (values ${DISPOSABLE_WRITE_FUNCTIONS.map(value => `(${literal(value)})`).join(',')}) f(signature);`);
    assert.equal(activated.length, 6); for (const fn of activated) { assert.equal(fn.auth, true); assert.equal(fn.anon, false); assert.equal(fn.service, false); }
    report.disposableWriteActivation = { functions: [...DISPOSABLE_WRITE_FUNCTIONS], release: DISPOSABLE_EVIDENCE_RELEASE };
    diagnostics.passed();
    await run(CASES[0], async () => {
      const { owner, context } = await fresh(), batch = makeBatch(owner, context);
      await a.begin(owner); await a.query(`select 1 from public.language_user_state where user_id=${uuid(owner)} for update;`);
      await b.begin(owner); const pending = b.call(append(owner, context, batch)); await waitForBlock(observer, b, a, report.waits, true);
      await a.query(`update public.language_user_state set state=state||pg_catalog.jsonb_build_object('languageRecordResetV1',${literal(`${context.serverTime}|${randomUUID()}`)}) where user_id=${uuid(owner)};`); await a.commit();
      const code = denied(await pending, ['legacy_stale_generation', 'legacy_marker_conflict']); await b.commit(); const now = await state(owner); assert.notEqual(now.generation, context.generationId); assert.equal(now.highWater, 0); gapFree(now);
      return { outcome: code, oldGenerationRows: 0, triggerFinishedWithoutAdvisory: true };
    });
    await run(CASES[1], async () => {
      const { owner, context } = await fresh(), batch = makeBatch(owner, context);
      await a.begin(owner); const receipt = success(await a.call(append(owner, context, batch))).records[0]; assert.equal(receipt.serverSequence, 1);
      await b.begin(owner); const pending = b.call(reset(owner)); await waitForBlock(observer, b, a, report.waits); await a.commit();
      // B already owns reset after unblock; A's receipt was returned by a real append then committed.
      success(await pending); const committedBeforeReset = await state(owner); assert.equal(committedBeforeReset.generation, context.generationId); assert.equal(committedBeforeReset.highWater, 1); gapFree(committedBeforeReset); await b.commit(); const now = await state(owner); assert.notEqual(now.generation, context.generationId); assert.equal(now.highWater, 0); gapFree(now); return { committedReceiptSequence: 1, oldGenerationRows: 0 };
    });
    await run(CASES[2], async () => {
      const { owner, context } = await fresh(), batch = makeBatch(owner, context);
      await a.begin(owner); success(await a.call(reset(owner))); await b.begin(owner); const pending = b.call(append(owner, context, batch));
      await waitForBlock(observer, b, a, report.waits); await a.commit(); const code = denied(await pending, ['legacy_stale_generation', 'legacy_marker_conflict']); await b.commit();
      const now = await state(owner); assert.equal(now.highWater, 0); gapFree(now); return { outcome: code };
    });
    await run(CASES[3], async () => {
      const { owner, context } = await fresh(), batch = makeBatch(owner, context);
      await a.begin(owner); const first = success(await a.call(append(owner, context, batch)));
      await b.begin(owner); const replay = b.call(append(owner, context, batch)); await waitForBlock(observer, b, a, report.waits); await a.commit();
      const exact = success(await replay); await b.commit(); assert.deepEqual(exact.records, first.records); assert.equal((await state(owner)).highWater, 1);
      const divergent = structuredClone(batch); divergent.events[0].hintUsed = true;
      await a.begin(owner); success(await a.call(append(owner, context, batch))); await b.begin(owner); const conflict = b.call(append(owner, context, divergent));
      await waitForBlock(observer, b, a, report.waits); await a.commit(); const code = denied(await conflict, ['legacy_event_id_conflict']); await b.commit();
      const otherEpisode = structuredClone(batch); otherEpisode.id = randomUUID(); otherEpisode.events[0].eventId = randomUUID(); otherEpisode.events[0].episodeId = randomUUID();
      denied(await transaction(a, owner, append(owner, context, otherEpisode)), ['legacy_source_slot_conflict', 'legacy_predecessor_conflict']);
      const slotA = makeBatch(owner, context), slotB = makeBatch(owner, context);
      await a.begin(owner); success(await a.call(append(owner, context, slotA))); await b.begin(owner); const second = b.call(append(owner, context, slotB));
      await waitForBlock(observer, b, a, report.waits); await a.commit(); success(await second); await b.commit(); const now = await state(owner); assert.equal(now.highWater, 3); gapFree(now);
      return { replayStable: true, divergentOutcome: code, differentSlotPrefix: [1, 2, 3] };
    });
    await run(CASES[4], async () => {
      const first = await fresh(false); await a.begin(first.owner); const initialized = success(await a.call(enroll(first.owner, first.request))).currentContext;
      await b.begin(first.owner); const pendingReset = b.call(reset(first.owner)); await waitForBlock(observer, b, a, report.waits); await a.commit(); success(await pendingReset); await b.commit();
      const rotated = await state(first.owner); assert.notEqual(rotated.generation, initialized.generationId); assert.equal(rotated.highWater, 0);
      const second = await fresh(false); await a.begin(second.owner); const resetValue = success(await a.call(reset(second.owner)));
      await b.begin(second.owner); const pendingInit = b.call(enroll(second.owner, second.request)); await waitForBlock(observer, b, a, report.waits); await a.commit();
      denied(await pendingInit, ['legacy_marker_conflict']); await b.rollback(); assert.equal((await state(second.owner)).generation, null);
      // Fresh read of the committed marker, followed by a NEW authenticated transaction.
      const observed = await secondOwnerMarker(second.owner); assert.equal(observed.value, resetValue.marker);
      const reacquired = success(await transaction(b, second.owner, enroll(second.owner, randomUUID(), observed))).currentContext; assert.deepEqual(reacquired.resetMarker, observed); assert.equal(reacquired.highWater, 0);
      return { initializationFirstRotated: true, resetFirstRejectedStale: true, freshTransactionInitialized: true };
    });
    async function secondOwnerMarker(owner) { const account = accounts.find(value => value.id === owner); const verified = await account.client.auth.getUser(); assert.equal(verified.data.user?.id, owner); assert.equal(verified.error, null); const result = await account.client.from('language_user_state').select('state').eq('user_id', owner).single(); assert.equal(result.error, null); return { present: Object.hasOwn(result.data.state, 'languageRecordResetV1'), value: result.data.state.languageRecordResetV1 ?? null }; }
    await run(CASES[5], async () => {
      const { owner, context } = await fresh(), batch = makeBatch(owner, context); success(await transaction(a, owner, append(owner, context, batch)));
      await a.begin(owner); await a.query(`delete from public.language_user_state where user_id=${uuid(owner)}; insert into public.language_user_state(user_id,state) values(${uuid(owner)},'{}'::jsonb);`);
      await b.begin(owner); const pending = b.call(append(owner, context, batch)); await waitForBlock(observer, b, a, report.waits); await a.commit();
      const code = denied(await pending, ['legacy_stale_generation', 'legacy_state_not_ready']); await b.commit(); assert.equal((await state(owner)).generation, null);
      const missing = success(await transaction(a, owner, readStatus(owner))); assert.equal(missing.status, 'enrolled_generation_missing');
      assert.equal(missing.enrollment.initialGenerationId, context.generationId);
      denied(await transaction(a, owner, getContext(owner)), ['legacy_enrolled_generation_missing']);
      denied(await transaction(a, owner, enroll(owner, randomUUID())), ['legacy_enrolled_generation_missing']);
      assert.equal((await state(owner)).generation, null); return { outcome: code, witnessSurvivesStateDeletion: true, oldInitializerCannotRepair: true, oldRowsRevived: false };
    });
    await run(CASES[6], async () => {
      const { owner, context } = await fresh(), account = accounts.find(value => value.id === owner), batch = makeBatch(owner, context), grant = randomUUID();
      // Runner-owned synthetic fixture only; existing private connector tables/functions are untouched.
      await a.query(`insert into yeoni_connector.grants(id,user_id,session_id,client_id,resource,scopes,areas,code_hash,challenge) values(${uuid(grant)},${uuid(owner)},${uuid(account.sessionId)},'legacy-evidence-ci','http://127.0.0.1:54321',array['read'],array['language'],${literal(sha(randomUUID()))},'synthetic'); insert into yeoni_connector.snapshots(user_id,grant_id,area,summary) values(${uuid(owner)},${uuid(grant)},'language','{}'); insert into public.chatgpt_advice(user_id,id,payload_hash,title,body,area,summary,snapshot_at) values(${uuid(owner)},${uuid(randomUUID())},'synthetic','synthetic','synthetic','language','{}',pg_catalog.clock_timestamp());`);
      const commandId = randomUUID();
      const command = `select public.apply_assistant_language_command(${uuid(commandId)},'words',(pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date,'{}'::jsonb,'{"language":null,"assistant":null}'::jsonb,pg_catalog.clock_timestamp()+interval '5 minutes')`;
      await a.begin(owner); const commandReceipt = success(await a.call(command)); await b.begin(owner); const pendingAppend = b.call(append(owner, context, batch)); await waitForBlock(observer, b, a, report.waits); await a.commit(); success(await pendingAppend); await b.commit(); assert.equal(commandReceipt.id, commandId);
      await a.begin(owner); await a.query(`update public.language_user_state set state=state||'{"qaSameMarker":true}'::jsonb where user_id=${uuid(owner)};`); await a.commit(); assert.equal((await state(owner)).generation, context.generationId);
      const before = await observer.scalar(`select pg_catalog.jsonb_build_object('grantActive',revoked_at is null,'advice',(select count(*) from public.chatgpt_advice where user_id=${uuid(owner)}),'snapshots',(select count(*) from yeoni_connector.snapshots where user_id=${uuid(owner)}),'commands',(select count(*) from public.assistant_language_command_history where user_id=${uuid(owner)})) from yeoni_connector.grants where id=${uuid(grant)};`); assert.deepEqual(before, { grantActive: true, advice: 1, snapshots: 1, commands: 1 });
      await a.begin(owner); success(await a.call(append(owner, context, batch))); await b.begin(owner); const pendingReset = b.call(reset(owner)); await waitForBlock(observer, b, a, report.waits); await a.commit(); success(await pendingReset); await b.commit();
      const after = await observer.scalar(`select pg_catalog.jsonb_build_object('grantRevoked',revoked_at is not null,'advice',(select count(*) from public.chatgpt_advice where user_id=${uuid(owner)}),'snapshots',(select count(*) from yeoni_connector.snapshots where user_id=${uuid(owner)}),'commands',(select count(*) from public.assistant_language_command_history where user_id=${uuid(owner)})) from yeoni_connector.grants where id=${uuid(grant)};`); assert.deepEqual(after, { grantRevoked: true, advice: 0, snapshots: 0, commands: 0 });
      const now = await state(owner); assert.equal(now.settings, '{"qa":"preserve"}'); assert.equal(now.highWater, 0); return { actualAssistantCommandReceipt: true, sameMarkerPreserved: true, connectorRevokedAndCleared: true, settingsPreserved: true };
    });
    await run(CASES[7], async () => {
      const { owner, context } = await fresh(), aborted = makeBatch(owner, context), committed = makeBatch(owner, context);
      await a.begin(owner); assert.equal(success(await a.call(append(owner, context, aborted))).records[0].serverSequence, 1);
      await b.begin(owner); const pending = b.call(append(owner, context, committed)); await waitForBlock(observer, b, a, report.waits); await a.rollback();
      const receipt = success(await pending).records[0]; await b.commit(); assert.equal(receipt.serverSequence, 1); const now = await state(owner); assert.equal(now.highWater, 1); gapFree(now);
      return { rolledBackSequenceReused: true, committedPrefix: [1] };
    });
    await run(CASES[8], async () => {
      const { owner, context } = await fresh(), batch = makeBatch(owner, context); success(await transaction(a, owner, append(owner, context, batch)));
      await fixtures.deleteAccount(accounts.find(value => value.id === owner)); const now = await state(owner); assert.equal(now.generation, null); assert.deepEqual(now.sequences, []);
      const orphanCount = await observer.scalar(`select count(*) from public.language_user_state where user_id=${uuid(owner)};`); assert.equal(orphanCount, 0);
      assert.equal(await observer.scalar(`select count(*) from public.language_legacy_evidence_enrollments where owner_id=${uuid(owner)};`), 0);
      return { authAdminDelete: true, stateGenerationEventAndWitnessCascade: true, directEventDmlGranted: false };
    });
    await run(CASES[9], async () => {
      const { owner, request } = await fresh(false);
      const before = success(await transaction(a, owner, readStatus(owner))); assert.equal(before.status, 'unenrolled'); assert.equal(before.enrollment, null);
      const first = success(await transaction(a, owner, enroll(owner, request)));
      const exact = success(await transaction(a, owner, enroll(owner, request)));
      assert.equal(exact.status, 'enrolled'); assert.equal(exact.creationRequestId, request); assert.equal(exact.initialGenerationId, first.currentContext.generationId);
      assert.equal(exact.currentContext.generationId, first.currentContext.generationId);
      denied(await transaction(a, owner, enroll(owner, request, before.resetMarker, 'UTC')), ['legacy_enrollment_conflict']);
      const witnessed = success(await transaction(a, owner, readStatus(owner, before.resetMarker))); assert.equal(witnessed.status, 'enrolled');
      assert.deepEqual(witnessed.enrollment, { creationRequestId: request, initialGenerationId: first.currentContext.generationId });
      const resetResult = success(await transaction(a, owner, reset(owner)));
      denied(await transaction(a, owner, enroll(owner, request, { present: true, value: resetResult.marker })), ['legacy_enrollment_stale']);
      await a.begin(owner); await a.query(`update public.language_user_state set state=state-'languageRecordResetV1' where user_id=${uuid(owner)};`); await a.commit();
      denied(await transaction(a, owner, enroll(owner, request)), ['legacy_enrollment_stale']);
      assert.deepEqual(success(await transaction(a, owner, readStatus(owner))).enrollment, witnessed.enrollment);
      return { exactReplay: true, alteredRequestDenied: true, rotatedInitialGenerationStale: true, markerRollbackCannotRevive: true };
    });
    await run(CASES[10], async () => {
      const { owner, request } = await fresh(false), competing = randomUUID();
      await a.begin(owner); const first = success(await a.call(enroll(owner, request)));
      await b.begin(owner); const pending = b.call(enroll(owner, competing)); await waitForBlock(observer, b, a, report.waits); await a.commit();
      const second = success(await pending); await b.commit(); assert.equal(second.status, 'existing_enrollment');
      assert.equal(second.creationRequestId, request); assert.equal(second.initialGenerationId, first.currentContext.generationId);
      assert.equal(second.currentContext.generationId, first.currentContext.generationId);
      return { firstNonceImmutable: true, competingNonceNotFirstAdmission: true, singleGeneration: true };
    });
    report.status = 'passed'; return report;
  } catch (error) { diagnostics.failed(error); report.status = 'failed'; report.failureCode = safeCode(error); error.sanitizedReport = report; throw error; }
  finally {
    try {
      await diagnostics.cleanup([
        { checkpoint: 'postgres_sessions', run: async () => { const results = await Promise.allSettled([a.close(), b.close()]); const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason; } },
        { checkpoint: 'postgres_accounts', run: async () => { if (fixtures) await fixtures.cleanup(); } },
        { checkpoint: 'postgres_observer', run: () => observer.close() },
      ]);
      report.cleanup = 'passed';
    } catch (error) {
      report.cleanup = 'failed'; report.status = 'failed'; report.failureCode = 'legacy_cleanup_failed'; error.sanitizedReport = report; throw error;
    }
  }
}

export async function main() {
  const diagnostics = createLegacyEvidenceDiagnostics(); let report, stack;
  try {
    diagnostics.start('preflight', 'arguments_and_stack');
    if (process.argv.length > 2) refuse('no runtime arguments accepted');
    stack = verifyDisposableStack(diagnostics); diagnostics.passed();
    report = await diagnostics.run('postgres', 'execute', () => runPostgresHarness(stack, diagnostics));
    await diagnostics.run('http', 'execute', async () => {
      const { runHttpHarness } = await import('./qa-legacy-evidence-http.mjs');
      report.http = await runHttpHarness(diagnostics); assert.equal(report.http.status, 'passed');
    });
  } catch (error) { diagnostics.failed(error); if (!stack) throw error; report = error.sanitizedReport ?? report ?? { schemaVersion: 2, status: 'failed', cases: CASES.map(name => ({ name, status: 'unrun' })) }; report.status = 'failed'; report.failureCode = safeCode(error); if (error.httpReport) report.http = error.httpReport; throw error; }
  finally {
    if (report) await diagnostics.run('report', 'write', () => {
      mkdirSync(resolve(ROOT, '.e2e/evidence'), { recursive: true });
      writeFileSync(resolve(ROOT, '.e2e/evidence/legacy-evidence-postgres.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    });
  }
  diagnostics.start('gate', 'complete'); diagnostics.passed();
  console.log('Disposable PostgreSQL race and local HTTP repository checks passed; browser durability remains unrun.');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(() => { console.error('Legacy evidence CI gate failed. Inspect the sanitized phase diagnostics and case summary; no request bodies or credentials are logged.'); process.exitCode = 1; });
