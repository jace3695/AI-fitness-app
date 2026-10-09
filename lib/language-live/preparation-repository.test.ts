import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLanguageLivePreparationRepository, decodeLivePreparationHistory } from '../../app/data/languageLivePreparationRepository.ts';
import { buildLivePreparation } from './preparation.ts';
import { LanguageLiveError } from './types.ts';
import type { LivePreparationRecord, SaveLivePreparationInput } from './preparation-types.ts';

const owner = randomUUID(), other = randomUUID();
const input = (): SaveLivePreparationInput => ({ requestId: randomUUID(), preparationId: randomUUID(), expectedRevision: 0,
  preparation: buildLivePreparation({ ownerId: owner, lessons: [], batches: [] }, '2026-10-10'), editedText: '정확한 사용자 편집문\nえ エ か\u3099', reviewed: true });
const row = (payload: SaveLivePreparationInput): LivePreparationRecord => ({ user_id: owner, preparation_id: payload.preparationId,
  revision: payload.expectedRevision + 1, previous_revision: payload.expectedRevision, request_id: payload.requestId,
  payload: structuredClone(payload), payload_hash: 'synthetic-hash', created_at: '2026-10-09T18:00:00.000Z' });
const hasCode = (code: string) => (error: unknown) => error instanceof LanguageLiveError && error.code === code;
type Client = Parameters<typeof createLanguageLivePreparationRepository>[0];
function fixture() {
  const state = {
    owner: owner as string | null, rows: [] as LivePreparationRecord[], calls: [] as { name: string; args: Record<string, unknown> }[],
    reads: [] as Record<string, unknown>[], error: null as unknown, readError: null as unknown, loseResponse: false,
    beforeAuth: undefined as (() => Promise<void>) | undefined, beforeRpc: undefined as (() => void) | undefined,
    afterRpc: undefined as (() => void) | undefined, afterRead: undefined as (() => void) | undefined,
    alterReceipt: undefined as ((value: LivePreparationRecord) => unknown) | undefined,
    alterRead: undefined as ((value: LivePreparationRecord | null) => unknown) | undefined,
    alterHistory: undefined as ((value: unknown) => unknown) | undefined,
  };
  const client = {
    auth: { getUser: async () => { await state.beforeAuth?.(); return { data: { user: state.owner ? { id: state.owner } : null }, error: null }; } },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.beforeRpc?.(); state.calls.push({ name, args });
      if (args.p_expected_owner !== state.owner) return { data: null, error: { message: 'LIVE_ACCOUNT_CHANGED', code: '42501' } };
      if (state.error) return { data: null, error: state.error };
      if (name === 'read_language_live_preparations') {
        state.afterRpc?.(); const history = { ownerId: owner, count: state.rows.length, records: structuredClone(state.rows) };
        return { data: state.alterHistory ? state.alterHistory(history) : history, error: null };
      }
      const payload = args.p_payload as SaveLivePreparationInput;
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
          const result = state.rows.find(value => Object.entries(filters).every(([key, wanted]) => key === 'table' || value[key as keyof LivePreparationRecord] === wanted)) ?? null;
          return { data: state.alterRead ? state.alterRead(structuredClone(result)) : structuredClone(result), error: state.readError };
        },
      }; return query;
    },
  } as unknown as Client;
  return { state, repository: createLanguageLivePreparationRepository(client, owner) };
}

test('preparation save snapshots nested caller input and verifies exact independent owner-scoped GET', async () => {
  const { state, repository } = fixture(), value = input(), original = structuredClone(value);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); state.beforeAuth = () => gate;
  const pending = repository.savePreparation(value); value.editedText = 'changed'; value.preparation.generatedText = 'changed'; value.requestId = randomUUID();
  release(); const saved = await pending;
  assert.deepEqual(saved.payload, original);
  assert.deepEqual(state.reads, [{ table: 'language_live_preparations', user_id: owner, preparation_id: original.preparationId, revision: 1, request_id: original.requestId }]);
});

test('lost save response preserves immutable idempotent request, original text and one record', async () => {
  const { state, repository } = fixture(), value = input(); state.loseResponse = true;
  await assert.rejects(repository.savePreparation(value), hasCode('storage')); assert.equal(state.rows.length, 1); assert.equal(state.reads.length, 0);
  state.loseResponse = false; assert.equal((await repository.savePreparation(value)).revision, 1);
  assert.equal(state.rows.length, 1); assert.deepEqual(state.calls[0].args, state.calls[1].args);
});

test('missing, changed, foreign-owner and wrong receipt/readback fail closed', async () => {
  for (const change of [(value: LivePreparationRecord | null) => value && { ...value, payload_hash: 'different' }, () => null,
    (value: LivePreparationRecord | null) => value && { ...value, user_id: other },
    (value: LivePreparationRecord | null) => value && { ...value, payload: { ...value.payload, editedText: 'different' } }]) {
    const { state, repository } = fixture(); state.alterRead = change;
    await assert.rejects(repository.savePreparation(input()), hasCode('verification'));
  }
  const mismatch = fixture(); mismatch.state.alterReceipt = value => ({ ...value, payload: { ...value.payload, editedText: 'not sent' } });
  await assert.rejects(mismatch.repository.savePreparation(input()), hasCode('verification')); assert.equal(mismatch.state.reads.length, 0);
});

test('every post-commit readback error leaves same request recoverable without duplicates', async () => {
  for (const error of [{ code: '42P01' }, { code: '23505' }, { code: '23514' }, { message: 'offline readback' }]) {
    const { state, repository } = fixture(), value = input(); state.readError = error;
    await assert.rejects(repository.savePreparation(value), hasCode('verification')); assert.equal(state.rows.length, 1);
    state.readError = null; await repository.savePreparation(value);
    assert.equal(state.rows.length, 1); assert.deepEqual(state.calls[0].args, state.calls[1].args);
  }
});

test('preparation account changes at every async boundary reject old owner results', async () => {
  for (const phase of ['preflight', 'rpc', 'response', 'read']) {
    const { state, repository } = fixture();
    if (phase === 'preflight') state.owner = other;
    if (phase === 'rpc') state.beforeRpc = () => { state.owner = other; };
    if (phase === 'response') state.afterRpc = () => { state.owner = other; };
    if (phase === 'read') state.afterRead = () => { state.owner = other; };
    await assert.rejects(repository.savePreparation(input()), hasCode('account_changed'));
  }
  const history = fixture(); history.state.afterRpc = () => { history.state.owner = other; };
  await assert.rejects(history.repository.listPreparations(), hasCode('account_changed'));
  const foreign = fixture(), foreignInput = input(); foreignInput.preparation.source.ownerId = other;
  await assert.rejects(foreign.repository.savePreparation(foreignInput), hasCode('verification')); assert.equal(foreign.state.calls.length, 0);
});

test('list returns full history including previous text, rejects partial counts or gaps', async () => {
  const { state, repository } = fixture(), first = input();
  await repository.savePreparation(first);
  await repository.savePreparation({ ...first, requestId: randomUUID(), expectedRevision: 1, editedText: '수정한 새 준비문' });
  assert.deepEqual(await repository.listPreparations(), state.rows);
  assert.equal(state.rows[0].payload.editedText, first.editedText);
  for (const malformed of [null, [], { ownerId: other, count: 2, records: state.rows },
    { ownerId: owner, count: 3, records: state.rows }, { ownerId: owner, count: 1, records: [state.rows[1]] },
    { ownerId: owner, count: 2, records: [state.rows[0], state.rows[0]] },
    { ownerId: owner, count: 1001, records: Array(1001).fill(state.rows[0]) }]) {
    assert.throws(() => decodeLivePreparationHistory(malformed, owner), hasCode('verification'));
  }
});

test('malformed/unreviewed input never reaches storage; stale source/schema/overflow are visible', async () => {
  for (const value of [{ ...input(), reviewed: false }, { ...input(), expectedRevision: -1 }, { ...input(), extra: true }]) {
    const { state, repository } = fixture(); await assert.rejects(repository.savePreparation(value as SaveLivePreparationInput), hasCode('validation')); assert.equal(state.calls.length, 0);
  }
  for (const [error, code] of [[{ message: 'LIVE_CONFLICT preparation source' }, 'conflict'], [{ code: '42P01' }, 'schema_unavailable'],
    [{ message: 'LIVE_LIMIT preparation history' }, 'storage'], [{ message: 'offline' }, 'storage']] as const) {
    const { state, repository } = fixture(); state.error = error;
    await assert.rejects(repository.listPreparations(), hasCode(code));
    await assert.rejects(repository.savePreparation(input()), hasCode(code));
  }
});
