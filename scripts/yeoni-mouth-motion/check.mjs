import { chromium, webkit } from 'playwright';
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const kind = process.env.YEONI_BROWSER || 'chromium';
const out = process.env.YEONI_MOUTH_OUTPUT || `.e2e/yeoni-mouth-motion/${kind}`; mkdirSync(out, { recursive: true });
const baseline = 'cee57128dbc37298b2aa5657b2b5b57c91fe0c53';
const bundling = { entryPoints: ['scripts/yeoni-mouth-motion/probe.ts'], bundle: true, write: false, format: 'iife', tsconfig: 'tsconfig.json' };
const current = await build({ ...bundling, globalName: 'mouthReview' });
const old = await build({ ...bundling, globalName: 'oldMouthReview', plugins: [{ name: 'committed-art-baseline', setup(b) {
  b.onLoad({ filter: /\/(cat|human)-art\.ts$/ }, args => ({ loader: 'ts', resolveDir: dirname(args.path),
    contents: execFileSync('git', ['show', `${baseline}:${relative(process.cwd(), args.path)}`], { encoding: 'utf8' }) }));
} }] });
const executablePath = kind === 'webkit' ? process.env.YEONI_WEBKIT : process.env.YEONI_CHROMIUM;
const browser = await ({ chromium, webkit })[kind].launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...(kind === 'chromium' ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, reducedMotion: 'no-preference' });
const page = await context.newPage(), errors = [], external = [], results = [];
let pixels, hashes, samples, timings;
page.on('pageerror', e => errors.push(e.message));
await context.route('**/*', route => { const url = route.request().url(); if (/^(file:|blob:|data:)/.test(url)) return route.continue(); external.push(url); return route.abort(); });
const button = name => page.getByRole('button', { name, exact: true });
const state = name => page.locator(`[data-speech-state="${name}"]`).waitFor({ state: 'attached' });
const allRest = () => page.waitForFunction(() => [...document.querySelectorAll('.pair-boards canvas')].every(c => {
  const m = JSON.parse(c.dataset.mouthPose); return m.from === 'rest' && m.to === 'rest';
}));
async function test(name, action) { try { await action(); results.push({ name, passed: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, passed: false, error: String(error) }); throw error; } }
try {
  await page.goto(pathToFileURL(resolve('docs/yeoni-lipsync-smoothing/Yeoni_Smooth_Mouth_Preview.html')).href);
  await page.locator('[data-human-status="ready"]').waitFor(); await page.locator('[data-cat-status="ready"]').waitFor();
  await page.addScriptTag({ content: current.outputFiles[0].text }); await page.addScriptTag({ content: old.outputFiles[0].text });
  await test('offline preview shows both approved skins, one audio and smooth mode by default', async () => {
    assert.equal(await page.locator('audio').count(), 1); await state('empty'); await allRest();
    assert.equal(await button('부드러운 전환').getAttribute('aria-pressed'), 'true');
  });
  await test('48 endpoint/eye combinations are pixel identical to committed artwork renderers', async () => {
    hashes = await page.evaluate(async () => ({ previous: await oldMouthReview.endpoints(), current: await mouthReview.endpoints() }));
    assert.equal(hashes.current.length, 48); assert.deepEqual(hashes.current, hashes.previous);
  });
  await test('mouth morph preserves all pixels outside its patch, exact endpoints and opaque skin', async () => {
    pixels = await page.evaluate(() => mouthReview.pixelReview());
    for (const row of pixels) { assert.equal(row.outsideChanged, 0); assert.equal(row.endpointMismatches, 0); assert.equal(row.fullyOpaque, true); assert.equal(row.restoredExact, true); }
  });
  await test('normal-speed frame sequence reduces peak and 95th-percentile mouth pixel jumps', async () => {
    for (const row of pixels) { assert.ok(row.smoothChanges.maximum < row.rawChanges.maximum, JSON.stringify(row)); assert.ok(row.smoothChanges.p95 < row.rawChanges.p95, JSON.stringify(row)); }
  });
  await page.evaluate(() => mouthReview.sheets());
  for (const skin of ['cat', 'human']) await page.locator(`#mouth-sheet-${skin}`).screenshot({ path: `${out}/${skin}-transitions.png` });
  await page.evaluate(() => { document.querySelectorAll('[id^="mouth-sheet-"]').forEach(e => e.remove()); window.scrollTo(0, 0); });
  await test('native MP3 playback samples both actual canvas poses from their recorded media times', async () => {
    await button('저장된 연이 음성 불러오기').click(); await state('ready');
    await page.evaluate(() => {
      window.__samples = []; window.__record = true; const seen = new Map();
      const sample = () => { const audio = document.querySelector('audio');
        if (!audio.paused && !audio.seeking && audio.readyState >= 2) for (const c of document.querySelectorAll('.pair-boards canvas')) {
          if (seen.get(c) !== c.dataset.draws) { seen.set(c, c.dataset.draws); const time = Number(c.dataset.speechTimeMs);
            window.__samples.push({ skin: c.closest('[data-human-status]') ? 'human' : 'cat', time, audio: audio.currentTime * 1000,
              pose: JSON.parse(c.dataset.mouthPose), expected: mouthReview.expected(time) }); }
        }
        if (window.__record) requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
    await button('재생').click(); await state('playing'); await state('ended'); await allRest();
    samples = await page.evaluate(() => { window.__record = false; return window.__samples; }); assert.ok(samples.length >= 80);
    for (const row of samples) assert.deepEqual(row.pose, row.expected);
    for (const skin of ['cat', 'human']) { const rows = samples.filter(r => r.skin === skin);
      assert.ok(rows.some(r => r.pose.mix > 0 && r.pose.mix < 1));
      assert.ok(rows.some(r => r.time >= 3940 && r.time < 4020 && r.pose.from === 'closed' && r.pose.to === 'closed'));
      assert.ok(rows.some(r => r.time > 2720 && r.time < 3370 && r.pose.from === 'rest'));
    }
  });
  await test('A/B switching during playback preserves audio source, playback position and canvas instances', async () => {
    await button('처음으로').click(); await button('재생').click(); await state('playing');
    const before = await page.evaluate(() => { window.__oldCanvases = [...document.querySelectorAll('.pair-boards canvas')]; window.__oldAudio = document.querySelector('audio'); return { src: window.__oldAudio.currentSrc, time: window.__oldAudio.currentTime }; });
    await button('기존 전환').click(); await page.waitForTimeout(130);
    assert.ok(await page.locator('.pair-boards canvas').evaluateAll(cs => cs.every(c => { const p = JSON.parse(c.dataset.mouthPose); return p.mix === 0 && p.from === c.dataset.viseme; })));
    await button('부드러운 전환').click();
    const after = await page.evaluate(() => { const a = document.querySelector('audio'); return { src: a.currentSrc, time: a.currentTime, paused: a.paused,
      sameAudio: a === window.__oldAudio, sameCanvases: [...document.querySelectorAll('.pair-boards canvas')].every((c, i) => c === window.__oldCanvases[i]) }; });
    assert.equal(after.src, before.src); assert.ok(after.time >= before.time && after.time < 3); assert.ok(after.sameAudio && after.sameCanvases && !after.paused);
    await button('일시정지').click(); await state('paused'); await allRest();
  });
  await test('backward seek, half-speed and replay use the audio position with no stale mouth history', async () => {
    await page.locator('audio').evaluate(a => { a.currentTime = .35; a.playbackRate = .5; });
    await button('재생').click(); await state('playing'); await page.waitForTimeout(260);
    const rows = await page.locator('.pair-boards canvas').evaluateAll(cs => cs.map(c => ({ pose: JSON.parse(c.dataset.mouthPose), expected: mouthReview.expected(Number(c.dataset.speechTimeMs)), time: Number(c.dataset.speechTimeMs) })));
    for (const row of rows) { assert.ok(row.time >= 350 && row.time < 800); assert.deepEqual(row.pose, row.expected); }
    await button('처음으로').click(); await state('ready'); await allRest();
    assert.equal(await page.locator('audio').evaluate(a => a.currentTime), 0);
    await page.locator('audio').evaluate(a => { a.playbackRate = 1; });
  });
  await test('reduced-motion, offscreen and hidden-page policies close both mouths and pause safely', async () => {
    await button('재생').click(); await state('playing');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await allRest(); await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'spacer'; d.style.height = '3000px'; document.body.append(d); window.scrollTo(0, document.body.scrollHeight); }); await allRest();
    await page.evaluate(() => { document.querySelector('#spacer').remove(); window.scrollTo(0, 0); Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await state('paused'); await allRest(); await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await state('paused');
  });
  await test('unmount/remount restores original rest and layout fits mobile and desktop', async () => {
    await button('화면 나가기').click(); assert.equal(await page.locator('.pair-boards canvas').count(), 0);
    await button('돌아오기').click(); await page.locator('[data-human-status="ready"]').waitFor(); await allRest();
    for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 1100 }); await page.evaluate(() => window.scrollTo(0, 0)); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width !== 320) await page.screenshot({ path: `${out}/preview-${width}.png`, fullPage: true }); }
  });
  await test('no runtime errors or external requests', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); });
  timings = samples && ['cat', 'human'].map(skin => { const rows = samples.filter(r => r.skin === skin); const differences = rows.slice(1).map((r, i) => r.time - rows[i].time).filter(t => t > 0).sort((a, b) => a - b);
    return { skin, samples: rows.length, frameIntervalP95Ms: differences[Math.floor(differences.length * .95)], maximumObservedClockAgeMs: Math.max(...rows.map(r => r.audio - r.time)) }; });
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ browser: kind, version: browser.version(), baseline, results, errors, external, pixels, hashes, timings, samples,
    scope: 'New deterministic visual motion and mouth-only morph. Original audio/alignment retained. Pixel-jump statistics are not listening approval or phoneme accuracy.' }, null, 2));
  await browser.close();
}
