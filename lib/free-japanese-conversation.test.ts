import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFreeJapanese, parseFreeJapaneseRequest } from './free-japanese-conversation.ts';

const input = { situation: '일상', message: 'こんにちは', history: [], freeDataUseAcknowledged: true as const };
const env = { GEMINI_FREE_API_KEY: 'synthetic-only', GEMINI_FREE_TIER_CONFIRMED: 'true' };
const answer = { reply: 'こんにちは。', replyReading: 'こんにちは。', correction: 'こんにちは', explanation: '인사 표현이에요.' };
const response = (finishReason = 'STOP', text = JSON.stringify(answer)) => new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }));

test('strict request accepts four pairs and rejects absent consent, extras, oversized or unpaired history', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: '合成文' }));
  assert.equal(parseFreeJapaneseRequest({ ...input, history })?.history.length, 8);
  for (const value of [{ ...input, freeDataUseAcknowledged: false }, { ...input, health: {} }, { ...input, audio: 'data' }, { ...input, message: 'x'.repeat(1001) }, { ...input, history: [...history, ...history] }, { ...input, history: [history[0]] }, { ...input, history: [{ role: 'assistant', text: 'a' }, { role: 'user', text: 'b' }] }]) assert.equal(parseFreeJapaneseRequest(value), null);
});
test('missing free attestation/key blocks dispatch even when paid keys exist', async () => {
  let calls = 0; const request: typeof fetch = async () => { calls++; return response(); };
  for (const config of [{ GEMINI_API_KEY: 'paid' }, { GEMINI_FREE_API_KEY: 'synthetic' }, { GEMINI_FREE_TIER_CONFIRMED: 'true' }]) await assert.rejects(generateFreeJapanese(input, config, request));
  assert.equal(calls, 0);
});
test('one request sends only approved Japanese content through the existing free model', async () => {
  let calls = 0;
  const result = await generateFreeJapanese({ ...input, history: [{ role: 'user', text: '前の文' }, { role: 'assistant', text: '前の返事' }] }, env, async (url, init) => {
    calls++; assert.match(String(url), /gemini-3\.5-flash-lite:generateContent$/);
    const body = JSON.parse(init!.body as string);
    assert.deepEqual(body.contents.map((m: { parts: { text: string }[] }) => m.parts[0].text), ['前の文', '前の返事', 'こんにちは']);
    assert.equal(body.tools, undefined); assert.equal(body.cachedContent, undefined); assert.equal(body.store, false);
    assert.equal(init!.redirect, 'error'); return response();
  });
  assert.equal(calls, 1); assert.deepEqual(result, { source: 'ai', ...answer });
});
test('quota, provider error and uncertain network failure never retry or use a fallback', async () => {
  for (const status of [429, 403, 500, 0]) {
    let calls = 0;
    await assert.rejects(generateFreeJapanese(input, env, async () => { calls++; if (!status) throw Error('private provider detail'); return new Response('private provider detail', { status }); }), e => e instanceof Error && !e.message.includes('private'));
    assert.equal(calls, 1);
  }
});
test('truncated and malformed outputs never become a synthetic successful answer', async () => {
  for (const [finish, text] of [['MAX_TOKENS', JSON.stringify(answer)], ['STOP', '{}'], ['STOP', '{broken']]) await assert.rejects(generateFreeJapanese(input, env, async () => response(finish, text)));
});

test('provider header and body timeouts return 504 without redispatch', async () => {
 for (const bodyTimeout of [false,true]) {
  let calls=0;
  await assert.rejects(generateFreeJapanese(input,env,async()=>{calls++; if(!bodyTimeout)throw new DOMException('synthetic timeout','TimeoutError'); return Object.assign(new Response('{}'), {json:async()=>{throw new DOMException('synthetic timeout','TimeoutError');}});}),e=>e instanceof Error && 'status' in e && e.status===504);
  assert.equal(calls,1);
 }
});

test('cancelled request never starts provider; late body cannot become success',async()=>{
 const before=new AbortController();before.abort();let calls=0;
 await assert.rejects(generateFreeJapanese(input,env,async()=>{calls++;return response();},before.signal));assert.equal(calls,0);
 const late=new AbortController();await assert.rejects(generateFreeJapanese(input,env,async()=>{calls++;const r=response();const body=await r.json();return Object.assign(new Response('{}'),{json:async()=>{late.abort();return body;}});},late.signal));assert.equal(calls,1);
});
