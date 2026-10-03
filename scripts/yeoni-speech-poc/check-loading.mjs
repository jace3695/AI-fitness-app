// Focused continuation of the 2026-10-01 checkpoint. Reuses the saved MP3 and
// artwork; does not rerun the original 61 checks or generate review media.
import { chromium, webkit } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const kind = process.env.YEONI_BROWSER || 'webkit';
const startedAt = new Date().toISOString();
const out = process.env.YEONI_LOADING_OUTPUT || `.e2e/yeoni-loading/${kind}`;
const selected = process.env.YEONI_LOADING_FILTER ? new RegExp(process.env.YEONI_LOADING_FILTER) : null;
mkdirSync(out, { recursive: true });
const { server } = await import('../yeoni-human-speech/server.mjs');
const origin = 'http://127.0.0.1:8879/';
const browser = await ({ chromium, webkit })[kind].launch({ headless: true,
  ...(kind === 'webkit' && process.env.YEONI_WEBKIT ? { executablePath: process.env.YEONI_WEBKIT } : {}),
  ...(kind === 'chromium' && process.env.YEONI_CHROMIUM ? {
    executablePath: process.env.YEONI_CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  } : {}),
}).catch(async error => { await new Promise(done => server.close(done)); throw error; });
const context = await browser.newContext({ viewport: { width: 390, height: 950 }, reducedMotion: 'no-preference' });
const results = [], errors = [], externalRequests = [], replacements = [];
const savedAudio = readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3');
const savedManifest = JSON.parse(readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json', 'utf8'));
let page, clockEvidence = null, timeoutElapsedMs = null;
await context.addInitScript(() => {
  window.__metadataEvents = [];
  for (const type of ['loadedmetadata', 'durationchange', 'error']) document.addEventListener(type, event => {
    const a = event.target;
    if (a instanceof HTMLAudioElement) window.__metadataEvents.push({
      type, atMs: performance.now(), duration: a.duration, state: document.querySelector('[data-speech-state]')?.dataset.speechState,
      src: a.getAttribute('src'), currentSrc: a.currentSrc,
    });
  }, true);
});
await context.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith(origin) || /^(file:|data:|blob:)/.test(url)) return route.continue();
  externalRequests.push(url); return route.abort();
});
const button = name => page.getByRole('button', { name, exact: true });
const state = value => page.locator(`[data-speech-state="${value}"]`).waitFor({ state: 'attached' });
const media = fn => page.locator('audio').evaluate(fn);
async function open(url = origin) {
  if (page) await page.close();
  page = await context.newPage(); page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('audio').waitFor({ state: 'attached' }); await state('empty');
  assert.ok((await page.locator('body').innerText()).trim().length > 0);
}
async function test(name, run) {
  if (selected && !selected.test(name)) return;
  try { await run(); results.push({ name, passed: true }); console.log('PASS '+name); }
  catch (error) {
    results.push({ name, passed: false, error: String(error), metadataEvents: await page?.evaluate(() => window.__metadataEvents).catch(() => []) });
    throw error;
  }
}
async function provisional(duration = 0, loadButton = '저장된 연이 음성 불러오기') {
  await page.locator('audio').evaluate((a, value) => Object.defineProperty(a, 'duration', { value, configurable: true }), duration);
  await button(loadButton).click();
  await page.waitForFunction(() => window.__metadataEvents.some(e => e.type === 'loadedmetadata' && e.currentSrc && e.currentSrc === e.src));
  await state('loading');
  assert.equal(await media(a => a.paused), true);
  assert.ok(await media(a => !!a.getAttribute('src')));
}
async function release(event = 'durationchange', duration = null) {
  await page.locator('audio').evaluate((a, { event, duration }) => {
    delete a.duration;
    if (duration !== null) Object.defineProperty(a, 'duration', { value: duration, configurable: true });
    a.dispatchEvent(new Event(event));
  }, { event, duration });
}
async function importPair({ mismatch = false, corrupt = false } = {}) {
  const bytes = corrupt ? Buffer.from('invalid audio for decoder rejection') : savedAudio;
  const manifest = { ...savedManifest, audioSha256: createHash('sha256').update(bytes).digest('hex'),
    durationMs: savedManifest.durationMs + (mismatch ? 250 : 0) };
  await page.locator('details.checks').evaluate(e => { e.open = true; });
  await page.getByLabel('음성 파일 (최대 8MB)').setInputFiles({ name: 'saved.mp3', mimeType: 'audio/mpeg', buffer: bytes });
  await page.getByLabel('발음 타임라인 JSON (최대 1MB)').setInputFiles({ name: 'timing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) });
  await button('선택한 파일 확인').click();
}

try {
  await test('provisional zero waits for durationchange without autoplay', async () => {
    await open(); await provisional();
    assert.equal(await button('재생').isDisabled(), true);
    await release(); await state('ready');
    assert.equal(await media(a => a.paused), true);
    assert.ok(Math.abs(await media(a => a.duration) * 1000 - savedManifest.durationMs) <= 100);
    await button('재생').click(); await state('playing');
    await media(a => { a.dispatchEvent(new Event('durationchange')); a.dispatchEvent(new Event('loadedmetadata')); });
    await state('playing'); // Repeated metadata must not reset active playback.
    await button('일시정지').click(); await state('paused');
  });
  await test('unknown infinite and negative lengths remain pending until valid metadata', async () => {
    for (const duration of [NaN, Infinity, -1]) {
      await open(); await provisional(duration); await release('loadedmetadata'); await state('ready');
      assert.equal(await media(a => a.paused), true);
    }
  });
  await test('a positive duration discovered without another metadata event becomes ready', async () => {
    await open(); await provisional();
    const count = await page.evaluate(() => window.__metadataEvents.length);
    await media(a => { delete a.duration; });
    await state('ready');
    assert.equal(await page.evaluate(() => window.__metadataEvents.length), count);
    assert.equal(await media(a => a.paused), true);
  });
  await test('zero followed by a positive length outside tolerance is rejected', async () => {
    await open(); await provisional(); await release('durationchange', savedManifest.durationMs / 1000 + .101);
    await state('error'); assert.equal(await media(a => a.getAttribute('src')), null);
    assert.ok(await page.getByText('음성 길이와 타임라인이 맞지 않아요.', { exact: false }).isVisible());
  });
  await test('positive codec difference inside 100ms tolerance remains accepted', async () => {
    await open(); await provisional(); await release('durationchange', savedManifest.durationMs / 1000 + .099);
    await state('ready'); assert.equal(await media(a => a.paused), true);
  });
  await test('real MP3 import accepts matching timeline and rejects mismatched timeline and corrupt audio', async () => {
    await open(); await importPair(); await state('ready');
    await importPair({ mismatch: true }); await state('error');
    assert.equal(await media(a => a.getAttribute('src')), null);
    await importPair({ corrupt: true }); await state('error');
    await page.getByText('음성을 읽지 못했어요. 파일을 다시 확인해 주세요.', { exact: false }).waitFor();
    assert.equal(await media(a => a.getAttribute('src')), null);
    await importPair(); await state('ready');
  });
  await test('15-second load timeout survives provisional zero and late metadata cannot revive failed audio', async () => {
    await open(); const start = Date.now(); await provisional();
    await state('error'); const elapsedMs = Date.now() - start;
    assert.ok(elapsedMs >= 14_500 && elapsedMs < 19_000, `timeout elapsed ${elapsedMs}ms`);
    assert.ok(await page.getByText('음성을 불러오는 시간이 길어졌어요.', { exact: false }).isVisible());
    assert.equal(await media(a => a.getAttribute('src')), null);
    await release(); await state('error');
    await button('저장된 연이 음성 불러오기').click(); await state('ready');
    timeoutElapsedMs = elapsedMs;
  });
  await test('replacing an unresolved source discards it and recovers without autoplay', async () => {
    await open(); await provisional(); const oldSrc = await media(a => a.getAttribute('src'));
    await media(a => { delete a.duration; });
    await button('무음 동작 샘플 불러오기').click(); await state('ready');
    assert.notEqual(await media(a => a.getAttribute('src')), oldSrc);
    assert.equal(await media(a => a.duration), 8);
    assert.equal(await media(a => a.paused), true);
  });
  await test('twelve native WAV-to-MP3 replacements retain ready state after pause', async () => {
    await open();
    for (let i = 0; i < 12; i++) {
      await button('무음 동작 샘플 불러오기').click(); await state('ready');
      await button('재생').click(); await state('playing');
      await page.waitForTimeout(80); await button('일시정지').click(); await state('paused');
      const startEvent = await page.evaluate(() => window.__metadataEvents.length);
      await button('저장된 연이 음성 불러오기').click(); await state('ready');
      const sample = await media(a => ({ durationMs: a.duration * 1000, paused: a.paused }));
      assert.ok(Math.abs(sample.durationMs - savedManifest.durationMs) <= 100);
      assert.equal(sample.paused, true);
      replacements.push({ iteration: i + 1, ...sample,
        metadataEvents: await page.evaluate(start => window.__metadataEvents.slice(start), startEvent) });
    }
  });
  await test('native saved MP3 plays to end with shared media-clock visemes after replacement', async () => {
    await page.evaluate(() => {
      window.__samples = []; window.__record = true;
      function sample() {
        const a = document.querySelector('audio'), c = document.querySelector('.portrait canvas');
        if (!a.paused && !a.seeking && a.readyState >= 2) window.__samples.push({
          media: a.currentTime * 1000, rendered: Number(c.dataset.speechTimeMs), shape: c.dataset.viseme });
        if (window.__record) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await button('재생').click(); await state('playing'); await state('ended');
    const samples = await page.evaluate(() => { window.__record = false; return window.__samples; });
    assert.ok(samples.length > 30);
    const projection = { 'ɐ': 'a', 'ʌ': 'a', i: 'i', j: 'i', e: 'e', o: 'o', m: 'closed', 'sʷ': 'u' };
    const mismatches = samples.filter(sample => {
      const cue = savedManifest.cues.find(c => c.startMs <= sample.rendered && sample.rendered < c.endMs);
      return sample.shape !== (cue ? (projection[cue.phone] ?? 'small') : 'rest');
    });
    assert.equal(mismatches.length, 0);
    await page.waitForFunction(() => document.querySelector('.portrait canvas').dataset.viseme === 'rest');
    clockEvidence = { sampleCount: samples.length, mismatches: mismatches.length, samples };
  });
  for (const [phase, path, loadButton, playButton, pauseButton] of [
    [5, 'docs/yeoni-phase5/Yeoni_Lip_Sync_Dev_Preview.html', '저장된 연이 음성 불러오기', '재생', '일시정지'],
    [6, 'docs/yeoni-phase6/Yeoni_Emotion_Gesture_Preview.html', '저장 음성 불러오기', '립싱크 함께 보기', '음성 멈추기'],
    [9, 'docs/yeoni-phase9/Yeoni_Human_Speech_Preview.html', '저장된 연이 음성 불러오기', '재생', '일시정지'],
  ]) await test(`phase ${phase} offline bundle waits for valid duration then plays without external requests`, async () => {
    await open(pathToFileURL(resolve(path)).href);
    if (phase === 6) {
      await page.locator('details.checks').evaluate(e => { e.open = true; });
      await button('움직임 켜기').click();
    }
    await provisional(0, loadButton); await release(); await state('ready');
    assert.equal(await media(a => a.paused), true);
    await button(playButton).click(); await state('playing');
    await button(pauseButton).click(); await state('paused');
  });
  await test('no runtime exceptions or external requests in focused flow', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  });
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ browser: kind, version: browser.version(),
    startedAt, finishedAt: new Date().toISOString(), timeoutElapsedMs,
    filter: process.env.YEONI_LOADING_FILTER || null,
    results, replacements, clockEvidence, errors, externalRequests,
    scope: 'Focused loading regression on shared human source and phase5/6/9 offline bundles. Metadata fault injection is synthetic; replacement and saved MP3 playback use native media. Existing artwork/video comparisons were reused, not rerun. No listening approval or physical iPhone verification.' }, null, 2));
  await browser.close(); await new Promise(done => server.close(done));
}
