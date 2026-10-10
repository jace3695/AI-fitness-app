import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLanguageLiveLearningRepository, decodeLiveLearningSnapshot } from '../../app/data/languageLiveLearningRepository.ts';
import { LanguageLiveError, type LiveLesson } from './types.ts';
import { parseLiveReport } from './report-parser.ts';
import { liveItemIdentityKey, matchLiveItem, validateLiveLearningInput } from './learning-validation.ts';
import type { LiveLearningBatch, LiveLearningEvent, LiveLearningSnapshot, SaveLiveLearningInput } from './learning-types.ts';

const owner = randomUUID(), other = randomUUID(), lessonId = randomUUID(), itemId = randomUUID();
const event = (): LiveLearningEvent => ({ eventId: randomUUID(), item: { itemId, kind: 'kana', text: 'え', meaning: '' }, skill: 'reading', kind: 'learn', result: 'not_assessed', occurredDate: '2026-10-09', certainty: 'confirmed', independent: null, hintUsed: null, forgettingConfirmed: false, evidenceText: 'えを読む', sourceField: 'reading', reason: '보고서에서 확인', relearningText: '', linkedRelearningEventId: null, teacherRecommendedDue: null, teacherRecommendationConfirmed: false });
const input = (): SaveLiveLearningInput => ({ requestId: randomUUID(), lessonId, lessonRevision: 1, expectedVersion: 0, confirmed: true, policyVersion: 'live-review-v1', events: [event()], changeReason: '학습 근거 확인' });
const row = (payload: SaveLiveLearningInput): LiveLearningBatch => ({ user_id: owner, lesson_id: payload.lessonId, lesson_revision: payload.lessonRevision, version: payload.expectedVersion + 1, previous_version: payload.expectedVersion, request_id: payload.requestId, payload: structuredClone(payload), payload_hash: 'synthetic-hash', created_at: '2026-10-09T13:00:00.000Z' });
const lesson = (): LiveLesson => ({ user_id: owner, lesson_id: lessonId, revision: 1, previous_revision: 0, operation: 'create', report: parseLiveReport('[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: 2026-10-09\n읽기 학습 결과: えを読む'), created_at: '2026-10-09T12:00:00.000Z', request_id: randomUUID(), payload_hash: 'synthetic-lesson-hash', restored_from_revision: null, duplicate_reason: null });
const hasCode = (code: string) => (error: unknown) => error instanceof LanguageLiveError && error.code === code;
type Client = Parameters<typeof createLanguageLiveLearningRepository>[0];
function fixture() {
  const state = {
    owner: owner as string | null, rows: [] as LiveLearningBatch[], calls: [] as { name: string; args: Record<string, unknown> }[],
    reads: [] as Record<string, unknown>[], error: null as unknown, readError: null as unknown, loseResponse: false,
    beforeAuth: undefined as (() => Promise<void>) | undefined, beforeRpc: undefined as (() => void) | undefined,
    afterRpc: undefined as (() => void) | undefined, afterRead: undefined as (() => void) | undefined,
    alterReceipt: undefined as ((value: LiveLearningBatch) => unknown) | undefined,
    alterRead: undefined as ((value: LiveLearningBatch | null) => unknown) | undefined,
    snapshot: { ownerId: owner, lessons: [lesson()], batches: [] } as LiveLearningSnapshot,
  };
  const client = {
    auth: { getUser: async () => { await state.beforeAuth?.(); return { data: { user: state.owner ? { id: state.owner } : null }, error: null }; } },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.beforeRpc?.(); state.calls.push({ name, args });
      if (args.p_expected_owner !== state.owner) return { data: null, error: { message: 'LIVE_ACCOUNT_CHANGED', code: '42501' } };
      if (state.error) return { data: null, error: state.error };
      if (name === 'read_language_live_learning') { state.afterRpc?.(); return { data: structuredClone(state.snapshot), error: null }; }
      const payload = args.p_payload as SaveLiveLearningInput;
      let receipt = state.rows.find(value => value.request_id === payload.requestId);
      if (!receipt) { receipt = row(payload); state.rows.push(receipt); }
      state.afterRpc?.();
      return { data: state.alterReceipt?.(structuredClone(receipt)) ?? structuredClone(receipt), error: state.loseResponse ? { message: 'synthetic lost response' } : null };
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = { table };
      const query = {
        select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        maybeSingle: async () => {
          state.reads.push(filters); state.afterRead?.();
          const result = state.rows.find(value => Object.entries(filters).every(([key, wanted]) => key === 'table' || value[key as keyof LiveLearningBatch] === wanted)) ?? null;
          return { data: state.alterRead ? state.alterRead(structuredClone(result)) : structuredClone(result), error: state.readError };
        },
      }; return query;
    },
  } as unknown as Client;
  return { state, repository: createLanguageLiveLearningRepository(client, owner) };
}

test('verified save snapshots caller input and performs exact owner-scoped independent readback', async () => {
  const { state, repository } = fixture(), value = input(); const original = structuredClone(value);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  state.beforeAuth = () => gate;
  const pending = repository.saveLearning(value); value.events[0].item.text = 'changed'; value.requestId = randomUUID();
  release(); const saved = await pending;
  assert.deepEqual(saved.payload, original);
  assert.deepEqual(state.reads, [{ table: 'language_live_learning_batches', user_id: owner, lesson_id: lessonId, lesson_revision: 1, version: 1, request_id: original.requestId }]);
});

test('lost response retries immutable same request, no duplicate batch or success before readback', async () => {
  const { state, repository } = fixture(), value = input(); state.loseResponse = true;
  await assert.rejects(repository.saveLearning(value), hasCode('storage')); assert.equal(state.rows.length, 1); assert.equal(state.reads.length, 0);
  state.loseResponse = false; assert.equal((await repository.saveLearning(value)).version, 1);
  assert.equal(state.rows.length, 1); assert.deepEqual(state.calls[0].args, state.calls[1].args);
});

test('missing, altered, wrong-owner or mismatched receipt/readback fails closed', async () => {
  for (const change of [(value: LiveLearningBatch | null) => value && { ...value, payload_hash: 'different' }, () => null, (value: LiveLearningBatch | null) => value && { ...value, user_id: other }]) {
    const { state, repository } = fixture(); state.alterRead = change;
    await assert.rejects(repository.saveLearning(input()), hasCode('verification'));
  }
  const mismatch = fixture(); mismatch.state.alterReceipt = value => ({ ...value, payload: { ...value.payload, changeReason: 'not sent' } });
  await assert.rejects(mismatch.repository.saveLearning(input()), hasCode('verification')); assert.equal(mismatch.state.reads.length, 0);
});

test('account changes at preflight, RPC, readback or snapshot never expose previous owner data', async () => {
  for (const phase of ['preflight', 'rpc', 'response', 'read']) {
    const { state, repository } = fixture();
    if (phase === 'preflight') state.owner = other;
    if (phase === 'rpc') state.beforeRpc = () => { state.owner = other; };
    if (phase === 'response') state.afterRpc = () => { state.owner = other; };
    if (phase === 'read') state.afterRead = () => { state.owner = other; };
    await assert.rejects(repository.saveLearning(input()), hasCode('account_changed'));
  }
  const snapshot = fixture(); snapshot.state.afterRpc = () => { snapshot.state.owner = other; };
  await assert.rejects(snapshot.repository.readLearning(), hasCode('account_changed'));
});

test('schema/unavailable/oversized snapshot errors are visible and never an empty progress state', async () => {
  for (const error of [{ code: '42P01' }, { message: 'LIVE_LIMIT learning snapshot' }, { message: 'synthetic network failure' }]) {
    const { state, repository } = fixture(); state.error = error;
    await assert.rejects(repository.readLearning(), hasCode('code' in error ? 'schema_unavailable' : 'storage'));
  }
  const missing = fixture(); missing.state.readError = { message: 'synthetic unavailable' };
  await assert.rejects(missing.repository.saveLearning(input()), hasCode('verification'));
});

test('post-commit readback errors never authorize editing an uncertain request', async () => {
  for (const error of [{ code: '42P01' }, { code: '23505' }, { code: '23514' }, { message: 'synthetic offline readback' }]) {
    const { state, repository } = fixture(), value = input(); state.readError = error;
    await assert.rejects(repository.saveLearning(value), hasCode('verification'));
    assert.equal(state.rows.length, 1, 'RPC committed before independent readback failed');
    state.readError = null;
    const saved = await repository.saveLearning(value);
    assert.equal(saved.version, 1); assert.equal(state.rows.length, 1);
    assert.deepEqual(state.calls[0].args, state.calls[1].args);
  }
});

test('snapshot validation rejects mixed-owner, duplicate heads, missing versions and unexpected future source', () => {
  const batch = row(input()); const base: LiveLearningSnapshot = { ownerId: owner, lessons: [lesson()], batches: [batch] };
  assert.deepEqual(decodeLiveLearningSnapshot(base, owner), base);
  for (const malformed of [
    { ...base, ownerId: other }, { ...base, lessons: [{ ...lesson(), user_id: other }] },
    { ...base, lessons: [lesson(), lesson()] }, { ...base, batches: [batch, batch] },
    { ...base, batches: [row({ ...input(), expectedVersion: 1 })] },
    { ...base, batches: [row({ ...input(), lessonRevision: 2 })] }, { ...base, batches: [{ ...batch, user_id: other }] },
  ]) assert.throws(() => decodeLiveLearningSnapshot(malformed, owner), hasCode('verification'));
});

test('malformed or unconfirmed learning input never reaches storage', async () => {
  for (const value of [{ ...input(), confirmed: false }, { ...input(), expectedVersion: -1 }, { ...input(), events: [event(), event()].map(value => ({ ...value, eventId: itemId })) }]) {
    const { state, repository } = fixture();
    await assert.rejects(repository.saveLearning(value as SaveLiveLearningInput), hasCode('validation')); assert.equal(state.calls.length, 0);
  }
});

test('matching preserves kana script, composed forms, homographs and explicit user identity', () => {
  const known = event().item;
  assert.deepEqual(matchLiveItem({ kind: 'kana', text: 'え', meaning: '' }, [known, known]), [known]);
  assert.deepEqual(matchLiveItem({ kind: 'kana', text: 'エ', meaning: '' }, [known]), []);
  assert.deepEqual(matchLiveItem({ kind: 'kana', text: 'え', meaning: '다른 의미' }, [known]), []);
  assert.notEqual(liveItemIdentityKey({ kind: 'kana', text: 'が', meaning: '' }), liveItemIdentityKey({ kind: 'kana', text: 'か\u3099', meaning: '' }));
  const duplicate = { ...input(), events: [event(), { ...event(), item: { ...known, itemId: randomUUID() } }] };
  assert.ok(validateLiveLearningInput(duplicate).length);
});
