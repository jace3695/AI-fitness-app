// Offline harness. Usage: node scripts/check-supported-exercise-motion.cjs <read-only node_modules path>
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const dependencies = path.resolve(process.argv[2] || 'node_modules');
const fromDeps = createRequire(path.join(dependencies, '_motion_harness.cjs'));
const ts = fromDeps('typescript');
const { chromium } = fromDeps('@playwright/test');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.MOTION_EVIDENCE_DIR || path.join(root, 'docs/exercise-motion/expansion-evidence'));
fs.mkdirSync(out, { recursive: true });
const modules = [];
const ids = new Map();
function pack(file) {
  if (ids.has(file)) return ids.get(file);
  const id = modules.length;
  ids.set(file, id); modules.push('');
  let source = fs.readFileSync(file, 'utf8');
  if (/\.tsx?$/.test(file)) source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const local = createRequire(file);
  source = source.replace(/require\(['"]([^'"]+)['"]\)/g, (_, name) => {
    let target;
    if (name.startsWith('.')) {
      const candidate = path.resolve(path.dirname(file), name);
      target = [candidate, candidate + '.ts', candidate + '.tsx', candidate + '.js'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!target) target = local.resolve(name);
    } else target = fromDeps.resolve(name);
    return `require(${pack(target)})`;
  });
  modules[id] = `function(module,exports,require){${source}\n}`;
  return id;
}
const react = pack(fromDeps.resolve('react'));
const dom = pack(fromDeps.resolve('react-dom/client'));
const component = pack(path.join(root, 'app/components/ExerciseMotionDemo.tsx'));
const bundle = `const process={env:{NODE_ENV:'production'}};const modules=[${modules.join(',')}],cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}const React=require(${react}),Demo=require(${component}).default;const root=require(${dom}).createRoot(document.getElementById('root'));window.show=(id)=>root.render(React.createElement(Demo,{exerciseId:id}));show('seated-knee-extension');`;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>운동 시범 격리 검증</title><style>body{font:16px system-ui;margin:16px;color:#1e293b}section{max-width:420px;background:#eef2ff;padding:12px;border:1px solid #a5b4fc;border-radius:12px}svg{display:block;width:100%;max-width:288px;margin:auto}button{padding:10px;margin:4px}input[type=range]{display:block;width:100%}p{line-height:1.5}</style><div id="root"></div><script>${bundle.replaceAll('</script', '<\\/script')}</script></html>`;
fs.writeFileSync(path.join(out, 'preview.html'), html);
const program = ts.createProgram([path.join(root, 'app/components/ExerciseMotionDemo.tsx'), path.join(root, 'app/lib/exerciseMotion.ts')], { noEmit: true, allowImportingTsExtensions: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, baseUrl: root, paths: { 'react': [path.join(dependencies, '@types/react/index.d.ts')], 'react/*': [path.join(dependencies, '@types/react/*')] }, typeRoots: [path.join(dependencies, '@types')], types: ['react'] });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => '\n' }));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.MOTION_BROWSER_CHANNEL ? { channel: process.env.MOTION_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => r.abort());
  const checks = [];
  try {
    await page.setContent(html);
    for (const id of ['seated-knee-extension', 'light-dumbbell-curl', 'supported-calf-raise', 'supported-side-leg-raise']) {
      await page.evaluate(id => window.show(id), id);
      const section = page.getByRole('region');
      const slider = section.getByRole('slider');
      await section.getByRole('button', { name: '재생', exact: true }).waitFor();
      assert.equal(await slider.inputValue(), '0');
      await slider.focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await slider.inputValue(), '0.01');
      await section.getByRole('button', { name: '시작 자세 보기' }).focus();
      await page.keyboard.press('Enter'); assert.equal(await slider.inputValue(), '0');
      await section.getByRole('button', { name: '재생', exact: true }).focus();
      await page.keyboard.press('Space');
      await section.getByRole('button', { name: '일시정지', exact: true }).waitFor();
      await page.keyboard.press('Space');
      await section.getByRole('button', { name: '재생', exact: true }).waitFor();
      await section.getByRole('button', { name: '재생', exact: true }).click();
      await page.waitForFunction(() => Number(document.querySelector('input[type=range]').value) > .01);
      await section.getByRole('button', { name: '일시정지', exact: true }).click();
      const stopped = await slider.inputValue();
      await page.waitForTimeout(150); assert.equal(await slider.inputValue(), stopped);
      await section.getByRole('button', { name: '올린 자세 보기' }).click();
      assert.equal(await slider.inputValue(), '0.5');
      await page.screenshot({ path: path.join(out, `${id}-390.png`), fullPage: true });
      await slider.fill('0.99');
      await section.getByRole('button', { name: '재생', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('input[type=range]').value === '1');
      await section.getByRole('button', { name: '재생', exact: true }).click();
      await page.waitForFunction(() => Number(document.querySelector('input[type=range]').value) < .1);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await section.getByRole('button', { name: '재생', exact: true }).waitFor();
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(await section.getByRole('button', { name: '재생', exact: true }).getAttribute('aria-pressed'), 'false');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => document.querySelector('button').disabled);
      await section.getByRole('button', { name: '시작 자세 보기' }).click();
      assert.equal(await slider.inputValue(), '0');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await section.getByLabel('반복', { exact: true }).check();
      await slider.fill('0.99');
      await section.getByRole('button', { name: '재생', exact: true }).click();
      await page.waitForFunction(() => Number(document.querySelector('input[type=range]').value) < .1);
      await slider.fill('0.25');
      await section.getByRole('button', { name: '재생', exact: true }).waitFor();
      assert.equal(await slider.inputValue(), '0.25');
      await section.getByLabel('느리게 (0.5배)', { exact: true }).check();
      // Deterministic rAF clock measures actual component speed wiring, not wall-clock timing.
      await page.evaluate(() => {
        window.originalRAF = requestAnimationFrame; window.originalCAF = cancelAnimationFrame;
        window.frames = new Map(); window.frameNumber = 0;
        window.requestAnimationFrame = callback => { const id = ++window.frameNumber; window.frames.set(id, callback); return id; };
        window.cancelAnimationFrame = id => window.frames.delete(id);
        window.stepFrame = time => { const callbacks = [...window.frames.values()]; window.frames.clear(); callbacks.forEach(callback => callback(time)); };
      });
      const measured = [];
      for (const slow of [false, true]) {
        await section.getByLabel('느리게 (0.5배)', { exact: true }).setChecked(slow);
        await section.getByRole('button', { name: '시작 자세 보기' }).click();
        await section.getByRole('button', { name: '재생', exact: true }).click();
        await page.evaluate(() => window.stepFrame(0));
        await page.evaluate(() => window.stepFrame(100));
        await page.waitForFunction(() => Number(document.querySelector('input[type=range]').value) > 0);
        measured.push(await slider.evaluate(el => el.valueAsNumber));
        await section.getByRole('button', { name: '일시정지', exact: true }).click();
      }
      assert.ok(Math.abs(measured[0] - 2 * measured[1]) < .00001);
      await page.evaluate(() => { window.requestAnimationFrame = window.originalRAF; window.cancelAnimationFrame = window.originalCAF; });
      await page.setViewportSize({ width: 320, height: 720 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.setViewportSize({ width: 390, height: 844 });
      checks.push(`${id}: initial pause, keyboard slider/Enter/Space, playback, pause, seek, finish, replay, hidden stop, no auto-resume, reduced motion, measured half-speed, 390px layout`);
    }
    await page.evaluate(() => window.show('wall-pushup'));
    await page.waitForFunction(() => !document.querySelector('section'));
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const touchPage = await mobile.newPage();
    await touchPage.route('**/*', r => r.abort());
    await touchPage.setContent(html);
    for (const id of ['supported-calf-raise', 'supported-side-leg-raise']) {
      await touchPage.evaluate(id => window.show(id), id);
      await touchPage.getByRole('button', { name: '재생', exact: true }).tap();
      await touchPage.waitForFunction(() => Number(document.querySelector('input[type=range]').value) > .01);
      await touchPage.getByRole('button', { name: '일시정지', exact: true }).tap();
      await touchPage.getByRole('button', { name: '시작 자세 보기' }).tap();
      await touchPage.screenshot({ path: path.join(out, `${id}-touch-start.png`), fullPage: true });
      assert.ok(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await touchPage.emulateMedia({ reducedMotion: 'reduce' });
      await touchPage.waitForFunction(() => document.querySelector('button').disabled);
      await touchPage.getByRole('button', { name: '올린 자세 보기' }).tap();
      assert.equal(await touchPage.getByRole('slider').inputValue(), '0.5');
      await touchPage.emulateMedia({ reducedMotion: 'no-preference' });
    }
    await mobile.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ typecheck: 'passed', browser: process.env.MOTION_BROWSER_CHANNEL || 'Chromium', checks, additional: ['loop wraps', 'seek during playback pauses', 'speed control', '320px no overflow', 'ID switch resets player', '390px touch-emulated new demos: play/pause/static poses/reduced motion'], unsupportedId: 'renders nothing', pageErrors: errors, externalRequests: 'blocked by route', limitations: ['Not full app integration', 'No medical or physical-device validation', 'Visibility tested with synthetic event'] }, null, 2));
    console.log('PASS typecheck and isolated Chromium flows');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
