// Real Chromium component/media/Canvas checks. Auth and provider replies are
// synthetic. Reuses only the checked-in PHASE 5 recording and its timeline.
// No hosted app, Supabase, provider, alignment worker, or private backup access.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const root = process.cwd();
const fixturePath = 'docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3';
const timelinePath = 'docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';
const audioBytes = readFileSync(fixturePath);
const manifest = JSON.parse(readFileSync(timelinePath, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(audioBytes), manifest.audioSha256, 'existing fixture hash');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDirectory = resolve(process.env.YEONI_READER_EVIDENCE_DIR ?? 'docs/yeoni-general-validation');
const output = resolve(evidenceDirectory, `reader-lifecycle-20261010.${stamp}`);
mkdirSync(evidenceDirectory, { recursive: true });
const temporary = mkdtempSync(resolve(tmpdir(), 'yeoni-reader-lifecycle-'));
const sourceFiles = [
  'components/ZephyrReadButton.tsx', 'components/yeoni/ReplyCharacterPanel.tsx',
  'lib/zephyr-playback.ts', 'lib/yeoni/reader-speech.ts',
  'lib/yeoni/character-controller.ts', 'lib/yeoni/appearance-stage.ts',
  'scripts/yeoni-reply/check-reader-lifecycle.mjs',
];
const evidence = {
  startedAt: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'Actual React reader/panel, HTMLAudioElement and Canvas renderers in isolated Chromium; synthetic auth/provider. Lifecycle event injection is labeled per case.',
  fixture: { path: fixturePath, timeline: timelinePath, sha256: digest(audioBytes), durationMs: manifest.durationMs },
  sourceSha256: Object.fromEntries(sourceFiles.map(path => [path, digest(readFileSync(path))])),
  realProviderCalls: 0, realAlignmentCalls: 0, hostedAppRequests: 0,
  hostedAuthenticationVerified: false, databaseVerified: false,
  physicalDeviceVerified: false, pronunciationVerified: false,
  originalShortLongCurrencyAcceptance: 'Not tested; this is a separate checked-in PHASE 5 fixture.',
  plannedCases: 12,
  results: [],
};

const authSource = `
let session = {user:{id:'synthetic-reader-owner'},access_token:'synthetic-test-token'};
const callbacks = new Set();
let reads = 0;
export function authReadCount() {return reads;}
export function changeAccount(id) {
  session = id ? {user:{id},access_token:'synthetic-test-token'} : null;
  for (const callback of callbacks) callback('SIGNED_IN',session);
}
export function createClient() {return {auth:{
  getSession:async()=>{reads++;return {data:{session}};},
  onAuthStateChange(callback) {callbacks.add(callback);queueMicrotask(()=>callbacks.has(callback)&&callback('INITIAL_SESSION',session));
    return {data:{subscription:{unsubscribe(){callbacks.delete(callback)}}}};}
}};}
`;
const entry = `
import React,{useState,useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import Reader from './components/ZephyrReadButton';
import Panel from './components/yeoni/ReplyCharacterPanel';
import {buildReplyPlan} from './lib/yeoni/reply-plan';
import {readerSpeech} from './lib/yeoni/reader-speech';
import {stopAllSpeech} from './lib/yeoni/speech-focus';
import {changeAccount,authReadCount} from '__reader_lifecycle_auth__';
const text=${JSON.stringify(manifest.spokenText)},clips=[];
let setView;
function App(){
  const [view,change]=useState({first:true,second:false});setView=change;
  const incoming=useMemo(()=>({value:{reply:text,performance:buildReplyPlan(text,'synthetic-reader-plan')}}),[]);
  return <main style={{maxWidth:680,margin:'0 auto',padding:12}}>
    {view.first&&<div data-qa-reader="first"><Reader text={text} align/></div>}
    {view.second&&<div data-qa-reader="second"><Reader text={text} align/></div>}
    <Panel clips={clips} incoming={incoming} alignReplies presentation="assistant"/>
  </main>;
}
const root=createRoot(document.getElementById('root'));
const playEvents=[];
document.addEventListener('play',event=>{
  const element=event.target;
  if(element instanceof HTMLMediaElement) playEvents.push({
    reader:element.closest('[data-qa-reader]')?.dataset.qaReader??'panel',
    timeMs:element.currentTime*1000,
  });
},true);
window.qa={changeAccount,authReadCount,stopAllSpeech,snapshot:()=>readerSpeech.snapshot(),
  playEvents:()=>playEvents.slice(),
  setView:value=>setView(value),unmount:()=>root.unmount()};
root.render(<App/>);
`;
let browser, server;
try {
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, outfile: 'reader-lifecycle.js', jsx: 'automatic',
  external: ['/yeoni-cat-sprite-v1.webp'],
  tsconfig: resolve('tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'synthetic-auth-only', setup(builder) {
    builder.onResolve({ filter: /^(?:@\/lib\/supabase|__reader_lifecycle_auth__)$/ },
      () => ({ path: 'auth', namespace: 'reader-lifecycle' }));
    builder.onLoad({ filter: /.*/, namespace: 'reader-lifecycle' },
      () => ({ contents: authSource, loader: 'js' }));
  } }],
});
const css = await postcss([tailwindcss()]).process(readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css' });
const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const stylesheet = css.css + bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>';
if (process.argv.includes('--build-only')) {
  const result = { kind: 'fixture-build-only', head: evidence.head, sourceSha256: evidence.sourceSha256,
    javascriptSha256: digest(javascript), stylesheetSha256: digest(stylesheet),
    browserCasesExecuted: 0, realProviderCalls: 0, realAlignmentCalls: 0 };
  writeFileSync(`${output}.build.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, evidence: `${output}.build.json` }));
  process.exit(0);
}
server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/seed') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Synthetic storage setup</title>'); return; }
  if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return; }
  if (pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.end(javascript); return; }
  if (pathname === '/fixture.css') { response.setHeader('Content-Type', 'text/css; charset=utf-8'); response.end(stylesheet); return; }
  const path = resolve('public', '.' + decodeURIComponent(pathname));
  if (!path.startsWith(resolve('public') + '/')) { response.writeHead(404).end(); return; }
  try {
    const type = { '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[extname(path)];
    if (!type) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', type); response.end(readFileSync(path));
  } catch { response.writeHead(404).end(); }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.YEONI_CHROMIUM,
    env: { ...process.env, HOME: temporary, XDG_CONFIG_HOME: temporary },
  });
  evidence.browser = browser.version();
  evidence.executable = process.env.YEONI_CHROMIUM ?? 'Playwright-managed Chromium';
  async function scenario(name, options, run) {
    const context = await browser.newContext({ viewport: { width: 390, height: 1100 } });
    const page = await context.newPage();
    const result = { name, passed: false, syntheticStatusRequests: 0, syntheticAudioResponses: 0, blockedRequests: [], pageErrors: [], routeErrors: [], renderedClocks: [] };
    let release;
    const gate = options.delayed ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
    let arrived;
    const submitted = new Promise(resolve => { arrived = resolve; });
    const waitForSubmission = async () => {
      let timer;
      try {
        await Promise.race([submitted, routeFailed, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Synthetic audio POST did not arrive within 30000ms')), 30_000);
        })]);
      } finally { clearTimeout(timer); }
    };
    let rejectRoute;
    const routeFailed = new Promise((_, reject) => { rejectRoute = reject; });
    // The route can fail before the scenario's race begins. Keep that rejection
    // observed, then propagate it through the same per-case evidence path.
    void routeFailed.catch(() => {});
    const policy = { enabled: true, voice: manifest.voice, useDeviceVoice: false, remainingCharacters: 1000 };
    page.on('pageerror', error => result.pageErrors.push(error.message));
    await context.route('**/*', async route => {
      try {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && url.pathname === '/api/tts') {
        assert.equal(request.headers().authorization, 'Bearer synthetic-test-token');
        if (request.method() === 'GET') {
          result.syntheticStatusRequests++;
          await route.fulfill({ json: policy }); return;
        }
        assert.equal(request.method(), 'POST');
        result.syntheticAudioResponses++;
        const body = request.postDataJSON();
        assert.equal(body.text, manifest.spokenText);
        assert.equal(body.includeAlignment, true);
        arrived(); await gate;
        await route.fulfill({ json: {
          ...policy, requestId: body.requestId,
          audioContent: options.invalidAudio ? 'YWJj' : audioBytes.toString('base64'),
          alignment: options.invalidAlignment ? { ...manifest, spokenText: 'mismatched synthetic transcript' } : manifest,
        } });
        return;
      }
      if (url.origin === origin && request.method() === 'GET' && !url.pathname.startsWith('/api/')) {
        await route.continue(); return;
      }
      result.blockedRequests.push({ method: request.method(), origin: url.origin, path: url.pathname });
      await route.abort();
      } catch (error) {
        result.routeErrors.push(error instanceof Error ? error.message : String(error));
        rejectRoute(error);
        await route.abort().catch(() => {});
      }
    });
    const reader = name => page.locator(`[data-qa-reader="${name}"]`);
    const first = reader('first');
    const audio = name => reader(name).locator('audio');
    const button = name => page.getByRole('button', { name, exact: true });
    const skin = value => page.waitForFunction(expected =>
      document.querySelector('[data-appearance-status]')?.dataset.appearanceStatus === 'ready'
      && document.querySelector('canvas')?.dataset.appearance === expected, value);
    const rest = async () => {
      const draws = await page.locator('canvas').evaluate(canvas => Number(canvas.dataset.draws));
      await page.waitForFunction(previous => {
        const canvas = document.querySelector('canvas');
        return Number(canvas?.dataset.draws) > previous && canvas?.dataset.viseme === 'rest';
      }, draws);
    };
    const renderedClock = async (name = 'first') => {
      const before = await audio(name).evaluate(element => ({
        timeMs: element.currentTime * 1000,
        draws: Number(document.querySelector('canvas')?.dataset.draws),
      }));
      const sampleHandle = await page.waitForFunction(({ key, previous }) => {
        const element = document.querySelector(`[data-qa-reader="${key}"] audio`);
        const canvas = document.querySelector('canvas');
        const draws = Number(canvas?.dataset.draws);
        if (!element || !canvas || draws <= previous.draws || element.currentTime * 1000 <= previous.timeMs
          || window.qa.snapshot()?.playback.state !== 'playing') return false;
        return { draws, appearance: canvas.dataset.appearance,
          renderedTimeMs: Number(canvas.dataset.speechTimeMs), audioTimeMs: element.currentTime * 1000 };
      }, { key: name, previous: before });
      const sample = await sampleHandle.jsonValue();
      await sampleHandle.dispose();
      result.renderedClocks.push({ previousAudioTimeMs: before.timeMs, ...sample });
      // A newly completed real render must have sampled this same media clock
      // between the surrounding observations. No frame-rate tolerance is hidden.
      assert.ok(sample.renderedTimeMs >= before.timeMs - 5, 'Canvas clock must advance from the prior media observation');
      assert.ok(sample.renderedTimeMs <= sample.audioTimeMs + 5, 'Canvas clock must not run ahead of the media');
    };
    const play = async (name = 'first') => {
      await reader(name).getByRole('button').click();
      await page.waitForFunction(key => {
        const element = document.querySelector(`[data-qa-reader="${key}"] audio`);
        return element && element.getAttribute('src') && !element.paused;
      }, name);
    };
    try {
      await Promise.race([routeFailed, (async () => {
      await page.goto(origin + '/seed');
      await page.evaluate(() => {
        localStorage.setItem('unrelated-synthetic-original', 'preserve');
        sessionStorage.setItem('unrelated-synthetic-receipt', 'preserve');
      });
      await page.goto(origin); await skin('cat');
      await first.getByRole('button', { name: '답변 읽기', exact: true }).waitFor();
      await button('움직임 켜기').click();
      await run({ page, context, reader, audio, button, skin, rest, play, renderedClock, result,
        waitForSubmission, release: () => release?.() });
      assert.deepEqual(result.pageErrors, []);
      assert.deepEqual(result.blockedRequests, []);
      assert.deepEqual(result.routeErrors, []);
      assert.equal(await page.evaluate(() => localStorage.getItem('unrelated-synthetic-original')), 'preserve');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('unrelated-synthetic-receipt')), 'preserve');
      })()]);
      result.passed = true;
    } catch (error) {
      result.failure = error instanceof Error ? error.message : String(error);
    } finally {
      release?.();
      evidence.results.push(result);
      try {
        await context.unrouteAll({ behavior: 'wait' });
        await context.close();
      } catch (error) {
        result.passed = false;
        result.failure ??= error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        if (result.routeErrors.length) {
          result.passed = false;
          result.failure ??= result.routeErrors[0];
        }
        if (result.passed) console.log('PASS', name);
        else console.error('FAIL', name, result.failure);
      }
    }
  }

  await scenario('Original fixture, no autoplay, shared live clock and uninterrupted cat/human switch', {}, async ({ page, audio, play, skin, button, renderedClock, result }) => {
    assert.equal(result.syntheticStatusRequests, 0);
    assert.equal(result.syntheticAudioResponses, 0);
    assert.equal(await audio('first').getAttribute('src'), null);
    await play();
    await page.waitForFunction(() => window.qa.snapshot()?.playback.state === 'playing');
    const first = await audio('first').evaluate(element => {
      element.playbackRate = 0.6; window.originalAudio = element;
      return { source: element.currentSrc, time: element.currentTime };
    });
    for (const [appearance, label] of [['human', '인간형'], ['cat', '고양이형']]) {
      await button(label).click(); await skin(appearance);
      assert.equal(await audio('first').evaluate((element, previous) =>
        element === window.originalAudio && element.currentSrc === previous.source
        && element.currentTime >= previous.time && !element.paused, first), true);
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        return canvas && canvas.dataset.viseme !== 'rest';
      });
      const sample = await audio('first').evaluate(element => ({
        time: element.currentTime * 1000, snapshot: window.qa.snapshot(),
      }));
      assert.equal(sample.snapshot.manifest.audioSha256, manifest.audioSha256);
      assert.ok(Math.abs(sample.snapshot.playback.currentTimeMs - sample.time) < 5);
      await renderedClock();
      await renderedClock();
    }
    assert.equal(result.syntheticAudioResponses, 1);
  });

  await scenario('Native pause, resume, seek, rate change and ended state reuse the same audio', {}, async ({ page, audio, reader, rest, play, result }) => {
    await play();
    await audio('first').evaluate(element => element.pause()); await rest();
    assert.equal(await page.evaluate(() => window.qa.snapshot()), null);
    await audio('first').evaluate(element => { element.currentTime = 1.2; element.playbackRate = 1.25; });
    await play();
    await page.waitForFunction(() => window.qa.snapshot()?.playback.state === 'playing');
    assert.ok((await page.evaluate(() => window.qa.snapshot().playback.currentTimeMs)) >= 1200);
    await audio('first').evaluate(element => { element.currentTime = element.duration - 0.2; });
    await page.waitForFunction(() => document.querySelector('[data-qa-reader="first"] audio')?.ended);
    await rest();
    assert.equal(await page.evaluate(() => window.qa.snapshot()), null);
    assert.equal(await reader('first').getByRole('button').textContent(), '다시 재생');
    await play();
    assert.equal(result.syntheticAudioResponses, 1);
  });

  await scenario('Invalid optional alignment falls back to voice-only without regeneration', { invalidAlignment: true }, async ({ page, audio, rest, play, result }) => {
    await play(); await rest();
    assert.equal(await page.evaluate(() => window.qa.snapshot()), null);
    assert.equal(await audio('first').evaluate(element => element.paused), false);
    await page.getByText('음성은 준비됐지만 입 모양 시각을 확인하지 못했어요. 음성만 재생하며 추가 생성하지 않아요.', { exact: true }).waitFor();
    await audio('first').evaluate(element => element.pause()); await play();
    assert.equal(result.syntheticAudioResponses, 1);
  });

  await scenario('Controlled buffering fault closes the actual renderer and recovers the same clock', {}, async ({ page, audio, rest, play, renderedClock, result }) => {
    await play();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      return window.qa.snapshot()?.playback.state === 'playing' && canvas && canvas.dataset.viseme !== 'rest';
    });
    await audio('first').evaluate(element => {
      element.playbackRate = 0.6;
      Object.defineProperty(element, 'readyState', { configurable: true, get: () => 1 });
      element.dispatchEvent(new Event('waiting'));
    });
    assert.equal(await page.evaluate(() => window.qa.snapshot()?.playback.state), 'waiting');
    await rest();
    await audio('first').evaluate(element => {
      delete element.readyState; element.dispatchEvent(new Event('playing'));
    });
    await page.waitForFunction(() => window.qa.snapshot()?.playback.state === 'playing');
    await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      return canvas && canvas.dataset.viseme !== 'rest';
    });
    await renderedClock();
    assert.equal(result.syntheticAudioResponses, 1);
  });

  for (const stop of ['new-answer', 'pagehide', 'visibility']) {
    await scenario(`Delayed response cannot autoplay after ${stop} (controlled lifecycle event)`, { delayed: true }, async ({ page, reader, audio, waitForSubmission, release, result }) => {
      await reader('first').getByRole('button').click(); await waitForSubmission();
      await page.evaluate(mode => {
        if (mode === 'new-answer') window.qa.stopAllSpeech();
        if (mode === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pagehide'));
        if (mode === 'visibility') {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
        }
      }, stop);
      release();
      await reader('first').getByRole('button', { name: '다시 재생', exact: true }).waitFor();
      await page.evaluate(mode => {
        if (mode === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pageshow'));
        if (mode === 'visibility') {
          delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
        }
      }, stop);
      assert.equal(await audio('first').evaluate(element => element.paused), true);
      assert.equal(await page.evaluate(() => window.qa.snapshot()), null);
      assert.deepEqual(await page.evaluate(() => window.qa.playEvents()), [], 'No real play event may occur before explicit replay');
      await reader('first').getByRole('button').click();
      await page.waitForFunction(() => window.qa.snapshot()?.playback.state === 'playing');
      assert.equal(await page.evaluate(() => window.qa.playEvents().filter(event => event.reader === 'first').length), 1);
      assert.equal(result.syntheticAudioResponses, 1);
    });
  }

  await scenario('Reader handover and old-reader unmount preserve the new reader lease', {}, async ({ page, audio, reader, play, result }) => {
    await play();
    await page.evaluate(() => window.qa.setView({ first: true, second: true }));
    await reader('second').getByRole('button').waitFor();
    await play('second');
    assert.equal(await audio('first').evaluate(element => element.paused), true);
    await page.evaluate(() => window.qa.setView({ first: false, second: true }));
    await reader('first').waitFor({ state: 'detached' });
    assert.equal(await audio('second').evaluate(element => element.paused), false);
    assert.equal(await page.evaluate(() => window.qa.snapshot()?.playback.state), 'playing');
    assert.equal(result.syntheticAudioResponses, 1);
  });

  for (const delayed of [false, true]) {
    await scenario(`Account change clears ${delayed ? 'pending' : 'playing'} speech and ignores late completion`, { delayed }, async ({ page, audio, reader, play, waitForSubmission, release, result }) => {
      if (delayed) { await reader('first').getByRole('button').click(); await waitForSubmission(); }
      else await play();
      await audio('first').evaluate(element => { window.oldAccountAudio = element; });
      await page.evaluate(() => window.qa.changeAccount('synthetic-other-owner'));
      await reader('first').getByText('계정이 바뀌었어요. 새로고침한 뒤 답변을 읽어 주세요.', { exact: true }).waitFor();
      const authReads = await page.evaluate(() => window.qa.authReadCount());
      release();
      if (delayed) await page.waitForFunction(previous => window.qa.authReadCount() > previous, authReads);
      await page.waitForFunction(() => window.oldAccountAudio.paused && !window.oldAccountAudio.getAttribute('src'));
      assert.equal(await page.evaluate(() => window.qa.snapshot()), null);
      assert.equal(await audio('first').count(), 0);
      assert.equal(result.syntheticAudioResponses, 1);
    });
  }

  await scenario('Real decode error stays closed and preserves duplicate-generation receipt', { invalidAudio: true }, async ({ page, audio, reader, rest, result }) => {
    await reader('first').getByRole('button').click();
    await page.waitForFunction(() => {
      const element = document.querySelector('[data-qa-reader="first"] audio');
      return element && element.error !== null;
    });
    await rest();
    assert.equal(await page.evaluate(() => window.qa.snapshot()), null);
    assert.notEqual(await reader('first').getByRole('button').textContent(), '읽기 중지');
    await audio('first').evaluate(element => {
      const play = element.play.bind(element);
      window.qa.retryPlay = { calls: 0, settled: 0 };
      element.play = (...args) => {
        window.qa.retryPlay.calls++;
        const promise = play(...args);
        // Observe the real promise while returning it unchanged to the reader.
        promise.then(() => { window.qa.retryPlay.settled++; }, () => { window.qa.retryPlay.settled++; });
        return promise;
      };
    });
    await reader('first').getByRole('button').click();
    await page.waitForFunction(() => window.qa.retryPlay.calls === 1 && window.qa.retryPlay.settled === 1);
    await reader('first').getByText('음성은 준비됐어요. 재생 버튼을 눌러 들어 주세요. 추가로 생성하지 않아요.', { exact: true }).waitFor();
    assert.equal(await reader('first').getByRole('button').isEnabled(), true);
    assert.equal(result.syntheticAudioResponses, 1);
  });

  await scenario('Small widths, unmount and reload retain receipts without automatic regeneration', {}, async ({ page, audio, reader, play, rest, result }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.screenshot({ path: `${output}.390.png`, fullPage: true });
    await play();
    await audio('first').evaluate(element => { window.detachedAudio = element; });
    await page.evaluate(() => window.qa.setView({ first: false, second: false }));
    await reader('first').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.detachedAudio.paused && !window.detachedAudio.getAttribute('src')), true);
    assert.equal(await page.evaluate(() => window.qa.snapshot()), null);
    await rest();
    await page.reload();
    await reader('first').getByRole('button', { name: '답변 읽기', exact: true }).click();
    await reader('first').getByText('이 답변은 이미 음성 생성을 요청했어요. 중복 생성을 막기 위해 다시 요청하지 않아요.', { exact: true }).waitFor();
    assert.equal(result.syntheticAudioResponses, 1);
    assert.equal(result.syntheticStatusRequests, 1);
  });
} catch (error) {
  evidence.infrastructureFailure = error instanceof Error ? error.message : String(error);
  console.error(evidence.infrastructureFailure);
} finally {
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = evidence.results.filter(result => result.passed).length;
  evidence.failed = evidence.results.filter(result => !result.passed).length;
  evidence.total = evidence.results.length;
  evidence.notRun = evidence.plannedCases - evidence.total;
  writeFileSync(`${output}.json`, JSON.stringify(evidence, null, 2) + '\n');
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  console.log(JSON.stringify({ evidence: `${output}.json`, passed: evidence.passed, failed: evidence.failed, infrastructureFailure: Boolean(evidence.infrastructureFailure) }));
  if (evidence.failed || evidence.infrastructureFailure) process.exitCode = 1;
}
