import { chromium, webkit } from 'playwright';
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const kind = process.env.YEONI_BROWSER || 'chromium', baseline = '2e4a2c30f9bca55a800f57f15f942082bf7e670b';
const out = process.env.YEONI_JAPANESE_OUTPUT || `.e2e/yeoni-japanese/${kind}`; mkdirSync(out, { recursive: true });
const config = { entryPoints: ['scripts/yeoni-japanese/probe.ts'], bundle: true, write: false, format: 'iife', tsconfig: 'tsconfig.json' };
const probe = await build({ ...config, globalName: 'languageReview' });
const old = await build({ ...config, globalName: 'oldLanguageReview', plugins: [{ name: 'committed-korean-behavior', setup(b) {
  b.onLoad({ filter: /\/lib\/yeoni\/(lip-sync|mouth-motion)\.ts$/ }, args => ({ loader: 'ts', resolveDir: dirname(args.path),
    contents: execFileSync('git', ['show', `${baseline}:${relative(process.cwd(), args.path)}`], { encoding: 'utf8' }) }));
} }] });
const executablePath = kind === 'webkit' ? process.env.YEONI_WEBKIT : process.env.YEONI_CHROMIUM;
const browser = await ({ chromium, webkit })[kind].launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...(kind === 'chromium' ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 1400 }, reducedMotion: 'no-preference' });
const page = await context.newPage(), errors = [], external = [], results = [], switches = [];
let samples, fileSample, resourceBaseline, koreanComparisonCount, replacements = 0;
page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
await context.route('**/*', r => /^(file:|blob:|data:)/.test(r.request().url()) ? r.continue() : (external.push(r.request().url()), r.abort()));
await context.addInitScript(() => {
  const pending = new Set(), active = new Set(); let created = 0;
  const raf = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = fn => { const id = raf(t => { pending.delete(id); fn(t); }); pending.add(id); return id; };
  window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  for (const name of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
    const Native = window[name]; window[name] = class extends Native {
      observe(...args) { const [target, options] = args;
        const owned = name === 'MutationObserver' ? target === document.body && options?.attributeFilter?.join(',') === 'aria-modal,open'
          : target instanceof HTMLElement && !!target.querySelector('canvas');
        if (owned) { if (!this.owned) created++; this.owned = true; active.add(this); } return super.observe(...args);
      }
      disconnect() { active.delete(this); return super.disconnect(); }
    };
  }
  window.__resources = () => ({ raf: pending.size, observers: active.size, created });
});
const button = name => page.getByRole('button', { name, exact: true });
const canvas = () => page.locator('[data-appearance-status] canvas');
const state = name => page.locator(`[data-speech-state="${name}"]`).waitFor({ state: 'attached' });
const ready = skin => page.waitForFunction(s => document.querySelector('[data-appearance-status]')?.dataset.appearanceStatus === 'ready' && document.querySelector('[data-appearance-status] canvas')?.dataset.appearance === s, skin);
const swap = async skin => { await button(skin === 'cat' ? '고양이형' : '인간형').click(); await ready(skin); };
const rest = () => page.waitForFunction(() => document.querySelector('[data-appearance-status] canvas')?.dataset.viseme === 'rest');
const audio = () => page.locator('audio').evaluate(a => ({ src: a.currentSrc, time: a.currentTime, paused: a.paused, rate: a.playbackRate }));
const jp = '일본어 입 모양 점검 (무음)', kr = '저장된 연이 음성 불러오기';
const language = value => page.locator(`[data-speech-language="${value}"]`).waitFor();
async function test(name, run) { try { await run(); results.push({ name, passed: true }); console.log('PASS ' + name); } catch (e) { results.push({ name, passed: false, error: String(e) }); throw e; } }
async function files(bytes, manifest, mime = 'audio/wav') {
  await page.locator('input[type=file]').nth(0).setInputFiles({ name: mime === 'audio/wav' ? 'clock.wav' : 'voice.mp3', mimeType: mime, buffer: bytes });
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'timeline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) });
  await button('선택한 파일 확인').click();
}
try {
  await page.goto(pathToFileURL(resolve('docs/yeoni-phase12/Yeoni_Japanese_LipSync_Preview.html')).href); await ready('cat');
  await page.addScriptTag({ content: probe.outputFiles[0].text }); await page.addScriptTag({ content: old.outputFiles[0].text }); await page.evaluate(() => languageReview.init());
  fileSample = await page.evaluate(() => languageReview.fileFixture());
  await test('new preview clearly distinguishes Japanese silent clock from real Korean speech', async () => {
    await state('empty'); assert.equal(await canvas().count(), 1); assert.equal(await page.locator('audio').count(), 1);
    assert.match(await page.locator('.intro').textContent(), /일본어는 무음/); assert.equal((await audio()).src, '');
    resourceBaseline = await page.evaluate(() => window.__resources()); assert.equal(resourceBaseline.observers, 3);
    await page.evaluate(() => { window.__canvas = document.querySelector('[data-appearance-status] canvas'); window.__audio = document.querySelector('audio'); });
  });
  await test('every sampled Korean v1 raw and smoothed pose matches the committed PHASE 11 baseline', async () => {
    const r = await page.evaluate(() => ({ current: languageReview.koreanFrames(), previous: oldLanguageReview.koreanFrames() }));
    assert.deepEqual(r.current, r.previous); koreanComparisonCount = r.current.length; assert.ok(koreanComparisonCount > 500);
  });
  await test('Japanese v2 clock loads without auto-play and declares its non-speech status', async () => {
    await button(jp).click(); await state('ready'); await language('ja-JP'); await rest(); assert.equal((await audio()).paused, true);
    assert.match(await page.locator('.sample-badge').textContent(), /무음.*실제 발화가 아닙니다/);
    assert.equal(await page.locator('.listening-review').count(), 0);
  });
  await test('Japanese native media clock drives exact poses during 12 appearance switches with one host', async () => {
    await page.evaluate(() => { window.__events = []; window.__samples = []; const a = window.__audio; let seen;
      for (const name of ['emptied', 'loadstart', 'seeking', 'pause', 'play']) a.addEventListener(name, () => window.__events.push(name));
      window.__sampler = setInterval(() => { const c = window.__canvas;
        if (!a.paused && !a.seeking && c.dataset.draws !== seen) { seen = c.dataset.draws; const time = Number(c.dataset.speechTimeMs);
          window.__samples.push({ skin: c.dataset.appearance, time, mediaTime: a.currentTime * 1000, pose: JSON.parse(c.dataset.mouthPose), viseme: c.dataset.viseme, expected: languageReview.expected(time, 'ja-JP') }); }
      }, 10);
    });
    await button('재생').click(); await state('playing'); await page.evaluate(() => { window.__events = []; });
    for (let i = 0; i < 12; i++) { const before = await audio(), skin = i % 2 ? 'cat' : 'human'; await swap(skin); const after = await audio();
      assert.equal(after.src, before.src); assert.ok(!after.paused && after.time >= before.time && after.time - before.time < 1.5); switches.push({ skin, before: before.time, after: after.time }); }
    assert.deepEqual(await page.evaluate(() => window.__events), []);
    const r = await page.evaluate(() => window.__resources()); assert.equal(r.created, resourceBaseline.created); assert.equal(r.observers, 3); assert.equal(r.raf, 1);
    await state('ended'); await rest(); samples = await page.evaluate(() => { clearInterval(window.__sampler); return window.__samples; }); assert.ok(samples.length > 80);
    for (const row of samples) { assert.deepEqual(row.pose, row.expected.mouth); assert.equal(row.viseme, row.expected.viseme); }
    for (const shape of ['a', 'i', 'u', 'e', 'o', 'closed', 'rest', 'small']) assert.ok(samples.some(s => s.viseme === shape), shape);
  });
  await test('Japanese paused/ended switches, half-speed and backward seeks keep current media state', async () => {
    const ended = await audio(); await swap('human'); assert.deepEqual(await audio(), ended);
    await page.locator('audio').evaluate(a => { a.currentTime = 2.3; a.playbackRate = .5; }); await button('일시정지').click(); await state('paused');
    const paused = await audio(); await swap('cat'); assert.deepEqual(await audio(), paused);
    await button('재생').click(); await state('playing'); await page.locator('audio').evaluate(a => { a.currentTime = .4; }); await page.waitForTimeout(150); await swap('human');
    const row = await canvas().evaluate(c => ({ time: Number(c.dataset.speechTimeMs), mouth: JSON.parse(c.dataset.mouthPose), expected: languageReview.expected(Number(c.dataset.speechTimeMs), 'ja-JP').mouth }));
    assert.deepEqual(row.mouth, row.expected); assert.ok(row.time >= 400 && row.time < 1200); assert.equal((await audio()).rate, .5);
    await button('일시정지').click(); await rest(); await page.locator('audio').evaluate(a => { a.playbackRate = 1; });
  });
  await test('12 Korean MP3 / Japanese WAV replacements retain canvas and never auto-play the new clip', async () => {
    const koBytes = readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3'); const koManifest = JSON.parse(readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json', 'utf8'));
    await page.locator('.checks').last().evaluate(e => { e.open = true; });
    for (let i = 0; i < 12; i++) {
      await button('재생').click(); await state('playing'); const japanese = i % 2 === 1;
      await files(japanese ? Buffer.from(fileSample.bytes) : koBytes, japanese ? fileSample.manifest : koManifest, japanese ? 'audio/wav' : 'audio/mpeg');
      await state('ready'); await language(japanese ? 'ja-JP' : 'ko-KR'); await rest();
      const a = await audio(); assert.equal(a.paused, true); assert.equal(a.time, 0); replacements++;
    }
    assert.ok(await page.evaluate(() => window.__audio === document.querySelector('audio') && window.__canvas === document.querySelector('[data-appearance-status] canvas')));
    await page.locator('.checks').last().evaluate(e => { e.open = false; }); await page.evaluate(() => window.scrollTo(0, 0));
  });
  await test('wrong version, convention, language, voice, hashes and duration are rejected then recover', async () => {
    await page.locator('.checks').last().evaluate(e => { e.open = true; });
    for (const patch of [{ version: 1 }, { phoneSet: 'IPA' }, { language: 'ko-KR' }, { voice: 'ko-KR-Chirp3-HD-Zephyr', alignment: 'automatic-phonemes' },
      { spokenText: '変更した文章' }, { audioSha256: 'a'.repeat(64) }, { cues: [{ startMs: 0, endMs: 100, phone: 'ㅏ' }] }, { durationMs: 9500 }]) {
      await files(Buffer.from(fileSample.bytes), { ...fileSample.manifest, ...patch }); await state('error'); await rest(); assert.equal(await page.locator('audio').getAttribute('src'), null); assert.equal((await audio()).paused, true); assert.equal(await button('재생').isDisabled(), true);
      assert.equal(await page.locator('[data-speech-language]').getAttribute('data-speech-language'), '');
    }
    await files(Buffer.from(fileSample.bytes), fileSample.manifest); await state('ready'); await language('ja-JP');
    await page.locator('.checks').last().evaluate(e => { e.open = false; }); await page.evaluate(() => window.scrollTo(0, 0));
  });
  await test('rapid Korean/Japanese requests apply only the last selection without stale review controls', async () => {
    for (const last of [kr, jp]) {
      await page.evaluate(({ kr, jp, last }) => {
        const click = label => [...document.querySelectorAll('button')].find(b => b.textContent === label).click();
        click(jp); click(kr); click(jp); click(last);
      }, { kr, jp, last });
      await state('ready'); await language(last === kr ? 'ko-KR' : 'ja-JP'); assert.equal((await audio()).paused, true);
      assert.equal(await page.locator('.listening-review').count(), last === kr ? 1 : 0);
    }
  });
  await test('reduced motion, offscreen and hidden-page policies remain effective for Japanese', async () => {
    await button('재생').click(); await state('playing'); await page.emulateMedia({ reducedMotion: 'reduce' }); await rest();
    await page.waitForFunction(() => window.__resources().raf === 0); await swap('cat'); await rest(); await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { const e = document.createElement('div'); e.id = 'spacer'; e.style.height = '3000px'; document.body.append(e); window.scrollTo(0, document.body.scrollHeight); });
    await page.waitForFunction(() => window.__canvas.dataset.running === 'false'); await rest();
    await page.evaluate(() => { document.querySelector('#spacer').remove(); window.scrollTo(0, 0); Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await state('paused'); await rest(); await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); assert.equal((await audio()).paused, true);
  });
  await test('leaving/remounting releases resources and preserves the selected clip without resuming', async () => {
    const before = await audio(); await button('화면 나가기').click(); assert.equal(await canvas().count(), 0);
    assert.deepEqual(await page.evaluate(() => ({ raf: window.__resources().raf, observers: window.__resources().observers })), { raf: 0, observers: 0 });
    await button('돌아오기').click(); await ready('cat'); await rest(); assert.equal((await audio()).src, before.src); assert.equal((await audio()).paused, true);
  });
  await test('Japanese text and both appearances fit 320/390/1280px', async () => {
    for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 1100 });
      for (const skin of ['cat', 'human']) { await swap(skin); await page.evaluate(() => window.scrollTo(0, 0)); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.ok(await canvas().evaluate(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((a, i) => i % 4 === 3 && a > 0)));
        if (width === 390) await page.locator('main').screenshot({ path: `${out}/${skin}-390.png` }); }
    }
  });
  await test('reload removes local clip selection and does not auto-resume speech', async () => { await page.reload(); await ready('cat'); await state('empty'); assert.equal((await audio()).src, ''); });
  await test('no runtime errors or external requests', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); });
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ browser: kind, version: browser.version(), baseline, results, errors, external, switches, samples, koreanComparisonCount, replacements,
    scope: 'Japanese v2 input and synthetic SILENT media-clock integration. No Japanese speech generated, aligned or listening-verified. Existing Korean MP3 v1 compatibility verified.' }, null, 2) + '\n');
  await browser.close();
}
