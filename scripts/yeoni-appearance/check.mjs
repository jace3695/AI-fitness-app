import { chromium, webkit } from 'playwright';
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const kind = process.env.YEONI_BROWSER || 'chromium';
const out = process.env.YEONI_APPEARANCE_OUTPUT || `.e2e/yeoni-appearance/${kind}`; mkdirSync(out, { recursive: true });
const probe = await build({ entryPoints: ['scripts/yeoni-appearance/probe.ts'], bundle: true, write: false, format: 'iife', globalName: 'appearanceReview', loader: { '.mp3': 'base64' }, tsconfig: 'tsconfig.json' });
const executablePath = kind === 'webkit' ? process.env.YEONI_WEBKIT : process.env.YEONI_CHROMIUM;
const browser = await ({ chromium, webkit })[kind].launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...(kind === 'chromium' ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 1400 }, reducedMotion: 'no-preference' });
const page = await context.newPage(), errors = [], external = [], results = [], switches = [];
let samples, parity, continuity, lifecycle, resourceBaseline;
page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
await context.route('**/*', r => /^(file:|blob:|data:)/.test(r.request().url()) ? r.continue() : (external.push(r.request().url()), r.abort()));
await context.addInitScript(() => {
  const pending = new Set(), active = new Set(); let created = 0;
  const raf = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = fn => { const id = raf(t => { pending.delete(id); fn(t); }); pending.add(id); return id; };
  window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  for (const name of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
    const Native = window[name]; window[name] = class extends Native {
      observe(...args) {
        const [target, options] = args;
        const owned = name === 'MutationObserver' ? target === document.body && options?.attributeFilter?.join(',') === 'aria-modal,open'
          : target instanceof HTMLElement && !!target.querySelector('canvas');
        if (owned) { if (!this.owned) created++; this.owned = true; active.add(this); }
        return super.observe(...args);
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
async function test(name, run) { try { await run(); results.push({ name, passed: true }); console.log('PASS ' + name); } catch (e) { results.push({ name, passed: false, error: String(e) }); throw e; } }
try {
  await page.goto(pathToFileURL(resolve('docs/yeoni-phase11/Yeoni_Appearance_Switch_Preview.html')).href); await ready('cat');
  await page.addScriptTag({ content: probe.outputFiles[0].text });
  await test('offline preview has one visible canvas, one audio and one host', async () => {
    await state('empty'); assert.equal(await canvas().count(), 1); assert.equal(await page.locator('audio').count(), 1);
    resourceBaseline = await page.evaluate(() => window.__resources()); assert.equal(resourceBaseline.observers, 3);
    await page.evaluate(() => { window.__canvas = document.querySelector('[data-appearance-status] canvas'); window.__audio = document.querySelector('audio'); });
  });
  await test('12 native MP3 appearance switches preserve source, time, playback and renderer host', async () => {
    await button('저장된 연이 음성 불러오기').click(); await state('ready');
    await page.evaluate(() => {
      window.__events = []; window.__samples = []; const a = document.querySelector('audio');
      for (const name of ['emptied', 'loadstart', 'seeking', 'pause', 'play']) a.addEventListener(name, () => window.__events.push(name));
      let seen; window.__sampler = setInterval(() => { const c = window.__canvas;
        if (!a.paused && !a.seeking && c.dataset.draws !== seen) { seen = c.dataset.draws; const time = Number(c.dataset.speechTimeMs);
          window.__samples.push({ skin: c.dataset.appearance, time, mediaTime: a.currentTime * 1000, pose: JSON.parse(c.dataset.mouthPose), viseme: c.dataset.viseme, expected: appearanceReview.expected(time) }); }
      }, 10);
    });
    await button('재생').click(); await state('playing');
    await page.evaluate(() => { window.__events = []; });
    for (let i = 0; i < 12; i++) { const before = await audio(); const skin = i % 2 ? 'cat' : 'human'; await swap(skin); const after = await audio();
      assert.equal(after.src, before.src); assert.ok(!after.paused && after.time >= before.time && after.time - before.time < 1.5, JSON.stringify({ i, before, after })); switches.push({ i, skin, before: before.time, after: after.time }); }
    assert.deepEqual(await page.evaluate(() => window.__events), []);
    assert.ok(await page.evaluate(() => window.__canvas === document.querySelector('[data-appearance-status] canvas') && window.__audio === document.querySelector('audio')));
    const resources = await page.evaluate(() => window.__resources()); assert.equal(resources.created, resourceBaseline.created); assert.equal(resources.raf, 1); assert.equal(resources.observers, 3);
    await state('ended'); await rest(); samples = await page.evaluate(() => { clearInterval(window.__sampler); return window.__samples; });
    assert.ok(samples.length > 50); for (const row of samples) { assert.deepEqual(row.pose, row.expected.mouth); assert.equal(row.viseme, row.expected.viseme); }
    assert.ok(samples.some(s => s.skin === 'cat') && samples.some(s => s.skin === 'human'));
  });
  await test('paused, ended, backward seek and half-speed swaps preserve transport state', async () => {
    const ended = await audio(); await swap('human'); assert.deepEqual(await audio(), ended);
    await page.locator('audio').evaluate(a => { a.currentTime = 1.2; a.playbackRate = .5; }); await button('일시정지').click(); await state('paused'); await rest();
    const paused = await audio(); await swap('cat'); assert.deepEqual(await audio(), paused);
    await button('재생').click(); await state('playing'); await swap('human'); assert.equal((await audio()).rate, .5);
    await page.locator('audio').evaluate(a => { a.currentTime = .35; }); await page.waitForTimeout(200); await swap('cat');
    const row = await canvas().evaluate(c => ({ time: Number(c.dataset.speechTimeMs), pose: JSON.parse(c.dataset.mouthPose), expected: appearanceReview.expected(Number(c.dataset.speechTimeMs)).mouth }));
    assert.ok(row.time >= 350 && row.time < 1500); assert.deepEqual(row.pose, row.expected);
    await button('일시정지').click(); await state('paused'); await rest(); await page.locator('audio').evaluate(a => { a.playbackRate = 1; });
  });
  await test('asset failure keeps playing cat visible and retry recovers the human appearance', async () => {
    await button('처음으로').click(); await button('재생').click(); await state('playing');
    await page.evaluate(() => { window.__head = window.HUMAN_OFFLINE_ASSETS['head.png']; window.HUMAN_OFFLINE_ASSETS['head.png'] = 'data:image/png;base64,broken'; });
    const before = await audio(); await button('인간형').click(); await page.locator('[data-appearance-status="error"]').waitFor();
    assert.equal(await canvas().getAttribute('data-appearance'), 'cat'); const failed = await audio(); assert.equal(failed.src, before.src); assert.ok(!failed.paused && failed.time >= before.time);
    await page.evaluate(() => { window.HUMAN_OFFLINE_ASSETS['head.png'] = window.__head; }); await button('다시 불러오기').click(); await ready('human');
    assert.equal((await audio()).src, before.src); assert.equal((await audio()).paused, false); await button('일시정지').click();
  });
  await test('single Controller keeps emotion, in-progress gesture and monotonic idle clock', async () => { continuity = await page.evaluate(() => appearanceReview.controllerContinuity()); });
  await test('latest-request races, synchronous factories, failure recovery and late disposal are safe', async () => { lifecycle = await page.evaluate(() => appearanceReview.lifecycle()); assert.equal(lifecycle.length, 7); });
  await test('new surface is pixel identical to approved adapters for 16 speech/expression frames', async () => { parity = await page.evaluate(() => appearanceReview.renderParity()); assert.equal(parity.length, 16); });
  await test('switching while reduced-motion or offscreen keeps motion stopped and no extra loop', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); await rest(); await swap('cat');
    assert.equal(await canvas().getAttribute('data-running'), 'false'); assert.equal((await page.evaluate(() => window.__resources())).raf, 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { const e = document.createElement('div'); e.id = 'spacer'; e.style.height = '3000px'; document.body.append(e); window.scrollTo(0, document.body.scrollHeight); });
    await page.waitForFunction(() => document.querySelector('[data-appearance-status] canvas').dataset.running === 'false');
    await button('인간형').evaluate(b => b.click()); await ready('human'); await rest(); assert.equal((await page.evaluate(() => window.__resources())).raf, 0);
    await page.evaluate(() => { document.querySelector('#spacer').remove(); window.scrollTo(0, 0); });
  });
  await test('hidden page pauses audio and returning with another appearance does not auto-play', async () => {
    await button('처음으로').click(); await button('재생').click(); await state('playing');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }); await state('paused'); await rest();
    await button('고양이형').evaluate(b => b.click()); await ready('cat');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); assert.equal((await audio()).paused, true);
  });
  await test('new preview accepts correct files, rejects genuine duration mismatch and recovers', async () => {
    const mp3 = resolve('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3'); const good = JSON.parse(readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json', 'utf8'));
    await page.locator('.checks').last().evaluate(e => { e.open = true; });
    await page.locator('input[type=file]').nth(0).setInputFiles(mp3);
    const load = async manifest => { await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'timeline.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) }); await button('선택한 파일 확인').click(); };
    await load(good); await state('ready'); await load({ ...good, durationMs: good.durationMs + 1500 }); await state('error');
    assert.match(await page.locator('[data-speech-state]').textContent(), /길이/); await load(good); await state('ready');
    await page.locator('.checks').last().evaluate(e => { e.open = false; }); await page.evaluate(() => window.scrollTo(0, 0));
  });
  await test('unmount releases all resources and remount restores rest without audio replacement', async () => {
    const before = await audio(); await button('화면 나가기').click(); assert.equal(await canvas().count(), 0);
    assert.deepEqual(await page.evaluate(() => ({ raf: window.__resources().raf, observers: window.__resources().observers })), { raf: 0, observers: 0 });
    await button('돌아오기').click(); await ready('cat'); await rest(); assert.equal((await audio()).src, before.src); assert.equal((await page.evaluate(() => window.__resources())).observers, 3);
  });
  await test('both appearances fit 320/390/1280px and remain visible after resize and reload', async () => {
    for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 1100 });
      for (const skin of ['cat', 'human']) { await swap(skin); await page.evaluate(() => window.scrollTo(0, 0)); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.ok(await canvas().evaluate(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((a, i) => i % 4 === 3 && a > 0)));
        if (width !== 320) await page.locator('main').screenshot({ path: `${out}/${skin}-${width}.png` }); } }
    await page.reload(); await ready('cat'); await state('empty');
  });
  await test('no runtime errors or external requests', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); });
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ browser: kind, version: browser.version(), results, errors, external, switches, samples, parity, continuity, lifecycle,
    scope: 'One audio/Controller/host across appearance replacement; existing artwork, MP3 and alignment reused. Desktop WebKit is not a physical iPhone test.' }, null, 2) + '\n');
  await browser.close();
}
