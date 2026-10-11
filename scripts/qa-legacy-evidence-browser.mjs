/** Fixed disposable B2 runner. Importing this module does not start a process. */
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, statfsSync, symlinkSync, chmodSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { types } from 'node:util';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = 'scripts/legacy-evidence-b2-build-inputs.json';
export const RELEASE_PATH = 'app/data/languageLegacyEvidenceRelease.ts';
export const INACTIVE_LITERAL = "resetProtocol: 'inactive', enrollmentEnabled: false, captureEnabled: false,";
export const ENABLED_LITERAL = "resetProtocol: 'protocol-required', enrollmentEnabled: true, captureEnabled: true,";
export const ENABLED_RELEASE_SHA256 = '2f0a5666f94fd514f76b829eec13cb90b3c98d09c44bd8a011da61fa642510da';
export const RELEASE_SHA256 = 'd5dba02c06c054be302a39fdf5d23494a2bac81e0e4b256bde034c786cf86b86';
export const CONTROL_PATHS = Object.freeze([
  'scripts/qa-legacy-evidence-browser.mjs', MANIFEST_PATH, 'playwright.legacy-evidence.config.ts',
  'tests/e2e/legacy-evidence-review.spec.ts', 'tests/legacy-evidence-browser-harness.test.ts',
  '.github/workflows/legacy-evidence-browser.yml', 'playwright.config.ts',
  'scripts/qa-legacy-evidence-postgres.mjs', 'tests/legacy-evidence-ci-harness.test.ts',
  'tests/legacy-evidence-ci-wiring.test.ts', 'docs/language-legacy-evidence-gate-b2.md',
].sort());
export const LIMITS = Object.freeze({ jobMs: 75 * 60_000, reserveMs: 15 * 60_000, cleanupMs: 5 * 60_000,
  freeBytes: 6 * 1024 ** 3, ownedBytes: 4 * 1024 ** 3, captureBytes: 1024 ** 2, processCount: 512 });
export const BUILD_EXCLUSIONS = Object.freeze(['cache/', 'trace', 'trace-build', 'diagnostics/', 'server/route-cache/']);
const OWNER_PATH = '.e2e/legacy-evidence-b2-owner.json';
const REPORT_PATH = '.e2e/evidence/legacy-evidence-b2-results.json';
const SQL_REPORT = '.e2e/evidence/legacy-evidence-postgres.json';
const SUMMARY = '.e2e/evidence/results.json';
const API = 'http://127.0.0.1:54321';
const CONFIG = 'playwright.legacy-evidence.config.ts';
const ROOT_FILES = new Set(['AGENTS.md', 'package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json',
  'postcss.config.js', 'tailwind.config.ts', 'eslint.config.mjs', '.eslintrc.json', 'playwright.config.ts', CONFIG]);
const ROOT_DIRS = new Set(['app', 'components', 'content', 'data', 'hooks', 'lib', 'public', 'scripts', 'services', 'supabase', 'tests', 'utils']);
export const MEDIA_INPUTS = Object.freeze(['docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3', 'docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json',
  'docs/yeoni-voice-comparison/media/gemini-zephyr-ja-user.wav', 'docs/yeoni-phase12/media/yeoni-zephyr-ja-approved.mp3',
  'docs/yeoni-phase12/alignment/timeline.json', 'docs/yeoni-phase12/gemini-candidate/alignment/timeline.json']);
const BLOCKED_COMPONENTS = new Set(['.git', '.github', '.e2e', '.next', '.vercel', 'node_modules', 'test-results', 'playwright-report', 'coverage', 'out', 'build', 'dist', '.cache', '.temp', 'evidence']);
const LOCAL_LOGS = new Set(['reader-lifecycle-20261010.2026-10-09T16-36-51-623Z.json', 'reader-lifecycle-20261010.2026-10-09T16-39-18-406Z.build.json', 'reader-lifecycle-20261010.2026-10-09T16-40-21-025Z.build.json', 'reader-lifecycle-20261010.setup-failure.txt'].map(p => `docs/yeoni-general-validation/${p}`));
export const AUTH_TITLES = Object.freeze([
  'login, logout and same-account relogin preserve all 17 original keys without any shared-state write',
  'legacy logged-out empty cache with a remaining baseline cannot delete the server',
  'old in-flight GET cannot repopulate records after logout',
  'authenticated RLS rejects another account reading or overwriting the owner',
]);
export const SCENARIO_TITLES = Object.freeze({ inactive: [
  'I1 inactive navigation never opens evidence @b2-inactive', 'I2 inactive bait and small-screen ordinary practice @b2-inactive',
], enabled: [
  'E1 authenticated admission precedes presentation @b2-enabled', 'E2 typed answer IME retry and prospective privacy @b2-enabled',
  'E3 meaning hints and shared exposure fence typing @b2-enabled', 'E4 overlapping Starts and native read interruption @b2-enabled',
  'E5 confirmed local handoff survives reload @b2-enabled', 'E6 lost append response uses authenticated readback @b2-enabled',
  'E7 offline outbox preserves predecessor order @b2-enabled', 'E8 pinned source and held retirement closure @b2-enabled',
  'E9 owner switch fences in-flight capture @b2-enabled', 'E10 required reset retires scoped evidence @b2-enabled',
  'E11 native v3 migration and old-client refusal @b2-enabled', 'E12 interrupted native transactions and explicit close @b2-enabled',
] });
const runtimeStop = new AbortController();
const CODES = new Set(['runner_required', 'deadline_invalid', 'budget_exhausted', 'environment_override', 'source_identity',
  'inventory_invalid', 'source_path', 'source_changed', 'release_changed', 'dependency_invalid', 'resource_limit',
  'ownership_invalid', 'process_identity', 'process_limit', 'cleanup_failed', 'port_occupied', 'discovery_invalid',
  'report_invalid', 'sql_failed', 'build_failed', 'browser_failed', 'interrupted', 'stack_cleanup_failed', 'harness_failed']);
const refuse = code => { throw Object.assign(new Error(`B2 refused: ${CODES.has(code) ? code : 'harness_failed'}`), { code: CODES.has(code) ? code : 'harness_failed' }); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const inside = (root, path) => path === root || path.startsWith(root + sep);
const safeHex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600 }); renameSync(tmp, path); };
export function safeFailure(error) {
  if (!error || typeof error !== 'object' || types.isProxy(error)) return 'harness_failed';
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor && typeof descriptor.value === 'string' && CODES.has(descriptor.value) ? descriptor.value : 'harness_failed';
}
const DIAGNOSTIC_STAGES = new Set(['harness', 'run-bootstrap', 'serve-bootstrap', 'cleanup-bootstrap', 'finalize-bootstrap',
  'runner-preflight', 'checkout-preflight', 'owned-directory', 'owned-state', 'stack-before', 'sql-gate', 'sql-result', 'stack-after',
  'source-copy', 'dependencies-main', 'dependencies-browser-qa', 'copy-result',
  ...['inactive', 'enabled'].flatMap(phase => ['build', 'build-reap', 'build-identity', 'discovery', 'browser', 'browser-result', 'phase-reap', 'source-check'].map(stage => `${phase}-${stage}`)),
  'run-cleanup-processes', 'run-cleanup-source', 'run-cleanup-build', 'cleanup-processes', 'cleanup-source', 'cleanup-build', 'cleanup-copy', 'finalize-stack', 'finalize-result']);
export function diagnosticLine(stage, status, error) {
  // Project before serialization. No raw error, path, environment or child
  // output can cross this fixed console boundary, including through getters.
  const safeStage = DIAGNOSTIC_STAGES.has(stage) ? stage : 'harness';
  const safeStatus = ['passed', 'failed', 'unverified'].includes(status) ? status : 'failed';
  return `[legacy-evidence-b2] ${JSON.stringify({ stage: safeStage, status: safeStatus, ...(safeStatus === 'failed' ? { code: safeFailure(error) } : {}) })}`;
}
function emitDiagnostic(stage, status, error) {
  try { console.error(diagnosticLine(stage, status, error)); } catch { /* Diagnostics must never change refusal or cleanup behavior. */ }
}
// Detail diagnostics are independent of acceptance. They serialize only new
// objects assembled from fixed vocabularies and own data descriptors.
const DETAIL_PREFIX = '[legacy-evidence-b2-detail] ';
const CHILD_LABELS = new Set(['sql', 'inactive-build', 'enabled-build', 'discovery', 'browser', 'server']);
const CHILD_OPERATIONS = new Set(['spawn', 'spawn-event', 'register', 'process-sample', 'disk-sample', 'completion', 'shutdown']);
const SYSTEM_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EIO', 'ENOSPC', 'EMFILE', 'ENFILE', 'ELOOP', 'ENOTDIR']);
const FAILURE_KINDS = new Set(['webkit-internal', 'crash', 'closed-or-disconnected', 'timeout', 'aborted', 'connection-reset', 'other']);
const FAILURE_FILES = new Set(['auth.spec.ts', 'legacy-evidence-review.spec.ts', 'fixture.ts', 'fixture-account-auth.ts',
  'route-drain.ts', 'route-continue-diagnostics.ts', 'navigation-diagnostics.ts'].map(file => `tests/e2e/${file}`));
const STEP_CATEGORIES = new Set(['expect', 'fixture', 'hook', 'pw:api', 'test.step', 'test.attach', 'other']);
function detailObject(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return false;
  const own = Object.getOwnPropertyDescriptors(value);
  return !Object.hasOwn(own, 'toJSON') && Object.values(own).every(item => Object.hasOwn(item, 'value'));
}
function detailField(value, key) { return detailObject(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined; }
function detailArray(value, maximum) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value)) return null;
  // Bound before inspecting indexes/descriptors; sparse or accessor entries fail closed.
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || !detailObject(value)) return null;
  const rows = [];
  for (let index = 0; index < length; index++) { const item = Object.getOwnPropertyDescriptor(value, String(index)); if (!item || !Object.hasOwn(item, 'value')) return null; rows.push(item.value); }
  return rows;
}
function detailSink(line) { console.error(line); }
function emitDetailRecords(records, sink) {
  // records are created only by the closed projectors below, never child output.
  for (const record of records) { try { sink(DETAIL_PREFIX + JSON.stringify(record)); } catch { /* Observation cannot affect a gate or cleanup. */ } }
}
export function childOperationObserver(child, sink = detailSink) {
  let observed = false;
  return (operation, error) => {
    if (observed) return;
    observed = true;
    try {
      if (!CHILD_LABELS.has(child) || !CHILD_OPERATIONS.has(operation)) return;
      // Error.stack may be a native lazy accessor. Inspect only code's own
      // descriptor, never the Error object or its other properties.
      const code = error && typeof error === 'object' && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
      emitDetailRecords([{ kind: 'child-operation', child, operation, code: safeFailure(error), systemCode: SYSTEM_CODES.has(code) ? code : 'other' }], sink);
    } catch { /* Retain first-cause ordering even if projection or the sink fails. */ }
  };
}
export function reportStateObserver(phase, sink = detailSink) {
  let observed = false;
  return state => {
    if (observed) return;
    observed = true;
    try { if (['inactive', 'enabled'].includes(phase) && ['validated', 'missing', 'stale', 'invalid'].includes(state)) emitDetailRecords([{ kind: 'phase-report', phase, state }], sink); } catch { /* Diagnostic only. */ }
  };
}
function detailLocation(value) {
  const file = detailField(value, 'file'), line = detailField(value, 'line'), column = detailField(value, 'column');
  if (!FAILURE_FILES.has(file) || ![line, column].every(number => Number.isSafeInteger(number) && number > 0 && number <= 1_000_000)) return null;
  return { file, line, column };
}
function detailFailure(value) {
  const errors = detailArray(detailField(value, 'errors'), 8), steps = detailArray(detailField(value, 'steps'), 8);
  if (!errors || !steps) return undefined;
  const error = row => { const kind = detailField(row, 'kind'); return { kind: FAILURE_KINDS.has(kind) ? kind : 'other', location: detailLocation(detailField(row, 'location')) }; };
  return { errors: errors.map(error), steps: steps.map(row => { const category = detailField(row, 'category'); return { category: STEP_CATEGORIES.has(category) ? category : 'other', ...error(row) }; }) };
}
export function emitExecutionDiagnostics(raw, execution, phase, sink = detailSink) {
  try {
    if (!['inactive', 'enabled'].includes(phase)) return;
    const expected = expectedCases(phase), cases = detailArray(detailField(execution, 'cases'), expected.length);
    const results = detailArray(detailField(raw, 'results'), expected.length);
    const status = detailField(execution, 'status'), discovered = detailField(execution, 'discovered'), executed = detailField(execution, 'executed');
    if (!cases || cases.length !== expected.length || !['passed', 'failed'].includes(status) || discovered !== expected.length || !Number.isSafeInteger(executed) || executed < 0 || executed > expected.length) return;
    const records = [];
    for (let index = 0; index < expected.length; index++) {
      const canonical = expected[index], row = cases[index], caseStatus = detailField(row, 'status');
      if (['project', 'file', 'title'].some(key => detailField(row, key) !== canonical[key]) || !['passed', 'failed', 'timedOut', 'interrupted', 'unrun'].includes(caseStatus)) return;
      const caseId = canonical.project === 'auth-preservation' ? `A${index + 1}` : `${phase === 'inactive' ? 'I' : 'E'}${SCENARIO_TITLES[phase].indexOf(canonical.title) + 1}`;
      const record = { kind: 'case', phase, project: canonical.project, case: caseId, status: caseStatus };
      if (!['passed', 'unrun'].includes(caseStatus) && results) {
        const title = `${canonical.project} / ${canonical.file} / ${canonical.title}`;
        const matched = results.filter(result => [title, ` / ${title}`].includes(detailField(result, 'title')));
        if (matched.length === 1) { const failure = detailFailure(detailField(matched[0], 'failure')); if (failure) record.failure = failure; }
      }
      records.push(record);
    }
    emitDetailRecords([{ kind: 'execution-summary', phase, executionStatus: status, discovered, executed,
      passed: records.filter(row => row.status === 'passed').length,
      failed: records.filter(row => ['failed', 'timedOut', 'interrupted'].includes(row.status)).length,
      unrun: records.filter(row => row.status === 'unrun').length }, ...records], sink);
  } catch { /* Optional metadata must never add a failure or bypass a gate. */ }
}

export function validateRelativePath(path) {
  if (typeof path !== 'string' || !path || path.length > 512 || isAbsolute(path) || path.includes('\\') || /[\x00-\x1f\x7f]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) refuse('source_path');
  return path;
}
export function allowedSourcePath(path) {
  validateRelativePath(path);
  const parts = path.split('/');
  if (path === MANIFEST_PATH || parts.some(p => BLOCKED_COMPONENTS.has(p) || p.startsWith('.env')) || /\.(?:tsbuildinfo|pem|key|p12|pfx|log)$/i.test(path)) return false;
  return ROOT_FILES.has(path) || ROOT_DIRS.has(parts[0]) || MEDIA_INPUTS.includes(path);
}
export function allowedGeneratedPath(path) {
  if (path === '.e2e/libsoup-source/') return true;
  validateRelativePath(path);
  return ['node_modules/', 'scripts/browser-qa/node_modules/', '.e2e/', '.next/', 'test-results/', 'playwright-report/', 'coverage/', 'supabase/.temp/'].some(prefix => path.startsWith(prefix)) || path === 'next-env.d.ts' || /^[^/]+\.tsbuildinfo$/.test(path);
}
export function validateGeneratedPath(root, path) {
  if (!allowedGeneratedPath(path)) refuse('source_identity');
  if (path === '.e2e/libsoup-source/') {
    if (realpathSync(root) !== root) refuse('source_path');
    let current = root;
    for (const component of ['.e2e', 'libsoup-source']) {
      current = join(current, component);
      const info = lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(current) !== current) refuse('source_path');
    }
  }
  return true;
}
export function validateRootEnvironmentFiles(root, trackedPaths) {
  const hasReviewedTemplate = trackedPaths.includes('.env.example');
  if (readdirSync(root).some(name => name.startsWith('.env') && !(name === '.env.example' && hasReviewedTemplate))) refuse('environment_override');
}
export function inventoryDigest(entries) { return sha256(entries.map(row => `${row.sha256}  ${row.path}\n`).join('')); }
export function validateManifest(manifest, selectedPaths) {
  if (!manifest || Object.keys(manifest).sort().join() !== 'baseline,byteCount,controlPaths,digest,fileCount,files,schemaVersion,selfExcluded' || manifest.selfExcluded !== MANIFEST_PATH || JSON.stringify(manifest.controlPaths) !== JSON.stringify(CONTROL_PATHS) || !manifest.baseline || manifest.baseline.commit !== 'bd124e77db6744cb8a518fee4cbd6c721e8b8bc8' || manifest.baseline.tree !== 'ef6aacb5c11c888e454817433f26a9f0f3d5b44f' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 10_000) refuse('inventory_invalid');
  const seen = new Set(); let bytes = 0, previous = '';
  for (const row of manifest.files) {
    if (!row || !allowedSourcePath(row.path) || !safeHex(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || ![0o100644, 0o100755].includes(row.mode) || Object.keys(row).sort().join() !== 'bytes,mode,path,sha256') refuse('inventory_invalid');
    if (seen.has(row.path.toLowerCase()) || (previous && previous >= row.path)) refuse('inventory_invalid');
    seen.add(row.path.toLowerCase()); previous = row.path; bytes += row.bytes;
  }
  if (manifest.fileCount !== manifest.files.length || manifest.byteCount !== bytes || bytes > LIMITS.ownedBytes || manifest.digest !== inventoryDigest(manifest.files)) refuse('inventory_invalid');
  if (selectedPaths && JSON.stringify([...selectedPaths].sort()) !== JSON.stringify(manifest.files.map(row => row.path))) refuse('inventory_invalid');
  if (manifest.files.find(row => row.path === RELEASE_PATH)?.sha256 !== RELEASE_SHA256) refuse('release_changed');
  return manifest;
}
export function regularPath(root, path) {
  validateRelativePath(path); let current = root;
  if (realpathSync(root) !== root) refuse('source_path');
  for (const part of path.split('/')) { current = join(current, part); const stat = lstatSync(current); if (stat.isSymbolicLink()) refuse('source_path'); }
  if (!lstatSync(current).isFile()) refuse('source_path');
  return current;
}
export function enableRelease(bytes) {
  const source = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes;
  if (sha256(source) !== RELEASE_SHA256 || source.split(INACTIVE_LITERAL).length !== 2) refuse('release_changed');
  const enabled = source.replace(INACTIVE_LITERAL, ENABLED_LITERAL);
  if (enabled.replace(ENABLED_LITERAL, INACTIVE_LITERAL) !== source || sha256(enabled) !== ENABLED_RELEASE_SHA256) refuse('release_changed');
  return Buffer.from(enabled);
}
export function validateBudget(env, now = Date.now(), allowExpired = false) {
  const start = Number(env.B2_JOB_STARTED_MS), deadline = Number(env.B2_JOB_DEADLINE_MS), stop = Number(env.B2_STOP_AT_MS);
  if (![start, deadline, stop, now].every(Number.isSafeInteger) || start <= 0 || start > now || deadline - start !== LIMITS.jobMs || stop !== deadline - LIMITS.reserveMs || (!allowExpired && now > deadline)) refuse('deadline_invalid');
  return { start, deadline, stop };
}
export function validateRunner(env, root, now = Date.now(), allowExpired = false) {
  if (env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true' || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '') || !/^[A-Za-z0-9_-]+$/.test(env.GITHUB_JOB ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '') || !/^[a-f0-9]{40}$/.test(env.QA_HEAD_SHA ?? '') || !env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP) || resolve(env.GITHUB_WORKSPACE ?? '') !== root || process.platform !== 'linux') refuse('runner_required');
  validateBudget(env, now, allowExpired);
  for (const [key, value] of Object.entries(env)) if (value && (/^(?:NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|BASH_ENV|ENV|PW_TEST_REUSE_CONTEXT|PW_TEST_CONNECT_WS_ENDPOINT|PLAYWRIGHT_TEST_BASE_URL|PLAYWRIGHT_JSON_OUTPUT_FILE|PLAYWRIGHT_JSON_OUTPUT_DIR|PLAYWRIGHT_JSON_OUTPUT_NAME|VERCEL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|DATABASE_URL|SUPABASE_DB_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGSERVICE|PGSERVICEFILE|PGPASSFILE|PGOPTIONS|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|http_proxy|https_proxy|all_proxy)$/.test(key) || /^(?:OPENAI|ANTHROPIC|GEMINI|GOOGLE_AI|ELEVENLABS|AZURE_OPENAI).*KEY/.test(key))) refuse('environment_override');
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_URL !== API) refuse('environment_override');
  if (env.PLAYWRIGHT_BROWSERS_PATH && (!env.B2_PROCESS_TAG || !/^[a-f0-9]{64}$/.test(env.B2_PROCESS_TAG))) refuse('environment_override');
  if (env.QA_SOUP_VARIANT !== 'fixed' || !env.QA_SOUP_LIBRARY?.startsWith(`${env.RUNNER_TEMP}/webkit-soup/`)) refuse('environment_override');
  return validateBudget(env, now, allowExpired);
}
export function closedApplicationEnvironment(env, owner, status, observer = false) {
  if (!safeHex(owner.nonce)) refuse('ownership_invalid');
  if (status.API_URL !== API || typeof status.ANON_KEY !== 'string' || !status.ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== status.ANON_KEY || env.NEXT_PUBLIC_SUPABASE_URL !== API) refuse('environment_override');
  // Never spread runner env. The Node executable is absolute; only fixed system
  // bins and that same Node directory are needed by Next's child processes.
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(owner.directory, 'home'), TMPDIR: join(owner.directory, 'tmp'),
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', CI: 'true', NEXT_TELEMETRY_DISABLED: '1', YEONI_E2E: '1',
    // Ownership only: inherited by the pinned detached TypeScript CLI. This
    // nonce cannot choose a phase, change release bytes or confer app authority.
    B2_PROCESS_TAG: owner.nonce,
    NEXT_PUBLIC_SUPABASE_URL: API, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, ...(observer ? { QA_HTTP_OBSERVER: '1' } : {}) };
}
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] });
export function verifyCheckout(root = ROOT, env = process.env) {
  if (realpathSync(root) !== root || git(root, ['rev-parse', '--show-toplevel']).trim() !== root || git(root, ['rev-parse', 'HEAD']).trim() !== env.QA_HEAD_SHA || git(root, ['status', '--porcelain', '--untracked-files=no'])) refuse('source_identity');
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']).trim();
  const tracked = git(root, ['ls-tree', '-rz', '--full-tree', 'HEAD']).split('\0').filter(Boolean).map(line => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line); if (!match) refuse('source_identity');
    const path = validateRelativePath(match[3]), file = regularPath(root, path), bytes = readFileSync(file);
    // Git object equality catches every tracked file, including uncopied controls.
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (blob !== match[2] || ((lstatSync(file).mode & 0o111) !== 0) !== (match[1] === '100755')) refuse('source_changed');
    return { path, blob, mode: parseInt(match[1], 8), bytes: bytes.length, sha256: sha256(bytes) };
  });
  for (const path of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) if (!LOCAL_LOGS.has(path)) refuse('source_identity');
  for (const path of git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    validateGeneratedPath(root, path);
  }
  // Next loads dotenv files from its cwd independently of the passed env.
  validateRootEnvironmentFiles(root, tracked.map(row => row.path));
  const selected = tracked.filter(row => allowedSourcePath(row.path));
  const manifest = validateManifest(json(regularPath(root, MANIFEST_PATH)), selected.map(row => row.path));
  if (JSON.stringify(selected.map(({ path, mode, bytes, sha256 }) => ({ path, mode, bytes, sha256 })).sort((a,b) => a.path < b.path ? -1 : 1)) !== JSON.stringify(manifest.files.map(({ path, mode, bytes, sha256 }) => ({ path, mode, bytes, sha256 })))) refuse('source_changed');
  const controls = CONTROL_PATHS.map(path => { const row = tracked.find(row => row.path === path); if (!row) refuse('source_identity'); return { path, blob: row.blob, sha256: row.sha256 }; });
  const protectedFiles = tracked.filter(row => !CONTROL_PATHS.includes(row.path));
  return { commit: env.QA_HEAD_SHA, tree, protectedDigest: inventoryDigest(protectedFiles.sort((a,b) => a.path < b.path ? -1 : 1)), protectedFileCount: protectedFiles.length, fullTrackedDigest: inventoryDigest(tracked.sort((a,b) => a.path < b.path ? -1 : 1)), manifest, controls };
}
export function copySources(root, destination, manifest, checkpoint = () => {}) {
  validateManifest(manifest);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const row of manifest.files) {
    checkpoint();
    const input = regularPath(root, row.path), bytes = readFileSync(input);
    if (sha256(bytes) !== row.sha256 || bytes.length !== row.bytes) refuse('source_changed');
    const output = join(destination, row.path); mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
    copyFileSync(input, output, constants.COPYFILE_FICLONE); chmodSync(output, row.mode & 0o777);
    const a = statSync(input), b = statSync(output); if (a.dev === b.dev && a.ino === b.ino) refuse('dependency_invalid');
  }
  writeFileSync(join(destination, RELEASE_PATH), enableRelease(readFileSync(join(destination, RELEASE_PATH))));
  return verifyCopiedSources(destination, manifest);
}
export function verifyCopiedSources(destination, manifest) {
  const rows = manifest.files.map(row => { const bytes = readFileSync(regularPath(destination, row.path));
    if ((lstatSync(join(destination, row.path)).mode & 0o777) !== (row.mode & 0o777) || (row.path === RELEASE_PATH ? sha256(bytes) !== ENABLED_RELEASE_SHA256 : sha256(bytes) !== row.sha256)) refuse('source_changed');
    return { ...row, bytes: bytes.length, sha256: sha256(bytes) }; });
  return { digest: inventoryDigest(rows), release: rows.find(row => row.path === RELEASE_PATH).sha256, changedFiles: 1 };
}
const dependencyExcluded = name => name.startsWith('.env') || ['.cache', '.git', '.npm', '.yarn', 'coverage', 'test-results', '.temp'].includes(name) || /\.(?:pem|key|p12|pfx|log|tsbuildinfo)$/i.test(name);
export const DEPENDENCY_FIXTURE_EXCLUSIONS = Object.freeze([
  { packageRoot: 'resolve', version: '2.0.0-next.6' },
  { packageRoot: 'postcss-import/node_modules/resolve', version: '1.22.12' },
  { packageRoot: 'tailwindcss/node_modules/resolve', version: '1.22.12' },
].flatMap(row => [
  'test/resolver/symlinked/_/node_modules',
  'test/shadowed_core/node_modules',
].map(suffix => Object.freeze({ ...row, path: `${row.packageRoot}/${suffix}` }))));
export function dependencyFixtureExclusion(path) {
  return DEPENDENCY_FIXTURE_EXCLUSIONS.find(row => path === row.path || path.startsWith(`${row.path}/`));
}
export function copyDependencyTree(source, destination, lock, { checkpoint = () => {}, maxBytes = LIMITS.ownedBytes } = {}) {
  if (realpathSync(source) !== source || !lock?.packages) refuse('dependency_invalid');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > LIMITS.ownedBytes) refuse('resource_limit');
  let copiedBytes = 0;
  const entries = [], versions = [], excludedFixtures = [], pendingLinks = []; mkdirSync(destination, { recursive: true, mode: 0o700 });
  const walk = relativePath => {
    if (relativePath === '' || relativePath.endsWith('/node_modules')) {
      const prefix = relativePath ? `node_modules/${relativePath}` : 'node_modules';
      for (const name of readdirSync(join(source, relativePath))) {
        if (dependencyExcluded(name) || ['.bin', '.package-lock.json'].includes(name)) continue;
        const candidates = name.startsWith('@') ? readdirSync(join(source, relativePath, name)).map(child => `${name}/${child}`) : [name];
        for (const candidate of candidates) if (!lock.packages[`${prefix}/${candidate}`]) refuse('dependency_invalid');
      }
    }
    for (const name of readdirSync(join(source, relativePath)).sort()) {
      if (dependencyExcluded(name)) continue;
      checkpoint();
      const path = relativePath ? `${relativePath}/${name}` : name; validateRelativePath(path);
      const input = join(source, path), output = join(destination, path), s = lstatSync(input);
      const exclusion = DEPENDENCY_FIXTURE_EXCLUSIONS.find(row => row.path === path);
      if (exclusion) {
        if (s.isSymbolicLink() || !s.isDirectory() || lock.packages[`node_modules/${exclusion.packageRoot}`]?.version !== exclusion.version) refuse('dependency_invalid');
        const packageJson = json(regularPath(source, `${exclusion.packageRoot}/package.json`));
        if (packageJson.name !== 'resolve' || packageJson.version !== exclusion.version) refuse('dependency_invalid');
        excludedFixtures.push({ path, version: exclusion.version }); continue;
      }
      if (s.isSymbolicLink()) {
        const target = realpathSync(input); if (!inside(source, target)) refuse('dependency_invalid');
        const targetRelative = relative(source, target); if (targetRelative.split(sep).some(dependencyExcluded) || dependencyFixtureExclusion(targetRelative)) refuse('dependency_invalid');
        const relocated = relative(dirname(output), join(destination, targetRelative));
        if (!inside(destination, resolve(dirname(output), relocated))) refuse('dependency_invalid');
        pendingLinks.push({ path, relocated, targetRelative }); entries.push({ path, link: relocated });
      } else if (s.isDirectory()) { mkdirSync(output, { mode: 0o700 }); walk(path); }
      else if (s.isFile()) {
        copiedBytes += s.size; if (copiedBytes > maxBytes) refuse('resource_limit');
        copyFileSync(input, output, constants.COPYFILE_FICLONE); chmodSync(output, s.mode & 0o777);
        const copied = statSync(output); if ((copied.dev === s.dev && copied.ino === s.ino) || copied.size !== s.size || sha256(readFileSync(output)) !== sha256(readFileSync(input))) refuse('dependency_invalid');
        entries.push({ path, sha256: sha256(readFileSync(input)), bytes: s.size, mode: s.mode & 0o777 });
        if (name === 'package.json') {
          const packagePath = `node_modules/${dirname(path)}`.replace(/\/\.$/, '');
          if (Object.hasOwn(lock.packages, packagePath)) { const packageJson = json(input); if (packageJson.version !== lock.packages[packagePath].version) refuse('dependency_invalid'); versions.push({ path: packagePath, version: packageJson.version }); }
        }
      } else refuse('dependency_invalid');
    }
  };
  // Only installed package roots represented by the approved lock may enter.
  for (const name of readdirSync(source)) {
    if (dependencyExcluded(name) || ['.bin', '.package-lock.json'].includes(name)) continue;
    if (name.startsWith('@')) { for (const child of readdirSync(join(source, name))) if (!lock.packages[`node_modules/${name}/${child}`]) refuse('dependency_invalid'); }
    else if (!lock.packages[`node_modules/${name}`]) refuse('dependency_invalid');
  }
  walk('');
  // Publish links only after all regular targets exist, so an interrupted copy
  // remains inspectable by the unchanged strict owned-directory traversal.
  for (const { path, relocated, targetRelative } of pendingLinks) {
    checkpoint();
    const target = join(destination, targetRelative);
    if (!existsSync(target) || !inside(destination, realpathSync(target))) refuse('dependency_invalid');
    symlinkSync(relocated, join(destination, path));
  }
  for (const entry of entries) if (entry.link && (!existsSync(join(destination, entry.path)) || !inside(destination, realpathSync(join(destination, entry.path))))) refuse('dependency_invalid');
  return { files: entries.length, bytes: entries.reduce((n,e) => n + (e.bytes ?? 0), 0), digest: sha256(JSON.stringify(entries)), installedVersions: versions, excludedFixtures };
}
function validateRuntimeBuildCache(root, fresh) {
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || realpathSync(root) !== root) refuse('source_changed');
  if (fresh && readdirSync(root).length) refuse('source_changed');
  let bytes = 0;
  const walk = parts => { for (const name of readdirSync(join(root, ...parts))) {
    const next = [...parts, name], full = join(root, ...next), info = lstatSync(full);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || realpathSync(full) !== full) refuse('source_changed');
    if (!['APP_PAGE', 'PAGES', 'APP_ROUTE'].includes(next[0]) ||
      (next.length > 1 && !/^[a-f0-9]{64}$/.test(next[1])) ||
      (next.length > 2 && next[2] !== '$') ||
      (next.length <= 3 && !info.isDirectory())) refuse('source_changed');
    const route = next.slice(3);
    if (route.join('/').length > 512 || route.some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f\x7f]/.test(part))) refuse('source_changed');
    const segment = route.findIndex(part => part.endsWith('.segments'));
    if (segment !== -1) {
      if (next[0] !== 'APP_PAGE' || route[segment] === '.segments' || route.slice(segment + 1).some(part => part.endsWith('.segments')) ||
        (info.isFile() && (segment === route.length - 1 || !name.endsWith('.segment.rsc') || name === '.segment.rsc'))) refuse('source_changed');
    } else if (info.isFile()) {
      const suffixes = next[0] === 'APP_PAGE' ? ['.html', '.meta', '.rsc'] : next[0] === 'PAGES' ? ['.html', '.meta', '.json'] : ['.body', '.meta'];
      if (!suffixes.some(suffix => name.endsWith(suffix) && name.length > suffix.length) || name.endsWith('.segment.rsc')) refuse('source_changed');
    }
    if (info.isDirectory()) walk(next);
    else { bytes += info.size; if (bytes > LIMITS.ownedBytes) refuse('resource_limit'); }
  } }; walk([]);
}
export function buildIdentity(app, cacheState = 'fresh') {
  if (!['fresh', 'runtime'].includes(cacheState)) refuse('source_changed');
  const root = join(app, '.next'), entries = [];
  if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) refuse('source_changed');
  const walk = path => { for (const name of readdirSync(join(root, path)).sort()) {
    const file = path ? `${path}/${name}` : name;
    // Next 16.3.8 promotes immutable prerender seeds here on the readiness GET.
    // A fresh no-adapter build must not contain cache payloads. Later reads may
    // ignore only structurally validated runtime responses, never build seeds.
    if (file === 'server/route-cache') { validateRuntimeBuildCache(join(root, file), cacheState === 'fresh'); continue; }
    if (BUILD_EXCLUSIONS.some(exclude => exclude.endsWith('/') ? file.startsWith(exclude) || file === exclude.slice(0,-1) : file === exclude)) continue;
    const full = join(root, file), info = lstatSync(full); if (info.isSymbolicLink()) refuse('source_changed');
    if (info.isDirectory()) walk(file); else if (info.isFile()) entries.push({ path: file, sha256: sha256(readFileSync(full)), bytes: info.size }); else refuse('source_changed');
  } }; walk('');
  const buildId = readFileSync(join(root, 'BUILD_ID'), 'utf8').trim(); if (!/^[A-Za-z0-9_-]{1,128}$/.test(buildId)) refuse('build_failed');
  return { buildId, digest: inventoryDigest(entries), fileCount: entries.length, bytes: entries.reduce((n,e) => n+e.bytes,0), exclusions: BUILD_EXCLUSIONS };
}
export function ownedUsage(directory, enforceLimit = true) {
  let bytes = 0; const walk = path => { for (const entry of readdirSync(path)) { const full = join(path, entry), info = lstatSync(full); if (info.isSymbolicLink()) { if (!inside(directory, realpathSync(full))) refuse('ownership_invalid'); } else if (info.isDirectory()) walk(full); else if (info.isFile()) bytes += info.size; else refuse('ownership_invalid'); if (enforceLimit && bytes > LIMITS.ownedBytes) refuse('resource_limit'); } }; walk(directory); return bytes;
}
export function createOwner(root, env) {
  const runnerTemp = realpathSync(env.RUNNER_TEMP);
  if (runnerTemp !== env.RUNNER_TEMP || inside(root, runnerTemp) || inside(runnerTemp, root) || existsSync(join(root, OWNER_PATH))) refuse('ownership_invalid');
  const disk = statfsSync(runnerTemp); if (disk.bavail * disk.bsize < LIMITS.freeBytes) refuse('resource_limit');
  const directory = mkdtempSync(join(runnerTemp, 'yeoni-b2-')); chmodSync(directory, 0o700);
  const info = statSync(directory), owner = { schemaVersion: 1, run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, job: env.GITHUB_JOB,
    commit: env.QA_HEAD_SHA, directory, dev: info.dev, ino: info.ino, nonce: randomBytes(32).toString('hex'), state: 'created' };
  for (const name of ['home', 'tmp', 'results', 'processes']) mkdirSync(join(directory, name), { mode: 0o700 });
  writeJson(join(directory, 'owner.json'), owner); writeJson(join(root, OWNER_PATH), owner); return owner;
}
export function validateOwnerRecord(owner, root, env, inspect = path => { const { dev, ino, mode } = statSync(path); return { real: realpathSync(path), dev, ino, mode }; }) {
  if (!owner || owner.schemaVersion !== 1 || owner.run !== env.GITHUB_RUN_ID || owner.attempt !== env.GITHUB_RUN_ATTEMPT || owner.job !== env.GITHUB_JOB || owner.commit !== env.QA_HEAD_SHA || !safeHex(owner.nonce) || typeof owner.directory !== 'string' || dirname(owner.directory) !== env.RUNNER_TEMP || !/^yeoni-b2-[A-Za-z0-9]+$/.test(basename(owner.directory)) || inside(root, owner.directory) || inside(owner.directory, root)) refuse('ownership_invalid');
  const info = inspect(owner.directory); if (info.real !== owner.directory || info.dev !== owner.dev || info.ino !== owner.ino || (info.mode & 0o077)) refuse('ownership_invalid');
  return owner;
}
export function readOwner(root = ROOT, env = process.env) {
  const path = regularPath(root, OWNER_PATH); if (statSync(path).mode & 0o077) refuse('ownership_invalid');
  const owner = validateOwnerRecord(json(path), root, env);
  if (JSON.stringify(json(regularPath(owner.directory, 'owner.json'))) !== JSON.stringify(owner)) refuse('ownership_invalid');
  return owner;
}
export function readPhaseConfiguration(root = ROOT, env = process.env) {
  validateRunner(env, root); const owner = readOwner(root, env);
  if (!['inactive', 'enabled'].includes(env.B2_PHASE) || (env.B2_DISCOVERY !== undefined && env.B2_DISCOVERY !== '1')) refuse('ownership_invalid');
  const phase = json(regularPath(owner.directory, 'phase.json'));
  const state = json(regularPath(owner.directory, 'state.json'));
  if (env.B2_PROCESS_TAG !== owner.nonce || env.PLAYWRIGHT_BROWSERS_PATH !== state.browserCache || realpathSync(state.browserCache) !== state.browserCache) refuse('ownership_invalid');
  if (phase.phase !== env.B2_PHASE || phase.nonce !== owner.nonce || phase.commit !== env.QA_HEAD_SHA || phase.state !== 'ready') refuse('ownership_invalid');
  return { phase: phase.phase, outputDir: join(owner.directory, 'results', phase.phase), discovery: env.B2_DISCOVERY === '1' };
}
export function expectedCases(phase) {
  if (!Object.hasOwn(SCENARIO_TITLES, phase)) refuse('discovery_invalid');
  return [...AUTH_TITLES.map(title => ({ project: 'auth-preservation', file: 'auth.spec.ts', title })),
    ...['chromium','webkit-small'].flatMap(project => SCENARIO_TITLES[phase].map(title => ({ project, file: 'legacy-evidence-review.spec.ts', title })))];
}
const caseKey = row => `${row.project}|${row.file}|${row.title}`;
export function projectDiscovery(report, phase) {
  if (!report || !Array.isArray(report.suites) || report.errors?.length) refuse('discovery_invalid');
  const rows = [];
  const walk = suite => {
    if (!['auth.spec.ts','legacy-evidence-review.spec.ts'].includes(suite.file) || suite.title !== suite.file || suite.suites?.length) refuse('discovery_invalid');
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      if (test.repeatEachIndex !== undefined && test.repeatEachIndex !== 0 || test.results?.length || !['auth.spec.ts','legacy-evidence-review.spec.ts'].includes(spec.file)) refuse('discovery_invalid');
      rows.push({ project: test.projectName, file: spec.file, title: spec.title });
    }
    for (const child of suite.suites ?? []) walk(child);
  }; report.suites.forEach(walk);
  const actual = rows.map(caseKey).sort(), expected = expectedCases(phase).map(caseKey).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) refuse('discovery_invalid');
  return expectedCases(phase);
}
export function projectExecution(report, phase, commit) {
  const expected = expectedCases(phase), rows = expected.map(row => ({ ...row, status: 'unrun', durationMs: 0 }));
  if (!report || report.commit !== commit || !['passed','failed','timedout','interrupted'].includes(report.status) || !Array.isArray(report.results) || report.results.length > rows.length) refuse('report_invalid');
  const seen = new Set();
  for (const result of report.results) {
    const row = rows.find(row => result.title === `${row.project} / ${row.file} / ${row.title}` || result.title === ` / ${row.project} / ${row.file} / ${row.title}`);
    if (!row || seen.has(caseKey(row)) || !['passed','failed','timedOut','skipped','interrupted'].includes(result.status) || !Number.isFinite(result.durationMs) || result.durationMs < 0) refuse('report_invalid');
    seen.add(caseKey(row)); row.status = result.status === 'skipped' ? 'unrun' : result.status; row.durationMs = Math.round(result.durationMs);
  }
  return { status: report.status === 'passed' && rows.every(row => row.status === 'passed') ? 'passed' : 'failed', discovered: expected.length, executed: seen.size, cases: rows };
}
export function parseProcessStat(text) {
  const match = /^(\d+) \(.*\) ([A-Z]) (.*)$/.exec(text?.trim() ?? ''); if (!match) return null;
  const fields = match[3].split(' '); const result = { pid: Number(match[1]), state: match[2], parent: Number(fields[0]), group: Number(fields[1]), session: Number(fields[2]), start: fields[18] };
  return Number.isSafeInteger(result.pid) && /^\d+$/.test(result.start ?? '') ? result : null;
}
const processInfo = pid => { try { return parseProcessStat(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return null; } };
export function sameProcess(record, current) { return !!current && record.pid === current.pid && record.start === current.start && record.group === current.group && record.session === current.session; }
export async function stopOwnedProcesses(records, boundary = {}) {
  const inspect = boundary.inspect ?? processInfo, kill = boundary.kill ?? ((pid, signal) => process.kill(pid, signal)), wait = boundary.wait ?? delay, now = boundary.now ?? Date.now;
  const running = () => records.filter(record => { const current = inspect(record.pid); if (!current || current.state === 'Z') return false; if (!sameProcess(record, current)) refuse('process_identity'); return true; });
  const signal = name => { for (const row of running().reverse()) { try { kill(row.pid, name); } catch (error) { if (error.code !== 'ESRCH') refuse('cleanup_failed'); } } };
  signal('SIGTERM'); const deadline = boundary.deadline ?? Infinity; const gentle = Math.min(now() + 15_000, deadline - 5_000);
  while (running().length && now() < gentle) await wait(100);
  if (running().length) signal('SIGKILL'); const force = Math.min(now() + 5_000, deadline);
  while (running().length && now() < force) await wait(100);
  if (running().length) refuse('cleanup_failed'); return true;
}
function registerProcess(owner, discovered, label) {
  if (!discovered || !Number.isSafeInteger(discovered.pid) || !/^\d+$/.test(discovered.start ?? '') || !Number.isSafeInteger(discovered.group) || !Number.isSafeInteger(discovered.session)) refuse('process_identity');
  const current = processInfo(discovered.pid);
  // The observed birth, not a later occupant of this PID, established ownership.
  if (!sameProcess(discovered, current)) refuse('process_identity');
  const row = { pid: discovered.pid, start: discovered.start, group: discovered.group, session: discovered.session, label, nonce: owner.nonce };
  writeJson(join(owner.directory, 'processes', `${row.pid}-${row.start}.json`), row); return row;
}

function processRecords(owner) {
  const files = readdirSync(join(owner.directory, 'processes')); if (files.length > LIMITS.processCount) refuse('process_limit');
  return files.map(file => { if (!/^\d+-\d+\.json$/.test(file)) refuse('ownership_invalid'); const row = json(regularPath(owner.directory, `processes/${file}`)); if (row.nonce !== owner.nonce || !Number.isSafeInteger(row.pid) || !/^\d+$/.test(row.start) || !Number.isSafeInteger(row.group) || !Number.isSafeInteger(row.session)) refuse('ownership_invalid'); return row; });
}
function scanOwned(owner) {
  const records = processRecords(owner), processes = readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(name => processInfo(Number(name))).filter(Boolean);
  for (const record of records.filter(row => row.pid === row.group)) {
    const leader = processes.find(row => row.pid === record.pid);
    if (leader && !sameProcess(record, leader)) refuse('process_identity');
  }
  const owned = new Set(records.filter(row => sameProcess(row, processes.find(p => p.pid === row.pid))).map(row => row.pid));
  let changed = true;
  while (changed) { changed = false; for (const row of processes) if (!owned.has(row.pid) && owned.has(row.parent)) { owned.add(row.pid); changed = true; } }
  for (const row of processes) {
    let marked = false; try { marked = readFileSync(`/proc/${row.pid}/environ`).includes(Buffer.from(`B2_PROCESS_TAG=${owner.nonce}\0`)); } catch { /* Other users' processes never become ours. */ }
    const ownedGroup = records.some(record => record.pid === record.group && record.group === row.group && record.session === row.session && BigInt(row.start) >= BigInt(record.start));
    if ((owned.has(row.pid) || marked || ownedGroup) && !records.some(record => sameProcess(record, row))) registerProcess(owner, row, 'descendant');
  }
  return processRecords(owner);
}
function noListener() {
  for (const table of ['/proc/net/tcp','/proc/net/tcp6']) for (const line of readFileSync(table,'utf8').split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/); if (fields[3] === '0A' && fields[1]?.split(':').at(-1) === '0BB8') refuse('port_occupied');
  }
}
async function reap(owner, deadline = Date.now() + 60_000) {
  const records = scanOwned(owner); await stopOwnedProcesses(records, { deadline });
  const remaining = scanOwned(owner).filter(row => { const current = processInfo(row.pid); return current && current.state !== 'Z' && sameProcess(row,current); });
  if (remaining.length) refuse('cleanup_failed'); noListener();
}
export function ownedCleanupDeadline(env, now = Date.now()) {
  const budget = validateBudget(env, now, true);
  // Includes shutdown already spent after the work cutoff; never reset the
  // absolute share. Keep 45 seconds for final stack proof/report afterward.
  return Math.min(now + LIMITS.cleanupMs - 45_000, budget.stop + LIMITS.cleanupMs - 45_000);
}
export function assertCleanupTime(deadline, now = Date.now()) {
  if (!Number.isSafeInteger(deadline) || now >= deadline) refuse('cleanup_failed');
}

function resourceSample(owner) { const rows = scanOwned(owner); return rows.reduce((total,row) => { if (!sameProcess(row, processInfo(row.pid))) return total; try { return total + Number(readFileSync(`/proc/${row.pid}/status`,'utf8').match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0) * 1024; } catch { return total; } },0); }
async function runFixed(owner, label, args, { cwd = ROOT, env = process.env, timeout = 120_000, capture = false, stopAt, onLine = () => {} } = {}) {
  if (!['sql','inactive-build','enabled-build','discovery','browser','server'].includes(label)) refuse('process_identity');
  let child, output = '', lineBuffer = '', timer, sample, killed = false, failure, forceTimer, settleTimer, rejectCompletion, spawnedIdentity;
  let abort;
  const observeFailure = childOperationObserver(label); let operation = 'spawn';
  if (runtimeStop.signal.aborted) refuse('interrupted');
  try {
    child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore','pipe','pipe'] });
    operation = 'spawn-event'; await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); });
    operation = 'register';
    spawnedIdentity = processInfo(child.pid);
    if (!spawnedIdentity || spawnedIdentity.parent !== process.pid || spawnedIdentity.group !== child.pid || spawnedIdentity.session !== child.pid) { spawnedIdentity = undefined; refuse('process_identity'); }
    registerProcess(owner, spawnedIdentity, label);
    const terminate = code => { if (!failure) { observeFailure('completion', { code }); failure = code; } if (!killed) { killed = true; const current = processInfo(spawnedIdentity.pid); if (current && !sameProcess(spawnedIdentity, current)) failure = 'process_identity'; else if (current && current.state !== 'Z') child.kill('SIGTERM'); forceTimer = setTimeout(() => { try { const rows = scanOwned(owner); for (const row of rows) { const current = processInfo(row.pid); if (row.pid !== process.pid && sameProcess(row, current) && current.state !== 'Z') process.kill(row.pid, 'SIGKILL'); } } catch { /* Cleanup below must report a failed identity; never kill an unknown PID. */ } }, 20_000); settleTimer = setTimeout(() => rejectCompletion?.(Object.assign(new Error('B2 process did not exit'), { code: 'cleanup_failed' })), 25_000); } };
    abort = () => terminate('interrupted'); runtimeStop.signal.addEventListener('abort', abort, { once: true });
    const ingest = chunk => {
      if (capture) { output += String(chunk); if (Buffer.byteLength(output) > LIMITS.captureBytes) terminate('resource_limit'); }
      else { lineBuffer += String(chunk); if (lineBuffer.length > 16_384) lineBuffer = ''; const lines = lineBuffer.split('\n'); lineBuffer = lines.pop(); for (const line of lines) onLine(line); }
    };
    child.stdout.on('data', ingest); child.stderr.on('data', capture ? () => {} : ingest);
    const started = Date.now(); let peakRss = 0, peakDisk = 0;
    sample = setInterval(() => { try { peakRss = Math.max(peakRss, resourceSample(owner)); if (Date.now() >= (stopAt ?? Infinity)) terminate('budget_exhausted'); if (Date.now() - started > timeout) terminate(label.endsWith('build') ? 'build_failed' : 'browser_failed'); } catch (error) { observeFailure('process-sample', error); terminate(safeFailure(error)); } }, 100);
    timer = setInterval(() => { try { peakDisk = Math.max(peakDisk, ownedUsage(owner.directory)); } catch (error) { observeFailure('disk-sample', error); terminate(safeFailure(error)); } }, 5000);
    operation = 'completion'; const code = await new Promise((resolve, reject) => { rejectCompletion = reject; child.once('close', resolve); });
    if (failure) refuse(failure);
    return { code, output, durationMs: Date.now()-started, peakRss, peakDisk };
  } catch (error) {
    observeFailure(operation, error);
    // If persistence fails after spawn, retain the exact in-memory birth identity
    // and stop that child before returning; a PID alone never authorizes a kill.
    if (spawnedIdentity) await stopOwnedProcesses([spawnedIdentity]);
    throw error;
  }
  finally { clearInterval(timer); clearInterval(sample); clearTimeout(forceTimer); clearTimeout(settleTimer); if (abort) runtimeStop.signal.removeEventListener('abort', abort); }
}
function freshReport(path, started, onState = () => {}) {
  const note = state => { try { onState(state); } catch { /* Diagnostic only. */ } };
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 ** 2) refuse('report_invalid');
    if (info.mtimeMs < started - 1000) { note('stale'); refuse('report_invalid'); }
    return json(path);
  } catch (error) { note('invalid'); throw error; }
}
const retireReport = path => { if (existsSync(path)) { if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) refuse('report_invalid'); rmSync(path); } };
function runEnvironment(owner, phase, discovery = false) {
  const keys = ['GITHUB_ACTIONS','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_JOB','GITHUB_WORKSPACE','RUNNER_TEMP','CI','QA_HEAD_SHA','QA_SOUP_VARIANT','QA_SOUP_LIBRARY','B2_JOB_STARTED_MS','B2_JOB_DEADLINE_MS','B2_STOP_AT_MS','YEONI_E2E','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const browserCache = json(regularPath(owner.directory, 'state.json')).browserCache;
  if (realpathSync(browserCache) !== browserCache || !statSync(browserCache).isDirectory()) refuse('environment_override');
  const env = { ...Object.fromEntries(keys.map(key => [key, process.env[key]])),
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LANG:'C.UTF-8', LC_ALL:'C.UTF-8', NEXT_TELEMETRY_DISABLED:'1',
    B2_PROCESS_TAG: owner.nonce, B2_PHASE: phase, HOME: join(owner.directory,'home'), TMPDIR: join(owner.directory,'tmp'), PLAYWRIGHT_BROWSERS_PATH:browserCache };
  if (discovery) env.B2_DISCOVERY = '1'; else delete env.B2_DISCOVERY;
  return env;
}
function unrunPhase(phase) { return { status: 'unrun', discovered: 0, executed: 0, cases: expectedCases(phase).map(row => ({ ...row, status: 'unrun', durationMs: 0 })) }; }
function initialReport() { return { schemaVersion: 1, kind: 'disposable-b2-browser', status: 'failed', failureCode: 'harness_failed',
  phases: { inactive: unrunPhase('inactive'), enabled: unrunPhase('enabled') }, cleanup: { processes: 'unverified', copy: 'unverified', source: 'unverified', normalBuild: 'unverified', stack: 'unverified', accounts: 'unverified' },
  limitations: ['Synthetic generated meaning/reader-typing only.', 'No physical-device or native OS IME certification.', 'No same-item listening/audio provenance, Gate C or production activation.', 'Protected ledger cascade is SQL case 9 plus disposable-stack removal, not per-browser-account privileged readback.'] }; }
function saveReport(report) { writeJson(join(ROOT, REPORT_PATH), report); }
async function stackIdentity() {
  const { verifyDisposableStack } = await import('./qa-legacy-evidence-postgres.mjs'); const stack = verifyDisposableStack();
  const docker = args => execFileSync('docker',['--context','default',...args],{ encoding:'utf8',timeout:15000,maxBuffer:4*1024**2,stdio:['ignore','pipe','pipe'] });
  const ids = docker(['ps','--no-trunc','--filter',`label=com.supabase.cli.project=${stack.projectId}`,'--format','{{.ID}}']).trim().split('\n').filter(Boolean);
  if (!ids.length || ids.some(id => !safeHex(id))) refuse('source_identity');
  const containers = JSON.parse(docker(['inspect',...ids])); const volumes = [...new Set(containers.flatMap(row => (row.Mounts ?? []).filter(m => m.Type === 'volume').map(m => m.Name)))].sort();
  if (volumes.some(name => !/^[a-zA-Z0-9_.-]+$/.test(name))) refuse('source_identity');
  return { stack, identity: { container: stack.container, ids: ids.sort(), volumes, configDigest:sha256(readFileSync(join(ROOT,'.e2e/stack/supabase/config.toml'))) } };
}
async function serve() {
  const config = readPhaseConfiguration(), owner = readOwner(); if (config.discovery) refuse('ownership_invalid');
  const identity = verifyCheckout(), state = json(regularPath(owner.directory,'state.json'));
  if (state.source.fullTrackedDigest !== identity.fullTrackedDigest) refuse('source_changed');
  const app = config.phase === 'inactive' ? ROOT : join(owner.directory,'enabled-app');
  if (config.phase === 'enabled') verifyCopiedSources(app, identity.manifest);
  if (JSON.stringify(buildIdentity(app, 'runtime')) !== JSON.stringify(state.builds[config.phase])) refuse('source_changed');
  const status = json(regularPath(ROOT,'.e2e/stack-status.json'));
  registerProcess(owner,processInfo(process.pid),'server-launcher'); noListener();
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; const records = scanOwned(owner).filter(row => row.pid !== process.pid && row.label === 'server'); await stopOwnedProcesses(records); };
  const signal = () => { stop().catch(() => { process.exitCode=1; }); };
  process.on('SIGTERM',signal); process.on('SIGINT',signal);
  const serverStarted=Date.now(); let readiness;
  const observeReadiness=async()=>{
    while(!stopping && Date.now()-serverStarted<120_000){
      try{const response=await fetch('http://127.0.0.1:3000/diet/settings',{redirect:'manual',signal:AbortSignal.timeout(1000)});
        await response.body?.cancel();
        if(response.status>=200&&response.status<400){writeJson(join(owner.directory,`${config.phase}-readiness.json`),{phase:config.phase,nonce:owner.nonce,readinessMs:Date.now()-serverStarted});return;}
      }catch{/* Fixed loopback readiness only; no raw network error is retained. */}
      await delay(100);
    }
  };
  try {
    const result = await runFixed(owner,'server',['--import',join(ROOT,'scripts/qa-http-observer.mjs'),join(app,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3000'],
      { cwd:app,env:closedApplicationEnvironment(process.env,owner,status,true),timeout:LIMITS.jobMs,stopAt:validateBudget(process.env).stop,onLine:line=>{
        if(!readiness && /(?:^|\s)Ready in \d/.test(line.replace(/\x1b\[[0-9;]*m/g,'')))readiness=observeReadiness();
      } });
    if (!stopping && result.code !== 0) refuse('browser_failed');
  } finally { process.off('SIGTERM',signal); process.off('SIGINT',signal); await stop(); if(readiness)await readiness; }
}
async function run() {
  const report = initialReport(); let owner, identity, normalBuild, state; let stage = 'runner-preflight';
  const interrupt = () => runtimeStop.abort(); process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    const budget = validateRunner(process.env,ROOT); if (process.env.PLAYWRIGHT_BROWSERS_PATH || process.env.B2_PROCESS_TAG) refuse('environment_override'); if (Date.now() >= budget.stop) refuse('budget_exhausted');
    stage = 'checkout-preflight'; identity = verifyCheckout(); noListener(); stage = 'owned-directory'; owner = createOwner(ROOT,process.env);
    report.identity = { commit:identity.commit,tree:identity.tree,fullTrackedDigest:identity.fullTrackedDigest,protectedDigest:identity.protectedDigest,protectedFileCount:identity.protectedFileCount,inventory: { digest:identity.manifest.digest,files:identity.manifest.fileCount,bytes:identity.manifest.byteCount },controls:identity.controls };
    report.job = { run:owner.run,attempt:owner.attempt,job:owner.job,start:budget.start,deadline:budget.deadline,stop:budget.stop };
    stage = 'owned-state'; state = { source: { commit:identity.commit,tree:identity.tree,fullTrackedDigest:identity.fullTrackedDigest },builds:{},browserCache:join(realpathSync(process.env.HOME),'.cache/ms-playwright'),report }; writeJson(join(owner.directory,'state.json'),state);
    stage = 'stack-before'; const stackBefore = await stackIdentity(); state.stack=stackBefore.identity; writeJson(join(owner.directory,'state.json'),state);
    stage = 'sql-gate'; const sqlPath=join(ROOT,SQL_REPORT); retireReport(sqlPath); const sqlStarted=Date.now();
    const sql = await runFixed(owner,'sql',['--experimental-strip-types','scripts/qa-legacy-evidence-postgres.mjs'],{ env:{ ...process.env,B2_PROCESS_TAG:owner.nonce },timeout:5*60_000,stopAt:budget.stop });
    if(sql.code!==0)emitDiagnostic('sql-gate','failed',{code:'sql_failed'});
    stage = 'sql-result'; const sqlReport=freshReport(sqlPath,sqlStarted); const { CASES }=await import('./qa-legacy-evidence-postgres.mjs');
    if (sql.code!==0 || sqlReport.status!=='passed' || sqlReport.cleanup!=='passed' || sqlReport.http?.status!=='passed' || JSON.stringify(sqlReport.cases?.map(row=>row.name))!==JSON.stringify(CASES) || sqlReport.cases.some(row=>row.status!=='passed')) refuse('sql_failed');
    stage = 'stack-after'; const stackAfter=await stackIdentity(); if(JSON.stringify(stackBefore.identity)!==JSON.stringify(stackAfter.identity)) refuse('sql_failed');
    report.sql={status:'passed',summaryDigest:sha256(readFileSync(sqlPath)),stackDigest:sha256(JSON.stringify(stackBefore.identity)),sameJobProcess:true,httpCleanup:'passed-by-terminal-process',durationMs:sql.durationMs};
    const app=join(owner.directory,'enabled-app'), copyStarted=Date.now();
    const copyCheckpoint=()=>{if(runtimeStop.signal.aborted)refuse('interrupted');if(Date.now()>=budget.stop)refuse('budget_exhausted');};
    stage = 'source-copy'; report.copy=copySources(ROOT,app,identity.manifest,copyCheckpoint);
    stage = 'dependencies-main'; const mainDependencies=copyDependencyTree(join(ROOT,'node_modules'),join(app,'node_modules'),json(join(ROOT,'package-lock.json')),{checkpoint:copyCheckpoint,maxBytes:LIMITS.ownedBytes-ownedUsage(owner.directory)});
    stage = 'dependencies-browser-qa'; const browserQaDependencies=copyDependencyTree(join(ROOT,'scripts/browser-qa/node_modules'),join(app,'scripts/browser-qa/node_modules'),json(join(ROOT,'scripts/browser-qa/package-lock.json')),{checkpoint:copyCheckpoint,maxBytes:LIMITS.ownedBytes-ownedUsage(owner.directory)});
    report.dependencies={ main:mainDependencies, browserQa:browserQaDependencies };
    stage = 'copy-result'; report.copy.durationMs=Date.now()-copyStarted; report.copy.bytes=ownedUsage(owner.directory); report.copy.peakControllerRss=process.resourceUsage().maxRSS*1024;
    for (const phase of ['inactive','enabled']) {
      stage = `${phase}-build`; if(Date.now()>=budget.stop) refuse('budget_exhausted'); noListener();
      const cwd=phase==='inactive'?ROOT:app;
      const built=await runFixed(owner,`${phase}-build`,[join(cwd,'node_modules/next/dist/bin/next'),'build'],{cwd,env:closedApplicationEnvironment(process.env,owner,stackBefore.stack.status),timeout:10*60_000,stopAt:budget.stop});
      if(built.code!==0)emitDiagnostic(`${phase}-build`,'failed',{code:'build_failed'});
      stage = `${phase}-build-reap`; await reap(owner); stage = `${phase}-build`; if(built.code!==0) refuse('build_failed');
      stage = `${phase}-build-identity`; state.builds[phase]=buildIdentity(cwd); if(phase==='inactive')normalBuild=state.builds.inactive;
      report.phases[phase].build={...state.builds[phase],durationMs:built.durationMs,peakRss:built.peakRss,peakDisk:built.peakDisk};
      writeJson(join(owner.directory,'state.json'),state); writeJson(join(owner.directory,'phase.json'),{phase,nonce:owner.nonce,commit:owner.commit,state:'ready'});
      stage = `${phase}-discovery`; const list=await runFixed(owner,'discovery',['node_modules/@playwright/test/cli.js','test',`--config=${CONFIG}`,'--list','--reporter=json'],{env:runEnvironment(owner,phase,true),capture:true,timeout:60_000,stopAt:budget.stop});
      if(list.code!==0)refuse('discovery_invalid'); const discovered=projectDiscovery(JSON.parse(list.output),phase); noListener();
      const summary=join(ROOT,SUMMARY); retireReport(summary); const start=Date.now(); const cleanupRows=[];
      stage = `${phase}-browser`; let executionFailure; let result;
      try { result=await runFixed(owner,'browser',['scripts/qa-playwright.mjs',`--config=${CONFIG}`],{env:runEnvironment(owner,phase),timeout:budget.stop-Date.now(),stopAt:budget.stop,onLine:line=>{
        if(!line.startsWith('QA_CLEANUP '))return; try{const row=JSON.parse(line.slice(11));if(discovered.some(item=>item.title===row.title)&&Number.isSafeInteger(row.accountsRemoved)&&row.accountsRemoved>=1&&row.accountsRemoved<=2&&row.rowsRemaining===0&&Array.isArray(row.blockedOrigins)&&row.blockedOrigins.length===0)cleanupRows.push({title:row.title,count:row.accountsRemoved});}catch{/* No arbitrary output is retained. */}
      }}); } catch(error) { emitDiagnostic(stage,'failed',error); executionFailure=error; result={code:1,durationMs:Date.now()-start,peakRss:null,peakDisk:null}; }
      if(!executionFailure&&result.code!==0)emitDiagnostic(`${phase}-browser`,'failed',{code:'browser_failed'});
      stage = `${phase}-browser-result`; const readinessPath=join(owner.directory,`${phase}-readiness.json`);
      if(existsSync(readinessPath)){const ready=json(regularPath(owner.directory,`${phase}-readiness.json`));if(ready.phase!==phase||ready.nonce!==owner.nonce||!Number.isSafeInteger(ready.readinessMs)||ready.readinessMs<0||ready.readinessMs>120_000)refuse('report_invalid');report.phases[phase].serverReadinessMs=ready.readinessMs;}
      const reportState=reportStateObserver(phase); let execution;
      if(existsSync(summary)) {
        try { const raw=freshReport(summary,start,reportState); execution=projectExecution(raw,phase,identity.commit); reportState('validated'); emitExecutionDiagnostics(raw,execution,phase); }
        catch(error) { reportState('invalid'); throw error; }
      } else { reportState('missing'); execution={...unrunPhase(phase),status:'failed',discovered:discovered.length}; }
      report.phases[phase]={...report.phases[phase],...execution,durationMs:result.durationMs,peakRss:result.peakRss,peakDisk:result.peakDisk,
        accounts:{created:cleanupRows.length===discovered.length?cleanupRows.reduce((n,row)=>n+row.count,0):null,deleted:cleanupRows.reduce((n,row)=>n+row.count,0),verified:cleanupRows.length===discovered.length}};
      if(!executionFailure&&result.code===0&&(execution.status!=='passed'||cleanupRows.length!==discovered.length||report.phases[phase].serverReadinessMs===undefined))emitDiagnostic(`${phase}-browser`,'failed',{code:'browser_failed'});
      stage = `${phase}-phase-reap`; const teardownStarted=Date.now(); await reap(owner); report.phases[phase].ownedTeardownMs=Date.now()-teardownStarted; if(JSON.stringify(buildIdentity(ROOT,'runtime'))!==JSON.stringify(normalBuild))refuse('source_changed');
      stage = `${phase}-browser`; if(executionFailure)throw executionFailure;
      if(result.code!==0||execution.status!=='passed'||cleanupRows.length!==discovered.length||report.phases[phase].serverReadinessMs===undefined)refuse('browser_failed');
      stage = `${phase}-source-check`; if(verifyCheckout().fullTrackedDigest!==identity.fullTrackedDigest)refuse('source_changed'); verifyCopiedSources(app,identity.manifest); saveReport(report);
    }
    report.cleanup.accounts='passed'; report.status='awaiting-cleanup'; delete report.failureCode;
  } catch(error) { emitDiagnostic(stage,'failed',error);report.status='failed';report.failureCode=safeFailure(error); }
  finally {
    if(owner) {
      try{await reap(owner);report.cleanup.processes='passed';emitDiagnostic('run-cleanup-processes','passed');}catch(error){emitDiagnostic('run-cleanup-processes','failed',error);report.cleanup.processes='failed';report.status='failed';report.failureCode='cleanup_failed';}
      try{if(!identity||verifyCheckout().fullTrackedDigest!==identity.fullTrackedDigest)refuse('source_changed');report.cleanup.source='passed';emitDiagnostic('run-cleanup-source','passed');}catch(error){emitDiagnostic('run-cleanup-source','failed',error);report.cleanup.source='failed';report.status='failed';report.failureCode='source_changed';}
      try{if(normalBuild&&JSON.stringify(buildIdentity(ROOT,'runtime'))===JSON.stringify(normalBuild))report.cleanup.normalBuild='passed';else report.cleanup.normalBuild='unverified';emitDiagnostic('run-cleanup-build',report.cleanup.normalBuild);}catch(error){emitDiagnostic('run-cleanup-build','failed',error);report.cleanup.normalBuild='failed';report.status='failed';report.failureCode='source_changed';}
      state={...state,report};writeJson(join(owner.directory,'state.json'),state);
    }
    saveReport(report); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  }
  if(report.status==='failed')process.exitCode=1;
}
async function cleanup() {
  validateRunner(process.env,ROOT,Date.now(),true);
  if(!existsSync(join(ROOT,OWNER_PATH))) {
    const report=existsSync(join(ROOT,REPORT_PATH))?json(join(ROOT,REPORT_PATH)):initialReport();
    if(report.cleanup.copy!=='passed'){report.status='failed';report.cleanup.copy='unverified';saveReport(report);process.exitCode=1;}emitDiagnostic('cleanup-copy',report.cleanup.copy);return;
  }
  const cleanupStarted=Date.now(), cleanupDeadline=ownedCleanupDeadline(process.env,cleanupStarted); const owner=readOwner();
  const state=existsSync(join(owner.directory,'state.json'))?json(regularPath(owner.directory,'state.json')):{};
  const report=state.report??initialReport(); let processesStopped=false;
  try { await reap(owner,cleanupDeadline);report.cleanup.processes='passed';processesStopped=true;emitDiagnostic('cleanup-processes','passed'); }
  catch(error){emitDiagnostic('cleanup-processes','failed',error);report.cleanup.processes='failed';report.status='failed';report.failureCode=safeFailure(error);}
  try {
    assertCleanupTime(cleanupDeadline); const identity=verifyCheckout();
    if(state.source&&identity.fullTrackedDigest!==state.source.fullTrackedDigest)refuse('source_changed');
    report.cleanup.source='passed';emitDiagnostic('cleanup-source','passed');
  }catch(error){emitDiagnostic('cleanup-source','failed',error);report.cleanup.source='failed';report.status='failed';report.failureCode=safeFailure(error);}
  try {
    assertCleanupTime(cleanupDeadline); if(!state.builds?.inactive)report.cleanup.normalBuild='unverified';
    else if(JSON.stringify(buildIdentity(ROOT,'runtime'))!==JSON.stringify(state.builds.inactive))refuse('source_changed');
    else report.cleanup.normalBuild='passed';
    emitDiagnostic('cleanup-build',report.cleanup.normalBuild);
  }catch(error){emitDiagnostic('cleanup-build','failed',error);report.cleanup.normalBuild='failed';report.status='failed';report.failureCode=safeFailure(error);}
  try {
    assertCleanupTime(cleanupDeadline); if(!processesStopped)refuse('cleanup_failed');
    ownedUsage(owner.directory,false);validateOwnerRecord(owner,ROOT,process.env);
    // The fixed receipt survives removal without retaining application bytes.
    if(state.stack)writeJson(join(ROOT,'.e2e/legacy-evidence-b2-stack-cleanup.json'),{run:owner.run,attempt:owner.attempt,job:owner.job,commit:owner.commit,stack:state.stack});
    assertCleanupTime(cleanupDeadline); rmSync(owner.directory,{recursive:true});if(existsSync(owner.directory))refuse('cleanup_failed');
    rmSync(join(ROOT,OWNER_PATH));report.cleanup.copy='passed';emitDiagnostic('cleanup-copy','passed');
  }catch(error){emitDiagnostic('cleanup-copy','failed',error);report.status='failed';report.failureCode=safeFailure(error);report.cleanup.copy='failed';}
  report.ownedCleanupDurationMs=Date.now()-cleanupStarted; saveReport(report);if(report.status==='failed')process.exitCode=1;
}
async function finalize() {
  const report=existsSync(join(ROOT,REPORT_PATH))?json(join(ROOT,REPORT_PATH)):initialReport();
  try {
    validateRunner(process.env,ROOT,Date.now(),true);const proof=json(regularPath(ROOT,'.e2e/legacy-evidence-b2-stack-cleanup.json'));
    if(process.env.B2_STACK_STOP_EXIT!=='0'||proof.run!==process.env.GITHUB_RUN_ID||proof.attempt!==process.env.GITHUB_RUN_ATTEMPT||proof.job!==process.env.GITHUB_JOB||proof.commit!==process.env.QA_HEAD_SHA||!proof.stack||existsSync(join(ROOT,'.e2e/stack-status.json'))||existsSync(join(ROOT,'.e2e/stack'))||existsSync(join(ROOT,OWNER_PATH)))refuse('stack_cleanup_failed');
    const docker=args=>execFileSync('docker',['--context','default',...args],{encoding:'utf8',timeout:15000,maxBuffer:4*1024**2,stdio:['ignore','pipe','pipe']}).trim().split('\n');
    const containers=docker(['ps','--all','--no-trunc','--format','{{.ID}}']),volumes=docker(['volume','ls','--format','{{.Name}}']);
    if(proof.stack.ids.some(id=>containers.includes(id))||proof.stack.volumes.some(name=>volumes.includes(name)))refuse('stack_cleanup_failed');report.cleanup.stack='passed';emitDiagnostic('finalize-stack','passed');
    if(report.status==='awaiting-cleanup'&&Object.values(report.cleanup).every(value=>value==='passed'))report.status='passed';else report.status='failed';
  }catch(error){emitDiagnostic('finalize-stack','failed',error);report.status='failed';report.failureCode=safeFailure(error);report.cleanup.stack='unverified';}
  emitDiagnostic('finalize-result',report.status,{code:report.failureCode});saveReport(report);if(report.status!=='passed')process.exitCode=1;
}
export async function main() {
  if(process.argv.length!==3||!['run','serve','cleanup','finalize'].includes(process.argv[2]))refuse('runner_required');
  if(process.argv[2]==='serve')return serve();if(process.argv[2]==='cleanup')return cleanup();if(process.argv[2]==='finalize')return finalize();return run();
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{emitDiagnostic(`${process.argv[2]}-bootstrap`,'failed',error);process.exitCode=1;});
