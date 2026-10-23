import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { bodyImportOwner, mergeBodyImport } from '../app/lib/bodyImport.ts';

// Execute the shipped confirmation/save handler, never browser or user storage.
function fixture() {
  const storage = new Map<string, string>([
    ['fitness-cloud-sync-user', 'synthetic-A'], ['fitness-cloud-sync-epoch', '1'],
    ['weights', JSON.stringify({ '2026-09-30': { weight: 80 }, '2026-10-22': { weight: 81 } })],
    ['inbody', JSON.stringify({ '2026-09-30': { bmi: 24, memo: 'keep', futureMetric: 7 } })],
  ]);
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null };
  const draft = { owner: bodyImportOwner(localStorage), date: '2026-09-30', patch: { weight: '79.2', bmi: '23' } };
  const state = { writes: 0, changed: 0, cleared: false, date: '', message: '', confirm: () => true };
  const context = {
    draft, window: { localStorage, confirm: () => state.confirm() }, bodyImportOwner, mergeBodyImport,
    WEIGHT_RECORDS_KEY: 'weights', INBODY_RECORDS_KEY: 'inbody', getLocalDateKey: () => '2026-10-22',
    readJson: (key: string) => JSON.parse(storage.get(key) ?? '{}'),
    writeStorageBatch: (_storage: unknown, values: Record<string, string>) => {
      state.writes++; for (const [key, value] of Object.entries(values)) storage.set(key, value);
    },
    manualEdit: { current: { dirty: true } }, setManualDirty: () => {}, notifyRecordsChanged: () => {},
    onChange: () => { state.changed++; }, onDateChange: (date: string) => { state.date = date; },
    setDraft: () => { state.cleared = true; }, setRecordMessage: (value: string) => { state.message = value; },
    Error,
  };
  const source = readFileSync(new URL('../app/components/BodyRecordCard.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const saveImport =');
  const end = source.indexOf('  const save =', start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const save = vm.runInNewContext(code + '\nsaveImport', context) as () => void;
  return { state, storage, draft, save };
}

test('confirmed measurement date is saved and selected; unrelated fields and dates survive', () => {
  const f = fixture(); f.save();
  assert.equal(f.state.writes, 1); assert.equal(f.state.changed, 1);
  assert.equal(f.state.date, '2026-09-30'); assert.equal(f.state.cleared, true);
  const weights = JSON.parse(f.storage.get('weights')!);
  assert.equal(weights['2026-09-30'].weight, 79.2); assert.equal(weights['2026-10-22'].weight, 81);
  assert.deepEqual(JSON.parse(f.storage.get('inbody')!)['2026-09-30'], { bmi: 23, memo: 'keep', futureMetric: 7 });
});
test('declining an existing-date conflict keeps the draft and does not navigate or write', () => {
  const f = fixture(); f.state.confirm = () => false; f.save();
  assert.equal(f.state.writes, 0); assert.equal(f.state.cleared, false); assert.equal(f.state.date, '');
});
test('account switch while confirming cannot write the previous account draft', () => {
  const f = fixture(); f.state.confirm = () => { f.storage.set('fitness-cloud-sync-user', 'synthetic-B'); return true; }; f.save();
  assert.equal(f.state.writes, 0); assert.equal(f.state.changed, 0); assert.match(f.state.message, /계정/);
});
test('same-account new session rejects an old draft before confirmation', () => {
  const f = fixture(); f.storage.set('fitness-cloud-sync-epoch', '2');
  f.state.confirm = () => { assert.fail('stale session must not confirm'); }; f.save();
  assert.equal(f.state.writes, 0); assert.equal(f.state.cleared, false);
});
test('concurrent record change during confirmation is preserved, then explicit retry merges it', () => {
  const f = fixture(); f.state.confirm = () => {
    f.storage.set('inbody', JSON.stringify({ '2026-09-30': { bmi: 24, memo: 'newer' } })); return true;
  }; f.save();
  assert.equal(f.state.writes, 0); assert.match(f.state.message, /기록이 변경/);
  f.state.confirm = () => true; f.save();
  assert.equal(f.state.writes, 1); assert.equal(JSON.parse(f.storage.get('inbody')!)['2026-09-30'].memo, 'newer');
});
test('invalid or future edited dates preserve draft without saving or navigating', () => {
  for (const date of ['', '2026-02-30', '2026-10-23']) {
    const f = fixture(); f.draft.date = date; f.save();
    assert.equal(f.state.writes, 0); assert.equal(f.state.cleared, false); assert.equal(f.state.date, '');
    assert.match(f.state.message, /날짜/);
  }
});


test('blank OCR date requires manual correction and explicit confirmation before synthetic save', () => {
  const f = fixture(); f.draft.date = ''; const before = [...f.storage]; f.save();
  assert.deepEqual([...f.storage], before); assert.equal(f.state.cleared, false);
  f.draft.date = '2026-09-30'; f.state.confirm = () => false; f.save();
  assert.deepEqual([...f.storage], before);
  f.state.confirm = () => true; f.save();
  assert.equal(f.state.writes, 1); assert.equal(f.state.date, '2026-09-30');
  assert.equal(JSON.parse(f.storage.get('inbody')!)['2026-09-30'].memo, 'keep');
});
