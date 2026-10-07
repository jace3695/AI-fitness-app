import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReplyPlan, parseReplyEnvelope, matchesReplyClip, adviceSpokenText, characterReplyEnabled } from './reply-plan.ts';
import { ReplySession, type ReplyClip } from './reply-session.ts';
import { parseLipSyncManifest, type LipSyncManifest } from './lip-sync.ts';
import type { PlaybackSnapshot } from './character-controller.ts';

const manifest = parseLipSyncManifest(JSON.parse(readFileSync(new URL('../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json', import.meta.url), 'utf8')));
const raw = readFileSync(new URL('../../docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3', import.meta.url));
const bytes = Uint8Array.from(raw).buffer;
const envelope = (reply = manifest.spokenText, id = 'r1') => ({ reply, performance: buildReplyPlan(reply, id) });
const sample: ReplyClip = { manifest, load: async () => ({ bytes, mime: 'audio/mpeg' }) };
const gestureKind = (session: ReplySession) => session.state.gesture?.kind;
function fakePlayer() {
  return { manifest: null as LipSyncManifest | null, state: 'empty' as PlaybackSnapshot['state'], message: '', loads: 0,
    async load(_bytes: ArrayBuffer, input: unknown) { this.loads++; this.manifest = parseLipSyncManifest(input); this.state = 'ready'; },
    reset() { this.manifest = null; this.state = 'empty'; }, async play() { this.state = 'playing'; },
    pause() { this.state = 'paused'; }, stop() { this.state = 'ready'; },
    snapshot(): PlaybackSnapshot { return { clipId: this.manifest?.audioSha256 ?? null, currentTimeMs: 0, state: this.state }; } };
}
test('approved pair keeps exact text and distinct chosen voices; mixed/unknown language is text only', () => {
  const ko = buildReplyPlan(manifest.spokenText, 'ko');
  const ja = buildReplyPlan('こんにちは。今日は、ゆっくり一歩ずつ進みましょう。', 'ja');
  assert.equal(ko.spokenText, manifest.spokenText); assert.equal(ko.voice, manifest.voice); assert.equal(ko.emotion, 'comforting');
  assert.equal(ja.voice, 'gemini-3.8-flash-tts/Zephyr'); assert.equal(ja.emotion, 'encouraging');
  for (const text of ['한국어 こんにちは', 'Hello', '今日']) assert.equal(buildReplyPlan(text, 'x').voice, null);
});
test('confirmation has restrained intent and all advice content, including limitations, survives', () => {
  assert.equal(buildReplyPlan('완료했어요', 'x', true).emotion, 'thinking');
  assert.equal(adviceSpokenText({ summary: '요약', nextSteps: ['하나', '둘'], basis: '근거', limitations: '한계' }), '요약\n하나\n둘\n근거\n한계');
});
test('reject stale/malformed plans, unsupported voices and altered spoken text', () => {
  for (const change of [{ spokenText: '다른 문장' }, { voice: 'another' }, { emotion: 'unbounded' }, { language: 'ja-JP' }, { gesture: 'dance' }]) {
    const value = envelope(); assert.throws(() => parseReplyEnvelope({ ...value, performance: { ...value.performance, ...change } }));
  }
  assert.equal(matchesReplyClip(buildReplyPlan(`${manifest.spokenText} `, 'x'), manifest), false);
});
test('Preview gate excludes production, missing configuration and other branches', () => {
  assert.equal(characterReplyEnabled({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'agent/yeoni-cat-animation-poc' }), true);
  for (const env of [{}, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'main' }]) assert.equal(characterReplyEnabled(env), false);
});
test('exact file loads without autoplay; gesture starts once and pause/resume does not replay it', async () => {
  const player = fakePlayer(), session = new ReplySession(player, [sample], () => {});
  await session.submit('x', async () => envelope()); assert.equal(session.state.status, 'ready'); assert.equal(player.state, 'ready');
  await session.play(); session.mediaChanged(); assert.equal(gestureKind(session), 'nod');
  session.pause(); session.mediaChanged(); assert.equal(session.state.emotion, 'neutral'); assert.equal(session.state.gesture, null);
  await session.play(); session.mediaChanged(); assert.equal(session.state.gesture, null);
  player.state = 'ended'; session.mediaChanged(); assert.equal(session.state.emotion, 'neutral');
  await session.play(); session.mediaChanged(); assert.equal(gestureKind(session), 'nod');
});
test('different text never borrows old audio and stops the old response', async () => {
  const player = fakePlayer(), session = new ReplySession(player, [sample], () => {});
  await session.submit('x', async () => envelope()); await session.play();
  await session.submit('y', async () => envelope('새 답변이에요.')); assert.equal(session.state.status, 'text-only');
  assert.equal(player.manifest, null); assert.equal(player.loads, 1); assert.equal(player.state, 'empty');
});
test('latest response wins even when cancelled transport ignores AbortSignal', async () => {
  const player = fakePlayer(), session = new ReplySession(player, [sample], () => {});
  let resolve!: (value: unknown) => void; let signal!: AbortSignal;
  const old = session.submit('old', (_message, input) => { signal = input; return new Promise(r => { resolve = r; }); });
  await session.submit('new', async () => envelope('새 답변이에요.', 'new'));
  resolve(envelope()); await old; assert.equal(signal.aborted, true); assert.equal(session.state.plan?.responseId, 'new'); assert.equal(player.loads, 0);
});
test('late audio bytes cannot attach to a new response or disposed session', async () => {
  let resolve!: (data: { bytes: ArrayBuffer; mime: string }) => void;
  const player = fakePlayer(), session = new ReplySession(player, [{ manifest, load: async () => new Promise(r => { resolve = r; }) }], () => {});
  const old = session.submit('old', async () => envelope()); await new Promise(r => setImmediate(r));
  session.dispose(); resolve({ bytes, mime: 'audio/mpeg' }); await old; assert.equal(player.loads, 0);
});
test('bad audio hash and failed transport remain silent; valid explicit retry recovers', async () => {
  const player = fakePlayer(), bad = new ReplySession(player, [{ manifest, load: async () => ({ bytes: new Uint8Array([1, 2]).buffer, mime: 'audio/mpeg' }) }], () => {});
  await bad.submit('x', async () => envelope()); assert.equal(bad.state.status, 'error'); assert.equal(player.loads, 0);
  const session = new ReplySession(player, [sample], () => {});
  await session.submit('x', async () => { throw new Error('연결 오류'); }); assert.equal(session.state.notice, '연결 오류');
  await session.submit('x', async () => envelope()); assert.equal(session.state.status, 'ready'); assert.equal(player.state, 'ready');
});
