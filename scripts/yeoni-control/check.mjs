import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const kind = process.env.YEONI_BROWSER || 'chromium', origin = 'http://127.0.0.1:8880/';
const out = process.env.YEONI_CONTROL_OUTPUT || `.e2e/yeoni-control/${kind}`;
const selected = process.env.YEONI_CONTROL_FILTER ? new RegExp(process.env.YEONI_CONTROL_FILTER) : null;
mkdirSync(out, { recursive: true });
const { server } = await import('./server.mjs');
const executablePath = kind === 'webkit' ? process.env.YEONI_WEBKIT : process.env.YEONI_CHROMIUM;
const browser = await ({ chromium, webkit })[kind].launch({ headless: true, ...(executablePath ? { executablePath } : {}),
  ...(kind === 'chromium' ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}),
}).catch(async error => { await new Promise(done => server.close(done)); throw error; });
const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, reducedMotion: 'no-preference' });
const results = [], errors = [], external = [];
let contract, factories, injections, speech, page;
const manifest = JSON.parse(readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json', 'utf8'));
await context.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith(origin) || /^(blob:|data:|file:)/.test(url)) return route.continue();
  external.push(url); return route.abort();
});
await context.addInitScript(() => {
  const pending = new Set(), active = new Set(); let created = 0;
  const raf = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = fn => { const id = raf(t => { pending.delete(id); fn(t); }); pending.add(id); return id; };
  window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  for (const name of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
    const Native = window[name];
    window[name] = class extends Native {
      constructor(...args) { super(...args); this.characterOwned = new Error().stack.includes('mountCharacterStage'); if (this.characterOwned) created++; }
      observe(...args) { if (this.characterOwned) active.add(this); return super.observe(...args); }
      disconnect() { active.delete(this); return super.disconnect(); }
    };
  }
  window.__resources = () => ({ pending: pending.size, activeObservers: active.size, createdObservers: created });
});
async function open(url = origin) {
  if (page) await page.close(); page = await context.newPage(); page.setDefaultTimeout(20_000);
  page.on('pageerror', e => errors.push(e.message)); await page.goto(url);
}
const button = name => page.getByRole('button', { name, exact: true });
const state = value => page.locator(`[data-speech-state="${value}"]`).waitFor({ state: 'attached' });
const canvases = () => page.locator('.pair-boards canvas');
async function ready() {
  await page.locator('[data-cat-status="ready"]').waitFor(); await page.locator('[data-human-status="ready"]').waitFor();
}
async function running(value) {
  await page.waitForFunction(v => [...document.querySelectorAll('.pair-boards canvas')].length === 2 &&
    [...document.querySelectorAll('.pair-boards canvas')].every(c => c.dataset.running === String(v)), value);
}
async function tools() { await page.locator('.pair-tools').evaluate(e => { e.open = true; }); }
async function top() { await page.evaluate(() => window.scrollTo(0, 0)); }
async function stable() {
  await running(false);
  const before = await canvases().evaluateAll(cs => cs.map(c => c.dataset.draws));
  await page.waitForTimeout(150);
  assert.deepEqual(await canvases().evaluateAll(cs => cs.map(c => c.dataset.draws)), before);
  assert.equal((await page.evaluate(() => window.__resources())).pending, 0);
}
async function test(name, action) {
  if (selected && !selected.test(name)) return;
  try { await action(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, passed: false, error: String(e) }); throw e; }
}

try {
  await open(); await ready();
  await test('both skins start still with one empty audio element and clean StrictMode resources', async () => {
    await stable(); assert.equal(await page.locator('audio').count(), 1); await state('empty');
    assert.equal((await page.evaluate(() => window.__resources())).activeObservers, 6);
  });
  await test('one native saved MP3 drives both visemes through natural playback and ending', async () => {
    await button('저장된 연이 음성 불러오기').click(); await state('ready'); await running(true);
    assert.equal(await page.locator('audio').evaluate(a => a.paused), true);
    await page.evaluate(() => {
      window.__speechSamples = []; window.__recordSpeech = true;
      const sample = () => {
        const a = document.querySelector('audio');
        if (!a.paused && !a.seeking && a.readyState >= 2) window.__speechSamples.push({ media: a.currentTime * 1000,
          skins: [...document.querySelectorAll('.pair-boards canvas')].map(c => ({ time: Number(c.dataset.speechTimeMs), viseme: c.dataset.viseme })) });
        if (window.__recordSpeech) requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
    await button('재생').click(); await state('playing'); await state('ended');
    speech = await page.evaluate(() => { window.__recordSpeech = false; return window.__speechSamples; });
    assert.ok(speech.length > 50);
    const projection = { 'ɐ': 'a', 'ʌ': 'a', i: 'i', j: 'i', e: 'e', o: 'o', m: 'closed', 'sʷ': 'u' };
    for (const row of speech) for (const skin of row.skins) {
      const cue = manifest.cues.find(c => c.startMs <= skin.time && skin.time < c.endMs);
      assert.equal(skin.viseme, cue ? (projection[cue.phone] ?? 'small') : 'rest');
    }
    await page.waitForFunction(() => [...document.querySelectorAll('.pair-boards canvas')].every(c => c.dataset.viseme === 'rest'));
  });
  await test('React updates keep both renderer lifetimes and the same paused audio source', async () => {
    await button('처음으로').click(); await state('ready'); await tools();
    const before = await page.evaluate(() => { window.__canvases = [...document.querySelectorAll('.pair-boards canvas')]; return { ...window.__resources(), src: document.querySelector('audio').currentSrc }; });
    for (let i = 0; i < 8; i++) await page.getByRole('button', { name: /^화면 갱신 / }).click();
    await top();
    const after = await page.evaluate(() => ({ ...window.__resources(), src: document.querySelector('audio').currentSrc,
      sameCanvases: [...document.querySelectorAll('.pair-boards canvas')].every((c, i) => c === window.__canvases[i]) }));
    assert.equal(after.createdObservers, before.createdObservers); assert.equal(after.src, before.src); assert.equal(after.sameCanvases, true);
    assert.equal(after.pending, 2);
  });
  await test('one gesture command does not replay when an equivalent props object is recreated', async () => {
    await button('고양이 끄덕임 요청').click(); await top();
    await page.waitForFunction(() => document.querySelector('[data-cat-status] canvas').dataset.gesture === 'nod');
    await page.waitForFunction(() => document.querySelector('[data-cat-status] canvas').dataset.gesture === 'idle');
    await page.getByRole('button', { name: /^화면 갱신 / }).click(); await top(); await page.waitForTimeout(80);
    assert.equal(await page.locator('[data-cat-status] canvas').getAttribute('data-gesture'), 'idle');
  });
  await test('editing, modal and reduced-motion policies stop both hosts without polling', async () => {
    await page.locator('details.checks').evaluate(e => { e.open = true; });
    await page.getByLabel('발음 타임라인 JSON (최대 1MB)').focus(); await top(); await stable();
    await page.getByRole('heading', { level: 1 }).click(); await running(true);
    await page.evaluate(() => { const d = document.createElement('dialog'); d.id = 'contract-dialog'; document.body.append(d); d.showModal(); });
    await stable(); await page.evaluate(() => { document.querySelector('#contract-dialog').remove(); }); await running(true);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await stable();
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await running(true);
  });
  await test('offscreen and synthetic hidden state stop both hosts; return does not autoplay', async () => {
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'scroll-probe'; d.style.height = '2000px'; document.body.append(d); window.scrollTo(0, document.body.scrollHeight); });
    await stable(); await page.evaluate(() => { document.querySelector('#scroll-probe').remove(); window.scrollTo(0, 0); }); await running(true);
    await button('재생').click(); await state('playing');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await stable(); await state('paused');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await running(true); await state('paused');
  });
  await test('image errors stay isolated to one skin and recovery restores only its resources', async () => {
    await tools();
    for (const [skin, label, other] of [['cat', '고양이', 'human'], ['human', '인간형', 'cat']]) {
      const src = await page.locator('audio').evaluate(a => a.currentSrc);
      await button(`${label} 오류 확인`).click(); await top(); await page.locator(`[data-${skin}-status="error"]`).waitFor();
      await page.locator(`[data-${other}-status="ready"]`).waitFor();
      assert.equal((await page.evaluate(() => window.__resources())).pending, 1);
      await button(`${label} 이미지 복구`).click(); await top(); await ready(); await running(true);
      assert.equal((await page.evaluate(() => window.__resources())).pending, 2);
      assert.equal(await page.locator('audio').evaluate(a => a.currentSrc), src);
    }
  });
  await test('ten unmount/remount cycles release all observers and leave one loop per visible skin', async () => {
    for (let i = 0; i < 10; i++) {
      await button('화면 나가기').click(); assert.equal(await canvases().count(), 0);
      const r = await page.evaluate(() => window.__resources()); assert.equal(r.pending, 0); assert.equal(r.activeObservers, 0);
      await button('돌아오기').click(); await top(); await ready(); await running(true);
      const next = await page.evaluate(() => window.__resources()); assert.equal(next.pending, 2); assert.equal(next.activeObservers, 6);
    }
  });
  await page.addScriptTag({ url: origin + 'probe.js' });
  await test('real Canvas adapters accept unchanged immutable Controller frames and dispose pixels', async () => {
    contract = await page.evaluate(() => controlReview.renderContract());
    assert.deepEqual(contract.rows.map(r => r.viseme), ['rest', 'a', 'o', 'i', 'closed', 'small', 'u', 'e']);
    for (const row of contract.rows) {
      assert.ok(row.immutable && row.unchangedByAdapters); assert.ok(row.cat.visiblePixels > 0 && row.human.visiblePixels > 0);
      assert.equal(row.cat.width, row.cat.height); assert.equal(row.human.height / row.human.width, 1.5);
    }
    for (const skin of ['cat', 'human']) assert.equal(new Set(contract.rows.filter(r => ['closed', 'a', 'i', 'u', 'e', 'o'].includes(r.viseme)).map(r => r[skin].hash)).size, 6);
    assert.ok(contract.afterDispose.every(r => r.visiblePixels === 0)); assert.deepEqual(contract.afterLateRender, contract.afterDispose);
  });
  await test('both mounted adapters honour an injected Controller and disposed commands are inert', async () => {
    injections = await page.evaluate(() => controlReview.injectedControllers());
    for (const row of injections) { assert.equal(row.injectedEmotion, 'thinking'); assert.equal(row.emotionAfterDisposedCalls, 'happy'); assert.equal(row.gestureAfterDisposedCalls, 'nod'); }
  });
  await test('throwing factories and late readiness cannot revive failed or disposed stages', async () => {
    const before = await page.evaluate(() => window.__resources());
    factories = await page.evaluate(() => controlReview.failedFactories());
    for (const row of factories) {
      assert.equal(row.rendered, 0); assert.equal(row.disposed, row.mode === 'throw' ? 0 : 1);
      assert.deepEqual(row.statuses, row.mode === 'dispose-before-ready' ? ['loading'] : ['loading', 'error']);
    }
    const after = await page.evaluate(() => window.__resources()); assert.equal(after.activeObservers, before.activeObservers); assert.equal(after.pending, before.pending);
  });
  await test('manual stop persists through reload and small layouts remain usable', async () => {
    await button('입 움직임 끄기').click(); await stable(); await page.reload(); await ready(); await state('empty'); await stable();
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 1000 }); await top();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width !== 320) await page.screenshot({ path: `${out}/shared-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 1000 });
  });
  await test('new combined offline preview loads the existing MP3 and plays both skins without network', async () => {
    await open(pathToFileURL(resolve('docs/yeoni-phase10/Yeoni_Shared_Control_Preview.html')).href); await ready();
    await button('저장된 연이 음성 불러오기').click(); await state('ready');
    await button('재생').click(); await state('playing'); await running(true);
    await button('일시정지').click(); await state('paused');
  });
  await test('no runtime exceptions or external requests', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); });
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ phase: 10, browser: kind, version: browser.version(), results, errors, external,
    contract, injections, factories, speech, scope: 'Shared React lifetime, actual adapters, one native MP3 clock with two visible skins. Synthetic visibility and factory faults. No previous original comparison/video suite rerun or physical device verification.' }, null, 2));
  await browser.close(); await new Promise(done => server.close(done));
}
