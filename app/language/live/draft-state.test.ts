import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLiveReport } from '../../../lib/language-live/report-parser.ts';
import { draftKey, forkLiveDraft, liveDraftSaveInput, LiveRequestEpoch, persistLiveDraft, readLiveDrafts, removeLiveDraft, type LiveEditorDraft } from './draft-state.ts';

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const fixture = (ownerId = 'owner-a'): LiveEditorDraft => ({ version: 1, ownerId, draftId: 'draft-a', lessonId: 'lesson-a', requestId: 'request-a', expectedRevision: 0, updatedAt: '2026-10-09T16:00:00.000Z', rawText: '日本語\r\n原文', report: null, reviewed: false, submitted: false, allowDuplicate: false, duplicateReason: '' });

test('Live drafts are owner-scoped and preserve exact input across reload', () => {
  const storage = new MemoryStorage();
  persistLiveDraft(storage, fixture(), null);
  storage.setItem('dailyRoutineProgress', 'legacy untouched');
  assert.deepEqual(readLiveDrafts(storage, 'owner-a').drafts, [fixture()]);
  assert.deepEqual(readLiveDrafts(storage, 'owner-b').drafts, []);
  assert.equal(storage.getItem('dailyRoutineProgress'), 'legacy untouched');
});

test('a stale tab cannot overwrite or remove another tab’s newer work', () => {
  const storage = new MemoryStorage(); const original = fixture();
  const baseline = persistLiveDraft(storage, original, null);
  const latest = { ...original, rawText: 'newer edits' };
  persistLiveDraft(storage, latest, baseline);
  assert.throws(() => persistLiveDraft(storage, { ...original, rawText: 'stale' }, baseline), /draft_changed/);
  assert.equal(removeLiveDraft(storage, original, baseline), false);
  assert.equal(readLiveDrafts(storage, 'owner-a').drafts[0].rawText, 'newer edits');
});

test('verified save clears only the exact local draft, not another account or lesson', () => {
  const storage = new MemoryStorage(); const a = fixture(), b = fixture('owner-b');
  const baseline = persistLiveDraft(storage, a, null); persistLiveDraft(storage, b, null);
  assert.equal(removeLiveDraft(storage, a, baseline), true);
  assert.equal(readLiveDrafts(storage, 'owner-b').drafts.length, 1);
});

test('corrupt or forged-owner drafts are not displayed and are not destroyed', () => {
  const storage = new MemoryStorage(); const key = draftKey('owner-b', 'draft-a');
  storage.setItem(key, JSON.stringify(fixture()));
  const result = readLiveDrafts(storage, 'owner-b');
  assert.deepEqual(result.drafts, []); assert.equal(result.unreadable, true);
  assert.ok(storage.getItem(key));
});

test('quota failure is surfaced, with no claimed local save', () => {
  const storage = new MemoryStorage(); storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => persistLiveDraft(storage, fixture(), null), /quota/);
  assert.equal(storage.length, 0);
});

test('request IDs and submitted payload survive uncertain save and refresh', () => {
  const storage = new MemoryStorage(); const original = fixture(); const draft = { ...original, report: parseLiveReport(original.rawText), reviewed: true, submitted: true };
  persistLiveDraft(storage, draft, null);
  const recovered = readLiveDrafts(storage, 'owner-a').drafts[0];
  assert.equal(recovered.requestId, draft.requestId); assert.equal(recovered.submitted, true);
  assert.equal(recovered.rawText, draft.rawText);
});

test('older reads and all responses after account switch/unmount are rejected', () => {
  const epoch = new LiveRequestEpoch(); const older = epoch.start(), newer = epoch.start();
  assert.equal(epoch.accepts(older), false); assert.equal(epoch.accepts(newer), true);
  epoch.close(); assert.equal(epoch.accepts(newer), false); assert.equal(epoch.accepts(epoch.start()), false);
});


test('malformed nested reports and impossible submitted drafts stay stored but cannot crash recovery', () => {
  const storage = new MemoryStorage();
  const broken = { ...fixture(), report: { rawText: fixture().rawText } };
  storage.setItem(draftKey(broken.ownerId, broken.draftId), JSON.stringify(broken));
  assert.equal(readLiveDrafts(storage, broken.ownerId).unreadable, true);
  assert.equal(readLiveDrafts(storage, broken.ownerId).drafts.length, 0);
  assert.equal(storage.length, 1);
  const impossible = { ...fixture(), submitted: true };
  storage.setItem(draftKey(impossible.ownerId, impossible.draftId), JSON.stringify(impossible));
  assert.equal(readLiveDrafts(storage, impossible.ownerId).drafts.length, 0);
});

test('a renderable unfinished invalid date is recoverable for correction', () => {
  const storage = new MemoryStorage(); const original = fixture();
  const report = parseLiveReport(original.rawText);
  report.fields.lessonDate = { text: '2026-02-31', presence: 'reported' };
  const draft = { ...original, report };
  persistLiveDraft(storage, draft, null);
  assert.equal(readLiveDrafts(storage, draft.ownerId).drafts[0].report?.fields.lessonDate.text, '2026-02-31');
});

test('a dismissed read epoch never revives when a later lifecycle opens', () => {
  const former = new LiveRequestEpoch(); const formerRequest = former.start(); former.close();
  const current = new LiveRequestEpoch(); const currentRequest = current.start();
  assert.equal(former.accepts(formerRequest), false); assert.equal(current.accepts(currentRequest), true);
});


test('unchecking duplicate opt-in never transmits the retained draft reason', () => {
  const original = fixture(); const draft = { ...original, report: parseLiveReport(original.rawText), duplicateReason: '다시 진행한 별도 수업' };
  assert.equal(liveDraftSaveInput(draft).duplicateReason, undefined);
  assert.equal(liveDraftSaveInput({ ...draft, allowDuplicate: true }).duplicateReason, draft.duplicateReason);
  assert.equal(liveDraftSaveInput(draft).requestId, draft.requestId);
  assert.throws(() => liveDraftSaveInput(original), /report_required/);
});


test('two tabs fork the same recovered draft without sharing writable storage or changing a pending request', () => {
  const storage = new MemoryStorage(); const initial = fixture();
  const source = { ...initial, report: parseLiveReport(initial.rawText), submitted: true, reviewed: true };
  const original = persistLiveDraft(storage, source, null);
  const first = forkLiveDraft(source, 'tab-a-copy', '2026-10-09T17:00:00.000Z');
  const second = forkLiveDraft(source, 'tab-b-copy', '2026-10-09T17:00:01.000Z');
  const firstBaseline = persistLiveDraft(storage, first, null); persistLiveDraft(storage, second, null);
  assert.deepEqual(liveDraftSaveInput(first), liveDraftSaveInput(source));
  assert.deepEqual(liveDraftSaveInput(second), liveDraftSaveInput(source));
  assert.equal(removeLiveDraft(storage, first, firstBaseline), true);
  assert.equal(storage.getItem(draftKey(source.ownerId, source.draftId)), original);
  assert.equal(readLiveDrafts(storage, source.ownerId).drafts.some(item => item.draftId === second.draftId), true);
  assert.throws(() => forkLiveDraft(source, source.draftId, source.updatedAt), /fresh_draft_id_required/);
});
