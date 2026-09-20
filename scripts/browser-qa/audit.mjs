// Audit synthetic HTTP evidence after the browser scenarios in README.md.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const e = JSON.parse(readFileSync(process.argv[2] || new URL('.generated/evidence.json', import.meta.url)));
const workouts = 'ai-fitness-workout-completed-days';
const patches = e.requests.filter(r => r.request.method === 'PATCH');
assert.ok(patches.length > 0, 'Browser writes must exist');
for (const r of patches) {
  const state = r.request.payload.state;
  for (const [date, original] of Object.entries(e.fixture[workouts])) {
    assert.deepEqual(state[workouts][date], original, `original ${date}, request ${r.id}`);
  }
  for (const key of Object.keys(e.fixture).filter(k => k !== workouts)) {
    assert.deepEqual(state[key], e.fixture[key], `setting/backup ${key}, request ${r.id}`);
  }
  for (const record of Object.values(state[workouts])) {
    const names = (record.workoutExerciseRecords || []).map(x => x.exerciseName);
    assert.equal(new Set(names).size, names.length, `No duplicate exercises, request ${r.id}`);
    for (const exercise of record.workoutExerciseRecords || []) {
      assert.equal(exercise.sets.length, 1, `One synthetic set, request ${r.id}`);
      assert.equal(exercise.sets[0].reps, exercise.exerciseName === 'QA189 스쿼트' ? 9 : 8);
    }
  }
}
const delayed = patches.find(r => r.fault === 'pause-patch');
assert.ok(delayed?.delivery === 200);
const last = patches.find(r => r.id > delayed.id && r.request.payload.state[workouts]['2026-09-07']?.workoutMemo === 'QA189-delayed-LAST');
assert.ok(last?.response.data, 'Last edit reached server');
const lost = patches.find(r => r.fault === 'lose-patch');
assert.equal(lost?.delivery, 'socket destroyed after commit');
const recovered = e.requests.find(r => r.id > lost.id && r.request.method === 'GET' && r.response.data?.state[workouts]['2026-09-07']?.workoutMemo === 'QA189-B-response-lost');
assert.ok(recovered, 'Read after lost response sees committed record');
const failedGet = e.requests.find(r => r.fault === 'fail-get');
assert.equal(failedGet?.delivery, 503);
assert.ok(e.requests.some(r => r.id > failedGet.id && r.origin === failedGet.origin && r.request.method === 'GET' && r.response.data));
const stale = e.requests.find(r => r.fault === 'pause-get');
assert.ok(stale);
const conflict = patches.find(r => r.id > stale.id && r.origin === stale.origin && r.response.data === null);
assert.ok(conflict, 'Conditional write conflict occurred');
const merged = patches.find(r => r.id > conflict.id && r.origin === stale.origin && r.response.data && r.request.payload.state[workouts]['2026-09-06'] && r.request.payload.state[workouts]['2026-09-07']?.workoutMemo === 'QA189-A-concurrent');
assert.ok(merged, 'Both independent changes preserved');
const finalWrite = patches.filter(r => r.response.data).at(-1);
assert.deepEqual(finalWrite.request.payload.state, e.fixture, 'UI cleanup restores all fixture originals');
assert.ok(Object.keys(e.row.state).length === 0 || JSON.stringify(e.row.state[workouts]) === JSON.stringify(e.fixture[workouts]), 'Only fixture originals or empty server may remain');
console.log(JSON.stringify({ passed: true, requests: e.requests.length, patchRequests: patches.map(r => r.id), delayed: delayed.id, finalEdit: last.id, lostResponse: lost.id, recoveredGet: recovered.id, failedGet: failedGet.id, staleGet: stale.id, conflict: conflict.id, merged: merged.id, lastCleanupWrite: finalWrite.id, serverEmpty: Object.keys(e.row.state).length === 0 }, null, 2));
