import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConversation, parseJournal, parseReply, requestFor, type Turn } from './conversation.ts';

const reply = { source: 'ai' as const, reply: 'こんにちは。', replyReading: 'こんにちは', correction: 'こんにちは。', explanation: '합성 응답' };
const turn: Turn = { id: 'one', situation: '일상', text: 'こんにちは', reply, review: true, practiced: 1 };
test('AI provenance is required; static fallback and malformed content rejected', () => {
  assert.deepEqual(parseReply(reply), reply);
  for (const value of [null, {}, { ...reply, source: 'static' }, { ...reply, reply: '' }, { ...reply, correction: 3 }, { ...reply, explanation: 'a'.repeat(4001) }]) assert.throws(() => parseReply(value));
});
test('context contains only successful same-situation turns, bounded to four pairs', () => {
  const turns = Array.from({ length: 8 }, (_, i) => ({ ...turn, id: String(i), text: String(i) }));
  turns.push({ ...turn, situation: '카페' }, { ...turn, reply: undefined });
  const req = requestFor(turns, '일상', ' 今日 ');
  assert.equal(req.message, '今日'); assert.equal(req.history.length, 8); assert.equal(req.history[0].text, '4');
  assert.throws(() => requestFor([], '일상', ' ')); assert.throws(() => requestFor([], '일상', 'x'.repeat(1001)));
});
test('journal restores reviews and self-reported attempts, rejects cross-owner/corrupt records', () => {
  const journal = { version: 1, owner: 'A', turns: [turn] };
  assert.deepEqual(parseJournal(JSON.stringify(journal), 'A'), journal);
  assert.throws(() => parseJournal(JSON.stringify(journal), 'B'));
  for (const turns of [[turn, turn], [{ ...turn, practiced: -1 }], [{ ...turn, review: 'yes' }], [{ ...turn, situation: 'unknown' }], Array.from({ length: 31 }, (_, i) => ({ ...turn, id: String(i) }))]) assert.throws(() => parseJournal(JSON.stringify({ ...journal, turns }), 'A'));
  assert.throws(() => parseJournal('{', 'A'));
});
test('cancellation settles even when a synthetic transport ignores abort', async () => {
  const c = new AbortController();
  const pending = getConversation(() => new Promise(() => {}), requestFor([], '일상', 'こんにちは'), c.signal);
  c.abort(); await assert.rejects(pending, { name: 'AbortError' });
});
test('synthetic transport failure and success remain distinct', async () => {
  const request = requestFor([], '일상', 'こんにちは');
  await assert.rejects(getConversation(async () => { throw Error('offline'); }, request, new AbortController().signal), /offline/);
  assert.deepEqual(await getConversation(async () => reply, request, new AbortController().signal), reply);
});
