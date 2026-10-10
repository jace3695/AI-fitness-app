import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeKoreanCurrencySpeech as normalize } from './korean-currency-speech.ts';
import { prepareZephyrSpeech, ZephyrAudioCache } from '../zephyr-playback.ts';
import { YEONI_VOICE_NAME } from '../yeoni-voice-policy.ts';

test('KRW integers use Korean place values without changing surrounding display text', () => {
  for (const [input, expected] of [
    ['예상 비용은 12,500원이에요.', '예상 비용은 만이천오백원이에요.'],
    ['12,500원을 준비해요.', '만이천오백원을 준비해요.'],
    ['12500원 / 12,500 원', '만이천오백원 / 만이천오백 원'],
    ['0원, 1원, 10원, 100원, 1,000원, 10,000원', '영원, 일원, 십원, 백원, 천원, 만원'],
    ['100,000,000원과 100,010,001원', '일억원과 일억만일원'],
    ['1,000,000,000,000원', '일조원'],
    ['9,999,999,999,999,999원', '구천구백구십구조구천구백구십구억구천구백구십구만구천구백구십구원'],
  ]) {
    assert.equal(normalize(input), expected);
    assert.equal(normalize(expected), expected);
  }
  const source = '오늘 오후 3시 30분에 약속이 있어요. 준비물은 2개이고, 예상 비용은 12,500원이에요.';
  const speech = prepareZephyrSpeech(source);
  assert.equal(speech.text, source, 'retain the original cache/attempt identity');
  assert.equal(Array.from(source).length, 52);
  assert.equal(speech.characters, 51);
  assert.equal(normalize(source), source.replace('12,500원', '만이천오백원'));
});

test('unsupported numbers and non-currency words never receive a partial conversion', () => {
  for (const text of ['12,50원', '1,234,56원', '12,500.50원', '12.500원', '012500원',
    '-12,500원', '+12,500원', '- 12,500원', 'v12,500원', 'ID_12500원',
    '10,000,000,000,000,000원', '12500원소', '12500원인', '오후 3시 30분, 2개, 1.5kg',
    '1,000~2,000개', '만이천오백원']) assert.equal(normalize(text), text);
});

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function setup() {
  const rows = new Map<string, string>();
  return { rows, now: new Date('2026-10-09T02:09:00Z'), storage: {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => { rows.set(key, value); },
  } };
}
test('pre-fix attempt receipt still blocks the same numeric answer without a network request', async () => {
  const f = setup(), text = '12,500원';
  const key = 'yeoni-zephyr-attempt-v1:' + hash(JSON.stringify(['owner', '2026-10', YEONI_VOICE_NAME, text]));
  f.rows.set(key, 'existing-request-receipt');
  await assert.rejects(new ZephyrAudioCache().get('owner', text, { ...f,
    request: async () => { throw new Error('Unexpected network request'); },
  }), /이미 음성 생성을 요청/);
  assert.deepEqual([...f.rows], [[key, 'existing-request-receipt']]);
});

test('expanded speech count blocks insufficient quota and overlength before synthesis', async () => {
  const f = setup(); let gets = 0;
  const request = async (init: RequestInit) => {
    assert.equal(init.method, 'GET'); gets++;
    return Response.json({ voice: YEONI_VOICE_NAME, useDeviceVoice: false, enabled: true, remainingCharacters: 5 });
  };
  assert.equal(prepareZephyrSpeech('9999원').characters, 8);
  await assert.rejects(new ZephyrAudioCache().get('owner', '9999원', { ...f, request }), /문자수/);
  assert.equal(gets, 1); assert.equal(f.rows.size, 0);
  await assert.rejects(new ZephyrAudioCache().get('owner', '9999원 '.repeat(200).trim(), { ...f, request }), /1,200자/);
  assert.equal(gets, 1); assert.equal(f.rows.size, 0);
});

test('client validates new alignment against the actual spoken currency text, never raw digits', async () => {
  // Synthetic contract fixture only: these bytes are not generated or saved as a reviewed voice.
  const bytes = Buffer.from('synthetic currency audio');
  const base = JSON.parse(readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json', 'utf8'));
  for (const transcript of ['만이천오백원', '12,500원']) {
    const f = setup(); let posts = 0;
    const cache = new ZephyrAudioCache();
    const dependencies = { ...f, includeAlignment: true, request: async (init: RequestInit) => {
      const common = { voice: YEONI_VOICE_NAME, useDeviceVoice: false, remainingCharacters: 1000, enabled: true };
      if (init.method === 'GET') return Response.json(common);
      posts++; const body = JSON.parse(init.body as string);
      assert.equal(body.text, '12,500원');
      return Response.json({ ...common, requestId: body.requestId, audioContent: bytes.toString('base64'),
        alignment: { ...base, spokenText: transcript, textSha256: hash(transcript), audioSha256: hash(bytes) },
      });
    } };
    const result = await cache.get('owner', '12,500원', dependencies);
    assert.equal(Boolean(result.alignment), transcript === '만이천오백원');
    assert.equal(result.audioContent, bytes.toString('base64'));
    await cache.get('owner', '12,500원', dependencies); assert.equal(posts, 1);
  }
});
