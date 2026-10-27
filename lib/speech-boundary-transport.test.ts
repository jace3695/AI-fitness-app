import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { BOUNDARY_PROBES, type BoundaryProbe } from './speech-boundary-check.ts';
import { createBoundaryFetch, invokeBoundaryProbe, type BoundaryClient } from './speech-boundary-transport.ts';

// Real SDK, synthetic transport only: no account, token, DB, Azure, or network.
const URL = 'http://127.0.0.1:54321';
const SCHEMA = 'yeoni_speech_proof_candidate';
type Call = { input: RequestInfo | globalThis.URL; init: RequestInit | undefined };
const probe = (id: string) => {
  const found = BOUNDARY_PROBES.find(candidate => candidate.id === id);
  assert.ok(found);
  return found;
};
function setup(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const original: typeof fetch = async (input, init) => {
    const call = { input, init };
    calls.push(call);
    assert.ok(String(input).startsWith(`${URL}/rest/v1/`), 'only synthetic PostgREST dispatches are allowed');
    return respond(call);
  };
  const adapted = createBoundaryFetch(original, URL);
  const sdk = createClient(URL, 'sb_publishable_synthetic_boundary_only', {
    global: { fetch: adapted },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const client = sdk as BoundaryClient;
  return { calls, adapted, sdk, client };
}

/** HWM zero distinguishes a transport read from eager stream buffering. */
function privateResponse(status: number) {
  const counts = { reads: 0, cancels: 0, text: 0, json: 0, clone: 0, arrayBuffer: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      counts.reads++;
      controller.enqueue(new TextEncoder().encode('SYNTHETIC_PRIVATE_RESPONSE_MUST_NOT_BE_READ'));
      controller.close();
    },
    cancel() { counts.cancels++; },
  }, { highWaterMark: 0 });
  const response = new Response(stream, { status, headers: { 'content-type': 'application/json' } });
  for (const method of ['text', 'json', 'clone', 'arrayBuffer'] as const) {
    Object.defineProperty(response, method, {
      value: () => { counts[method]++; throw Error('private response method forbidden'); },
    });
  }
  return { response, counts };
}

function chunkedResponse(chunks: string[], declaredLength?: string) {
  const counts = { reads: 0, cancels: 0, text: 0, json: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[counts.reads++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel() { counts.cancels++; },
  }, { highWaterMark: 0 });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (declaredLength !== undefined) headers['content-length'] = declaredLength;
  const response = new Response(stream, { status: 200, headers });
  for (const method of ['text', 'json'] as const) {
    Object.defineProperty(response, method, {
      value: () => { counts[method]++; throw Error('unbounded body reader forbidden'); },
    });
  }
  return { response, counts };
}

test('real SDK: all three empty HEAD 403 responses preserve raw status without SQLSTATE claims', async () => {
  const s = setup(() => new Response(null, { status: 403 }));
  for (const id of ['keys', 'policy', 'total']) {
    const result = await invokeBoundaryProbe(s.client, probe(id), new AbortController().signal);
    assert.equal(result.status, 403);
    assert.equal('code' in result, false);
  }
  assert.equal(s.calls.length, 3);
  assert.deepEqual(s.calls.map(call => call.init?.method), ['HEAD', 'HEAD', 'HEAD']);
  assert.deepEqual(s.calls.map(call => new globalThis.URL(String(call.input)).searchParams.get('select')), ['key_id', 'singleton', 'singleton']);
  assert.ok(s.calls.every(call => call.init?.body === undefined));
});

test('real SDK: empty HEAD 404 stays 404 instead of SDK empty-body 204 workaround', async () => {
  const s = setup(() => new Response(null, { status: 404 }));
  const result = await invokeBoundaryProbe(s.client, probe('keys'), new AbortController().signal);
  assert.equal(result.status, 404);
  assert.equal(s.calls.length, 1);
});

test('real SDK: table success, internal RPC success and RPC rejection never read original response bodies', async () => {
  for (const id of ['keys', 'authorized', 'payload']) {
    for (const status of [200, 403, 404, 500]) {
      const body = privateResponse(status);
      const s = setup(() => body.response);
      const result = await invokeBoundaryProbe(s.client, probe(id), new AbortController().signal);
      assert.equal(result.status, status, `${id} status ${status}`);
      assert.deepEqual(body.counts, { reads: 0, cancels: 1, text: 0, json: 0, clone: 0, arrayBuffer: 0 });
      assert.equal('data' in result, false);
      assert.equal('code' in result, false);
      assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_RESPONSE'));
    }
  }
});

test('real SDK: internal null arguments stay JSON null in POST bodies, never string null in HEAD URLs', async () => {
  const s = setup(() => new Response(null, { status: 403 }));
  for (const id of ['authorized', 'payload']) {
    const selected = probe(id);
    await invokeBoundaryProbe(s.client, selected, new AbortController().signal);
    const call = s.calls.at(-1)!;
    assert.equal(call.init?.method, 'POST');
    assert.equal(new globalThis.URL(String(call.input)).search, '');
    assert.deepEqual(JSON.parse(String(call.init?.body)), selected.args);
    assert.ok(Object.values(JSON.parse(String(call.init?.body))).every(value => value === null));
  }
  assert.equal(s.calls.length, 2);
});

test('real SDK: forged ready proof uses only exact expired public dummy inputs and no quota lifecycle RPC', async () => {
  const s = setup(() => Response.json(false));
  const result = await invokeBoundaryProbe(s.client, probe('ready'), new AbortController().signal);
  const call = s.calls[0];
  assert.equal(call.init?.method, 'POST');
  assert.equal(new globalThis.URL(String(call.input)).pathname, '/rest/v1/rpc/ready');
  assert.deepEqual(JSON.parse(String(call.init?.body)), {
    p_request_id: '00000000-0000-4000-8000-000000000000',
    p_issued_at: 0,
    p_expires_at: 1,
    p_key_id: 'speech-trial-v1',
    p_mac: '0'.repeat(64),
  });
  assert.deepEqual(result, { status: 200, data: false });
  assert.ok(s.calls.every(item => !/\/(consume|finish)(?:\?|$)/.test(String(item.input))));
});

test('real SDK: HEAD 503 and 520 have zero automatic retries and zero body reads', async () => {
  for (const status of [503, 520]) {
    const body = privateResponse(status);
    const s = setup(() => body.response);
    const result = await invokeBoundaryProbe(s.client, probe('keys'), new AbortController().signal);
    assert.equal(result.status, status);
    assert.equal(s.calls.length, 1);
    assert.equal(body.counts.reads, 0);
    assert.equal(body.counts.text, 0);
    assert.equal(body.counts.cancels, 1);
  }
});

test('real SDK: a network failure is a closed status with zero retries or original diagnostics', async () => {
  const s = setup(() => { throw Error('SYNTHETIC_PRIVATE_NETWORK_DIAGNOSTIC'); });
  const result = await invokeBoundaryProbe(s.client, probe('keys'), new AbortController().signal);
  assert.equal(result.status, 0);
  assert.equal(s.calls.length, 1);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_NETWORK_DIAGNOSTIC'));
});

test('real SDK: ready permits only bounded boolean JSON; true remains true, not a denial', async () => {
  for (const value of [false, true]) {
    const body = chunkedResponse([String(value).slice(0, 2), String(value).slice(2)]);
    const s = setup(() => body.response);
    const result = await invokeBoundaryProbe(s.client, probe('ready'), new AbortController().signal);
    assert.equal(result.status, 200);
    assert.equal(result.data, value);
    assert.equal(body.counts.text, 0);
    assert.equal(body.counts.json, 0);
  }
});

test('real SDK: ready string, object, array, null, numeric and malformed values never become false', async () => {
  for (const value of ['"false"', '{}', '[]', 'null', '0', '', 'FALSE', 'false true', '{"value":false}', '\u00a0false', 'false\u00a0', '\ufefffalse', 'false\ufeff']) {
    const s = setup(() => new Response(value, { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await invokeBoundaryProbe(s.client, probe('ready'), new AbortController().signal);
    assert.equal(result.status, 200);
    assert.notEqual(result.data, false, `invalid ready value ${value}`);
    assert.ok(!JSON.stringify(result).includes('"value"'));
  }
});

test('real SDK: oversized ready stream is cancelled after its first oversized chunk, without unbounded text/JSON methods', async () => {
  const body = chunkedResponse(['x'.repeat(65_536), 'false']);
  const s = setup(() => body.response);
  const result = await invokeBoundaryProbe(s.client, probe('ready'), new AbortController().signal);
  assert.equal(result.status, 200);
  assert.notEqual(result.data, false);
  assert.ok(body.counts.reads <= 1);
  assert.equal(body.counts.cancels, 1);
  assert.equal(body.counts.text, 0);
  assert.equal(body.counts.json, 0);
});

test('real SDK: declared oversized ready content is cancelled without reading any chunks', async () => {
  const body = chunkedResponse(['false'], '65536');
  const s = setup(() => body.response);
  const result = await invokeBoundaryProbe(s.client, probe('ready'), new AbortController().signal);
  assert.equal(result.status, 200);
  assert.notEqual(result.data, false);
  assert.equal(body.counts.reads, 0);
  assert.equal(body.counts.cancels, 1);
});

test('real SDK: ready non-200 responses are status only and do not read an otherwise valid false body', async () => {
  for (const status of [201, 403, 404, 500]) {
    const body = privateResponse(status);
    const s = setup(() => body.response);
    const result = await invokeBoundaryProbe(s.client, probe('ready'), new AbortController().signal);
    assert.equal(result.status, status);
    assert.equal('data' in result, false);
    assert.equal(body.counts.reads, 0);
    assert.equal(body.counts.cancels, 1);
  }
});

test('ordinary unregistered requests keep their original input, init and Response object', async () => {
  const originalResponse = Response.json({ ordinary: true });
  let seenInput: RequestInfo | globalThis.URL | undefined;
  let seenInit: RequestInit | undefined;
  const adapted = createBoundaryFetch(async (input, init) => {
    seenInput = input;
    seenInit = init;
    return originalResponse;
  }, URL);
  const input = new globalThis.URL(`${URL}/rest/v1/ordinary`);
  const init: RequestInit = { method: 'GET', signal: new AbortController().signal };
  const result = await adapted(input, init);
  assert.equal(seenInput, input);
  assert.equal(seenInit, init);
  assert.equal(result, originalResponse);
  assert.deepEqual(await result.json(), { ordinary: true });
});

test('real SDK: ordinary unregistered table and RPC JSON data remain unchanged', async () => {
  const s = setup(() => Response.json([{ ordinary: true }]));
  const table = await s.sdk.from('ordinary').select('ordinary');
  assert.equal(table.status, 200);
  assert.deepEqual(table.data, [{ ordinary: true }]);
  const rpc = await s.sdk.rpc('ordinary', { p_value: null });
  assert.equal(rpc.status, 200);
  assert.deepEqual(rpc.data, [{ ordinary: true }]);
  assert.equal(s.calls.length, 2);
});

test('a noncanonical probe descriptor cannot dispatch, even if it carries a known id', async () => {
  const s = setup(() => Response.json(false));
  const invalid: BoundaryProbe = { ...probe('ready'), name: 'consume' };
  const result = await invokeBoundaryProbe(s.client, invalid, new AbortController().signal).catch(() => ({ status: 0 }));
  assert.equal(result.status, 0);
  assert.equal(s.calls.length, 0);
});

test('registered requests reject wrong schema, table, columns, RPC name or payload before transport', async () => {
  for (const mutation of ['schema', 'table', 'columns', 'name', 'payload'] as const) {
    const s = setup(() => Response.json(false));
    const delegate = s.sdk.schema(mutation === 'schema' ? 'public' : SCHEMA);
    const altered = {
      schema: () => ({
        from: (table: string) => ({
          select: (column: string, options: { head: true }) => delegate.from(mutation === 'table' ? 'unapproved' : table).select(mutation === 'columns' ? '*' : column, options),
        }),
        rpc: (name: string, args: Readonly<Record<string, string | number | null>>) => delegate.rpc(mutation === 'name' ? 'consume' : name, mutation === 'payload' ? { ...args, p_action: 'consume' } : args),
      }),
    } as unknown as BoundaryClient;
    const selected = probe(mutation === 'name' || mutation === 'payload' ? 'authorized' : 'keys');
    const result = await invokeBoundaryProbe(altered, selected, new AbortController().signal).catch(() => ({ status: 0 }));
    assert.equal(result.status, 0, mutation);
    assert.equal(s.calls.length, 0, mutation);
  }
});

test('already-aborted diagnostic signal never dispatches', async () => {
  const s = setup(() => Response.json(false));
  const controller = new AbortController();
  controller.abort();
  const result = await invokeBoundaryProbe(s.client, probe('ready'), controller.signal).catch(() => ({ status: 0 }));
  assert.equal(result.status, 0);
  assert.equal(s.calls.length, 0);
});

test('real SDK: duplicate in-flight signal is refused, then the released signal can run the next probe', async () => {
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>(done => { resolve = done; });
  let first = true;
  const s = setup(() => {
    if (first) { first = false; return pending; }
    return new Response(null, { status: 403 });
  });
  const signal = new AbortController().signal;
  const original = invokeBoundaryProbe(s.client, probe('keys'), signal);
  await new Promise(done => setImmediate(done));
  await assert.rejects(invokeBoundaryProbe(s.client, probe('policy'), signal));
  assert.equal(s.calls.length, 1);
  resolve(new Response(null, { status: 403 }));
  assert.equal((await original).status, 403);
  assert.equal((await invokeBoundaryProbe(s.client, probe('policy'), signal)).status, 403);
  assert.equal(s.calls.length, 2);
});

test('real SDK: abort during a pending ready body cancels its reader and emits no late false result', async () => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }, { highWaterMark: 0 });
  const s = setup(() => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
  const controller = new AbortController();
  const result = invokeBoundaryProbe(s.client, probe('ready'), controller.signal);
  await new Promise(done => setImmediate(done));
  controller.abort();
  await assert.rejects(result);
  assert.equal(cancelled, 1);
  assert.equal(s.calls.length, 1);
});

test('real SDK: abort before a noncooperative transport resolves discards its late private response without reading', async () => {
  let resolve!: (value: Response) => void;
  const pending = new Promise<Response>(done => { resolve = done; });
  const s = setup(() => pending);
  const controller = new AbortController();
  const result = invokeBoundaryProbe(s.client, probe('authorized'), controller.signal);
  await new Promise(done => setImmediate(done));
  controller.abort();
  const body = privateResponse(200);
  resolve(body.response);
  await assert.rejects(result);
  assert.equal(body.counts.reads, 0);
  assert.equal(body.counts.cancels, 1);
  assert.equal(s.calls.length, 1);
});

test('real SDK: only ASCII JSON whitespace is allowed around a bounded boolean', async () => {
  const s = setup(() => new Response(' \tfalse\r\n', { headers: { 'content-type': 'application/json; charset=utf-8' } }));
  const result = await invokeBoundaryProbe(s.client, probe('ready'), new AbortController().signal);
  assert.deepEqual(result, { status: 200, data: false });
});

test('real SDK: diagnostic adapter never reads or rewrites credential headers and preserves their object identity', async () => {
  let expectedHeaders: Headers | undefined;
  let calls = 0;
  const adapted = createBoundaryFetch(async (_input, init) => {
    assert.equal(init?.headers, expectedHeaders);
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    calls++;
    return new Response(null, { status: 403 });
  }, URL);
  const guarded: typeof fetch = async (input, init) => {
    assert.ok(init?.headers instanceof Headers);
    const headers = init.headers;
    const get = headers.get.bind(headers);
    const set = headers.set.bind(headers);
    const forbidden = (name: string) => ['authorization', 'apikey'].includes(name.toLowerCase());
    Object.defineProperty(headers, 'get', { value: (name: string) => {
      assert.equal(forbidden(name), false, 'diagnostic adapter must not read SDK credentials');
      return get(name);
    } });
    Object.defineProperty(headers, 'set', { value: (name: string, value: string) => {
      assert.equal(forbidden(name), false, 'diagnostic adapter must not rewrite SDK credentials');
      return set(name, value);
    } });
    expectedHeaders = headers;
    return adapted(input, init);
  };
  const sdk = createClient(URL, 'sb_publishable_synthetic_boundary_only', {
    global: { fetch: guarded },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  for (const selected of BOUNDARY_PROBES) {
    const result = await invokeBoundaryProbe(sdk as BoundaryClient, selected, new AbortController().signal);
    assert.equal(result.status, 403);
  }
  assert.equal(calls, 6);
});
