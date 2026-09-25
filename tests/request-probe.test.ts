import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { installHttpObserver } from '../scripts/qa-http-observer.mjs';
import { nativeLabel } from '../scripts/qa-native-labels.mjs';

test('passive HTTP observer sees real receipt and completion without leaking query, cookies or bodies', async () => {
  const rows: Record<string, unknown>[] = [];
  const server = createServer((_request, response) => response.end('private-body'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const stop = installHttpObserver((row: Record<string, unknown>) => rows.push(row), address.port);
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      get(`http://127.0.0.1:${address.port}/growth/drawing?private-token=secret`, { headers: { 'sec-fetch-dest': 'document', cookie: 'private-cookie' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }).on('error', reject);
    });
    assert.equal(status, 200);
    assert.deepEqual(rows.map(row => row.event), ['server-received', 'server-finished']);
    assert.equal(rows[0].id, rows[1].id); assert.equal(rows[1].status, 200);
    assert.equal(JSON.stringify(rows).includes('private'), false);
    assert.equal(JSON.stringify(rows).includes('secret'), false);
  } finally { stop(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('native output is classified into fixed labels and raw secrets are discarded', () => {
  assert.equal(nativeLabel('pw:browser [err] libsoup-CRITICAL private-token'), 'libsoup-critical');
  assert.equal(nativeLabel('pw:browser [err] malloc(): corrupted private-token'), 'heap-error');
  assert.equal(nativeLabel('pw:browser [err] WebKit encountered an internal error private-token'), 'webkit-internal');
  assert.equal(nativeLabel('pw:browser https://example.test/private-token'), 'other-native');
  assert.equal(nativeLabel('authorization: private-token'), null);
});
