// Only the offline entry points affected by the shared hook; no visual/video suite.
import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const kind = process.env.YEONI_BROWSER || 'chromium', out = `.e2e/yeoni-control/${kind}`;
mkdirSync(out, { recursive: true });
const executablePath = kind === 'webkit' ? process.env.YEONI_WEBKIT : process.env.YEONI_CHROMIUM;
const browser = await ({ chromium, webkit })[kind].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const results = [], errors = [], external = [];
try {
  for (const [phase, filename] of [[5, 'Yeoni_Lip_Sync_Dev_Preview.html'], [6, 'Yeoni_Emotion_Gesture_Preview.html'], [8, 'Yeoni_Human_Motion_Preview.html'], [9, 'Yeoni_Human_Speech_Preview.html']]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, reducedMotion: 'no-preference' });
    const page = await context.newPage(); page.setDefaultTimeout(20_000); page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const url = route.request().url(); if (/^(file:|data:|blob:)/.test(url)) return route.continue();
      external.push(url); return route.abort();
    });
    const button = name => page.getByRole('button', { name, exact: true });
    const state = value => page.locator(`[data-speech-state="${value}"]`).waitFor({ state: 'attached' });
    try {
      await page.goto(pathToFileURL(resolve(`docs/yeoni-phase${phase}/${filename}`)).href);
      await page.locator(phase < 8 ? '[data-cat-status="ready"]' : '[data-human-status="ready"]').waitFor();
      if (phase === 8) {
        await button('움직임 켜기').click();
        await page.waitForFunction(() => document.querySelector('canvas').dataset.running === 'true');
        await button('움직임 멈추기').click();
        await page.waitForFunction(() => document.querySelector('canvas').dataset.running === 'false');
      } else {
        if (phase === 6) { await page.locator('details.checks').evaluate(e => { e.open = true; }); await button('움직임 켜기').click(); }
        await button(phase === 6 ? '저장 음성 불러오기' : '저장된 연이 음성 불러오기').click(); await state('ready');
        assert.equal(await page.locator('audio').evaluate(a => a.paused), true);
        await button(phase === 6 ? '립싱크 함께 보기' : '재생').click(); await state('playing');
        await button(phase === 6 ? '음성 멈추기' : '일시정지').click(); await state('paused');
      }
      results.push({ phase, passed: true }); console.log('PASS legacy phase ' + phase);
    } catch (error) { results.push({ phase, passed: false, error: String(error) }); throw error; }
    finally { await context.close(); }
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
} finally {
  writeFileSync(`${out}/legacy-results.json`, JSON.stringify({ browser: kind, version: browser.version(), results, errors, external }, null, 2));
  await browser.close();
}
