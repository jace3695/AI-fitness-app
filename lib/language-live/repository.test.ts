import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLanguageLiveRepository } from '../../app/data/languageLiveRepository.ts';
import { parseLiveReport } from './report-parser.ts';
import { LanguageLiveError, type LiveLesson, type SaveLiveLessonInput } from './types.ts';

type Client = Parameters<typeof createLanguageLiveRepository>[0];
const owner = randomUUID(), other = randomUUID();
const input = (): SaveLiveLessonInput => ({ lessonId: randomUUID(), requestId: randomUUID(), expectedRevision: 0, report: parseLiveReport('학습 날짜: 2026-10-09\n수업 주제: 合成 테스트') });
const row = (value: SaveLiveLessonInput, revision = 1): LiveLesson => ({ user_id: owner, lesson_id: value.lessonId, request_id: value.requestId, revision, previous_revision: revision - 1, operation: revision === 1 ? 'create' : 'edit', report: value.report, created_at: '2026-10-09T16:00:00.000Z', payload_hash: 'synthetic-receipt', restored_from_revision: null, duplicate_reason: null });

type Result = { data: unknown; error: unknown };
function fixture() {
  const state = {
    authOwner: owner as string | null, rows: [] as LiveLesson[], rpcCalls: [] as Record<string, unknown>[], reads: [] as { table: string; filters: Record<string, unknown> }[],
    readError: null as unknown, rpcError: null as unknown, loseResponse: false,
    beforeRpc: undefined as (() => void) | undefined, afterRpc: undefined as (() => void) | undefined,
    transformRead: undefined as ((rows: LiveLesson[], table: string) => LiveLesson[]) | undefined,
    beforeAuth: undefined as (() => Promise<void>) | undefined,
  };
  const client = {
    auth: { getUser: async () => { await state.beforeAuth?.(); return { data: { user: state.authOwner ? { id: state.authOwner } : null }, error: null }; } },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let first = 0, last = Number.MAX_SAFE_INTEGER, single = false;
      let sortKey = 'revision', ascending = true;
      const run = async (): Promise<Result> => {
        state.reads.push({ table, filters: { ...filters } });
        if (state.readError) return { data: null, error: state.readError };
        let rows = [...state.rows];
        if (table === 'language_live_current_lessons') rows = rows.filter(item => !rows.some(candidate => candidate.user_id === item.user_id && candidate.lesson_id === item.lesson_id && candidate.revision > item.revision));
        rows = rows.filter(item => Object.entries(filters).every(([key, value]) => key.startsWith('neq:') ? item[key.slice(4) as keyof LiveLesson] !== value : key.startsWith('lte:') ? Number(item[key.slice(4) as keyof LiveLesson]) <= Number(value) : item[key as keyof LiveLesson] === value));
        rows.sort((a,b) => (String(a[sortKey as keyof LiveLesson]).localeCompare(String(b[sortKey as keyof LiveLesson]), 'en', { numeric: true })) * (ascending ? 1 : -1));
        rows = rows.slice(first, last + 1);
        rows = state.transformRead?.(rows, table) ?? rows;
        return { data: single ? rows[0] ?? null : rows, error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        neq: (key: string, value: unknown) => { filters[`neq:${key}`] = value; return query; },
        lte: (key: string, value: unknown) => { filters[`lte:${key}`] = value; return query; },
        order: (key: string, options?: { ascending?: boolean }) => { sortKey = key; ascending = options?.ascending ?? true; return query; },
        range: (start: number, end: number) => { first = start; last = end; return query; },
        maybeSingle: () => { single = true; return run(); },
        then: (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) => run().then(resolve, reject),
      };
      return query;
    },
    rpc: async (_name: string, args: Record<string, unknown>): Promise<Result> => {
      state.beforeRpc?.(); state.rpcCalls.push(args);
      if (state.authOwner !== args.p_expected_owner) return { data: null, error: { code: '42501', message: 'LIVE_ACCOUNT_CHANGED' } };
      if (state.rpcError) return { data: null, error: state.rpcError };
      let receipt = state.rows.find(item => item.user_id === state.authOwner && item.request_id === args.p_request_id);
      if (!receipt) {
        const value = { lessonId: args.p_lesson_id, requestId: args.p_request_id, expectedRevision: args.p_expected_revision, report: args.p_report } as SaveLiveLessonInput;
        receipt = row(value, value.expectedRevision + 1);
        state.rows.push(receipt);
      }
      state.afterRpc?.();
      return state.loseResponse ? { data: null, error: { message: 'synthetic lost response' } } : { data: structuredClone(receipt), error: null };
    },
  } as unknown as Client;
  return { state, repository: createLanguageLiveRepository(client, owner) };
}
const hasCode = (code: string) => (error: unknown) => error instanceof LanguageLiveError && error.code === code;

test('repository confirms exact immutable revision with owner-scoped GET before success', async () => {
  const { state, repository } = fixture(); const value = input();
  const saved = await repository.saveLesson(value);
  assert.equal(saved.request_id, value.requestId);
  assert.equal(state.rpcCalls[0].p_expected_owner, owner);
  assert.deepEqual(state.reads[0], { table: 'language_live_lessons', filters: { user_id: owner, lesson_id: value.lessonId, revision: 1, request_id: value.requestId } });
});

test('lost RPC response retry uses the same request and never creates a second revision', async () => {
  const { state, repository } = fixture(); const value = input(); state.loseResponse = true;
  await assert.rejects(repository.saveLesson(value), hasCode('storage'));
  assert.equal(state.rows.length, 1);
  state.loseResponse = false;
  assert.equal((await repository.saveLesson(value)).revision, 1);
  assert.equal(state.rows.length, 1);
  assert.equal(state.rpcCalls[0].p_request_id, state.rpcCalls[1].p_request_id);
});

test('missing or changed read-back cannot be reported as saved', async () => {
  for (const mismatch of [() => [], (rows: LiveLesson[]) => rows.map(item => ({ ...item, payload_hash: 'wrong-hash' }))]) {
    const { state, repository } = fixture(); state.transformRead = mismatch;
    await assert.rejects(repository.saveLesson(input()), hasCode('verification'));
  }
});

test('account changes before preflight, before RPC, and after RPC cannot leak or misdirect results', async () => {
  const early = fixture(); early.state.authOwner = other;
  await assert.rejects(early.repository.saveLesson(input()), hasCode('account_changed')); assert.equal(early.state.rpcCalls.length, 0);
  const pending = fixture(); pending.state.beforeRpc = () => { pending.state.authOwner = other; };
  await assert.rejects(pending.repository.saveLesson(input()), hasCode('account_changed')); assert.equal(pending.state.rows.length, 0);
  const late = fixture(); late.state.afterRpc = () => { late.state.authOwner = other; };
  await assert.rejects(late.repository.saveLesson(input()), hasCode('account_changed')); assert.equal(late.state.reads.length, 0);
});

test('pending draft is snapshotted before awaits and malformed input makes no RPC', async () => {
  const { state, repository } = fixture(); const value = input();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  state.beforeAuth = () => gate;
  const pending = repository.saveLesson(value);
  value.report.fields.topic.text = 'mutated while saving'; value.requestId = randomUUID();
  release(); const saved = await pending;
  assert.equal(saved.report.fields.topic.text, '合成 테스트');
  assert.notEqual(saved.request_id, value.requestId);
  const invalid = fixture();
  await assert.rejects(invalid.repository.saveLesson({ ...input(), expectedRevision: -1 }), hasCode('validation'));
  assert.equal(invalid.state.rpcCalls.length, 0);
});

test('history reads all pages with a consistent revision ceiling and rejects gaps', async () => {
  const { state, repository } = fixture(); const value = input();
  state.rows = Array.from({ length: 203 }, (_, index) => row({ ...value, requestId: randomUUID() }, index + 1));
  const history = await repository.getHistory(value.lessonId);
  assert.equal(history.length, 203); assert.equal(history[0].revision, 203); assert.equal(history.at(-1)?.revision, 1);
  assert.equal(state.reads.filter(read => read.table === 'language_live_lessons').length, 3);
  state.rows = state.rows.filter(item => item.revision !== 77);
  await assert.rejects(repository.getHistory(value.lessonId), hasCode('verification'));
});

test('schema failures and unexpected owner rows are never treated as empty history', async () => {
  const missing = fixture(); missing.state.readError = { code: '42P01', message: 'missing table' };
  await assert.rejects(missing.repository.listLessons(), hasCode('schema_unavailable'));
  const crossed = fixture(); crossed.state.rows = [row(input())];
  crossed.state.transformRead = rows => rows.map(item => ({ ...item, user_id: other }));
  await assert.rejects(crossed.repository.listLessons(), hasCode('verification'));
});

test('an unchecked separate-lesson option never transmits a stale duplicate reason', async () => {
  const { state, repository } = fixture();
  await repository.saveLesson({ ...input(), allowDuplicate: false, duplicateReason: 'previously typed reason' });
  assert.equal(state.rpcCalls[0].p_allow_duplicate, false);
  assert.equal(state.rpcCalls[0].p_duplicate_reason, null);
});
