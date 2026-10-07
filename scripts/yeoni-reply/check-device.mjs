import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

// Local component verification only: no live authentication, records, AI or TTS.
const out = 'docs/yeoni-device-review/evidence';
mkdirSync(out, { recursive: true });
const audio = {
  ko: readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3').toString('base64'),
  ja: readFileSync('docs/yeoni-voice-comparison/media/gemini-zephyr-ja-user.wav').toString('base64'),
};
const bundle = await build({ stdin: { contents: `import {StrictMode} from 'react';import{createRoot}from'react-dom/client';import DeviceCheck from './app/assistant/character-check/DeviceCheck';createRoot(document.getElementById('root')).render(<StrictMode><main className="mx-auto max-w-4xl px-4 py-6 pb-32"><DeviceCheck audio={${JSON.stringify(audio)}}/></main></StrictMode>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, outfile: 'app.js', jsx: 'automatic', tsconfig: 'tsconfig.json',
  external: ['/yeoni-cat-sprite-v1.webp'], define: { 'process.env.NODE_ENV': '"production"' } });
const globalCss = await postcss([tailwindcss()]).process(readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css' });
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = globalCss.css + bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></html>`;
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  const file = resolve('public', '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(resolve('public') + '/')) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', extname(file) === '.png' ? 'image/png' : 'image/webp'); res.end(readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.YEONI_CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await context.newPage(), errors = [], forbiddenRequests = [], results = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => {
  const request = route.request(), target = request.url();
  if (request.method() !== 'GET' || (!target.startsWith(url) && !/^(data:|blob:)/.test(target)) || target.includes('/api/')) {
    forbiddenRequests.push({ method: request.method(), url: target }); return route.abort();
  }
  return route.continue();
});
await context.addInitScript(() => {
  window.audioHashes = new Map();
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => {
    const url = create(blob);
    window.audioHashes.set(url, blob.arrayBuffer().then(bytes => crypto.subtle.digest('SHA-256', bytes)).then(hash => Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')));
    return url;
  };
});
const button = name => page.getByRole('button', { name, exact: true });
const state = value => page.waitForFunction(v => document.querySelector('[data-speech-state]')?.dataset.speechState === v, value);
const skin = value => page.waitForFunction(v => document.querySelector('[data-appearance-status]')?.dataset.appearanceStatus === 'ready' && document.querySelector('canvas')?.dataset.appearance === v, value);
const rest = () => page.waitForFunction(() => document.querySelector('canvas')?.dataset.viseme === 'rest');
async function test(name, run) { await run(); results.push({ name, passed: true }); console.log('PASS', name); }
try {
  await page.goto(url); await skin('cat');
  await test('touch selectors load original Korean and chosen Japanese without autoplay or generation calls', async () => {
    assert.ok(await button('답변 듣기').isDisabled());
    await button('움직임 켜기').click();
    for (const [label, hash] of [['한국어 음성 선택', 'f598b457e49734e75a83a04e57b28f47f7a8d98ceb1aff1549942a5264b9ef2d'], ['일본어 음성 선택', 'ba42df730eac9896d5b9561b324c5937e6336822d5dcdf9f8fe06eeb2bd0b2f6']]) {
      await button(label).tap(); await state('ready');
      assert.equal(await page.locator('audio').evaluate(a => window.audioHashes.get(a.currentSrc)), hash);
      assert.equal(await page.locator('audio').evaluate(a => a.paused), true);
      assert.equal(await button(label).getAttribute('aria-pressed'), 'true');
    }
  });
  await test('same audio continues during skin switch; pause closes mouth; selecting language interrupts old audio', async () => {
    await button('답변 듣기').tap(); await state('playing');
    await page.waitForFunction(() => document.querySelector('audio').currentTime > .25);
    await page.evaluate(() => { window.beforeSwitch = { audio: document.querySelector('audio'), src: document.querySelector('audio').currentSrc, time: document.querySelector('audio').currentTime }; });
    await button('인간형').tap(); await skin('human');
    assert.ok(await page.locator('audio').evaluate(a => a === window.beforeSwitch.audio && a.currentSrc === window.beforeSwitch.src && a.currentTime >= window.beforeSwitch.time && !a.paused));
    await page.screenshot({ path: `${out}/human-390.png`, fullPage: true });
    await button('일시정지').tap(); await state('paused'); await rest();
    await button('답변 듣기').tap(); await state('playing');
    await button('한국어 음성 선택').tap(); await state('ready');
    assert.equal(await page.locator('audio').evaluate(a => a.paused && a.currentTime === 0), true);
    await button('고양이형').tap(); await skin('cat');
    await button('답변 듣기').tap(); await state('playing');
    await state('ended'); await rest();
    await button('처음으로').tap();
    assert.equal(await page.locator('audio').evaluate(a => a.paused && a.currentTime === 0), true);
  });
  await test('portrait/landscape responsive layout and 44px touch targets; reload has no selection or autoplay', async () => {
    for (const [width, height] of [[320, 740], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await page.locator('button').evaluateAll(buttons => buttons.every(b => b.getBoundingClientRect().height >= 44)));
      await page.screenshot({ path: `${out}/cat-${width}.png`, fullPage: true });
    }
    await page.reload(); await skin('cat');
    assert.ok(await button('답변 듣기').isDisabled());
    assert.equal(await button('한국어 음성 선택').getAttribute('aria-pressed'), 'false');
    assert.equal(await button('일본어 음성 선택').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('audio').count(), 1);
    assert.equal(await page.locator('audio').evaluate(a => a.paused && !a.getAttribute('src')), true);
    assert.deepEqual(errors, []); assert.deepEqual(forbiddenRequests, []);
  });
} finally {
  writeFileSync(`${out}/browser.json`, JSON.stringify({ browser: browser.version(), scope: 'isolated actual DeviceCheck component with production global/component CSS', results, errors, forbiddenRequests, realAuthenticationTested: false, physicalIPhoneTested: false, providerCalls: 0 }, null, 2) + '\n');
  await browser.close(); await new Promise(r => server.close(r));
}
