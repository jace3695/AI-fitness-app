import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/components/RecordCalendarView.tsx', import.meta.url), 'utf8');
function fixture() {
  const initial = { today: { workoutMemo: 'old', cardioDone: true, cardioMinutes: 10 }, other: { workoutMemo: 'keep' } };
  const state = { fail: true, writes: 0, published: 0, editing: true, secondary: 'cardio' as string | null, notice: '', invalid: false, data: structuredClone(initial) as any };
  const recordsLive = { current: true }, workoutWriteLocked = { current: false };
  const events = new Map<string, (e?: any) => void>(); const tasks: (() => void)[] = []; let cleanup: () => void = () => {};
  const context = {
    recordsLive, workoutWriteLocked, queueMicrotask: (fn: () => void) => tasks.push(fn),
    useEffect: (fn: () => () => void) => { cleanup = fn(); },
    setSessionInvalid: (v: boolean) => { state.invalid = v; },
    window: { confirm: () => true, addEventListener: (k: string, fn: () => void) => events.set(k, fn), removeEventListener: (k: string) => events.delete(k) },
    selected: 'today', todayKey: 'today', stores: {}, WORKOUT_COMPLETED_DAYS_KEY: 'synthetic', selectedWorkoutRecord: initial.today,
    workoutStatusDraft: 'partial', workoutDifficultyDraft: 'normal', workoutFatigueDraft: 2,
    workoutPainDraft: true, workoutBackStatusDraft: 'pain', workoutNeurologicalDraft: [], workoutPainExerciseDraft: ' synthetic ', workoutPainSetDraft: 1,
    workoutMemoDraft: 'edited', exerciseRecordsDraft: [{ exerciseName: 'synthetic', status: 'partial' }],
    cardioTypeDraft: 'walk', cardioMinutesDraft: 15, cardioMemoDraft: 'cardio', pullupStageDraft: 2, pullupPainDraft: true, pullupMemoDraft: 'pullup',
    foamTimingDraft: 'before', foamAreasDraft: ['synthetic'], foamPainDraft: true, foamMemoDraft: 'foam',
    readJson: () => structuredClone(state.data),
    writeJson: (_key: string, v: any) => { state.writes++; if (state.fail) throw Error('synthetic quota'); state.data = v; },
    setStores: () => { state.published++; }, setWorkoutNotice: (v: string) => { state.notice = v; },
    setEditingWorkout: (v: boolean) => { state.editing = v; }, setEditingSecondary: (v: string | null) => { state.secondary = v; },
    setConfirmingWorkoutDelete: () => {}, removeGeneralWorkoutRecord: () => ({}), removeCardioRecord: () => ({}), removePullupRecord: () => ({}), removeFoamRollerRecord: () => ({}),
  };
  const start = source.indexOf('  const writeWorkoutStore ='), end = source.indexOf('\n  return (', start);
  const effectStart = source.indexOf('  useEffect(() => {\n    recordsLive.current = true;');
  const effectEnd = source.indexOf('  }, []);', effectStart) + '  }, []);'.length;
  const code = ts.transpileModule(source.slice(effectStart, effectEnd) + source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const handlers = vm.runInNewContext(code + '\n({saveWorkoutEdit,saveNewWorkoutRecord,saveSecondaryEdit,deleteWorkoutRecord,deleteSecondaryRecord})', context);
  return { state, ...handlers, tick: () => { while (tasks.length) tasks.shift()!(); }, invalidate: (name = 'yeoni-cloud-session-changed', event?: any) => events.get(name)?.(event), unmount: () => cleanup() };
}
for (const name of ['saveWorkoutEdit', 'saveNewWorkoutRecord'] as const) test(`${name}: failure keeps draft open; retry preserves other date and cardio`, () => {
  const f = fixture(); const before = JSON.stringify(f.state.data);
  assert.doesNotThrow(() => f[name]()); assert.equal(JSON.stringify(f.state.data), before);
  assert.equal(f.state.editing, true); assert.equal(f.state.published, 0); assert.match(f.state.notice, /못했/);
  f.tick(); f.state.fail = false; f[name](); assert.equal(f.state.editing, false);
  assert.equal(f.state.data.today.cardioMinutes, 10); assert.equal(f.state.data.other.workoutMemo, 'keep');
  assert.equal(f.state.data.today.workoutPain, true); assert.equal(f.state.data.today.workoutMemo, 'edited');
});
for (const kind of ['cardio', 'pullup', 'foam']) test(`${kind}: failed edit does not close editor or report success`, () => {
  const f = fixture(); f.state.secondary = kind; f.saveSecondaryEdit(kind);
  assert.equal(f.state.secondary, kind); assert.match(f.state.notice, /못했/); assert.equal(f.state.published, 0);
  f.tick(); f.state.fail = false; f.saveSecondaryEdit(kind); assert.equal(f.state.secondary, null);
  assert.equal(f.state.data.today.workoutMemo, 'old');
});
test('duplicate clicks and later identical save do not duplicate storage writes', () => {
  const f = fixture(); f.state.fail = false; f.saveWorkoutEdit(); f.saveWorkoutEdit();
  assert.equal(f.state.writes, 1); f.tick(); f.saveWorkoutEdit(); assert.equal(f.state.writes, 1);
});
for (const boundary of ['yeoni-cloud-session-changed', 'pagehide', 'storage', 'unmount']) test(`${boundary}: queued stale handler cannot save into changed account`, () => {
  const f = fixture(); f.saveWorkoutEdit(); f.tick();
  if (boundary === 'unmount') f.unmount(); else f.invalidate(boundary, { key: 'fitness-cloud-sync-user' });
  f.state.fail = false; f.state.data = { anotherOwner: { workoutMemo: 'private' } }; const before = JSON.stringify(f.state.data);
  f.saveWorkoutEdit(); f.saveNewWorkoutRecord(); f.saveSecondaryEdit('cardio');
  assert.equal(JSON.stringify(f.state.data), before); assert.equal(f.state.writes, 1);
});
test('failed deletion also retains UI because shared writer returns failure', () => {
  const f = fixture(); f.deleteWorkoutRecord(); assert.match(f.state.notice, /못했/);
  f.tick(); f.deleteSecondaryRecord('cardio'); assert.equal(f.state.secondary, 'cardio'); assert.equal(f.state.published, 0);
});
test('invalidated view hides all prior account records', () => {
  assert.match(source, /if \(sessionInvalid\) return <p role="status">/);
});
