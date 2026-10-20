// Run with a read-only node_modules path. --baseline collects defects before fixes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const baseline = process.argv.includes('--baseline');
const outputName = process.argv.find(arg => arg.startsWith('--out='))?.slice(6) || 'accessibility-evidence';
if (!/^[a-z0-9-]+$/.test(outputName)) throw Error('Output must be a simple folder name');
const out = process.env.MOTION_CHECK_OUTPUT ? path.resolve(process.env.MOTION_CHECK_OUTPUT) : path.resolve(__dirname, '../docs/exercise-motion', outputName);
const { html, chromium } = require('./motion-accessibility-harness.cjs')(path.resolve(process.argv[2]), path.join(out, 'generated'));
const previousIds = ['wall-pushup', 'seated-knee-extension', 'light-dumbbell-curl', 'supported-calf-raise', 'supported-side-leg-raise'];
const ids = process.argv.find(arg => arg.startsWith('--ids='))?.slice(6).split(',') || previousIds;
if (ids.some(id => ![...previousIds, 'band-external-rotation-at-side'].includes(id))) throw Error('Unknown motion ID');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], rows = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => route.abort());
  try {
    await page.setContent(html);
    for (const id of ids) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(id => window.show(id), id);
      const play = page.getByRole('button', { name: '재생', exact: true });
      await play.waitFor();
      const slider = page.getByRole('slider');
      const row = { id, reducedOnMount: await play.isDisabled(), toggleStateExposed: await play.getAttribute('aria-pressed') === 'false' };
      row.targets = await page.locator('button, input[type=range], label:has(input[type=checkbox])').evaluateAll(nodes => nodes.map(el => { const r = el.getBoundingClientRect(); return { name: (el.getAttribute('aria-label') || el.textContent || el.type).trim(), width: r.width, height: r.height }; }));
      row.smallTargets = row.targets.filter(t => t.width < 44 || t.height < 44);
      row.noOverflow320 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      if (!baseline) {
        assert.equal(row.reducedOnMount, true, `${id} reduced motion at mount`);
        assert.equal(row.toggleStateExposed, true, `${id} play toggle state`);
        assert.deepEqual(row.smallTargets, [], `${id} 44px touch targets`);
        assert.equal(row.noOverflow320, true);
        await page.getByRole('button', { name: id === 'band-external-rotation-at-side' ? '회전한 자세 보기' : id === 'wall-pushup' ? '굽힌 자세 보기' : id === 'bodyweight-squat' ? '내려간 자세 보기' : '올린 자세 보기' }).tap();
        assert.equal(await slider.inputValue(), '0.5');
        await page.screenshot({ path: path.join(out, `${id}-peak.png`), fullPage: true });
        await page.getByRole('button', { name: '시작 자세 보기' }).tap();
        await page.screenshot({ path: path.join(out, `${id}-start.png`), fullPage: true });
        await slider.focus(); await page.keyboard.press('End'); assert.equal(await slider.inputValue(), '1');
        await page.keyboard.press('Home'); assert.equal(await slider.inputValue(), '0');
        await page.keyboard.press('ArrowRight'); assert.equal(await slider.inputValue(), '0.01');
        await page.getByRole('button', { name: '시작 자세 보기' }).tap();
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction(() => !document.querySelector('button').disabled);
        // Tab order and keyboard toggling, without programmatically clicking the labels.
        await play.focus(); await page.keyboard.press('Tab');
        assert.equal(await page.locator(':focus').getAttribute('type'), 'checkbox');
        await page.keyboard.press('Tab');
        const slow = page.getByLabel('느리게 (0.5배)', { exact: true });
        assert.equal(await slow.evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Space'); assert.equal(await slow.isChecked(), true);
        await page.keyboard.press('Tab'); assert.equal(await slider.evaluate(el => el === document.activeElement), true);
        assert.equal(await slider.evaluate(el => el.matches(':focus-visible')), true);
        // Use the padded label edge, not the tiny native checkbox, as the touch target.
        const slowBox = await slow.locator('..').boundingBox();
        await page.touchscreen.tap(slowBox.x + slowBox.width - 3, slowBox.y + slowBox.height - 3);
        assert.equal(await slow.isChecked(), false);
        await slider.scrollIntoViewIfNeeded();
        const track = await slider.boundingBox();
        await page.touchscreen.tap(track.x + track.width * .6, track.y + track.height / 2);
        assert.ok(Number(await slider.inputValue()) > .4 && Number(await slider.inputValue()) < .8);
        await page.getByRole('button', { name: '시작 자세 보기' }).tap();
        await play.focus(); await page.keyboard.press('Enter');
        await page.getByRole('button', { name: '일시정지', exact: true }).waitFor();
        await page.keyboard.press('Space'); await play.waitFor();
        await play.tap(); await page.waitForFunction(() => Number(document.querySelector('input[type=range]').value) > .01);
        await page.getByRole('button', { name: '일시정지', exact: true }).tap();
        const stopped = await slider.inputValue(); await page.waitForTimeout(120); assert.equal(await slider.inputValue(), stopped);
        // A preference change while playing must stop it and must not restart on return.
        await play.tap(); await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForFunction(() => document.querySelector('button').disabled);
        const reducedPosition = await slider.inputValue(); await page.waitForTimeout(120); assert.equal(await slider.inputValue(), reducedPosition);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        assert.equal(await play.getAttribute('aria-pressed'), 'false');
        // Validate all five players' speed wiring using deterministic animation timestamps.
        await page.evaluate(() => { window.oldRAF = requestAnimationFrame; window.oldCAF = cancelAnimationFrame; window.frames = new Map(); window.counter = 0; window.requestAnimationFrame = cb => { const id = ++window.counter; window.frames.set(id, cb); return id; }; window.cancelAnimationFrame = id => window.frames.delete(id); window.step = time => { const cbs = [...window.frames.values()]; window.frames.clear(); cbs.forEach(cb => cb(time)); }; });
        const speeds = [];
        for (const isSlow of [false, true]) {
          await slow.setChecked(isSlow); await page.getByRole('button', { name: '시작 자세 보기' }).tap(); await play.tap();
          await page.evaluate(() => window.step(0)); await page.evaluate(() => window.step(100));
          await page.waitForFunction(() => Number(document.querySelector('input[type=range]').value) > 0);
          speeds.push(Number(await slider.inputValue()));
          await page.getByRole('button', { name: '일시정지', exact: true }).tap();
        }
        assert.ok(Math.abs(speeds[0] - speeds[1] * 2) < 1e-8);
        await page.evaluate(() => { window.requestAnimationFrame = window.oldRAF; window.cancelAnimationFrame = window.oldCAF; });
        // 200% text at narrow width: wrapping must not hide or clip controls.
        await page.addStyleTag({ content: 'html{font-size:32px}' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${id} enlarged text overflow`);
        await page.screenshot({ path: path.join(out, `${id}-320-large-text.png`), fullPage: true });
        await page.addStyleTag({ content: 'html{font-size:16px}' });
        row.keyboardTouchSpeedAndPreference = 'passed: Home/End/ArrowRight, Tab order, Space checkbox, Enter/Space playback, focus-visible, padded label edge tap, range tap, play/pause taps, 0.5 speed ratio, reduced preference during play, 200% text reflow';
      }
      rows.push(row);
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, baseline ? 'before.json' : 'after.json'), JSON.stringify({ browser: 'isolated Edge headless temporary profile', baseline, rows, errors, limitations: ['Touch emulation, not physical phone', 'No screen-reader speech test', 'Synthetic local fixture, not logged-in app', '44px target size is a product check, not a WCAG certification'] }, null, 2));
    console.log(baseline ? 'Baseline defects captured' : `PASS ${ids.length}-motion accessibility delta checks`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
