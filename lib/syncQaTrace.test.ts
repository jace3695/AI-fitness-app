import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createSyncQaTrace, isSyncQaAllowed } from './syncQaTrace.ts';
import { auditSyncQa } from '../scripts/sync-qa/audit.mjs';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const original = { records: { original: { memo: 'synthetic-original' } }, settings: { count: 7 } };
const owner = '11111111-1111-4111-8111-111111111111';
type State = typeof original & { extra?: number };
async function lab(t: TestContext) {
  let row = { state: structuredClone(original) as State, updated_at: '2030-01-01T00:00:00.000Z' };
  const wire: { method: string; body: unknown; expected: string | null }[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    assert.equal(url.pathname, '/rest/v1/user_app_state');
    assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const expected = url.searchParams.get('updated_at');
    wire.push({ method: req.method!, body, expected });
    let response: unknown;
    if (req.method === 'GET') response = [row];
    else if (expected === `eq.${row.updated_at}`) { row = body; response = [{ updated_at: row.updated_at }]; }
    else response = [];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(response));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  function device(client: string) {
    const trace = createSyncQaTrace({ origin, client, send: fetch, holdMs: 2000 });
    const sdk = createClient(origin, 'synthetic-publishable-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: trace.fetch } });
    return { trace,
      read: async () => sdk.from('user_app_state').select('state, updated_at').eq('user_id', owner).maybeSingle(),
      write: async (state: State, expected: string, version: string) => sdk.from('user_app_state').update({ state, updated_at: version }).eq('user_id', owner).eq('updated_at', expected).select('updated_at').maybeSingle(),
    };
  }
  return { device, wire, row: () => row };
}
function waitForPhase(trace: ReturnType<typeof createSyncQaTrace>, phase: string) {
  if (trace.snapshot().entries.some(entry => entry.phase === phase)) return Promise.resolve();
  return new Promise<void>(resolve => { const off = trace.subscribe(() => { if (trace.snapshot().entries.some(entry => entry.phase === phase)) { off(); resolve(); } }); });
}

test('QA requires explicit opt-in, a loopback host and development mode', () => {
  assert.equal(isSyncQaAllowed('development', '127.0.0.1', true), true);
  assert.equal(isSyncQaAllowed('development', 'localhost', false), false);
  for (const mode of ['production', 'test', undefined]) assert.equal(isSyncQaAllowed(mode, 'localhost', true), false);
  for (const host of ['ai-fitness-app-ten.vercel.app', 'preview.vercel.app', 'localhost.evil.test']) assert.equal(isSyncQaAllowed('development', host, true), false);
});

test('real SDK GET/PATCH bodies, CAS rejection and confirmation GET are captured', async t => {
  const fixture = await lab(t); const a = fixture.device('A'); const b = fixture.device('B');
  const before = await a.read(); assert.equal(before.error, null);
  const next = { ...original, extra: 3 };
  const saved = await a.write(next, before.data!.updated_at, '2030-01-02T00:00:00.000Z'); assert.equal(saved.error, null); assert.ok(saved.data);
  await a.read();
  const stale = await b.write(original, before.data!.updated_at, '2030-01-03T00:00:00.000Z'); assert.equal(stale.error, null); assert.equal(stale.data, null);
  assert.deepEqual(fixture.row().state, next);
  assert.deepEqual(fixture.wire.map(item => item.method), ['GET', 'PATCH', 'GET', 'PATCH']);
  assert.deepEqual(a.trace.snapshot().entries[1].requestBody, fixture.wire[1].body);
  assert.equal(auditSyncQa(JSON.parse(a.trace.exportJson())).writes[0].outcome, 'confirmation-matches');
  assert.equal(auditSyncQa(JSON.parse(b.trace.exportJson())).writes[0].outcome, 'cas-rejected');
  assert.ok(!a.trace.exportJson().includes(owner)); assert.ok(!a.trace.exportJson().includes('synthetic-publishable-key'));
});

test('holding actual SDK GET response allows a second client to win CAS before release', async t => {
  const fixture = await lab(t); const a = fixture.device('A'); const b = fixture.device('B');
  a.trace.arm('GET', 'hold-response'); const reading = a.read(); await waitForPhase(a.trace, 'held-after-response');
  const bBefore = await b.read(); await b.write({ ...original, extra: 9 }, bBefore.data!.updated_at, '2030-01-02T00:00:00.000Z');
  a.trace.release(); const stale = await reading;
  const rejected = await a.write(original, stale.data!.updated_at, '2030-01-03T00:00:00.000Z');
  assert.equal(rejected.data, null); assert.equal(fixture.row().state.extra, 9);
  assert.equal(a.trace.snapshot().entries[0].phase, 'delivered');
});

test('request hold sends nothing until release; post-response withholding records server commit separately', async t => {
  const fixture = await lab(t); const a = fixture.device('A'); const before = await a.read();
  a.trace.arm('PATCH', 'hold-request'); const saving = a.write({ ...original, extra: 2 }, before.data!.updated_at, '2030-01-02T00:00:00.000Z');
  await waitForPhase(a.trace, 'held-before-send'); assert.equal(fixture.wire.length, 1);
  assert.throws(() => a.trace.clear()); a.trace.release(); await saving;
  a.trace.arm('PATCH', 'drop-response');
  const lost = await a.write({ ...original, extra: 4 }, fixture.row().updated_at, '2030-01-03T00:00:00.000Z');
  assert.ok(lost.error); assert.equal(fixture.row().state.extra, 4);
  const dropped = a.trace.snapshot().entries.at(-1)!;
  assert.equal(dropped.phase, 'response-withheld'); assert.equal(dropped.response?.status, 200); assert.equal(dropped.deliveredAt, undefined);
  assert.equal(auditSyncQa(JSON.parse(a.trace.exportJson())).writes.at(-1)!.outcome, 'response-not-delivered');
});

test('GET error simulation is distinguished from real HTTP and does not send a request', async t => {
  const fixture = await lab(t); const a = fixture.device('A');
  a.trace.arm('GET', 'fail-get'); const failed = await a.read();
  assert.ok(failed.error); assert.equal(fixture.wire.length, 0);
  assert.equal(a.trace.snapshot().entries[0].response?.synthetic, true);
  assert.ok(a.trace.snapshot().entries.length > 1, 'SDK retries must also be captured'); a.trace.release();
  const recovered = await a.read(); assert.equal(recovered.error, null); assert.deepEqual(recovered.data!.state, original);
});

test('auth, unrelated tables and different origins bypass capture and fault controls', async () => {
  const calls: unknown[] = []; const trace = createSyncQaTrace({ origin: 'https://fixture.invalid', client: 'A', send: async (input, init) => { calls.push({ input, init }); return new Response('{}'); } });
  trace.arm('GET', 'hold-response');
  for (const url of ['https://fixture.invalid/auth/v1/token', 'https://fixture.invalid/rest/v1/profiles', 'https://other.invalid/rest/v1/user_app_state']) {
    await trace.fetch(url, { headers: { Authorization: 'Bearer secret' } });
  }
  assert.equal(calls.length, 3); assert.equal(trace.snapshot().entries.length, 0); assert.ok(trace.snapshot().rule); trace.release();
});

test('Request bodies are cloned, sensitive fields omitted, abort cancels a held request', async () => {
  const sent = deferred(); const aborter = new AbortController();
  const trace = createSyncQaTrace({ origin: 'https://fixture.invalid', client: 'A', send: async input => { assert.equal(await (input as Request).text(), '{"user_id":"owner","state":{"n":1}}'); sent.resolve(); return new Response('{}'); } });
  await trace.fetch(new Request('https://fixture.invalid/rest/v1/user_app_state', { method: 'PATCH', body: '{"user_id":"owner","state":{"n":1}}' }));
  await sent.promise; assert.deepEqual(trace.snapshot().entries[0].requestBody, { user_id: '[redacted]', state: { n: 1 } });
  trace.arm('PATCH', 'hold-request'); const pending = trace.fetch('https://fixture.invalid/rest/v1/user_app_state', { method: 'PATCH', signal: aborter.signal });
  await waitForPhase(trace, 'held-before-send'); aborter.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(trace.snapshot().held.length, 0); trace.stop(); assert.equal(trace.snapshot().entries.length, 0);
});

test('capture overflow is explicit and missing or differing confirmation is never a pass', async () => {
  const trace = createSyncQaTrace({ origin: 'https://fixture.invalid', client: 'A', maxEntries: 1, send: async () => new Response('{}') });
  await trace.fetch('https://fixture.invalid/rest/v1/user_app_state'); await trace.fetch('https://fixture.invalid/rest/v1/user_app_state');
  assert.equal(auditSyncQa(JSON.parse(trace.exportJson())).completeCapture, false);
  const base = { format: 'yeoni-sync-qa-v1', overflow: false, inFlight: 0, held: [], entries: [{ id: 1, client: 'A', method: 'PATCH', requestBody: { state: original }, response: { status: 200, body: { updated_at: '1' } }, deliveredAt: '1', phase: 'delivered' }] };
  assert.equal(auditSyncQa(base).writes[0].outcome, 'confirmation-missing');
  const different = { ...base, entries: [...base.entries, { id: 2, client: 'A', method: 'GET', sentAt: '2', response: { status: 200, body: [{ state: {} }] }, phase: 'delivered' }] };
  assert.equal(auditSyncQa(different).writes[0].outcome, 'confirmation-differs');
});
