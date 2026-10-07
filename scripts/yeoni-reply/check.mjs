import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const output = 'docs/yeoni-phase13/evidence/chromium'; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.YEONI_CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 390, height: 950 } });
await context.addInitScript(() => {
  const create = URL.createObjectURL.bind(URL); window.hashes = new Map();
  URL.createObjectURL = blob => { const url = create(blob); window.hashes.set(url, blob.arrayBuffer().then(x => crypto.subtle.digest('SHA-256', x)).then(hash => Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''))); return url; };
});
const page = await context.newPage(), errors = [], external = [], results = [];
page.on('pageerror', e => errors.push(e.message));
await context.route('**/*', r => /^(file:|data:|blob:)/.test(r.request().url()) ? r.continue() : (external.push(r.request().url()), r.abort()));
const button = name => page.getByRole('button', { name, exact: true });
const status = value => page.waitForFunction(v => document.querySelector('[data-reply-status]')?.dataset.replyStatus === v, value);
const media = value => page.waitForFunction(v => document.querySelector('[data-speech-state]')?.dataset.speechState === v, value);
const skin = value => page.waitForFunction(v => document.querySelector('[data-appearance-status]')?.dataset.appearanceStatus === 'ready' && document.querySelector('canvas')?.dataset.appearance === v, value);
const rest = () => page.waitForFunction(() => document.querySelector('canvas')?.dataset.viseme === 'rest');
const hash = () => page.locator('audio').evaluate(a => window.hashes.get(a.currentSrc));
async function test(name, run) { await run(); results.push({ name, passed: true }); console.log('PASS', name); }
async function play() { await button('답변 듣기').click(); await page.locator('[data-reply-portrait]').scrollIntoViewIfNeeded(); await media('playing'); }
try {
  await page.goto(pathToFileURL(resolve(process.argv[2] || '../deliverables/Yeoni_Reply_Character_Preview.html')).href); await skin('cat');
  await button('움직임 켜기').click();
  await test('Korean response selects original bytes, comforting intent, no autoplay; starts one nod on play', async () => {
    await button('한국어 · 다정한 답변').click(); await status('ready');
    assert.equal(await hash(), 'f598b457e49734e75a83a04e57b28f47f7a8d98ceb1aff1549942a5264b9ef2d');
    assert.ok(await page.locator('audio').evaluate(a => a.paused));
    assert.match(await page.locator('[data-reply-tone]').textContent(), /다정하게/);
    await play(); await page.waitForFunction(() => document.querySelector('canvas').dataset.gesture === 'nod');
    assert.equal(await page.locator('canvas').getAttribute('data-emotion'), 'comforting');
    await button('일시정지').click(); await media('paused'); await rest();
    await page.waitForFunction(() => document.querySelector('canvas').dataset.emotion === 'neutral' && document.querySelector('canvas').dataset.gesture === 'idle');
    await play(); assert.equal(await page.locator('canvas').getAttribute('data-gesture'), 'idle');
    await media('ended'); await rest();
  });
  await test('Japanese replaces old speech and plays selected candidate with encouraging intent across both appearances', async () => {
    await button('일본어 · 응원하는 답변').click(); await status('ready');
    assert.equal(await hash(), 'ba42df730eac9896d5b9561b324c5937e6336822d5dcdf9f8fe06eeb2bd0b2f6');
    await play(); await page.waitForFunction(() => document.querySelector('canvas').dataset.emotion === 'encouraging');
    await page.evaluate(() => { window.originalAudio = document.querySelector('audio'); window.originalSrc = window.originalAudio.currentSrc; });
    for (const [value, name] of [['human', '인간형'], ['cat', '고양이형']]) {
      await button(name).click(); await skin(value);
      assert.ok(await page.locator('audio').evaluate(a => a === window.originalAudio && a.currentSrc === window.originalSrc && !a.paused));
    }
    await media('ended'); await rest();
    for (const [value, name] of [['cat', '고양이형'], ['human', '인간형']]) {
      await button(name).click(); await skin(value); await play();
      await page.waitForFunction(() => document.querySelector('audio').currentTime > .5);
      await page.screenshot({ path: `${output}/${value}-390.png`, fullPage: true });
      await media('ended'); await rest();
      await page.waitForFunction(() => document.querySelector('canvas').dataset.emotion === 'neutral');
    }
  });
  await test('new text clears speaking audio and never substitutes a saved clip', async () => {
    await play(); await button('음성이 없는 새 답변').click(); await status('text-only'); await rest();
    assert.ok(await page.locator('audio').evaluate(a => a.paused && !a.getAttribute('src')));
    assert.ok(await button('답변 듣기').isDisabled()); assert.match(await page.locator('[data-reply-text]').textContent(), /새 답변/);
    await page.screenshot({ path: `${output}/text-only-390.png`, fullPage: true });
  });
  await test('rapid responses keep latest Japanese bytes; page exit and reload never resume', async () => {
    await button('한국어 · 다정한 답변').click(); await button('일본어 · 응원하는 답변').click(); await status('ready');
    assert.equal(await hash(), 'ba42df730eac9896d5b9561b324c5937e6336822d5dcdf9f8fe06eeb2bd0b2f6');
    await play(); await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await media('paused'); await rest();
    await button('화면 나가기').click(); assert.equal(await page.locator('canvas').count(), 0);
    await button('돌아오기').click(); await skin('cat'); await status('idle');
    assert.ok(await page.locator('audio').evaluate(a => a.paused && !a.getAttribute('src')));
    await page.reload(); await skin('cat'); await status('idle'); assert.ok(await button('답변 듣기').isDisabled());
  });
  await test('explicit motion preference, reduced motion, mobile/desktop layouts and offline operation', async () => {
    await button('일본어 · 응원하는 답변').click(); await status('ready');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await play(); await rest();
    assert.equal(await page.locator('canvas').getAttribute('data-running'), 'false');
    await button('일시정지').click(); await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 950 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
    await page.screenshot({ path: `${output}/desktop-1280.png`, fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(await page.locator('audio').count(), 1);
  });
} finally {
  writeFileSync(`${output}/results.json`, JSON.stringify({ browser: browser.version(), results, errors, external, fixtureResponses: true, liveAiVerified: false, providerCalls: 0, physicalDeviceVerified: false }, null, 2) + '\n');
  await browser.close();
}
