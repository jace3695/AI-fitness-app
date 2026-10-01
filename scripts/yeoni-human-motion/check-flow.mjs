import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { server } from './server.mjs';

const kind = process.env.YEONI_BROWSER || 'chromium';
if (!['chromium', 'webkit'].includes(kind)) throw new Error('Unknown browser');
const out = `.e2e/yeoni-human-motion/${kind}`;
mkdirSync(out, { recursive: true });
const browser = await ({ chromium, webkit })[kind].launch({
  ...(kind === 'chromium' && process.env.YEONI_CHROMIUM ? {
    executablePath: process.env.YEONI_CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  } : {}), headless: true,
}).catch(async error => { await new Promise(resolve => server.close(resolve)); throw error; });
const results = [];
const requests = [];
const errors = [];
const context = await browser.newContext({ viewport: { width: 430, height: 920 }, reducedMotion: 'no-preference' });
await context.route('**/*', route => {
  const url = route.request().url(); requests.push(url);
  if (url.startsWith('http://127.0.0.1:8878/') || url.startsWith('data:')) return route.continue();
  return route.abort();
});
await context.addInitScript(() => {
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const active = new Set();
  window.requestAnimationFrame = callback => {
    const id = nativeRaf(now => { active.delete(id); callback(now); });
    active.add(id); return id;
  };
  window.cancelAnimationFrame = id => { active.delete(id); nativeCancel(id); };
  window.__pendingFrames = () => active.size;
});
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
const button = name => ({ click: async () => { await page.getByRole('button', { name, exact: true }).click(); await page.evaluate(() => window.scrollTo(0, 0)); }, waitFor: () => page.getByRole('button', { name, exact: true }).waitFor() });
const canvas = () => page.locator('canvas');
const draws = () => canvas().getAttribute('data-draws').then(Number);
const running = value => page.waitForFunction(v => document.querySelector('canvas')?.dataset.running === String(v), value);
async function stable() {
  await running(false); const before = await draws();
  await page.waitForTimeout(250); assert.equal(await draws(), before);
  assert.equal(await page.evaluate(() => window.__pendingFrames()), 0);
}
async function test(name, action) {
  await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`);
}
try {
  await page.goto('http://127.0.0.1:8878/');
  await page.locator('[data-human-status="ready"]').waitFor();
  await test('initial static pose and no animation loop', stable);
  await test('start, actual canvas pixels change, 30fps render cap', async () => {
    await button('움직임 켜기').click(); await running(true);
    const before = await draws(); const pixels = await canvas().evaluate(e => e.toDataURL());
    await page.waitForTimeout(750);
    const delta = await draws() - before; assert.ok(delta > 0 && delta <= 26, `draws=${delta}`);
    assert.notEqual(await canvas().evaluate(e => e.toDataURL()), pixels);
  });
  await test('blink reaches closed and returns open', async () => {
    await page.waitForFunction(() => document.querySelector('canvas')?.dataset.blink === 'closed', null, { timeout: 7000 });
    await page.screenshot({ path: `${out}/blink.png` });
    await page.waitForFunction(() => document.querySelector('canvas')?.dataset.blink === 'open');
  });
  await test('manual stop is stationary and survives reload', async () => {
    await button('움직임 멈추기').click(); await stable(); await page.reload();
    await page.locator('[data-human-status="ready"]').waitFor(); await stable();
    await button('움직임 켜기').click(); await running(true);
  });
  await test('editing pauses; blur resumes', async () => {
    await page.getByPlaceholder('여기에 글을 입력해 보세요').fill('연이 동작 확인'); await stable();
    await page.getByRole('heading', { level: 1 }).click(); await running(true);
  });
  await test('native modal pauses and closing resumes', async () => {
    await button('안내 창 열기').click(); await stable(); await button('닫기').click(); await running(true);
  });
  await test('offscreen stops without polling and returns', async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await stable();
    await page.evaluate(() => window.scrollTo(0, 0)); await running(true);
  });
  await test('reduced-motion overrides saved animation preference', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); await stable();
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await running(true);
  });
  await test('visibilitychange handler (synthetic hidden event) stops and resumes', async () => {
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await stable();
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await running(true);
  });
  await test('hide setting survives reload and keeps explanation', async () => {
    await button('연이 숨기기').click(); assert.equal(await canvas().count(), 0);
    await page.reload(); await button('연이 보이기').waitFor(); assert.equal(await canvas().count(), 0);
    assert.ok(await page.getByText('이번 단계는 기본 움직임', { exact: false }).isVisible());
    await button('연이 보이기').click(); await running(true);
  });
  await test('20 mount/unmount cycles leave one loop, none while unmounted', async () => {
    for (let i = 0; i < 20; i++) {
      await button('다른 화면으로 이동').click(); assert.equal(await canvas().count(), 0);
      assert.equal(await page.evaluate(() => window.__pendingFrames()), 0);
      await button('연이 화면 돌아오기').click(); await page.evaluate(() => window.scrollTo(0, 0)); await running(true);
      assert.equal(await page.evaluate(() => window.__pendingFrames()), 1);
    }
  });
  await test('image failure falls back and recovers with no animation loop leak', async () => {
    await button('이미지 오류 확인').click(); await page.locator('[data-human-status="error"]').waitFor(); await stable();
    assert.ok(await page.getByText('연이의 기본 모습을 표시하고 있어요.').isVisible());
    await page.screenshot({ path: `${out}/fallback.png` });
    await button('이미지 복구').click(); await page.evaluate(() => window.scrollTo(0, 0)); await page.locator('[data-human-status="ready"]').waitFor(); await running(true);
    const restoredDraws = await draws(); await page.waitForTimeout(500);
    assert.ok(await draws() > restoredDraws); assert.equal(await page.locator('[data-human-status="ready"]').count(), 1); await running(true);
  });
  await test('320/390/430/1280px layouts and dark background', async () => {
    await button('움직임 멈추기').click();
    for (const width of [320, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 980 }); await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(80);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const rect = await canvas().boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
      await page.screenshot({ path: `${out}/${width}.png` });
    }
    await button('배경 바꾸기').click(); await page.screenshot({ path: `${out}/dark.png` });
  });
  await test('denied preference storage still stops the current animation', async () => {
    await button('움직임 켜기').click(); await running(true);
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('fixture', 'QuotaExceededError'); }; });
    await button('움직임 멈추기').click(); await stable();
    assert.ok(await page.getByText('설정을 저장하지 못했지만 지금 화면에는 적용했어요.').isVisible());
  });
  await test('canvas unavailable still displays approved human and explanation', async () => {
    const other = await context.newPage();
    await other.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
    await other.goto('http://127.0.0.1:8878/'); await other.locator('[data-human-status="error"]').waitFor();
    assert.ok(await other.getByText('연이의 기본 모습을 표시하고 있어요.').isVisible()); await other.close();
  });
  await test('no runtime exceptions or external requests', async () => {
    assert.deepEqual(errors, []); assert.ok(requests.every(url => url.startsWith('http://127.0.0.1:8878/') || url.startsWith('data:')));
  });
} catch (e) {
  await page.screenshot({ path: `${out}/failed-flow.png`, fullPage: true });
  writeFileSync(`${out}/failed-state.json`, JSON.stringify(await page.evaluate(() => ({
    stage: document.querySelector('[data-human-status]')?.getAttribute('data-human-status'),
    canvas: { ...document.querySelector('canvas')?.dataset }, hidden: document.hidden,
    active: document.activeElement?.outerHTML, scroll: window.scrollY,
  })), null, 2));
  results.push({ passed: false, error: String(e) }); console.error(e); process.exitCode = 1;
} finally {
  writeFileSync(`${out}/flow-results.json`, JSON.stringify({ browser: kind, version: browser.version(), results, errors,
    requestOrigins: [...new Set(requests.map(url => new URL(url).origin))], physicalIphone: 'not tested', background: 'synthetic visibility event only' }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
