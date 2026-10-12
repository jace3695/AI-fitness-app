import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { types } from 'node:util';
import * as filesystem from 'node:fs';
import * as paths from 'node:path';
import ts from 'typescript';
import * as harness from '../scripts/qa-legacy-evidence-browser.mjs';
import * as resetDiagnostics from '../scripts/legacy-evidence-reset-diagnostics.mjs';

// Contract tests use tiny disk fixtures and fake lifecycle boundaries, except
// the explicitly bounded installed-Playwright --list regression below. That
// regression loads authored config/specs without executing callbacks, servers,
// browsers, authentication, SQL, Docker, installs or network operations.
const runnerSource = readFileSync(new URL('../scripts/qa-legacy-evidence-browser.mjs', import.meta.url), 'utf8');
const runnerAst = ts.createSourceFile('qa-legacy-evidence-browser.mjs', runnerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const releaseBytes = readFileSync(new URL('../app/data/languageLegacyEvidenceRelease.ts', import.meta.url));
const commit = 'a'.repeat(40);
const nonce = 'b'.repeat(64);
const API = 'http://127.0.0.1:54321';
const START = 1_800_000_000_000;
const env = {
  GITHUB_ACTIONS: 'true', CI: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'b2-browser',
  QA_HEAD_SHA: commit, GITHUB_WORKSPACE: '/synthetic/checkout', RUNNER_TEMP: '/synthetic/runner',
  QA_SOUP_LIBRARY: '/synthetic/runner/webkit-soup/lib/libsoup-3.0.so.0', QA_SOUP_VARIANT: 'fixed',
  NEXT_PUBLIC_SUPABASE_URL: API, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon',
  B2_JOB_STARTED_MS: String(START), B2_JOB_DEADLINE_MS: String(START + harness.LIMITS.jobMs),
  B2_STOP_AT_MS: String(START + harness.LIMITS.jobMs - harness.LIMITS.reserveMs),
};
const refuse = (code: string): never => { throw Object.assign(new Error(`B2 refused: ${code}`), { code }); };
function refused(fn: () => unknown, code: string) { assert.throws(fn, { code }); }
function functionSource(name: string) {
  const declaration = runnerAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration && ts.isFunctionDeclaration(declaration), `Missing runner function ${name}`);
  return declaration.getText(runnerAst).replace(/^export\s+/, '');
}
function privateFunction(name: string, bindings: Record<string, unknown>) {
  if (['registerProcess', 'scanOwned'].includes(name) && !Object.hasOwn(bindings, 'refuseProcessIdentity')) bindings = { refuseProcessIdentity: processDiagnosticBoundary().refuseIdentity, ...bindings };
  if (['processRecords', 'writeProcessRecord'].includes(name) && !Object.hasOwn(bindings, 'refuseProcessOwnership')) bindings = { refuseProcessOwnership: processOwnershipBoundary().refuseOwnership, ...bindings };
  return new Function(...Object.keys(bindings), `${functionSource(name)}\nreturn ${name};`)(...Object.values(bindings));
}
function fixedSet(name: string) {
  const declaration = runnerAst.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => ts.isIdentifier(node.name) && node.name.text === name);
  assert.ok(declaration?.initializer && ts.isNewExpression(declaration.initializer));
  assert.equal(declaration.initializer.expression.getText(runnerAst), 'Set');
  const values = declaration.initializer.arguments?.[0]; assert.ok(values && ts.isArrayLiteralExpression(values));
  return new Set(values.elements.map(value => { assert.ok(ts.isStringLiteral(value)); return value.text; }));
}
function processDiagnosticBoundary() {
  const processIdentityDetails = new WeakMap<object, object>();
  const detailObject = privateFunction('detailObject', { types }), detailField = privateFunction('detailField', { detailObject });
  const refuseIdentity = privateFunction('refuseProcessIdentity', { processIdentityDetails, detailObject, detailField, PROCESS_IDENTITY_SITES: fixedSet('PROCESS_IDENTITY_SITES'), PROCESS_IDENTITY_REASONS: fixedSet('PROCESS_IDENTITY_REASONS'), PROCESS_STAT_READS: fixedSet('PROCESS_STAT_READS') });
  const detail = privateFunction('processIdentityDetail', { processIdentityDetails, safeFailure: harness.safeFailure });
  const observer = privateFunction('childOperationObserver', { detailSink: () => {}, CHILD_LABELS: fixedSet('CHILD_LABELS'), CHILD_OPERATIONS: fixedSet('CHILD_OPERATIONS'), SYSTEM_CODES: fixedSet('SYSTEM_CODES'), types, safeFailure: harness.safeFailure, processIdentityDetail: detail, processOwnershipDetail: () => ({}), emitDetailRecords: privateFunction('emitDetailRecords', { DETAIL_PREFIX: '[legacy-evidence-b2-detail] ' }) });
  const inspect = (read: (path: string, encoding: string) => string) => privateFunction('processInfo', { readFileSync: read, parseProcessStat: harness.parseProcessStat, types, PROCESS_STAT_READS: fixedSet('PROCESS_STAT_READS') });
  return { refuseIdentity, detail, observer, inspect };
}
function processOwnershipBoundary() {
  const processOwnershipDetails = new WeakMap<object, object>();
  const refuseOwnership = privateFunction('refuseProcessOwnership', { processOwnershipDetails, PROCESS_OWNERSHIP_SITES: fixedSet('PROCESS_OWNERSHIP_SITES'), PROCESS_OWNERSHIP_REASONS: fixedSet('PROCESS_OWNERSHIP_REASONS') });
  const detail = privateFunction('processOwnershipDetail', { processOwnershipDetails, safeFailure: harness.safeFailure });
  const observer = privateFunction('childOperationObserver', { detailSink: () => {}, CHILD_LABELS: fixedSet('CHILD_LABELS'), CHILD_OPERATIONS: fixedSet('CHILD_OPERATIONS'), SYSTEM_CODES: fixedSet('SYSTEM_CODES'), types, safeFailure: harness.safeFailure, processIdentityDetail: () => ({}), processOwnershipDetail: detail, emitDetailRecords: privateFunction('emitDetailRecords', { DETAIL_PREFIX: '[legacy-evidence-b2-detail] ' }) });
  return { refuseOwnership, detail, observer };
}
function tiny(t: { after: (fn: () => void) => void }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'b2-pure-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(root: string, path: string, bytes: string | Buffer, mode = 0o644) {
  const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes, { mode }); chmodSync(file, mode); return file;
}
type Entry = { path: string; sha256: string; bytes: number; mode: number };
function entry(path: string, bytes: string | Buffer, mode = 0o100644): Entry {
  return { path, mode, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
}
function manifest(files = [entry(harness.RELEASE_PATH, releaseBytes), entry('scripts/synthetic.mjs', '#!/usr/bin/env node\n', 0o100755)]) {
  const sorted = [...files].sort((a, b) => a.path < b.path ? -1 : 1);
  return { schemaVersion: 1, baseline: { commit: 'bd124e77db6744cb8a518fee4cbd6c721e8b8bc8', tree: 'ef6aacb5c11c888e454817433f26a9f0f3d5b44f' }, selfExcluded: harness.MANIFEST_PATH, controlPaths: [...harness.CONTROL_PATHS], fileCount: sorted.length, byteCount: sorted.reduce((sum, row) => sum + row.bytes, 0), digest: harness.inventoryDigest(sorted), files: sorted };
}
function sourceFixture(root: string) {
  put(root, harness.RELEASE_PATH, releaseBytes); put(root, 'scripts/synthetic.mjs', '#!/usr/bin/env node\n', 0o755);
  return manifest();
}

// Source identity, private copying and one fixed activation literal.
test('source allowlist admits exact application roots, root controls and six media inputs', () => {
  for (const path of ['app/a.ts', 'components/a.tsx', 'content/a.json', 'data/a.json', 'hooks/a.ts', 'lib/a.ts', 'public/a.svg', 'scripts/a.mjs', 'services/a.ts', 'supabase/migrations/a.sql', 'tests/a.ts', 'utils/a.ts', 'AGENTS.md', 'package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json', 'postcss.config.js', 'tailwind.config.ts', 'eslint.config.mjs', '.eslintrc.json', 'playwright.config.ts', 'playwright.legacy-evidence.config.ts', ...harness.MEDIA_INPUTS]) assert.equal(harness.allowedSourcePath(path), true, path);
  assert.equal(harness.MEDIA_INPUTS.length, 6);
  for (const path of ['README.md', 'next-env.d.ts', 'docs/unreviewed.json', 'docs/yeoni-phase12/media/other.mp3', 'random/app/a.ts', '.github/workflows/a.yml', harness.MANIFEST_PATH]) assert.equal(harness.allowedSourcePath(path), false, path);
});
test('source allowlist excludes credentials, output and nested ignored components', () => {
  for (const part of ['.git', '.github', '.e2e', '.next', '.vercel', 'node_modules', 'test-results', 'playwright-report', 'coverage', 'out', 'build', 'dist', '.cache', '.temp', 'evidence', '.env', '.env.local']) assert.equal(harness.allowedSourcePath(`app/${part}/a.ts`), false, part);
  for (const suffix of ['tsbuildinfo', 'pem', 'key', 'p12', 'pfx', 'log', 'KEY']) assert.equal(harness.allowedSourcePath(`scripts/a.${suffix}`), false, suffix);
});
test('relative paths refuse traversal, absolute paths, backslashes, controls and empty components', () => {
  for (const path of ['', '/app/a.ts', '../app/a.ts', 'app/../a.ts', 'app/./a.ts', 'app//a.ts', 'app/a.ts/', 'app\\a.ts', 'app/\u0000.ts', 'app/\n.ts', 'app/\u007f.ts', 'x'.repeat(513)]) refused(() => harness.validateRelativePath(path), 'source_path');
  assert.equal(harness.validateRelativePath('app/한글.ts'), 'app/한글.ts');
});
test('reviewed manifest digest is exact SHA-256, two spaces, relative UTF-8 path and newline', () => {
  const reviewed = manifest();
  const independent = createHash('sha256').update(reviewed.files.map(row => `${row.sha256}  ${row.path}\n`).join(''), 'utf8').digest('hex');
  assert.equal(reviewed.digest, independent);
  assert.equal(harness.validateManifest(reviewed, reviewed.files.map(row => row.path)), reviewed);
  assert.ok(harness.CONTROL_PATHS.includes(harness.MANIFEST_PATH));
  assert.ok(!reviewed.files.some(row => row.path === harness.MANIFEST_PATH));
});
test('manifest refuses self hashing, unknown entries, duplicate or case-colliding paths and reordering', () => {
  const original = manifest();
  for (const row of [entry(harness.MANIFEST_PATH, '{}'), entry('docs/unreviewed.json', '{}'), original.files[1], entry('scripts/SYNTHETIC.mjs', 'other')]) refused(() => harness.validateManifest(manifest([...original.files, row])), 'inventory_invalid');
  refused(() => harness.validateManifest({ ...original, files: [...original.files].reverse() }), 'inventory_invalid');
  refused(() => harness.validateManifest(original, [harness.RELEASE_PATH]), 'inventory_invalid');
  refused(() => harness.validateManifest(manifest([entry('scripts/only.mjs', 'x')])), 'release_changed');
});
test('manifest refuses hash/count/byte/mode/schema drift and extra file metadata', () => {
  const reviewed = manifest();
  for (const patch of [{ schemaVersion: 2 }, { unexpected: 'secret' }, { baseline: { commit: 'main', tree: 'other' } }, { selfExcluded: 'other.json' }, { controlPaths: [] }, { digest: '0'.repeat(64) }, { fileCount: 1 }, { byteCount: reviewed.byteCount + 1 }, { files: [] }]) refused(() => harness.validateManifest({ ...reviewed, ...patch }), 'inventory_invalid');
  for (const patch of [{ sha256: 'NOT-A-HASH' }, { bytes: -1 }, { bytes: 1.5 }, { mode: 0o120000 }, { raw: 'do-not-export' }]) refused(() => harness.validateManifest(manifest([reviewed.files[0], { ...reviewed.files[1], ...patch }])), 'inventory_invalid');
  refused(() => harness.validateManifest(manifest([{ ...reviewed.files[0], sha256: 'c'.repeat(64) }, reviewed.files[1]])), 'release_changed');
});
test('regular source paths refuse both leaf and parent symlinks and nonregular directories', t => {
  const root = tiny(t); put(root, 'real/a.ts', 'x'); symlinkSync('real/a.ts', join(root, 'leaf.ts')); symlinkSync('real', join(root, 'alias'));
  refused(() => harness.regularPath(root, 'leaf.ts'), 'source_path'); refused(() => harness.regularPath(root, 'alias/a.ts'), 'source_path'); refused(() => harness.regularPath(root, 'real'), 'source_path');
  assert.equal(harness.regularPath(root, 'real/a.ts'), join(root, 'real/a.ts'));
  symlinkSync(root, join(root, 'root-link')); refused(() => harness.regularPath(join(root, 'root-link'), 'real/a.ts'), 'source_path');
});
test('release fixture permits one exact whole-module substitution, never a generic patch', () => {
  assert.equal(harness.sha256(releaseBytes), harness.RELEASE_SHA256);
  const enabled = harness.enableRelease(releaseBytes);
  assert.equal(enabled.toString(), releaseBytes.toString().replace(harness.INACTIVE_LITERAL, harness.ENABLED_LITERAL));
  assert.equal(enabled.toString().split(harness.ENABLED_LITERAL).length, 2);
  assert.equal(enabled.toString().includes(harness.INACTIVE_LITERAL), false);
  for (const bytes of [Buffer.concat([releaseBytes, Buffer.from('\n')]), enabled, Buffer.from(harness.INACTIVE_LITERAL), Buffer.from(releaseBytes.toString().replace(harness.INACTIVE_LITERAL, '')), Buffer.concat([releaseBytes, Buffer.from(harness.INACTIVE_LITERAL)])]) refused(() => harness.enableRelease(bytes), 'release_changed');
});
test('source copy preserves executable bytes/inodes and changes only the release module', t => {
  const root = tiny(t), source = join(root, 'source'), destination = join(root, 'copy'), reviewed = sourceFixture(source);
  const result = harness.copySources(source, destination, reviewed);
  assert.equal(result.changedFiles, 1); assert.equal(result.release, harness.sha256(harness.enableRelease(releaseBytes)));
  assert.deepEqual(readFileSync(join(source, harness.RELEASE_PATH)), releaseBytes);
  assert.deepEqual(readFileSync(join(destination, 'scripts/synthetic.mjs')), readFileSync(join(source, 'scripts/synthetic.mjs')));
  for (const row of reviewed.files) {
    assert.equal(statSync(join(destination, row.path)).mode & 0o777, row.mode & 0o777);
    assert.notEqual(statSync(join(destination, row.path)).ino, statSync(join(source, row.path)).ino);
  }
  assert.deepEqual(harness.verifyCopiedSources(destination, reviewed), result);
});
test('source copy refuses stale reviewed bytes and later source/release/mode drift', t => {
  const root = tiny(t), source = join(root, 'source'), destination = join(root, 'copy'), reviewed = sourceFixture(source);
  harness.copySources(source, destination, reviewed);
  put(destination, 'scripts/synthetic.mjs', 'mutated', 0o755); refused(() => harness.verifyCopiedSources(destination, reviewed), 'source_changed');
  put(destination, 'scripts/synthetic.mjs', '#!/usr/bin/env node\n', 0o755);
  put(destination, harness.RELEASE_PATH, releaseBytes); refused(() => harness.verifyCopiedSources(destination, reviewed), 'source_changed');
  put(destination, harness.RELEASE_PATH, harness.enableRelease(releaseBytes)); chmodSync(join(destination, 'scripts/synthetic.mjs'), 0o644);
  refused(() => harness.verifyCopiedSources(destination, reviewed), 'source_changed');
  put(source, 'scripts/synthetic.mjs', 'changed', 0o755); refused(() => harness.copySources(source, join(root, 'second-copy'), reviewed), 'source_changed');
});

// Closed child environment and the absolute first-step deadline.
test('closed application environment carries only fixed public loopback settings and clean process state', () => {
  const owner = { directory: '/synthetic/runner/yeoni-b2-abc', nonce };
  const secrets = { ...env, GITHUB_TOKEN: 'secret-actions', ACTIONS_RUNTIME_TOKEN: 'secret-runtime', OPENAI_API_KEY: 'secret-provider', SUPABASE_SERVICE_ROLE_KEY: 'secret-service', DATABASE_URL: 'secret-db', NODE_OPTIONS: 'secret-loader', HTTP_PROXY: 'secret-proxy', B2_PHASE: 'enabled', B2_PROCESS_TAG: nonce, PATH: 'untrusted-path', HOME: 'untrusted-home', AUTH_STORAGE_STATE: 'untrusted-state' };
  const actual = harness.closedApplicationEnvironment(secrets, owner, { API_URL: API, ANON_KEY: 'synthetic-anon', SERVICE_ROLE_KEY: 'secret-service' });
  assert.deepEqual(Object.keys(actual).sort(), ['B2_PROCESS_TAG', 'CI', 'HOME', 'LANG', 'LC_ALL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_TELEMETRY_DISABLED', 'PATH', 'TMPDIR', 'YEONI_E2E'].sort());
  assert.equal(actual.HOME, join(owner.directory, 'home')); assert.equal(actual.TMPDIR, join(owner.directory, 'tmp')); assert.equal(actual.PATH, `${dirname(process.execPath)}:/usr/bin:/bin`);
  assert.equal(actual.NEXT_PUBLIC_SUPABASE_URL, API); assert.equal(actual.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'synthetic-anon'); assert.equal(actual.YEONI_E2E, '1');
  assert.equal(actual.B2_PROCESS_TAG, nonce);
  assert.doesNotMatch(JSON.stringify(actual), /secret-|untrusted-|B2_PHASE/);
  assert.equal(harness.closedApplicationEnvironment(secrets, owner, { API_URL: API, ANON_KEY: 'synthetic-anon' }, true).QA_HTTP_OBSERVER, '1');
});
test('closed application environment refuses hosted/mismatched/missing public stack credentials', () => {
  const owner = { directory: '/synthetic/runner/yeoni-b2-abc', nonce };
  for (const status of [{ API_URL: 'https://example.supabase.co', ANON_KEY: 'synthetic-anon' }, { API_URL: API, ANON_KEY: 'other' }, { API_URL: API, ANON_KEY: '' }]) refused(() => harness.closedApplicationEnvironment(env, owner, status), 'environment_override');
  refused(() => harness.closedApplicationEnvironment({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' }, owner, { API_URL: API, ANON_KEY: 'synthetic-anon' }), 'environment_override');
});
test('runner budget anchors a fixed 75-minute deadline and reserves 15 minutes including stack-stop', () => {
  const budget = harness.validateBudget(env, START + 45 * 60_000);
  assert.deepEqual(budget, { start: START, deadline: START + 75 * 60_000, stop: START + 60 * 60_000 });
  assert.equal(harness.LIMITS.reserveMs, harness.LIMITS.cleanupMs + 600_000);
  assert.equal(harness.LIMITS.freeBytes, 6 * 1024 ** 3); assert.equal(harness.LIMITS.ownedBytes, 4 * 1024 ** 3);
  for (const patch of [{ B2_JOB_STARTED_MS: '0' }, { B2_JOB_STARTED_MS: 'NaN' }, { B2_JOB_DEADLINE_MS: String(START + 76 * 60_000) }, { B2_STOP_AT_MS: String(START + 65 * 60_000) }]) refused(() => harness.validateBudget({ ...env, ...patch }, START), 'deadline_invalid');
  refused(() => harness.validateBudget(env, START - 1), 'deadline_invalid'); refused(() => harness.validateBudget(env, budget.deadline + 1), 'deadline_invalid');
  assert.deepEqual(harness.validateBudget(env, budget.deadline + 1, true), budget, 'late cleanup must retain the original identity/deadline rather than start a new allowance');
});
test('runner preflight rejects local execution, mutable commit targets and dangerous runner overrides', () => {
  assert.deepEqual(harness.validateRunner(env, env.GITHUB_WORKSPACE, START), harness.validateBudget(env, START));
  for (const patch of [{ CI: 'false' }, { GITHUB_ACTIONS: 'false' }, { QA_HEAD_SHA: 'main' }, { GITHUB_RUN_ID: '123/other' }, { GITHUB_RUN_ATTEMPT: '' }, { GITHUB_JOB: 'other job' }, { GITHUB_WORKSPACE: '/other' }, { RUNNER_TEMP: 'relative' }]) refused(() => harness.validateRunner({ ...env, ...patch }, env.GITHUB_WORKSPACE, START), 'runner_required');
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'VERCEL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'DATABASE_URL', 'SUPABASE_DB_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'ELEVENLABS_API_KEY', 'AZURE_OPENAI_API_KEY']) refused(() => harness.validateRunner({ ...env, [key]: 'untrusted' }, env.GITHUB_WORKSPACE, START), 'environment_override');
  for (const patch of [{ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }, { QA_SOUP_VARIANT: 'system' }, { QA_SOUP_LIBRARY: '/system/libsoup.so' }]) refused(() => harness.validateRunner({ ...env, ...patch }, env.GITHUB_WORKSPACE, START), 'environment_override');
});

// Privacy projection never returns exception or browser payload strings.
test('fixed failure sanitizer ignores unknown strings, accessors, prototypes and hostile proxies', () => {
  let reads = 0;
  const getter = Object.defineProperty({}, 'code', { get() { reads++; throw new Error('secret-getter'); } });
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw new Error('secret-proxy'); } });
  for (const value of [null, undefined, 1, 'secret-token', new Error('secret-error'), { code: 'secret-code' }, Object.create({ code: 'build_failed' }), getter, proxy]) assert.equal(harness.safeFailure(value), 'harness_failed');
  assert.equal(reads, 0);
  assert.equal(harness.safeFailure({ code: 'build_failed', message: 'secret-message', stack: 'secret-stack' }), 'build_failed');
});
const diagnosticPrefix = '[legacy-evidence-b2] ';
const diagnosticCodes = ['runner_required', 'deadline_invalid', 'budget_exhausted', 'environment_override', 'source_identity',
  'inventory_invalid', 'source_path', 'source_changed', 'release_changed', 'dependency_invalid', 'resource_limit',
  'ownership_invalid', 'process_identity', 'process_limit', 'cleanup_failed', 'port_occupied', 'discovery_invalid',
  'report_invalid', 'sql_failed', 'build_failed', 'browser_failed', 'interrupted', 'stack_cleanup_failed', 'harness_failed'];
const diagnosticStages = ['harness', 'run-bootstrap', 'serve-bootstrap', 'cleanup-bootstrap', 'finalize-bootstrap',
  'runner-preflight', 'checkout-preflight', 'owned-directory', 'owned-state', 'stack-before', 'sql-gate', 'sql-result', 'stack-after',
  'source-copy', 'dependencies-main', 'dependencies-browser-qa', 'copy-result',
  ...['inactive', 'enabled'].flatMap(phase => ['build', 'build-reap', 'build-identity', 'discovery', 'browser', 'browser-result', 'phase-reap', 'source-check'].map(stage => `${phase}-${stage}`)),
  'run-cleanup-processes', 'run-cleanup-source', 'run-cleanup-build', 'cleanup-processes', 'cleanup-source', 'cleanup-build', 'cleanup-copy', 'finalize-stack', 'finalize-result'];
function diagnosticRecord(stage: unknown, status: unknown, error?: unknown) {
  const line = harness.diagnosticLine(stage, status, error);
  assert.equal(typeof line, 'string'); assert.equal(line.startsWith(diagnosticPrefix), true);
  assert.doesNotMatch(line, /[\r\n\x1b]/, 'Diagnostics must remain one fixed-prefix line without terminal escapes');
  const record = JSON.parse(line.slice(diagnosticPrefix.length));
  assert.deepEqual(Object.keys(record).sort(), record.status === 'failed' ? ['code', 'stage', 'status'] : ['stage', 'status']);
  assert.ok(diagnosticStages.includes(record.stage)); assert.ok(['passed', 'failed', 'unverified'].includes(record.status));
  if (record.status === 'failed') assert.ok(diagnosticCodes.includes(record.code));
  return record;
}
test('diagnostic projection admits only the fixed lifecycle vocabulary and omits codes on nonfailures', () => {
  for (const stage of diagnosticStages) for (const status of ['passed', 'failed', 'unverified']) {
    assert.deepEqual(diagnosticRecord(stage, status, { code: 'source_changed', secret: 'SENTINEL_SECRET' }),
      { stage, status, ...(status === 'failed' ? { code: 'source_changed' } : {}) });
  }
  for (const stage of ['', 'INACTIVE-BUILD', 'inactive-build\n', 'enabled', 'cleanup', 'arbitrary-stage']) {
    assert.deepEqual(diagnosticRecord(stage, 'passed'), { stage: 'harness', status: 'passed' });
  }
  for (const status of ['', 'PASSED', 'passed\n', 'awaiting-cleanup', 'unrun', 'skipped']) {
    assert.deepEqual(diagnosticRecord('harness', status, { code: 'build_failed' }), { stage: 'harness', status: 'failed', code: 'build_failed' });
  }
  const error = Object.defineProperty({}, 'code', { get() { assert.fail('Successful and unverified diagnostics must not inspect error details'); } });
  for (const status of ['passed', 'unverified']) assert.deepEqual(diagnosticRecord('harness', status, error), { stage: 'harness', status });
});
test('diagnostic projection never coerces hostile stage/status/error objects or invokes their accessors', () => {
  let reads = 0;
  const poisoned = () => { reads++; throw new Error('SENTINEL_SECRET_ACCESSOR'); };
  const object = Object.defineProperties({}, {
    code: { get: poisoned }, toJSON: { get: poisoned }, message: { get: poisoned }, stack: { get: poisoned },
    toString: { value: poisoned }, valueOf: { value: poisoned }, [Symbol.toPrimitive]: { value: poisoned },
  });
  const proxy = new Proxy({}, { get: poisoned, getOwnPropertyDescriptor: poisoned, getPrototypeOf: poisoned, ownKeys: poisoned, has: poisoned });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [null, undefined, 1, true, BigInt(1), Symbol('SENTINEL_SECRET_SYMBOL'), 'SENTINEL_SECRET\n[legacy-evidence-b2] {"status":"passed"}\u001b[31m', object, proxy, revoked.proxy, Object.create({ code: 'build_failed' })]) {
    assert.deepEqual(diagnosticRecord(value, value, value), { stage: 'harness', status: 'failed', code: 'harness_failed' });
  }
  assert.equal(reads, 0);
});
test('diagnostic projection copies only a reviewed own failure code and no error context', () => {
  let reads = 0;
  for (const code of diagnosticCodes) {
    const error = Object.assign(new Error('SENTINEL_SECRET_MESSAGE'), {
      code, stack: 'SENTINEL_SECRET_STACK', output: 'SENTINEL_SECRET_OUTPUT', path: '/SENTINEL_SECRET_PATH',
      env: { TOKEN: 'SENTINEL_SECRET_TOKEN' }, nonce: 'SENTINEL_SECRET_NONCE', attachments: ['SENTINEL_SECRET_ATTACHMENT'],
    });
    Object.defineProperty(error, 'toJSON', { get() { reads++; throw new Error('SENTINEL_SECRET_JSON'); } });
    assert.deepEqual(diagnosticRecord('harness', 'failed', error), { stage: 'harness', status: 'failed', code });
    assert.doesNotMatch(harness.diagnosticLine('harness', 'failed', error), /SENTINEL_SECRET|"(?:message|stack|output|path|env|nonce|attachments)"/);
  }
  for (const code of ['SENTINEL_SECRET_CODE', 'BUILD_FAILED', 'build_failed\n', { toString: () => 'build_failed' }]) {
    assert.deepEqual(diagnosticRecord('harness', 'failed', { code }), { stage: 'harness', status: 'failed', code: 'harness_failed' });
  }
  assert.equal(reads, 0);
});
test('all console diagnostics cross one closed projection and CLI failures use a bounded bootstrap stage', () => {
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(runnerAst) === 'console') calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(runnerAst); assert.deepEqual(calls.map(call => call.getText(runnerAst)), ['console.error(diagnosticLine(stage, status, error))', 'console.error(line)']);
  assert.match(functionSource('detailSink'), /console\.error\(line\)/);
  assert.match(functionSource('emitDetailRecords'), /sink\(DETAIL_PREFIX \+ JSON\.stringify\(record\)\)/);
  assert.match(runnerSource, /main\(\)\.catch\(error=>\{emitDiagnostic\(`\$\{process\.argv\[2\]\}-bootstrap`,'failed',error\);process\.exitCode=1;/);
});
test('run failure stages are assigned before the original boundary and preserved before cleanup starts', () => {
  const source = functionSource('run');
  ordered(source, ["let stage = 'runner-preflight'", 'validateRunner(process.env,ROOT)', "stage = 'checkout-preflight'", 'identity = verifyCheckout()',
    "stage = 'owned-directory'", 'owner = createOwner(', "stage = 'owned-state'", "stage = 'stack-before'", 'await stackIdentity()',
    "stage = 'sql-gate'", "runFixed(owner,'sql'", "stage = 'sql-result'", 'freshReport(sqlPath,sqlStarted)', "stage = 'stack-after'",
    "stage = 'source-copy'", 'copySources(ROOT,app', "stage = 'dependencies-main'", "join(ROOT,'node_modules')",
    "stage = 'dependencies-browser-qa'", "join(ROOT,'scripts/browser-qa/node_modules')", "stage = 'copy-result'",
    'stage = `${phase}-build`', 'runFixed(owner,`${phase}-build`', 'stage = `${phase}-build-reap`', 'await reap(owner)',
    'stage = `${phase}-build-identity`', 'buildIdentity(cwd)', 'stage = `${phase}-discovery`', "runFixed(owner,'discovery'",
    'stage = `${phase}-browser`', "runFixed(owner,'browser'", "emitDiagnostic(stage,'failed',error)", 'executionFailure=error',
    'stage = `${phase}-browser-result`', 'const readinessPath=', 'stage = `${phase}-phase-reap`', 'await reap(owner)',
    'stage = `${phase}-browser`', 'if(executionFailure)throw executionFailure', 'stage = `${phase}-source-check`',
    "} catch(error) { emitDiagnostic(stage,'failed',error)", 'finally {', "emitDiagnostic('run-cleanup-processes'", "emitDiagnostic('run-cleanup-source'", "emitDiagnostic('run-cleanup-build'"]);
});
function discovery(phase: string) {
  const expected = harness.expectedCases(phase);
  return { suites: ['auth.spec.ts', 'legacy-evidence-review.spec.ts'].map(file => ({
    file, title: file, specs: [...new Set(expected.filter(row => row.file === file).map(row => row.title))].map(title => ({
      file, title, tests: expected.filter(row => row.file === file && row.title === title).map(row => ({ projectName: row.project, repeatEachIndex: 0, results: [] })),
    })),
  })), errors: [] };
}
function execution(phase: string) {
  return { commit, status: 'passed', results: harness.expectedCases(phase).map(row => ({ title: `${row.project} / ${row.file} / ${row.title}`, status: 'passed', durationMs: 1.4 })) };
}
test('discovery is exactly 8 inactive and 28 enabled including all four unchanged auth cases', () => {
  for (const [phase, count] of [['inactive', 8], ['enabled', 28]] as const) {
    const expected = harness.expectedCases(phase); assert.equal(expected.length, count);
    assert.equal(expected.filter(row => row.project === 'auth-preservation').length, 4);
    assert.deepEqual(harness.projectDiscovery(discovery(phase), phase), expected);
    assert.equal(expected.filter(row => row.project === 'chromium').length, phase === 'inactive' ? 2 : 12);
    assert.equal(expected.filter(row => row.project === 'webkit-small').length, phase === 'inactive' ? 2 : 12);
  }
  refused(() => harness.expectedCases('arbitrary'), 'discovery_invalid');
});
test('discovery refuses missing engines/cases, duplicate cases, extra files/projects and repeated/executed tests', () => {
  const mutate = (fn: (report: ReturnType<typeof discovery>) => void) => { const report = discovery('inactive'); fn(report); refused(() => harness.projectDiscovery(report, 'inactive'), 'discovery_invalid'); };
  mutate(report => { report.suites[0].specs.pop(); });
  mutate(report => { const specs = report.suites[0].specs; specs.push(specs[0]); });
  mutate(report => { report.suites[0].specs[0].file = 'tests/e2e/other.spec.ts'; });
  mutate(report => { report.suites[0].specs[0].tests[0].projectName = 'unreviewed'; });
  mutate(report => { report.suites[0].specs[0].title = 'unknown secret title'; });
  mutate(report => { report.suites[0].specs[0].tests[0].repeatEachIndex = 1; });
  const executed = discovery('inactive'); Object.assign(executed.suites[0].specs[0].tests[0], { results: [{}] }); refused(() => harness.projectDiscovery(executed, 'inactive'), 'discovery_invalid');
  refused(() => harness.projectDiscovery({ ...discovery('inactive'), errors: [{ message: 'secret' }] }, 'inactive'), 'discovery_invalid');
  refused(() => harness.projectDiscovery(discovery('inactive'), 'enabled'), 'discovery_invalid');
});
test('execution projection requires current commit and exact titles and strips all unreviewed diagnostics', () => {
  const raw = execution('enabled'); Object.assign(raw, { stack: 'secret-stack' }); Object.assign(raw.results[0], { failure: { response: 'secret-response' }, attachments: [{ path: 'secret-path' }] });
  const result = harness.projectExecution(raw, 'enabled', commit);
  assert.equal(result.status, 'passed'); assert.equal(result.executed, 28); assert.equal(result.discovered, 28); assert.equal(result.cases[0].durationMs, 1);
  assert.doesNotMatch(JSON.stringify(result), /secret|failure|attachments/);
  const leading = execution('inactive'); leading.results.forEach(row => { row.title = ` / ${row.title}`; }); assert.equal(harness.projectExecution(leading, 'inactive', commit).status, 'passed');
  refused(() => harness.projectExecution({ ...raw, commit: 'd'.repeat(40) }, 'enabled', commit), 'report_invalid');
});
test('missing, skipped, failed or interrupted execution cannot be credited as passed', () => {
  const partial = execution('enabled'); partial.results.pop(); const result = harness.projectExecution(partial, 'enabled', commit);
  assert.equal(result.status, 'failed'); assert.equal(result.executed, 27); assert.equal(result.cases.at(-1)?.status, 'unrun');
  for (const status of ['skipped', 'failed', 'timedOut', 'interrupted']) {
    const raw = execution('inactive'); raw.results[0].status = status;
    const projected = harness.projectExecution(raw, 'inactive', commit); assert.equal(projected.status, 'failed'); assert.equal(projected.cases[0].status, status === 'skipped' ? 'unrun' : status);
  }
  assert.equal(harness.projectExecution({ commit, status: 'failed', results: [] }, 'inactive', commit).cases.filter(row => row.status === 'unrun').length, 8);
});
test('execution refuses duplicate, unknown and out-of-phase reports or unsafe durations', () => {
  for (const patch of [{ title: 'unreviewed/secret' }, { status: 'unknown' }, { durationMs: NaN }, { durationMs: Infinity }, { durationMs: -1 }]) {
    const raw = execution('inactive'); Object.assign(raw.results[0], patch); refused(() => harness.projectExecution(raw, 'inactive', commit), 'report_invalid');
  }
  const duplicate = execution('inactive'); duplicate.results[1] = duplicate.results[0]; refused(() => harness.projectExecution(duplicate, 'inactive', commit), 'report_invalid');
  refused(() => harness.projectExecution(execution('enabled'), 'inactive', commit), 'report_invalid');
});
test('fresh execution report reads only new regular bounded files and rejects stale/symlink summaries', t => {
  const root = tiny(t), path = put(root, 'results.json', JSON.stringify(execution('inactive'))), started = Date.now();
  const fresh = privateFunction('freshReport', { lstatSync, refuse, json: (file: string) => JSON.parse(readFileSync(file, 'utf8')) });
  assert.equal(fresh(path, started).commit, commit);
  utimesSync(path, new Date(started - 10_000), new Date(started - 10_000)); refused(() => fresh(path, started), 'report_invalid');
  const link = join(root, 'linked.json'); symlinkSync(path, link); refused(() => fresh(link, started), 'report_invalid');
  refused(() => fresh(root, started), 'report_invalid');
  const oversized = privateFunction('freshReport', { lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false, mtimeMs: started, size: 2 * 1024 ** 2 + 1 }), refuse, json: () => assert.fail('oversize report was parsed') });
  refused(() => oversized(path, started), 'report_invalid');
  const run = functionSource('run'); assert.ok(run.indexOf('retireReport(summary)') < run.indexOf("runFixed(owner,'browser'")); assert.match(run, /freshReport\(summary,start,reportState\)/);
});

// Dependencies are copied, never installed, hardlinked or linked out.
function dependencyFixture(root: string) {
  const source = join(root, 'node_modules'); put(source, 'tiny/package.json', JSON.stringify({ name: 'tiny', version: '1.2.3' })); put(source, 'tiny/bin.mjs', '#!/usr/bin/env node\n', 0o755);
  mkdirSync(join(source, '.bin')); symlinkSync(join(source, 'tiny/bin.mjs'), join(source, '.bin/tiny'));
  return { source, lock: { packages: { 'node_modules/tiny': { version: '1.2.3' } } } };
}
function dependencyCopier(overrides: Record<string, unknown> = {}) {
  return privateFunction('copyDependencyTree', {
    ...Object.fromEntries(Object.entries(filesystem).filter(([name]) => name !== 'default')),
    ...Object.fromEntries(Object.entries(paths).filter(([name]) => name !== 'default')),
    LIMITS: harness.LIMITS, DEPENDENCY_FIXTURE_EXCLUSIONS: harness.DEPENDENCY_FIXTURE_EXCLUSIONS,
    dependencyFixtureExclusion: harness.dependencyFixtureExclusion, regularPath: harness.regularPath,
    sha256: harness.sha256, validateRelativePath: harness.validateRelativePath, refuse,
    inside: (parent: string, child: string) => child === parent || child.startsWith(parent + paths.sep),
    dependencyExcluded: () => false, json: (file: string) => JSON.parse(readFileSync(file, 'utf8')), ...overrides,
  });
}
const bundledResolveRoots = [
  ['resolve', '2.0.0-next.6'],
  ['postcss-import/node_modules/resolve', '1.22.12'],
  ['tailwindcss/node_modules/resolve', '1.22.12'],
] as const;
const bundledResolveSuffixes = ['test/resolver/symlinked/_/node_modules', 'test/shadowed_core/node_modules'] as const;
function bundledResolveFixture(root: string) {
  const { source, lock } = dependencyFixture(root);
  const packages: Record<string, { version: string }> = { ...lock.packages };
  for (const name of ['postcss-import', 'tailwindcss']) {
    put(source, `${name}/package.json`, JSON.stringify({ name, version: '1.0.0' })); packages[`node_modules/${name}`] = { version: '1.0.0' };
  }
  for (const [path, version] of bundledResolveRoots) {
    put(source, `${path}/package.json`, JSON.stringify({ name: 'resolve', version })); packages[`node_modules/${path}`] = { version };
    put(source, `${path}/index.js`, 'module.exports = {};\n'); put(source, `${path}/test/retained.js`, '// retain ordinary package test bytes\n');
    for (const suffix of bundledResolveSuffixes) put(source, `${path}/${suffix}/unreviewed/package.json`, JSON.stringify({ name: 'bundled-fixture', version: '0.0.0' }));
  }
  return { source, lock: { packages } };
}
function forwardLinkFixture(root: string, mismatch = false) {
  const source = join(root, 'node_modules'), destination = join(root, 'owned/node_modules');
  put(source, 'a-first/package.json', JSON.stringify({ name: 'a-first', version: mismatch ? '2.0.0' : '1.0.0' }));
  put(source, 'z-tool/package.json', JSON.stringify({ name: 'z-tool', version: '1.0.0' })); put(source, 'z-tool/cli.js', '// synthetic executable\n', 0o755);
  mkdirSync(join(source, '.bin')); symlinkSync('../z-tool/cli.js', join(source, '.bin/a-tool')); symlinkSync('a-tool', join(source, '.bin/z-tool'));
  return { source, destination, lock: { packages: { 'node_modules/a-first': { version: '1.0.0' }, 'node_modules/z-tool': { version: '1.0.0' } } } };
}
function assertUnpublishedLinks(destination: string) {
  for (const name of ['a-tool', 'z-tool']) assert.throws(() => lstatSync(join(destination, '.bin', name)), { code: 'ENOENT' }, 'A missing target must not leave even a dangling link inode');
}
test('dependency copy relocates internal absolute package links and preserves bytes without writable inode sharing', t => {
  const root = tiny(t), { source, lock } = dependencyFixture(root), destination = join(root, 'private/node_modules');
  const result = harness.copyDependencyTree(source, destination, lock);
  assert.equal(readlinkSync(join(destination, '.bin/tiny')), '../tiny/bin.mjs'); assert.equal(realpathSync(join(destination, '.bin/tiny')), join(destination, 'tiny/bin.mjs'));
  assert.deepEqual(readFileSync(join(destination, 'tiny/bin.mjs')), readFileSync(join(source, 'tiny/bin.mjs')));
  assert.notEqual(statSync(join(destination, 'tiny/bin.mjs')).ino, statSync(join(source, 'tiny/bin.mjs')).ino);
  assert.equal(statSync(join(destination, 'tiny/bin.mjs')).mode & 0o777, 0o755); assert.equal(result.files, 3);
  assert.deepEqual(result.installedVersions, [{ path: 'node_modules/tiny', version: '1.2.3' }]); assert.deepEqual(result.excludedFixtures, []); assert.match(result.digest, /^[a-f0-9]{64}$/);
  put(destination, 'tiny/bin.mjs', 'private mutation'); assert.equal(readFileSync(join(source, 'tiny/bin.mjs'), 'utf8'), '#!/usr/bin/env node\n');
});
test('dependency inventories deterministically exclude caches and credential artifacts', t => {
  const root = tiny(t), { source, lock } = dependencyFixture(root);
  for (const path of ['tiny/.env', 'tiny/.env.local', 'tiny/private.pem', 'tiny/private.key', 'tiny/.cache/data', '.cache/root', 'tiny/out.log', 'tiny/a.tsbuildinfo']) put(source, path, 'secret');
  const first = harness.copyDependencyTree(source, join(root, 'one'), lock), second = harness.copyDependencyTree(source, join(root, 'two'), lock);
  assert.deepEqual(first, second); assert.equal(first.files, 3); assert.equal(existsSync(join(root, 'one/tiny/.env')), false); assert.doesNotMatch(JSON.stringify(first), /secret|\.env|private/);
});
test('dependency copy refuses unreviewed packages and package-lock version drift', t => {
  const root = tiny(t), { source, lock } = dependencyFixture(root);
  put(source, 'unknown/package.json', '{}'); refused(() => harness.copyDependencyTree(source, join(root, 'copy-unknown'), lock), 'dependency_invalid'); rmSync(join(source, 'unknown'), { recursive: true });
  put(source, 'tiny/package.json', JSON.stringify({ version: '2.0.0' })); refused(() => harness.copyDependencyTree(source, join(root, 'copy-version'), lock), 'dependency_invalid');
});
test('dependency links refuse checkout escapes and excluded credential/cache targets', t => {
  const root = tiny(t), { source, lock } = dependencyFixture(root); put(root, 'outside', 'secret');
  symlinkSync('../../outside', join(source, 'tiny/escape')); refused(() => harness.copyDependencyTree(source, join(root, 'copy-escape'), lock), 'dependency_invalid'); rmSync(join(source, 'tiny/escape'));
  put(source, 'tiny/.env', 'secret'); symlinkSync('.env', join(source, 'tiny/credential')); refused(() => harness.copyDependencyTree(source, join(root, 'copy-credential'), lock), 'dependency_invalid');
});

test('bundled fixture policy is immutable and matches only six exact roots or their descendants', () => {
  const expected = bundledResolveRoots.flatMap(([packageRoot, version]) => bundledResolveSuffixes.map(suffix => ({ packageRoot, version, path: `${packageRoot}/${suffix}` })));
  assert.deepEqual(harness.DEPENDENCY_FIXTURE_EXCLUSIONS, expected); assert.equal(Object.isFrozen(harness.DEPENDENCY_FIXTURE_EXCLUSIONS), true);
  for (const row of expected) {
    assert.equal(Object.isFrozen(harness.dependencyFixtureExclusion(row.path)), true);
    assert.deepEqual(harness.dependencyFixtureExclusion(row.path), row); assert.deepEqual(harness.dependencyFixtureExclusion(`${row.path}/child/file.js`), row);
    for (const near of [row.packageRoot, row.path.slice(0, -1), `${row.path}-other`, `other/${row.path}`, row.path.replace('/test/', '/tests/')]) assert.equal(harness.dependencyFixtureExclusion(near), undefined, near);
  }
});
test('dependency copy omits exactly the six version-pinned bundled resolve fixture trees', t => {
  const root = tiny(t), { source, lock } = bundledResolveFixture(root), destination = join(root, 'copy');
  const first = harness.copyDependencyTree(source, destination, lock);
  for (const [path] of bundledResolveRoots) {
    for (const suffix of bundledResolveSuffixes) assert.equal(existsSync(join(destination, path, suffix)), false, `${path}/${suffix}`);
    for (const retained of ['package.json', 'index.js', 'test/retained.js']) assert.deepEqual(readFileSync(join(destination, path, retained)), readFileSync(join(source, path, retained)));
  }
  assert.deepEqual(first.installedVersions.map(row => row.path).sort(), Object.keys(lock.packages).sort());
  assert.equal(first.files, 14); assert.equal(harness.ownedUsage(destination, false), first.bytes);
  const expectedExclusions = bundledResolveRoots.flatMap(([path, version]) => bundledResolveSuffixes.map(suffix => ({ path: `${path}/${suffix}`, version }))).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual([...first.excludedFixtures].sort((a, b) => a.path.localeCompare(b.path)), expectedExclusions);
  for (const [path] of bundledResolveRoots) for (const suffix of bundledResolveSuffixes) put(source, `${path}/${suffix}/unreviewed/package.json`, 'changed excluded fixture bytes');
  assert.deepEqual(harness.copyDependencyTree(source, join(root, 'copy-again'), lock), first, 'Excluded fixture bytes must not affect the copied dependency inventory');
  const removedPath = `${bundledResolveRoots[0][0]}/${bundledResolveSuffixes[0]}`; rmSync(join(source, removedPath), { recursive: true });
  const partial = harness.copyDependencyTree(source, join(root, 'copy-fewer-fixtures'), lock);
  assert.deepEqual(partial, { ...first, excludedFixtures: first.excludedFixtures.filter(row => row.path !== removedPath) }, 'The reported omissions must reflect only fixed directories actually present');
});
test('bundled resolve fixture omission remains gated by each installed and lockfile version', t => {
  const root = tiny(t); let index = 0;
  for (const [packagePath] of bundledResolveRoots) for (const mutation of ['installed', 'lock', 'both']) {
    const fixture = bundledResolveFixture(join(root, String(index++)));
    if (mutation !== 'lock') put(fixture.source, `${packagePath}/package.json`, JSON.stringify({ name: 'resolve', version: '9.9.9' }));
    if (mutation !== 'installed') fixture.lock.packages[`node_modules/${packagePath}`].version = '9.9.9';
    refused(() => harness.copyDependencyTree(fixture.source, join(root, `refused-${index}`), fixture.lock), 'dependency_invalid');
  }
});
test('bundled fixture omission refuses renamed resolve metadata and linked package manifests', t => {
  const root = tiny(t); let index = 0;
  for (const [packagePath, version] of bundledResolveRoots) {
    const renamed = bundledResolveFixture(join(root, String(index++)));
    put(renamed.source, `${packagePath}/package.json`, JSON.stringify({ name: 'other-package', version }));
    refused(() => harness.copyDependencyTree(renamed.source, join(root, `refused-name-${index}`), renamed.lock), 'dependency_invalid');
    const linked = bundledResolveFixture(join(root, String(index++))), packageFile = join(linked.source, packagePath, 'package.json');
    put(linked.source, `${packagePath}/manifest.json`, JSON.stringify({ name: 'resolve', version })); rmSync(packageFile); symlinkSync('manifest.json', packageFile);
    refused(() => harness.copyDependencyTree(linked.source, join(root, `refused-manifest-${index}`), linked.lock), 'source_path');
  }
});
test('bundled fixture omission refuses regular files and simulated device entries at each fixed root', t => {
  const root = tiny(t); let index = 0;
  for (const [packagePath] of bundledResolveRoots) for (const suffix of bundledResolveSuffixes) {
    const { source, lock } = bundledResolveFixture(join(root, String(index))), omitted = join(source, packagePath, suffix);
    const copy = dependencyCopier({ lstatSync: (path: string) => path === omitted ? { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false } : lstatSync(path) });
    refused(() => copy(source, join(root, `refused-device-${index}`), lock), 'dependency_invalid');
    rmSync(omitted, { recursive: true }); put(source, `${packagePath}/${suffix}`, 'ordinary file cannot impersonate an omitted directory');
    refused(() => harness.copyDependencyTree(source, join(root, `refused-file-${index++}`), lock), 'dependency_invalid');
  }
  const { source, lock } = dependencyFixture(join(root, 'ordinary-device'));
  const copy = dependencyCopier({ lstatSync: (path: string) => path === join(source, 'tiny/bin.mjs') ? { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false } : lstatSync(path) });
  refused(() => copy(source, join(root, 'refused-ordinary-device'), lock), 'dependency_invalid');
});
test('bundled fixture omission does not admit other packages, unreviewed roots or nearby paths', t => {
  const root = tiny(t);
  const unreviewedPaths = [
    'unknown/package.json', 'resolve/node_modules/unknown/package.json',
    'resolve/test/resolver/other/node_modules/unknown/package.json',
    'resolve/test/shadowed_core/other/node_modules/unknown/package.json',
    'resolve/tests/shadowed_core/node_modules/unknown/package.json',
    'postcss-import/test/shadowed_core/node_modules/unknown/package.json',
    'tailwindcss/test/resolver/symlinked/_/node_modules/unknown/package.json',
    'tiny/test/shadowed_core/node_modules/unknown/package.json',
  ];
  for (const [index, path] of unreviewedPaths.entries()) {
    const { source, lock } = bundledResolveFixture(join(root, String(index))); put(source, path, JSON.stringify({ name: 'unknown', version: '1.0.0' }));
    refused(() => harness.copyDependencyTree(source, join(root, `refused-${index}`), lock), 'dependency_invalid');
  }
  const { source, lock } = dependencyFixture(join(root, 'other-resolve-root'));
  put(source, 'tiny/node_modules/resolve/package.json', JSON.stringify({ name: 'resolve', version: '1.22.12' }));
  put(source, 'tiny/node_modules/resolve/test/shadowed_core/node_modules/unknown/package.json', '{}');
  const reviewed = { packages: { ...lock.packages, 'node_modules/tiny/node_modules/resolve': { version: '1.22.12' } } };
  refused(() => harness.copyDependencyTree(source, join(root, 'refused-other-resolve-root'), reviewed), 'dependency_invalid');
});
test('bundled fixture omission refuses symlink roots and links into omitted or credential trees', t => {
  const root = tiny(t); let index = 0;
  for (const [packagePath] of bundledResolveRoots) for (const suffix of bundledResolveSuffixes) {
    const { source, lock } = bundledResolveFixture(join(root, String(index))), omitted = join(source, packagePath, suffix);
    rmSync(omitted, { recursive: true }); symlinkSync(join(source, 'tiny'), omitted);
    refused(() => harness.copyDependencyTree(source, join(root, `refused-root-${index++}`), lock), 'dependency_invalid');
  }
  for (const target of ['resolve/test/shadowed_core/node_modules/unreviewed/package.json', 'tiny/.env', 'tiny/.cache/payload']) {
    const { source, lock } = bundledResolveFixture(join(root, String(index)));
    if (!existsSync(join(source, target))) put(source, target, 'excluded bytes');
    symlinkSync(join(source, target), join(source, 'tiny/linked'));
    refused(() => harness.copyDependencyTree(source, join(root, `refused-target-${index++}`), lock), 'dependency_invalid');
  }
});
test('version, budget, signal and byte-cap refusals leave forward-link copies strictly inspectable', t => {
  const root = tiny(t);
  for (const failure of ['version', 'budget_exhausted', 'interrupted', 'resource_limit']) {
    const { source, destination, lock } = forwardLinkFixture(join(root, failure), failure === 'version'); let checkpoints = 0;
    const checkpoint = () => {
      checkpoints++;
      if (['budget_exhausted', 'interrupted'].includes(failure) && existsSync(join(destination, 'a-first/package.json'))) refuse(failure);
    };
    refused(() => harness.copyDependencyTree(source, destination, lock, { checkpoint, ...(failure === 'resource_limit' ? { maxBytes: 1 } : {}) }), failure === 'version' ? 'dependency_invalid' : failure);
    assert.ok(checkpoints >= 3); assertUnpublishedLinks(destination);
    assert.doesNotThrow(() => harness.ownedUsage(join(destination, '..'), false), `${failure} must preserve strict cleanup traversal`);
    if (failure !== 'resource_limit') assert.equal(existsSync(join(destination, 'a-first/package.json')), true, 'The refusal must exercise a partially copied tree');
    assert.equal(existsSync(join(destination, 'z-tool/cli.js')), false);
  }
});
test('link publication checkpoints interrupt before the first or a later link without dangling links', t => {
  const root = tiny(t);
  for (const afterFirst of [false, true]) {
    const { source, destination, lock } = forwardLinkFixture(join(root, String(afterFirst))); let publicationCheckpoints = 0;
    const checkpoint = () => {
      if (!existsSync(join(destination, 'z-tool/package.json'))) return;
      publicationCheckpoints++;
      assert.equal(existsSync(join(destination, 'z-tool/cli.js')), true, 'All regular targets must be copied before publication begins');
      if (!afterFirst || existsSync(join(destination, '.bin/a-tool'))) refuse('interrupted');
    };
    refused(() => harness.copyDependencyTree(source, destination, lock, { checkpoint }), 'interrupted');
    assert.equal(publicationCheckpoints, afterFirst ? 2 : 1);
    if (afterFirst) {
      assert.equal(lstatSync(join(destination, '.bin/a-tool')).isSymbolicLink(), true);
      assert.equal(realpathSync(join(destination, '.bin/a-tool')), join(destination, 'z-tool/cli.js'));
      assert.throws(() => lstatSync(join(destination, '.bin/z-tool')), { code: 'ENOENT' });
    } else assertUnpublishedLinks(destination);
    assert.doesNotThrow(() => harness.ownedUsage(join(destination, '..'), false));
  }
});
test('link publication revalidates missing or escaping destination targets before creating any link', t => {
  const root = tiny(t);
  for (const mutation of ['missing', 'escape']) {
    const { source, destination, lock } = forwardLinkFixture(join(root, mutation)); let mutated = false;
    const target = join(destination, 'z-tool/cli.js'), outside = put(root, `${mutation}-outside.js`, 'outside owned copy');
    const checkpoint = () => {
      if (mutated || !existsSync(join(destination, 'z-tool/package.json'))) return;
      mutated = true; rmSync(target); if (mutation === 'escape') symlinkSync(outside, target);
    };
    refused(() => harness.copyDependencyTree(source, destination, lock, { checkpoint }), 'dependency_invalid');
    assert.equal(mutated, true); assertUnpublishedLinks(destination);
    if (mutation === 'escape') { refused(() => harness.ownedUsage(destination, false), 'ownership_invalid'); rmSync(target); }
    assert.doesNotThrow(() => harness.ownedUsage(destination, false));
  }
});
test('successful link publication canonicalizes forward link chains to copied targets', t => {
  const root = tiny(t), { source, destination, lock } = forwardLinkFixture(root);
  const result = harness.copyDependencyTree(source, destination, lock);
  for (const name of ['a-tool', 'z-tool']) {
    assert.equal(readlinkSync(join(destination, '.bin', name)), '../z-tool/cli.js');
    assert.equal(realpathSync(join(destination, '.bin', name)), join(destination, 'z-tool/cli.js'));
  }
  assert.equal(result.files, 5); assert.equal(harness.ownedUsage(destination, false), result.bytes);
});

// Linux identities and cleanup use only synthetic process objects.
type ProcessRow = { pid: number; parent: number; group: number; session: number; start: string; state: string; label?: string; nonce?: string };
function row(pid: number, patch: Partial<ProcessRow> = {}): ProcessRow { return { pid, parent: 1, group: pid, session: pid, start: String(1000 + pid), state: 'S', ...patch }; }
function statLine(info: ProcessRow) { const fields = Array(19).fill('0'); fields[0] = String(info.parent); fields[1] = String(info.group); fields[2] = String(info.session); fields[18] = info.start; return `${info.pid} (synthetic (worker) name) ${info.state} ${fields.join(' ')}\n`; }
function processBoundary(initial: ProcessRow[], survives = false) {
  const running = new Map(initial.map(value => [value.pid, { ...value }])); const signals: [number, string][] = []; let time = 0;
  return { running, signals, boundary: { inspect: (pid: number) => running.get(pid) ?? null, kill: (pid: number, signal: string) => { signals.push([pid, signal]); if (!survives || signal === 'SIGKILL') running.delete(pid); }, now: () => time, wait: async (ms: number) => { time += ms; } }, elapsed: () => time };
}
test('Linux stat parsing handles parentheses and pins start time plus process group', () => {
  const info = row(41, { parent: 23, group: 29, session: 29, start: '987654321' }); assert.deepEqual(harness.parseProcessStat(statLine(info)), info);
  for (const value of ['', 'not proc', '41 (x) S 0 1', 'NaN (x) S 1 2 3']) assert.equal(harness.parseProcessStat(value), null);
  assert.equal(harness.sameProcess(info, { ...info }), true); assert.equal(harness.sameProcess(info, null), false);
  assert.equal(harness.sameProcess(info, { ...info, start: '987654322' }), false); assert.equal(harness.sameProcess(info, { ...info, group: 30 }), false);
});
test('owned detached children stop even after their recorded parent has crashed', async () => {
  const parent = row(101), child = row(102, { parent: 1, group: 102, session: 102 }), other = row(777);
  const fake = processBoundary([child, other]); assert.equal(await harness.stopOwnedProcesses([parent, child], fake.boundary), true);
  assert.deepEqual(fake.signals, [[102, 'SIGTERM']]); assert.ok(fake.running.has(777));
});
test('owned shutdown escalates only known still-live identities and treats zombies as exited', async () => {
  const child = row(103), zombie = row(104, { state: 'Z' }); const fake = processBoundary([child, zombie], true);
  assert.equal(await harness.stopOwnedProcesses([child, zombie], fake.boundary), true); assert.deepEqual(fake.signals, [[103, 'SIGTERM'], [103, 'SIGKILL']]); assert.equal(fake.elapsed(), 15_000);
});
test('stale PID reuse refuses all signaling and failed shutdown is never success', async () => {
  const old = row(105), fake = processBoundary([{ ...old, start: '999999' }]); await assert.rejects(harness.stopOwnedProcesses([old], fake.boundary), { code: 'process_identity' }); assert.deepEqual(fake.signals, []);
  const stubborn = processBoundary([old], true); stubborn.boundary.kill = (pid, signal) => { stubborn.signals.push([pid, signal]); };
  await assert.rejects(harness.stopOwnedProcesses([old], stubborn.boundary), { code: 'cleanup_failed' }); assert.equal(stubborn.elapsed(), 20_000);
  const denied = processBoundary([old]); denied.boundary.kill = () => { throw Object.assign(new Error('secret'), { code: 'EPERM' }); }; await assert.rejects(harness.stopOwnedProcesses([old], denied.boundary), { code: 'cleanup_failed' });
});
function ownershipScan(records: ProcessRow[], processes: ProcessRow[], marked = new Map<number, string>()) {
  const saved = records.map(value => ({ ...value }));
  const scan = privateFunction('scanOwned', {
    refuse, processRecords: () => saved, readdirSync: (path: string) => { assert.equal(path, '/proc'); return processes.map(value => String(value.pid)); },
    processInfo: (pid: number) => processes.find(value => value.pid === pid) ?? null, sameProcess: harness.sameProcess,
    readFileSync: (path: string) => Buffer.from(`B2_PROCESS_TAG=${marked.get(Number(path.split('/')[2])) ?? 'foreign'}\0`),
    registerProcess: (_owner: unknown, discovered: ProcessRow, label: string) => { const current = processes.find(item => item.pid === discovered.pid); assert.ok(current); assert.deepEqual(discovered, current); saved.push({ ...discovered, label, nonce }); },
  });
  return scan({ nonce });
}
test('ownership scan records live descendants and nonce-marked detached browser children', () => {
  const parent = row(201), detached = row(202, { parent: 201 }), grandchild = row(203, { parent: 202 }), foreign = row(999);
  assert.deepEqual(ownershipScan([parent], [parent, detached, grandchild, foreign]).map((value: ProcessRow) => value.pid), [201, 202, 203]);
  const orphan = row(204); assert.deepEqual(ownershipScan([parent], [orphan, foreign], new Map([[204, nonce]])).map((value: ProcessRow) => value.pid), [201, 204]);
  assert.deepEqual(ownershipScan([parent], [orphan, foreign], new Map([[204, 'wrong-marker']])).map((value: ProcessRow) => value.pid), [201]);
});
test('ownership scan recovers unmarked closed-env children by original group/session after parent crash', () => {
  const parent = row(211), orphan = row(212, { parent: 1, group: 211, session: 211 }), unrelated = row(213, { group: 211, session: 999 });
  assert.deepEqual(ownershipScan([parent], [orphan, unrelated]).map((value: ProcessRow) => value.pid), [211, 212]);
  const older = row(210, { group: 211, session: 211, start: '1' }); assert.deepEqual(ownershipScan([parent], [older]).map((value: ProcessRow) => value.pid), [211]);
});
test('persisted process records refuse stale ownership markers, malformed names and over-cap inventories', () => {
  const owner = { nonce, directory: '/synthetic/owned' }, valid = { ...row(301), nonce };
  let files = ['301-1301.json'], value = valid;
  const records = privateFunction('processRecords', { readdirSync: () => files, LIMITS: harness.LIMITS, refuse, join, json: () => value, regularPath: (_root: string, path: string) => path });
  assert.deepEqual(records(owner), [valid]); value = { ...valid, nonce: 'c'.repeat(64) }; refused(() => records(owner), 'ownership_invalid');
  files = ['../../arbitrary.json']; refused(() => records(owner), 'ownership_invalid'); files = Array(harness.LIMITS.processCount + 1).fill('301-1301.json'); refused(() => records(owner), 'process_limit');
});

// Owner records are the only deletion authority; every mismatch must refuse.
function ownerRecord() { return { schemaVersion: 1, run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, job: env.GITHUB_JOB, commit, directory: '/synthetic/runner/yeoni-b2-abc123', dev: 1, ino: 2, nonce, state: 'created' }; }
test('owned deletion preflight rejects paths outside the exact runner child and mismatched identities', () => {
  const owner = ownerRecord(); const info = { real: owner.directory, dev: 1, ino: 2, mode: 0o40700 };
  assert.equal(harness.validateOwnerRecord(owner, env.GITHUB_WORKSPACE, env, () => info), owner);
  for (const patch of [{ run: 'other' }, { attempt: '2' }, { job: 'other' }, { commit: 'd'.repeat(40) }, { nonce: 'short' }, { directory: '/synthetic/runner' }, { directory: '/synthetic/runner/other' }, { directory: '/synthetic/checkout' }, { directory: '/synthetic/runner/yeoni-b2-abc123/child' }]) refused(() => harness.validateOwnerRecord({ ...owner, ...patch }, env.GITHUB_WORKSPACE, env, () => info), 'ownership_invalid');
  for (const patch of [{ real: '/elsewhere' }, { dev: 2 }, { ino: 3 }, { mode: 0o40755 }]) refused(() => harness.validateOwnerRecord(owner, env.GITHUB_WORKSPACE, env, () => ({ ...info, ...patch })), 'ownership_invalid');
});
test('owned usage refuses escape links before removal and counts only bounded ordinary files', t => {
  const root = tiny(t), owned = join(root, 'owned'); put(owned, 'a', '123'); put(owned, 'sub/b', '45'); assert.equal(harness.ownedUsage(owned), 5);
  put(root, 'outside', 'secret'); symlinkSync('../outside', join(owned, 'escape')); refused(() => harness.ownedUsage(owned), 'ownership_invalid');
  rmSync(join(owned, 'escape')); symlinkSync('missing-target', join(owned, 'dangling'));
  assert.throws(() => harness.ownedUsage(owned, false), { code: 'ENOENT' }, 'Cleanup must remain strict about preexisting dangling links');
});
test('cleanup refuses invalid ownership before deleting any directory or record', async () => {
  const removals: string[] = [];
  const cleanup = privateFunction('cleanup', {
    validateRunner: () => {}, ownedCleanupDeadline: () => 1, process: { env }, ROOT: env.GITHUB_WORKSPACE, OWNER_PATH: '.e2e/legacy-evidence-b2-owner.json', existsSync: () => true,
    join, readOwner: () => refuse('ownership_invalid'), rmSync: (path: string) => removals.push(path),
  });
  await assert.rejects(cleanup(), { code: 'ownership_invalid' }); assert.deepEqual(removals, []);
});

// Selector unit tests transpile configs into a closed fake require, awaiting
// the focused config default promise. The native loader regression below is
// separate: transpilation alone cannot detect ESM/CommonJS interop failures.
async function evaluateConfig(path: string, imports: Record<string, unknown>, inputEnv: Record<string, string>) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', 'process', compiled)((name: string) => { assert.ok(Object.hasOwn(imports, name), `Unexpected config import ${name}`); return imports[name]; }, exports, { env: inputEnv });
  return await (exports.default as ReturnType<typeof configShape> | Promise<ReturnType<typeof configShape>>);
}
function configShape() {
  return {} as { grepInvert?: RegExp | RegExp[]; fullyParallel: boolean; workers: number; retries: number; timeout: number; expect: { timeout: number }; reporter: unknown; outputDir: string; use: { baseURL: string; actionTimeout: number; navigationTimeout: number; timezoneId: string; locale: string; serviceWorkers: string; trace: string; screenshot: string; video: string }; projects: { name: string; testMatch?: string | string[]; grep?: RegExp; grepInvert?: RegExp | RegExp[]; dependencies?: string[]; use: { browserName: string; launchOptions?: { env: Record<string, string> } } }[]; webServer?: { command: string; cwd: string; env: Record<string, string>; url: string; reuseExistingServer: boolean; timeout: number; gracefulShutdown: { signal: string; timeout: number }; stdout: string; stderr: string } };
}
const fakePlaywright = { defineConfig: (value: unknown) => value, devices: { 'Desktop Chrome': { browserName: 'chromium' }, 'iPhone 13': { browserName: 'webkit' } } };
function defaultConfig() { return evaluateConfig('playwright.config.ts', { '@playwright/test': fakePlaywright }, { ...env, YEONI_E2E: '1' }); }
async function focusedConfig(phase: 'inactive' | 'enabled', discovery = false) {
  const defaults = await defaultConfig(); let reads = 0;
  const result = await evaluateConfig('playwright.legacy-evidence.config.ts', { '@playwright/test': fakePlaywright, './playwright.config': { __esModule: true, default: defaults }, './scripts/qa-legacy-evidence-browser.mjs': { ROOT: env.GITHUB_WORKSPACE, readPhaseConfiguration: (root: string, configEnv: unknown) => { assert.equal(root, env.GITHUB_WORKSPACE); assert.equal(configEnv, env); reads++; return { phase, discovery, outputDir: `/synthetic/runner/yeoni-b2-abc/results/${phase}` }; } } }, env);
  assert.equal(reads, 1); return result;
}
test('general config excludes only the exact enabled tag and explicitly retains WebKit B2 coverage', async () => {
  const config = await defaultConfig(); assert.ok(config.grepInvert instanceof RegExp);
  for (const title of harness.SCENARIO_TITLES.enabled) assert.equal(config.grepInvert.test(title), true);
  for (const title of [...harness.AUTH_TITLES, ...harness.SCENARIO_TITLES.inactive, 'ordinary existing test', '@b2-enabled-other', 'prefix@b2-enabled', '@b2-inactive']) assert.equal(config.grepInvert.test(title), false, title);
  const webkit = config.projects.find(project => project.name === 'webkit-small'); assert.ok(webkit); assert.equal(webkit.use.browserName, 'webkit'); assert.ok(Array.isArray(webkit.testMatch)); assert.ok(webkit.testMatch.includes('**/legacy-evidence-review.spec.ts')); assert.equal(webkit.use.launchOptions?.env.LD_PRELOAD, env.QA_SOUP_LIBRARY);
});
test('focused phase selectors preserve four auth dependencies and select both engines without launching a server', async () => {
  for (const phase of ['inactive', 'enabled'] as const) {
    const config = await focusedConfig(phase, true); assert.equal(config.webServer, undefined); assert.deepEqual(config.projects.map(project => project.name), ['auth-preservation', 'chromium', 'webkit-small']);
    const auth = config.projects[0]; assert.equal(auth.testMatch, '**/auth.spec.ts'); assert.deepEqual(auth.grepInvert, []);
    for (const title of harness.AUTH_TITLES) assert.ok(auth.grep?.test(title));
    for (const project of config.projects.slice(1)) {
      assert.equal(project.testMatch, '**/legacy-evidence-review.spec.ts'); assert.deepEqual(project.dependencies, ['auth-preservation']);
      for (const title of harness.SCENARIO_TITLES[phase]) assert.ok(project.grep?.test(title));
      for (const title of harness.SCENARIO_TITLES[phase === 'inactive' ? 'enabled' : 'inactive']) assert.equal(project.grep?.test(title), false);
      assert.equal(project.use.browserName, project.name === 'chromium' ? 'chromium' : 'webkit');
      if (phase === 'enabled') assert.deepEqual(project.grepInvert, []); else assert.ok(project.grepInvert instanceof RegExp);
    }
    if (phase === 'enabled') assert.deepEqual(config.grepInvert, []); else assert.ok(config.grepInvert instanceof RegExp);
  }
});
test('focused execution preserves limits/privacy and uses only the fixed closed-environment serve launcher', async () => {
  const config = await focusedConfig('enabled'); assert.equal(config.fullyParallel, false); assert.equal(config.workers, 1); assert.equal(config.retries, 0); assert.equal(config.timeout, 90_000); assert.equal(config.expect.timeout, 15_000);
  assert.deepEqual(config.reporter, [['./tests/e2e/reporter.ts']]); assert.equal(config.use.baseURL, 'http://127.0.0.1:3000'); assert.equal(config.use.actionTimeout, 15_000); assert.equal(config.use.navigationTimeout, 30_000); assert.equal(config.use.locale, 'ko-KR'); assert.equal(config.use.timezoneId, 'Asia/Seoul'); assert.equal(config.use.serviceWorkers, 'block');
  assert.equal(config.use.trace, 'off'); assert.equal(config.use.screenshot, 'off'); assert.equal(config.use.video, 'off');
  assert.deepEqual(config.webServer, { command: 'node scripts/qa-legacy-evidence-browser.mjs serve', cwd: env.GITHUB_WORKSPACE, env: { B2_PHASE: 'enabled' }, url: 'http://127.0.0.1:3000/diet/settings', reuseExistingServer: false, timeout: 120_000, gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 }, stdout: 'ignore', stderr: 'ignore' });
  assert.equal(config.outputDir, '/synthetic/runner/yeoni-b2-abc/results/enabled');
});
test('focused config rejects missing required engines rather than reducing coverage or skipping', async () => {
  const defaults = await defaultConfig(); defaults.projects = defaults.projects.filter(project => project.name !== 'webkit-small');
  await assert.rejects(() => evaluateConfig('playwright.legacy-evidence.config.ts', { '@playwright/test': fakePlaywright, './playwright.config': { __esModule: true, default: defaults }, './scripts/qa-legacy-evidence-browser.mjs': { ROOT: env.GITHUB_WORKSPACE, readPhaseConfiguration: () => ({ phase: 'enabled', discovery: true }) } }, env), /Missing required B2 browser project/);
});


// Exercise the actual pinned loader. Only config/driver bytes and tiny forwarding
// modules are copied; the two authored specs and their imports remain untouched.
// Synthetic ownership records exist exclusively under this temporary root.
const repoRoot = realpathSync(new URL('..', import.meta.url));
const repoRequire = createRequire(new URL('../package.json', import.meta.url));
function nativeListFixture(t: { after: (fn: () => void) => void }) {
  const root = tiny(t), checkout = join(root, 'checkout'), runner = join(root, 'runner');
  mkdirSync(checkout); mkdirSync(runner);
  const directory = mkdtempSync(join(runner, 'yeoni-b2-')); chmodSync(directory, 0o700);
  for (const child of ['home', 'tmp', 'results', 'processes', 'browser-cache']) mkdirSync(join(directory, child), { mode: 0o700 });
  const configPath = 'playwright.legacy-evidence.config.ts', driverPath = 'scripts/qa-legacy-evidence-browser.mjs';
  for (const path of [configPath, driverPath, 'scripts/legacy-evidence-reset-diagnostics.mjs']) {
    const source = readFileSync(join(repoRoot, path)), copy = put(checkout, path, source);
    assert.deepEqual(readFileSync(copy), source);
    assert.notEqual(statSync(copy).ino, statSync(join(repoRoot, path)).ino);
  }
  // Resolve the same installed package, without a copied dependency tree, loader
  // hook, aliased driver, fake reader, hardlink, or symlink back into the checkout.
  put(checkout, 'node_modules/@playwright/test/package.json', JSON.stringify({ main: 'index.cjs' }));
  put(checkout, 'node_modules/@playwright/test/index.cjs', `module.exports = require(${JSON.stringify(repoRequire.resolve('@playwright/test'))});\n`);
  put(checkout, 'playwright.config.ts', `import defaults from ${JSON.stringify(join(repoRoot, 'playwright.config.ts'))};\nexport default { ...defaults, testDir: ${JSON.stringify(join(repoRoot, 'tests/e2e'))} };\n`);
  // Playwright resolves authored reporter paths before applying the fixed JSON CLI override.
  put(checkout, 'tests/e2e/reporter.ts', `export { default } from ${JSON.stringify(join(repoRoot, 'tests/e2e/reporter.ts'))};\n`);
  const info = statSync(directory), owner = { schemaVersion: 1, run: '123', attempt: '1', job: 'b2-list-regression', commit,
    directory, dev: info.dev, ino: info.ino, nonce, state: 'created' };
  const ownerFile = '.e2e/legacy-evidence-b2-owner.json';
  put(checkout, ownerFile, JSON.stringify(owner), 0o600); put(directory, 'owner.json', JSON.stringify(owner), 0o600);
  put(directory, 'state.json', JSON.stringify({ browserCache: join(directory, 'browser-cache') }), 0o600);
  const started = Date.now();
  // Deliberately omit NODE_ENV, matching the runner's closed environment. Next
  // augments ProcessEnv to require it, although Node permits its absence; narrow
  // type-only casts at Node/reader boundaries must not add a runtime variable.
  const childEnv: Record<string, string> = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(directory, 'home'), TMPDIR: join(directory, 'tmp'),
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', CI: 'true', GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: owner.run, GITHUB_RUN_ATTEMPT: owner.attempt, GITHUB_JOB: owner.job, QA_HEAD_SHA: commit,
    GITHUB_WORKSPACE: checkout, RUNNER_TEMP: runner, QA_SOUP_VARIANT: 'fixed', QA_SOUP_LIBRARY: join(runner, 'webkit-soup/lib/libsoup-3.0.so.0'),
    NEXT_PUBLIC_SUPABASE_URL: API, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon', YEONI_E2E: '1', NEXT_TELEMETRY_DISABLED: '1',
    B2_JOB_STARTED_MS: String(started), B2_JOB_DEADLINE_MS: String(started + harness.LIMITS.jobMs),
    B2_STOP_AT_MS: String(started + harness.LIMITS.jobMs - harness.LIMITS.reserveMs),
    B2_PHASE: 'inactive', B2_DISCOVERY: '1', B2_PROCESS_TAG: nonce, PLAYWRIGHT_BROWSERS_PATH: join(directory, 'browser-cache'),
  };
  const sentinel = join(root, 'forbidden-execution.json');
  // This preload only guards I/O boundaries, never config/module resolution or
  // Playwright's loader. An attempted server/browser/worker/network operation,
  // or entry into the real account fixture, is recorded and refused immediately.
  const guard = put(root, 'list-only-boundary.cjs', `
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const record = fs.writeFileSync;
function forbidden(kind) { record(${JSON.stringify(sentinel)}, JSON.stringify({ kind })); throw new Error('B2_LIST_FORBIDDEN_' + kind); }
const cp = require('node:child_process');
for (const name of ['spawn', 'spawnSync', 'fork', 'exec', 'execSync', 'execFile', 'execFileSync']) cp[name] = () => forbidden('child-process');
require('node:net').Socket.prototype.connect = () => forbidden('network');
require('node:net').Server.prototype.listen = () => forbidden('server');
const read = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  if (String(file).replaceAll('\\\\', '/').endsWith('.e2e/stack-status.json')) forbidden('account-fixture');
  return read.call(this, file, ...args);
};
syncBuiltinESMExports();
`);
  function setPhase(phase: 'inactive' | 'enabled', discovery = true) {
    childEnv.B2_PHASE = phase;
    if (discovery) childEnv.B2_DISCOVERY = '1'; else delete childEnv.B2_DISCOVERY;
    put(directory, 'phase.json', JSON.stringify({ phase, nonce, commit, state: 'ready' }), 0o600);
  }
  const listDeadline = Date.now() + 60_000;
  function list() {
    const remaining = listDeadline - Date.now(); assert.ok(remaining > 0, 'Native list fixture has one fixed 60-second total budget');
    const args = ['--require', guard, repoRequire.resolve('@playwright/test/cli'), 'test', `--config=${join(checkout, configPath)}`, '--list', '--reporter=json'];
    const result = spawnSync(process.execPath, args, { cwd: checkout, env: childEnv as NodeJS.ProcessEnv, encoding: 'utf8',
      timeout: Math.min(15_000, remaining), killSignal: 'SIGKILL', maxBuffer: 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(result.error, undefined, 'Bounded native list subprocess must finish normally');
    assert.equal(result.signal, null);
    assert.equal(existsSync(sentinel), false, existsSync(sentinel) ? readFileSync(sentinel, 'utf8') : 'No execution boundary may be entered');
    assert.deepEqual(filesystem.readdirSync(join(directory, 'browser-cache')), [], 'No browser is installed or started');
    assert.deepEqual(filesystem.readdirSync(join(directory, 'results')), [], 'List mode must not create execution output');
    assert.equal(existsSync(join(checkout, '.e2e/stack-status.json')), false);
    assert.equal(existsSync(join(checkout, '.e2e/evidence')), false);
    return result;
  }
  setPhase('inactive');
  return { root, checkout, directory, owner, ownerFile, childEnv, setPhase, list };
}
test('installed Playwright list mode has no setup, server, worker or test-execution task', () => {
  assert.equal(repoRequire('@playwright/test/package.json').version, '1.63.0');
  const runner = readFileSync(join(dirname(repoRequire.resolve('playwright/package.json')), 'lib/runner/index.js'), 'utf8');
  const ast = ts.createSourceFile('installed-playwright-runner.js', runner, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const run = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runAllTestsWithConfig');
  assert.ok(run && ts.isFunctionDeclaration(run) && run.body);
  const tasks = run.body.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(ast) === 'tasks')?.initializer;
  assert.ok(tasks && ts.isConditionalExpression(tasks)); assert.equal(tasks.condition.getText(ast), 'options.listMode');
  assert.ok(ts.isArrayLiteralExpression(tasks.whenTrue));
  assert.deepEqual(tasks.whenTrue.elements.map(node => ts.isCallExpression(node) ? node.expression.getText(ast) : 'unexpected task'), ['createLoadTask', 'createReportBeginTask']);
  const load = tasks.whenTrue.elements[0]; assert.ok(ts.isCallExpression(load));
  assert.equal(load.arguments[0].getText(ast), '"in-process"');
  assert.match(tasks.whenFalse.getText(ast), /createGlobalSetupTasks\(config2\)/);
  assert.match(tasks.whenFalse.getText(ast), /createRunTestsTasks\(config2\)/);
});
test('native focused config lists exact authored inactive/enabled cases and awaits real owner authority', { timeout: 70_000 }, t => {
  const fixture = nativeListFixture(t);
  for (const phase of ['inactive', 'enabled'] as const) for (const discovery of [true, false]) {
    fixture.setPhase(phase, discovery);
    assert.deepEqual(harness.readPhaseConfiguration(fixture.checkout, fixture.childEnv as NodeJS.ProcessEnv), {
      phase, discovery, outputDir: join(fixture.directory, 'results', phase),
    });
    const result = fixture.list(); assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout), cases = harness.projectDiscovery(report, phase);
    assert.equal(report.config.configFile, join(fixture.checkout, 'playwright.legacy-evidence.config.ts'));
    assert.equal(report.config.rootDir, join(repoRoot, 'tests/e2e'));
    assert.equal(cases.length, phase === 'inactive' ? 8 : 28);
    assert.deepEqual(cases.filter(row => row.project === 'auth-preservation'), harness.expectedCases(phase).filter(row => row.project === 'auth-preservation'));
    assert.deepEqual(cases, harness.expectedCases(phase));
    assert.deepEqual(report.errors, []);
    assert.equal(report.stats.expected, 0); assert.equal(report.stats.unexpected, 0);
    for (const suite of report.suites) for (const spec of suite.specs) for (const row of spec.tests) assert.deepEqual(row.results, [], 'No authored test/fixture callback executes');
    // Even without B2_DISCOVERY, the real server config is loaded but --list
    // never starts it. Its exact command/cwd/env remain covered above.
    assert.equal(Boolean(report.config.webServer), !discovery);
    if (!discovery) assert.equal(report.config.webServer.command, 'node scripts/qa-legacy-evidence-browser.mjs serve');
  }
});
test('native focused config fails closed for absent/malformed ownership and rejected authority inputs', { timeout: 70_000 }, t => {
  const fixture = nativeListFixture(t), baseline = { ...fixture.childEnv };
  const ownerJson = JSON.stringify(fixture.owner), phaseJson = JSON.stringify({ phase: 'inactive', nonce, commit, state: 'ready' });
  const negatives = [
    { name: 'missing owner', error: /ENOENT/, change: () => rmSync(join(fixture.checkout, fixture.ownerFile)) },
    { name: 'malformed owner JSON', error: /SyntaxError/, change: () => put(fixture.checkout, fixture.ownerFile, '{', 0o600) },
    { name: 'wrong owner inode', error: /ownership_invalid/, change: () => put(fixture.checkout, fixture.ownerFile, JSON.stringify({ ...fixture.owner, ino: fixture.owner.ino + 1 }), 0o600) },
    { name: 'missing nonce', error: /environment_override/, change: () => { delete fixture.childEnv.B2_PROCESS_TAG; } },
    { name: 'malformed nonce', error: /environment_override/, change: () => { fixture.childEnv.B2_PROCESS_TAG = 'bad'; } },
    { name: 'mismatched nonce', error: /ownership_invalid/, change: () => { fixture.childEnv.B2_PROCESS_TAG = 'c'.repeat(64); } },
    { name: 'stale phase nonce', error: /ownership_invalid/, change: () => put(fixture.directory, 'phase.json', JSON.stringify({ phase: 'inactive', nonce: 'c'.repeat(64), commit, state: 'ready' }), 0o600) },
    { name: 'phase not ready', error: /ownership_invalid/, change: () => put(fixture.directory, 'phase.json', JSON.stringify({ phase: 'inactive', nonce, commit, state: 'building' }), 0o600) },
    { name: 'malformed discovery flag', error: /ownership_invalid/, change: () => { fixture.childEnv.B2_DISCOVERY = '0'; } },
    { name: 'non-enum phase', error: /ownership_invalid/, change: () => { fixture.childEnv.B2_PHASE = '../enabled'; } },
    { name: 'wrong browser cache', error: /ownership_invalid/, change: () => { fixture.childEnv.PLAYWRIGHT_BROWSERS_PATH = fixture.directory; } },
    { name: 'invalid runner identity', error: /runner_required/, change: () => { fixture.childEnv.GITHUB_RUN_ID = 'not-a-run'; } },
    { name: 'credential environment override', error: /environment_override/, change: () => { fixture.childEnv.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-rejected'; } },
  ];
  for (const negative of negatives) {
    for (const key of Object.keys(fixture.childEnv)) delete fixture.childEnv[key]; Object.assign(fixture.childEnv, baseline);
    put(fixture.checkout, fixture.ownerFile, ownerJson, 0o600); put(fixture.directory, 'phase.json', phaseJson, 0o600);
    negative.change();
    assert.throws(() => harness.readPhaseConfiguration(fixture.checkout, fixture.childEnv as NodeJS.ProcessEnv), negative.error, negative.name);
    const result = fixture.list(); assert.notEqual(result.status, 0, negative.name);
    assert.match(result.stderr, negative.error, negative.name);
    assert.equal(result.stdout.trim(), '', 'Rejected authority never reaches test discovery');
  }
});

// The fake transport also covers failures between spawn and persisted ownership.
function fakeLauncher(options: { registerFails?: boolean; spawnFails?: boolean; stopFails?: boolean; reuseBeforeRegister?: boolean; exitBeforeRegister?: boolean; firstIdentity?: Partial<ProcessRow>; diskError?: string; resourceError?: string; resourceFailure?: unknown; diagnostics?: ReturnType<typeof processDiagnosticBoundary> } = {}) {
  let time = 0, nextTimer = 1, spawnCount = 0;
  const timers = new Map<number, { callback: () => void; at: number; repeat: number }>();
  const identity = row(401, { parent: 9999, ...options.firstIdentity }), live = new Map([[identity.pid, identity]]), records: ProcessRow[] = [], stopped: ProcessRow[][] = [];
  const details: string[] = [];
  const signals: [number, string][] = [], spawnOptions: Record<string, unknown>[] = [];
  const child = Object.assign(new EventEmitter(), { pid: identity.pid, stdout: new PassThrough(), stderr: new PassThrough(), kill: (signal: string) => { signals.push([identity.pid, signal]); return true; } });
  const controller = new AbortController();
  const schedule = (callback: () => void, ms: number, repeat: number) => { const id = nextTimer++; timers.set(id, { callback, at: time + ms, repeat }); return id; };
  const registration = privateFunction('registerProcess', { processInfo: (pid: number, observe: (outcome: string) => void) => { const current = live.get(pid) ?? null; observe(current ? 'ok' : 'ENOENT'); return current; }, sameProcess: harness.sameProcess, refuse, join, writeProcessRecord: (_owner: unknown, value: ProcessRow) => records.push(value) });
  const run = privateFunction('runFixed', {
    ROOT: env.GITHUB_WORKSPACE, process: { execPath: '/synthetic/node', env, pid: 9999, kill: (pid: number, signal: string) => { signals.push([pid, signal]); live.delete(pid); } },
    childOperationObserver: (label: string) => (options.diagnostics?.observer ?? harness.childOperationObserver)(label, (line: string) => details.push(line)),
    runtimeStop: controller, refuse, LIMITS: harness.LIMITS, safeFailure: harness.safeFailure, sameProcess: harness.sameProcess,
    spawn: (_command: string, _args: string[], supplied: Record<string, unknown>) => { spawnCount++; spawnOptions.push(supplied); if (options.spawnFails) throw Object.assign(new Error('synthetic-spawn-failure'), { code: 'EACCES' }); queueMicrotask(() => child.emit('spawn')); return child; },
    processInfo: (pid: number) => live.get(pid) ?? null,
    registerProcess: (owner: unknown, discovered: ProcessRow, label: string) => { assert.equal(typeof discovered, 'object', 'The original birth tuple must reach registration'); if (options.registerFails) refuse('ownership_invalid'); if (options.reuseBeforeRegister) live.set(discovered.pid, { ...discovered, start: '900000' }); if (options.exitBeforeRegister) live.delete(discovered.pid); return registration(owner, discovered, label); },
    processRecords: () => records, scanOwned: () => records,
    stopOwnedProcesses: async (owned: ProcessRow[]) => { stopped.push(owned); if (options.stopFails) refuse('cleanup_failed'); for (const info of owned) { const current = live.get(info.pid); if (current && !harness.sameProcess(info, current)) refuse('process_identity'); live.delete(info.pid); } return true; },
    resourceSample: () => { if (options.resourceFailure) throw options.resourceFailure; if (options.resourceError) throw Object.assign(new Error('SENTINEL_SECRET_PROCESS'), { code: options.resourceError }); return 1024; },
    ownedUsage: () => { if (options.diskError) throw Object.assign(new Error('SENTINEL_SECRET_DISK'), { code: options.diskError }); return 2048; }, Date: { now: () => time },
    setInterval: (callback: () => void, ms: number) => schedule(callback, ms, ms), clearInterval: (id: number) => timers.delete(id),
    setTimeout: (callback: () => void, ms: number) => schedule(callback, ms, 0), clearTimeout: (id: number) => timers.delete(id),
  });
  return { run, child, identity, live, records, stopped, signals, details, spawnOptions, controller, spawnCount: () => spawnCount, timers,
    advance(ms: number) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { if (timer.repeat) timer.at = time + timer.repeat; else timers.delete(id); timer.callback(); } },
  };
}
async function flushMicrotasks() { for (let count = 0; count < 4; count++) await Promise.resolve(); }
test('runner import is inert with child processes, timers, network and main execution unavailable', () => {
  const nativeRequire = createRequire(import.meta.url), exports: Record<string, unknown> = {}, observed: string[] = [];
  const blocked = (name: string) => () => { observed.push(name); assert.fail(`Import attempted ${name}`); };
  const compiled = ts.transpileModule(runnerSource.replaceAll('import.meta.url', JSON.stringify(new URL('../scripts/qa-legacy-evidence-browser.mjs', import.meta.url).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'process', 'setTimeout', 'setInterval', 'fetch', compiled)((name: string) => {
    if (name === './legacy-evidence-reset-diagnostics.mjs') return resetDiagnostics;
    if (name === 'node:child_process') return { spawn: blocked('spawn'), execFileSync: blocked('execFileSync') };
    assert.ok(['node:crypto', 'node:fs', 'node:path', 'node:url', 'node:timers/promises', 'node:util'].includes(name), `Unreviewed import ${name}`);
    return nativeRequire(name);
  }, exports, { argv: ['/synthetic/node', '/synthetic/importer'], env: {}, on: blocked('signal registration'), kill: blocked('kill') }, blocked('timeout'), blocked('interval'), blocked('fetch'));
  assert.equal(typeof exports.main, 'function'); assert.equal(typeof exports.copySources, 'function'); assert.deepEqual(observed, []);
});
test('fake process execution records identity before output and leaves no timers after normal completion', async () => {
  const fake = fakeLauncher(), pending = fake.run(ownerRecord(), 'discovery', ['fixed-cli'], { capture: true, env: { PUBLIC: 'only' }, cwd: '/synthetic/checkout' });
  await flushMicrotasks(); assert.equal(fake.records.length, 1); assert.equal(fake.records[0].start, fake.identity.start);
  fake.child.stdout.emit('data', Buffer.from('{"suites":[]}')); fake.child.stderr.emit('data', 'secret-error-output'); fake.child.emit('close', 0);
  const result = await pending; assert.equal(result.output, '{"suites":[]}'); assert.equal(result.code, 0); assert.equal(fake.timers.size, 0);
  assert.deepEqual(fake.spawnOptions, [{ cwd: '/synthetic/checkout', env: { PUBLIC: 'only' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }]);
});
test('partial spawn or ownership persistence failure stops only the captured birth identity', async () => {
  const missing = fakeLauncher({ spawnFails: true }); await assert.rejects(missing.run(ownerRecord(), 'browser', []), { code: 'EACCES' }); assert.deepEqual(missing.stopped, []);
  const partial = fakeLauncher({ registerFails: true }); await assert.rejects(partial.run(ownerRecord(), 'browser', []), { code: 'ownership_invalid' }); assert.deepEqual(partial.stopped, [[partial.identity]]); assert.equal(partial.live.size, 0); assert.equal(partial.timers.size, 0);
  const denied = fakeLauncher({ registerFails: true, stopFails: true }); await assert.rejects(denied.run(ownerRecord(), 'browser', []), { code: 'cleanup_failed' }); assert.equal(denied.live.size, 1);
});
test('runner refuses unknown process labels and preexisting abort before any spawn', async () => {
  const fake = fakeLauncher(); await assert.rejects(fake.run(ownerRecord(), 'arbitrary-shell', []), { code: 'process_identity' }); assert.equal(fake.spawnCount(), 0);
  fake.controller.abort(); await assert.rejects(fake.run(ownerRecord(), 'browser', []), { code: 'interrupted' }); assert.equal(fake.spawnCount(), 0);
});
test('process budget exhaustion requests shutdown and does not accept a later zero exit as success', async () => {
  const fake = fakeLauncher(), rejected = assert.rejects(fake.run(ownerRecord(), 'browser', [], { stopAt: 10 }), { code: 'budget_exhausted' });
  await flushMicrotasks(); fake.advance(100); assert.deepEqual(fake.signals, [[401, 'SIGTERM']]); fake.child.emit('close', 0); await rejected; assert.equal(fake.timers.size, 0);
});
test('ignored graceful shutdown escalates only recorded identities and rejects at a bounded deadline', async () => {
  const fake = fakeLauncher(), rejected = assert.rejects(fake.run(ownerRecord(), 'browser', [], { timeout: 10 }), { code: 'cleanup_failed' });
  await flushMicrotasks(); fake.advance(100); fake.advance(20_000); assert.deepEqual(fake.signals, [[401, 'SIGTERM'], [401, 'SIGKILL']]); fake.advance(5_000); await rejected; assert.equal(fake.timers.size, 0);
});
test('a reused PID is never force-killed by the runner timeout path', async () => {
  const fake = fakeLauncher(), rejected = assert.rejects(fake.run(ownerRecord(), 'browser', [], { timeout: 10 }), { code: 'process_identity' });
  await flushMicrotasks(); fake.advance(100); fake.live.set(401, { ...fake.identity, start: 'new-birth' }); fake.advance(20_000); assert.deepEqual(fake.signals, [[401, 'SIGTERM']]); fake.advance(5_000); await rejected; assert.equal(fake.live.get(401)?.start, 'new-birth');
});
test('SIGINT or SIGTERM abort and private discovery capture overflow fail without leaking output', async () => {
  const interrupted = fakeLauncher(), rejected = assert.rejects(interrupted.run(ownerRecord(), 'browser', []), { code: 'interrupted' });
  await flushMicrotasks(); interrupted.controller.abort(); assert.deepEqual(interrupted.signals, [[401, 'SIGTERM']]); interrupted.child.emit('close', 0); await rejected;
  const overflow = fakeLauncher(), oversized = assert.rejects(overflow.run(ownerRecord(), 'discovery', [], { capture: true }), { code: 'resource_limit' });
  await flushMicrotasks(); overflow.child.stdout.emit('data', Buffer.alloc(harness.LIMITS.captureBytes + 1, 'x')); assert.deepEqual(overflow.signals, [[401, 'SIGTERM']]); overflow.child.emit('close', 0); await oversized;
});
test('unknown app listeners are refused without killing them or selecting a second port', () => {
  let table = 'header\n 0: 0100007F:0BB8 00000000:0000 0A 0 0\n';
  const inspect = privateFunction('noListener', { readFileSync: (path: string) => { assert.ok(['/proc/net/tcp', '/proc/net/tcp6'].includes(path)); return table; }, refuse });
  refused(() => inspect(), 'port_occupied'); table = table.replace(' 0A ', ' 01 '); assert.doesNotThrow(() => inspect()); table = table.replace(':0BB8', ':0BB9').replace(' 01 ', ' 0A '); assert.doesNotThrow(() => inspect());
});
test('phase selection requires verified owner nonce/commit/cache/ready state and two fixed enum values', () => {
  const browserCache = '/synthetic/original-home/.cache/ms-playwright';
  const phaseEnv = { ...env, B2_PHASE: 'enabled', B2_PROCESS_TAG: nonce, PLAYWRIGHT_BROWSERS_PATH: browserCache };
  let phase = { phase: 'enabled', nonce, commit, state: 'ready' };
  const reader = privateFunction('readPhaseConfiguration', { validateRunner: () => {}, readOwner: () => ownerRecord(), json: (path: string) => path === 'state.json' ? { browserCache } : phase, regularPath: (_root: string, file: string) => file, realpathSync: (path: string) => path, join, refuse });
  assert.deepEqual(reader(env.GITHUB_WORKSPACE, phaseEnv), { phase: 'enabled', outputDir: '/synthetic/runner/yeoni-b2-abc123/results/enabled', discovery: false });
  assert.equal(reader(env.GITHUB_WORKSPACE, { ...phaseEnv, B2_DISCOVERY: '1' }).discovery, true);
  for (const patch of [{ B2_PHASE: '/arbitrary/app' }, { B2_DISCOVERY: '0' }, { B2_PROCESS_TAG: 'wrong' }, { PLAYWRIGHT_BROWSERS_PATH: '/untrusted/cache' }]) refused(() => reader(env.GITHUB_WORKSPACE, { ...phaseEnv, ...patch }), 'ownership_invalid');
  for (const patch of [{ nonce: 'stale' }, { commit: 'stale' }, { phase: 'inactive' }, { state: 'building' }]) { phase = { phase: 'enabled', nonce, commit, state: 'ready', ...patch }; refused(() => reader(env.GITHUB_WORKSPACE, phaseEnv), 'ownership_invalid'); }
});
test('dependency copy refuses simulated hardlink inodes rather than silently sharing writable files', t => {
  const root = tiny(t), { source, lock } = dependencyFixture(root), destination = join(root, 'copy');
  const copied = dependencyCopier({ statSync: (file: string) => statSync(file.replace(destination, source)) });
  refused(() => copied(source, destination, lock), 'dependency_invalid');
});
test('immutable build identity excludes only fixed runtime caches and detects server/static mutations', t => {
  const root = tiny(t); put(root, '.next/BUILD_ID', 'synthetic-build'); put(root, '.next/server/a.js', 'server'); put(root, '.next/static/a.js', 'static'); put(root, '.next/build-manifest.json', '{}'); put(root, '.next/cache/a', 'cache'); put(root, '.next/trace', 'trace');
  const first = harness.buildIdentity(root); assert.deepEqual(first.exclusions, ['cache/', 'trace', 'trace-build', 'diagnostics/', 'server/route-cache/']); assert.equal(first.fileCount, 4);
  put(root, '.next/cache/a', 'changed cache'); put(root, '.next/trace', 'changed trace'); assert.deepEqual(harness.buildIdentity(root), first);
  put(root, '.next/server/a.js', 'mutated server'); assert.notEqual(harness.buildIdentity(root).digest, first.digest);
  symlinkSync('a.js', join(root, '.next/server/link')); refused(() => harness.buildIdentity(root), 'source_changed');
});

test('installed Next seed promotion and regeneration preserve immutable build identity without a server', async t => {
  assert.equal(repoRequire('next/package.json').version, '16.3.8');
  const { default: FileSystemCache } = repoRequire('next/dist/server/lib/incremental-cache/file-system-cache');
  const { getRouteCacheKey } = repoRequire('next/dist/server/lib/route-cache-key');
  const { nodeFs } = repoRequire('next/dist/server/lib/node-fs-methods');
  const root = tiny(t), server = join(root, '.next/server');
  const owner = { kind: 'APP_PAGE', sourceRoute: '/diet/settings/page' };
  const key = getRouteCacheKey('/diet/settings', owner);
  const segments = ['/_tree', '/_full', '/diet/settings/__PAGE__'];
  const meta = { headers: {}, segmentPaths: segments, routeCache: { key, owner, isFallback: false } };
  const seeds = new Map([
    ['.next/BUILD_ID', 'synthetic-build'], ['.next/server/chunks/app.js', 'immutable compiled module'],
    ['.next/build-manifest.json', '{}'], ['.next/server/app/diet/settings.html', '<html>synthetic seed</html>'],
    ['.next/server/app/diet/settings.rsc', 'synthetic rsc'], ['.next/server/app/diet/settings.meta', JSON.stringify(meta)],
    ...segments.map(segment => [`.next/server/app/diet/settings.segments${segment}.segment.rsc`, `synthetic ${segment}`] as const),
  ]);
  for (const [path, bytes] of seeds) put(root, path, bytes);
  const before = harness.buildIdentity(root), fs = { ...nodeFs }, writes: string[] = [];
  for (const name of ['readFile', 'readFileSync', 'existsSync', 'stat', 'mkdir', 'writeFile', 'writeFileAtomic']) {
    fs[name] = (...args: [string, ...unknown[]]) => {
      assert.ok(args[0].startsWith(root + '/'), 'Only synthetic cache files may be accessed');
      if (['mkdir', 'writeFile', 'writeFileAtomic'].includes(name)) writes.push(args[0]);
      return nodeFs[name](...args);
    };
  }
  const cache = new FileSystemCache({ fs, flushToDisk: true, serverDistDir: server, revalidatedTags: [], maxMemoryCacheSize: 0 });
  assert.deepEqual(harness.buildIdentity(root), before); assert.equal(writes.length, 0);
  const context = { kind: 'APP_PAGE', isFallback: false, isRoutePPREnabled: false };
  const loaded = await cache.get(key, context);
  assert.equal(loaded.value.html, '<html>synthetic seed</html>');
  assert.ok(writes.length > 0);
  assert.ok(writes.every(path => path.startsWith(join(server, 'route-cache') + '/')));
  assert.deepEqual(harness.buildIdentity(root, 'runtime'), before);
  refused(() => harness.buildIdentity(root), 'source_changed');
  // set() legitimately changes response bytes; they need not equal build seeds.
  await cache.set(key, { kind: 'APP_PAGE', html: '<html>synthetic regeneration</html>', rscData: Buffer.from('regenerated rsc'),
    headers: {}, segmentData: new Map(segments.map(segment => [segment, Buffer.from(`regenerated ${segment}`)])) }, context);
  assert.equal(readFileSync(join(server, `${key}.html`), 'utf8'), '<html>synthetic regeneration</html>');
  assert.deepEqual(harness.buildIdentity(root, 'runtime'), before);
  for (const [path, bytes] of seeds) assert.equal(readFileSync(join(root, path), 'utf8'), bytes);
});

test('fresh identity rejects every populated route cache and accepts only an absent or empty real root', t => {
  const root = tiny(t); put(root, '.next/BUILD_ID', 'synthetic-build');
  const before = harness.buildIdentity(root);
  mkdirSync(join(root, '.next/server/route-cache'), { recursive: true });
  assert.deepEqual(harness.buildIdentity(root), before);
  mkdirSync(join(root, '.next/server/route-cache/APP_PAGE'));
  refused(() => harness.buildIdentity(root), 'source_changed');
  assert.deepEqual(harness.buildIdentity(root, 'runtime'), before);
  for (const mode of ['arbitrary', '', undefined, null, true]) {
    if (mode === undefined) continue; // Omission deliberately selects fresh.
    refused(() => harness.buildIdentity(root, mode as string), 'source_changed');
  }
});

test('runtime response cache accepts only the pinned kind-specific namespace and payload shapes', t => {
  const root = tiny(t); put(root, '.next/BUILD_ID', 'synthetic-build'); const before = harness.buildIdentity(root);
  const hash = 'a'.repeat(64);
  for (const [kind, files] of [
    ['APP_PAGE', ['route.html', 'route.meta', 'route.rsc', 'route.segments/_tree.segment.rsc', 'route.segments/nested/한글.segment.rsc']],
    ['PAGES', ['route.html', 'route.meta', 'route.json']], ['APP_ROUTE', ['route.body', 'route.meta']],
  ] as const) for (const file of files) put(root, `.next/server/route-cache/${kind}/${hash}/$/nested/${file}`, 'mutable runtime response');
  assert.deepEqual(harness.buildIdentity(root, 'runtime'), before);
  const invalid = [
    'OTHER/' + hash + '/$/route.html', 'app_page/' + hash + '/$/route.html',
    'APP_PAGE/' + 'A'.repeat(64) + '/$/route.html', 'APP_PAGE/abc/$/route.html',
    `APP_PAGE/${hash}/wrong/route.html`, `APP_PAGE/${hash}/$/route.js`, `APP_PAGE/${hash}/$/route.json`,
    `APP_PAGE/${hash}/$/route.body`, `APP_PAGE/${hash}/$/.html`, `APP_PAGE/${hash}/$/route.segment.rsc`,
    `APP_PAGE/${hash}/$/route.segments/chunk.js`, `APP_PAGE/${hash}/$/route.segments/.segment.rsc`,
    `APP_PAGE/${hash}/$/route.segments/nested.segments/chunk.segment.rsc`,
    `PAGES/${hash}/$/route.rsc`, `PAGES/${hash}/$/route.segments/chunk.segment.rsc`,
    `APP_ROUTE/${hash}/$/route.html`, `APP_ROUTE/${hash}/$/route.json`,
    `APP_PAGE/${hash}/$/bad\\name/route.html`, `APP_PAGE/${hash}/$/bad\nname/route.html`,
    `APP_PAGE/${hash}/$/route.html.11111111-1111-4111-8111-111111111111.tmp`,
  ];
  for (let index = 0; index < invalid.length; index++) {
    const app = join(root, `invalid-${index}`); put(app, '.next/BUILD_ID', 'synthetic-build');
    put(app, `.next/server/route-cache/${invalid[index]}`, 'must refuse');
    refused(() => harness.buildIdentity(app, 'runtime'), 'source_changed');
  }
  for (const path of ['APP_PAGE', `APP_PAGE/${hash}`, `APP_PAGE/${hash}/$`]) {
    const app = join(root, `file-${path.split('/').length}`); put(app, '.next/BUILD_ID', 'synthetic-build');
    put(app, `.next/server/route-cache/${path}`, 'namespace must be a directory');
    refused(() => harness.buildIdentity(app, 'runtime'), 'source_changed');
  }
});

test('runtime cache validation refuses symlink roots, ancestors, descendants and special objects', t => {
  const root = tiny(t), outside = join(root, 'outside'); mkdirSync(outside);
  for (const [index, linkPath] of ['.next', '.next/server', '.next/server/route-cache', '.next/server/route-cache/APP_PAGE', `.next/server/route-cache/APP_PAGE/${'a'.repeat(64)}/$/route.html`].entries()) {
    const app = join(root, `link-${index}`); mkdirSync(app);
    if (linkPath !== '.next') put(app, '.next/BUILD_ID', 'synthetic-build');
    mkdirSync(dirname(join(app, linkPath)), { recursive: true }); symlinkSync(outside, join(app, linkPath));
    refused(() => harness.buildIdentity(app, 'runtime'), 'source_changed');
  }
  const app = join(root, 'file-root'); put(app, '.next/BUILD_ID', 'synthetic-build'); put(app, '.next/server/route-cache', 'not a directory');
  refused(() => harness.buildIdentity(app, 'runtime'), 'source_changed');
  const fakeRoot = '/synthetic/route-cache';
  const validator = privateFunction('validateRuntimeBuildCache', {
    lstatSync: (path: string) => ({ isDirectory: () => path === fakeRoot, isFile: () => false, isSymbolicLink: () => false }),
    readdirSync: () => ['APP_PAGE'], realpathSync: (path: string) => path, join, refuse, LIMITS: harness.LIMITS,
  });
  refused(() => validator(fakeRoot, false), 'source_changed');
  const names = ['APP_PAGE', 'a'.repeat(64), '$', 'route.html'];
  const oversized = privateFunction('validateRuntimeBuildCache', {
    lstatSync: (path: string) => ({ isDirectory: () => !path.endsWith('.html'), isFile: () => path.endsWith('.html'), isSymbolicLink: () => false, size: harness.LIMITS.ownedBytes + 1 }),
    readdirSync: (path: string) => [names[path === fakeRoot ? 0 : path.slice(fakeRoot.length + 1).split('/').length]],
    realpathSync: (path: string) => path, join, refuse, LIMITS: harness.LIMITS,
  });
  refused(() => oversized(fakeRoot, false), 'resource_limit');
});

test('runtime cache classification retains immutable seed, chunk, manifest and lookalike identity checks', t => {
  const root = tiny(t); put(root, '.next/BUILD_ID', 'synthetic-build');
  const paths = ['server/app/diet/settings.html', 'server/app/diet/settings.meta', 'server/app/diet/settings.rsc',
    'server/pages/index.html', 'server/chunks/app.js', 'static/chunk.js', 'build-manifest.json',
    'server/route-cache-lookalike/APP_PAGE/cache.html', 'server/app/route-cache/cache.html'];
  for (const path of paths) put(root, `.next/${path}`, 'immutable');
  const before = harness.buildIdentity(root);
  put(root, `.next/server/route-cache/APP_PAGE/${'a'.repeat(64)}/$/route.html`, 'mutable');
  assert.deepEqual(harness.buildIdentity(root, 'runtime'), before);
  for (const path of paths) {
    put(root, `.next/${path}`, 'tampered'); assert.notEqual(harness.buildIdentity(root, 'runtime').digest, before.digest, path);
    put(root, `.next/${path}`, 'immutable');
  }
});

test('only fresh post-build capture omits runtime cache mode and later integrity comparisons keep it explicit', () => {
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'buildIdentity') calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(runnerAst);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.filter(call => call.arguments.length === 1).map(call => call.getText(runnerAst)), ['buildIdentity(cwd)']);
  for (const call of calls.filter(call => call.arguments.length !== 1)) {
    assert.equal(call.arguments.length, 2); assert.equal(call.arguments[1].getText(runnerAst), "'runtime'");
  }
  const run = functionSource('run');
  ordered(run, ['stage = `${phase}-build-reap`', 'await reap(owner)', 'stage = `${phase}-build-identity`', 'state.builds[phase]=buildIdentity(cwd)', 'writeJson(join(owner.directory,\'phase.json\')']);
  assert.doesNotMatch(functionSource('validateRuntimeBuildCache'), /readFile|rmSync|unlink|rename|writeFile|chmod|console/);
});

test('stale group-leader birth identity cannot adopt an unrelated reused session', () => {
  const old = row(601), reused = row(601, { start: '999999' }), foreignChild = row(602, { parent: 601, group: 601, session: 601, start: '1000000' });
  assert.throws(() => ownershipScan([old], [reused, foreignChild]), { code: 'process_identity' });
});

test('browser runner environment excludes secrets and binds the original verified browser cache', () => {
  const owner = ownerRecord(), browserCache = '/synthetic/original-home/.cache/ms-playwright';
  const runnerEnv = { ...env, HOME: '/synthetic/original-home', GITHUB_TOKEN: 'secret-actions', ACTIONS_RUNTIME_TOKEN: 'secret-runtime', OPENAI_API_KEY: 'secret-provider', GITHUB_STEP_SUMMARY: '/secret-summary', PLAYWRIGHT_JSON_OUTPUT_FILE: '/secret-report', NODE_OPTIONS: 'secret-loader', PLAYWRIGHT_BROWSERS_PATH: '/untrusted/cache', B2_DISCOVERY: '1' };
  const build = privateFunction('runEnvironment', { process: { env: runnerEnv, execPath: '/synthetic/node' }, json: () => ({ browserCache }), regularPath: (_root: string, file: string) => file, join, dirname, realpathSync: (path: string) => path, statSync: () => ({ isDirectory: () => true }), refuse });
  const actual = build(owner, 'enabled'); assert.equal(actual.PLAYWRIGHT_BROWSERS_PATH, browserCache); assert.equal(actual.B2_PROCESS_TAG, nonce); assert.equal(actual.B2_PHASE, 'enabled'); assert.equal(actual.HOME, join(owner.directory, 'home')); assert.equal(actual.B2_DISCOVERY, undefined); assert.doesNotMatch(JSON.stringify(actual), /secret-|untrusted/);
  assert.equal(build(owner, 'enabled', true).B2_DISCOVERY, '1');
});

test('discovery refuses nested or absolute same-basename files and unreviewed describe suites', () => {
  for (const file of ['elsewhere/auth.spec.ts', 'tests/e2e/auth.spec.ts', '/checkout/tests/e2e/auth.spec.ts', 'nested/legacy-evidence-review.spec.ts']) {
    const raw = discovery('inactive'); raw.suites[0].specs[0].file = file; refused(() => harness.projectDiscovery(raw, 'inactive'), 'discovery_invalid');
    const suite = discovery('inactive'); suite.suites[0].file = file; suite.suites[0].title = file; refused(() => harness.projectDiscovery(suite, 'inactive'), 'discovery_invalid');
  }
  const nested = discovery('inactive'); Object.assign(nested.suites[0], { suites: [{ title: 'unreviewed describe', specs: nested.suites[0].specs }] }); refused(() => harness.projectDiscovery(nested, 'inactive'), 'discovery_invalid');
  const titled = discovery('inactive'); titled.suites[0].title = 'unexpected suite title'; refused(() => harness.projectDiscovery(titled, 'inactive'), 'discovery_invalid');
});
test('nested installed package roots require exact lock entries including scoped packages', t => {
  const root = tiny(t), { source, lock } = dependencyFixture(root);
  put(source, 'tiny/node_modules/unreviewed/package.json', JSON.stringify({ name: 'unreviewed', version: '1.0.0' }));
  refused(() => harness.copyDependencyTree(source, join(root, 'copy-unknown-nested'), lock), 'dependency_invalid');
  const reviewed = { packages: { ...lock.packages, 'node_modules/tiny/node_modules/unreviewed': { version: '1.0.0' } } };
  put(source, 'tiny/node_modules/@nested/scoped/package.json', JSON.stringify({ name: '@nested/scoped', version: '2.0.0' }));
  refused(() => harness.copyDependencyTree(source, join(root, 'copy-unknown-scoped'), reviewed), 'dependency_invalid');
  const complete = { packages: { ...reviewed.packages, 'node_modules/tiny/node_modules/@nested/scoped': { version: '2.0.0' } } };
  const result = harness.copyDependencyTree(source, join(root, 'copy-reviewed-nested'), complete);
  assert.deepEqual(result.installedVersions.map(row => row.path).sort(), Object.keys(complete.packages).sort());
});


test('dependency copying observes the absolute work deadline and byte cap before another file', t => {
  const root = tiny(t), { source, lock } = dependencyFixture(root);
  let checkpoints = 0;
  assert.throws(() => harness.copyDependencyTree(source, join(root, 'deadline-copy'), lock, { checkpoint: () => { checkpoints++; throw Object.assign(new Error('fixed deadline'), { code: 'budget_exhausted' }); } }), { code: 'budget_exhausted' });
  assert.equal(checkpoints, 1);
  refused(() => harness.copyDependencyTree(source, join(root, 'cap-copy'), lock, { maxBytes: 1 }), 'resource_limit');
  refused(() => harness.copyDependencyTree(source, join(root, 'invalid-cap'), lock, { maxBytes: harness.LIMITS.ownedBytes + 1 }), 'resource_limit');
});
test('ignored source preflight permits only known generated locations, never dotenv or preview state', () => {
  for (const path of ['node_modules/pkg/file.js', 'scripts/browser-qa/node_modules/pkg/file.js', '.e2e/stack-status.json', '.next/server/page.js', 'next-env.d.ts', 'tsconfig.tsbuildinfo']) assert.equal(harness.allowedGeneratedPath(path), true);
  for (const path of ['.env', '.env.local', '.env.production', '.vercel/project.json', 'app/secret.ts', 'docs/private.log', 'node_modules-other/secret', 'scripts/other/node_modules/pkg/file.js']) assert.equal(harness.allowedGeneratedPath(path), false);
  refused(() => harness.allowedGeneratedPath('.e2e/../.env'), 'source_path');
  assert.equal(harness.allowedSourcePath('.env.example'), false);
});


test('closed app environment inherits only the owned nonce for detached compiler recovery', () => {
  const owner = ownerRecord(), status = { API_URL: API, ANON_KEY: 'synthetic-anon' };
  const actual = harness.closedApplicationEnvironment({ ...env, B2_PROCESS_TAG: 'attacker-value', B2_PHASE: 'enabled', APP_DIRECTORY: '/untrusted/path' }, owner, status);
  assert.equal(actual.B2_PROCESS_TAG, owner.nonce); assert.equal(Object.hasOwn(actual, 'B2_PHASE'), false); assert.equal(Object.hasOwn(actual, 'APP_DIRECTORY'), false);
  for (const marker of ['', 'bad', 'b'.repeat(63), 'B'.repeat(64)]) refused(() => harness.closedApplicationEnvironment(env, { ...owner, nonce: marker }, status), 'ownership_invalid');
});

test('registration retains exact observed PID/start/group/session and rejects birth replacement before persistence', () => {
  const discovered = row(701), saved: ProcessRow[] = []; let current: ProcessRow | null = discovered;
  const register = privateFunction('registerProcess', { processInfo: () => current, sameProcess: harness.sameProcess, refuse, join, writeProcessRecord: (_owner: unknown, value: ProcessRow) => saved.push(value) });
  const owner = ownerRecord(); const result = register(owner, discovered, 'server');
  assert.deepEqual(result, { pid: discovered.pid, start: discovered.start, group: discovered.group, session: discovered.session, label: 'server', nonce });
  for (const patch of [{ start: '900000' }, { group: 999 }, { session: 999 }]) {
    current = { ...discovered, ...patch }; refused(() => register(owner, discovered, 'server'), 'process_identity'); assert.equal(saved.length, 1);
  }
  current = null; refused(() => register(owner, discovered, 'server'), 'process_identity'); assert.equal(saved.length, 1);
});

test('snapshot-owned child replacement between discovery and registration is never recorded or signaled', async () => {
  const leader = row(711), child = row(712, { parent: 711, group: 711, session: 711 });
  const replacement = row(712, { start: '900000' }), saved: ProcessRow[] = [{ ...leader, nonce, label: 'server' }]; let reads = 0;
  const processInfo = (pid: number) => pid === leader.pid ? leader : pid === child.pid ? (++reads === 1 ? child : replacement) : null;
  const register = privateFunction('registerProcess', { processInfo, sameProcess: harness.sameProcess, refuse, join, writeProcessRecord: (_owner: unknown, value: ProcessRow) => saved.push(value) });
  const scan = privateFunction('scanOwned', { processRecords: () => saved, readdirSync: () => ['711', '712'], processInfo, sameProcess: harness.sameProcess, readFileSync: () => Buffer.from('PATH=/usr/bin\0'), registerProcess: register, refuse });
  refused(() => scan(ownerRecord()), 'process_identity'); assert.equal(saved.length, 1); assert.equal(saved.some(value => value.pid === replacement.pid), false);
  const live = new Map([[leader.pid, leader], [replacement.pid, replacement]]), signals: [number, string][] = [];
  await harness.stopOwnedProcesses(saved, { inspect: (pid: number) => live.get(pid) ?? null, kill: (pid: number, signal: string) => { signals.push([pid, signal]); live.delete(pid); }, wait: async () => {}, now: () => 0 });
  assert.deepEqual(signals, [[leader.pid, 'SIGTERM']]); assert.equal(live.get(replacement.pid), replacement);
});

test('direct spawned-child birth replacement fails before ownership persistence and never kills the replacement', async () => {
  const fake = fakeLauncher({ reuseBeforeRegister: true });
  await assert.rejects(fake.run(ownerRecord(), 'enabled-build', ['fixed-next-cli']), { code: 'process_identity' });
  assert.deepEqual(fake.records, []); assert.deepEqual(fake.signals, []); assert.equal(fake.live.get(fake.identity.pid)?.start, '900000'); assert.equal(fake.timers.size, 0);
});

test('marked detached compiler is recovered and reaped after its build parent dies before the first scan', async () => {
  const owner = ownerRecord(), original = row(721), compiler = row(722, { parent: 1, group: 722, session: 722 }), foreign = row(723);
  const records: ProcessRow[] = [{ ...original, nonce, label: 'enabled-build' }], live = new Map([[compiler.pid, compiler], [foreign.pid, foreign]]), signals: [number, string][] = [];
  const appEnv = harness.closedApplicationEnvironment(env, owner, { API_URL: API, ANON_KEY: 'synthetic-anon' });
  assert.equal(appEnv.B2_PROCESS_TAG, nonce); let portChecks = 0;
  const processInfo = (pid: number) => live.get(pid) ?? null;
  const register = privateFunction('registerProcess', { processInfo, sameProcess: harness.sameProcess, refuse, join, writeProcessRecord: (_owner: unknown, value: ProcessRow) => records.push(value) });
  const scan = privateFunction('scanOwned', {
    processRecords: () => records, readdirSync: () => [...live.keys()].map(String), processInfo, sameProcess: harness.sameProcess, registerProcess: register, refuse,
    readFileSync: (path: string) => Buffer.from(path === `/proc/${compiler.pid}/environ` ? Object.entries(appEnv).map(([key, value]) => `${key}=${value}\0`).join('') : 'PATH=/usr/bin\0'),
  });
  const reap = privateFunction('reap', { scanOwned: scan, processInfo, sameProcess: harness.sameProcess, refuse, noListener: () => { portChecks++; }, stopOwnedProcesses: (owned: ProcessRow[]) => harness.stopOwnedProcesses(owned, { inspect: processInfo, kill: (pid: number, signal: string) => { signals.push([pid, signal]); live.delete(pid); }, wait: async () => {}, now: () => 0 }) });
  await reap(owner);
  assert.equal(portChecks, 1); assert.equal(live.has(compiler.pid), false); assert.equal(live.has(foreign.pid), true); assert.deepEqual(signals, [[compiler.pid, 'SIGTERM']]);
  assert.ok(records.some(value => value.pid === compiler.pid && value.start === compiler.start && value.group === compiler.group && value.session === compiler.session));
});

function checkoutShape(root: string, options: { rootNames?: string[]; trackedTemplate?: boolean; ignored?: string[] } = {}) {
  const templateBytes = readFileSync(new URL('../.env.example', import.meta.url));
  put(root, '.env.example', templateBytes);
  const blob = createHash('sha1').update(`blob ${templateBytes.length}\0`).update(templateBytes).digest('hex');
  const calls: string[][] = []; let inventories = 0;
  const verify = privateFunction('verifyCheckout', {
    realpathSync, readFileSync, lstatSync, createHash, sha256: harness.sha256, validateRelativePath: harness.validateRelativePath, regularPath: harness.regularPath,
    readdirSync: (path: string) => { assert.equal(path, root); return options.rootNames ?? filesystem.readdirSync(path); },
    allowedSourcePath: harness.allowedSourcePath, allowedGeneratedPath: harness.allowedGeneratedPath, validateGeneratedPath: harness.validateGeneratedPath,
    validateRootEnvironmentFiles: privateFunction('validateRootEnvironmentFiles', { readdirSync: (path: string) => options.rootNames ?? filesystem.readdirSync(path), refuse }),
    validateManifest: (_manifest: unknown, selected: string[]) => { inventories++; assert.deepEqual(selected, []); return { files: [] }; },
    json: () => ({ files: [] }), inventoryDigest: harness.inventoryDigest, CONTROL_PATHS: [], LOCAL_LOGS: new Set(), MANIFEST_PATH: harness.MANIFEST_PATH, refuse,
    git: (cwd: string, args: string[]) => {
      assert.equal(cwd, root); calls.push(args);
      if (args.join(' ') === 'rev-parse --show-toplevel') return root + '\n';
      if (args.join(' ') === 'rev-parse HEAD') return commit + '\n';
      if (args.join(' ') === 'rev-parse HEAD^{tree}') return 'c'.repeat(40) + '\n';
      if (args[0] === 'status') return '';
      if (args[0] === 'ls-tree') return options.trackedTemplate === false ? '' : `100644 blob ${blob}\t.env.example\0`;
      if (args[0] === 'ls-files') return args.includes('--ignored') ? (options.ignored ?? []).map(path => path + '\0').join('') : '';
      assert.fail(`Unexpected fake Git operation ${args.join(' ')}`);
    },
  });
  // verifyCheckout validates the manifest path before its JSON adapter; the
  // reviewed manifest itself is covered separately by the strict pure tests.
  put(root, harness.MANIFEST_PATH, '{}');
  return { verify: () => verify(root, { QA_HEAD_SHA: commit }), calls, inventories: () => inventories, templateBytes };
}

test('actual tracked .env.example bytes pass clean-checkout preflight while remaining uncopied', t => {
  const root = tiny(t), fixture = checkoutShape(root), result = fixture.verify();
  assert.equal(result.commit, commit); assert.equal(fixture.inventories(), 1); assert.equal(result.protectedFileCount, 1); assert.deepEqual(result.manifest.files, []);
  assert.equal(harness.allowedSourcePath('.env.example'), false); assert.deepEqual(readFileSync(join(root, '.env.example')), fixture.templateBytes);
  assert.ok(fixture.calls.some(args => args.join(' ') === 'ls-files --others --ignored --exclude-standard -z'));
});

test('dotenv template exception requires the exact tracked name and still refuses Next-loaded or unknown files', t => {
  for (const name of ['.env', '.env.local', '.env.production', '.env.development', '.env.test', '.env.example.local', '.env.example.backup']) {
    const root = join(tiny(t), 'checkout'); mkdirSync(root); const fixture = checkoutShape(root, { rootNames: ['.env.example', name] });
    refused(() => fixture.verify(), 'environment_override'); assert.equal(fixture.inventories(), 0);
  }
  const root = tiny(t), fixture = checkoutShape(root, { trackedTemplate: false }); refused(() => fixture.verify(), 'environment_override'); assert.equal(fixture.inventories(), 0);
});

test('the exact Git ignored nested-checkout directory shape is validated without broad path normalization', t => {
  const root = tiny(t); put(root, '.e2e/libsoup-source/.git/HEAD', 'ref: refs/heads/main\n'); put(root, '.e2e/libsoup-source/source.c', '/* tiny synthetic source */');
  assert.equal(harness.validateGeneratedPath(root, '.e2e/libsoup-source/'), true);
  refused(() => harness.validateRelativePath('.e2e/libsoup-source/'), 'source_path');
  for (const path of ['.e2e/', '.e2e/stack/', 'node_modules/', '.e2e/libsoup-source//', '.e2e/./libsoup-source/', '.e2e/other/../libsoup-source/', '/.e2e/libsoup-source/']) refused(() => harness.validateGeneratedPath(root, path), 'source_path');
  const fixture = checkoutShape(root, { ignored: ['.e2e/libsoup-source/'] }); assert.equal(fixture.verify().commit, commit);
});

test('ignored nested directory validation refuses leaf/parent symlinks, files and checkout-root aliases', t => {
  const root = tiny(t), outside = join(root, 'outside'); mkdirSync(outside); const checkout = join(root, 'checkout'); mkdirSync(checkout);
  mkdirSync(join(checkout, '.e2e')); symlinkSync(outside, join(checkout, '.e2e/libsoup-source')); refused(() => harness.validateGeneratedPath(checkout, '.e2e/libsoup-source/'), 'source_path');
  rmSync(join(checkout, '.e2e/libsoup-source')); put(checkout, '.e2e/libsoup-source', 'not a directory'); refused(() => harness.validateGeneratedPath(checkout, '.e2e/libsoup-source/'), 'source_path');
  rmSync(join(checkout, '.e2e'), { recursive: true }); mkdirSync(join(outside, 'libsoup-source')); symlinkSync(outside, join(checkout, '.e2e')); refused(() => harness.validateGeneratedPath(checkout, '.e2e/libsoup-source/'), 'source_path');
  const alias = join(root, 'checkout-alias'); symlinkSync(checkout, alias); refused(() => harness.validateGeneratedPath(alias, '.e2e/libsoup-source/'), 'source_path');
});


test('owned cleanup shares the original cutoff and leaves 45 seconds plus stack-stop time', () => {
  const stop = Number(env.B2_STOP_AT_MS), share = harness.LIMITS.cleanupMs - 45_000;
  assert.equal(harness.ownedCleanupDeadline(env, stop - 30_000), stop - 30_000 + share);
  assert.equal(harness.ownedCleanupDeadline(env, stop + 30_000), stop + share);
  assert.equal(harness.ownedCleanupDeadline(env, stop + share + 1), stop + share, 'late cleanup must never reset its absolute share');
  assert.equal(Number(env.B2_JOB_DEADLINE_MS) - (stop + share), 600_000 + 45_000);
  assert.doesNotThrow(() => harness.assertCleanupTime(stop + share, stop + share - 1));
  refused(() => harness.assertCleanupTime(stop + share, stop + share), 'cleanup_failed');
});

test('process shutdown shares a finite cleanup deadline instead of claiming a fresh twenty-second budget', async () => {
  const process = row(741), graceful = processBoundary([process], true);
  await harness.stopOwnedProcesses([process], { ...graceful.boundary, deadline: 7_000 });
  assert.equal(graceful.elapsed(), 2_000); assert.deepEqual(graceful.signals, [[741, 'SIGTERM'], [741, 'SIGKILL']]);
  const stubborn = processBoundary([process], true); stubborn.boundary.kill = (pid, signal) => { stubborn.signals.push([pid, signal]); };
  await assert.rejects(harness.stopOwnedProcesses([process], { ...stubborn.boundary, deadline: 7_000 }), { code: 'cleanup_failed' }); assert.equal(stubborn.elapsed(), 7_000);
  const expired = processBoundary([process], true); expired.boundary.kill = (pid, signal) => { expired.signals.push([pid, signal]); };
  await assert.rejects(harness.stopOwnedProcesses([process], { ...expired.boundary, deadline: -1 }), { code: 'cleanup_failed' }); assert.equal(expired.elapsed(), 0); assert.deepEqual(expired.signals, [[741, 'SIGTERM'], [741, 'SIGKILL']]);
});

function diagnosticCollector() {
  const records: { stage: string; status: string; code?: string }[] = [];
  return { records, emitDiagnostic: (stage: unknown, status: unknown, error?: unknown) => { records.push(diagnosticRecord(stage, status, error)); } };
}
function runPhaseFragment(start: string, end: string, bindings: Record<string, unknown>) {
  bindings = { reportStateObserver: () => () => {}, emitExecutionDiagnostics: () => {}, ...bindings };
  const declaration = runnerAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'run');
  assert.ok(declaration && ts.isFunctionDeclaration(declaration));
  const operation = declaration.body?.statements.find(ts.isTryStatement); assert.ok(operation?.catchClause);
  const source = functionSource('run'), first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, 'The probe must use the original bounded phase source');
  return new Function(...Object.keys(bindings), `return (async () => { let stage; try { ${source.slice(first, last)} } ${operation.catchClause.getText(runnerAst)} })();`)(...Object.values(bindings));
}
test('a nonzero SQL child is diagnosed before its report read fails without reaching the SQL module import', async () => {
  for (const code of [0, 1]) {
    const diagnostics = diagnosticCollector(), report = { status: 'awaiting-cleanup', failureCode: '' }, owner = ownerRecord();
    let children = 0, reads = 0;
    const original = code === 0 ? [] : [{ stage: 'sql-gate', status: 'failed', code: 'sql_failed' }];
    await runPhaseFragment("stage = 'sql-gate';", "stage = 'stack-after';", {
      report, owner, budget: { stop: START + 1000 }, Date: { now: () => START }, ROOT: env.GITHUB_WORKSPACE, join,
      SQL_REPORT: '/synthetic/sql-report.json', process: { env }, retireReport: () => {},
      runFixed: async (_owner: unknown, label: string) => { children++; assert.equal(label, 'sql'); return { code, output: 'SENTINEL_SECRET_SQL_OUTPUT' }; },
      freshReport: () => {
        reads++; assert.deepEqual(diagnostics.records, original, 'The child exit is diagnosed before reading any result bytes');
        throw Object.assign(new Error('SENTINEL_SECRET_REPORT_READ'), { code: 'report_invalid' });
      }, refuse, safeFailure: harness.safeFailure, emitDiagnostic: diagnostics.emitDiagnostic,
    });
    assert.deepEqual(diagnostics.records, [...original, { stage: 'sql-result', status: 'failed', code: 'report_invalid' }]);
    assert.equal(children, 1); assert.equal(reads, 1); assert.equal(report.status, 'failed'); assert.equal(report.failureCode, 'report_invalid');
    assert.doesNotMatch(JSON.stringify(diagnostics.records), /SENTINEL_SECRET/);
  }
});
test('a nonzero build emits its original failure before a later reap failure in both phases', async () => {
  for (const phase of ['inactive', 'enabled']) {
    const diagnostics = diagnosticCollector(), report = { status: 'awaiting-cleanup', failureCode: '' }, owner = ownerRecord();
    let builds = 0, reaps = 0;
    await runPhaseFragment('stage = `${phase}-build`; if(Date.now()', 'stage = `${phase}-build-identity`', {
      phase, report, owner, budget: { stop: START + 1000 }, Date: { now: () => START }, ROOT: env.GITHUB_WORKSPACE, app: '/synthetic/enabled-app', join,
      process: { env }, stackBefore: { stack: { status: {} } }, closedApplicationEnvironment: () => ({}), noListener: () => {},
      runFixed: async (_owner: unknown, label: string) => { builds++; assert.equal(label, `${phase}-build`); return { code: 1, output: 'SENTINEL_SECRET_BUILD_OUTPUT' }; },
      reap: async () => {
        reaps++; assert.deepEqual(diagnostics.records, [{ stage: `${phase}-build`, status: 'failed', code: 'build_failed' }]);
        throw Object.assign(new Error('SENTINEL_SECRET_REAP'), { code: 'process_identity' });
      }, refuse, safeFailure: harness.safeFailure, emitDiagnostic: diagnostics.emitDiagnostic,
    });
    assert.deepEqual(diagnostics.records, [
      { stage: `${phase}-build`, status: 'failed', code: 'build_failed' },
      { stage: `${phase}-build-reap`, status: 'failed', code: 'process_identity' },
    ]);
    assert.equal(builds, 1); assert.equal(reaps, 1); assert.equal(report.status, 'failed'); assert.equal(report.failureCode, 'process_identity');
    assert.doesNotMatch(JSON.stringify(diagnostics.records), /SENTINEL_SECRET/);
  }
});
test('a nonzero browser result survives later report or reap failures and a prior exception is not relabeled', async () => {
  for (const phase of ['inactive', 'enabled']) for (const throws of [false, true]) for (const failsAtRead of [false, true]) {
    const diagnostics = diagnosticCollector(), owner = ownerRecord();
    const report = { status: 'awaiting-cleanup', failureCode: '', phases: { [phase]: { serverReadinessMs: 1 } } };
    const originalCode = throws ? 'resource_limit' : 'browser_failed'; let browsers = 0, reaps = 0;
    await runPhaseFragment('stage = `${phase}-browser`; let executionFailure;', 'stage = `${phase}-source-check`', {
      phase, report, owner, budget: { stop: START + 1000 }, Date: { now: () => START }, ROOT: env.GITHUB_WORKSPACE, join,
      CONFIG: 'playwright.legacy-evidence.config.ts', start: START, summary: '/synthetic/results.json', cleanupRows: [], discovered: [], identity: { commit },
      runEnvironment: () => ({}), existsSync: (path: string) => path === '/synthetic/results.json',
      freshReport: () => {
        assert.deepEqual(diagnostics.records, [{ stage: `${phase}-browser`, status: 'failed', code: originalCode }]);
        if (failsAtRead) throw Object.assign(new Error('SENTINEL_SECRET_REPORT_READ'), { code: 'report_invalid' });
        return {};
      },
      projectExecution: () => ({ status: 'passed', discovered: 0, executed: 0 }),
      runFixed: async (_owner: unknown, label: string) => {
        browsers++; assert.equal(label, 'browser');
        if (throws) throw Object.assign(new Error('SENTINEL_SECRET_BROWSER'), { code: 'resource_limit' });
        return { code: 1, durationMs: 1, peakRss: null, peakDisk: null, output: 'SENTINEL_SECRET_BROWSER_OUTPUT' };
      },
      reap: async () => {
        reaps++; assert.deepEqual(diagnostics.records, [{ stage: `${phase}-browser`, status: 'failed', code: originalCode }]);
        throw Object.assign(new Error('SENTINEL_SECRET_REAP'), { code: 'cleanup_failed' });
      }, refuse, safeFailure: harness.safeFailure, emitDiagnostic: diagnostics.emitDiagnostic,
    });
    assert.deepEqual(diagnostics.records, [
      { stage: `${phase}-browser`, status: 'failed', code: originalCode },
      { stage: `${phase}-${failsAtRead ? 'browser-result' : 'phase-reap'}`, status: 'failed', code: failsAtRead ? 'report_invalid' : 'cleanup_failed' },
    ]);
    assert.equal(browsers, 1); assert.equal(reaps, failsAtRead ? 0 : 1); assert.equal(report.status, 'failed'); assert.equal(report.failureCode, failsAtRead ? 'report_invalid' : 'cleanup_failed');
    assert.doesNotMatch(JSON.stringify(diagnostics.records), /SENTINEL_SECRET/);
  }
});
test('an original run failure survives later teardown failures and throwing console sinks without skipping persistence', async () => {
  for (const cleanupFails of [false, true]) for (const sinkThrows of [false, true]) {
    const owner = ownerRecord(), diagnostics = diagnosticCollector(), actions: string[] = [];
    const emitDiagnostic = privateFunction('emitDiagnostic', {
      diagnosticLine: harness.diagnosticLine,
      console: { error: (line: string) => {
        assert.equal(line.startsWith(diagnosticPrefix), true); diagnostics.records.push(JSON.parse(line.slice(diagnosticPrefix.length)));
        if (sinkThrows) throw new Error('SENTINEL_SECRET_CONSOLE_SINK');
      } },
    });
    const report = { status: 'failed', failureCode: 'harness_failed', cleanup: { processes: 'unverified', source: 'unverified', normalBuild: 'unverified' } };
    const identity = { commit, tree: 'c'.repeat(40), fullTrackedDigest: 'd'.repeat(64), protectedDigest: 'e'.repeat(64), protectedFileCount: 1, manifest: { digest: 'f'.repeat(64), fileCount: 2, byteCount: 1 }, controls: [] };
    const fakeProcess = Object.assign(new EventEmitter(), { env: { ...env, HOME: '/synthetic/SENTINEL_SECRET_HOME', TOKEN: 'SENTINEL_SECRET_TOKEN' }, exitCode: 0 });
    let checkoutReads = 0;
    const run = privateFunction('run', {
      initialReport: () => report, runtimeStop: new AbortController(), process: fakeProcess, Date: { now: () => START }, ROOT: env.GITHUB_WORKSPACE,
      validateRunner: () => harness.validateBudget(env, START), verifyCheckout: () => {
        if (++checkoutReads > 1 && cleanupFails) throw Object.assign(new Error('SENTINEL_SECRET_SOURCE'), { code: 'source_path' });
        return identity;
      }, noListener: () => {}, createOwner: () => owner, join, realpathSync: (path: string) => path,
      writeJson: (_path: string, value: { report: unknown }) => { assert.equal(value.report, report); actions.push('state'); },
      stackIdentity: async () => { throw Object.assign(new Error('SENTINEL_SECRET_ORIGINAL'), { code: 'sql_failed', output: 'SENTINEL_SECRET_CHILD_OUTPUT' }); },
      reap: async () => { assert.equal(diagnostics.records[0]?.code, 'sql_failed', 'The original failure must be emitted before any finally cleanup'); actions.push('reap'); if (cleanupFails) throw Object.assign(new Error('SENTINEL_SECRET_PROCESS'), { code: 'process_identity' }); },
      buildIdentity: () => assert.fail('No build ran, so its identity must remain unverified'),
      safeFailure: harness.safeFailure, refuse, emitDiagnostic,
      saveReport: (value: unknown) => { assert.equal(value, report); actions.push('report'); },
    });
    await run();
    assert.deepEqual(diagnostics.records, [
      { stage: 'stack-before', status: 'failed', code: 'sql_failed' },
      { stage: 'run-cleanup-processes', status: cleanupFails ? 'failed' : 'passed', ...(cleanupFails ? { code: 'process_identity' } : {}) },
      { stage: 'run-cleanup-source', status: cleanupFails ? 'failed' : 'passed', ...(cleanupFails ? { code: 'source_path' } : {}) },
      { stage: 'run-cleanup-build', status: 'unverified' },
    ]);
    assert.deepEqual(actions, ['state', 'reap', 'state', 'report']); assert.equal(checkoutReads, 2);
    assert.equal(report.status, 'failed'); assert.equal(report.failureCode, cleanupFails ? 'source_changed' : 'sql_failed', 'Existing report failure precedence is unchanged');
    assert.equal(fakeProcess.exitCode, 1); assert.equal(fakeProcess.listenerCount('SIGINT'), 0); assert.equal(fakeProcess.listenerCount('SIGTERM'), 0);
    assert.doesNotMatch(JSON.stringify(diagnostics.records), /SENTINEL_SECRET/);
  }
});
test('run preflight failure is diagnosed without inventing cleanup for an owner that was never created', async () => {
  const diagnostics = diagnosticCollector(), report = { status: 'failed', failureCode: 'harness_failed' };
  const fakeProcess = Object.assign(new EventEmitter(), { env, exitCode: 0 }); let saved = 0;
  const run = privateFunction('run', {
    initialReport: () => report, runtimeStop: new AbortController(), process: fakeProcess, ROOT: env.GITHUB_WORKSPACE,
    validateRunner: () => { throw Object.assign(new Error('SENTINEL_SECRET_PREFLIGHT'), { code: 'environment_override' }); },
    safeFailure: harness.safeFailure, emitDiagnostic: diagnostics.emitDiagnostic, saveReport: () => { saved++; },
    reap: () => assert.fail('No owner exists to reap'), verifyCheckout: () => assert.fail('Failed preflight cannot inspect checkout'),
  });
  await run(); assert.deepEqual(diagnostics.records, [{ stage: 'runner-preflight', status: 'failed', code: 'environment_override' }]);
  assert.equal(saved, 1); assert.equal(report.failureCode, 'environment_override'); assert.equal(fakeProcess.exitCode, 1);
});

test('expired owned cleanup still attempts verified process stop and saves failure without deleting unchecked data', async () => {
  const owner = ownerRecord(), fakeProcess = { env, exitCode: 0 }, actions: string[] = [], diagnostics = diagnosticCollector();
  const report = { status: 'awaiting-cleanup', cleanup: { processes: 'unverified', source: 'unverified', normalBuild: 'unverified', copy: 'unverified', stack: 'unverified' } };
  const cleanup = privateFunction('cleanup', {
    validateRunner: () => {}, process: fakeProcess, ROOT: env.GITHUB_WORKSPACE, OWNER_PATH: '.e2e/legacy-evidence-b2-owner.json', existsSync: () => true,
    join, readOwner: () => owner, ownedCleanupDeadline: () => 0, regularPath: (_root: string, path: string) => path, json: () => ({ report }), Date: { now: () => 1 },
    reap: async (_owner: unknown, deadline: number) => { assert.equal(deadline, 0); actions.push('stop-owned'); }, assertCleanupTime: (deadline: number) => harness.assertCleanupTime(deadline, 1),
    safeFailure: harness.safeFailure, emitDiagnostic: diagnostics.emitDiagnostic, saveReport: (value: unknown) => { assert.equal(value, report); actions.push('report'); }, rmSync: () => assert.fail('expired cleanup must not delete unchecked source'),
    verifyCheckout: () => assert.fail('expired cleanup must not start source traversal'),
  });
  await cleanup(); assert.deepEqual(actions, ['stop-owned', 'report']); assert.equal(report.status, 'failed'); assert.equal(report.cleanup.processes, 'passed'); assert.equal(report.cleanup.copy, 'failed'); assert.equal(fakeProcess.exitCode, 1);
  assert.deepEqual(diagnostics.records, [
    { stage: 'cleanup-processes', status: 'passed' },
    { stage: 'cleanup-source', status: 'failed', code: 'cleanup_failed' },
    { stage: 'cleanup-build', status: 'failed', code: 'cleanup_failed' },
    { stage: 'cleanup-copy', status: 'failed', code: 'cleanup_failed' },
  ]);
});
test('owned cleanup diagnoses each independent failure instead of exporting only the last overwritten report code', async () => {
  const owner = ownerRecord(), diagnostics = diagnosticCollector(), fakeProcess = { env, exitCode: 0 };
  const report = { status: 'failed', failureCode: 'browser_failed', cleanup: { processes: 'unverified', source: 'unverified', normalBuild: 'unverified', copy: 'unverified' } };
  const fail = (code: string): never => { throw Object.assign(new Error('SENTINEL_SECRET_CLEANUP'), { code, output: 'SENTINEL_SECRET_OUTPUT' }); };
  let saved = 0;
  const cleanup = privateFunction('cleanup', {
    validateRunner: () => {}, process: fakeProcess, ROOT: env.GITHUB_WORKSPACE, OWNER_PATH: '.e2e/legacy-evidence-b2-owner.json', existsSync: () => true,
    join, readOwner: () => owner, ownedCleanupDeadline: () => START + 1000, regularPath: (_root: string, path: string) => path,
    json: () => ({ report, builds: { inactive: {} } }), Date: { now: () => START }, assertCleanupTime: () => {},
    reap: async () => fail('process_identity'), verifyCheckout: () => fail('source_path'), buildIdentity: () => fail('report_invalid'),
    ownedUsage: () => assert.fail('An unreaped copy must not be traversed for deletion'), rmSync: () => assert.fail('An unreaped copy must not be deleted'),
    refuse, safeFailure: harness.safeFailure, emitDiagnostic: diagnostics.emitDiagnostic, saveReport: () => { saved++; },
  });
  await cleanup();
  assert.deepEqual(diagnostics.records, [
    { stage: 'cleanup-processes', status: 'failed', code: 'process_identity' },
    { stage: 'cleanup-source', status: 'failed', code: 'source_path' },
    { stage: 'cleanup-build', status: 'failed', code: 'report_invalid' },
    { stage: 'cleanup-copy', status: 'failed', code: 'cleanup_failed' },
  ]);
  assert.equal(report.failureCode, 'cleanup_failed'); assert.equal(saved, 1); assert.equal(fakeProcess.exitCode, 1);
});
test('successful owned cleanup emits four passed outcomes while preserving an earlier run failure', async () => {
  const owner = ownerRecord(), diagnostics = diagnosticCollector(), fakeProcess = { env, exitCode: 0 }, removed: string[] = [];
  const report = { status: 'failed', failureCode: 'sql_failed', cleanup: { processes: 'unverified', source: 'unverified', normalBuild: 'unverified', copy: 'unverified' } };
  const state = { report, source: { fullTrackedDigest: 'synthetic-source' }, builds: { inactive: { digest: 'synthetic-build' } } };
  let ownedExists = true, saved = 0;
  const cleanup = privateFunction('cleanup', {
    validateRunner: () => {}, process: fakeProcess, ROOT: env.GITHUB_WORKSPACE, OWNER_PATH: '.e2e/legacy-evidence-b2-owner.json', existsSync: (path: string) => path === owner.directory ? ownedExists : true,
    join, readOwner: () => owner, ownedCleanupDeadline: () => START + 1000, regularPath: (_root: string, path: string) => path,
    json: () => state, Date: { now: () => START }, assertCleanupTime: () => {}, reap: async () => {}, verifyCheckout: () => state.source, buildIdentity: () => state.builds.inactive,
    ownedUsage: () => 0, validateOwnerRecord: () => {}, rmSync: (path: string) => { removed.push(path); if (path === owner.directory) ownedExists = false; },
    refuse, safeFailure: harness.safeFailure, emitDiagnostic: diagnostics.emitDiagnostic, saveReport: () => { saved++; },
  });
  await cleanup(); assert.deepEqual(diagnostics.records, ['processes', 'source', 'build', 'copy'].map(stage => ({ stage: `cleanup-${stage}`, status: 'passed' })));
  assert.deepEqual(removed, [owner.directory, join(env.GITHUB_WORKSPACE, '.e2e/legacy-evidence-b2-owner.json')]);
  assert.equal(report.status, 'failed'); assert.equal(report.failureCode, 'sql_failed'); assert.equal(saved, 1); assert.equal(fakeProcess.exitCode, 1);
});
test('cleanup without an owner reports only a previously verified copy result or an unverified outcome', async () => {
  for (const priorCopy of ['passed', 'unverified', 'failed']) {
    const diagnostics = diagnosticCollector(), fakeProcess = { env, exitCode: 0 };
    const report = { status: 'awaiting-cleanup', cleanup: { copy: priorCopy } }; let saved = 0;
    const cleanup = privateFunction('cleanup', {
      validateRunner: () => {}, process: fakeProcess, ROOT: env.GITHUB_WORKSPACE, OWNER_PATH: '.e2e/legacy-evidence-b2-owner.json', REPORT_PATH: '.e2e/evidence/legacy-evidence-b2-results.json',
      existsSync: (path: string) => path.endsWith('legacy-evidence-b2-results.json'), join, json: () => report,
      emitDiagnostic: diagnostics.emitDiagnostic, saveReport: () => { saved++; },
      readOwner: () => assert.fail('Absent ownership cannot be inspected'), reap: () => assert.fail('Absent ownership cannot be reaped'),
    });
    await cleanup(); assert.deepEqual(diagnostics.records, [{ stage: 'cleanup-copy', status: priorCopy === 'passed' ? 'passed' : 'unverified' }]);
    assert.equal(fakeProcess.exitCode, priorCopy === 'passed' ? 0 : 1); assert.equal(saved, priorCopy === 'passed' ? 0 : 1);
  }
});
test('finalize separately diagnoses stack proof and aggregate status without curing an earlier failure', async () => {
  for (const outcome of ['passed', 'prior-failure', 'stack-failure', 'unknown-stack-failure']) {
    const diagnostics = diagnosticCollector(), fakeProcess = { env: { ...env, B2_STACK_STOP_EXIT: '0' }, exitCode: 0 };
    const report = { status: outcome === 'prior-failure' ? 'failed' : 'awaiting-cleanup', failureCode: outcome === 'prior-failure' ? 'browser_failed' : undefined,
      cleanup: { processes: 'passed', source: 'passed', normalBuild: 'passed', copy: 'passed', accounts: 'passed', stack: 'unverified' } };
    const proof = { run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, job: env.GITHUB_JOB, commit, stack: { ids: ['synthetic-id'], volumes: ['synthetic-volume'] } };
    const root = env.GITHUB_WORKSPACE, reportPath = '.e2e/evidence/legacy-evidence-b2-results.json'; let saved = 0, inspections = 0;
    const finalize = privateFunction('finalize', {
      process: fakeProcess, ROOT: root, REPORT_PATH: reportPath, OWNER_PATH: '.e2e/legacy-evidence-b2-owner.json', join,
      existsSync: (path: string) => path === join(root, reportPath), json: (path: string) => path === join(root, reportPath) ? report : proof,
      regularPath: (root: string, path: string) => join(root, path), validateRunner: () => {},
      execFileSync: (command: string, args: string[]) => {
        assert.equal(command, 'docker'); assert.deepEqual(args.slice(0, 2), ['--context', 'default']); inspections++;
        if (outcome.includes('stack-failure')) throw Object.assign(new Error('SENTINEL_SECRET_STACK'), { code: outcome === 'stack-failure' ? 'ownership_invalid' : 'SENTINEL_SECRET_CODE' });
        return '';
      }, refuse, safeFailure: harness.safeFailure, emitDiagnostic: diagnostics.emitDiagnostic, saveReport: () => { saved++; },
    });
    await finalize();
    const stackFailed = outcome.includes('stack-failure'), code = stackFailed ? outcome === 'stack-failure' ? 'ownership_invalid' : 'harness_failed' : 'browser_failed';
    assert.deepEqual(diagnostics.records, [
      { stage: 'finalize-stack', status: stackFailed ? 'failed' : 'passed', ...(stackFailed ? { code } : {}) },
      { stage: 'finalize-result', status: outcome === 'passed' ? 'passed' : 'failed', ...(outcome === 'passed' ? {} : { code }) },
    ]);
    assert.equal(report.cleanup.stack, stackFailed ? 'unverified' : 'passed'); assert.equal(report.status, outcome === 'passed' ? 'passed' : 'failed');
    assert.equal(saved, 1); assert.equal(inspections, stackFailed ? 1 : 2); assert.equal(fakeProcess.exitCode, outcome === 'passed' ? 0 : 1);
    assert.doesNotMatch(JSON.stringify(diagnostics.records), /SENTINEL_SECRET/);
  }
});

const scenarioSource = readFileSync(new URL('./e2e/legacy-evidence-review.spec.ts', import.meta.url), 'utf8');
const scenarioAst = ts.createSourceFile('legacy-evidence-review.spec.ts', scenarioSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function scenarioHelper(name: string, bindings: Record<string, unknown>) {
  const declaration = scenarioAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration && ts.isFunctionDeclaration(declaration), `Missing scenario helper ${name}`);
  const compiled = ts.transpileModule(declaration.getText(scenarioAst), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}\nreturn ${name};`)(...Object.values(bindings));
}
function scenarioBody(prefix: string) {
  const statement = scenarioAst.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'test'
    && ts.isStringLiteral(node.expression.arguments[0]) && node.expression.arguments[0].text.startsWith(prefix));
  assert.ok(statement && ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression));
  return statement.expression.arguments[1].getText(scenarioAst);
}
function scenarioBoolean(label: string, bindings: Record<string, unknown>): boolean {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expect' && node.arguments.length >= 2
      && ts.isStringLiteral(node.arguments[1]) && node.arguments[1].text === label) {
      assert.equal(expression, undefined, 'The fixed assertion label must be unique'); expression = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(scenarioAst); assert.ok(expression && ts.isCallExpression(expression));
  assert.equal(expression.expression.getText(scenarioAst), 'Boolean', 'Private values must be projected before assertion');
  const compiled = ts.transpileModule(`const result = ${expression.getText(scenarioAst)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}\nreturn result;`)(...Object.values(bindings));
}
function ordered(source: string, fragments: string[]) {
  let offset = 0;
  for (const fragment of fragments) { const next = source.indexOf(fragment, offset); assert.ok(next >= offset, `Missing ordered barrier ${fragment}`); offset = next + fragment.length; }
}
function deferredGate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('E3 close barrier awaits exact durable closure and journal before completed UI dismissal', async () => {
  const expected = { runId: 'run', episodeId: 'episode', generationId: 'generation' };
  const correctRun = { immutable: { runId: 'run', episodeId: 'episode' }, generationId: 'generation', state: { lifecycle: 'closed', latestTransitionId: 'transition' } };
  const correctJournal = { runId: 'run', transitionId: 'transition', operation: { kind: 'close_unavailable' }, scope: { generationId: 'generation' }, after: { runState: { lifecycle: 'closed', latestTransitionId: 'transition' } } };
  let local = { runs: [{ ...correctRun, state: { ...correctRun.state, lifecycle: 'active' } }], journals: [correctJournal] };
  const durable = deferredGate(), dismissed = deferredGate(), selected = deferredGate(), stages: string[] = [];
  let predicate: (() => Promise<boolean>) | undefined, done = false;
  const question = {}, prompt = {}, page = { getByText: () => prompt };
  const fakeExpect = Object.assign((target: unknown) => ({
    toHaveCount: async (count: number) => { assert.equal(target, question); assert.equal(count, 0); stages.push('question-dismissal'); await dismissed.promise; },
    toBeVisible: async () => { assert.equal(target, prompt); stages.push('selection-visible'); await selected.promise; },
  }), { poll: (callback: () => Promise<boolean>) => { predicate = callback; return { toBe: async (value: boolean) => { assert.equal(value, true); stages.push('durable-close'); await durable.promise; assert.equal(await callback(), true); } }; } });
  const wait = scenarioHelper('waitClosedAndDismissed', { expect: fakeExpect, native: async () => local, runs: (value: typeof local) => value.runs, journals: (value: typeof local) => value.journals, question: () => question });
  const pending = wait(page, expected).then(() => { done = true; }); await flushMicrotasks(); assert.ok(predicate); assert.equal(await predicate(), false); assert.equal(done, false);
  for (const patch of [{ immutable: { runId: 'foreign', episodeId: 'episode' } }, { immutable: { runId: 'run', episodeId: 'foreign' } }, { generationId: 'foreign' }]) {
    local = { runs: [{ ...correctRun, ...patch }], journals: [correctJournal] }; assert.equal(await predicate(), false);
  }
  for (const patch of [{ runId: 'foreign' }, { transitionId: 'foreign' }, { operation: { kind: 'answer' } }, { scope: { generationId: 'foreign' } }, { after: { runState: { lifecycle: 'active', latestTransitionId: 'transition' } } }, { after: { runState: { lifecycle: 'closed', latestTransitionId: 'foreign' } } }]) {
    local = { runs: [correctRun], journals: [{ ...correctJournal, ...patch }] }; assert.equal(await predicate(), false);
  }
  local = { runs: [correctRun], journals: [correctJournal] }; assert.equal(await predicate(), true); durable.resolve(); await flushMicrotasks(); assert.deepEqual(stages, ['durable-close', 'question-dismissal']); assert.equal(done, false);
  dismissed.resolve(); await flushMicrotasks(); assert.deepEqual(stages, ['durable-close', 'question-dismissal', 'selection-visible']); assert.equal(done, false); selected.resolve(); await pending; assert.equal(done, true);
  ordered(scenarioBody('E3 '), ["await confirmDialog(page, button(page, '기록형 복습 종료 확인'), true)", 'await waitClosedAndDismissed(page, typedRun)', 'await page.goto(captureUrl(sample.typed.id))']);
});

test('E12 close-refusal barrier observes this held action and drains it before crediting refusal', async () => {
  const arrived = deferredGate(), drained = deferredGate(), settled = deferredGate(), stages: string[] = [];
  const close = {}, recover = {}, unavailable = {}, page = { getByText: () => unavailable }; let done = false;
  const traffic = { hold: (rpc: string, stage: string) => { assert.equal(rpc, 'status'); assert.equal(stage, 'response'); stages.push('armed'); return { arrived: arrived.promise, release: () => stages.push('released') }; }, drain: { wait: async () => { stages.push('drain'); await drained.promise; } } };
  const fakeExpect = (target: unknown) => ({
    toBeDisabled: async () => { assert.equal(target, close); stages.push('observed-busy'); },
    toBeEnabled: async () => { stages.push(target === close ? 'close-ready' : 'recover-ready'); assert.ok(target === close || target === recover); await settled.promise; },
    toBeVisible: async () => { assert.equal(target, unavailable); stages.push('refused'); },
  });
  const wait = scenarioHelper('awaitUnavailableCloseRefusal', { expect: fakeExpect, button: () => close, recoverButton: () => recover, rpc: { status: 'status' }, confirmDialog: async () => { stages.push('clicked'); } });
  const pending = wait(page, traffic).then(() => { done = true; }); await flushMicrotasks(); assert.deepEqual(stages, ['armed', 'clicked']); assert.equal(done, false);
  arrived.resolve(); await flushMicrotasks(); assert.deepEqual(stages, ['armed', 'clicked', 'observed-busy', 'released', 'drain']); assert.equal(done, false);
  drained.resolve(); await flushMicrotasks(); assert.equal(stages.at(-1), 'close-ready'); assert.equal(done, false);
  settled.resolve(); await pending; assert.deepEqual(stages.slice(-3), ['close-ready', 'recover-ready', 'refused']); assert.equal(done, true);
  ordered(scenarioBody('E12 '), ['const pendingClose = await native(page)', 'await awaitUnavailableCloseRefusal(page, traffic)', 'const refusedClose = await native(page)', 'equal(retainedRun, pendingRun', 'pendingHandoff', 'equal(events(refusedClose), events(pendingClose)', 'equal(journals(refusedClose), journals(pendingClose)', "row.operation.kind === 'close_unavailable'", 'await page.reload()']);
});

test('E12 refusal helper releases its held route even when the confirmed action fails', async () => {
  const failure = new Error('synthetic failure'); let released = 0;
  const wait = scenarioHelper('awaitUnavailableCloseRefusal', { button: () => ({}), rpc: { status: 'status' }, confirmDialog: async () => { throw failure; }, expect: () => assert.fail('failed click cannot be credited as completed refusal') });
  await assert.rejects(wait({}, { hold: () => ({ arrived: Promise.resolve(), release: () => { released++; } }) }), error => error === failure); assert.equal(released, 1);
});

test('E4 pending-hint proof acquires the current draft and targets its input before awaited refusal', () => {
  const scenario = scenarioBody('E4 ');
  ordered(scenario, ['const currentDraft = typedRun.state.currentDraftToken', 'await peer.reload()', 'await begin(peer)', 'peerRun.state.currentDraftToken === currentDraft', "getAttribute('data-review-draft') === currentDraft", "await page.evaluate(() => window.__b2.armAbort('observed_hint'))", 'await recoverButton(peer).click()', 'await expect(input(peer)).toBeEditable()', 'await expect(recoverButton(peer)).toHaveCount(0)', 'recoveredRun.state.currentDraftToken === currentDraft', "await input(peer).fill('b2-pending-hint-answer')", 'await input(peer).focus()', 'await expect(input(peer)).toBeFocused()', "await input(peer).press('Enter')", 'await expect(recoverButton(peer)).toBeEnabled()', "await expect(input(peer)).not.toBeEditable()", 'const refused = await native(peer)', 'typedBeforeHintAnswer']);
  assert.doesNotMatch(scenario.slice(scenario.indexOf('const currentDraft')), /peer\.keyboard\.press\(/);
});

test('E2 and E4 retry assertions retain applied history and reject changed or pending handoffs', () => {
  const applied = { status: 'applied', draftToken: 'old-draft', eventId: 'old-event', answer: 'synthetic-private-answer' };
  const canonical = JSON.stringify;
  for (const prefix of ['E2', 'E4']) {
    const bindings = { canonical, committedDraft: 'old-draft', wrong: applied, priorHandoff: applied, retryCheckpoint: { handoff: applied } };
    const label = `B2_${prefix}_RETRY_RETAINS_APPLIED_HANDOFF`;
    assert.equal(scenarioBoolean(label, bindings), true);
    for (const handoff of [null, { ...applied, status: 'pending' }, { ...applied, draftToken: 'new-draft' }, { ...applied, eventId: 'other-event' }, { ...applied, answer: 'changed' }]) {
      assert.equal(scenarioBoolean(label, { ...bindings, retryCheckpoint: { handoff } }), false);
    }
    const body = scenarioBody(`${prefix} `);
    ordered(body, [`B2_${prefix}_RETRY_RETAINS_APPLIED_HANDOFF`, `B2_${prefix}_RETRY_NEW_DRAFT_READY`, `B2_${prefix}_RETRY_CLEAR_ACKNOWLEDGED`, `B2_${prefix}_RETRY_NO_ANSWER_EVENT`]);
    assert.doesNotMatch(body.slice(body.indexOf('const retried')), /handoff\s*===\s*null/);
    assert.ok(body.includes('retryAcknowledgement.after.runState'));
    assert.ok(body.includes('retryRun?.state.latestTransitionId') || body.includes('typedRun.state.latestTransitionId'));
  }
  assert.doesNotMatch(scenarioBody('E2 '), /\brequireTrue\(/, 'E2 boolean assertions keep distinct sanitized source locations');
});

test('E8 closure authority checks reject a foreign, undelivered-as-success, or mismatched status', () => {
  const marker = { present: false, value: null }, context = { ownerId: 'owner', generationId: 'generation', resetMarker: marker };
  const heldStatus = { upstream: true, status: 200, delivered: false, body: { expected_owner: 'owner', expected_marker: marker } };
  const proof = { status: 'enrolled', ownerId: 'owner', resetMarker: marker, currentContext: context };
  const bindings = { canonical: JSON.stringify, qa: { account: { id: 'owner' } }, run: { generationId: 'generation' }, heldStatus, proof };
  const label = 'B2_E8_CLOSURE_AUTHORITY_HELD'; assert.equal(scenarioBoolean(label, bindings), true);
  for (const patch of [{ upstream: false }, { status: 500 }, { delivered: true },
    { body: { ...heldStatus.body, expected_owner: 'foreign' } }, { body: { ...heldStatus.body, expected_marker: { present: true, value: 'other' } } }]) {
    assert.equal(scenarioBoolean(label, { ...bindings, heldStatus: { ...heldStatus, ...patch } }), false);
  }
  for (const patch of [{ status: 'unenrolled' }, { ownerId: 'foreign' }, { resetMarker: { present: true, value: 'other' } },
    { currentContext: { ...context, ownerId: 'foreign' } }, { currentContext: { ...context, generationId: 'other' } },
    { currentContext: { ...context, resetMarker: { present: true, value: 'other' } } }]) {
    assert.equal(scenarioBoolean(label, { ...bindings, proof: { ...proof, ...patch } }), false);
  }
});

test('E8 exact retirement checks bind the run and journal before intentional status loss', () => {
  const immutable = { runId: 'run', sourceSlotKey: 'slot', originalSource: { arrayBytes: 'synthetic' } };
  const state = { lifecycle: 'retiring', retirement: { kind: 'defer', outcome: null, retirementId: 'retirement' } };
  const retiringRun = { immutable, state };
  const retirementJournal = { operation: { kind: 'begin_retirement', retirementKind: 'defer' }, scope: { ownerId: 'owner', generationId: 'generation' }, actionId: 'retirement', after: { runState: state } };
  const bindings = { canonical: JSON.stringify, qa: { account: { id: 'owner' } }, run: { immutable, generationId: 'generation' }, retiringRun, retirementJournal };
  const label = 'B2_E8_EXACT_RETIREMENT_HELD'; assert.equal(scenarioBoolean(label, bindings), true);
  for (const patch of [{ immutable: { ...immutable, runId: 'foreign' } }, { state: { ...state, lifecycle: 'closed' } },
    { state: { ...state, retirement: { ...state.retirement, kind: 'schedule' } } }, { state: { ...state, retirement: { ...state.retirement, outcome: {} } } }]) {
    assert.equal(scenarioBoolean(label, { ...bindings, retiringRun: { ...retiringRun, ...patch } }), false);
  }
  for (const patch of [{ operation: { kind: 'close_retirement' } }, { scope: { ownerId: 'foreign', generationId: 'generation' } },
    { scope: { ownerId: 'owner', generationId: 'foreign' } }, { actionId: 'other' }, { after: { runState: { ...state, lifecycle: 'closed' } } }]) {
    assert.equal(scenarioBoolean(label, { ...bindings, retirementJournal: { ...retirementJournal, ...patch } }), false);
  }
  const body = scenarioBody('E8 ');
  ordered(body, ["traffic.hold(rpc.status, 'loss')", "await button(page, '내일 다시 볼래요').click()", 'await held.arrived',
    'B2_E8_CLOSURE_AUTHORITY_HELD', 'B2_E8_EXACT_RETIREMENT_HELD', 'B2_E8_NO_CLOSE_BEFORE_AUTHORITY', 'await expect.poll(',
    'await expect(ordinaryReady(page)).toBeVisible()', 'B2_E8_SINGLE_LEGACY_SAVE_ACKNOWLEDGED', "changed.set([0, 'unknownSyntheticField']",
    'B2_E8_QUERY_RETAINS_PINNED_RUN', 'held.release()', 'await traffic.drain.wait()', 'await expect(recoverButton(page)).toBeEnabled()',
    'await page.goto(captureUrl(sample.typed.id))', 'B2_E8_RELOAD_RETAINS_EXACT_RETIREMENT', 'B2_E8_RELOAD_NEVER_REDISPATCHES_LEGACY_SAVE',
    "window.__b2.armAbort('close_retirement')", 'await recover(page)', 'Closure recovery never redispatches or edits original legacy schedule']);
  assert.match(body, /finally\s*\{\s*held\.release\(\);\s*\}/);
  assert.doesNotMatch(body, /holdNext\('PATCH'/, 'Background synchronization cannot substitute for the closure authority barrier');
  assert.ok(body.includes("button(page, '기록형 복습 종료 확인')).toHaveCount(0)"));
});

test('E4 and E12 retain genuine focus-loss assertions without synthetic focus substitution', () => {
  assert.ok(scenarioBody('E4 ').includes("await expect.poll(() => peer.evaluate(() => !document.hasFocus()), { message: 'Competing action genuinely loses focus' }).toBe(true)"));
  assert.ok(scenarioBody('E12 ').includes("await expect.poll(() => page.evaluate(() => !document.hasFocus()), { message: 'Interruption uses genuine page blur' }).toBe(true)"));
  assert.doesNotMatch(scenarioSource, /newCDPSession|setFocusEmulationEnabled|setActiveAndFocused|dispatchEvent\(['"](?:blur|visibilitychange)/);
});

test('native frame observation counts distinct original timestamps and still invokes every original callback', () => {
  let assignment: ts.BinaryExpression | undefined;
  function visit(node: ts.Node) { if (ts.isBinaryExpression(node) && node.left.getText(scenarioAst) === 'window.requestAnimationFrame') assignment = node; ts.forEachChild(node, visit); }
  visit(scenarioAst); assert.ok(assignment);
  const compiled = ts.transpileModule(`let lastFrameTimestamp = -1; const observed = ${assignment.right.getText(scenarioAst)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const facts = { frames: 0 }, scheduled: ((time: number) => void)[] = [], callbacks: number[] = [];
  const observed = new Function('originalFrame', 'facts', `${compiled}\nreturn observed;`)((callback: (time: number) => void) => { scheduled.push(callback); return scheduled.length; }, facts);
  for (let count = 0; count < 3; count++) observed((time: number) => callbacks.push(time));
  scheduled[0](100); scheduled[1](100); scheduled[2](116); assert.equal(facts.frames, 2); assert.deepEqual(callbacks, [100, 100, 116]);
});

test('first observed spawn identity must belong to this parent and its detached group/session', async () => {
  for (const patch of [{ parent: 1 }, { group: 999 }, { session: 999 }]) {
    const fake = fakeLauncher({ firstIdentity: patch }); await assert.rejects(fake.run(ownerRecord(), 'enabled-build', ['fixed-next-cli']), { code: 'process_identity' });
    assert.deepEqual(fake.records, []); assert.deepEqual(fake.signals, []); assert.deepEqual(fake.stopped, []); assert.equal(fake.live.has(fake.identity.pid), true);
  }
});

test('registered child reused before first shutdown receives neither TERM nor KILL and cleanup refuses', async () => {
  const fake = fakeLauncher(), rejected = assert.rejects(fake.run(ownerRecord(), 'browser', [], { timeout: 10 }), { code: 'process_identity' });
  await flushMicrotasks(); assert.equal(fake.records.length, 1); assert.equal(fake.records[0].start, fake.identity.start);
  const replacement = row(fake.identity.pid, { start: '900000', parent: 1 }); fake.live.set(fake.identity.pid, replacement);
  fake.advance(100); assert.deepEqual(fake.signals, [], 'Initial TERM must recheck the persisted birth identity');
  fake.advance(20_000); assert.deepEqual(fake.signals, [], 'Forced KILL must not target the replacement either');
  fake.advance(5_000); await rejected;
  assert.deepEqual(fake.signals, []); assert.equal(fake.live.get(fake.identity.pid), replacement); assert.equal(fake.records[0].start, fake.identity.start); assert.equal(fake.timers.size, 0);
});

// Bounded detail diagnostics never change report acceptance or process behavior.
const detailPrefix = '[legacy-evidence-b2-detail] ';
const parseDetails = (lines: string[]) => lines.map(line => { assert.ok(line.startsWith(detailPrefix)); assert.doesNotMatch(line, /[\r\n\x1b]|SENTINEL_SECRET/); return JSON.parse(line.slice(detailPrefix.length)); });
function executionDetails(phase: 'inactive' | 'enabled', raw = execution(phase)) {
  const lines: string[] = []; const projected = harness.projectExecution(raw, phase, commit);
  harness.emitExecutionDiagnostics(raw, projected, phase, (line: string) => lines.push(line));
  return parseDetails(lines);
}
test('detail summaries use canonical case IDs and distinguish execution from harness acceptance', () => {
  for (const phase of ['inactive', 'enabled'] as const) {
    const raw = execution(phase); raw.results[0].status = 'timedOut'; raw.results[1].status = 'skipped'; raw.results.pop();
    const records = executionDetails(phase, raw), expected = phase === 'inactive' ? 8 : 28;
    assert.deepEqual(records[0], { kind: 'execution-summary', phase, executionStatus: 'failed', discovered: expected, executed: expected - 1, passed: expected - 3, failed: 1, unrun: 2 });
    assert.equal(records.length, expected + 1); assert.deepEqual(records[1], { kind: 'case', phase, project: 'auth-preservation', case: 'A1', status: 'timedOut' });
    assert.equal(records[5].case, phase === 'inactive' ? 'I1' : 'E1');
    assert.doesNotMatch(JSON.stringify(records), /"title"|duration|harnessStatus/);
  }
});
test('failed-case details reproject only fixed kinds, categories and exact source locations', () => {
  const raw = execution('enabled'); raw.results[4].status = 'failed';
  Object.assign(raw.results[4], { failure: { errors: [
    { kind: 'timeout', location: { file: 'tests/e2e/legacy-evidence-review.spec.ts', line: 487, column: 7 }, message: 'SENTINEL_SECRET' },
    { kind: 'SENTINEL_SECRET', location: { file: '/secret/tests/e2e/fixture.ts', line: 1, column: 1 } },
  ], steps: [{ category: 'expect', kind: 'other', location: { file: 'tests/e2e/fixture.ts', line: 1, column: 1 }, title: 'SENTINEL_SECRET' }] }, attachments: ['SENTINEL_SECRET'] });
  const record = executionDetails('enabled', raw)[5];
  assert.deepEqual(record.failure, { errors: [{ kind: 'timeout', location: { file: 'tests/e2e/legacy-evidence-review.spec.ts', line: 487, column: 7 } }, { kind: 'other', location: null }], steps: [{ category: 'expect', kind: 'other', location: { file: 'tests/e2e/fixture.ts', line: 1, column: 1 } }] });
  for (const file of ['tests/e2e/other.spec.ts', 'tests/e2e/../e2e/fixture.ts', 'tests\\e2e\\fixture.ts', 'https://secret/fixture.ts']) {
    (raw.results[4] as unknown as { failure: { errors: { location: { file: string } }[] } }).failure.errors[0].location.file = file;
    assert.equal(executionDetails('enabled', raw)[5].failure.errors[0].location, null);
  }
});
test('diagnostic projection never invokes nested getters, proxies or toJSON and bounds arrays before traversal', () => {
  let reads = 0; const poison = () => { reads++; throw new Error('SENTINEL_SECRET'); };
  const accessor = Object.defineProperty({}, 'errors', { get: poison });
  const proxy = new Proxy({}, { get: poison, getOwnPropertyDescriptor: poison, ownKeys: poison, getPrototypeOf: poison });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const oversized = new Array(100_000); Object.defineProperty(oversized, '0', { get: poison });
  const withJson = { errors: [], steps: [], toJSON: poison };
  for (const failure of [accessor, proxy, revoked.proxy, withJson, { errors: oversized, steps: [] }, { errors: [proxy], steps: [accessor] }, { errors: [], steps: Object.defineProperty([], 'toJSON', { get: poison }) }]) {
    const raw = execution('inactive'); raw.results[0].status = 'failed'; Object.assign(raw.results[0], { failure });
    assert.doesNotThrow(() => executionDetails('inactive', raw));
  }
  for (const status of ['passed', 'skipped']) {
    const raw = execution('inactive'); raw.results[0].status = status; Object.defineProperty(raw.results[0], 'failure', { get: poison });
    const records = executionDetails('inactive', raw); assert.equal(records.length, 9); assert.equal(records[1].failure, undefined);
  }
  const raw = execution('inactive'), projected = harness.projectExecution(raw, 'inactive', commit);
  for (const malformed of [proxy, revoked.proxy, accessor, { ...projected, cases: oversized }, { ...projected, toJSON: poison }]) {
    const lines: string[] = []; harness.emitExecutionDiagnostics(raw, malformed, 'inactive', (line: string) => lines.push(line)); assert.deepEqual(lines, []);
  }
  assert.equal(reads, 0);
});
test('detail projection rejects forged tuples and does not forward spoofed raw diagnostic prefixes', () => {
  const raw = execution('inactive'), projected = harness.projectExecution(raw, 'inactive', commit);
  const lines: string[] = [];
  projected.cases[0].title = '[legacy-evidence-b2-detail] {"kind":"case","status":"passed"} SENTINEL_SECRET';
  harness.emitExecutionDiagnostics(raw, projected, 'inactive', (line: string) => lines.push(line)); assert.equal(lines.length, 0);
  for (const value of ['QA_FAILURE_LOCATION SENTINEL_SECRET', '[legacy-evidence-b2-detail] {"status":"passed"}', 'passed: SENTINEL_SECRET']) {
    harness.emitExecutionDiagnostics(value, value, 'inactive', (line: string) => lines.push(line));
  }
  assert.deepEqual(lines, []);
  const run = functionSource('run'); assert.match(run, /if\(!line\.startsWith\('QA_CLEANUP '\)\)return/);
});
test('first operation detail preserves the allowlisted system code before generic recoding and ignores a failing sink', () => {
  const lines: string[] = [], observe = harness.childOperationObserver('browser', (line: string) => { lines.push(line); throw new Error('SENTINEL_SECRET_SINK'); });
  observe('disk-sample', Object.assign(new Error('SENTINEL_SECRET_PATH'), { code: 'ENOENT' }));
  observe('shutdown', { code: 'cleanup_failed' });
  assert.deepEqual(parseDetails(lines), [{ kind: 'child-operation', child: 'browser', operation: 'disk-sample', code: 'harness_failed', systemCode: 'ENOENT' }]);
  for (const code of ['ENOENT', 'EACCES', 'EPERM', 'EIO', 'ENOSPC', 'EMFILE', 'ENFILE', 'ELOOP', 'ENOTDIR', 'SENTINEL_SECRET']) {
    const output: string[] = []; harness.childOperationObserver('browser', (line: string) => output.push(line))('spawn', { code });
    assert.equal(parseDetails(output)[0].systemCode, code === 'SENTINEL_SECRET' ? 'other' : code);
  }
});
test('sampled filesystem failure remains fatal even with a later zero exit and retains first diagnostic cause', async () => {
  for (const resourceError of [undefined, 'EIO']) {
    const fake = fakeLauncher({ diskError: 'ENOENT', resourceError }), pending = assert.rejects(fake.run(ownerRecord(), 'browser', []), { code: 'harness_failed' });
    await flushMicrotasks(); fake.advance(5000); fake.child.emit('close', 0); await pending;
    assert.deepEqual(fake.signals, [[401, 'SIGTERM']]); assert.equal(fake.stopped.length, 1); assert.equal(fake.timers.size, 0);
    assert.deepEqual(parseDetails(fake.details), [{ kind: 'child-operation', child: 'browser', operation: resourceError ? 'process-sample' : 'disk-sample', code: 'harness_failed', systemCode: resourceError ?? 'ENOENT' }]);
  }
});
test('report states distinguish missing stale and invalid without serializing cases or changing refusal', t => {
  const root = tiny(t), file = put(root, 'result.json', JSON.stringify(execution('inactive'))), start = Date.now();
  const fresh = privateFunction('freshReport', { lstatSync, refuse, json: (path: string) => JSON.parse(readFileSync(path, 'utf8')) });
  for (const kind of ['stale', 'invalid'] as const) {
    writeFileSync(file, kind === 'invalid' ? '{' : JSON.stringify(execution('inactive')));
    utimesSync(file, new Date(start - (kind === 'stale' ? 10000 : 0)), new Date(start - (kind === 'stale' ? 10000 : 0)));
    const lines: string[] = [], observer = harness.reportStateObserver('inactive', (line: string) => { lines.push(line); throw new Error('SENTINEL_SECRET_SINK'); });
    assert.throws(() => fresh(file, start, observer)); observer('validated');
    assert.deepEqual(parseDetails(lines), [{ kind: 'phase-report', phase: 'inactive', state: kind }]);
  }
  const lines: string[] = []; harness.reportStateObserver('enabled', (line: string) => lines.push(line))('missing');
  assert.deepEqual(parseDetails(lines), [{ kind: 'phase-report', phase: 'enabled', state: 'missing' }]);
});
test('timeout budget abort and capture cutoff retain first-cause detail before later sampler failures', async () => {
  for (const first of ['timeout', 'budget', 'abort', 'capture']) {
    const fake = fakeLauncher({ diskError: 'ENOENT' });
    const code = first === 'timeout' ? 'browser_failed' : first === 'budget' ? 'budget_exhausted' : first === 'abort' ? 'interrupted' : 'resource_limit';
    const pending = assert.rejects(fake.run(ownerRecord(), 'browser', [], { timeout: first === 'timeout' ? 10 : 120_000, stopAt: first === 'budget' ? 10 : Infinity, capture: first === 'capture' }), { code });
    await flushMicrotasks();
    if (first === 'abort') fake.controller.abort();
    else if (first === 'capture') fake.child.stdout.emit('data', Buffer.alloc(harness.LIMITS.captureBytes + 1));
    else fake.advance(100);
    fake.advance(5000); fake.child.emit('close', 0); await pending;
    assert.deepEqual(parseDetails(fake.details), [{ kind: 'child-operation', child: 'browser', operation: 'completion', code, systemCode: 'other' }]);
    assert.deepEqual(fake.signals, [[401, 'SIGTERM']]); assert.equal(fake.timers.size, 0);
  }
});

test('process identity diagnostic vocabularies and annotated refusal sites stay exact', () => {
  assert.deepEqual([...fixedSet('PROCESS_IDENTITY_SITES')], ['registration-validation', 'registration-recheck', 'leader-snapshot']);
  assert.deepEqual([...fixedSet('PROCESS_IDENTITY_REASONS')], ['invalid-observed-identity', 'current-unavailable', 'pid-mismatch', 'start-mismatch', 'group-mismatch', 'session-mismatch', 'multiple-mismatch']);
  assert.deepEqual([...fixedSet('PROCESS_STAT_READS')], ['ok', 'invalid-stat', 'ENOENT', 'ESRCH', 'EACCES', 'EPERM', 'EIO', 'EMFILE', 'ENFILE', 'ELOOP', 'ENOTDIR', 'other']);
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) { if (ts.isCallExpression(node) && node.expression.getText(runnerAst) === 'refuseProcessIdentity') calls.push(node); ts.forEachChild(node, visit); }
  visit(runnerAst); assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.arguments[0].getText(runnerAst)), ["'registration-validation'", "'registration-recheck'", "'leader-snapshot'"]);
  assert.match(functionSource('registerProcess'), /if \(!sameProcess\(discovered, current\)\) refuseProcessIdentity/);
  assert.match(functionSource('scanOwned'), /if \(leader && !sameProcess\(record, leader\)\) refuseProcessIdentity/);
  assert.equal((functionSource('processInfo').match(/readFileSync\(/g) ?? []).length, 1);
  assert.equal((functionSource('registerProcess').match(/processInfo\(/g) ?? []).length, 1);
});

test('same stat read supplies a closed outcome without changing parsed null or throwing-observer results', () => {
  const diagnostic = processDiagnosticBoundary(), identity = row(801);
  const cases: { input: string | Error; outcome: string; expected: ProcessRow | null }[] = [
    { input: statLine(identity), outcome: 'ok', expected: identity },
    { input: 'SENTINEL_SECRET_INVALID_STAT', outcome: 'invalid-stat', expected: null },
    ...['ENOENT', 'ESRCH', 'EACCES', 'EPERM', 'EIO', 'EMFILE', 'ENFILE', 'ELOOP', 'ENOTDIR', 'other', 'ok', 'invalid-stat', 'SENTINEL_SECRET_CODE'].map(code => ({ input: Object.assign(new Error('SENTINEL_SECRET_PATH'), { code }), outcome: ['ok', 'invalid-stat', 'SENTINEL_SECRET_CODE'].includes(code) ? 'other' : code, expected: null })),
  ];
  for (const { input, outcome, expected } of cases) for (const throwing of [false, true]) {
    let reads = 0; const observations: string[] = [];
    const inspect = diagnostic.inspect((path, encoding) => { reads++; assert.equal(path, '/proc/801/stat'); assert.equal(encoding, 'utf8'); if (input instanceof Error) throw input; return input; });
    assert.deepEqual(inspect(801, (value: string) => { observations.push(value); if (throwing) throw new Error('SENTINEL_SECRET_OBSERVER'); }), expected);
    assert.equal(reads, 1); assert.deepEqual(observations, [outcome]);
  }
});

test('stat failure observation never executes accessor proxy inherited code or raw serialization', () => {
  const diagnostic = processDiagnosticBoundary(); let accessed = 0;
  const getter = Object.defineProperty(new Error('secret'), 'code', { get: () => { accessed++; throw new Error('secret'); } });
  const proxy = new Proxy({ code: 'ENOENT' }, { get: () => { accessed++; throw new Error('secret'); }, getOwnPropertyDescriptor: () => { accessed++; throw new Error('secret'); } });
  const inherited = Object.create({ code: 'ENOENT' });
  const serializable = Object.defineProperty({ code: 'EIO' }, 'toJSON', { get: () => { accessed++; throw new Error('secret'); } });
  for (const [error, expected] of [[getter, 'other'], [proxy, 'other'], [inherited, 'other'], [serializable, 'EIO'], ['ENOENT', 'other']] as const) {
    const observations: string[] = []; let reads = 0;
    const inspect = diagnostic.inspect(() => { reads++; throw error; });
    assert.equal(inspect(801, (value: string) => observations.push(value)), null); assert.equal(reads, 1); assert.deepEqual(observations, [expected]);
  }
  assert.equal(accessed, 0);
});

test('registration diagnostic subtypes preserve refusal code reads and nonpersistence across all identity mismatches', () => {
  const diagnostic = processDiagnosticBoundary(), discovered = row(811), saved: ProcessRow[] = [];
  const cases: { current: ProcessRow | null; reason: string; outcome: string }[] = [
    { current: null, reason: 'current-unavailable', outcome: 'ENOENT' },
    { current: null, reason: 'current-unavailable', outcome: 'EACCES' },
    { current: null, reason: 'current-unavailable', outcome: 'invalid-stat' },
    { current: { ...discovered, pid: 812 }, reason: 'pid-mismatch', outcome: 'ok' },
    { current: { ...discovered, start: '900000' }, reason: 'start-mismatch', outcome: 'ok' },
    { current: { ...discovered, group: 812 }, reason: 'group-mismatch', outcome: 'ok' },
    { current: { ...discovered, session: 812 }, reason: 'session-mismatch', outcome: 'ok' },
    { current: { ...discovered, start: '900000', group: 812 }, reason: 'multiple-mismatch', outcome: 'ok' },
  ];
  for (const { current, reason, outcome } of cases) {
    let reads = 0;
    const register = privateFunction('registerProcess', { processInfo: (_pid: number, observe: (value: string) => void) => { reads++; observe(outcome); return current; }, sameProcess: harness.sameProcess, refuseProcessIdentity: diagnostic.refuseIdentity, join, writeProcessRecord: (_owner: unknown, value: ProcessRow) => saved.push(value) });
    let caught: unknown; try { register(ownerRecord(), discovered, 'descendant'); } catch (error) { caught = error; }
    assert.equal(harness.safeFailure(caught), 'process_identity'); assert.equal((caught as Error).message, 'B2 refused: process_identity');
    assert.equal(reads, 1); assert.deepEqual(saved, []);
    assert.deepEqual(diagnostic.detail(caught), { identitySite: 'registration-recheck', identityReason: reason, statRead: outcome });
  }
  let reads = 0;
  const register = privateFunction('registerProcess', { processInfo: () => { reads++; return discovered; }, sameProcess: harness.sameProcess, refuseProcessIdentity: diagnostic.refuseIdentity, join, writeProcessRecord: (_owner: unknown, value: ProcessRow) => saved.push(value) });
  let invalid: unknown; try { register(ownerRecord(), { ...discovered, group: NaN }, 'descendant'); } catch (error) { invalid = error; }
  assert.equal(harness.safeFailure(invalid), 'process_identity'); assert.equal(reads, 0); assert.deepEqual(saved, []);
  assert.deepEqual(diagnostic.detail(invalid), { identitySite: 'registration-validation', identityReason: 'invalid-observed-identity' });
  register(ownerRecord(), discovered, 'descendant'); assert.equal(reads, 1); assert.equal(saved.length, 1);
});

test('leader snapshot failure stays distinct and carries no invented stat observation or adopted child', () => {
  const diagnostic = processDiagnosticBoundary(), leader = row(821), replacement = { ...leader, start: '900000' }, foreign = row(822, { parent: 821 });
  const saved = [leader], reads: number[] = [];
  const scan = privateFunction('scanOwned', { processRecords: () => saved, readdirSync: () => ['821', '822'], processInfo: (pid: number) => { reads.push(pid); return pid === 821 ? replacement : foreign; }, sameProcess: harness.sameProcess, refuseProcessIdentity: diagnostic.refuseIdentity, readFileSync: () => assert.fail('A failed leader cannot authorize any environment read'), registerProcess: () => assert.fail('A failed leader cannot authorize adoption'), refuse });
  let caught: unknown; try { scan(ownerRecord()); } catch (error) { caught = error; }
  assert.equal(harness.safeFailure(caught), 'process_identity'); assert.deepEqual(reads, [821, 822]); assert.deepEqual(saved, [leader]);
  assert.deepEqual(diagnostic.detail(caught), { identitySite: 'leader-snapshot', identityReason: 'start-mismatch' });
});

test('untrusted valid-looking error properties never create identity detail or reclassify failure', () => {
  const diagnostic = processDiagnosticBoundary(); let accessed = 0;
  const forged = { identitySite: 'registration-recheck', identityReason: 'current-unavailable', statRead: 'ENOENT' };
  const own = Object.assign(new Error('SENTINEL_SECRET_ERROR'), { code: 'process_identity', ...forged });
  const inherited = Object.assign(Object.create(forged), { code: 'process_identity' });
  const getter = Object.defineProperty({ code: 'process_identity' }, 'identitySite', { get: () => { accessed++; throw new Error('SENTINEL_SECRET'); } });
  const proxy = new Proxy(own, { get: () => { accessed++; throw new Error('SENTINEL_SECRET'); }, getOwnPropertyDescriptor: () => { accessed++; throw new Error('SENTINEL_SECRET'); } });
  const toJSON = Object.defineProperty({ code: 'process_identity' }, 'toJSON', { get: () => { accessed++; throw new Error('SENTINEL_SECRET'); } });
  for (const error of [own, inherited, getter, proxy, toJSON, { code: 'EIO', ...forged }]) {
    const lines: string[] = []; diagnostic.observer('browser', (line: string) => lines.push(line))('process-sample', error);
    const code = harness.safeFailure(error);
    assert.deepEqual(parseDetails(lines), [{ kind: 'child-operation', child: 'browser', operation: 'process-sample', code, systemCode: error === proxy ? 'other' : Object.getOwnPropertyDescriptor(error, 'code')?.value === 'EIO' ? 'EIO' : 'other' }]);
    assert.doesNotMatch(lines.join('\n'), /SENTINEL|identitySite|identityReason|statRead/);
  }
  assert.equal(accessed, 0);
});

test('identity classification cannot throw a replacement or serialize hostile tuples and invalid enums', () => {
  const diagnostic = processDiagnosticBoundary(), discovered = row(831); let accessed = 0;
  const hostile = new Proxy({}, { get: () => { accessed++; throw new Error('SENTINEL_SECRET'); }, getOwnPropertyDescriptor: () => { accessed++; throw new Error('SENTINEL_SECRET'); } });
  const getter = Object.defineProperty({ ...discovered }, 'start', { get: () => { accessed++; throw new Error('SENTINEL_SECRET'); } });
  for (const [site, observed, current, outcome] of [['registration-recheck', hostile, discovered, 'ok'], ['registration-recheck', getter, discovered, 'ok'], ['registration-recheck', discovered, getter, 'ok'], ['SENTINEL_SECRET_SITE', discovered, null, 'ENOENT']] as const) {
    let caught: unknown; try { diagnostic.refuseIdentity(site, observed, current, outcome); } catch (error) { caught = error; }
    assert.equal(harness.safeFailure(caught), 'process_identity'); assert.deepEqual(diagnostic.detail(caught), {});
  }
  assert.equal(accessed, 0);
  let caught: unknown; try { diagnostic.refuseIdentity('registration-recheck', discovered, null, 'SENTINEL_SECRET_STAT'); } catch (error) { caught = error; }
  assert.deepEqual(diagnostic.detail(caught), { identitySite: 'registration-recheck', identityReason: 'current-unavailable' });
  assert.equal(Object.isFrozen(diagnostic.detail(caught)), true);
  (caught as { code: string }).code = 'EIO'; assert.deepEqual(diagnostic.detail(caught), {}); assert.equal(harness.safeFailure(caught), 'harness_failed');
});

test('identity detail preserves first-cause ordering through sampling termination zero exit and sink failure', async () => {
  const diagnostic = processDiagnosticBoundary(); let failure: unknown;
  try { diagnostic.refuseIdentity('registration-recheck', row(841), null, 'ENOENT'); } catch (error) { failure = error; }
  const expected = { kind: 'child-operation', child: 'browser', operation: 'process-sample', code: 'process_identity', systemCode: 'other', identitySite: 'registration-recheck', identityReason: 'current-unavailable', statRead: 'ENOENT' };
  const fake = fakeLauncher({ resourceFailure: failure, diagnostics: diagnostic, diskError: 'EIO' });
  const pending = assert.rejects(fake.run(ownerRecord(), 'browser', []), { code: 'process_identity' });
  await flushMicrotasks(); fake.advance(100); fake.advance(5000); fake.child.emit('close', 0); await pending;
  assert.deepEqual(parseDetails(fake.details), [expected]); assert.deepEqual(fake.signals, [[401, 'SIGTERM']]); assert.equal(fake.stopped.length, 1); assert.equal(fake.timers.size, 0);
  const lines: string[] = [], observe = diagnostic.observer('browser', (line: string) => { lines.push(line); throw new Error('SENTINEL_SECRET_SINK'); });
  assert.doesNotThrow(() => observe('process-sample', failure)); observe('completion', { code: 'cleanup_failed' });
  assert.deepEqual(parseDetails(lines), [expected]);
  const timeout = fakeLauncher({ resourceFailure: failure, diagnostics: diagnostic });
  const interrupted = assert.rejects(timeout.run(ownerRecord(), 'browser', []), { code: 'interrupted' });
  await flushMicrotasks(); timeout.controller.abort(); timeout.advance(100); timeout.child.emit('close', 0); await interrupted;
  assert.deepEqual(parseDetails(timeout.details), [{ kind: 'child-operation', child: 'browser', operation: 'completion', code: 'interrupted', systemCode: 'other' }]);
});

// Registry publication stages outside the strict committed inventory. All
// interleavings below are deterministic tiny filesystem/fake-process fixtures.
function registryFixture(t: { after: (fn: () => void) => void }) {
  const directory = tiny(t), info = statSync(directory);
  const owner = { ...ownerRecord(), directory, dev: info.dev, ino: info.ino };
  const committed = join(directory, 'processes'), staging = join(directory, 'process-staging');
  mkdirSync(committed, { mode: 0o700 }); mkdirSync(staging, { mode: 0o700 });
  const diagnostic = processOwnershipBoundary();
  const records = privateFunction('processRecords', { readdirSync: filesystem.readdirSync, join, LIMITS: harness.LIMITS, refuse, refuseProcessOwnership: diagnostic.refuseOwnership, regularPath: harness.regularPath, json: (path: string) => JSON.parse(readFileSync(path, 'utf8')) });
  const publish = (bindings: Record<string, unknown> = {}) => privateFunction('writeProcessRecord', { lstatSync, realpathSync, join, process: { pid: 901 }, randomBytes: () => Buffer.alloc(16, 1), writeFileSync, renameSync: filesystem.renameSync, refuseProcessOwnership: diagnostic.refuseOwnership, ...bindings });
  const record = { ...row(902), label: 'server', nonce };
  return { owner, committed, staging, record, diagnostic, records, publish };
}

test('process registry publication keeps first and final scans strict throughout staging and atomic rename', t => {
  const fixture = registryFixture(t), observed: string[] = [];
  const inspectRegistry = () => fixture.records(fixture.owner);
  const scanRegistry = () => {
    let registryReads = 0;
    const scan = privateFunction('scanOwned', { processRecords: () => { registryReads++; return inspectRegistry(); }, readdirSync: () => [String(fixture.record.pid)], processInfo: () => fixture.record, sameProcess: harness.sameProcess, readFileSync: () => Buffer.from(''), registerProcess: () => assert.fail('No new ownership is conferred by publication'), refuse });
    const result = scan(fixture.owner); assert.equal(registryReads, 2); return result;
  };
  const publish = fixture.publish({ writeFileSync: (path: string, bytes: string, options: filesystem.WriteFileOptions) => {
    assert.equal(dirname(path), fixture.staging); assert.deepEqual(options, { mode: 0o600, flag: 'wx' });
    writeFileSync(path, bytes, options); assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(inspectRegistry(), []); assert.deepEqual(scanRegistry(), []); observed.push('inflight-stage');
  }, renameSync: (from: string, to: string) => {
    assert.equal(dirname(from), fixture.staging); assert.equal(to, join(fixture.committed, `${fixture.record.pid}-${fixture.record.start}.json`));
    assert.deepEqual(inspectRegistry(), []); assert.deepEqual(scanRegistry(), []); filesystem.renameSync(from, to);
    assert.deepEqual(inspectRegistry(), [fixture.record]); assert.deepEqual(scanRegistry(), [fixture.record]); observed.push('published');
  } });
  publish(fixture.owner, fixture.record);
  assert.deepEqual(observed, ['inflight-stage', 'published']); assert.deepEqual(filesystem.readdirSync(fixture.staging), []);
  assert.equal(statSync(join(fixture.committed, `${fixture.record.pid}-${fixture.record.start}.json`)).mode & 0o777, 0o600);
  assert.deepEqual(scanRegistry(), [fixture.record]);
});

test('two process registry writers publish complete same-birth and distinct-birth rows without sharing stages', t => {
  const fixture = registryFixture(t), stages: string[] = [];
  const second = { ...fixture.record, label: 'descendant' };
  const secondWriter = fixture.publish({ process: { pid: 903 }, writeFileSync: (path: string, bytes: string, options: filesystem.WriteFileOptions) => { stages.push(path); writeFileSync(path, bytes, options); } });
  const firstWriter = fixture.publish({ writeFileSync: (path: string, bytes: string, options: filesystem.WriteFileOptions) => { stages.push(path); writeFileSync(path, bytes, options); }, renameSync: (from: string, to: string) => {
    secondWriter(fixture.owner, second); assert.deepEqual(fixture.records(fixture.owner), [second]);
    filesystem.renameSync(from, to);
  } });
  firstWriter(fixture.owner, fixture.record); assert.equal(new Set(stages).size, 2);
  assert.deepEqual(fixture.records(fixture.owner), [fixture.record]); assert.deepEqual(filesystem.readdirSync(fixture.staging), []);
  secondWriter(fixture.owner, { ...fixture.record, start: '9999' });
  assert.equal(fixture.records(fixture.owner).length, 2, 'Different births retain distinct committed records and existing identity fences');
});

test('failed process publication preserves the first syscall error and leaves stages for owned cleanup only', t => {
  const fixture = registryFixture(t);
  for (const [index, code] of ['EIO', 'EXDEV'].entries()) {
    const failure = Object.assign(new Error('SENTINEL_SECRET_PATH'), { code });
    const publish = fixture.publish({ randomBytes: () => Buffer.alloc(16, index + 2), renameSync: () => { throw failure; } });
    assert.throws(() => publish(fixture.owner, fixture.record), error => error === failure);
    assert.deepEqual(fixture.records(fixture.owner), []); assert.equal(harness.safeFailure(failure), 'harness_failed');
  }
  assert.equal(filesystem.readdirSync(fixture.staging).length, 2);
  assert.equal(harness.ownedUsage(fixture.owner.directory), Buffer.byteLength(JSON.stringify(fixture.record) + '\n') * 2);
  const partial = Object.assign(new Error('SENTINEL_SECRET_PARTIAL'), { code: 'ENOSPC' }); let renamed = false;
  const publish = fixture.publish({ randomBytes: () => Buffer.alloc(16, 4), writeFileSync: (path: string, _bytes: string, options: filesystem.WriteFileOptions) => { writeFileSync(path, '{', options); throw partial; }, renameSync: () => { renamed = true; } });
  assert.throws(() => publish(fixture.owner, fixture.record), error => error === partial);
  assert.equal(renamed, false); assert.deepEqual(fixture.records(fixture.owner), []); assert.equal(filesystem.readdirSync(fixture.staging).length, 3);
  assert.doesNotMatch(functionSource('writeProcessRecord'), /rmSync|unlink|copyFile|mkdirSync/);
  assert.match(functionSource('cleanup'), /if\(!processesStopped\)refuse\('cleanup_failed'\)/);
});

test('process staging exclusivity refuses stale regular symlink and hardlink collisions without touching targets', t => {
  for (const kind of ['regular', 'symlink', 'hardlink']) {
    const fixture = registryFixture(t), name = `${fixture.record.pid}-${fixture.record.start}.json.901.${'01'.repeat(16)}.tmp`;
    const target = put(fixture.owner.directory, `target-${kind}`, 'SENTINEL_TARGET', 0o600), stage = join(fixture.staging, name);
    if (kind === 'regular') writeFileSync(stage, 'SENTINEL_STAGE', { mode: 0o600 });
    else if (kind === 'symlink') symlinkSync(target, stage);
    else filesystem.linkSync(target, stage);
    assert.throws(() => fixture.publish()(fixture.owner, fixture.record), { code: 'EEXIST' });
    assert.equal(readFileSync(target, 'utf8'), 'SENTINEL_TARGET'); assert.deepEqual(fixture.records(fixture.owner), []);
    assert.equal(lstatSync(stage).isSymbolicLink(), kind === 'symlink');
  }
});

test('process publisher rejects unsafe owner and sibling directory identities before any write', () => {
  const owner = ownerRecord(), diagnostic = processOwnershipBoundary();
  const committed = join(owner.directory, 'processes'), staging = join(owner.directory, 'process-staging');
  const normal = { dev: owner.dev, ino: owner.ino, mode: 0o40700, isDirectory: () => true };
  const cases = [
    ...[owner.directory, committed, staging].flatMap(path => [
      { path, patch: { isDirectory: () => false } }, { path, patch: { mode: 0o40750 } }, { path, patch: { dev: 999 } }, { path, real: '/SENTINEL_SECRET_ALIAS' },
    ]), { path: owner.directory, patch: { ino: 999 } },
  ];
  for (const value of cases) {
    let writes = 0; const publish = privateFunction('writeProcessRecord', {
      lstatSync: (path: string) => ({ ...normal, ...(path === value.path && 'patch' in value ? value.patch : {}) }), realpathSync: (path: string) => path === value.path && 'real' in value ? value.real : path,
      join, process: { pid: 901 }, randomBytes: () => assert.fail('Unsafe directories cannot reach random stage creation'), writeFileSync: () => { writes++; }, renameSync: () => assert.fail('Unsafe directories cannot rename'), refuseProcessOwnership: diagnostic.refuseOwnership,
    });
    let caught: unknown; try { publish(owner, row(902)); } catch (error) { caught = error; }
    assert.equal(harness.safeFailure(caught), 'ownership_invalid'); assert.equal(writes, 0);
    const reason = value.path === owner.directory ? 'unsafe-owner-directory' : value.path === committed ? 'unsafe-committed-directory' : 'unsafe-staging-directory';
    assert.deepEqual(diagnostic.detail(caught), { ownershipSite: 'registry-publication', ownershipReason: reason });
  }
});

test('process publisher refuses actual symlink siblings and keeps existing committed cap and row checks', t => {
  for (const name of ['processes', 'process-staging']) {
    const fixture = registryFixture(t), destination = join(fixture.owner.directory, name), target = join(fixture.owner.directory, 'alias-target');
    mkdirSync(target, { mode: 0o700 }); rmSync(destination, { recursive: true }); symlinkSync(target, destination);
    refused(() => fixture.publish()(fixture.owner, fixture.record), 'ownership_invalid'); assert.deepEqual(filesystem.readdirSync(target), []);
  }
  const fixture = registryFixture(t);
  for (let index = 0; index < harness.LIMITS.processCount; index++) put(fixture.committed, `${index + 1}-${index + 1}.json`, JSON.stringify({ ...fixture.record, pid: index + 1, start: String(index + 1) }), 0o600);
  put(fixture.staging, 'inflight.tmp', 'partial', 0o600); assert.equal(fixture.records(fixture.owner).length, 512);
  put(fixture.committed, '9999-9999.json', JSON.stringify(fixture.record), 0o600); refused(() => fixture.records(fixture.owner), 'process_limit');
});

test('ownership registry diagnostics cover original invalid-name and all invalid-row predicates without extra data reads', () => {
  const diagnostic = processOwnershipBoundary(), owner = ownerRecord(), valid = { ...row(902), nonce };
  let file = '902-1902.json', value: unknown = valid, reads = 0;
  const records = privateFunction('processRecords', { readdirSync: () => [file], join, LIMITS: harness.LIMITS, refuse, refuseProcessOwnership: diagnostic.refuseOwnership, regularPath: () => 'synthetic', json: () => { reads++; return value; } });
  for (const name of ['902-1902.json.901.tmp', '../../SENTINEL_SECRET']) {
    file = name; let caught: unknown; try { records(owner); } catch (error) { caught = error; }
    assert.equal(reads, 0); assert.deepEqual(diagnostic.detail(caught), { ownershipSite: 'registry-entry', ownershipReason: 'invalid-name' });
  }
  file = '902-1902.json';
  for (const patch of [{ nonce: 'wrong' }, { pid: 1.5 }, { start: 'bad' }, { group: 1.5 }, { session: 1.5 }]) {
    value = { ...valid, ...patch }; const before = reads; let caught: unknown; try { records(owner); } catch (error) { caught = error; }
    assert.equal(reads, before + 1); assert.equal(harness.safeFailure(caught), 'ownership_invalid');
    assert.deepEqual(diagnostic.detail(caught), { ownershipSite: 'registry-record', ownershipReason: 'invalid-row' });
  }
  value = null; assert.throws(() => records(owner), TypeError, 'Pre-existing malformed JSON value failure is not reclassified');
  const source = functionSource('processRecords');
  assert.match(source, /files.length > LIMITS.processCount/); assert.match(source, /row.nonce !== owner.nonce \|\| !Number.isSafeInteger\(row.pid\) \|\| !\/\^\\d\+\$\/.test\(row.start\) \|\| !Number.isSafeInteger\(row.group\) \|\| !Number.isSafeInteger\(row.session\)/);
});

test('ownership detail trusts only exact refusal errors and preserves first cause despite forged data and failing sinks', async () => {
  const diagnostic = processOwnershipBoundary(); let failure: unknown;
  try { diagnostic.refuseOwnership('registry-entry', 'invalid-name'); } catch (error) { failure = error; }
  assert.equal(Object.isFrozen(diagnostic.detail(failure)), true);
  const fake = fakeLauncher({ resourceFailure: failure, diagnostics: { ...processDiagnosticBoundary(), observer: diagnostic.observer } });
  const pending = assert.rejects(fake.run(ownerRecord(), 'browser', []), { code: 'ownership_invalid' });
  await flushMicrotasks(); fake.advance(100); fake.child.emit('close', 0); await pending;
  assert.deepEqual(parseDetails(fake.details), [{ kind: 'child-operation', child: 'browser', operation: 'process-sample', code: 'ownership_invalid', systemCode: 'other', ownershipSite: 'registry-entry', ownershipReason: 'invalid-name' }]);
  let accessed = 0; const forged = { code: 'ownership_invalid', ownershipSite: 'registry-entry', ownershipReason: 'invalid-name' };
  for (const error of [forged, Object.create(forged), Object.defineProperty({ code: 'ownership_invalid' }, 'ownershipSite', { get: () => { accessed++; throw new Error('SENTINEL_SECRET'); } }), new Proxy(forged, { getOwnPropertyDescriptor: () => { accessed++; throw new Error('SENTINEL_SECRET'); } })]) {
    assert.deepEqual(diagnostic.detail(error), {}); const lines: string[] = [];
    diagnostic.observer('browser', (line: string) => lines.push(line))('process-sample', error);
    assert.doesNotMatch(lines.join('\n'), /ownershipSite|ownershipReason|SENTINEL/);
  }
  assert.equal(accessed, 0); const lines: string[] = [], observe = diagnostic.observer('browser', (line: string) => { lines.push(line); throw new Error('SENTINEL_SECRET_SINK'); });
  assert.doesNotThrow(() => observe('process-sample', failure)); observe('completion', { code: 'cleanup_failed' }); assert.equal(lines.length, 1);
  (failure as { code: string }).code = 'EIO'; assert.deepEqual(diagnostic.detail(failure), {});
  let unknown: unknown; try { diagnostic.refuseOwnership('SENTINEL_SECRET_SITE', 'invalid-row'); } catch (error) { unknown = error; }
  assert.equal(harness.safeFailure(unknown), 'ownership_invalid'); assert.deepEqual(diagnostic.detail(unknown), {});
});

test('ownership diagnostic vocabulary and publisher scope stay bounded without changing inherited disk sampling', () => {
  assert.deepEqual([...fixedSet('PROCESS_OWNERSHIP_SITES')], ['registry-entry', 'registry-record', 'registry-publication']);
  assert.deepEqual([...fixedSet('PROCESS_OWNERSHIP_REASONS')], ['invalid-name', 'invalid-row', 'unsafe-owner-directory', 'unsafe-committed-directory', 'unsafe-staging-directory']);
  assert.match(functionSource('createOwner'), /'processes', 'process-staging'/);
  assert.equal((functionSource('writeProcessRecord').match(/renameSync\(/g) ?? []).length, 1);
  assert.match(functionSource('writeProcessRecord'), /randomBytes\(16\)/);
  assert.match(functionSource('ownedUsage'), /lstatSync\(full\)/, 'Enumeration-to-lstat ENOENT remains strict and is not solved by registry publication');
});

test('ownership metadata attachment failure never replaces the original refusal', () => {
  const fail = () => { throw new Error('SENTINEL_SECRET_METADATA'); };
  for (const patch of [{ processOwnershipDetails: { set: fail } }, { PROCESS_OWNERSHIP_SITES: { has: fail } }, { PROCESS_OWNERSHIP_REASONS: { has: fail } }]) {
    const reject = privateFunction('refuseProcessOwnership', { processOwnershipDetails: new WeakMap(), PROCESS_OWNERSHIP_SITES: fixedSet('PROCESS_OWNERSHIP_SITES'), PROCESS_OWNERSHIP_REASONS: fixedSet('PROCESS_OWNERSHIP_REASONS'), ...patch });
    let caught: unknown; try { reject('registry-record', 'invalid-row'); } catch (error) { caught = error; }
    assert.equal(harness.safeFailure(caught), 'ownership_invalid'); assert.equal((caught as Error).message, 'B2 refused: ownership_invalid');
  }
});

test('vanished discovery accepts only the exact stat reread ENOENT and never persists uncertain identities', () => {
  const diagnostic = processDiagnosticBoundary(), discovered = row(901), saved: ProcessRow[] = [];
  const outcomes = [Object.assign(new Error('gone'), { code: 'ENOENT' }),
    ...['ESRCH', 'EACCES', 'EPERM', 'EIO', 'EMFILE', 'ENFILE', 'ELOOP', 'ENOTDIR'].map(code => Object.assign(new Error('unavailable'), { code })),
    new Error('unknown'), Object.create({ code: 'ENOENT' }),
    Object.defineProperty(new Error('accessor'), 'code', { get: () => assert.fail('Error accessors are not evidence') }),
    new Proxy({ code: 'ENOENT' }, { getOwnPropertyDescriptor: () => assert.fail('Proxy errors are not evidence') }), 'malformed', undefined,
    ...[{ pid: 902 }, { start: '999999' }, { group: 902 }, { session: 902 }].map(patch => statLine({ ...discovered, ...patch }))];
  for (const input of outcomes) {
    let reads = 0;
    const inspect = diagnostic.inspect((path, encoding) => { reads++; assert.equal(path, '/proc/901/stat'); assert.equal(encoding, 'utf8'); if (typeof input === 'object') throw input; return input as string; });
    const register = privateFunction('registerProcess', { processInfo: inspect, sameProcess: harness.sameProcess, refuseProcessIdentity: diagnostic.refuseIdentity, writeProcessRecord: (_owner: unknown, value: ProcessRow) => saved.push(value) });
    if (input === outcomes[0]) assert.equal(register(ownerRecord(), discovered, 'descendant', true), null);
    else refused(() => register(ownerRecord(), discovered, 'descendant', true), 'process_identity');
    assert.equal(reads, 1); assert.deepEqual(saved, []);
  }
  for (const current of [null, undefined, false]) {
    const register = privateFunction('registerProcess', { processInfo: () => current, sameProcess: harness.sameProcess, refuseProcessIdentity: diagnostic.refuseIdentity, writeProcessRecord: () => assert.fail('Unobserved absence cannot persist') });
    refused(() => register(ownerRecord(), discovered, 'descendant', true), 'process_identity');
  }
  const register = privateFunction('registerProcess', { processInfo: () => assert.fail('Invalid discovery must fail before reading'), sameProcess: harness.sameProcess, refuseProcessIdentity: diagnostic.refuseIdentity, writeProcessRecord: () => assert.fail('Invalid discovery cannot persist') });
  refused(() => register(ownerRecord(), { ...discovered, group: NaN }, 'descendant', true), 'process_identity');
});

test('sampling abandons a vanished new descendant without authorizing its reused PID and retains already-registered exit behavior', async () => {
  for (const alreadyRegistered of [false, true]) {
    const leader = row(911), child = row(912, { parent: 911, group: 911, session: 911 }), replacement = { ...child, start: '999999' };
    const saved = [{ ...leader, nonce, label: 'browser' }, ...(alreadyRegistered ? [{ ...child, nonce, label: 'descendant' }] : [])]; let childReads = 0;
    const diagnostic = processDiagnosticBoundary();
    const inspect = diagnostic.inspect(path => { if (path === '/proc/911/stat') return statLine(leader); assert.equal(path, '/proc/912/stat'); if (++childReads === 1) return statLine(child); throw Object.assign(new Error('gone'), { code: 'ENOENT' }); });
    const register = privateFunction('registerProcess', { processInfo: inspect, sameProcess: harness.sameProcess, refuseProcessIdentity: diagnostic.refuseIdentity, writeProcessRecord: (_owner: unknown, value: typeof saved[number]) => saved.push(value) });
    const scan = privateFunction('scanOwned', { processRecords: () => saved, readdirSync: () => ['911', '912'], processInfo: inspect, sameProcess: harness.sameProcess, refuseProcessIdentity: diagnostic.refuseIdentity, readFileSync: () => Buffer.from('PATH=/usr/bin\0'), registerProcess: register, refuse });
    const sample = privateFunction('resourceSample', { scanOwned: scan, sameProcess: harness.sameProcess, processInfo: inspect, readFileSync: () => 'VmRSS: 10 kB\n' });
    assert.equal(sample(ownerRecord()), 10 * 1024); assert.equal(childReads, 2); assert.equal(saved.length, alreadyRegistered ? 2 : 1);
    const live = new Map([[leader.pid, leader], [replacement.pid, replacement]]), signals: [number, string][] = [];
    const stop = () => harness.stopOwnedProcesses(saved, { inspect: (pid: number) => live.get(pid) ?? null, kill: (pid: number, signal: string) => { signals.push([pid, signal]); live.delete(pid); }, wait: async () => {}, now: () => 0 });
    if (alreadyRegistered) { await assert.rejects(stop(), { code: 'process_identity' }); assert.deepEqual(signals, []); }
    else { await stop(); assert.deepEqual(signals, [[leader.pid, 'SIGTERM']]); }
    assert.equal(live.get(replacement.pid), replacement);
  }
});

test('direct spawned-child disappearance remains a strict registration failure', async () => {
  const fake = fakeLauncher({ exitBeforeRegister: true });
  await assert.rejects(fake.run(ownerRecord(), 'browser', []), { code: 'process_identity' });
  assert.deepEqual(fake.records, []); assert.deepEqual(fake.signals, []); assert.equal(fake.timers.size, 0);
  const diagnostic = processDiagnosticBoundary(), inspect = diagnostic.inspect(() => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); });
  const register = privateFunction('registerProcess', { processInfo: inspect, sameProcess: harness.sameProcess, refuseProcessIdentity: diagnostic.refuseIdentity, writeProcessRecord: () => assert.fail('No absent process is persisted') });
  for (const label of ['browser', 'server', 'server-launcher', 'sql', 'discovery', 'inactive-build', 'enabled-build']) refused(() => register(ownerRecord(), row(921), label, true), 'process_identity');
  refused(() => register(ownerRecord(), row(921), 'descendant'), 'process_identity');
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) { if (ts.isCallExpression(node) && node.expression.getText(runnerAst) === 'registerProcess') calls.push(node); ts.forEachChild(node, visit); }
  visit(runnerAst); assert.equal(calls.length, 3);
  assert.equal(calls.filter(call => call.arguments.length === 3).length, 2);
  assert.equal(calls.filter(call => call.arguments.length === 4).length, 1);
  assert.equal(calls.find(call => call.arguments.length === 4)?.getText(runnerAst), "registerProcess(owner, row, 'descendant', true)");
});

test('vanished discovery opt-in does not adopt unrelated missing or mismatched nonce processes', () => {
  for (const bytes of [Buffer.from('PATH=/usr/bin\0'), Buffer.from(`B2_PROCESS_TAG=${'c'.repeat(64)}\0`)]) {
    const foreign = row(931), saved: ProcessRow[] = [];
    const scan = privateFunction('scanOwned', { processRecords: () => saved, readdirSync: () => ['931'], processInfo: () => foreign, sameProcess: harness.sameProcess, readFileSync: () => bytes, registerProcess: () => assert.fail('Unowned processes must never reach registration'), refuse });
    assert.deepEqual(scan(ownerRecord()), []);
  }
});

test('a vanished discovery candidate does not suppress registration of a later verified descendant', () => {
  const leader = row(941), gone = row(942, { parent: 941, group: 941, session: 941 }), live = row(943, { parent: 941, group: 941, session: 941 });
  const saved: ProcessRow[] = [{ ...leader, nonce, label: 'browser' }], diagnostic = processDiagnosticBoundary(); let goneReads = 0, nextScan = false;
  const foreign = { ...gone, parent: 1, group: 942, session: 942, start: '999999' };
  const inspect = diagnostic.inspect(path => {
    if (path === '/proc/941/stat') return statLine(leader);
    if (path === '/proc/943/stat') return statLine(live);
    assert.equal(path, '/proc/942/stat'); if (nextScan) return statLine(foreign); if (++goneReads === 1) return statLine(gone);
    throw Object.assign(new Error('gone'), { code: 'ENOENT' });
  });
  const register = privateFunction('registerProcess', { processInfo: inspect, sameProcess: harness.sameProcess, refuseProcessIdentity: diagnostic.refuseIdentity, writeProcessRecord: (_owner: unknown, value: ProcessRow) => saved.push(value) });
  const scan = privateFunction('scanOwned', { processRecords: () => saved, readdirSync: () => ['941', '942', '943'], processInfo: inspect, sameProcess: harness.sameProcess, readFileSync: () => Buffer.from('PATH=/usr/bin\0'), registerProcess: register, refuse });
  assert.deepEqual(scan(ownerRecord()).map((value: ProcessRow) => value.pid), [941, 943]); assert.equal(goneReads, 2);
  assert.deepEqual(saved[1], { pid: live.pid, start: live.start, group: live.group, session: live.session, label: 'descendant', nonce });
  nextScan = true; assert.deepEqual(scan(ownerRecord()).map((value: ProcessRow) => value.pid), [941, 943]);
  assert.equal(saved.some(value => value.pid === foreign.pid), false, 'A later foreign occupant cannot inherit the abandoned candidate');
});
