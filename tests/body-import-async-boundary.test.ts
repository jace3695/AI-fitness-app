import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { bodyForm, bodyImportOwner, validMeasurementDate } from '../app/lib/bodyImport.ts';

import { dateFromText } from '../app/lib/oaReportParser.ts';

type Result = { values: Record<string, number>; detectedDate?: string };
function fixture() {
  const source = readFileSync(new URL('../app/components/BodyRecordCard.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const importOaReport =');
  const end = source.indexOf('\n  return (', start);
  const effectStart = source.indexOf('  useEffect(() => {\n    const invalidate');
  const effectEnd = source.indexOf('\n  }, []);', effectStart) + '\n  }, []);'.length;
  assert.ok(start >= 0 && end > start && effectStart >= 0 && effectEnd > effectStart);
  const storage = new Map([['fitness-cloud-sync-user', 'A'], ['fitness-cloud-sync-epoch', '1']]);
  const listeners = new Map<string, (event: { key?: string }) => void>();
  const pending: { resolve: (result: Result) => void; reject: (error: Error) => void; progress: (n: number) => void }[] = [];
  const state = { draft: null as unknown, message: '', importing: false, progress: 0, mutations: 0 };
  let cleanup = () => {};
  const update = (fn: () => void) => { state.mutations++; fn(); };
  const context = {
    window: {
      localStorage: { getItem: (key: string) => storage.get(key) ?? null },
      addEventListener: (type: string, fn: (event: { key?: string }) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    },
    useEffect: (fn: () => () => void) => { cleanup = fn(); },
    importVersion: { current: 0 }, activeDate: { current: '2026-10-22' }, dateKey: '2026-10-22',
    confirmedPro: false, weights: {}, inbody: {}, form: { memo: 'manual memo' }, manualEdit: { current: { dirty: true } },
    bodyForm, bodyImportOwner, validMeasurementDate, getLocalDateKey: () => '2026-10-22',
    parseOaReport: (_file: unknown, progress: (n: number) => void) => new Promise<Result>((resolve, reject) => pending.push({ resolve, reject, progress })),
    oaSourceMeasurements: () => [], OA_TRUNK_ROWS: [], inbodyFields: [],
    setDraft: (value: unknown) => update(() => { state.draft = value; }),
    setImportMessage: (value: string) => update(() => { state.message = value; }),
    setImporting: (value: boolean) => update(() => { state.importing = value; }),
    setImportProgress: (value: number) => update(() => { state.progress = value; }),
    setRecordMessage: () => update(() => {}), setConfirmedPro: () => {}, setManualDirty: () => {}, setForm: () => {}, Error,
  };
  const code = ts.transpileModule(source.slice(effectStart, effectEnd) + '\n' + source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = vm.runInNewContext(code + '\nimportOaReport', context) as (event: unknown) => Promise<void>;
  return { state, storage, pending, context, leave: () => cleanup(), emit: (type: string) => listeners.get(type)?.({}),
    start: () => run({ target: { files: [{ type: 'image/png' }], value: 'synthetic' } }) };
}
const result = (weight = 71): Result => ({ values: { weight }, detectedDate: '2026-10-22' });

test('current OCR response creates a review draft, not a stored record', async () => {
  const f = fixture(); const task = f.start(); f.pending[0].progress(50); f.pending[0].resolve(result()); await task;
  assert.equal(f.state.progress, 50); assert.equal(f.state.importing, false);
  assert.equal((f.state.draft as { patch: { weight: string; memo: string } }).patch.weight, '71');
  assert.equal((f.state.draft as { patch: { memo: string } }).patch.memo, 'manual memo');
  assert.equal(f.storage.size, 2);
});
test('account change rejects late success, progress and error', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); const task = f.start(); f.storage.set('fitness-cloud-sync-user', 'B'); f.emit('yeoni-cloud-session-changed');
    const before = structuredClone(f.state); f.pending[0].progress(99);
    if (fail) f.pending[0].reject(Error('old account error')); else f.pending[0].resolve(result());
    await task; assert.deepEqual(structuredClone(f.state), before);
  }
});
test('date change before effect runs prevents old response from replacing review values', async () => {
  const f = fixture(); const task = f.start(); f.context.activeDate.current = '2026-09-30';
  f.state.draft = { patch: { memo: 'review on new date' } }; f.pending[0].resolve(result()); await task;
  assert.deepEqual(f.state.draft, { patch: { memo: 'review on new date' } });
});
test('photo reselection and reverse completion preserve the newest response', async () => {
  const f = fixture(); const first = f.start(); const second = f.start();
  f.pending[1].resolve(result(72)); await second; const before = structuredClone(f.state);
  f.pending[0].progress(90); f.pending[0].resolve(result(71)); await first;
  assert.deepEqual(structuredClone(f.state), before);
  assert.equal((f.state.draft as { patch: { weight: string } }).patch.weight, '72');
});
test('an earlier failed request cannot hide progress or error of a still pending replacement', async () => {
  const f = fixture(); const first = f.start(); const second = f.start();
  const before = structuredClone(f.state); f.pending[0].reject(Error('old failure')); await first;
  assert.deepEqual(structuredClone(f.state), before); f.pending[1].resolve(result()); await second;
});
test('unmount cleanup rejects late response and progress without state setters', async () => {
  const f = fixture(); const task = f.start(); f.leave(); const before = structuredClone(f.state);
  f.pending[0].progress(99); f.pending[0].resolve(result()); await task; assert.deepEqual(structuredClone(f.state), before);
});
test('pagehide invalidates pending OCR even when browser preserves mounted page', async () => {
  const f = fixture(); const task = f.start(); f.emit('pagehide'); const before = structuredClone(f.state);
  f.pending[0].progress(99); f.pending[0].resolve(result()); await task; assert.deepEqual(structuredClone(f.state), before);
});
test('pagehide preserves reviewed input and a restored page can explicitly start a new import', async () => {
  const f = fixture(); f.state.draft = { patch: { memo: 'reviewed input' } };
  f.emit('pagehide'); assert.deepEqual(f.state.draft, { patch: { memo: 'reviewed input' } });
  assert.equal(f.context.form.memo, 'manual memo'); assert.equal(f.state.importing, false);
  const task = f.start(); f.pending[0].resolve(result(73)); await task;
  assert.equal((f.state.draft as unknown as { patch: { weight: string } }).patch.weight, '73');
});


test('synthetic header dates reach review without current-date fallback or storage writes', async () => {
  for (const [text, expected] of [
    ['측정일 2026-10-21', '2026-10-21'],
    ['2026/04/05', '2026-04-05'],
    ['2026-10-23', ''], ['10/22', ''], ['22/10/2026', ''],
    ['2026-22-10', ''], ['2026-10-21\n2026-10-22', ''],
    ['측정일 2026-10-21\n인쇄일 2026-10-22', ''],
    ['인쇄일 2026-10-22', ''], ['', ''],
  ]) {
    const f = fixture(); const task = f.start();
    f.pending[0].resolve({ values: {}, detectedDate: dateFromText(text) }); await task;
    assert.equal((f.state.draft as { date: string }).date, expected, text);
    assert.equal(f.storage.size, 2);
    if (!expected) assert.match(f.state.message, /직접 입력/);
  }
});


test('measurement plus print date asks for date review without losing recognized measurements', async () => {
  const f = fixture(); const task = f.start();
  f.pending[0].resolve({ values: { weight: 71, bmi: 23 }, detectedDate: dateFromText('측정일 2026-10-21\n인쇄일 2026-10-22') });
  await task;
  const draft = f.state.draft as { date: string; patch: Record<string, string> };
  assert.equal(draft.date, ''); assert.equal(draft.patch.weight, '71'); assert.equal(draft.patch.bmi, '23');
  assert.equal(f.state.importing, false); assert.match(f.state.message, /직접 입력/);
  assert.equal(f.storage.size, 2);
});
