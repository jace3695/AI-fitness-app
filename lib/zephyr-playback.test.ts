import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareZephyrSpeech, ZephyrAudioCache } from './zephyr-playback.ts';
import { YEONI_VOICE_NAME } from './yeoni-voice-policy.ts';

const policy = { voice: YEONI_VOICE_NAME, useDeviceVoice: false };
test('speech preserves numeric ranges before stripping Markdown', () => {
  for (const [input, expected] of [
    ['다음 운동은 턱걸이 자세 연습 1~2분입니다.', '다음 운동은 턱걸이 자세 연습 1분에서 2분입니다.'],
    ['**10 ~ 15초** · 8～10회 · 1〜2세트', '10초에서 15초 · 8회에서 10회 · 1세트에서 2세트'],
    ['1분~2분, 0.5~1kg, 1~2주차', '1분에서 2분, 0.5kg에서 1kg, 1주차에서 2주차'],
    ['~~취소선~~ 12분, 1~2 사이', '취소선 12분, 1에서 2 사이'],
  ]) {
    const result = prepareZephyrSpeech(input);
    assert.equal(result.text, expected);
    assert.equal(result.characters, Array.from(expected).length);
  }
});
function fixture() {
  const rows = new Map<string, string>();
  const calls: RequestInit[] = [];
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
  const request = async (init: RequestInit) => {
    calls.push(init);
    if (init.method === 'GET') return Response.json({ ...policy, enabled: true, remainingCharacters: 1000 });
    const { requestId } = JSON.parse(init.body as string);
    return Response.json({ ...policy, requestId, audioContent: 'SUQz', remainingCharacters: 990 });
  };
  return { rows, calls, storage, request, now: new Date('2026-09-16T01:00:00Z') };
}

test('speech limits Unicode characters and discloses truncation without sending links', () => {
  const speech = prepareZephyrSpeech(' **안녕** https://example.com/private\n' + '😀'.repeat(1300));
  assert.equal(Array.from(speech.text).length, 1200); assert.equal(speech.characters, 1200);
  assert.ok(speech.truncated); assert.ok(speech.text.startsWith('안녕 화면의 링크 '));
  assert.ok(!speech.text.includes('example.com')); assert.ok(speech.text.endsWith('😀'));
});

test('simultaneous buttons share one synthesis and cached replay sends no new requests', async () => {
  const cache = new ZephyrAudioCache(); const f = fixture();
  const values = await Promise.all(Array.from({ length: 15 }, () => cache.get('owner', '동일 답변', f)));
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].method, 'POST');
  assert.match(JSON.parse(f.calls[1].body as string).requestId, /^[a-f0-9-]{14}4[a-f0-9-]{21}$/);
  assert.ok(values.every(value => value.audioContent === 'SUQz'));
  await cache.get('owner', '동일 답변', f); assert.equal(f.calls.length, 2);
  assert.ok(!JSON.stringify([...f.rows]).includes('동일 답변')); assert.ok(!JSON.stringify([...f.rows]).includes('owner'));
});

test('lost response cannot be synthesized again after cache loss or reload', async () => {
  const f = fixture();
  const request = async (init: RequestInit) => { if (init.method === 'POST') { f.calls.push(init); throw new TypeError('Response lost'); } return f.request(init); };
  await assert.rejects(new ZephyrAudioCache().get('owner', '응답 유실', { ...f, request }), /Response lost/);
  await assert.rejects(new ZephyrAudioCache().get('owner', '응답 유실', f), /이미 음성 생성을 요청/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});

test('a disabled or insufficient allowance sends no text and remains checkable', async () => {
  for (const status of [{ enabled: false, code: 'MONTH_LIMIT', message: '월 한도 도달' }, { enabled: true, remainingCharacters: 1 }]) {
    const f = fixture(); const cache = new ZephyrAudioCache();
    let reads = 0;
    const request = async (init: RequestInit) => { assert.equal(init.method, 'GET'); reads++; return Response.json({ ...policy, ...status }); };
    await assert.rejects(cache.get('owner', '긴 답변', { ...f, request }), /한도|문자수/);
    await assert.rejects(cache.get('owner', '긴 답변', { ...f, request }), /한도|문자수/);
    assert.equal(reads, 2); assert.equal(f.rows.size, 0);
  }
});

test('unavailable attempt storage fails before synthesis', async () => {
  const f = fixture();
  await assert.rejects(new ZephyrAudioCache().get('owner', '보관 실패', { ...f, storage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } } }), /보관할 수 없어/);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
});

test('provider failure or wrong voice is not retried and never falls back', async () => {
  for (const failure of ['http', 'voice', 'receipt', 'audio']) {
    const f = fixture();
    const request = async (init: RequestInit) => {
      const response = await f.request(init); if (init.method === 'GET') return response;
      if (failure === 'http') return Response.json({ error: '공급자 응답 실패' }, { status: 502 });
      const data = await response.json();
      if (failure === 'voice') data.voice = 'device';
      if (failure === 'receipt') data.requestId = crypto.randomUUID();
      if (failure === 'audio') data.audioContent = '<invalid>';
      return Response.json(data);
    };
    await assert.rejects(new ZephyrAudioCache().get('owner', '실패 답변', { ...f, request }));
    await assert.rejects(new ZephyrAudioCache().get('owner', '실패 답변', f), /이미 음성/);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  }
});

test('audio is isolated by owner and month; cache eviction preserves attempt receipts', async () => {
  const f = fixture(); const cache = new ZephyrAudioCache();
  await cache.get('one', '같은 답변', f); await cache.get('two', '같은 답변', f);
  await cache.get('one', '같은 답변', { ...f, now: new Date('2026-10-02T00:00:00Z') });
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 3);
  for (let i = 0; i < 8; i++) await cache.get('one', `다른 답변 ${i}`, f);
  await assert.rejects(cache.get('one', '같은 답변', f), /이미 음성/);
  cache.clear(); await assert.rejects(cache.get('two', '같은 답변', f), /이미 음성/);
});

test('short workout audio survives reload and memory eviction without generating again', async () => {
  const f = { ...fixture(), retainWorkoutAudio: true };
  await new ZephyrAudioCache().get('owner', '45초 휴식을 시작합니다.', f);
  const replay = await new ZephyrAudioCache().get('owner', '45초 휴식을 시작합니다.', f);
  assert.equal(replay.audioContent, 'SUQz');
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  await assert.rejects(new ZephyrAudioCache().get('owner', '45초 휴식을 시작합니다.', { ...f, retainWorkoutAudio: false }), /이미 음성/);
  await new ZephyrAudioCache().get('other-owner', '45초 휴식을 시작합니다.', f);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 2);
});

test('workout retention never retries a lost or corrupt response and tolerates a full audio store', async () => {
  const f = { ...fixture(), retainWorkoutAudio: true };
  const request = async (init: RequestInit) => {
    if (init.method === 'POST') { f.calls.push(init); throw new TypeError('Response lost'); }
    return f.request(init);
  };
  await assert.rejects(new ZephyrAudioCache().get('owner', '응답 유실', { ...f, request }));
  await assert.rejects(new ZephyrAudioCache().get('owner', '응답 유실', f), /이미 음성/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  const full = { ...fixture(), retainWorkoutAudio: true };
  const storage = { getItem: full.storage.getItem, setItem: (key: string, value: string) => {
    if (value.startsWith('{')) throw new Error('QuotaExceeded');
    full.storage.setItem(key, value);
  } };
  const cache = new ZephyrAudioCache();
  assert.equal((await cache.get('owner', '안내', { ...full, storage })).audioContent, 'SUQz');
  assert.equal((await cache.get('owner', '안내', { ...full, storage })).audioContent, 'SUQz');
  await assert.rejects(new ZephyrAudioCache().get('owner', '안내', full), /이미 음성/);
  for (const key of f.rows.keys()) f.rows.set(key, JSON.stringify({ voice: 'device', audioContent: 'SUQz', remainingCharacters: 10 }));
  await assert.rejects(new ZephyrAudioCache().get('owner', '응답 유실', f), /이미 음성/);
});
