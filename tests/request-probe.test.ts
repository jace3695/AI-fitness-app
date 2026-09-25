import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { installHttpObserver } from '../scripts/qa-http-observer.mjs';
import { nativeLabel } from '../scripts/qa-native-labels.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeNetworkLibraries } from '../scripts/qa-browser-environment.mjs';

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

test('network library evidence verifies mapped bytes without exporting process paths or environment', () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-libs-'));
  try {
    mkdirSync(join(root, '101'));
    const library = join(root, 'libsoup-3.0.so.0');
    writeFileSync(library, 'binary\0libsoup/3.6.6\0private-secret');
    writeFileSync(join(root, '101/comm'), 'WPENetworkProce\n');
    writeFileSync(join(root, '101/maps'), `000-fff r-xp 0 0 0 ${library}\n`);
    writeFileSync(join(root, '101/environ'), 'PRIVATE_SECRET=do-not-read');
    const observer = observeNetworkLibraries(root); observer.sample(); observer.sample();
    const evidence = observer.snapshot();
    assert.equal(evidence.length, 1);
    assert.deepEqual(evidence[0].versions, ['libsoup/3.6.6']);
    assert.match(evidence[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(evidence).includes(root), false);
    assert.equal(JSON.stringify(evidence).includes('private-secret'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
