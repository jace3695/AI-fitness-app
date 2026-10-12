import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFitnessEdits, readFitnessValue, updateFitnessValues } from './fitnessStorageUpdates.ts';
import { EMPTY_USER_WORKOUT_SETTINGS, saveUserWorkoutSettings, USER_WORKOUT_SETTINGS_KEY } from './userWorkoutSettings.ts';
import { clearDailyCondition, DAILY_CONDITION_KEY, RECOVERY_MODE_DAYS_KEY, saveDailyCondition } from './recoveryMode.ts';
import { getDateForWorkoutDay, migrateLegacyWorkoutWeekdays, readWorkoutCompletionStore, WORKOUT_COMPLETED_DAYS_KEY } from './workoutCompletion.ts';
import { captureStorageOwner, invalidateStorageOwner, STORAGE_JOURNAL_KEY, STORAGE_LOCK_NAME } from './storageTransaction.ts';
import { installStorageLocks, preparedStorageSeed } from '../../tests/helpers/storageProtocol.ts';

function browser(seed: Record<string, string> = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const locks = installStorageLocks();
  const values = new Map(Object.entries({ ...preparedStorageSeed(), ...seed }));
  const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(new EventTarget(), { localStorage: storage }) });
  return { values, storage, locks, close() { locks.restore(); if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); } };
}
const json = (value: unknown) => JSON.stringify(value);

test('field edit replay preserves new dates and concurrently edited sibling settings, including explicit deletion', () => {
  const baseline = { dates: { one: { a: 1, b: 2 } }, other: 4 };
  const current = { dates: { one: { a: 1, b: 9 }, two: { a: 8, b: 7 } }, other: 5 };
  const edited = { dates: { one: { a: 3, b: 2 } }, other: 4 };
  assert.deepEqual(applyFitnessEdits(current, baseline, edited), { dates: { one: { a: 3, b: 9 }, two: { a: 8, b: 7 } }, other: 5 });
  assert.deepEqual(applyFitnessEdits({ one: 3, two: 9 }, { one: 1, two: 2 }, { two: 2 }), { two: 9 });
});

test('queued workout settings edits apply only their intent over the latest locked state', async () => {
  const fixture = browser();
  try {
    const baseline = structuredClone(EMPTY_USER_WORKOUT_SETTINGS);
    await Promise.all([
      saveUserWorkoutSettings({ ...baseline, weeklyGroups: { mon: 'first' } }, baseline),
      saveUserWorkoutSettings({ ...baseline, weeklyGroups: { tue: 'second' } }, baseline),
    ]);
    assert.deepEqual(JSON.parse(fixture.storage.getItem(USER_WORKOUT_SETTINGS_KEY)!).weeklyGroups, { mon: 'first', tue: 'second' });
    assert.deepEqual(fixture.locks.calls, [STORAGE_LOCK_NAME, STORAGE_LOCK_NAME]);
  } finally { fixture.close(); }
});

test('condition save and removal atomically preserve unrelated dates and recovery reasons', async () => {
  const fixture = browser({ [DAILY_CONDITION_KEY]: json({ day: { signals: ['fatigue'], recommendation: '70%', updatedAt: 'old' }, other: { signals: [] } }),
    [RECOVERY_MODE_DAYS_KEY]: json({ day: { recoveryMode: true, intensity: 'recovery', reasons: ['fatigue', 'hangover'] }, other: { reasons: ['etc'] } }) });
  try {
    await saveDailyCondition('day', ['sleep-lack'], 'new memo');
    let conditions = JSON.parse(fixture.storage.getItem(DAILY_CONDITION_KEY)!);
    let recovery = JSON.parse(fixture.storage.getItem(RECOVERY_MODE_DAYS_KEY)!);
    assert.deepEqual(conditions.day.signals, ['sleep-lack']); assert.equal(conditions.day.memo, 'new memo');
    assert.deepEqual(recovery.day.reasons, ['hangover']); assert.deepEqual(recovery.other.reasons, ['etc']);
    await clearDailyCondition('day');
    conditions = JSON.parse(fixture.storage.getItem(DAILY_CONDITION_KEY)!); recovery = JSON.parse(fixture.storage.getItem(RECOVERY_MODE_DAYS_KEY)!);
    assert.equal(conditions.day, undefined); assert.ok(conditions.other); assert.deepEqual(recovery.day.reasons, ['hangover']);
  } finally { fixture.close(); }
});

test('condition batch quota failure rolls back both records, no partial recovery edit', async () => {
  const original = { [DAILY_CONDITION_KEY]: json({ day: { signals: ['fatigue'] } }), [RECOVERY_MODE_DAYS_KEY]: json({ day: { reasons: ['fatigue'] } }) };
  const fixture = browser(original);
  const set = fixture.storage.setItem;
  let reject = true;
  fixture.storage.setItem = (key, value) => { if (reject && key === RECOVERY_MODE_DAYS_KEY) { reject = false; throw Error('quota'); } set(key, value); };
  try {
    await assert.rejects(saveDailyCondition('day', ['sleep-lack']), /quota/);
    for (const [key, value] of Object.entries(original)) assert.equal(fixture.storage.getItem(key), value);
  } finally { fixture.close(); }
});

test('malformed map records and legacy journal fail closed without replacement', async () => {
  for (const raw of ['{bad', 'null', '[]', '3']) {
    const fixture = browser({ [USER_WORKOUT_SETTINGS_KEY]: raw });
    try { const before = [...fixture.values]; await assert.rejects(saveUserWorkoutSettings(EMPTY_USER_WORKOUT_SETTINGS)); assert.deepEqual([...fixture.values], before); }
    finally { fixture.close(); }
  }
  const fixture = browser({ [USER_WORKOUT_SETTINGS_KEY]: '{}', [STORAGE_JOURNAL_KEY]: json({ [USER_WORKOUT_SETTINGS_KEY]: '{"before":true}' }) });
  try { const before = [...fixture.values]; await assert.rejects(saveUserWorkoutSettings(EMPTY_USER_WORKOUT_SETTINGS)); assert.deepEqual([...fixture.values], before); }
  finally { fixture.close(); }
});

test('completion normalization is purely read-only for legacy weekdays and malformed records', () => {
  for (const value of ['{"mon":true,"2026-10-01":{"pullupDone":true}}', '{bad']) {
    const fixture = browser({ [WORKOUT_COMPLETED_DAYS_KEY]: value });
    try { const before = [...fixture.values]; readWorkoutCompletionStore(new Date('2026-10-09T12:00:00')); assert.deepEqual([...fixture.values], before); }
    finally { fixture.close(); }
  }
});

test('queued writer retains captured A owner and rejects after A-to-B-to-A', async () => {
  const fixture = browser({ [USER_WORKOUT_SETTINGS_KEY]: '{}' });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocker = fixture.locks.locks.request(STORAGE_LOCK_NAME, {}, () => new Promise<void>(resolve => { release = resolve; entered(); }));
  await started;
  const owner = captureStorageOwner(fixture.storage);
  const pending = updateFitnessValues(snapshot => ({ changes: { [USER_WORKOUT_SETTINGS_KEY]: json({ ...readFitnessValue(snapshot, USER_WORKOUT_SETTINGS_KEY, {}), changed: true }) }, value: true }), owner);
  const rejection = assert.rejects(pending, /계정/);
  invalidateStorageOwner(fixture.storage, 'owner-B'); invalidateStorageOwner(fixture.storage, owner.userId);
  release(); await blocker; await rejection;
  assert.equal(fixture.storage.getItem(USER_WORKOUT_SETTINGS_KEY), '{}'); fixture.close();
});

test('concurrent custom exercise additions and removals preserve independent list edits', async () => {
  const fixture = browser();
  try {
    const baseline = structuredClone(EMPTY_USER_WORKOUT_SETTINGS);
    fixture.storage.setItem(USER_WORKOUT_SETTINGS_KEY, json(baseline));
    const add = (id: string) => ({ ...baseline, weeklyEdits: { mon: { customExercises: [{ id, name: id }], order: [id] } } });
    await Promise.all([saveUserWorkoutSettings(add('A'), baseline), saveUserWorkoutSettings(add('B'), baseline)]);
    const value = JSON.parse(fixture.storage.getItem(USER_WORKOUT_SETTINGS_KEY)!);
    assert.deepEqual(value.weeklyEdits.mon.customExercises.map((item: { id: string }) => item.id), ['A', 'B']);
    assert.deepEqual(value.weeklyEdits.mon.order, ['A', 'B']);
    assert.deepEqual(applyFitnessEdits(['A', 'B', 'C'], ['A', 'B'], ['B']), ['B', 'C']);
    assert.throws(() => applyFitnessEdits(['A', 'B', 'C'], ['A', 'B'], ['B', 'A']), /최신 순서/);
  } finally { fixture.close(); }
});

test('one locked weekday migration pins dates across following-week reads and keeps canonical/unknown keys', async () => {
  const firstWeek = new Date('2026-10-09T12:00:00'), nextWeek = new Date('2026-10-16T12:00:00');
  const monday = getDateForWorkoutDay('mon', firstWeek), nextMonday = getDateForWorkoutDay('mon', nextWeek);
  const original = { mon: true, tue: true, wed: { workoutMemo: 'weekday detail', cardioDone: true }, unknownCounter: 42, [getDateForWorkoutDay('tue', firstWeek)]: { workoutMemo: 'canonical', pullupDone: true }, historicalUnknown: { custom: 'keep' } };
  const fixture = browser({ [WORKOUT_COMPLETED_DAYS_KEY]: json(original) });
  try {
    const before = fixture.storage.getItem(WORKOUT_COMPLETED_DAYS_KEY);
    assert.deepEqual(readWorkoutCompletionStore(firstWeek)[monday], { workoutDone: true });
    assert.equal(fixture.storage.getItem(WORKOUT_COMPLETED_DAYS_KEY), before, 'ordinary read remains nonmutating');
    await updateFitnessValues(snapshot => {
      const migrated = migrateLegacyWorkoutWeekdays(readFitnessValue(snapshot, WORKOUT_COMPLETED_DAYS_KEY, {}), firstWeek);
      return { changes: { [WORKOUT_COMPLETED_DAYS_KEY]: json(migrated) }, value: undefined };
    });
    const saved = fixture.storage.getItem(WORKOUT_COMPLETED_DAYS_KEY);
    const later = readWorkoutCompletionStore(nextWeek);
    assert.deepEqual(later[monday], { workoutDone: true }); assert.equal(later[nextMonday], undefined); assert.equal(later.mon, undefined);
    assert.deepEqual(later[getDateForWorkoutDay('tue', firstWeek)], original[getDateForWorkoutDay('tue', firstWeek)]);
    assert.deepEqual(later[getDateForWorkoutDay('wed', firstWeek)], original.wed);
    assert.equal(later.unknownCounter, original.unknownCounter);
    assert.deepEqual(later.historicalUnknown, original.historicalUnknown); assert.equal(fixture.storage.getItem(WORKOUT_COMPLETED_DAYS_KEY), saved);
  } finally { fixture.close(); }
});

test('blocked legacy weekday migration leaves original bytes untouched', async () => {
  const original = '{ "mon": true, "2020-01-01": {"workoutMemo":"keep"} }';
  const fixture = browser({ [WORKOUT_COMPLETED_DAYS_KEY]: original });
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await assert.rejects(updateFitnessValues(snapshot => ({ changes: { [WORKOUT_COMPLETED_DAYS_KEY]: json(migrateLegacyWorkoutWeekdays(readFitnessValue(snapshot, WORKOUT_COMPLETED_DAYS_KEY, {}))) }, value: undefined })), /Web Locks/);
    assert.equal(fixture.storage.getItem(WORKOUT_COMPLETED_DAYS_KEY), original);
  } finally { fixture.close(); }
});
