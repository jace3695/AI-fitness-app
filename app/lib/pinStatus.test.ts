import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPinStatus } from './pinStatus.ts';

test('PIN status never treats failed or malformed responses as an unlocked account', async () => {
  for (const status of [401, 403, 500, 503]) await assert.rejects(readPinStatus(Response.json({ configured: false }, { status })));
  for (const value of [{}, null, { configured: 'false' }, { configured: 0 }]) await assert.rejects(readPinStatus(Response.json(value)));
  await assert.rejects(readPinStatus(new Response('{')));
  assert.equal(await readPinStatus(Response.json({ configured: true })), true);
  assert.equal(await readPinStatus(Response.json({ configured: false })), false);
});
