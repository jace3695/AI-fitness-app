import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { server } from './server.mjs';
const kind = process.env.YEONI_BROWSER || 'chromium', out = `.e2e/yeoni-emotion-poc/${kind}`;
mkdirSync(out, { recursive: true });
const browser = await ({ chromium, webkit })[kind].launch({ headless: true,
  ...(kind === 'chromium' && process.env.YEONI_CHROMIUM ? { executablePath: process.env.YEONI_CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}),
}).catch(async e => { await new Promise(resolve => server.close(resolve)); throw e; });
const context = await browser.newContext({ viewport: { width: 390, height: 950 }, reducedMotion: 'no-preference' });
const errors = [], requests = [], results = [];
await context.route('**/*', route => {
  const url = route.request().url(); requests.push(url);
  if (/^(http:\/\/127\.0\.0\.1:8876\/|data:|blob:)/.test(url)) return route.continue();
  return route.abort();
});
await context.addInitScript(() => {
  const raf = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window), pending = new Set();
  window.requestAnimationFrame = cb => { const id = raf(t => { pending.delete(id); cb(t); }); pending.add(id); return id; };
  window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  window.__pendingFrames = () => pending.size;
});
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
const button = name => page.getByRole('button', { name, exact: true });
const canvas = () => page.locator('canvas');
const data = () => canvas().evaluate(c => ({ ...c.dataset }));
const state = value => page.locator(`[data-speech-state="${value}"]`).waitFor();
const media = fn => page.locator('audio').evaluate(fn);
const pose = (key, value) => page.waitForFunction(([k, v]) => document.querySelector('canvas')?.dataset[k] === v, [key, value]);
async function test(name, run) { await run(); results.push({ name, passed: true }); console.log('PASS ' + name); }
async function stationary() {
  await pose('running', 'false'); const before = (await data()).draws;
  await page.waitForTimeout(150); assert.equal((await data()).draws, before);
  assert.equal(await page.evaluate(() => window.__pendingFrames()), 0);
}
const emotions = [['neutral','기본'],['smile','미소'],['happy','기쁨'],['proud','뿌듯함'],['encouraging','응원'],['concerned','걱정'],['surprised','놀람'],['thinking','생각 중'],['serious','진지함'],['disappointed','아쉬움'],['sleepy','졸림'],['comforting','위로']];
try {
  await page.goto('http://127.0.0.1:8876/'); await page.locator('[data-cat-status="ready"]').waitFor();
  await test('initial static neutral, audio muted and no source/autoplay', async () => {
    await stationary(); assert.equal((await data()).emotion, 'neutral');
    assert.equal(await media(a => a.muted && a.paused && !a.getAttribute('src')), true);
  });
  await test('twelve distinct static expressions and inspectable contact sheet', async () => {
    const images = [];
    for (const [id, label] of emotions) {
      await button(label).click(); await pose('emotion', id); await stationary();
      images.push({ label, src: await canvas().evaluate(c => c.toDataURL()) });
    }
    assert.equal(new Set(images.map(x => x.src)).size, 12);
    const sheet = await context.newPage();
    await sheet.setViewportSize({ width: 1000, height: 960 });
    await sheet.setContent(`<html lang="ko"><meta charset="utf-8"><style>body{font-family:system-ui;background:#f7f5fb;color:#49375d;margin:20px}h1{font-size:22px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0;background:#fff;border-radius:16px;text-align:center}img{width:100%;display:block}figcaption{padding:0 0 10px;font-size:16px}</style><h1>연이 · 12가지 표정 시연</h1><div class="grid">${images.map(x => `<figure><img src="${x.src}"><figcaption>${x.label}</figcaption></figure>`).join('')}</div></html>`);
    await sheet.locator('img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())));
    await sheet.screenshot({ path: `${out}/expressions.png`, fullPage: true }); await sheet.close();
    await button('기본으로').click(); await pose('emotion', 'neutral');
  });
  await test('four finite gestures reach a visible pose and return without queues', async () => {
    await button('움직임 켜기').click(); await pose('running', 'true');
    for (const [id, label, field, threshold] of [['nod','끄덕이기','headNod',.06],['tilt','갸웃하기','headTilt',.1],['greet','꾸벅 인사','headNod',.7],['cheer','가벼운 응원','bodyLift',.2]]) {
      await button(label).click(); await pose('gesture', id);
      await page.waitForFunction(([k, min]) => Math.abs(Number(document.querySelector('canvas').dataset[k])) > min, [field, threshold]);
      await page.locator('.emotion-portrait').screenshot({ path: `${out}/${id}.png` });
      await pose('gesture', 'idle'); const end = await data();
      assert.equal(Number(end.bodyLift), 0); assert.equal(Number(end.headNod), 0); assert.equal(Number(end.headTilt), 0);
    }
  });
  await test('rapid replacement keeps one frame loop; expression change keeps gesture progress', async () => {
    for (let i = 0; i < 12; i++) await button(i % 2 ? '가벼운 응원' : '갸웃하기').click();
    await button('꾸벅 인사').click(); await pose('gesture', 'greet');
    await page.waitForFunction(() => Number(document.querySelector('canvas').dataset.gestureProgress) > .25);
    await button('기쁨').click(); await pose('emotion', 'happy');
    const changed = await data();
    assert.ok(changed.gesture === 'idle' || Number(changed.gestureProgress) >= .25);
    assert.equal(await page.evaluate(() => window.__pendingFrames()), 1);
    await pose('gesture', 'idle'); await button('기본으로').click();
  });
  await test('manual stop and reduced motion cancel transient motion without replay', async () => {
    await button('가벼운 응원').click(); await pose('gesture', 'cheer');
    await button('움직임 멈추기').click(); await stationary(); await pose('gesture', 'idle');
    await button('움직임 켜기').click(); await pose('running', 'true'); await pose('gesture', 'idle');
    await button('끄덕이기').click(); await pose('gesture', 'nod');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await stationary(); await pose('gesture', 'idle');
    await button('걱정').click(); await pose('emotion', 'concerned'); await stationary();
    await button('꾸벅 인사').click(); await pose('gesture', 'idle');
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await pose('running', 'true'); await pose('gesture', 'idle');
    await button('기본으로').click();
  });
  await test('muted saved voice keeps phoneme mouth priority across all expressions and gestures', async () => {
    await page.locator('summary').click(); await button('저장 음성 불러오기').click(); await state('ready');
    assert.equal(await media(a => a.muted && a.paused), true); const source = await media(a => a.currentSrc);
    await media(a => { a.playbackRate = .25; });
    await button('립싱크 함께 보기').click(); await state('playing');
    for (const [id, label] of emotions) {
      await button(label).click(); await pose('emotion', id);
      await page.locator('audio').evaluate(a => new Promise(resolve => { a.addEventListener('seeked', resolve, { once: true }); a.currentTime = 2.43; }));
      await pose('viseme', 'e');
    }
    await button('꾸벅 인사').click(); await pose('gesture', 'greet'); await pose('viseme', 'e');
    assert.equal(await media(a => a.currentSrc), source);
    await button('음성 멈추기').click(); await state('paused'); await pose('viseme', 'rest');
    await media(a => { a.muted = false; }); await button('소리 끄기').waitFor();
    await media(a => { a.muted = true; }); await button('소리 켜기').waitFor();
    await button('소리 켜기').click(); assert.equal(await media(a => a.muted), false);
    await button('소리 끄기').click(); assert.equal(await media(a => a.muted), true);
    await media(a => { a.playbackRate = 1; a.currentTime = 5.1; });
    await button('립싱크 함께 보기').click(); await state('ended'); await pose('viseme', 'rest');
  });
  await test('background pause cancels a gesture and audio never resumes automatically', async () => {
    await button('립싱크 함께 보기').click(); await state('playing'); await button('꾸벅 인사').click(); await pose('gesture', 'greet');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await state('paused'); await stationary(); await pose('gesture', 'idle'); await pose('viseme', 'rest');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await pose('running', 'true'); await pose('gesture', 'idle'); assert.equal(await media(a => a.paused), true);
  });
  await test('unmount/remount cannot replay a prior command and leaves no extra frame loops', async () => {
    for (let i = 0; i < 10; i++) {
      await button('갸웃하기').click(); await pose('gesture', 'tilt');
      await button('화면 나가기').click(); assert.equal(await canvas().count(), 0); assert.equal(await page.evaluate(() => window.__pendingFrames()), 0);
      await button('돌아오기').click(); await page.locator('[data-cat-status="ready"]').waitFor(); await pose('running', 'true'); await pose('gesture', 'idle');
      assert.equal(await page.evaluate(() => window.__pendingFrames()), 1); assert.equal(await media(a => a.paused), true);
    }
  });
  await test('small/tall layouts, dark background, and reload reset the review session', async () => {
    await button('움직임 멈추기').click(); await button('위로').click(); await stationary();
    await page.locator('summary').click();
    for (const [width, height] of [[320,568],[390,950],[430,920],[1280,900]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${out}/${width}.png`, fullPage: true });
    }
    await button('배경 바꾸기').click(); await page.screenshot({ path: `${out}/dark.png`, fullPage: true });
    await page.reload(); await page.locator('[data-cat-status="ready"]').waitFor(); await stationary(); await pose('emotion', 'neutral');
    assert.equal(await media(a => a.paused && a.muted && !a.getAttribute('src')), true);
  });
  await test('no runtime exceptions or external requests', async () => {
    assert.deepEqual(errors, []); assert.ok(requests.every(u => /^(http:\/\/127\.0\.0\.1:8876\/|data:|blob:)/.test(u)));
  });
} catch (error) { results.push({ passed: false, error: String(error) }); console.error(error); process.exitCode = 1; }
finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ browser: kind, version: browser.version(), results, errors, requestCount: requests.length,
    scope: '12 expressions, 4 transient gestures and existing muted audio integration. Human listening deferred; no new TTS or AI emotion inference; no physical iPhone verification.' }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
