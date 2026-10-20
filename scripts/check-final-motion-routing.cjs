const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve(process.env.MOTION_CHECK_OUTPUT || 'scripts/browser-qa/.generated/expanded-routing');
const { html, chromium } = require('./motion-accessibility-harness.cjs')(path.resolve(process.argv[2]), path.join(out, 'generated'));
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 }, reducedMotion: 'no-preference' });
    await context.route('**/*', r => r.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(html);
    const blocked = ['dead-bug', 'foam-roller-recovery', 'ab-slider-ready-position'];
    for (const id of [...blocked, 'unsupported']) {
      await page.evaluate(id => window.show(id), id);
      await page.waitForFunction(() => document.querySelector('#root').textContent === '');
      assert.equal(await page.locator('svg').count(), 0);
    }
    const catalog = require('../docs/exercise-motion/batch3-evidence/catalog.json').rows;
    const complete = catalog.filter(row => !blocked.includes(row.id));
    assert.equal(complete.length, 27);
    for (const { id } of complete) {
      await page.evaluate(() => window.show('unsupported'));
      await page.waitForFunction(() => document.querySelector('#root').textContent === '');
      await page.evaluate(id => window.show(id), id);
      await page.getByRole('slider').waitFor();
      assert.equal(await page.getByRole('slider').inputValue(), '0');
      assert.ok(await page.getByRole('img').count() > 0);
      assert.ok((await page.locator('#root').innerText()).includes('전문가'));
    }
    await page.evaluate(() => {
      window.frames = new Map(); window.counter = 0;
      window.requestAnimationFrame = cb => { const id = ++window.counter; window.frames.set(id, cb); return id; };
      window.cancelAnimationFrame = id => window.frames.delete(id);
      window.step = t => { const callbacks = [...window.frames.values()]; window.frames.clear(); callbacks.forEach(cb => cb(t)); };
    });
    for (const id of ['basic-warmup', 'basic-cooldown', 'foam-roller-prep']) {
      await page.evaluate(() => window.show('unsupported'));
      await page.waitForFunction(() => document.querySelector('#root').textContent === '');
      await page.evaluate(id => window.show(id), id);
      const slider = page.getByRole('slider'), play = page.getByRole('button', { name: '재생', exact: true });
      await play.waitFor();
      await slider.fill('0.99'); await play.click();
      await page.waitForFunction(() => window.frames.size === 1);
      await page.evaluate(() => window.step(0)); await page.evaluate(() => window.step(100));
      await page.waitForFunction(() => document.querySelector('input[type=range]').value === '1');
      await play.waitFor(); await play.click();
      await page.waitForFunction(() => document.querySelector('input[type=range]').value === '0');
      await page.evaluate(() => window.step(0)); await page.evaluate(() => window.step(100));
      await page.waitForFunction(() => Number(document.querySelector('input[type=range]').value) > 0);
      assert.ok(Number(await slider.inputValue()) < .1);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await play.waitFor(); assert.equal(await play.getAttribute('aria-pressed'), 'false');
      await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(await play.getAttribute('aria-pressed'), 'false');
      await play.click(); await page.waitForFunction(() => window.frames.size === 1);
      await page.evaluate(() => window.show('unsupported'));
      await page.waitForFunction(() => document.querySelector('#root').textContent === '');
      assert.equal(await page.evaluate(() => window.frames.size), 0);
    }
    await page.evaluate(() => window.show('basic-cooldown'));
    const select = page.getByRole('combobox'); await select.waitFor(); await select.selectOption('7');
    assert.equal(await page.getByRole('button', { name: '재생', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'after.json'), JSON.stringify({ active: complete.map(r => r.id), inactive: blocked, stagedReplayAfterCompletion: true, backgroundStopsWithoutResume: true, unmountCancelsAnimation: true, breathingStatic: true, errors, scope: 'synthetic browser fixture; no clinical review' }, null, 2));
    console.log('PASS 27 active demonstrations, 3 inactive drafts, staged replay and cleanup');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
