import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import type { GrowthSessionRow } from '../app/data/growthPlatform.ts';
import { confirmSentenceTypingSave, emptySentenceTypingDraft, makeSentenceTypingSession } from '../lib/sentence-typing-draft.ts';
import { emptyTypingBasicsDraft, makeTypingBasicsSession } from '../lib/typing-basics-draft.ts';
import { confirmTypingSave } from '../lib/typing-session-recovery.ts';

const owner = '00000000-0000-4000-8000-000000000001';
const routine = '00000000-0000-4000-8000-000000000003';

// Real installed Supabase/PostgREST transport with an in-memory fetch boundary.
// No server/browser is started. Keep the SDK's normal 503 retry/backoff behavior:
// one repository read produces four same-ID HTTP attempts with retry headers.
for (const kind of ['sentence', 'basics'] as const) for (const committed of [true, false]) test(`uncertain ${kind} read retries only its same-ID GET; committed=${committed}`, async () => {
  const startedAt = Date.parse('2026-10-09T10:00:00Z');
  const basics = emptyTypingBasicsDraft(owner, null);
  const session = kind === 'sentence'
    ? makeSentenceTypingSession({ ...emptySentenceTypingDraft(owner, null), typed: 'xx', startedAt },
      { id: routine, target_minutes: 15 }, randomUUID(), '2026-10-09', startedAt + 1000)
    : makeTypingBasicsSession({ ...basics, startedAt, endedAt: startedAt + 1000, checks: [true, true],
      attempt: { attempts: basics.lesson.keys.length + 1, position: basics.lesson.keys.length, mistakes: { f: 1 } } }, routine, randomUUID(), '2026-10-09');
  const confirm = kind === 'sentence' ? confirmSentenceTypingSave : confirmTypingSave;
  const payload = { id: session.id, user_id: owner, routine_id: routine, session_date: session.sessionDate, status: session.status,
    planned_minutes: session.plannedMinutes, actual_minutes: session.actualMinutes, memo: session.memo, source: session.source,
    metrics: session.metrics, started_at: session.startedAt, ended_at: session.endedAt, updated_at: session.endedAt };
  const saved = { ...payload, created_at: session.endedAt } as GrowthSessionRow;
  let row = committed ? saved : null, failReads = true, logicalReads = 0, logicalWrites = 0;
  const attempts: { method: string; path: string; query: string; retry: string | null }[] = [];
  const client = createClient('https://sentence-transport.invalid', 'synthetic-public-fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), method = init?.method ?? 'GET';
      attempts.push({ method, path: url.pathname, query: url.search, retry: new Headers(init?.headers).get('x-retry-count') });
      if (method === 'GET') {
        assert.equal(url.pathname, '/rest/v1/growth_sessions');
        assert.equal(url.searchParams.get('id'), `eq.${session.id}`);
        assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
        return new Response(JSON.stringify(failReads ? { message: 'synthetic unavailable confirmation' } : row ? [row] : []),
          { status: failReads ? 503 : 200, headers: { 'Content-Type': 'application/json' } });
      }
      assert.equal(method, 'POST'); assert.equal(url.pathname, '/rest/v1/rpc/save_sentence_typing_session');
      assert.deepEqual(JSON.parse(String(init?.body)), { p_expected_owner: owner, p_expected_reset_marker: null, p_payload: payload });
      row = saved;
      return new Response(null, { status: 204 });
    } },
  });
  const boundary = {
    assertOwner: async () => {},
    read: async () => {
      logicalReads++;
      return client.from('growth_sessions').select('*').eq('user_id', owner).eq('id', session.id).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
    },
    insert: async () => {
      logicalWrites++;
      return client.rpc('save_sentence_typing_session', { p_expected_owner: owner, p_expected_reset_marker: null, p_payload: payload });
    },
  };
  await assert.rejects(confirm(owner, session, true, boundary), /typing_save_unconfirmed/);
  assert.equal(logicalReads, 1); assert.equal(logicalWrites, 0);
  assert.deepEqual(attempts.map(attempt => [attempt.method, attempt.retry]), [['GET', null], ['GET', '1'], ['GET', '2'], ['GET', '3']]);
  assert.equal(new Set(attempts.map(attempt => attempt.path + attempt.query)).size, 1);
  const mark = attempts.length;
  failReads = false;
  assert.deepEqual(await confirm(owner, session, true, boundary), saved);
  assert.deepEqual(attempts.slice(mark).map(attempt => [attempt.method, attempt.retry]), committed
    ? [['GET', null]] : [['GET', null], ['POST', null], ['GET', null]]);
  assert.equal(logicalWrites, committed ? 0 : 1);
});
