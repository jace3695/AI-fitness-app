import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSyncResponse, stableState } from './cloudSync.ts';

test('a write response preserves later local input and independent remote changes', () => {
  const atRequest={records:{today:{memo:'before',reps:8},yesterday:{memo:'old'}}};
  const saved={records:{today:{memo:'before',reps:8},yesterday:{memo:'remote-edit'}}};
  const latest={records:{today:{memo:'typed-during-request',reps:9},yesterday:{memo:'old'}}};
  const applied=reconcileSyncResponse(atRequest,saved,latest);
  assert.deepEqual(applied,{records:{today:{memo:'typed-during-request',reps:9},yesterday:{memo:'remote-edit'}}});
  assert.notEqual(stableState(applied),stableState(saved),'new edits remain pending for the next sync');
});
test('deleting during a pending write does not resurrect an unchanged record', () => {
  const before={records:{today:{memo:'delete me'}}};
  assert.deepEqual(reconcileSyncResponse(before,before,{records:{}}),{records:{}});
});
