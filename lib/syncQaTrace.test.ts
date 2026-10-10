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
const rpcPath = '/rest/v1/rpc/save_cloud_state_if_unchanged';
async function lab(t: TestContext, absent = false) {
  let row: { state: State; updated_at: string } | null = absent ? null : { state: structuredClone(original), updated_at: '2030-01-01T00:00:00.000Z' };
  let version = 0;
  const wire: { method: string; path: string; body: unknown; expected: string | null }[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    const rpc = url.pathname === rpcPath;
    assert.ok(rpc || url.pathname === '/rest/v1/user_app_state');
    if (!rpc) assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const expected = url.searchParams.get('updated_at');
    wire.push({ method: req.method!, path: url.pathname, body, expected });
    let response: unknown;
    if (rpc) {
      assert.equal(req.method, 'POST'); assert.equal(body.p_owner, owner);
      const matched = body.p_expected_updated_at === null && body.p_expected_state === null ? row === null
        : row !== null && body.p_expected_updated_at === row.updated_at && JSON.stringify(body.p_expected_state) === JSON.stringify(row.state);
      if (matched) row = { state: body.p_state, updated_at: `2030-02-01T00:00:${String(++version).padStart(2, '0')}.000Z` };
      response = matched;
    } else if (req.method === 'GET') response = row ? [row] : [];
    else if (row && expected === `eq.${row.updated_at}`) { row = body; response = [{ updated_at: row!.updated_at }]; }
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
      saveRpc: async (state: State, expected: { state: State; updated_at: string } | null, signal?: AbortSignal) => {
        const query = sdk.rpc('save_cloud_state_if_unchanged', { p_owner: owner, p_state: state,
          p_expected_state: expected?.state ?? null, p_expected_updated_at: expected?.updated_at ?? null });
        return signal ? query.abortSignal(signal) : query;
      },
    };
  }
  return { device, wire, row: () => row! };
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

test('real legacy SDK GET/PATCH traffic retains CAS and readback metadata without exporting content', async t => {
  const fixture = await lab(t); const a = fixture.device('A'); const b = fixture.device('B');
  const before = await a.read(); assert.equal(before.error, null);
  const next = { ...original, extra: 3 };
  const saved = await a.write(next, before.data!.updated_at, '2030-01-02T00:00:00.000Z'); assert.equal(saved.error, null); assert.ok(saved.data);
  await a.read();
  const stale = await b.write(original, before.data!.updated_at, '2030-01-03T00:00:00.000Z'); assert.equal(stale.error, null); assert.equal(stale.data, null);
  assert.deepEqual(fixture.row().state, next);
  assert.deepEqual(fixture.wire.map(item => item.method), ['GET', 'PATCH', 'GET', 'PATCH']);
  assert.deepEqual(a.trace.snapshot().entries[1].request, { stateKeys: 3, condition: 'owner-timestamp' });
  assert.equal(auditSyncQa(JSON.parse(a.trace.exportJson())).writes[0].outcome, 'confirmation-unverified');
  assert.equal(auditSyncQa(JSON.parse(b.trace.exportJson())).writes[0].outcome, 'cas-rejected');
  assert.ok(!a.trace.exportJson().includes(owner)); assert.ok(!a.trace.exportJson().includes('synthetic-publishable-key'));
  assert.ok(!a.trace.exportJson().includes('synthetic-original')); assert.ok(!a.trace.exportJson().includes('records'));
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
  for (const url of ['https://fixture.invalid/auth/v1/token', 'https://fixture.invalid/rest/v1/profiles', 'https://other.invalid/rest/v1/user_app_state',
    'https://fixture.invalid/rest/v1/rpc/unrelated', 'https://fixture.invalid/rest/v1/rpc/save_cloud_state_if_unchanged']) {
    await trace.fetch(url, { headers: { Authorization: 'Bearer secret' } });
  }
  assert.equal(calls.length, 5); assert.equal(trace.snapshot().entries.length, 0); assert.ok(trace.snapshot().rule); trace.release();
});

test('Request bodies are cloned, sensitive fields omitted, abort cancels a held request', async () => {
  const sent = deferred(); const aborter = new AbortController();
  const trace = createSyncQaTrace({ origin: 'https://fixture.invalid', client: 'A', send: async input => { assert.equal(await (input as Request).text(), '{"user_id":"owner","state":{"n":1}}'); sent.resolve(); return new Response('{}'); } });
  await trace.fetch(new Request('https://fixture.invalid/rest/v1/user_app_state', { method: 'PATCH', body: '{"user_id":"owner","state":{"n":1}}' }));
  await sent.promise; assert.deepEqual(trace.snapshot().entries[0].request, { stateKeys: 1, condition: 'incomplete' });
  assert.ok(!trace.exportJson().includes('"owner"')); assert.ok(!trace.exportJson().includes('"n"'));
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

test('real SDK conditional RPC preserves its exact payload while diagnostics omit every state value', async t => {
  const fixture = await lab(t); const a = fixture.device('A'); const before = await a.read();
  const next = { ...original, extra: 27 };
  const saved = await a.saveRpc(next, before.data); assert.equal(saved.error, null); assert.equal(saved.data, true);
  const readback = await a.read(); assert.deepEqual(readback.data!.state, next);
  const rejected = await a.saveRpc(original, before.data); assert.equal(rejected.error, null); assert.equal(rejected.data, false);
  assert.deepEqual(fixture.row().state, next);
  assert.deepEqual(fixture.wire.map(item => [item.method, item.path]), [
    ['GET', '/rest/v1/user_app_state'], ['POST', rpcPath], ['GET', '/rest/v1/user_app_state'], ['POST', rpcPath],
  ]);
  assert.deepEqual(fixture.wire[1].body, { p_owner: owner, p_state: next, p_expected_state: original, p_expected_updated_at: before.data!.updated_at });
  const write = a.trace.snapshot().entries[1];
  assert.equal(write.operation, 'conditional-save');
  assert.deepEqual(write.request, { stateKeys: 3, expectedStateKeys: 2, condition: 'owner-content-version' });
  assert.deepEqual(write.response, { status: 200, matched: true });
  assert.deepEqual(a.trace.snapshot().entries[3].response, { status: 200, matched: false });
  const exported = a.trace.exportJson();
  for (const privateValue of [owner, 'synthetic-original', 'synthetic-publishable-key', 'p_state', 'p_expected_state', 'p_owner', 'records', before.data!.updated_at]) {
    assert.ok(!exported.includes(privateValue), `Private fixture marker leaked: ${privateValue}`);
  }
  const audit = auditSyncQa(JSON.parse(exported));
  assert.equal(audit.completeCapture, true); assert.equal(audit.stateComparisonAvailable, false);
  assert.deepEqual(audit.writes.map((item: { outcome: string }) => item.outcome), ['confirmation-unverified', 'cas-rejected']);
});

test('RPC absence precondition and same-timestamp changed content remain distinct metadata', async t => {
  const fixture = await lab(t, true); const a = fixture.device('A');
  assert.equal((await a.read()).data, null);
  assert.equal((await a.saveRpc(original, null)).data, true);
  assert.equal((await a.saveRpc({ ...original, extra: 1 }, null)).data, false);
  const snapshot = structuredClone(fixture.row());
  // A legacy writer can change content without a new timestamp. The RPC must
  // still reject that exact stale state; metadata do not replace this assertion.
  assert.ok((await a.write({ ...original, extra: 4 }, snapshot.updated_at, snapshot.updated_at)).data);
  assert.equal((await a.saveRpc({ ...original, extra: 9 }, snapshot)).data, false);
  assert.deepEqual(fixture.row().state, { ...original, extra: 4 });
  assert.deepEqual(a.trace.snapshot().entries[1].request, { stateKeys: 2, condition: 'owner-absent' });
  assert.equal(a.trace.snapshot().entries.at(-1)!.response!.matched, false);
});

for (const phase of ['hold-request', 'hold-response'] as const) test(`aborting RPC ${phase} releases the pause without claiming delivery or rolling back a commit`, async t => {
  const fixture = await lab(t); const a = fixture.device('A'); const before = await a.read(); const aborter = new AbortController();
  a.trace.arm('POST', phase);
  const saving = a.saveRpc({ ...original, extra: 12 }, before.data, aborter.signal);
  await waitForPhase(a.trace, phase === 'hold-request' ? 'held-before-send' : 'held-after-response');
  assert.equal(fixture.wire.length, phase === 'hold-request' ? 1 : 2);
  aborter.abort(); const result = await saving; assert.ok(result.error);
  const entry = a.trace.snapshot().entries.at(-1)!;
  assert.equal(entry.phase, 'rejected'); assert.equal(entry.error, 'AbortError'); assert.equal(entry.deliveredAt, undefined);
  assert.equal(entry.response?.matched, phase === 'hold-request' ? undefined : true);
  assert.equal(a.trace.snapshot().held.length, 0); assert.equal(a.trace.snapshot().inFlight, 0);
  assert.deepEqual(fixture.row().state, phase === 'hold-request' ? original : { ...original, extra: 12 });
});

test('lost real RPC response plus failed GET retries recover by readback without another write', async t => {
  const fixture = await lab(t); const a = fixture.device('A'); const before = await a.read();
  a.trace.arm('POST', 'drop-response'); const lost = await a.saveRpc({ ...original, extra: 18 }, before.data);
  assert.ok(lost.error); assert.equal(fixture.row().state.extra, 18);
  const lostEntry = a.trace.snapshot().entries.at(-1)!;
  assert.equal(lostEntry.phase, 'response-withheld'); assert.deepEqual(lostEntry.response, { status: 200, matched: true });
  assert.equal(lostEntry.deliveredAt, undefined);
  a.trace.arm('GET', 'fail-get'); assert.ok((await a.read()).error);
  assert.ok(a.trace.snapshot().entries.filter(entry => entry.response?.synthetic).length > 1);
  assert.equal(fixture.wire.length, 2); a.trace.release();
  assert.deepEqual((await a.read()).data!.state, { ...original, extra: 18 });
  assert.equal(fixture.wire.filter(item => item.method === 'POST').length, 1);
  assert.equal(auditSyncQa(JSON.parse(a.trace.exportJson())).writes[0].outcome, 'response-not-delivered');
});

test('RPC diagnostics redact arbitrary request fields and server failures; unrelated POST does not consume the control', async () => {
  const sent: string[] = [];
  const trace = createSyncQaTrace({ origin: 'https://fixture.invalid', client: owner, send: async (input, init) => {
    sent.push(input instanceof Request ? input.url : String(input));
    if (input instanceof Request) assert.ok((await input.text()).includes('private-new-state'));
    else if (init?.body) assert.ok(String(init.body).includes('private-new-state'));
    return new Response(JSON.stringify({ message: 'private-server-message', p_state: 'private-server-state', access_token: 'private-server-token' }), { status: 409 });
  } });
  trace.arm('POST', 'hold-request');
  await trace.fetch('https://fixture.invalid/rest/v1/rpc/other_rpc', { method: 'POST' });
  await trace.fetch(`https://other.invalid${rpcPath}`, { method: 'POST' });
  assert.equal(trace.snapshot().entries.length, 0); assert.ok(trace.snapshot().rule);
  const request = new Request(`https://fixture.invalid${rpcPath}?private=private-query`, { method: 'POST',
    headers: { Authorization: 'Bearer private-header-token', apikey: 'private-apikey' },
    body: JSON.stringify({ p_owner: owner, p_state: { 'private-key': 'private-new-state' }, p_expected_state: { other: 'private-old-state' },
      p_expected_updated_at: 'private-version', password: 'private-password' }) });
  const saving = trace.fetch(request); await waitForPhase(trace, 'held-before-send');
  assert.equal(sent.length, 2); trace.release(); assert.equal((await saving).status, 409);
  const entry = trace.snapshot().entries[0]; assert.deepEqual(entry.response, { status: 409 });
  assert.equal(entry.client, 'browser');
  const exported = trace.exportJson(); assert.ok(!exported.includes('private-')); assert.ok(!exported.includes(owner));
  assert.equal(auditSyncQa(JSON.parse(exported)).writes[0].outcome, 'not-acknowledged');
  assert.throws(() => trace.arm('POST', 'fail-get'), /GET/);
});

test('redacted or omitted content can never satisfy the legacy audit equality check', () => {
  const capture = { format: 'yeoni-sync-qa-v1', overflow: false, inFlight: 0, held: [], entries: [
    { id: 1, client: 'A', method: 'POST', requestBody: { state: '[redacted]' }, response: { status: 200 }, deliveredAt: '1', phase: 'delivered' },
    { id: 2, client: 'A', method: 'GET', sentAt: '2', response: { status: 200, body: [{ state: '[redacted]' }] }, phase: 'delivered' },
  ] };
  assert.equal(auditSyncQa(capture).writes[0].outcome, 'confirmation-unverified');
  capture.entries[0].requestBody = undefined;
  assert.equal(auditSyncQa(capture).writes[0].outcome, 'confirmation-unverified');
});
