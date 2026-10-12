import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { parseLiveReport } from '../../../lib/language-live/report-parser.ts';
import type { LiveLesson } from '../../../lib/language-live/types.ts';
import type { LiveLearningBatch } from '../../../lib/language-live/learning-types.ts';
import { blankLearningEvent, createLearningDraft, forkLearningDraft, knownLearningItems, learningDraftKey, learningSourceProblems, persistLearningDraft, readLearningDrafts, removeLearningDraft, type LiveLearningDraft } from './learning-draft.ts';

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const owner = randomUUID();
const lesson = (): LiveLesson => ({ user_id: owner, lesson_id: randomUUID(), revision: 1, operation: 'create', report: parseLiveReport('[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: 2026-10-09\n읽기 학습 결과: え를 새로 배웠다.\n쓰기 학습 결과: 미확인'), created_at: '2026-10-09T14:00:00Z', request_id: randomUUID(), payload_hash: 'synthetic', previous_revision: 0, restored_from_revision: null, duplicate_reason: null });
const ids = () => ({ draftId: randomUUID(), requestId: randomUUID(), now: '2026-10-09T14:00:00Z' });
const draft = (): LiveLearningDraft => {
  const source = lesson(), value = createLearningDraft(owner, source, undefined, ids());
  value.input.changeReason = '보고서의 학습 사실 확인';
  value.input.events = [{ ...blankLearningEvent(randomUUID(), randomUUID(), source.report.lessonDate), item: { itemId: randomUUID(), kind: 'kana', text: 'え', meaning: '' }, evidenceText: 'え를 새로 배웠다.', reason: '명시적인 수업 근거', certainty: 'confirmed' }];
  return value;
};
const batch = (value: LiveLearningDraft): LiveLearningBatch => ({ user_id: value.ownerId, lesson_id: value.input.lessonId, lesson_revision: value.input.lessonRevision, version: value.input.expectedVersion + 1, previous_version: value.input.expectedVersion, request_id: value.input.requestId, payload: structuredClone(value.input), payload_hash: 'synthetic', created_at: '2026-10-09T14:00:00Z' });

test('learning drafts are account-scoped and never touch legacy or P1 keys', () => {
  const storage = new MemoryStorage(), original = draft();
  storage.setItem('dailyLearningHistory', 'legacy'); storage.setItem(`yeoni-language-live:${owner}:draft:v1:p1`, 'P1');
  persistLearningDraft(storage, original, null);
  assert.deepEqual(readLearningDrafts(storage, owner).drafts, [original]); assert.deepEqual(readLearningDrafts(storage, randomUUID()).drafts, []);
  assert.equal(storage.getItem('dailyLearningHistory'), 'legacy'); assert.equal(storage.getItem(`yeoni-language-live:${owner}:draft:v1:p1`), 'P1');
});

test('unfinished invalid observation text and unknown dates survive refresh without becoming an assessment', () => {
  const storage = new MemoryStorage(), original = draft(); original.entry = blankLearningEvent(randomUUID(), randomUUID(), null);
  original.entry.item.text = '入力途中'; original.entry.occurredDate = '2026-02-31'; original.entry.evidenceText = 'not yet copied';
  persistLearningDraft(storage, original, null);
  assert.deepEqual(readLearningDrafts(storage, owner).drafts[0].entry, original.entry);
  assert.equal(readLearningDrafts(storage, owner).drafts[0].entryReviewed, false);
});

test('recovery creates separate writable keys but preserves exact uncertain-save request', () => {
  const storage = new MemoryStorage(), original = { ...draft(), reviewed: true, submitted: true };
  persistLearningDraft(storage, original, null);
  const a = forkLearningDraft(original, randomUUID(), ids().now), b = forkLearningDraft(original, randomUUID(), ids().now);
  persistLearningDraft(storage, a, null); persistLearningDraft(storage, b, null);
  assert.equal(storage.length, 3); assert.deepEqual(a.input, original.input); assert.deepEqual(b.input, original.input);
  a.input.events[0].reason = 'local independent object'; assert.notEqual(a.input.events[0].reason, original.input.events[0].reason);
  assert.throws(() => forkLearningDraft(original, original.draftId, ids().now), /fresh_draft_id/);
});

test('stale writes and cleanup do not overwrite or remove newer work', () => {
  const storage = new MemoryStorage(), original = draft(), baseline = persistLearningDraft(storage, original, null);
  const latest = structuredClone(original); latest.input.changeReason = 'newer'; persistLearningDraft(storage, latest, baseline);
  assert.throws(() => persistLearningDraft(storage, original, baseline), /draft_changed/);
  assert.equal(removeLearningDraft(storage, original, baseline), false); assert.equal(readLearningDrafts(storage, owner).drafts[0].input.changeReason, 'newer');
});

test('verified cleanup removes only exact current draft and leaves source recovery copy', () => {
  const storage = new MemoryStorage(), original = draft(); persistLearningDraft(storage, original, null);
  const fork = forkLearningDraft(original, randomUUID(), ids().now); const baseline = persistLearningDraft(storage, fork, null);
  assert.equal(removeLearningDraft(storage, fork, baseline), true); assert.deepEqual(readLearningDrafts(storage, owner).drafts, [original]);
});

test('quota failures are visible and no saved local state is claimed', () => {
  const storage = new MemoryStorage(); storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => persistLearningDraft(storage, draft(), null), /quota/); assert.equal(storage.length, 0);
});

test('malformed owner, nested item and impossible submitted drafts are retained but never rendered', () => {
  for (const change of [(value: LiveLearningDraft) => ({ ...value, ownerId: randomUUID() }), (value: LiveLearningDraft) => ({ ...value, entry: { item: null } }), (value: LiveLearningDraft) => ({ ...value, submitted: true, reviewed: false }), (value: LiveLearningDraft) => ({ ...value, submitted: true, reviewed: true, entry: blankLearningEvent(randomUUID(), randomUUID(), null) })]) {
    const storage = new MemoryStorage(), original = draft(), key = learningDraftKey(owner, original.draftId);
    storage.setItem(key, JSON.stringify(change(original))); const result = readLearningDrafts(storage, owner);
    assert.deepEqual(result.drafts, []); assert.equal(result.unreadable, true); assert.ok(storage.getItem(key));
  }
});

test('new learning drafts have no inferred assessments and no confirmation', () => {
  const source = lesson(), value = createLearningDraft(owner, source, undefined, ids());
  assert.deepEqual(value.input.events, []); assert.equal(value.input.expectedVersion, 0); assert.equal(value.reviewed, false); assert.equal(value.entry, null);
});

test('explicit restoration copies old observations to current revision with original dates and links', () => {
  const original = draft(), old = batch(original);
  const source = { ...lesson(), lesson_id: original.input.lessonId, revision: 4, operation: 'restore' as const, previous_revision: 3, restored_from_revision: 1 };
  const value = createLearningDraft(owner, source, undefined, ids(), old);
  assert.equal(value.input.lessonRevision, 4); assert.equal(value.input.expectedVersion, 0); assert.equal(value.reviewed, false); assert.equal(value.submitted, false);
  assert.deepEqual(value.input.events, old.payload.events); assert.notEqual(value.input.requestId, old.request_id);
  value.input.events[0].reason = 'changed'; assert.notEqual(old.payload.events[0].reason, 'changed');
});

test('copying a historical batch uses current CAS version, never its old version', () => {
  const original = draft(), old = batch(original), source = { ...lesson(), lesson_id: original.input.lessonId };
  const current = { ...old, version: 7, previous_version: 6 };
  const value = createLearningDraft(owner, source, current, ids(), old);
  assert.equal(value.input.expectedVersion, 7); assert.equal(value.reviewed, false);
});

test('copy/reconfirm refuses a deleted lesson, another owner or unrelated source', () => {
  const original = draft(), old = batch(original), source = { ...lesson(), lesson_id: original.input.lessonId };
  assert.throws(() => createLearningDraft(owner, { ...source, operation: 'delete' }, undefined, ids(), old), /source_mismatch/);
  assert.throws(() => createLearningDraft(randomUUID(), source, undefined, ids(), old), /source_mismatch/);
  assert.throws(() => createLearningDraft(owner, lesson(), undefined, ids(), old), /source_mismatch/);
  assert.throws(() => createLearningDraft(owner, source, { ...old, lesson_revision: 2 }, ids()), /source_mismatch/);
});

test('evidence must be a verbatim excerpt and missing report fields cannot become confirmed assessments', () => {
  const source = lesson(), event = draft().input.events[0]; assert.deepEqual(learningSourceProblems(event, source), []);
  assert.ok(learningSourceProblems({ ...event, evidenceText: 'え를 자유롭게 읽는다' }, source).length);
  assert.ok(learningSourceProblems({ ...event, sourceField: 'writing', evidenceText: '미확인' }, source).length);
  assert.deepEqual(learningSourceProblems({ ...event, sourceField: 'writing', evidenceText: '미확인', certainty: 'uncertain' }, source), []);
});

test('known item identities include inactive and replaced batches for explicit linking', () => {
  const original = draft(), old = batch(original); const empty = { ...old, version: 2, payload: { ...old.payload, events: [] } };
  assert.deepEqual(knownLearningItems([old, empty]), [old.payload.events[0].item]);
});


test('explicit not-learned source never becomes confirmed learning or success', () => {
  const source = lesson(); source.report.fields.reading = { text: '미학습', presence: 'not_learned' };
  const event = { ...draft().input.events[0], evidenceText: '미학습' };
  assert.ok(learningSourceProblems(event, source).length);
  assert.deepEqual(learningSourceProblems({ ...event, kind: 'not_learned' }, source), []);
  assert.deepEqual(learningSourceProblems({ ...event, certainty: 'uncertain' }, source), []);
});
