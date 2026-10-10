import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { CASES, REFUSALS, EXECUTOR_DEPENDENCIES, DIAGNOSTIC_LINE_LIMIT, DIAGNOSTIC_CHARACTER_LIMIT, createLegacyEvidenceDiagnostics, diagnosticAssert, rememberSqlDenial, safeCode } from '../scripts/legacy-evidence-ci-diagnostics.mjs';
import { validateEnvironment } from '../scripts/qa-legacy-evidence-postgres.mjs';

const capture = () => {
  const lines: string[] = [];
  return { lines, diagnostics: createLegacyEvidenceDiagnostics((line: string) => lines.push(line)),
    entries: () => lines.map(line => JSON.parse(line.slice('[legacy-evidence-ci] '.length))) };
};
const driver = new URL('../scripts/qa-legacy-evidence-postgres.mjs', import.meta.url).href;

test('pure lifecycle emits before work, returns results, and rethrows the same failure without running later work', async () => {
  const { diagnostics, entries } = capture();
  const failure = Object.assign(new Error('private assertion details'), { code: 'ERR_ASSERTION' });
  let http = false;
  await assert.rejects(async () => {
    assert.equal(await diagnostics.run('preflight', 'arguments_and_stack', () => {
      assert.equal(entries().at(-1).status, 'running'); return 'verified';
    }), 'verified');
    await diagnostics.run('postgres', 'execute', async () => {
      diagnostics.start('audit', 'privileges'); throw failure;
    });
    http = true;
  }, error => error === failure);
  diagnostics.failed(failure); // An enclosing catch cannot mislabel/repeat it.
  assert.equal(http, false);
  assert.deepEqual(entries().map(({ phase, checkpoint, status }) => [phase, checkpoint, status]), [
    ['preflight', 'arguments_and_stack', 'running'], ['preflight', 'arguments_and_stack', 'passed'],
    ['postgres', 'execute', 'running'], ['audit', 'privileges', 'running'], ['audit', 'privileges', 'failed'],
  ]);
});

test('case outcomes are the fixed eleven names and failure never becomes a pass', async () => {
  const { diagnostics, entries } = capture();
  for (const name of CASES) await diagnostics.run('scenario', 'execute', () => ({ secret: 'not logged' }), name);
  const failure = Object.assign(new Error('SQL and payload omitted'), { code: '42501' });
  await assert.rejects(diagnostics.run('scenario', 'execute', () => { throw failure; }, CASES[0]), error => error === failure);
  assert.deepEqual(entries().slice(0, 22).map(row => row.case), CASES.flatMap(name => [name, name]));
  assert.deepEqual(entries().at(-1), { phase: 'scenario', checkpoint: 'execute', case: CASES[0], status: 'failed', code: '42501' });
});

test('cleanup attempts every resource after failures and propagates its first failure', async () => {
  const { diagnostics, entries } = capture(), calls: string[] = [];
  const first = new Error('secret cleanup details'), second = new Error('other cleanup details');
  await assert.rejects(diagnostics.cleanup([
    { checkpoint: 'postgres_sessions', run: () => { calls.push('sessions'); throw first; } },
    { checkpoint: 'postgres_accounts', run: async () => { calls.push('accounts'); throw second; } },
    { checkpoint: 'postgres_observer', run: () => { calls.push('observer'); } },
  ]), error => error === first);
  assert.deepEqual(calls, ['sessions', 'accounts', 'observer']);
  assert.deepEqual(entries().map(row => row.status), ['running', 'failed', 'running', 'failed', 'running', 'passed']);
  for (const checkpoint of ['http_repository', 'http_coordinator', 'http_owner', 'http_fixture', 'http_indexeddb', 'http_accounts']) {
    await diagnostics.cleanup([{ checkpoint, run: () => { calls.push(checkpoint); } }]);
  }
  assert.equal(calls.length, 9);
});

test('malicious payloads, arbitrary legacy/error-shaped strings and reports never enter console diagnostics', () => {
  const { diagnostics, lines, entries } = capture();
  const secret = 'Bearer private-token; select * from private_data; person@example.invalid; https://example.invalid/?key=secret';
  const error = {
    code: 'legacy_private_token', refusal: 'private_token', message: secret, cause: secret,
    stack: `Error: ${secret}\n    at attacker (file:///private/${secret}:9:1)\n    at allowed (${driver}:42:7)\n    at allowed (${driver}:99:2)`,
    sanitizedReport: { status: secret, cases: [{ name: secret, status: secret }], waits: [{ waiterPid: 31415 }], backends: [31415] },
    httpReport: { checks: { secret }, rpcCounts: { secret }, receiptDigest: secret },
    stdout: secret, stderr: secret, headers: { Authorization: secret }, body: secret,
    toJSON() { throw new Error('must not serialize payload'); },
  };
  diagnostics.start('audit', 'schema'); diagnostics.failed(error);
  assert.deepEqual(entries()[1], { phase: 'audit', checkpoint: 'schema', status: 'failed', code: 'harness_error' });
  for (const value of [secret, 'private_token', '31415', 'Authorization', 'sanitizedReport', 'httpReport', 'stdout', 'stderr']) assert.equal(lines.join('\n').includes(value), false);
  for (const code of ['ABCDE', 'TOKEN', 'legacy_person_name', 'legacy_' + 'x'.repeat(100_000), { toString() { throw new Error('no coercion'); } }]) assert.equal(safeCode({ code }), 'harness_error');
  for (const code of ['ERR_ASSERTION', '42501', '57014', 'legacy_cleanup_failed']) assert.equal(safeCode({ code }), code);
});

test('hostile accessors and inspection are not evaluated and cannot replace the gate failure', async () => {
  const { diagnostics, entries } = capture(); let reads = 0;
  const hostile = Object.defineProperties({}, Object.fromEntries(['code', 'stack', 'refusal', 'message', 'cause', 'toJSON'].map(key => [key, { get() { reads++; throw new Error('private'); } }])));
  await assert.rejects(diagnostics.run('http', 'execute', () => { throw hostile; }), error => error === hostile);
  const native = new Error('private'); Object.defineProperty(native, 'message', { get() { reads++; throw new Error('private'); } });
  diagnostics.failed(native);
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw new Error('private'); } }); diagnostics.failed(proxy);
  assert.equal(reads, 0); assert.ok(entries().filter(row => row.status === 'failed').every(row => row.code === 'harness_error' && row.sources === undefined));
});

test('preflight refusal codes cover actual authored paths without reading native stack accessors', () => {
  const source = readFileSync(new URL('../scripts/qa-legacy-evidence-postgres.mjs', import.meta.url), 'utf8');
  for (const [, message] of source.matchAll(/refuse\('([^']+)'\)/g)) assert.ok(Object.hasOwn(REFUSALS, message), message);
  const { diagnostics, entries } = capture(); diagnostics.start('preflight', 'arguments_and_stack');
  try { validateEnvironment({}, '', {}); assert.fail('preflight must refuse'); } catch (error) { diagnostics.failed(error); }
  const failed = entries().at(-1);
  assert.equal(failed.code, 'legacy_harness_refused'); assert.equal(failed.refusal, 'runner_required');
  assert.equal(failed.sources, undefined);
});

test('console line count, source frame count and line lengths remain bounded', () => {
  const { diagnostics, lines, entries } = capture();
  // Synthetic call sites exercise the native coordinate filter without running
  // either driver, a database, an HTTP request or a subprocess.
  let invoke = () => diagnosticAssert.equal(1, 2);
  invoke = compileFunction('return assertion.equal(1, 2);', ['assertion'], { filename: driver }).bind(null, diagnosticAssert);
  for (let i = 0; i < 5; i++) invoke = compileFunction('\n'.repeat(i + 1) + 'return next();', ['next'], { filename: driver }).bind(null, invoke);
  diagnostics.start('scenario', 'execute', CASES[3]);
  try { invoke(); assert.fail('expected assertion'); } catch (error) { diagnostics.failed(error); }
  assert.equal(entries()[1].code, 'ERR_ASSERTION'); assert.equal(entries()[1].sources.length, 3);
  assert.ok(entries()[1].sources.every((source: string) => /^qa-legacy-evidence-postgres\.mjs:[1-9][0-9]{0,4}:[1-9][0-9]{0,4}$/.test(source)));
  for (let i = 0; i < DIAGNOSTIC_LINE_LIMIT * 2; i++) diagnostics.start('gate', 'complete');
  assert.equal(lines.length, DIAGNOSTIC_LINE_LIMIT); assert.equal(lines.at(-1), '[legacy-evidence-ci] diagnostics_limit_reached');
  assert.ok(lines.every(line => line.length <= DIAGNOSTIC_CHARACTER_LIMIT));
  for (const filename of ['file:///elsewhere/qa-legacy-evidence-postgres.mjs', `${driver}?private-token`]) {
    const log = capture();
    try { compileFunction('assertion.equal(1, 2);', ['assertion'], { filename })(diagnosticAssert); } catch (error) { log.diagnostics.failed(error); }
    assert.equal(log.entries()[0].sources, undefined);
  }
  for (const stack of [`Error\n    at attacker (file:///elsewhere/qa-legacy-evidence-postgres.mjs:1:1)`, `Error\n    at caller (${driver}:100000:1)`, `Error\n    at caller (${driver}:1:100000)`, 'x'.repeat(100_000)]) {
    const log = capture(); log.diagnostics.failed({ stack }); assert.equal(log.entries()[0].sources, undefined);
  }
});

test('invalid diagnostic enums cannot print arbitrary data; a broken sink cannot suppress or replace work', async () => {
  const { diagnostics, lines } = capture();
  for (const args of [['secret', 'schema'], ['audit', 'secret'], ['scenario', 'execute', 'secret']]) assert.throws(() => diagnostics.start(...args), /Invalid diagnostic enum/);
  assert.equal(lines.length, 0);
  const broken = createLegacyEvidenceDiagnostics(() => { throw new Error('sink unavailable'); });
  assert.equal(await broken.run('preflight', 'arguments_and_stack', () => 7), 7);
  const failure = new Error('original'); await assert.rejects(broken.run('http', 'execute', () => { throw failure; }), error => error === failure);
  await assert.rejects(broken.cleanup([{ checkpoint: 'http_accounts', run: () => { throw failure; } }]), error => error === failure);
});

test('driver diagnostics precede preflight, audits, cases, HTTP and cleanup while the exit gate stays nonzero', () => {
  const pg = readFileSync(new URL('../scripts/qa-legacy-evidence-postgres.mjs', import.meta.url), 'utf8');
  const http = readFileSync(new URL('../scripts/qa-legacy-evidence-http.mjs', import.meta.url), 'utf8');
  const main = pg.slice(pg.indexOf('export async function main()'));
  assert.ok(main.indexOf("diagnostics.start('preflight'") < main.indexOf('verifyDisposableStack(diagnostics)'));
  assert.ok(pg.indexOf("diagnostics.start('audit', 'schema')") < pg.indexOf('const schema = await observer.scalar'));
  assert.ok(pg.indexOf("diagnostics.start('audit', 'privileges')") < pg.indexOf('const privilegeAudit = await observer.scalar'));
  assert.match(pg, /diagnostics\.run\('scenario', 'execute'/);
  assert.match(main, /diagnostics\.run\('http', 'execute'/);
  assert.match(main, /diagnostics\.run\('report', 'write'/);
  assert.match(main, /catch \(error\) \{ diagnostics\.failed\(error\); if \(!stack\) throw error; report =/);
  assert.ok(main.indexOf('stack = verifyDisposableStack(diagnostics)') < main.indexOf("diagnostics.run('postgres'"));
  assert.match(pg, /Promise\.allSettled\(\[a\.close\(\), b\.close\(\)\]\)/);
  for (const checkpoint of ['postgres_sessions', 'postgres_accounts', 'postgres_observer']) assert.ok(pg.includes(`checkpoint: '${checkpoint}'`));
  for (const checkpoint of ['http_repository', 'http_coordinator', 'http_owner', 'http_fixture', 'http_indexeddb', 'http_accounts']) assert.ok(http.includes(`checkpoint: '${checkpoint}'`));
  assert.match(main, /main\(\)\.catch\([\s\S]*process\.exitCode = 1/);
  assert.doesNotMatch(pg + http, /console\.(?:log|error)\([^\n]*(?:JSON\.stringify|error\.|report\.)/);
});

test('preinstalled and later custom stack formatters are never invoked by diagnostics', async () => {
  const previous = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace'); let calls = 0;
  const formatter = () => { calls++; throw new Error('must never format the payload'); };
  try {
    Object.defineProperty(Error, 'prepareStackTrace', { configurable: true, writable: true, value: formatter });
    const fresh = await import(new URL('../scripts/legacy-evidence-ci-diagnostics.mjs?formatter-isolation', import.meta.url).href);
    const lines: string[] = [], diagnostics = fresh.createLegacyEvidenceDiagnostics((line: string) => lines.push(line));
    diagnostics.failed(new Error('secret with a native stack accessor'));
    const existing = capture(); existing.diagnostics.failed(new Error('another secret'));
    assert.equal(calls, 0); assert.equal(lines.length, 1); assert.equal(existing.entries()[0].sources, undefined);
  } finally {
    if (previous) Object.defineProperty(Error, 'prepareStackTrace', previous); else Reflect.deleteProperty(Error, 'prepareStackTrace');
  }
});

test('assertion facade preserves every used built-in assertion and async rejection semantics', async () => {
  assert.equal(diagnosticAssert.equal(1, 1), undefined);
  assert.equal(diagnosticAssert.notEqual(1, 2), undefined);
  assert.equal(diagnosticAssert.deepEqual({ a: 1 }, { a: 1 }), undefined);
  assert.equal(diagnosticAssert.ok(true), undefined);
  assert.equal(diagnosticAssert.match('abc', /abc/), undefined);
  assert.equal(diagnosticAssert.throws(() => { throw new Error('expected'); }, /expected/), undefined);
  assert.equal(await diagnosticAssert.rejects(Promise.reject(new Error('expected')), /expected/), undefined);
  for (const callback of [() => diagnosticAssert.equal(1, 2), () => diagnosticAssert.notEqual(1, 1),
    () => diagnosticAssert.deepEqual({ a: 1 }, { a: 2 }), () => diagnosticAssert.ok(false),
    () => diagnosticAssert.match('abc', /xyz/), () => diagnosticAssert.throws(() => {}, /expected/)]) {
    assert.throws(callback, { code: 'ERR_ASSERTION' });
  }
  await assert.rejects(diagnosticAssert.rejects(Promise.resolve()), { code: 'ERR_ASSERTION' });
  const original = new Error('predicate failure');
  assert.throws(() => diagnosticAssert.throws(() => { throw new Error('expected'); }, () => { throw original; }), error => error === original);
  await assert.rejects(diagnosticAssert.rejects(Promise.reject(new Error('expected')), () => { throw original; }), error => error === original);
});

test('actual denial assertion retains exact expectations and carries only closed SQL classifications', () => {
  const source = readFileSync(new URL('../scripts/qa-legacy-evidence-postgres.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function denied('), source.indexOf('\nasync function waitForBlock('));
  const denied = compileFunction(body + '\nreturn denied;', ['assert', 'rememberSqlDenial'], { filename: driver })(diagnosticAssert, rememberSqlDenial);
  assert.equal(denied({ ok: false, error: 'legacy_auth_mismatch', sqlstate: '42501' }, ['legacy_auth_mismatch']), 'legacy_auth_mismatch');
  const { diagnostics, entries } = capture(); diagnostics.start('audit', 'restricted_roles');
  let original: unknown;
  try { denied({ ok: false, error: 'sql_error', sqlstate: '42501' }, ['legacy_auth_mismatch']); }
  catch (error) { original = error; diagnostics.failed(error); }
  assert.ok(original); assert.equal((original as { code: string }).code, 'ERR_ASSERTION');
  assert.deepEqual(entries().at(-1).denial, { sqlstate: '42501', error: 'sql_error' });
  assert.equal(entries().at(-1).sources.length, 1);
  assert.throws(() => denied({ ok: true, error: 'legacy_auth_mismatch', sqlstate: '42501' }, ['legacy_auth_mismatch']), { code: 'ERR_ASSERTION' });
  const supplied = new Error('original assertion');
  const throwing = compileFunction(body + '\nreturn denied;', ['assert', 'rememberSqlDenial'], { filename: driver })({ equal() { throw supplied; } }, rememberSqlDenial);
  assert.throws(() => throwing({}, []), error => error === supplied);
});

test('SQL classifications and dependency observations ignore secrets, accessors and proxies', () => {
  const { diagnostics, entries, lines } = capture(); let reads = 0;
  const hostile = Object.defineProperties({}, Object.fromEntries(['sqlstate', 'error', 'toJSON'].map(key => [key, { get() { reads++; throw new Error('private'); } }])));
  for (const result of [hostile, new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw new Error('private'); } }),
    { sqlstate: 'TOKEN', error: 'legacy_private_token', toJSON() { reads++; } }, { sqlstate: { toString() { reads++; } }, error: 123 }]) {
    const error = new Error('private'); rememberSqlDenial(error, result); diagnostics.failed(error);
    assert.deepEqual(entries().at(-1).denial, { sqlstate: 'unknown_sqlstate', error: 'unknown_error' });
  }
  assert.equal(reads, 0); assert.equal(lines.join('\n').includes('private'), false);
  for (const name of EXECUTOR_DEPENDENCIES) diagnostics.dependency(name, name !== 'executor_auth_usage');
  const observed = entries().filter(row => row.status === 'observed');
  assert.equal(observed.length, 17); assert.deepEqual(observed[0], { phase: 'audit', checkpoint: 'dependencies', dependency: 'executor_auth_usage', granted: false, status: 'observed' });
  for (const [name, value] of [['private_token', true], ['executor_auth_usage', hostile], ['executor_auth_usage', 'false']]) assert.throws(() => diagnostics.dependency(name, value), /Invalid diagnostic enum/);
  assert.equal(reads, 0);
});

test('complete gate markers leave late-failure capacity and longest denial stays within the original bounds', async () => {
  const { diagnostics, lines } = capture();
  // Conservative full path: include a passed marker even at milestones that
  // only emit running today. No real stack, HTTP call or subprocess is needed.
  for (const [phase, checkpoints] of Object.entries({
    preflight: ['arguments_and_stack', 'generated_files', 'status_and_config', 'docker_context', 'container_discovery', 'container_identity'],
    postgres: ['execute', 'imports', 'source_digests', 'sessions', 'synthetic_accounts'],
    audit: ['schema', 'privileges', 'dependencies', 'restricted_roles', 'disposable_activation'],
  })) for (const checkpoint of checkpoints) { diagnostics.start(phase, checkpoint); diagnostics.passed(); }
  for (const name of EXECUTOR_DEPENDENCIES) diagnostics.dependency(name, true);
  for (const name of CASES) await diagnostics.run('scenario', 'execute', () => {}, name);
  await diagnostics.run('http', 'execute', () => { diagnostics.start('http', 'execute'); diagnostics.passed(); });
  await diagnostics.cleanup(['postgres_sessions', 'postgres_accounts', 'postgres_observer', 'http_repository', 'http_coordinator', 'http_owner', 'http_fixture', 'http_indexeddb', 'http_accounts'].map(checkpoint => ({ checkpoint, run() {} })));
  await diagnostics.run('report', 'write', () => {}); diagnostics.start('gate', 'complete'); diagnostics.passed();
  let invoke = compileFunction('assertion.equal(1, 2);', ['assertion'], { filename: driver }).bind(null, diagnosticAssert);
  for (let i = 0; i < 3; i++) invoke = compileFunction('return next();', ['next'], { filename: driver }).bind(null, invoke);
  diagnostics.start('scenario', 'execute', CASES[3]);
  try { invoke(); } catch (error) { rememberSqlDenial(error, { sqlstate: 'P0001', error: 'legacy_enrolled_generation_missing' }); diagnostics.failed(error); }
  assert.ok(lines.length < DIAGNOSTIC_LINE_LIMIT - 10);
  assert.ok(lines.every(line => line.length <= DIAGNOSTIC_CHARACTER_LIMIT));
  assert.equal(JSON.parse(lines.at(-1)!.slice('[legacy-evidence-ci] '.length)).denial.error, 'legacy_enrolled_generation_missing');
});
