import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as diagnosticModule from './storageMarkerDiagnostic.ts';
import {
  classifyStorageMarkers, readStorageMarkerDiagnostic,
  type StorageMarkerDiagnostic, type StorageMarkerRead, type StorageMarkerReader, type StorageMarkerSample,
} from './storageMarkerDiagnostic.ts';

const KEYS = ['yeoni-storage-transaction-v1', 'yeoni-storage-transaction-v2', 'yeoni-storage-generation-v1'] as const;
const ORDER = [...KEYS, ...KEYS];
const [LEGACY, V2, GENERATION] = KEYS;
const MAX_MARKER = 1_048_576;
const MAX_TOTAL = 2_097_152;
const ABSENT: StorageMarkerRead = Object.freeze({ kind: 'absent' });
const UNAVAILABLE: StorageMarkerRead = Object.freeze({ kind: 'unavailable' });
const present = (raw: string): StorageMarkerRead => ({ kind: 'present', raw });
const sample = (legacy: StorageMarkerRead = ABSENT, v2: StorageMarkerRead = ABSENT, generation: StorageMarkerRead = ABSENT): StorageMarkerSample => ({ legacy, v2, generation });
const committed = (generation = 'fixture-generation') => JSON.stringify({ version: 2, state: 'committed', generation });
const prepared = (before: unknown = { 'fixture-record': 'fixture-old' }, extras = {}) => JSON.stringify({
  version: 2, state: 'prepared', generation: 'fixture-generation', transactionId: 'fixture-transaction', before, ...extras,
});

const allowed = {
  version: ['g8-marker-diagnostic/v1'],
  legacyMarker: ['absent', 'present_valid_shape', 'present_unreadable', 'inspection_incomplete', 'unavailable'],
  v2Marker: ['absent', 'committed_shape', 'prepared_shape', 'unreadable', 'unsupported_version', 'inspection_incomplete', 'unavailable'],
  observation: ['single_sample', 'no_marker_change_observed', 'changed_during_observation', 'unavailable'],
  reason: ['legacy_preservation_required', 'ambiguous_markers', 'invalid_metadata', 'inspection_incomplete', 'storage_unavailable', 'v2_prepared_observed', 'no_legacy_marker_observed'],
  quiescence: ['unverified'], repairPermission: ['none'], resumePermission: ['none'],
};

function assertClosed(result: StorageMarkerDiagnostic) {
  assert.deepEqual(Reflect.ownKeys(result).sort(), Object.keys(allowed).sort());
  for (const [key, value] of Object.entries(result)) {
    assert.equal(typeof value, 'string');
    assert.ok(allowed[key as keyof typeof allowed].includes(value), `Unexpected fixed code for ${key}`);
  }
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.quiescence, 'unverified');
  assert.equal(result.repairPermission, 'none');
  assert.equal(result.resumePermission, 'none');
}

/** Synchronous tripwires; restored before the Node runner does its own work. */
function withoutEffects<T>(run: () => T): T {
  let attempts = 0;
  const forbidden = () => { attempts++; throw new Error('fixture-forbidden-effect'); };
  const properties = [
    'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage',
    'indexedDB', 'caches', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
    'Worker', 'SharedWorker', 'BroadcastChannel', 'setTimeout', 'setInterval',
    'queueMicrotask', 'requestAnimationFrame', 'supabase',
  ];
  const descriptors = properties.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originals = consoleMethods.map(key => [key, console[key]] as const);
  try {
    for (const key of properties) Object.defineProperty(globalThis, key, { configurable: true, get: forbidden });
    for (const key of consoleMethods) console[key] = forbidden;
    return run();
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    for (const [key, method] of originals) console[key] = method;
    assert.equal(attempts, 0, 'No browser/auth/lock/network/navigation/clipboard/download/event/log/timer entrypoint may be touched');
  }
}

function fixture(values: Record<string, string> = {}, onRead?: (key: string, index: number, values: Map<string, string>) => void) {
  const data = new Map(Object.entries(values));
  const reads: string[] = [];
  let mutations = 0;
  let unexpectedAccess = 0;
  const forbidden = () => { mutations++; throw new Error('fixture-storage-mutation'); };
  const target = {
    getItem(key: string) {
      assert.ok((KEYS as readonly string[]).includes(key), 'Only the three protocol marker keys may be read');
      reads.push(key);
      const result = data.get(key) ?? null;
      onRead?.(key, reads.length, data);
      return result;
    },
    setItem: forbidden, removeItem: forbidden, clear: forbidden,
  };
  const storage = new Proxy(target, {
    get(object, property, receiver) {
      if (property !== 'getItem') { unexpectedAccess++; throw new Error('fixture-unexpected-storage-access'); }
      return Reflect.get(object, property, receiver);
    },
    ownKeys() { unexpectedAccess++; throw new Error('fixture-origin-enumeration'); },
    set() { mutations++; throw new Error('fixture-object-mutation'); },
  });
  const inspect = (unchanged = true) => {
    const before = [...data];
    const result = withoutEffects(() => readStorageMarkerDiagnostic(storage));
    assertClosed(result);
    assert.equal(mutations, 0);
    assert.equal(unexpectedAccess, 0);
    assert.deepEqual(reads, ORDER);
    if (unchanged) assert.deepEqual([...data], before);
    return result;
  };
  return { data, reads, storage, inspect };
}

function classify(first: StorageMarkerSample, second?: StorageMarkerSample) {
  const input = { first, second };
  const before = JSON.stringify(input);
  const result = withoutEffects(() => classifyStorageMarkers(input));
  assertClosed(result);
  assert.equal(JSON.stringify(input), before);
  return result;
}

test('D01: all fixed markers absent is only an observation, never permission', () => {
  const result = fixture({ 'fixture-unobserved-record': 'fixture-private' }).inspect();
  assert.equal(result.reason, 'no_legacy_marker_observed');
  assert.equal(result.legacyMarker, 'absent');
  assert.equal(result.v2Marker, 'absent');
  assert.equal(result.observation, 'no_marker_change_observed');
  assert.equal(classify(sample()).observation, 'single_sample');
});

test('D02: a v1 add/update/delete before-map remains private and unprojected', () => {
  const legacy = JSON.stringify({ 'fixture-update-private': 'fixture-owner-A', 'fixture-delete-private': 'fixture-old', 'fixture-added-private': null });
  const result = fixture({ [LEGACY]: legacy, 'fixture-update-private': 'fixture-partial', 'fixture-added-private': 'fixture-new' }).inspect();
  assert.equal(result.legacyMarker, 'present_valid_shape');
  assert.equal(result.reason, 'legacy_preservation_required');
  for (const secret of ['fixture-update-private', 'fixture-owner-A', 'fixture-delete-private', 'fixture-old', 'fixture-added-private', 'fixture-partial']) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('D03: empty or malformed v1 is present and cannot become empty records', () => {
  const invalid = ['', '{bad', 'null', '[]', '4', 'true', '"wrapped-map"', '{"fixture":4}', '{"fixture":false}', '{"fixture":{}}', '{"fixture":[]}', '{"fixture":undefined}'];
  for (const raw of invalid) {
    const result = fixture({ [LEGACY]: raw, 'fixture-record': 'fixture-keep' }).inspect();
    assert.equal(result.legacyMarker, 'present_unreadable');
    assert.equal(result.reason, 'legacy_preservation_required');
  }
  assert.equal(fixture({ [LEGACY]: '{}' }).inspect().legacyMarker, 'present_valid_shape');
});

test('D04: committed v2 does not release a legacy preservation block', () => {
  const result = fixture({ [LEGACY]: '{"fixture":"fixture-old"}', [V2]: committed() }).inspect();
  assert.equal(result.legacyMarker, 'present_valid_shape');
  assert.equal(result.v2Marker, 'committed_shape');
  assert.equal(result.reason, 'legacy_preservation_required');
});

test('D05: valid or malformed v1 with prepared v2 is ambiguous', () => {
  for (const raw of ['{}', '', '{bad', '[]']) {
    const result = fixture({ [LEGACY]: raw, [V2]: prepared() }).inspect();
    assert.equal(result.reason, 'ambiguous_markers');
    assert.equal(result.v2Marker, 'prepared_shape');
  }
  // Different times are not an atomic coexistence claim, but remain ambiguous.
  const result = classify(sample(present('{}')), sample(ABSENT, present(prepared())));
  assert.equal(result.reason, 'ambiguous_markers');
  assert.equal(result.observation, 'changed_during_observation');
});

test('D06: prepared v2 is observed without invoking recovery or locks', () => {
  const result = fixture({ [V2]: prepared({ 'fixture-updated': 'fixture-old', 'fixture-added': null }), 'fixture-updated': 'fixture-partial' }).inspect();
  assert.equal(result.v2Marker, 'prepared_shape');
  assert.equal(result.reason, 'v2_prepared_observed');
});

test('D07: v2 schema errors and unknown versions fail closed; generation is opaque', () => {
  const malformed = ['', '{bad', 'null', '[]', '4', '{}', '{"version":"2"}',
    JSON.stringify({ version: 2, state: 'committed', generation: '' }),
    JSON.stringify({ version: 2, state: 'unknown', generation: 'fixture' }),
    prepared({}, { transactionId: '' }), prepared(null), prepared([]), prepared({ fixture: 3 }),
  ];
  for (const raw of malformed) {
    const result = fixture({ [V2]: raw, [GENERATION]: 'fixture-not-a-time' }).inspect();
    assert.equal(result.v2Marker, 'unreadable');
    assert.equal(result.reason, 'invalid_metadata');
  }
  for (const version of [0, 1, 3, 999]) {
    const result = fixture({ [V2]: JSON.stringify({ version, state: 'prepared', generation: 'fixture', before: {} }) }).inspect();
    assert.equal(result.v2Marker, 'unsupported_version');
    assert.equal(result.reason, 'invalid_metadata');
  }
  for (const raw of ['', 'null', 'undefined', '{bad', '<script>fixture()</script>', '\u0000\ud800', '9999999999999999999999999']) {
    const result = fixture({ [GENERATION]: raw }).inspect();
    assert.equal(result.reason, 'no_legacy_marker_observed');
    assert.equal(result.observation, 'no_marker_change_observed');
  }
});

test('D08: marker/total caps are checked before parse; entry overflow is incomplete', () => {
  const originalParse = JSON.parse;
  let parseCalls = 0;
  const assertNoParse = (first: StorageMarkerSample, second?: StorageMarkerSample) => {
    let result: StorageMarkerDiagnostic;
    try {
      JSON.parse = (() => { parseCalls++; throw new Error('fixture-parse-forbidden'); }) as typeof JSON.parse;
      result = withoutEffects(() => classifyStorageMarkers({ first, second }));
    } finally { JSON.parse = originalParse; }
    assertClosed(result!);
    assert.equal(parseCalls, 0);
    assert.equal(result!.reason, 'inspection_incomplete');
    assert.equal(result!.observation, 'unavailable');
  };
  for (const index of [0, 1, 2]) {
    const markers: [StorageMarkerRead, StorageMarkerRead, StorageMarkerRead] = [ABSENT, ABSENT, ABSENT];
    markers[index] = present('x'.repeat(MAX_MARKER + 1));
    assertNoParse(sample(...markers));
  }
  // All individually bounded, but the combined budget overflows by one unit.
  assertNoParse(sample(present(' '.repeat(MAX_MARKER)), present(' '.repeat(MAX_MARKER)), present('x')));
  // The total includes both ordered samples, even when their strings are equal.
  const halfPlus = sample(present(' '.repeat(MAX_TOTAL / 2)), ABSENT, present('x'));
  assertNoParse(halfPlus, halfPlus);
  const exact = ' '.repeat(MAX_MARKER - 2) + '{}';
  const edge = classify(sample(present(exact)), sample(present(exact)));
  assert.equal(edge.legacyMarker, 'present_valid_shape');
  assert.equal(edge.reason, 'legacy_preservation_required');
  const entries = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`fixture-${i}`, null]));
  assert.equal(classify(sample(present(JSON.stringify(entries)))).legacyMarker, 'present_valid_shape');
  assert.equal(classify(sample(ABSENT, present(prepared(entries)))).v2Marker, 'prepared_shape');
  for (const before of [{ ...entries, 'fixture-overflow': null }, { 'fixture-invalid': false, ...entries }]) {
    for (const isV2 of [false, true]) {
      const current = isV2 ? sample(ABSENT, present(prepared(before))) : sample(present(JSON.stringify(before)));
      const result = classify(current);
      assert.equal(result.reason, 'inspection_incomplete');
      assert.equal(isV2 ? result.v2Marker : result.legacyMarker, 'inspection_incomplete');
    }
  }
  const boundedReader = fixture({ [LEGACY]: 'x'.repeat(MAX_MARKER + 1) });
  assert.equal(boundedReader.inspect().reason, 'inspection_incomplete');
});

test('D09: unavailable storage/getters/selected reads expose only fixed codes', () => {
  for (const storage of [undefined, null]) {
    const result = withoutEffects(() => readStorageMarkerDiagnostic(storage));
    assertClosed(result);
    assert.equal(result.reason, 'storage_unavailable');
    assert.equal(result.observation, 'unavailable');
  }
  let getterCalls = 0;
  const getterStorage = { get getItem(): StorageMarkerReader['getItem'] { getterCalls++; throw new Error('fixture-secret-owner-in-error'); } };
  const getterResult = withoutEffects(() => readStorageMarkerDiagnostic(getterStorage));
  assertClosed(getterResult);
  assert.equal(getterCalls, 6);
  assert.equal(getterResult.reason, 'storage_unavailable');
  const error = Object.create(null, { message: { get() { throw new Error('fixture-error-message-must-not-be-read'); } } });
  for (let failure = 0; failure < 6; failure++) {
    let calls = 0;
    const result = withoutEffects(() => readStorageMarkerDiagnostic({ getItem() { if (calls++ === failure) throw error; return null; } }));
    assertClosed(result);
    assert.equal(calls, 6);
    assert.equal(result.reason, 'storage_unavailable');
    assert.equal(result.observation, 'unavailable');
  }
  let coerced = false;
  const invalid = { toString() { coerced = true; throw new Error('fixture-no-coercion'); } };
  const result = withoutEffects(() => readStorageMarkerDiagnostic({ getItem: () => invalid } as unknown as StorageMarkerReader));
  assertClosed(result);
  assert.equal(result.reason, 'storage_unavailable');
  assert.equal(coerced, false);
  for (const current of [sample(UNAVAILABLE), sample(ABSENT, UNAVAILABLE), sample(ABSENT, ABSENT, UNAVAILABLE)]) {
    assert.equal(classify(current).reason, 'storage_unavailable');
  }
});

test('D10: changed markers are negative evidence; exactly two samples, no retry', () => {
  for (const key of KEYS) {
    const first = key === LEGACY ? '{}' : key === V2 ? committed('fixture-A') : 'fixture-A';
    const second = key === LEGACY ? '{"fixture":"fixture-B"}' : key === V2 ? committed('fixture-B') : 'fixture-B';
    const local = fixture({ [key]: first }, (_read, index, data) => { if (index === 3) data.set(key, second); });
    assert.equal(local.inspect(false).observation, 'changed_during_observation');
  }
  for (const [first, second] of [[sample(present('{}')), sample()], [sample(), sample(present(''))]]) {
    const result = classify(first, second);
    assert.equal(result.reason, 'legacy_preservation_required');
    assert.equal(result.observation, 'changed_during_observation');
    assert.notEqual(result.legacyMarker, 'absent');
  }
  const partial = classify(sample(UNAVAILABLE, ABSENT, present('fixture-A')), sample(UNAVAILABLE, ABSENT, present('fixture-B')));
  assert.equal(partial.reason, 'storage_unavailable');
  assert.equal(partial.observation, 'changed_during_observation');
});

test('D11: unchanged markers conceal unobserved record mutation and ABA', () => {
  for (const aba of [false, true]) {
    const local = fixture({ [GENERATION]: 'fixture-marker-A', 'fixture-record': 'fixture-record-A' }, (_key, index, data) => {
      if (index !== 3) return;
      data.set('fixture-record', 'fixture-record-B');
      if (aba) {
        data.set(GENERATION, 'fixture-marker-B');
        data.set('fixture-record', 'fixture-record-A');
        data.set(GENERATION, 'fixture-marker-A');
      }
    });
    const result = local.inspect(false);
    assert.equal(result.observation, 'no_marker_change_observed');
    assert.equal(result.reason, 'no_legacy_marker_observed');
    assert.equal(result.quiescence, 'unverified');
    assert.equal(local.data.get('fixture-record'), aba ? 'fixture-record-A' : 'fixture-record-B');
  }
});

test('D12: a live old writer without any v1 marker is not a safe rollout signal', () => {
  const local = fixture({ 'fixture-legacy-record': 'fixture-0' }, (_key, index, data) => data.set('fixture-legacy-record', `fixture-${index}`));
  const result = local.inspect(false);
  assert.equal(local.data.get('fixture-legacy-record'), 'fixture-6');
  assert.equal(result.reason, 'no_legacy_marker_observed');
  assert.equal(result.observation, 'no_marker_change_observed');
  assert.equal(result.quiescence, 'unverified');
});

test('D13: lifecycle hints are not part of the classifier contract or permissions', () => {
  for (const facts of [
    { webLocksAvailable: false }, { webLocksAvailable: true, lockAcquiredElsewhere: true },
    { elapsedMs: Number.MAX_SAFE_INTEGER }, { visibleTabs: 1, clients: [] },
    { offline: true, oldTimestamp: 0, userCheckedAllTabsClosed: true },
  ]) {
    const input = { first: sample(), second: sample(), ...facts };
    const result = withoutEffects(() => classifyStorageMarkers(input));
    assertClosed(result);
    assert.equal(result.reason, 'storage_unavailable');
  }
  let externalReads = 0;
  const input = Object.defineProperty({ first: sample(), second: sample() }, 'environment', {
    get() { externalReads++; throw new Error('fixture-no-environment-proof'); },
  });
  assert.equal(withoutEffects(() => classifyStorageMarkers(input)).reason, 'storage_unavailable');
  assert.equal(externalReads, 0);
});

test('D14: malicious/private before-images never escape, execute, decode, or dereference', () => {
  const before = {
    'fixture-private-owner-record': 'fixture-owner-A',
    'fixture-auth-token-reference': 'fixture-token-SYNTHETIC-NOT-A-CREDENTIAL',
    'fixture-html': '<script>globalThis.fixtureExecuted=true</script>',
    'fixture-nested-json': '{"fixture-private":"fixture-inner"}',
    'fixture-malformed-nested-json': '{not-json',
    'fixture-url': 'https://fixture.invalid/private?owner=fixture-A',
    'fitness-cloud-sync-user': 'fixture-owner-B',
  };
  for (const isV2 of [false, true]) {
    const raw = isV2 ? prepared(before) : JSON.stringify(before);
    const result = fixture({ [isV2 ? V2 : LEGACY]: raw }).inspect();
    assert.equal(result.reason, isV2 ? 'v2_prepared_observed' : 'legacy_preservation_required');
    assert.equal(JSON.stringify(result).includes('fixture'), false);
  }
  // The only JSON parse is of the outer journal, never its string values.
  const originalParse = JSON.parse;
  const parsedInputs: string[] = [];
  const raw = JSON.stringify(before);
  try {
    JSON.parse = ((value: string) => { parsedInputs.push(value); return originalParse(value); }) as typeof JSON.parse;
    assert.equal(withoutEffects(() => classifyStorageMarkers({ first: sample(present(raw)) })).legacyMarker, 'present_valid_shape');
  } finally { JSON.parse = originalParse; }
  assert.deepEqual(parsedInputs, [raw]);
  for (const key of ['__proto__', 'constructor', 'prototype', ...KEYS, 'fitness-cloud-sync-epoch']) {
    const unsafe = JSON.parse(`{${JSON.stringify(key)}:"fixture-secret"}`);
    for (const isV2 of [false, true]) {
      const result = fixture({ [isV2 ? V2 : LEGACY]: isV2 ? prepared(unsafe) : JSON.stringify(unsafe) }).inspect();
      assert.equal(isV2 ? result.v2Marker : result.legacyMarker, isV2 ? 'unreadable' : 'present_unreadable');
      assert.equal(result.reason, isV2 ? 'invalid_metadata' : 'legacy_preservation_required');
    }
  }
  assert.equal(Object.hasOwn(globalThis, 'fixtureExecuted'), false);
  assert.equal(Object.hasOwn(Object.prototype, 'fixture-secret'), false);
});

test('D15: owner A to B to A is unobserved and creates no durable authority', () => {
  const local = fixture({ 'fitness-cloud-sync-user': 'fixture-owner-A', 'fitness-cloud-sync-epoch': 'fixture-epoch-A' }, (_key, index, data) => {
    if (index !== 3) return;
    data.set('fitness-cloud-sync-user', 'fixture-owner-B');
    data.set('fitness-cloud-sync-epoch', 'fixture-epoch-B');
    data.set('fitness-cloud-sync-user', 'fixture-owner-A');
    data.set('fitness-cloud-sync-epoch', 'fixture-epoch-A2');
  });
  const result = local.inspect(false);
  assert.equal(result.observation, 'no_marker_change_observed');
  assert.equal(result.quiescence, 'unverified');
  assert.equal(JSON.stringify(result).includes('fixture'), false);
  assert.deepEqual(Object.keys(result).sort(), Object.keys(allowed).sort());
});

test('D16: adapter reads only fixed keys, never length/key/arbitrary getters', () => {
  const local = fixture({ [LEGACY]: '{"fixture-do-not-dereference":"fixture-secret"}', 'fixture-do-not-dereference': 'fixture-current' });
  let forbiddenReads = 0;
  for (const key of ['length', 'key', 'fixture-do-not-dereference', 'owner', 'auth', 'locks']) {
    Object.defineProperty(local.storage, key, { get() { forbiddenReads++; throw new Error('fixture-getter-forbidden'); } });
  }
  const result = local.inspect();
  assert.equal(result.reason, 'legacy_preservation_required');
  assert.equal(forbiddenReads, 0);
  assert.deepEqual(local.reads, ORDER);
});

test('closed API and inert module: no imports or raw evidence/permission export', () => {
  assert.deepEqual(Object.keys(diagnosticModule).sort(), ['classifyStorageMarkers', 'readStorageMarkerDiagnostic']);
  const source = readFileSync(new URL('./storageMarkerDiagnostic.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m);
});

test('failure priorities remain conservative across both samples', () => {
  const cases: [StorageMarkerSample, StorageMarkerSample, StorageMarkerDiagnostic['reason']][] = [
    [sample(present(''), present(prepared())), sample(UNAVAILABLE), 'storage_unavailable'],
    [sample(present('x'.repeat(MAX_MARKER + 1))), sample(ABSENT, present(prepared())), 'inspection_incomplete'],
    [sample(present('')), sample(ABSENT, present('{bad')), 'legacy_preservation_required'],
    [sample(ABSENT, present('{bad')), sample(ABSENT, present(committed())), 'invalid_metadata'],
    [sample(ABSENT, present(prepared())), sample(ABSENT, present(committed())), 'v2_prepared_observed'],
    [sample(ABSENT, present(JSON.stringify({ version: 3 }))), sample(ABSENT, present(prepared())), 'invalid_metadata'],
  ];
  for (const [first, second, reason] of cases) {
    assert.equal(classify(first, second).reason, reason);
    assert.equal(classify(second, first).reason, reason);
  }
});

test('untrusted observation wrappers cannot bypass caps or leak accessor errors', () => {
  let accessorCalls = 0;
  const rawGetter = {
    kind: 'present' as const,
    get raw() { accessorCalls++; return accessorCalls < 5 ? '{}' : ' '.repeat(MAX_MARKER + 1) + '{}'; },
  };
  const firstGetter = {
    get first(): StorageMarkerSample { accessorCalls++; throw new Error('fixture-private-getter-error'); },
  };
  const sampleGetter = {
    get legacy(): StorageMarkerRead { accessorCalls++; throw new Error('fixture-private-marker-error'); },
    v2: ABSENT, generation: ABSENT,
  };
  const originalParse = JSON.parse;
  let parseCalls = 0;
  try {
    JSON.parse = (() => { parseCalls++; throw new Error('fixture-no-parse-for-unavailable-input'); }) as typeof JSON.parse;
    for (const input of [{ first: sample(rawGetter) }, firstGetter, { first: sampleGetter }]) {
      const result = withoutEffects(() => classifyStorageMarkers(input));
      assertClosed(result);
      assert.equal(result.reason, 'storage_unavailable');
    }
  } finally { JSON.parse = originalParse; }
  assert.equal(accessorCalls, 0);
  assert.equal(parseCalls, 0);

  const invalid: unknown[] = [
    undefined, null, false, 'fixture-string', [], {}, { second: sample() },
    { first: null }, { first: {} }, { first: { legacy: ABSENT, v2: ABSENT } },
    { first: sample(), extra: 'fixture-private' },
    { first: { ...sample(), extra: 'fixture-private' } },
    { first: sample({ kind: 'mystery', raw: '{}' } as unknown as StorageMarkerRead) },
    { first: sample({ kind: 'present' } as StorageMarkerRead) },
    { first: sample({ kind: 'absent', raw: 'fixture-private' } as unknown as StorageMarkerRead) },
    { first: sample({ kind: 'present', raw: '{}', extra: 'fixture-private' } as StorageMarkerRead) },
    { first: sample(Object.create({ kind: 'present', raw: '{}' })) },
    Object.create({ first: sample() }),
    { first: sample(), [Symbol('fixture-private')]: 'fixture-secret' },
  ];
  for (const input of invalid) {
    const result = withoutEffects(() => classifyStorageMarkers(input as Parameters<typeof classifyStorageMarkers>[0]));
    assertClosed(result);
    assert.equal(result.reason, 'storage_unavailable');
    assert.equal(JSON.stringify(result).includes('fixture'), false);
  }
});

test('proxy descriptor traps are caught; primitive raw input is captured only once', () => {
  const secret = Object.create(null, { message: { get() { throw new Error('fixture-do-not-inspect-error'); } } });
  for (const trap of ['ownKeys', 'getOwnPropertyDescriptor'] as const) {
    const poisoned = new Proxy({}, { [trap]() { throw secret; } });
    for (const input of [poisoned, { first: poisoned }, { first: sample(poisoned as StorageMarkerRead) }]) {
      const result = withoutEffects(() => classifyStorageMarkers(input as Parameters<typeof classifyStorageMarkers>[0]));
      assertClosed(result);
      assert.equal(result.reason, 'storage_unavailable');
    }
  }
  const { proxy, revoke } = Proxy.revocable({ kind: 'present', raw: '{}' }, {});
  revoke();
  assert.equal(withoutEffects(() => classifyStorageMarkers({ first: sample(proxy as StorageMarkerRead) })).reason, 'storage_unavailable');

  let rawDescriptors = 0;
  let propertyReads = 0;
  const marker = new Proxy({ kind: 'present' as const, raw: '{}' }, {
    get() { propertyReads++; throw new Error('fixture-no-direct-property-read'); },
    getOwnPropertyDescriptor(target, key) {
      if (key === 'raw') {
        rawDescriptors++;
        return { configurable: true, enumerable: true, writable: true, value: rawDescriptors === 1 ? '{}' : 'x'.repeat(MAX_MARKER + 1) };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = withoutEffects(() => classifyStorageMarkers({ first: sample(marker) }));
  assertClosed(result);
  assert.equal(result.reason, 'legacy_preservation_required');
  assert.equal(rawDescriptors, 1);
  assert.equal(propertyReads, 0);
});
