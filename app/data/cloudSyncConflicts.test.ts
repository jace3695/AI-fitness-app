import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCloudSyncConflicts as classify, createCloudSyncConflictReview as review, resolveCloudSyncConflictReview as resolve,
  CloudSyncConflictValidationError, CloudSyncConflictStaleError, CLOUD_SYNC_CONFLICT_LIMITS, CLOUD_SYNC_LEGACY_OBJECT_KEYS, CLOUD_SYNC_LEGACY_FASTING_KEY, CloudSyncLegacyEncodingError, normalizeCloudSyncState, reconcileCloudSyncResolution } from './cloudSyncConflicts.ts';
import type { CloudState, CloudSyncRequest } from './cloudSync.ts';
import { parseFastingStart } from '../../lib/diet-time.ts';
import { resetMarkerKey } from './appRecordReset.ts';

function request(base: CloudState | null = { records: { memo: 'base' } }, local: CloudState = { records: { memo: 'local' } }): CloudSyncRequest {
  return { userId: 'synthetic-owner', epoch: 'synthetic-session', acknowledgementToken: 'ack-1', storageGeneration: 'generation-1', base, local };
}
const remote = { state: { records: { memo: 'remote' } }, updated_at: '2026-10-09T12:00:00.000Z' };
const choose = [{ path: ['records', 'memo'], side: 'remote' as const }];

test('same-field concurrent edits have no merged winner and retain all original evidence', () => {
  const captured = request(); const originals = structuredClone(captured);
  const result = classify(captured.base, remote.state, captured.local);
  assert.equal(result.merged, null);
  assert.deepEqual(result.conflicts, [{ path: ['records', 'memo'], kind: 'value', base: { present: true, value: 'base' }, local: { present: true, value: 'local' }, remote: { present: true, value: 'remote' } }]);
  assert.deepEqual(captured, originals);
  assert.equal(Object.isFrozen(result.conflicts[0].local), true);
});
test('independent fields and new dates merge; key ordering is not a conflict', () => {
  assert.deepEqual(classify({ records: { today: { memo: 'old', water: 1 } } },
    { records: { today: { water: 2, memo: 'old' }, yesterday: { complete: true } } },
    { records: { today: { water: 1, memo: 'new' }, tomorrow: { complete: false } } }).merged,
  { records: { today: { memo: 'new', water: 2 }, tomorrow: { complete: false }, yesterday: { complete: true } } });
  assert.deepEqual(classify({}, { records: { a: 1, b: 2 } }, { records: { b: 2, a: 1 } }).conflicts, []);
});
test('unchanged, identical edit, single edit and single deletion are unambiguous', () => {
  for (const [base, server, local, expected] of [[{ x: 1 }, { x: 1 }, { x: 1 }, { x: 1 }], [{ x: 1 }, { x: 2 }, { x: 2 }, { x: 2 }], [{ x: 1 }, { x: 2 }, { x: 1 }, { x: 2 }], [{ x: 1 }, {}, { x: 1 }, {}], [{ x: 1 }, { x: 1 }, {}, {}]]) {
    const result = classify(base, server, local); assert.deepEqual(result.merged, expected); assert.equal(result.conflicts.length, 0);
  }
});
test('null, absence, and deletion/edit remain distinct, including selected deletion', () => {
  const captured = request({ records: { memo: 'base' } }, { records: {} });
  const server = { ...remote, state: { records: { memo: null } } };
  const held = review(captured, server);
  assert.equal(held.conflicts[0].kind, 'delete-edit');
  assert.deepEqual(held.conflicts[0].local, { present: false });
  assert.deepEqual(held.conflicts[0].remote, { present: true, value: null });
  assert.deepEqual(resolve(held, [{ path: ['records', 'memo'], side: 'local' }], captured, server), { records: {} });
  assert.deepEqual(resolve(held, choose, captured, server), { records: { memo: null } });
  assert.equal(classify({}, { records: { memo: null } }, { records: {} }).conflicts.length, 0);
});
test('deleting a parent while the peer edits a child is one atomic conflict', () => {
  const result = classify({ records: { today: { a: 1 } } }, { records: { today: { a: 2 } } }, { records: {} });
  assert.equal(result.merged, null); assert.deepEqual(result.conflicts[0].path, ['records', 'today']); assert.equal(result.conflicts[0].kind, 'delete-edit');
});
test('concurrent array edits preserve duplicate/order evidence instead of unioning entries', () => {
  const captured = request({ records: ['a', 'b'] }, { records: ['b', 'a', 'a'] });
  const server = { ...remote, state: { records: ['a', 'c'] } };
  const held = review(captured, server); assert.equal(held.conflicts[0].kind, 'array'); assert.deepEqual(held.conflicts[0].path, ['records']);
  assert.deepEqual(resolve(held, [{ path: ['records'], side: 'local' }], captured, server), captured.local);
  assert.deepEqual(resolve(held, [{ path: ['records'], side: 'remote' }], captured, server), server.state);
});
test('type replacements never recurse into a value of a different structural type', () => {
  for (const [base, server, local] of [[{ a: 1 }, { a: 2 }, 'replacement'], [1, { a: 1 }, { b: 2 }], [[1], { a: 1 }, [2]], [null, { a: 1 }, { b: 2 }]]) {
    const result = classify({ records: base }, { records: server }, { records: local });
    assert.equal(result.merged, null); assert.equal(result.conflicts.length, 1); assert.equal(result.conflicts[0].kind, 'type'); assert.deepEqual(result.conflicts[0].path, ['records']);
  }
});
test('missing first-sync baseline preserves disjoint content but does not silently choose overlaps', () => {
  assert.deepEqual(classify(null, { server: 1 }, { local: 2 }).merged, { local: 2, server: 1 });
  const captured = request(null); const held = review(captured, remote); assert.equal(held.conflicts.length, 1); assert.equal(held.conflicts[0].base.present, false);
  assert.deepEqual(resolve(held, choose, captured, remote), remote.state);
});
test('review snapshots are deep independent frozen originals; resolution returns a separate tree', () => {
  const captured = request(); const server = structuredClone(remote); const held = review(captured, server);
  (captured.local.records as Record<string, unknown>).memo = 'edited'; server.state.records.memo = 'new server';
  assert.deepEqual(held.request.local, { records: { memo: 'local' } }); assert.deepEqual(held.remote, remote);
  assert.throws(() => { (held.request.local.records as Record<string, unknown>).memo = 'mutate'; }, TypeError);
  const resolved = resolve(held, choose, held.request, held.remote); (resolved.records as Record<string, unknown>).memo = 'result edit'; assert.equal((held.remote.state.records as { memo: string }).memo, 'remote');
});
test('exact owner/session/base/local/ack/generation and remote revision/content are required', () => {
  const captured = request(); const held = review(captured, remote);
  const variants: CloudSyncRequest[] = [ { ...captured, userId: 'other' }, { ...captured, epoch: 'new session' }, { ...captured, base: null },
    { ...captured, base: { records: { memo: 'new base' } } }, { ...captured, local: { records: { memo: 'new local' } } },
    { ...captured, acknowledgementToken: 'ack-2' }, { ...captured, storageGeneration: 'generation-3' } ];
  for (const changed of variants) assert.throws(() => resolve(held, choose, changed, remote), CloudSyncConflictStaleError);
  assert.throws(() => resolve(held, choose, captured, { ...remote, updated_at: 'new revision' }), CloudSyncConflictStaleError);
  assert.throws(() => resolve(held, choose, captured, { ...remote, state: { records: { memo: 'changed with same timestamp' } } }), CloudSyncConflictStaleError);
});
test('all conflict paths need exactly one explicit known choice', () => {
  const captured = request({ records: { a: 1, b: 1 } }, { records: { a: 2, b: 2 } });
  const server = { ...remote, state: { records: { a: 3, b: 3 } } }; const held = review(captured, server);
  const a = { path: ['records', 'a'], side: 'remote' as const }; const b = { path: ['records', 'b'], side: 'local' as const };
  for (const invalid of [[], [a], [a, a], [a, b, b], [a, { ...b, path: ['records', 'unknown'] }], [a, { ...b, path: ['records', '__proto__'] }], [a, { ...b, path: [] }]]) assert.throws(() => resolve(held, invalid, captured, server), CloudSyncConflictValidationError);
  assert.deepEqual(resolve(held, [b, a], captured, server), { records: { a: 3, b: 2 } });
  assert.throws(() => resolve({ ...held, conflicts: [] }, [a, b], captured, server), CloudSyncConflictValidationError);
});
test('keys containing slash, dots, and tildes remain unambiguous array paths', () => {
  const captured = request({ records: { 'a/b': 1, a: { b: 1 } } }, { records: { 'a/b': 2, a: { b: 2 } } });
  const server = { ...remote, state: { records: { 'a/b': 3, a: { b: 3 } } } };
  assert.deepEqual(resolve(review(captured, server), [{ path: ['records', 'a/b'], side: 'local' }, { path: ['records', 'a', 'b'], side: 'remote' }], captured, server), { records: { 'a/b': 2, a: { b: 3 } } });
});
test('prototype keys, non-JSON values, cycles, accessors, sparse arrays, and excessive bounds fail closed', () => {
  const cycle: CloudState = {}; cycle.self = cycle;
  const getter: CloudState = {}; Object.defineProperty(getter, 'bad', { enumerable: true, get: () => { throw new Error('must not execute'); } });
  let deep: CloudState = {}; for (let i = 0; i < CLOUD_SYNC_CONFLICT_LIMITS.depth + 2; i++) deep = { nested: deep };
  const invalid: unknown[] = [JSON.parse('{"__proto__":{"polluted":true}}'), { nested: JSON.parse('{"constructor":1}') }, { nested: JSON.parse('{"prototype":1}') }, { x: undefined }, { x: NaN }, { x: Infinity }, { x: BigInt(1) }, { x: () => true }, { x: new Date() }, { x: new Map() }, { x: Symbol('x') }, { x: [,,] }, cycle, getter, deep, { x: 'x'.repeat(CLOUD_SYNC_CONFLICT_LIMITS.characters + 1) }];
  for (const value of invalid) assert.throws(() => classify({}, value as CloudState, {}), CloudSyncConflictValidationError);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  const many = Object.fromEntries(Array.from({ length: CLOUD_SYNC_CONFLICT_LIMITS.conflicts + 1 }, (_, index) => [String(index), index]));
  assert.throws(() => classify({}, Object.fromEntries(Object.keys(many).map(key => [key, 'remote'])), many), CloudSyncConflictValidationError);
});
test('newer reset generations override only owned records and report policy keys separately', () => {
  const marker = resetMarkerKey('fitness'); const record = 'ai-fitness-daily-notes';
  const base = { [record]: { today: 'base' }, setting: 1 };
  const server = { [marker]: '2026-10-09T12:00:00Z|reset', setting: 1 };
  const local = { [record]: { today: 'older device edit' }, setting: 2 };
  const result = classify(base, server, local);
  assert.deepEqual(result.merged, { [marker]: server[marker], setting: 2 }); assert.equal(result.conflicts.length, 0); assert.ok(result.resetKeys.includes(record));
});
test('equal-time reset marker IDs preserve established remote precedence and never resurrect old records', () => {
  const marker = resetMarkerKey('fitness'); const record = 'ai-fitness-daily-notes';
  const local = { [marker]: '2026-10-09T12:00:00Z|local', [record]: { today: 'local generation' } };
  const server = { [marker]: '2026-10-09T12:00:00Z|remote' };
  assert.deepEqual(classify({}, server, local).merged, server);
  assert.deepEqual(reconcileCloudSyncResolution({}, server, local), server);
});
test('explicit dispatch acknowledgement preserves causally newer local same-field/deletion/array actions', () => {
  const before = { records: { memo: 'local', list: ['a'], gone: { value: 1 }, independent: 1 } };
  const sent = { records: { memo: 'chosen remote', list: ['remote'], gone: { value: 2 }, independent: 2 } };
  const latest = { records: { memo: 'typed after dispatch', list: ['new', 'new'], independent: 1 } };
  assert.deepEqual(reconcileCloudSyncResolution(before, sent, latest), { records: { memo: 'typed after dispatch', list: ['new', 'new'], independent: 2 } });
});
test('postdispatch deletion of the whole state and explicit null do not resurrect a selected value', () => {
  assert.deepEqual(reconcileCloudSyncResolution({ record: { a: 1 } }, { record: { a: 2 } }, {}), {});
  assert.deepEqual(reconcileCloudSyncResolution({ record: { a: 1 } }, { record: { a: 2 } }, { record: null }), { record: null });
});


test('postdispatch independent additions to a new object preserve the acknowledged peer fields', () => {
  assert.deepEqual(reconcileCloudSyncResolution({}, { record: { remote: 1 } }, { record: { local: 2 } }), { record: { remote: 1, local: 2 } });
});


test('only the ten server-supported maps decode one legacy layer without dropping unknown fields', () => {
  const records={'2030-01-01':{memo:'synthetic',unknown:{array:[null,2,2,{unicode:'한국어'}],flag:false}},extra:null};
  for(const key of CLOUD_SYNC_LEGACY_OBJECT_KEYS) {
    const wire={[key]:JSON.stringify(records)}; const semantic={[key]:records};
    const result=classify(wire,semantic,wire); assert.deepEqual(result.merged,semantic); assert.equal(result.conflicts.length,0);
    assert.deepEqual(wire,{[key]:JSON.stringify(records)}); assert.deepEqual(normalizeCloudSyncState(wire),semantic);
  }
  const generic={'ai-fitness-unknown':JSON.stringify(records),'ai-fitness-user-preference':'[1,2]'};
  assert.deepEqual(normalizeCloudSyncState(generic),generic);
});
test('legacy semantic equality avoids false conflicts despite wrapper/object and property-order differences', () => {
  const key='ai-fitness-workout-completed-days'; const a={today:{memo:'same',sets:[{reps:8,weight:3}]}};
  const b={today:{sets:[{weight:3,reps:8}],memo:'same'}};
  const result=classify({[key]:JSON.stringify(a)},{[key]:JSON.stringify(b)},{[key]:a});
  assert.equal(result.conflicts.length,0); assert.deepEqual(result.merged,{[key]:a});
});
test('legacy map conflicts use semantic field paths while review and revision evidence retain exact wire originals', () => {
  const key='ai-fitness-workout-completed-days';
  const base={[key]:JSON.stringify({today:{workoutMemo:'base',unknown:[1,1,null]}})};
  const local={[key]:{today:{workoutMemo:'local',unknown:[1,1,null]}}};
  const server={...remote,state:{[key]:'{ "today": { "workoutMemo": "remote", "unknown": [1,1,null] } }'}};
  const captured=request(base,local); const held=review(captured,server);
  assert.deepEqual(held.conflicts[0].path,[key,'today','workoutMemo']); assert.deepEqual(held.remote,server); assert.deepEqual(held.request.base,base);
  assert.deepEqual(resolve(held,[{path:[key,'today','workoutMemo'],side:'remote'}],captured,server),{[key]:{today:{workoutMemo:'remote',unknown:[1,1,null]}}});
  assert.throws(()=>resolve(held,[{path:[key,'today','workoutMemo'],side:'remote'}],captured,{...server,state:{[key]:JSON.stringify(JSON.parse(server.state[key]))}}),CloudSyncConflictStaleError,'Representation is part of exact CAS evidence');
});
test('known malformed, repeated-wrapper, array, null and scalar formats fail without defaulting to empty', () => {
  for(const key of CLOUD_SYNC_LEGACY_OBJECT_KEYS) {
    for(const invalid of ['{broken','[]','null','1','true','"plain"',JSON.stringify('{}'),null,[],12]) {
      const wire={[key]:invalid}; const before=structuredClone(wire);
      assert.throws(()=>classify({},wire,{}),CloudSyncLegacyEncodingError); assert.deepEqual(wire,before);
    }
    for(const unsafe of ['{"__proto__":{"x":1}}','{"today":{"constructor":1}}']) assert.throws(()=>normalizeCloudSyncState({[key]:unsafe}),CloudSyncConflictValidationError);
  }
});
test('newer reset removes wrapped old-generation records without disturbing generic strings', () => {
  const key='ai-fitness-workout-completed-days';const marker=resetMarkerKey('fitness');const generic='{"literal":true}';
  const base={[key]:JSON.stringify({today:{memo:'old'}}),'ai-fitness-generic':generic};
  const local={[key]:JSON.stringify({today:{memo:'edited old'}}),'ai-fitness-generic':generic};
  const server={[marker]:'2026-10-09T12:00:00Z|reset','ai-fitness-generic':generic};
  assert.deepEqual(classify(base,server,local).merged,server);
});
test('postdispatch legacy/object representation differences do not create phantom local changes', () => {
  const key='ai-fitness-diet-completed-days';
  const before={[key]:JSON.stringify({today:{dietMemo:'local',unknown:1}})};
  const sent={[key]:{today:{dietMemo:'chosen remote',unknown:1,remoteOnly:2}}};
  assert.deepEqual(reconcileCloudSyncResolution(before,sent,{[key]:{today:{dietMemo:'local',unknown:1}}}),sent);
  assert.deepEqual(reconcileCloudSyncResolution(before,sent,{[key]:{today:{dietMemo:'new local',unknown:1}}}),{[key]:{today:{dietMemo:'new local',unknown:1,remoteOnly:2}}});
});


test('the explicit fasting-time key matches its existing reader for one-layer clock and date-map formats', () => {
  const key=CLOUD_SYNC_LEGACY_FASTING_KEY;const map={'2030-01-01':'19:40',unknown:{preserved:[1,null]}};
  for(const wire of ['', '19:40', '""', '"19:40"', map, JSON.stringify(map)]) {
    const expected=parseFastingStart(wire); const state={[key]:wire};
    assert.deepEqual(normalizeCloudSyncState(state),{[key]:expected});
    assert.deepEqual(classify({[key]:expected},state,{[key]:expected}).merged,{[key]:expected});assert.deepEqual(state,{[key]:wire});
  }
  assert.deepEqual(normalizeCloudSyncState({}),{});
  for(const invalid of [null,[],12,'null','[]','12','24:00','{broken',JSON.stringify(JSON.stringify(map)),JSON.stringify('"19:40"')]) assert.throws(()=>normalizeCloudSyncState({[key]:invalid}),CloudSyncLegacyEncodingError);
  assert.deepEqual(normalizeCloudSyncState({'ai-fitness-other':'"19:40"'}),{'ai-fitness-other':'"19:40"'});
});
