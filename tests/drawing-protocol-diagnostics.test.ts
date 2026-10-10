import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { drawingProtocolBoundary, drawingProtocolEnabled, observeDrawingProtocol } from '../scripts/qa-drawing-protocol.mjs';

const secret = 'private-token-password-row-data';
const line = (direction: 'send' | 'receive', value: unknown) =>
  `2026-10-09T00:00:00.000Z pw:protocol ${direction === 'send' ? 'SEND ►' : '◀ RECV'} ${JSON.stringify(value)}`;

test('drawing protocol diagnostics require the explicit opt-in', () => {
  for (const value of [undefined, '', '0', 'true', secret]) {
    assert.equal(drawingProtocolEnabled({ QA_DRAWING_PROTOCOL: value }), false);
  }
  assert.equal(drawingProtocolEnabled({ QA_DRAWING_PROTOCOL: '1' }), true);
});

test('protocol ingestion keeps fixed labels/timing and never exports secrets from any envelope field', () => {
  let now = 100;
  const observer = observeDrawingProtocol(() => now);
  const ingest = (direction: 'send' | 'receive', message: object) => {
    observer.ingest(line(direction, { sessionId: secret, ...message }));
    assert.equal(JSON.stringify(observer.snapshot()).includes(secret), false);
  };
  ingest('send', { id: 42, method: 'Runtime.callFunctionOn', params: {
    functionDeclaration: secret, arguments: [{ value: secret }], url: `https://${secret}`, headers: { authorization: secret },
  }, unexpected: secret });
  now = 112;
  assert.deepEqual(observer.snapshot().pending, [{ method: 'Runtime.callFunctionOn', ageMs: 12 }]);
  ingest('receive', { id: 42, result: { value: secret, objectId: secret }, unexpected: secret });
  ingest('send', { id: 43, method: 'Fetch.disable', params: { token: secret } });
  now = 119;
  ingest('receive', { id: 43, error: { message: secret, data: secret, code: -1 } });
  ingest('receive', { method: 'Page.javascriptDialogOpening', params: { message: secret, url: secret, defaultPrompt: secret } });
  assert.deepEqual(observer.snapshot().events, [
    { at: 100, method: 'Runtime.callFunctionOn', boundary: 'send' },
    { at: 112, method: 'Runtime.callFunctionOn', boundary: 'resolve', elapsedMs: 12 },
    { at: 112, method: 'Fetch.disable', boundary: 'send' },
    { at: 119, method: 'Fetch.disable', boundary: 'reject', elapsedMs: 7 },
    { at: 119, method: 'Page.javascriptDialogOpening', boundary: 'event' },
  ]);
  assert.deepEqual(observer.snapshot().pending, []);
  for (const forbidden of ['sessionId', 'params', 'result', 'error', 'objectId', '42', '43']) {
    assert.equal(JSON.stringify(observer.snapshot()).includes(forbidden), false);
  }
});

test('unknown, malformed, oversized and nested WebKit envelopes fail closed', () => {
  const observer = observeDrawingProtocol(() => 1);
  for (const raw of [
    line('send', { id: 1, method: secret, params: { password: secret } }),
    line('receive', { method: secret, params: { password: secret } }),
    line('receive', { id: 998, result: { password: secret } }),
    line('receive', { method: 'Target.dispatchMessageFromTarget', params: { message: secret } }),
    `pw:protocol SEND ► {"id":2,"method":"Runtime.evaluate","params":"${secret}" <<<<<( LOG TRUNCATED )>>>>> }`,
    line('send', { id: 3, method: 'Runtime.evaluate', params: { text: secret.repeat(100_000) } }),
    line('receive', { method: { malicious: secret } }),
    `${secret} raw unrelated output`,
  ]) observer.ingest(raw);
  assert.deepEqual(observer.snapshot().events, []);
  assert.deepEqual(observer.snapshot().pending, []);
  assert.equal(observer.snapshot().malformedMessages, 2);
  assert.equal(JSON.stringify(observer.snapshot()).includes(secret), false);
});

test('responses correlate transient IDs only within the same session', () => {
  let now = 0;
  const observer = observeDrawingProtocol(() => now);
  observer.ingest(line('send', { id: 1, sessionId: 'a-' + secret, method: 'Runtime.evaluate' }));
  now = 3;
  observer.ingest(line('send', { id: 1, sessionId: 'b-' + secret, method: 'Fetch.disable' }));
  now = 5;
  observer.ingest(line('receive', { id: 1, sessionId: 'b-' + secret, result: { secret } }));
  assert.deepEqual(observer.snapshot().pending, [{ method: 'Runtime.evaluate', ageMs: 5 }]);
  assert.deepEqual(observer.snapshot().events.at(-1), { at: 5, method: 'Fetch.disable', boundary: 'resolve', elapsedMs: 2 });
  assert.equal(JSON.stringify(observer.snapshot()).includes(secret), false);
});

test('invalid correlation values cannot become persisted labels', () => {
  const observer = observeDrawingProtocol(() => 0);
  for (const id of [secret, null, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    observer.ingest(line('send', { id, method: 'Runtime.evaluate' }));
  }
  for (const sessionId of [{ secret }, 5, secret.repeat(100)]) {
    observer.ingest(line('send', { id: 1, sessionId, method: 'Runtime.evaluate' }));
  }
  assert.deepEqual(observer.snapshot().events, []);
  assert.deepEqual(observer.snapshot().pending, []);
  assert.equal(observer.snapshot().malformedMessages, 8);
});

test('protocol history is bounded and a restarted browser cannot settle old commands', () => {
  const observer = observeDrawingProtocol(() => 0);
  for (let id = 1; id <= 400; id++) {
    observer.ingest(line('send', { id, sessionId: secret, method: 'Runtime.evaluate', params: { secret } }));
  }
  const snapshot = observer.snapshot();
  assert.equal(snapshot.events.length, 160);
  assert.equal(snapshot.pending.length, 128);
  assert.equal(snapshot.droppedEvents, 240);
  assert.equal(snapshot.droppedPending, 272);
  snapshot.events[0].method = secret;
  snapshot.pending[0].method = secret;
  assert.equal(JSON.stringify(observer.snapshot()).includes(secret), false);
  observer.reset();
  observer.ingest(line('receive', { id: 400, sessionId: secret, result: { secret } }));
  assert.deepEqual(observer.snapshot().events, []);
  assert.deepEqual(observer.snapshot().pending, []);
  assert.equal(JSON.stringify(observer.snapshot()).includes(secret), false);
});

test('debug colors and timing suffixes do not expose raw output', () => {
  const observer = observeDrawingProtocol(() => 5);
  observer.ingest(`\u001b[35mpw:protocol\u001b[0m SEND ► {"id":7,"method":"Page.reload","params":{"token":"${secret}"}} +2ms`);
  observer.ingest(line('receive', { id: 7, result: { secret } }));
  assert.deepEqual(observer.snapshot().events.map(event => event.boundary), ['send', 'resolve']);
  assert.equal(JSON.stringify(observer.snapshot()).includes(secret), false);
});

test('failure boundary labels are fixed and ignore all runtime identity and error text', () => {
  assert.equal(drawingProtocolBoundary('QA_NAVIGATION_FAILURE ' + secret), 'test-failure');
  assert.equal(drawingProtocolBoundary('failed: ' + secret), 'failed-test-end');
  assert.equal(drawingProtocolBoundary('timedOut: ' + secret), 'failed-test-end');
  assert.equal(drawingProtocolBoundary('QA_CLEANUP_PHASE ' + JSON.stringify({ phase: 'unroute', boundary: 'start', title: secret, ms: secret })), 'unroute-start');
  for (const raw of [secret, 'passed: ' + secret, 'QA_CLEANUP_PHASE ' + secret,
    'QA_CLEANUP_PHASE ' + JSON.stringify({ phase: secret, boundary: 'start' }),
    'QA_CLEANUP_PHASE ' + JSON.stringify({ phase: 'unroute', boundary: secret })]) {
    assert.equal(drawingProtocolBoundary(raw), null);
  }
});

test('the wrapper drops every raw protocol line before its existing output paths', () => {
  const wrapper = readFileSync(new URL('../scripts/qa-playwright.mjs', import.meta.url), 'utf8');
  assert.match(wrapper, /if \(line\.includes\('pw:protocol'\)\) \{\s+protocol\?\.ingest\(line\);\s+return;/);
  assert.ok(wrapper.indexOf("line.includes('pw:protocol')") < wrapper.indexOf('const label = nativeLabel(line)'));
  assert.match(wrapper, /DEBUG: protocol \? 'pw:browser,pw:protocol' : 'pw:browser'/);
});
