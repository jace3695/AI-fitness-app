import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationTransport } from './service.ts';
import { getConversation, requestFor } from './conversation.ts';

test('HTTP errors are bounded user messages, with no automatic paid retries', async () => {
  for (const status of [401, 402, 429, 503, 500]) {
    let calls = 0;
    const transport = conversationTransport(async () => { calls++; return new Response('private server details', { status }); }, async () => ({ 'Content-Type': 'application/json' }));
    await assert.rejects(transport(requestFor([], '일상', 'こんにちは'), new AbortController().signal), e => e instanceof Error && !e.message.includes('private'));
    assert.equal(calls, 1);
  }
});
test('aborted auth preparation never calls the endpoint', async () => {
  let calls = 0;
  const controller = new AbortController();
  const transport = conversationTransport(async () => { calls++; return new Response('{}'); }, async () => { controller.abort(); return {}; });
  await assert.rejects(transport(requestFor([], '일상', 'こんにちは'), controller.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
});
test('legacy static response cannot masquerade as free AI conversation', async () => {
  const transport = conversationTransport(async () => new Response(JSON.stringify({ reply: 'fixed example' })), async () => ({}));
  await assert.rejects(getConversation(transport, requestFor([], '일상', 'こんにちは'), new AbortController().signal), /형식/);
});

test('practice transport uses only the free endpoint and an explicit bounded payload', async () => {
  const transport = conversationTransport(async (url, init) => {
    assert.equal(url, '/api/language/practice');
    assert.deepEqual(JSON.parse(init!.body as string), { situation: '일상', message: 'こんにちは', history: [], freeDataUseAcknowledged: true });
    return new Response('{}');
  }, async () => ({ 'Content-Type': 'application/json' }));
  await transport(requestFor([], '일상', 'こんにちは'), new AbortController().signal);
});
