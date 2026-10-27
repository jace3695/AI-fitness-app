import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import SafeReporter from './e2e/reporter.ts';
import { failureDiagnostics, storedFailureDiagnostics } from './e2e/failure-diagnostics.ts';

const root = '/private-checkout';
const file = 'tests/e2e/free-advice.spec.ts';
const otherFile = 'tests/e2e/assistant-budget-commands.spec.ts';
const allowedSources = new Set([file, otherFile]);
const definition = { file: `${root}/${file}`, line: 10, column: 1 };
const assertion = { file: `${root}/${file}`, line: 42, column: 7 };
const error = { location: assertion };
const diagnostic = (errors: unknown[] = [error], status = 'failed', testLocation: unknown = definition) =>
  failureDiagnostics(testLocation, { status, errors }, root, allowedSources);

test('native failure coordinates remain distinct from the test definition fallback', () => {
  assert.deepEqual(diagnostic(), {
    category: 'test-error', testDefinition: { file, line: 10, column: 1 },
    errors: [{ location: { file, line: 42, column: 7 } }], omittedErrors: 0,
  });
  assert.deepEqual(diagnostic([{}]), {
    category: 'test-error', testDefinition: { file, line: 10, column: 1 }, errors: [{}], omittedErrors: 0,
  });
  assert.deepEqual(diagnostic([{ location: { ...assertion, file: `${root}/${otherFile}` } }])?.errors, [{}]);
});

test('failure categories come only from fixed test statuses; passing and legacy results have none', () => {
  assert.equal(diagnostic([], 'timedOut')?.category, 'timeout');
  assert.equal(diagnostic([], 'interrupted')?.category, 'interrupted');
  for (const status of ['passed', 'skipped', 'private-token', '비밀', 'https://private.example']) {
    assert.equal(diagnostic([error], status), undefined);
  }
  assert.equal(storedFailureDiagnostics(undefined, root, allowedSources), undefined);
  assert.equal(storedFailureDiagnostics({ title: 'legacy', status: 'failed', durationMs: 1 }, root, allowedSources), undefined);
  for (const category of ['private-token', '비밀', ['timeout'], { value: 'private-token' }, null]) {
    assert.equal(storedFailureDiagnostics({ category }, root, allowedSources), undefined);
  }
});

test('known relative and separator-normalized in-root source paths are accepted', () => {
  for (const source of [file, `${root}/${file}`, `${root}/${file}`.replaceAll('/', '\\')]) {
    assert.equal(diagnostic([{ location: { ...assertion, file: source } }])?.errors[0].location?.file, file);
  }
  assert.deepEqual(failureDiagnostics({ ...definition, file: `C:\\checkout\\${file.replaceAll('/', '\\')}` }, {
    status: 'failed', errors: [{ location: { ...assertion, file: `C:/checkout/${file}` } }],
  }, 'C:\\checkout', allowedSources)?.errors, [{ location: { file, line: 42, column: 7 } }]);
});

test('unsafe, unknown, Unicode, URL, traversal and outside-root filenames never escape', () => {
  const badFiles = [
    `/outside/${file}`, `${root}-other/${file}`, `https://private.example/${file}`,
    `file://${root}/${file}`, `${root}/../${file}`, `${root}/tests/e2e/../e2e/free-advice.spec.ts`,
    'tests\\e2e\\..\\e2e\\free-advice.spec.ts', '//private-server/tests/e2e/free-advice.spec.ts',
    'tests/e2e/private-token.spec.ts', 'tests/e2e/비밀.spec.ts', 'tests/e2e/free-advice.spec.ts?token=private',
    `${root}/${file}\nprivate-token`, `${root}/${file}\u0000`, 'tests/e2e/fixture.ts', 'x'.repeat(4097),
  ];
  for (const source of badFiles) {
    const result = diagnostic([{ location: { ...assertion, file: source } }], 'failed', { ...definition, file: source });
    assert.deepEqual(result, { category: 'test-error', errors: [{}], omittedErrors: 0 });
  }
  // Even an unsafe entry accidentally included in the trusted name set is rejected.
  const unicodeFile = 'tests/e2e/비밀.spec.ts';
  assert.equal(failureDiagnostics({ ...definition, file: unicodeFile }, { status: 'failed', errors: [] }, root,
    new Set([unicodeFile]))?.testDefinition, undefined);
});

test('coordinates are positive, finite, bounded integers without coercion', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, 1_000_001, '42', null, undefined]) {
    for (const key of ['line', 'column']) {
      assert.deepEqual(diagnostic([{ location: { ...assertion, [key]: value } }])?.errors, [{}]);
    }
  }
  assert.equal(diagnostic([{ location: { ...assertion, line: 1_000_000, column: 1_000_000 } }])?.errors[0].location?.line, 1_000_000);
});

test('diagnostic error count is capped and omitted errors are accounted for', () => {
  const result = diagnostic(Array.from({ length: 40 }, () => error));
  assert.equal(result?.errors.length, 3);
  assert.equal(result?.omittedErrors, 37);
  assert.deepEqual(storedFailureDiagnostics(result, root, allowedSources), result);
  const stored = storedFailureDiagnostics({ ...result, errors: Array.from({ length: 40 }, () => error), omittedErrors: 1_000_000 }, root, allowedSources);
  assert.equal(stored?.errors.length, 3);
  assert.equal(stored?.omittedErrors, 1_000_000);
});

test('raw failure fields and private values are never read or serialized', () => {
  const unsafe = {
    location: assertion,
    message: 'private-body <input value="private">', stack: 'https://private.example/token',
    snippet: 'eyJprivate.token.value', value: 'sb_secret_private', cause: { message: 'Qa-aabb-ccdd!' },
    name: '비밀', attachments: [{ body: 'private-token' }],
  };
  const result = failureDiagnostics(definition, {
    status: 'failed', errors: [unsafe], steps: [{ title: 'private step', params: { password: 'private' } }],
    attachments: [{ body: 'private-body' }], stdout: ['private-token'], stderr: ['private-token'],
  }, root, allowedSources);
  assert.deepEqual(result, diagnostic());
  assert.doesNotMatch(JSON.stringify(result), /private|비밀|eyJ|sb_secret|Qa-|https:|input|password/);
  const throwingError = { location: assertion, get message() { throw new Error('must not inspect messages'); },
    get stack() { throw new Error('must not parse stacks'); } };
  assert.deepEqual(diagnostic([throwingError]), diagnostic());
});

test('stored JSON is reconstructed from safe fields rather than copied into logs', () => {
  const result = storedFailureDiagnostics({
    ...diagnostic(), title: 'private-title', token: 'private-token', message: '<private-body>',
    testDefinition: { ...definition, private: 'secret' },
    errors: [{ location: { ...assertion, private: 'secret' }, message: 'private-message' },
      { location: { ...assertion, file: `${root}/${otherFile}` } }],
  }, root, allowedSources);
  assert.deepEqual(result, { ...diagnostic(), errors: [{ location: { file, line: 42, column: 7 } }, {}] });
  assert.doesNotMatch(JSON.stringify(result), /private|secret/);
  for (const omittedErrors of [-1, Infinity, 1.5, 'private', 1_000_001]) {
    assert.equal(storedFailureDiagnostics({ ...diagnostic(), omittedErrors }, root, allowedSources)?.omittedErrors, 0);
  }
});

// Compile against the installed public reporter contract, not an undocumented
// property inferred from a runtime object. These are the only step fields read.
type NativeStepFields = Pick<TestResult['steps'][number], 'category' | 'error' | 'location' | 'steps'>;
const nativeStep = (overrides: Partial<NativeStepFields> = {}) => ({
  category: 'test.step', error: {}, location: assertion, steps: [], ...overrides,
});
const withSteps = (steps: unknown[]) => failureDiagnostics(definition,
  { status: 'failed', errors: [{}], steps }, root, allowedSources);
const safeStepLocation = { file, line: 42, column: 7 };

test('native failed literal steps retain a phase when a helper error has no allowed location', () => {
  const helper = { ...assertion, file: `${root}/tests/e2e/drawing-tools.ts` };
  const child = nativeStep({ category: 'expect', location: helper, error: { location: helper } });
  const result = withSteps([nativeStep({ steps: [child as TestResult['steps'][number]] })]);
  assert.deepEqual(result, { ...diagnostic([{}]), failedSteps: [safeStepLocation] });
  assert.deepEqual(storedFailureDiagnostics(result, root, allowedSources), result);
  // A phase remains distinct from the native error site and the test definition.
  assert.deepEqual(result?.errors, [{}]);
  assert.equal(result?.testDefinition?.line, 10);
});

test('only failed test.step wrappers in the same allowlisted spec yield step coordinates', () => {
  const nested = nativeStep({ location: { ...assertion, line: 50 } });
  const result = withSteps([
    nativeStep({ category: 'pw:api' }), nativeStep({ category: 'expect' }),
    nativeStep({ category: 'private-category' }), nativeStep({ error: undefined }),
    nativeStep({ location: { ...assertion, file: `${root}/${otherFile}` } }),
    nativeStep({ location: { ...assertion, file: `${root}/tests/e2e/drawing-tools.ts` } }),
    nativeStep({ location: { ...assertion, line: 0 } }),
    nativeStep({ steps: [nested as TestResult['steps'][number]] }),
  ]);
  assert.deepEqual(result?.failedSteps, [safeStepLocation, { ...safeStepLocation, line: 50 }]);
  assert.equal(result?.stepScanTruncated, undefined);
  assert.equal(failureDiagnostics(definition, { status: 'passed', steps: [nativeStep()] }, root, allowedSources), undefined);
});

test('step evidence never inspects private fields or the contents of native errors', () => {
  const privateGetter = { get() { throw new Error('private field must not be read'); } };
  const errorWithPrivateFields = Object.defineProperties({}, Object.fromEntries(
    ['message', 'stack', 'snippet', 'cause', 'value'].map(key => [key, privateGetter])));
  const step = Object.defineProperties(nativeStep({ error: errorWithPrivateFields }), Object.fromEntries(
    ['title', 'titlePath', 'subtitle', 'params', 'attachments', 'annotations', 'parent'].map(key => [key, privateGetter])));
  const result = withSteps([step]);
  assert.deepEqual(result, { ...diagnostic([{}]), failedSteps: [safeStepLocation] });
  assert.doesNotMatch(JSON.stringify(result), /private|password|token|https:|eyJ|sb_secret|Qa-/);
});

test('native step traversal and exported coordinates are bounded and cycle safe', () => {
  const crowded = withSteps(Array.from({ length: 40 }, () => nativeStep()));
  assert.equal(crowded?.failedSteps?.length, 3);
  assert.equal(crowded?.stepScanTruncated, true);
  const beyondLimit = Object.defineProperty({}, 'category', { get() { throw new Error('must not scan beyond 2000'); } });
  const bounded = withSteps([...Array.from({ length: 2000 }, () => nativeStep({ error: undefined })), beyondLimit]);
  assert.deepEqual(bounded, { ...diagnostic([{}]), stepScanTruncated: true });
  const cycle = nativeStep(); cycle.steps.push(cycle as TestResult['steps'][number]);
  assert.deepEqual(withSteps([cycle]), { ...diagnostic([{}]), failedSteps: [safeStepLocation] });
  // Deep input is handled iteratively rather than consuming the JS call stack.
  let deep = nativeStep({ error: undefined });
  for (let i = 0; i < 2100; i++) deep = nativeStep({ error: undefined, steps: [deep as TestResult['steps'][number]] });
  assert.equal(withSteps([deep])?.stepScanTruncated, true);
});

test('stored step evidence is revalidated, capped, same-spec only and reconstructed', () => {
  const stored = { ...diagnostic([{}]), failedSteps: [
    { ...assertion, token: 'private-token', message: 'private-message' },
    { ...assertion, file: `${root}/${otherFile}` },
    { ...assertion, file: `${root}/tests/e2e/drawing-tools.ts` },
    safeStepLocation,
  ], stepScanTruncated: 'private', params: { password: 'private' } };
  assert.deepEqual(storedFailureDiagnostics(stored, root, allowedSources), {
    ...diagnostic([{}]), failedSteps: [safeStepLocation], stepScanTruncated: true,
  });
  for (const bad of [null, {}, 'private', { ...assertion, column: Infinity },
    { ...assertion, file: `/outside/${file}` }, { ...assertion, file: `${root}/../${file}` }]) {
    assert.deepEqual(storedFailureDiagnostics({ ...diagnostic([{}]), failedSteps: [bad] }, root, allowedSources), diagnostic([{}]));
  }
  for (const flag of ['true', 1, {}, null, false]) {
    assert.equal(storedFailureDiagnostics({ ...diagnostic([{}]), stepScanTruncated: flag }, root, allowedSources)?.stepScanTruncated, undefined);
  }
  assert.equal(storedFailureDiagnostics({ ...diagnostic([{}]), stepScanTruncated: true }, root, allowedSources)?.stepScanTruncated, true);
  assert.equal(storedFailureDiagnostics({ ...diagnostic([{}]), testDefinition: undefined,
    failedSteps: [safeStepLocation] }, root, allowedSources)?.failedSteps, undefined);
});

test('reporter writes safe metadata to both existing reports and summary without raw errors', context => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-safe-failure-'));
  const previousDirectory = process.cwd();
  const previousSummary = process.env.GITHUB_STEP_SUMMARY;
  const previousCommit = process.env.QA_HEAD_SHA;
  const logged: unknown[][] = [];
  context.mock.method(console, 'log', (...args: unknown[]) => { logged.push(args); });
  context.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  try {
    mkdirSync(join(directory, 'tests/e2e'), { recursive: true });
    writeFileSync(join(directory, file), '// synthetic test source');
    writeFileSync(join(directory, 'private-source.ts'), '// private');
    symlinkSync(join(directory, 'private-source.ts'), join(directory, 'tests/e2e/private-token.spec.ts'));
    process.chdir(directory);
    process.env.GITHUB_STEP_SUMMARY = join(directory, 'summary.md');
    process.env.QA_HEAD_SHA = 'a'.repeat(40);
    const reporter = new SafeReporter();
    const caseFor = (source = file) => ({ titlePath: () => ['chromium', 'synthetic safe case'],
      location: { ...definition, file: join(directory, source) } } as unknown as TestCase);
    const resultFor = (status: string, source = file) => ({ status, duration: 12, errors: [{
      location: { ...assertion, file: join(directory, source) }, message: 'private-token',
      stack: 'https://private.example', snippet: '<private-body>',
    }] } as unknown as TestResult);
    reporter.onTestEnd(caseFor(), resultFor('failed'));
    reporter.onTestEnd(caseFor(), resultFor('passed'));
    reporter.onTestEnd(caseFor('tests/e2e/private-token.spec.ts'), resultFor('failed', 'tests/e2e/private-token.spec.ts'));
    const stepResult = resultFor('failed');
    stepResult.errors = [{}];
    stepResult.steps = [nativeStep({ location: { ...assertion, file: join(directory, file) } }) as TestResult['steps'][number]];
    reporter.onTestEnd(caseFor(), stepResult);
    reporter.onError();
    reporter.onEnd({ status: 'failed' } as FullResult);
    const reportPaths = readdirSync('.e2e/evidence');
    assert.equal(reportPaths.length, 2);
    assert.ok(reportPaths.includes('results.json'));
    const output = readFileSync('.e2e/evidence/results.json', 'utf8');
    const report = JSON.parse(output);
    assert.deepEqual(report.results[0], { title: 'chromium / synthetic safe case', status: 'failed', durationMs: 12, failure: diagnostic() });
    assert.deepEqual(report.results[1], { title: 'chromium / synthetic safe case', status: 'passed', durationMs: 12 });
    assert.deepEqual(report.results[2].failure, { category: 'test-error', errors: [{}], omittedErrors: 0 });
    assert.deepEqual(report.results[3].failure, { ...diagnostic([{}]), failedSteps: [safeStepLocation] });
    for (const path of reportPaths) assert.equal(readFileSync(join('.e2e/evidence', path), 'utf8'), output);
    const summary = readFileSync(process.env.GITHUB_STEP_SUMMARY, 'utf8');
    assert.ok(summary.includes(JSON.stringify(diagnostic())));
    assert.doesNotMatch(output + summary + JSON.stringify(logged), /private|https:|<private|eyJ|Qa-/);
  } finally {
    process.chdir(previousDirectory);
    if (previousSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = previousSummary;
    if (previousCommit === undefined) delete process.env.QA_HEAD_SHA; else process.env.QA_HEAD_SHA = previousCommit;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('installed native runner retains the safe wrapper location for a helper failure without any browser', () => {
  const repository = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'qa-native-step-'));
  try {
    mkdirSync(join(directory, 'tests/e2e'), { recursive: true });
    const source = 'tests/e2e/synthetic-step.spec.ts';
    writeFileSync(join(directory, 'tests/e2e/helper.ts'),
      "export function fail() { throw new Error('diagnostic-private-value'); }\n");
    writeFileSync(join(directory, source), [
      `import { test } from ${JSON.stringify(join(repository, 'node_modules/@playwright/test/index.js'))};`,
      "import { fail } from './helper';",
      "test('synthetic phase failure', async () => {",
      "  await test.step('literal phase', async () => { fail(); });",
      '});',
    ].join('\n'));
    // No browser/page/context fixture, webServer, URL, database or network call.
    writeFileSync(join(directory, 'offline.config.mjs'), `export default ${JSON.stringify({
      testDir: './tests/e2e', workers: 1, retries: 0,
      reporter: [[join(repository, 'tests/e2e/reporter.ts')]],
    })};\n`);
    const child = spawnSync(process.execPath, [join(repository, 'node_modules/@playwright/test/cli.js'),
      'test', '--config', 'offline.config.mjs'], {
      cwd: directory, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, QA_HEAD_SHA: 'a'.repeat(40), GITHUB_STEP_SUMMARY: join(directory, 'summary.md') },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1, 'The synthetic helper failure remains a real failed test');
    const report = JSON.parse(readFileSync(join(directory, '.e2e/evidence/results.json'), 'utf8'));
    assert.equal(report.status, 'failed'); assert.equal(report.results.length, 1);
    const failure = report.results[0].failure;
    assert.deepEqual(failure.errors, [{}], 'Helper coordinates stay outside the existing spec allowlist');
    assert.equal(failure.testDefinition.file, source); assert.equal(failure.testDefinition.line, 3);
    assert.equal(failure.failedSteps.length, 1);
    assert.equal(failure.failedSteps[0].file, source); assert.equal(failure.failedSteps[0].line, 4);
    assert.ok(failure.failedSteps[0].column > 0);
    assert.equal(failure.stepScanTruncated, undefined);
    assert.deepEqual(storedFailureDiagnostics(failure, directory, new Set([source])), failure);
    assert.doesNotMatch(JSON.stringify(report) + child.stdout + child.stderr
      + readFileSync(join(directory, 'summary.md'), 'utf8'), /diagnostic-private-value|literal phase|helper\.ts/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('wrapper retains raw-output denial and validates diagnostics before bounded logging', () => {
  const wrapper = readFileSync('scripts/qa-playwright.mjs', 'utf8');
  assert.match(wrapper, /storedFailureDiagnostics\(row\.failure, process\.cwd\(\), allowedSources\)/);
  assert.match(wrapper, /if \(loggedFailures === 20\) break/);
  assert.match(wrapper, /\['failed', 'timedOut', 'interrupted'\]\.includes\(row\?\.status\)/);
  assert.match(wrapper, /JSON\.stringify\(\{ resultIndex, \.\.\.failure \}\)/);
  assert.doesNotMatch(wrapper, /QA_TEST_FAILURE \|/);
  assert.doesNotMatch(wrapper, /JSON\.stringify\(row\)|row\.title|error\.message|error\.stack/);
});

test('offline wrapper drops spoofed raw diagnostics and safely handles passed, legacy and tampered reports', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-wrapper-safe-failure-'));
  try {
    mkdirSync(join(directory, 'tests/e2e'), { recursive: true });
    mkdirSync(join(directory, '.e2e/evidence'), { recursive: true });
    mkdirSync(join(directory, 'node_modules/@playwright/test'), { recursive: true });
    writeFileSync(join(directory, file), '// synthetic test source');
    // This child is not Playwright: no browser, socket, server or provider is started.
    writeFileSync(join(directory, 'node_modules/@playwright/test/cli.js'),
      "console.log('private-raw-error'); console.log('QA_TEST_FAILURE {\"message\":\"private-spoof\"}'); process.exitCode = 1;\n");
    const result = { title: 'private-title', status: 'failed', durationMs: 1, failure: {
      ...diagnostic(), token: 'private-token', errors: [{ ...error, message: 'private-error',
        location: { ...assertion, file, extra: 'private-extra' } }],
      failedSteps: [{ ...safeStepLocation, params: { password: 'private' } }],
    } };
    writeFileSync(join(directory, '.e2e/evidence/results.json'), JSON.stringify({ commit: 'a'.repeat(40), status: 'failed', results: [
      { ...result, status: 'passed' },
      { title: 'private-legacy-title', status: 'failed', durationMs: 1 },
      { ...result, failure: { category: 'private-category' } },
      { ...result, failure: { category: 'timeout', testDefinition: { ...definition, file: '/private/source.spec.ts' },
        errors: [{ location: { ...assertion, file: '/private/source.spec.ts' }, message: 'private-message' }], omittedErrors: 'private' } },
      ...Array.from({ length: 25 }, () => result),
    ] }));
    const child = spawnSync(process.execPath, [join(process.cwd(), 'scripts/qa-playwright.mjs')], {
      cwd: directory, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, YEONI_E2E: '1', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', QA_HEAD_SHA: 'a'.repeat(40) },
    });
    assert.equal(child.error, undefined);
    // Diagnostic output must not turn a failing child into a successful verification.
    assert.equal(child.status, 1);
    const output = child.stdout + child.stderr;
    assert.doesNotMatch(output, /private|https:|Qa-|eyJ/);
    const failures = child.stdout.split('\n').filter(line => line.startsWith('QA_TEST_FAILURE '))
      .map(line => JSON.parse(line.slice('QA_TEST_FAILURE '.length)));
    assert.equal(failures.length, 20);
    assert.deepEqual(failures[0], { resultIndex: 3, category: 'timeout', errors: [{}], omittedErrors: 0 });
    assert.deepEqual(failures[1], { resultIndex: 4, ...diagnostic(), failedSteps: [safeStepLocation] });
    assert.ok(failures.every(row => row.resultIndex >= 3));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
