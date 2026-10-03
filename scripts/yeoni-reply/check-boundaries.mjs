import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = 'docs/yeoni-phase13/evidence', temporary = mkdtempSync(join(tmpdir(), 'yeoni-reply-'));
mkdirSync(out, { recursive: true });
const results = [], api = join(temporary, 'api.mjs');
await build({ entryPoints: ['app/api/ai/free-advice/route.ts'], bundle: true, platform: 'node', format: 'esm', outfile: api,
  plugins: [{ name: 'isolated-auth-only', setup(b) {
    b.onResolve({ filter: /^@\/lib\/supabase-server$/ }, () => ({ path: 'auth', namespace: 'qa' }));
    b.onResolve({ filter: /^@\/lib\/free-advice-records$/ }, () => ({ path: 'records', namespace: 'qa' }));
    b.onLoad({ filter: /.*/, namespace: 'qa' }, a => ({ contents: a.path === 'auth'
      ? 'export async function createServerSupabaseClient(){return {auth:{getUser:async()=>({data:{user:globalThis.qaAuthenticated?{id:"synthetic-owner"}:null},error:null})}}}'
      : 'export async function loadFreeAdviceContext(){throw Error("Personal records must not be accessed in this test")}', loader: 'js' }));
  } }] });
const { POST } = await import(pathToFileURL(api).href);
const env = { GEMINI_FREE_TIER_CONFIRMED: process.env.GEMINI_FREE_TIER_CONFIRMED, GEMINI_FREE_API_KEY: process.env.GEMINI_FREE_API_KEY };
const originalFetch = globalThis.fetch; let calls = 0;
const advice = { summary: '합성 검증용 예시입니다. 오늘은 천천히 진행해요.', nextSteps: ['예시의 기록 하나를 살펴보세요.'], basis: '가상 기록에 근거했어요.', limitations: '실제 사용자의 상태는 확인하지 않았어요.' };
globalThis.fetch = async () => { calls++; return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(advice) }] } }] }); };
process.env.GEMINI_FREE_TIER_CONFIRMED = 'true'; process.env.GEMINI_FREE_API_KEY = 'isolated-synthetic-key-not-a-credential';
const post = body => POST(new Request('http://isolated.test/api/ai/free-advice', { method: 'POST', body: JSON.stringify(body) }));
let responseBody, preview;
try {
  const base = { scope: 'assistant', recordSource: 'example', question: '예시에서 할 일 하나' };
  globalThis.qaAuthenticated = false; assert.equal((await post({ ...base, action: 'preview' })).status, 401);
  globalThis.qaAuthenticated = true;
  preview = await (await post({ ...base, action: 'preview' })).json(); assert.equal(preview.configured, true); assert.equal(calls, 0);
  assert.equal((await post({ ...base, action: 'analyze', fingerprint: preview.fingerprint })).status, 400);
  assert.equal((await post({ ...base, action: 'analyze', fingerprint: 'wrong', freeDataUseAcknowledged: true })).status, 409); assert.equal(calls, 0);
  const response = await post({ ...base, action: 'analyze', fingerprint: preview.fingerprint, freeDataUseAcknowledged: true });
  assert.equal(response.status, 200); responseBody = await response.json(); assert.equal(calls, 1);
  assert.equal(responseBody.performance.spokenText, [advice.summary, ...advice.nextSteps, advice.basis, advice.limitations].join('\n'));
  assert.equal(responseBody.performance.emotion, 'encouraging'); assert.deepEqual(responseBody.advice, advice);
  results.push({ name: 'actual API handler: auth, consent and fingerprint gates before one synthetic provider call; full answer plan', passed: true });
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
writeFileSync(`${out}/synthetic-api-response.json`, JSON.stringify({ synthetic: true, response: responseBody }, null, 2) + '\n');
const root = process.cwd(), audio = {
  ko: readFileSync('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3').toString('base64'),
  ja: readFileSync('docs/yeoni-voice-comparison/media/gemini-zephyr-ja-user.wav').toString('base64'),
};
const app = await build({ stdin: { contents: `import{createRoot}from'react-dom/client';import CharacterCheck from './app/assistant/character-check/CharacterCheck';createRoot(document.getElementById('root')).render(<CharacterCheck audio={${JSON.stringify(audio)}}/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, outfile: 'app.js', jsx: 'automatic', tsconfig: 'tsconfig.json', external: ['/yeoni-cat-sprite-v1.webp'], define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'isolated-browser-auth', setup(b) {
    b.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: 'auth', namespace: 'qa' }));
    b.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: `export function createClient(){return{auth:{onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}}}}}export async function authenticatedFetch(url,init){const body=JSON.parse(init.body);window.qaRequests.push(body);if(body.action==='preview')return Response.json(${JSON.stringify(preview)});if(window.qaMode==='quota')return Response.json({code:'FREE_ADVICE_QUOTA',error:'무료 AI 이용 한도에 도달했어요.'},{status:429});return Response.json(${JSON.stringify(responseBody)});}`, loader: 'js' }));
  } }] });
const js = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text;
const html = join(temporary, 'browser.html');
writeFileSync(html, `<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>window.qaRequests=[];${js.replaceAll('</script', '<\\/script')}</script></html>`);
const browser = await chromium.launch({ executablePath: process.env.YEONI_CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 390, height: 950 } }); const errors = [], external = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', async route => {
  const url = route.request().url();
  if (url.startsWith('file:') && url.includes('/yeoni/')) {
    const relative = url.slice(url.indexOf('/yeoni/')); await route.fulfill({ body: readFileSync(resolve('public' + relative)), contentType: relative.endsWith('.png') ? 'image/png' : 'image/webp' });
  } else if (/^(file:|blob:|data:)/.test(url)) await route.continue(); else { external.push(url); await route.abort(); }
});
try {
  await page.goto(pathToFileURL(html).href);
  await page.getByRole('button', { name: '예시 기록으로 먼저 보기', exact: true }).click();
  const submit = page.getByRole('button', { name: '무료 AI 조언받기', exact: true }); assert.ok(await submit.isDisabled());
  assert.equal(await page.evaluate(() => window.qaRequests.filter(r => r.action === 'analyze').length), 0);
  await page.getByRole('checkbox').check(); await submit.click();
  await page.waitForFunction(() => document.querySelector('[data-reply-status]').dataset.replyStatus === 'text-only');
  assert.equal(await page.locator('[data-reply-text]').textContent(), responseBody.performance.spokenText);
  assert.ok(await page.getByRole('button', { name: '답변 듣기', exact: true }).isDisabled());
  assert.equal(await page.evaluate(() => window.qaRequests.filter(r => r.action === 'analyze').length), 1);
  assert.equal(await page.evaluate(() => window.qaRequests.at(-1).freeDataUseAcknowledged), true);
  results.push({ name: 'actual FreeAdvicePanel to CharacterCheck: consent, server plan, full reply and silent unmatched audio', passed: true });
  await page.evaluate(() => { window.qaMode = 'quota'; });
  await page.getByRole('button', { name: '예시 기록으로 먼저 보기', exact: true }).click();
  await page.locator('[data-reply-text]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-reply-text]').count(), 0);
  await page.getByRole('checkbox').check(); await submit.click();
  await page.getByText('무료 AI 이용 한도에 도달했어요.', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-reply-text]').count(), 0);
  assert.equal(await page.evaluate(() => window.qaRequests.filter(r => r.action === 'analyze').length), 2);
  await page.reload(); assert.equal(await page.locator('[data-reply-text]').count(), 0);
  assert.equal(await page.evaluate(() => window.qaRequests.length), 0);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  results.push({ name: 'quota error clears old response, no automatic retry, reload remains empty', passed: true });
} finally {
  writeFileSync(`${out}/boundaries.json`, JSON.stringify({ results, browser: browser.version(), authentication: 'isolated stub', provider: 'synthetic response', realProviderCalls: 0, personalRecordReads: 0, errors, external }, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ passed: results.length }));
