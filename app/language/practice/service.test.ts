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

test('transient and timeout statuses are not described as a missing connection', async()=>{
 for(const status of [503,504]){
  let calls=0;const transport=conversationTransport(async()=>{calls++;return new Response('private details',{status});},async()=>({}));
  await assert.rejects(transport(requestFor([],'일상','合成'),new AbortController().signal),e=>e instanceof Error && !e.message.includes('연결되지') && e.message.includes('자동으로 다시 보내지'));
  assert.equal(calls,1);
 }
});

test('whole transport cancellation releases waiting auth and blocks late endpoint dispatch',async()=>{
 let resolve!: (value:HeadersInit)=>void;let calls=0;const controller=new AbortController();
 const transport=conversationTransport(async()=>{calls++;return new Response('{}');},()=>new Promise(r=>{resolve=r;}));
 const pending=getConversation(transport,requestFor([],'일상','合成'),controller.signal);
 controller.abort();await assert.rejects(pending,{name:'AbortError'});resolve({});await new Promise(r=>setImmediate(r));assert.equal(calls,0);
});
test('whole transport cancellation includes body reading and rejects its late success',async()=>{
 let resolve!: (value:unknown)=>void;let calls=0;const controller=new AbortController();
 const transport=conversationTransport(async()=>{calls++;return Object.assign(new Response('{}'),{json:()=>new Promise(r=>{resolve=r;})});},async()=>({}));
 const pending=getConversation(transport,requestFor([],'일상','合成'),controller.signal);
 await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,{name:'AbortError'});
 resolve({source:'ai',reply:'late',replyReading:'late',correction:'late',explanation:'late'});await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});
