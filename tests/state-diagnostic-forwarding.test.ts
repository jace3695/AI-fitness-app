import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectStateDiagnostic, stateDiagnosticCollector } from '../scripts/qa-state-diagnostics.mjs';

const prefixes = ['QA_GUIDED_BOUNDARY', 'QA_STORAGE_PROTOCOL_STATE', 'QA_HANDWRITING_RECOVERY_STATE', 'QA_HANDWRITING_SAVE_BOUNDARY', 'QA_OWNER_SWITCH_STATE'];
function read(prefix: string, data: unknown) {
  const projected = projectStateDiagnostic(`${prefix} ${JSON.stringify(data)}`);
  assert.ok(projected); assert.equal(projected.prefix, prefix);
  return JSON.parse(projected.line.slice(prefix.length + 1));
}

test('runner reconstructs useful guided, diet and handwriting state diagnostics from fixed fields', () => {
  const guided = read(prefixes[0], { level: 'intermediate', step: 2, phase: 'save-clicked', surface: 'present',
    status: 'unsaved', available: true, editorDirty: true, stepIndex: 2, turnCount: 2, exposure: { example: 'shown', meaning: 'shown', hint: 'not-shown' } });
  assert.equal(guided.status, 'unsaved'); assert.equal(guided.step, 2); assert.equal(guided.editorDirty, true);
  assert.equal(guided.exposure.hint, 'not-shown');
  const diet = read(prefixes[1], { phase: 'released', tab: 'peer', visibility: 'visible', savedHunger: 'absent', savedWater: '500', savedWater500: true, protocolState: 'committed' });
  assert.equal(diet.savedHunger, 'absent'); assert.equal(diet.savedWater, '500'); assert.equal(diet.savedWater500, true);
  const handwriting = read(prefixes[2], { savePresent: true, saveDisabled: false, hasPendingPng: false, hasRaster: true });
  assert.equal(handwriting.hasPendingPng, false); assert.equal(handwriting.saveDisabled, false);
  const boundary = read(prefixes[3], { phase: 'pending-transaction-aborted', pendingPutHasBlob: true, pendingRequestSucceeded: true, pendingTransactionAborted: true, errorBoundary: 'pending-transaction', errorName: 'QuotaExceededError' });
  assert.equal(boundary.phase, 'pending-transaction-aborted'); assert.equal(boundary.errorName, 'QuotaExceededError');
});

test('diagnostic prefixes cannot forward private fields, arbitrary enum values, arrays or nested values', () => {
  const secret = 'PRIVATE_TEXT_TOKEN_BLOB_OWNER_NOT_FOR_LOGS\u001b[31m\nPRIVATE_NEXT_LINE';
  for (const prefix of prefixes) {
    const schema = read(prefix, {});
    const tainted: Record<string, unknown> = Object.fromEntries(Object.keys(schema).map(key => [key, secret]));
    Object.assign(tainted, { ownerId: secret, raw: secret, input: secret, url: secret, blob: secret, __proto__: { privateValue: secret } });
    tainted.exposure = { example: secret, meaning: [secret], reading: { raw: secret }, hint: true };
    const output = JSON.stringify(read(prefix, tainted));
    const prototypeShape = `${prefix} {"__proto__":{"status":"saved","input":"PRIVATE_PROTOTYPE"},"constructor":{"prototype":{"owner":"PRIVATE_PROTOTYPE"}}}`;
    const prototypeResult = projectStateDiagnostic(prototypeShape);
    assert.ok(prototypeResult); assert.equal(prototypeResult.line.includes('PRIVATE_PROTOTYPE'), false);
    assert.equal(prototypeResult.line.includes('constructor'), false);
    assert.equal(output.includes(secret), false); assert.equal(output.includes('ownerId'), false);
    assert.equal(output.includes('privateValue'), false); assert.equal(output.includes('"input"'), false);
    for (const value of [null, [], 7, secret]) assert.equal(projectStateDiagnostic(`${prefix} ${JSON.stringify(value)}`), null);
  }
});

test('diagnostic forwarding refuses malformed, oversized and unknown lines and bounds logical counters', () => {
  for (const line of ['QA_GUIDED_BOUNDARY {', 'QA_UNKNOWN_DIAGNOSTIC {}', 'prefix QA_GUIDED_BOUNDARY {}',
    'QA_GUIDED_BOUNDARY ' + JSON.stringify({ input: 'x'.repeat(8192) }), '__proto__ {}']) assert.equal(projectStateDiagnostic(line), null);
  for (const value of [-1, 10001, 0.5, '3', false, {}, null]) {
    assert.equal(read(prefixes[0], { step: value, turnCount: value }).step, null);
    assert.equal(read(prefixes[0], { step: value, turnCount: value }).turnCount, null);
  }
  assert.equal(read(prefixes[0], { step: 0, turnCount: 10000 }).turnCount, 10000);
});

test('runner emits at most 512 sanitized lines per known diagnostic family and counts drops', () => {
  const collector = stateDiagnosticCollector();
  for (const prefix of prefixes) {
    let emitted = 0;
    for (let i = 0; i < 520; i++) if (collector.ingest(`${prefix} {"input":"PRIVATE_DROPPED"}`)) emitted++;
    assert.equal(emitted, 512);
    assert.equal(collector.snapshot().emitted[prefix], 512); assert.equal(collector.snapshot().dropped[prefix], 8);
  }
  assert.equal(collector.ingest('QA_UNKNOWN {}'), null);
  assert.equal(JSON.stringify(collector.snapshot()).includes('PRIVATE_DROPPED'), false);
});

test('actual runner forwards the projected string and never allowlists raw state-diagnostic lines', () => {
  const source = readFileSync(new URL('../scripts/qa-playwright.mjs', import.meta.url), 'utf8');
  assert.match(source, /const stateDiagnostic = stateDiagnostics\.ingest\(line\);\s*if \(stateDiagnostic\) console\.log\(stateDiagnostic\);/);
  const rawForward = source.split('\n').find(line => line.includes('console.log(line)'))!;
  assert.ok(rawForward);
  for (const prefix of prefixes) assert.equal(rawForward.includes(prefix), false);
  assert.match(source, /process\.exitCode = code === 0 && !process\.exitCode \? 0 : 1/);
  assert.match(source, /child\.on\('error', \(\) => \{ console\.error\('Verification process could not start'\); process\.exitCode = 1;/);
  assert.match(source, /state-diagnostics-\$\{invocation\}\.json/);
});


test('state diagnostic output is bounded and both browser projects fit the current journey budget', () => {
  const collector = stateDiagnosticCollector();
  // Reserve four steps per journey (the current maximum is three). Per
  // project: three pilot journeys at six checkpoints, three catalogue at seven, plus
  // five close/reload/final checkpoints, plus two catalogue readback checkpoints. Both fit 512.
  const guidedRows = 2 * (3 * (4 * 6 + 5) + 3 * (4 * 7 + 7));
  assert.equal(guidedRows, 384);
  for (let i = 0; i < guidedRows; i++) {
    const line = collector.ingest('QA_GUIDED_BOUNDARY ' + JSON.stringify({ phase: 'save-clicked', status: 'saved', step: 10000, totalSteps: 10000 }));
    assert.ok(line); assert.ok(line.length <= 4096);
  }
  for (const prefix of prefixes) {
    const result = projectStateDiagnostic(`${prefix} {}`);
    assert.ok(result); assert.ok(result.line.length <= 4096);
  }
  assert.equal(collector.snapshot().dropped.QA_GUIDED_BOUNDARY, 0);
});

test('owner-switch forwarding preserves only fixed phases and identity comparisons through failure', () => {
  const value = read('QA_OWNER_SWITCH_STATE', { phase: 'owner-b-ready', tab: 'first', failed: true, authGate: 'editor', sync: 'error',
    owner: 'B', desiredOwner: 'B', readyOwner: 'B', readyMatchesEpoch: true, localMatchesA: false, localMatchesB: true,
    lockHeld: 0, lockPending: 1, reads: 3, writes: 0, lastReadOwner: 'B', lastReadResult: 'ok', ownerId: 'PRIVATE_OWNER', raw: 'PRIVATE_RECORD' });
  assert.equal(value.phase, 'owner-b-ready'); assert.equal(value.failed, true); assert.equal(value.owner, 'B'); assert.equal(value.sync, 'error');
  assert.equal(value.localMatchesB, true); assert.equal(value.lockPending, 1); assert.equal(value.lastReadResult, 'ok');
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|ownerId|raw/);
});


test('guided read-only recovery phases survive the bounded state projection', () => {
  for (const phase of ['before-recovery', 'recovered']) {
    assert.equal(read('QA_GUIDED_BOUNDARY', { phase }).phase, phase);
  }
});
