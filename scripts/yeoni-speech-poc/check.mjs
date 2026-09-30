import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { server } from './server.mjs';

const kind = process.env.YEONI_BROWSER || 'chromium';
const out = `.e2e/yeoni-speech-poc/${kind}`;
mkdirSync(out, { recursive: true });
const browser = await ({ chromium, webkit })[kind].launch({ headless: true,
  ...(kind === 'chromium' && process.env.YEONI_CHROMIUM ? { executablePath: process.env.YEONI_CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}),
}).catch(async error => { await new Promise(resolve => server.close(resolve)); throw error; });
const context = await browser.newContext({ viewport: { width: 390, height: 950 }, reducedMotion: 'no-preference' });
const requests = [], errors = [], results = [];
let realSpeechClock = null;
await context.route('**/*', route => {
  const url = route.request().url(); requests.push(url);
  if (/^(http:\/\/127\.0\.0\.1:8875\/|blob:|data:)/.test(url)) return route.continue();
  return route.abort();
});
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
const button = name => page.getByRole('button', { name, exact: true });
const state = value => page.locator(`[data-speech-state="${value}"]`).waitFor();
const viseme = value => page.waitForFunction(v => document.querySelector('canvas')?.dataset.viseme === v, value);
const media = fn => page.locator('audio').evaluate(fn);
async function test(name, run) { await run(); results.push({ name, passed: true }); console.log('PASS ' + name); }
async function fixture() { await button('무음 동작 샘플 불러오기').click(); await state('ready'); }
async function seek(time) {
  await page.locator('audio').evaluate((audio, t) => new Promise(resolve => { audio.addEventListener('seeked', resolve, { once: true }); audio.currentTime = t; }), time);
}
async function loadPair({ badHash = false, duration = 8000, invalidAudio = false } = {}) {
  // Independently constructed PCM and manifest exercise the actual user file-input path.
  let audio = Buffer.alloc(44 + 8000 * 8 * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  if (invalidAudio) audio = Buffer.from('not an audio file');
  const hash = v => createHash('sha256').update(v).digest('hex');
  const spokenText = '무음 기술 확인';
  const m = { version: 1, language: 'ko-KR', voice: 'test-silence', spokenText, durationMs: duration,
    audioSha256: badHash ? 'a'.repeat(64) : hash(audio), textSha256: hash(spokenText), alignment: 'synthetic-clock-test',
    cues: [{ startMs: 400, endMs: 1400, phone: 'ㅏ' }] };
  await page.locator('details.checks').evaluate(e => { e.open = true; });
  await page.getByLabel('음성 파일 (최대 8MB)').setInputFiles({ name: 'clock.wav', mimeType: 'audio/wav', buffer: audio });
  await page.getByLabel('발음 타임라인 JSON (최대 1MB)').setInputFiles({ name: 'timing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(m)) });
  await button('선택한 파일 확인').click();
  await page.evaluate(() => window.scrollTo(0, 0));
}
try {
  await page.goto('http://127.0.0.1:8875/'); await page.locator('[data-cat-status="ready"]').waitFor();
  await test('initial no autoplay and explicit non-speech label', async () => {
    await state('empty'); assert.equal(await media(a => a.paused), true); await viseme('rest');
    assert.ok(await page.getByText('무음 기술 샘플 · 한국어 음성 시연이 아닙니다').isVisible());
  });
  await test('six static mouth drawings are distinct without breath or blink movement', async () => {
    const mouths = await page.locator('[data-mouth-shape]').evaluateAll(elements => elements.map(e => ({ shape: e.dataset.mouthShape, pixels: e.toDataURL() })));
    assert.deepEqual(mouths.map(m => m.shape), ['closed', 'a', 'i', 'u', 'e', 'o']);
    assert.equal(new Set(mouths.map(m => m.pixels)).size, 6);
    await page.locator('.mouth-palette').screenshot({ path: `${out}/six-mouths.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
  });
  await test('load creates valid 8-second real media, remains paused', async () => {
    await fixture(); assert.equal(await media(a => a.duration), 8); assert.equal(await media(a => a.paused), true); await viseme('rest');
  });
  await test('actual media clock selects six vowel/lip shapes, neutral and silence after arbitrary seeks', async () => {
    await button('재생').click(); await state('playing');
    for (const [time, shape] of [[.55, 'a'], [1.5, 'o'], [2.7, 'i'], [3.7, 'closed'], [4.7, 'small'], [5.2, 'rest'], [5.7, 'u'], [6.7, 'e']]) {
      await seek(time); await viseme(shape);
      await page.locator('.portrait').screenshot({ path: `${out}/${shape}.png` });
    }
    await seek(.55); await viseme('a');
  });
  await test('pause closes mouth, freezes media; resume keeps position', async () => {
    await button('일시정지').click(); await state('paused'); await viseme('rest');
    const before = await media(a => a.currentTime); await page.waitForTimeout(300);
    assert.equal(await media(a => a.currentTime), before);
    await button('재생').click(); await state('playing'); await page.waitForTimeout(150);
    assert.ok(await media(a => a.currentTime) > before);
  });
  await test('2x playback follows media time rather than wall-clock cue timers', async () => {
    await media(a => { a.playbackRate = 2; }); await seek(1.4);
    assert.equal(await media(a => a.playbackRate), 2);
    await page.waitForFunction(() => { const a = document.querySelector('audio'); return a.currentTime > 1.5 && a.currentTime < 2.1 && document.querySelector('canvas').dataset.viseme === 'o'; });
    await page.waitForFunction(() => { const a = document.querySelector('audio'); return a.currentTime > 2.65 && a.currentTime < 3.3 && document.querySelector('canvas').dataset.viseme === 'i'; });
    await media(a => { a.playbackRate = 1; });
  });
  await test('waiting event closes mouth and playing event resumes (synthetic stall)', async () => {
    await seek(.5); await media(a => a.dispatchEvent(new Event('waiting'))); await viseme('rest');
    await media(a => a.dispatchEvent(new Event('playing'))); await viseme('a');
  });
  await test('hidden event pauses audio, return does not autoplay (synthetic visibility)', async () => {
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await state('paused'); await viseme('rest');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(120); assert.equal(await media(a => a.paused), true);
  });
  await test('stop and natural end reset mouth', async () => {
    await button('처음으로').click(); await state('ready'); assert.equal(await media(a => a.currentTime), 0);
    // A late native pause must not overwrite the explicit rewind-ready intent.
    await media(a => a.dispatchEvent(new Event('pause'))); await state('ready');
    await button('재생').click(); await seek(7.8); await state('ended'); await viseme('rest');
  });
  await test('reload drops audio and does not retain private file/text', async () => {
    await page.reload(); await page.locator('[data-cat-status="ready"]').waitFor(); await state('empty');
    assert.equal(await media(a => a.getAttribute('src')), null);
  });
  await test('actual audio+JSON import, SHA mismatch rejection and recovery', async () => {
    await loadPair(); await state('ready'); await button('재생').click(); await viseme('a');
    await loadPair({ badHash: true }); await state('error'); await viseme('rest');
    assert.equal(await media(a => a.getAttribute('src')), null);
    assert.ok(await page.getByText('음성·발화문과 타임라인이 일치하지 않아요.', { exact: false }).isVisible());
    await fixture(); await state('ready');
  });
  await test('decoded duration mismatch and corrupt audio fail closed', async () => {
    await loadPair({ duration: 7000 }); await state('error');
    await loadPair({ invalidAudio: true }); await state('error');
    assert.equal(await media(a => a.getAttribute('src')), null); await viseme('rest');
  });
  await test('late hash completion cannot revive a superseded file selection', async () => {
    await page.evaluate(() => {
      const subtle = crypto.subtle; window.__digest = subtle.digest.bind(subtle); let first = true;
      subtle.digest = (...args) => {
        if (!first) return window.__digest(...args);
        first = false;
        return new Promise(resolve => { window.__releaseDigest = () => resolve(window.__digest(...args)); });
      };
    });
    await loadPair(); await state('loading');
    await loadPair({ badHash: true }); await state('error');
    await page.evaluate(() => { crypto.subtle.digest = window.__digest; window.__releaseDigest(); });
    await page.waitForTimeout(150); await state('error');
    assert.equal(await media(a => a.getAttribute('src')), null);
  });
  await test('play rejection leaves mouth closed and actionable message', async () => {
    await fixture();
    await media(a => { a.__nativePlay = a.play; a.play = () => Promise.reject(new DOMException('test denial', 'NotAllowedError')); });
    await button('재생').click(); await state('paused'); await viseme('rest');
    assert.ok(await page.getByText('재생 버튼을 다시 눌러 주세요.', { exact: false }).isVisible());
    await media(a => { a.play = a.__nativePlay; });
  });
  await test('stage exit pauses sound; return does not replay', async () => {
    await button('재생').click(); await state('playing'); await button('화면 나가기').click();
    assert.equal(await media(a => a.paused), true); assert.equal(await page.locator('.portrait canvas').count(), 0);
    await button('돌아오기').click(); await page.locator('[data-cat-status="ready"]').waitFor(); await viseme('rest');
  });
  await test('reduced motion and manual motion-off keep closed mouth', async () => {
    await button('재생').click(); await page.emulateMedia({ reducedMotion: 'reduce' }); await viseme('rest');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await button('입 움직임 끄기').click(); await viseme('rest'); assert.equal(await media(a => a.paused), true);
  });
  await test('mobile widths and dark-background visual evidence', async () => {
    await page.locator('details.checks').evaluate(e => { e.open = false; });
    for (const width of [320, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${out}/width-${width}.png`, fullPage: true });
    }
    await button('배경 바꾸기').click(); await page.screenshot({ path: `${out}/dark.png`, fullPage: true });
  });
  await test('saved Zephyr MP3 loads without provider calls, stays paused and declares automatic alignment', async () => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await button('저장된 연이 음성 불러오기').click(); await state('ready');
    assert.ok(Math.abs(await media(a => a.duration) - 5.376) < .1);
    assert.equal(await media(a => a.paused), true);
    await viseme('rest');
    assert.ok(await page.getByText('실제 Zephyr 음성 · 자동 정렬 초안 · 자연스러움 검토 중').isVisible());
    assert.ok(await page.getByText('안녕하세요. 오늘 일정을 알려드릴게요. 오늘은 조금 쉬는 게 좋겠어요.', { exact: true }).isVisible());
  });
  await test('real MP3 natural playback follows 60 acoustic cues and closes at sentence pauses/end', async () => {
    await page.evaluate(() => {
      window.__speechSamples = []; window.__speechRecord = true;
      const collect = () => {
        const a = document.querySelector('audio'), c = document.querySelector('.portrait canvas');
        if (!a.paused && !a.seeking && a.readyState >= 2) window.__speechSamples.push({
          media: a.currentTime * 1000, rendered: Number(c.dataset.speechTimeMs), shape: c.dataset.viseme,
        });
        if (window.__speechRecord) requestAnimationFrame(collect);
      };
      requestAnimationFrame(collect);
    });
    await button('재생').click(); await state('playing');
    await state('ended'); await viseme('rest');
    const samples = await page.evaluate(() => { window.__speechRecord = false; return window.__speechSamples; });
    const timeline = JSON.parse(readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json', 'utf8'));
    const projection = { 'ɐ': 'a', 'ʌ': 'a', i: 'i', j: 'i', e: 'e', o: 'o', m: 'closed', 'sʷ': 'u' };
    let mismatches = 0;
    for (const sample of samples) {
      const cue = timeline.cues.find(c => c.startMs <= sample.rendered && sample.rendered < c.endMs);
      const expected = cue ? (projection[cue.phone] ?? 'small') : 'rest';
      if (sample.shape !== expected) mismatches++;
    }
    const lag = samples.filter(s => s.media > 100 && s.media < 5200).map(s => Math.abs(s.media - s.rendered)).sort((a, b) => a - b);
    assert.ok(samples.length > 30); assert.equal(mismatches, 0);
    assert.ok(lag[Math.floor(lag.length * .95)] <= 100);
    assert.ok(samples.some(s => s.media > 2800 && s.media < 3250 && s.shape === 'rest'));
    for (const shape of ['a', 'e', 'i', 'o', 'closed', 'u']) assert.ok(samples.some(s => s.shape === shape), shape);
    // Connected-token acoustic alignment gives /m/ 80ms and /sʷ/ 70ms.
    // Also exercise these cues at slower media speed below.
    realSpeechClock = { sampleCount: samples.length, mismatches, p95ClockAgeMs: lag[Math.floor(lag.length * .95)],
      maxClockAgeMs: lag.at(-1), observedShapes: [...new Set(samples.map(s => s.shape))],
      unobservedShortShapes: ['closed', 'u'].filter(shape => !samples.some(s => s.shape === shape)),
      scope: 'Media-to-render clock age, NOT phonetic alignment accuracy or speaker/Bluetooth latency.' };
    await page.screenshot({ path: `${out}/real-voice-ended.png`, fullPage: true });
  });
  await test('real MP3 seek, pause and resume reuse the same saved source', async () => {
    await button('처음으로').click(); await button('재생').click();
    await seek(.72); await viseme('o');
    await button('일시정지').click(); await viseme('rest');
    const position = await media(a => a.currentTime); await page.waitForTimeout(100);
    assert.equal(await media(a => a.currentTime), position);
    await button('재생').click(); await state('playing');
    await seek(2.4); await viseme('e');
    await seek(2.9); await viseme('rest');
    await media(a => { a.playbackRate = .25; });
    await seek(3.945); await viseme('closed');
    await seek(4.045); await viseme('u');
    await media(a => { a.playbackRate = 1; });
    await button('처음으로').click(); await state('ready'); await viseme('rest');
  });
  await test('saved-voice review seeks, plays at half speed and stops at context endpoint', async () => {
    const src = await media(a => a.currentSrc);
    await button('0.5배속').click(); assert.equal(await media(a => a.playbackRate), .5);
    await button('조금 쉬는 듣기').click(); await state('playing');
    assert.ok(await media(a => a.currentTime) >= 3.37); await viseme('u');
    await state('paused'); await viseme('rest');
    assert.ok(Math.abs(await media(a => a.currentTime) - 4.41) < .025);
    await page.waitForTimeout(200); assert.equal(await media(a => a.paused), true);
    assert.equal(await media(a => a.currentSrc), src);
    await page.locator('.listening-review').screenshot({ path: `${out}/listening-review.png` });
  });
  await test('review can switch context and speed while playing, then naturally finish', async () => {
    await button('조금 쉬는 듣기').click(); await state('playing');
    await button('좋겠어요 듣기').click();
    assert.ok(await media(a => a.currentTime) >= 4.31);
    await button('정상 속도').click(); assert.equal(await media(a => a.playbackRate), 1);
    await page.waitForFunction(() => { const a = document.querySelector('audio'); return a.paused && a.currentTime >= 5.2; });
    await viseme('rest');
    await page.locator('.review-timing summary').click();
    assert.ok(await page.getByRole('caption').getByText('좋겠어요 · 기존 음성 기준').isVisible());
    assert.equal(await page.locator('.review-timing tbody tr').count(), 10);
    await page.locator('.review-timing summary').click();
  });
  await test('review cancellation survives rewind, background pause and replacing audio', async () => {
    await button('조금 쉬는 듣기').click(); await state('playing');
    await seek(5); assert.ok(await media(a => a.currentTime) >= 5);
    await state('ended'); await viseme('rest');
    await button('조금 쉬는 듣기').click(); await state('playing');
    await button('처음으로').click(); await state('ready');
    await page.waitForTimeout(1100); assert.equal(await media(a => a.currentTime), 0);
    await button('조금 쉬는 듣기').click(); await state('playing');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await state('paused'); const stopped = await media(a => a.currentTime);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1100); assert.equal(await media(a => a.currentTime), stopped);
    await fixture(); assert.equal(await button('조금 쉬는 듣기').isDisabled(), true);
    assert.equal(await media(a => a.playbackRate), 1);
    await button('재생').click(); await page.waitForTimeout(1300); await state('playing');
    assert.ok(await media(a => a.currentTime) < 3); await button('일시정지').click();
  });
  await test('review table fits mobile and reload does not claim listening approval', async () => {
    await button('저장된 연이 음성 불러오기').click(); await state('ready');
    await page.locator('.review-timing summary').click();
    for (const width of [320, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 950 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({ width: 390, height: 950 });
    await page.screenshot({ path: `${out}/listening-review-full.png`, fullPage: true });
    await page.reload(); await state('empty');
    assert.equal(await button('조금 쉬는 듣기').isDisabled(), true);
    assert.ok(await page.getByText('청취 확인 대기', { exact: false }).isVisible());
  });
  await test('no runtime exceptions or external requests', async () => {
    assert.deepEqual(errors, []); assert.ok(requests.every(u => /^(http:\/\/127\.0\.0\.1:8875\/|blob:|data:)/.test(u)));
  });
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ browser: kind, version: browser.version(), results, errors,
    requestCount: requests.length, realSpeechClock, scope: 'Synthetic lifecycle + saved Zephyr MP3 media-clock checks. Automatic phoneme alignment remains listening-review pending; no physical iPhone validation.' }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
