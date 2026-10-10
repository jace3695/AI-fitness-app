import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import * as filesystem from 'node:fs';
import * as paths from 'node:path';
import ts from 'typescript';
import * as harness from '../scripts/qa-legacy-evidence-browser.mjs';

// These are pure contract tests. Only tiny fixtures below may touch the disk.
// No imported CLI main, child process, browser, SQL, Docker, install or network
// boundary is executed. Private lifecycle functions are evaluated with fakes.
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
  return new Function(...Object.keys(bindings), `${functionSource(name)}\nreturn ${name};`)(...Object.values(bindings));
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
  const run = functionSource('run'); assert.ok(run.indexOf('retireReport(summary)') < run.indexOf("runFixed(owner,'browser'")); assert.match(run, /freshReport\(summary,start\)/);
});

// Dependencies are copied, never installed, hardlinked or linked out.
function dependencyFixture(root: string) {
  const source = join(root, 'node_modules'); put(source, 'tiny/package.json', JSON.stringify({ name: 'tiny', version: '1.2.3' })); put(source, 'tiny/bin.mjs', '#!/usr/bin/env node\n', 0o755);
  mkdirSync(join(source, '.bin')); symlinkSync(join(source, 'tiny/bin.mjs'), join(source, '.bin/tiny'));
  return { source, lock: { packages: { 'node_modules/tiny': { version: '1.2.3' } } } };
}
test('dependency copy relocates internal absolute package links and preserves bytes without writable inode sharing', t => {
  const root = tiny(t), { source, lock } = dependencyFixture(root), destination = join(root, 'private/node_modules');
  const result = harness.copyDependencyTree(source, destination, lock);
  assert.equal(readlinkSync(join(destination, '.bin/tiny')), '../tiny/bin.mjs'); assert.equal(realpathSync(join(destination, '.bin/tiny')), join(destination, 'tiny/bin.mjs'));
  assert.deepEqual(readFileSync(join(destination, 'tiny/bin.mjs')), readFileSync(join(source, 'tiny/bin.mjs')));
  assert.notEqual(statSync(join(destination, 'tiny/bin.mjs')).ino, statSync(join(source, 'tiny/bin.mjs')).ino);
  assert.equal(statSync(join(destination, 'tiny/bin.mjs')).mode & 0o777, 0o755); assert.equal(result.files, 3);
  assert.deepEqual(result.installedVersions, [{ path: 'node_modules/tiny', version: '1.2.3' }]); assert.match(result.digest, /^[a-f0-9]{64}$/);
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
});
test('cleanup refuses invalid ownership before deleting any directory or record', async () => {
  const removals: string[] = [];
  const cleanup = privateFunction('cleanup', {
    validateRunner: () => {}, ownedCleanupDeadline: () => 1, process: { env }, ROOT: env.GITHUB_WORKSPACE, OWNER_PATH: '.e2e/legacy-evidence-b2-owner.json', existsSync: () => true,
    join, readOwner: () => refuse('ownership_invalid'), rmSync: (path: string) => removals.push(path),
  });
  await assert.rejects(cleanup(), { code: 'ownership_invalid' }); assert.deepEqual(removals, []);
});

// Config modules are transpiled into a closed fake require; Playwright and Next
// are never loaded. Device fixtures retain distinguishable engine identities.
function evaluateConfig(path: string, imports: Record<string, unknown>, inputEnv: Record<string, string>) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', 'process', compiled)((name: string) => { assert.ok(Object.hasOwn(imports, name), `Unexpected config import ${name}`); return imports[name]; }, exports, { env: inputEnv });
  return exports.default as ReturnType<typeof configShape>;
}
function configShape() {
  return {} as { grepInvert?: RegExp | RegExp[]; fullyParallel: boolean; workers: number; retries: number; timeout: number; expect: { timeout: number }; reporter: unknown; outputDir: string; use: { baseURL: string; actionTimeout: number; navigationTimeout: number; timezoneId: string; locale: string; serviceWorkers: string; trace: string; screenshot: string; video: string }; projects: { name: string; testMatch?: string | string[]; grep?: RegExp; grepInvert?: RegExp | RegExp[]; dependencies?: string[]; use: { browserName: string; launchOptions?: { env: Record<string, string> } } }[]; webServer?: { command: string; cwd: string; env: Record<string, string>; url: string; reuseExistingServer: boolean; timeout: number; gracefulShutdown: { signal: string; timeout: number }; stdout: string; stderr: string } };
}
const fakePlaywright = { defineConfig: (value: unknown) => value, devices: { 'Desktop Chrome': { browserName: 'chromium' }, 'iPhone 13': { browserName: 'webkit' } } };
function defaultConfig() { return evaluateConfig('playwright.config.ts', { '@playwright/test': fakePlaywright }, { ...env, YEONI_E2E: '1' }); }
function focusedConfig(phase: 'inactive' | 'enabled', discovery = false) {
  const defaults = defaultConfig(); let reads = 0;
  const result = evaluateConfig('playwright.legacy-evidence.config.ts', { '@playwright/test': fakePlaywright, './playwright.config': { __esModule: true, default: defaults }, './scripts/qa-legacy-evidence-browser.mjs': { ROOT: env.GITHUB_WORKSPACE, readPhaseConfiguration: (root: string, configEnv: unknown) => { assert.equal(root, env.GITHUB_WORKSPACE); assert.equal(configEnv, env); reads++; return { phase, discovery, outputDir: `/synthetic/runner/yeoni-b2-abc/results/${phase}` }; } } }, env);
  assert.equal(reads, 1); return result;
}
test('general config excludes only the exact enabled tag and explicitly retains WebKit B2 coverage', () => {
  const config = defaultConfig(); assert.ok(config.grepInvert instanceof RegExp);
  for (const title of harness.SCENARIO_TITLES.enabled) assert.equal(config.grepInvert.test(title), true);
  for (const title of [...harness.AUTH_TITLES, ...harness.SCENARIO_TITLES.inactive, 'ordinary existing test', '@b2-enabled-other', 'prefix@b2-enabled', '@b2-inactive']) assert.equal(config.grepInvert.test(title), false, title);
  const webkit = config.projects.find(project => project.name === 'webkit-small'); assert.ok(webkit); assert.equal(webkit.use.browserName, 'webkit'); assert.ok(Array.isArray(webkit.testMatch)); assert.ok(webkit.testMatch.includes('**/legacy-evidence-review.spec.ts')); assert.equal(webkit.use.launchOptions?.env.LD_PRELOAD, env.QA_SOUP_LIBRARY);
});
test('focused phase selectors preserve four auth dependencies and select both engines without launching a server', () => {
  for (const phase of ['inactive', 'enabled'] as const) {
    const config = focusedConfig(phase, true); assert.equal(config.webServer, undefined); assert.deepEqual(config.projects.map(project => project.name), ['auth-preservation', 'chromium', 'webkit-small']);
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
test('focused execution preserves limits/privacy and uses only the fixed closed-environment serve launcher', () => {
  const config = focusedConfig('enabled'); assert.equal(config.fullyParallel, false); assert.equal(config.workers, 1); assert.equal(config.retries, 0); assert.equal(config.timeout, 90_000); assert.equal(config.expect.timeout, 15_000);
  assert.deepEqual(config.reporter, [['./tests/e2e/reporter.ts']]); assert.equal(config.use.baseURL, 'http://127.0.0.1:3000'); assert.equal(config.use.actionTimeout, 15_000); assert.equal(config.use.navigationTimeout, 30_000); assert.equal(config.use.locale, 'ko-KR'); assert.equal(config.use.timezoneId, 'Asia/Seoul'); assert.equal(config.use.serviceWorkers, 'block');
  assert.equal(config.use.trace, 'off'); assert.equal(config.use.screenshot, 'off'); assert.equal(config.use.video, 'off');
  assert.deepEqual(config.webServer, { command: 'node scripts/qa-legacy-evidence-browser.mjs serve', cwd: env.GITHUB_WORKSPACE, env: { B2_PHASE: 'enabled' }, url: 'http://127.0.0.1:3000/diet/settings', reuseExistingServer: false, timeout: 120_000, gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 }, stdout: 'ignore', stderr: 'ignore' });
  assert.equal(config.outputDir, '/synthetic/runner/yeoni-b2-abc/results/enabled');
});
test('focused config rejects missing required engines rather than reducing coverage or skipping', () => {
  const defaults = defaultConfig(); defaults.projects = defaults.projects.filter(project => project.name !== 'webkit-small');
  assert.throws(() => evaluateConfig('playwright.legacy-evidence.config.ts', { '@playwright/test': fakePlaywright, './playwright.config': { __esModule: true, default: defaults }, './scripts/qa-legacy-evidence-browser.mjs': { ROOT: env.GITHUB_WORKSPACE, readPhaseConfiguration: () => ({ phase: 'enabled', discovery: true }) } }, env), /Missing required B2 browser project/);
});


// The fake transport also covers failures between spawn and persisted ownership.
function fakeLauncher(options: { registerFails?: boolean; spawnFails?: boolean; stopFails?: boolean; reuseBeforeRegister?: boolean; firstIdentity?: Partial<ProcessRow> } = {}) {
  let time = 0, nextTimer = 1, spawnCount = 0;
  const timers = new Map<number, { callback: () => void; at: number; repeat: number }>();
  const identity = row(401, { parent: 9999, ...options.firstIdentity }), live = new Map([[identity.pid, identity]]), records: ProcessRow[] = [], stopped: ProcessRow[][] = [];
  const signals: [number, string][] = [], spawnOptions: Record<string, unknown>[] = [];
  const child = Object.assign(new EventEmitter(), { pid: identity.pid, stdout: new PassThrough(), stderr: new PassThrough(), kill: (signal: string) => { signals.push([identity.pid, signal]); return true; } });
  const controller = new AbortController();
  const schedule = (callback: () => void, ms: number, repeat: number) => { const id = nextTimer++; timers.set(id, { callback, at: time + ms, repeat }); return id; };
  const registration = privateFunction('registerProcess', { processInfo: (pid: number) => live.get(pid) ?? null, sameProcess: harness.sameProcess, refuse, join, writeJson: (_path: string, value: ProcessRow) => records.push(value) });
  const run = privateFunction('runFixed', {
    ROOT: env.GITHUB_WORKSPACE, process: { execPath: '/synthetic/node', env, pid: 9999, kill: (pid: number, signal: string) => { signals.push([pid, signal]); live.delete(pid); } },
    runtimeStop: controller, refuse, LIMITS: harness.LIMITS, safeFailure: harness.safeFailure, sameProcess: harness.sameProcess,
    spawn: (_command: string, _args: string[], supplied: Record<string, unknown>) => { spawnCount++; spawnOptions.push(supplied); if (options.spawnFails) throw Object.assign(new Error('synthetic-spawn-failure'), { code: 'EACCES' }); queueMicrotask(() => child.emit('spawn')); return child; },
    processInfo: (pid: number) => live.get(pid) ?? null,
    registerProcess: (owner: unknown, discovered: ProcessRow, label: string) => { assert.equal(typeof discovered, 'object', 'The original birth tuple must reach registration'); if (options.registerFails) refuse('ownership_invalid'); if (options.reuseBeforeRegister) live.set(discovered.pid, { ...discovered, start: '900000' }); return registration(owner, discovered, label); },
    processRecords: () => records, scanOwned: () => records,
    stopOwnedProcesses: async (owned: ProcessRow[]) => { stopped.push(owned); if (options.stopFails) refuse('cleanup_failed'); for (const info of owned) { const current = live.get(info.pid); if (current && !harness.sameProcess(info, current)) refuse('process_identity'); live.delete(info.pid); } return true; },
    resourceSample: () => 1024, ownedUsage: () => 2048, Date: { now: () => time },
    setInterval: (callback: () => void, ms: number) => schedule(callback, ms, ms), clearInterval: (id: number) => timers.delete(id),
    setTimeout: (callback: () => void, ms: number) => schedule(callback, ms, 0), clearTimeout: (id: number) => timers.delete(id),
  });
  return { run, child, identity, live, records, stopped, signals, spawnOptions, controller, spawnCount: () => spawnCount, timers,
    advance(ms: number) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { if (timer.repeat) timer.at = time + timer.repeat; else timers.delete(id); timer.callback(); } },
  };
}
async function flushMicrotasks() { for (let count = 0; count < 4; count++) await Promise.resolve(); }
test('runner import is inert with child processes, timers, network and main execution unavailable', () => {
  const nativeRequire = createRequire(import.meta.url), exports: Record<string, unknown> = {}, observed: string[] = [];
  const blocked = (name: string) => () => { observed.push(name); assert.fail(`Import attempted ${name}`); };
  const compiled = ts.transpileModule(runnerSource.replaceAll('import.meta.url', JSON.stringify(new URL('../scripts/qa-legacy-evidence-browser.mjs', import.meta.url).href)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'process', 'setTimeout', 'setInterval', 'fetch', compiled)((name: string) => {
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
  const copied = privateFunction('copyDependencyTree', { LIMITS: harness.LIMITS,
    ...Object.fromEntries(Object.entries(filesystem).filter(([name]) => name !== 'default')), ...Object.fromEntries(Object.entries(paths).filter(([name]) => name !== 'default')), sha256: harness.sha256, validateRelativePath: harness.validateRelativePath, refuse,
    inside: (parent: string, child: string) => child === parent || child.startsWith(parent + paths.sep), dependencyExcluded: () => false,
    json: (file: string) => JSON.parse(readFileSync(file, 'utf8')),
    statSync: (file: string) => statSync(file.replace(destination, source)),
  });
  refused(() => copied(source, destination, lock), 'dependency_invalid');
});
test('immutable build identity excludes only fixed runtime caches and detects server/static mutations', t => {
  const root = tiny(t); put(root, '.next/BUILD_ID', 'synthetic-build'); put(root, '.next/server/a.js', 'server'); put(root, '.next/static/a.js', 'static'); put(root, '.next/build-manifest.json', '{}'); put(root, '.next/cache/a', 'cache'); put(root, '.next/trace', 'trace');
  const first = harness.buildIdentity(root); assert.deepEqual(first.exclusions, ['cache/', 'trace', 'trace-build', 'diagnostics/']); assert.equal(first.fileCount, 4);
  put(root, '.next/cache/a', 'changed cache'); put(root, '.next/trace', 'changed trace'); assert.deepEqual(harness.buildIdentity(root), first);
  put(root, '.next/server/a.js', 'mutated server'); assert.notEqual(harness.buildIdentity(root).digest, first.digest);
  symlinkSync('a.js', join(root, '.next/server/link')); refused(() => harness.buildIdentity(root), 'source_changed');
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
  const register = privateFunction('registerProcess', { processInfo: () => current, sameProcess: harness.sameProcess, refuse, join, writeJson: (_path: string, value: ProcessRow) => saved.push(value) });
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
  const register = privateFunction('registerProcess', { processInfo, sameProcess: harness.sameProcess, refuse, join, writeJson: (_path: string, value: ProcessRow) => saved.push(value) });
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
  const register = privateFunction('registerProcess', { processInfo, sameProcess: harness.sameProcess, refuse, join, writeJson: (_path: string, value: ProcessRow) => records.push(value) });
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

test('expired owned cleanup still attempts verified process stop and saves failure without deleting unchecked data', async () => {
  const owner = ownerRecord(), fakeProcess = { env, exitCode: 0 }, actions: string[] = [];
  const report = { status: 'awaiting-cleanup', cleanup: { processes: 'unverified', source: 'unverified', normalBuild: 'unverified', copy: 'unverified', stack: 'unverified' } };
  const cleanup = privateFunction('cleanup', {
    validateRunner: () => {}, process: fakeProcess, ROOT: env.GITHUB_WORKSPACE, OWNER_PATH: '.e2e/legacy-evidence-b2-owner.json', existsSync: () => true,
    join, readOwner: () => owner, ownedCleanupDeadline: () => 0, regularPath: (_root: string, path: string) => path, json: () => ({ report }), Date: { now: () => 1 },
    reap: async (_owner: unknown, deadline: number) => { assert.equal(deadline, 0); actions.push('stop-owned'); }, assertCleanupTime: (deadline: number) => harness.assertCleanupTime(deadline, 1),
    safeFailure: harness.safeFailure, saveReport: (value: unknown) => { assert.equal(value, report); actions.push('report'); }, rmSync: () => assert.fail('expired cleanup must not delete unchecked source'),
    verifyCheckout: () => assert.fail('expired cleanup must not start source traversal'),
  });
  await cleanup(); assert.deepEqual(actions, ['stop-owned', 'report']); assert.equal(report.status, 'failed'); assert.equal(report.cleanup.processes, 'passed'); assert.equal(report.cleanup.copy, 'failed'); assert.equal(fakeProcess.exitCode, 1);
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
