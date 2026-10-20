// Actual React components; disposable loopback origin and synthetic records only.
import { build } from './browser-qa/node_modules/esbuild/lib/main.js';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { OA_REPORT_INVENTORY } from '../app/lib/oaReportInventory.ts';
import { buildCurrentWorkoutSettings, CURRENT_WEEKLY_METHODS } from '../app/data/currentWorkoutDirection.ts';
import { EMPTY_USER_WORKOUT_SETTINGS, USER_WORKOUT_SETTINGS_KEY } from '../app/data/userWorkoutSettings.ts';
import { SELECTED_WEEKLY_WORKOUT_PLAN_KEY } from '../app/data/workoutPlans.ts';

const output = resolve('scripts/browser-qa/.generated/body-composition-coach');
mkdirSync(output, { recursive: true });
const result = await build({
  stdin: { contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import FitnessAiCoachPanel from './app/components/FitnessAiCoachPanel';
    function App(){const [show,setShow]=useState(true);return <main>
      <button onClick={()=>setShow(x=>!x)}>합성 화면 이동</button>
      {show?<FitnessAiCoachPanel/>:<p>다른 화면</p>}
    </main>}createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [{ name: 'synthetic-auth-transport', setup(b) {
    b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: 'transport', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export async function authenticatedFetch(path,options) {
        (window.__calls??=[]).push(path);
        if(path==='/api/fitness/coach/history')return {ok:true,json:async()=>({reviews:[]})};
        if(path==='/api/fitness/coach'){
          const payload=JSON.parse(options.body);(window.__payloads??=[]).push(payload);
          return {ok:true,json:async()=>({analysisType:payload.analysisType,analysisLabel:'합성 분석',
            overview:'합성 응답',positives:[],cautions:[],nextSession:[],rationale:'합성 근거',
            safety:'합성 안내',confidence:'낮음',source:'local',historySaved:false})};
        }
        throw new Error('No remote coach calls allowed in this fixture');
      }
    ` }));
  } }],
});
const css = (await postcss([tailwindcss({ content: ['./app/components/*.tsx'] })])
  .process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html; charset=utf-8');
  res.end(req.url === '/app.js' ? result.outputFiles[0].text :
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:8px;font-family:sans-serif}main{max-width:1000px;margin:auto}</style><div id="root"></div><script src="/app.js"></script></html>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
const checks = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  await page.goto(origin);
  const source = Object.fromEntries(OA_REPORT_INVENTORY.map(([key, originalLabel, originalUnit]) =>
    [key, { device: 'OA Smart Scale PRO', originalLabel, originalUnit, method: 'ocr', mappingVersion: 'oa-pro-v1' }]));
  const fixture = {
    '2026-10-10': { muscleMass: 50, musclePercent: 60, metricSources: source },
    '2026-10-20': { muscleMass: 49, musclePercent: 61, metricSources: source },
  };
  await page.evaluate(records => {
    localStorage.setItem('ai-fitness-inbody-records', JSON.stringify(records));
    localStorage.setItem('fitness-cloud-sync-user', 'synthetic-A');
  }, fixture);
  await page.reload();
  const panel = page.getByRole('region', { name: '체성분과 운동 함께 점검' });
  const button = panel.getByRole('button', { name: '체성분·운동 무료 점검' });
  const storage = () => page.evaluate(() => JSON.stringify({ ...localStorage }));
  const before = await storage();
  const calls = await page.evaluate(() => [...window.__calls]);
  await button.click();
  await expect(panel.getByText('근육량 kg와 근육률 %의 변화 방향이 다릅니다.', { exact: true })).toBeVisible();
  await expect(panel.getByText('BMI: —', { exact: true })).toBeVisible();
  await expect(panel.getByText('골격근량: —', { exact: true })).toBeVisible();
  assert.equal(await storage(), before);
  assert.deepEqual(await page.evaluate(() => window.__calls), calls);
  checks.push('actual coach panel local check: sourced trend, missing BMI/skeletal, zero request/write');
  await button.click();
  await panel.getByText('이번 화면의 분석 문장·이력 (1/5)',{exact:true}).click();
  const localHistory=panel.locator('details[aria-label="화면 내 로컬 점검 이력"]');
  await expect(localHistory.getByRole('article')).toHaveCount(1);
  await expect(localHistory).toContainText('영구 저장 없음');
  await expect(localHistory).toContainText('제품 하중·밴드 저항 수치는 확인되지 않았습니다');
  assert.equal(await storage(),before);
  assert.deepEqual(await page.evaluate(()=>window.__calls),calls);
  await localHistory.getByRole('button',{name:'화면 점검 이력 비우기'}).click();
  await expect(localHistory).toHaveCount(0);
  await expect(panel.getByText('BMI: —',{exact:true})).toBeVisible();
  await button.click();
  checks.push('analysis narrative session history is deduplicated, read-only and can be cleared locally');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    checks.push(`layout ${width}px`);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addStyleTag({ content: 'html{font-size:32px}' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.getByText('비교 기준과 자료 제한', { exact: true }).click();
  await expect(panel.getByText(/30일 이내라는 앱 표시 기준/)).toBeVisible();
  checks.push('200% text reflow and comparison criteria disclosure');
  await page.screenshot({ path: resolve(output, 'review-320.png'), fullPage: true });
  await page.reload();
  await expect(panel.locator('details[aria-label="화면 내 로컬 점검 이력"]')).toHaveCount(0);
  await expect(panel.getByText('BMI: —', { exact: true })).toHaveCount(0);
  await button.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByText('BMI: —', { exact: true })).toBeVisible();
  assert.equal(await storage(), before);
  checks.push('reload rereads saved synthetic data; keyboard action');
  await page.getByRole('button', { name: '합성 화면 이동' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: '합성 화면 이동' }).click();
  await button.click();
  await expect(panel.getByText('BMI: —', { exact: true })).toBeVisible();
  checks.push('navigate away and back');
  await page.evaluate(() => {
    localStorage.setItem('ai-fitness-workout-completed-days', JSON.stringify({ '2026-10-20': { workoutPain: true } }));
    window.dispatchEvent(new Event('yeoni-records-changed'));
  });
  await expect(panel.getByText('BMI: —', { exact: true })).toHaveCount(0);
  await button.click();
  await expect(panel.getByText(/통증·허리 악화·신경 증상 기록을 먼저/).last()).toBeVisible();
  checks.push('record refresh clears result; pain overrides divergent body metrics');
  await page.evaluate(() => {
    localStorage.setItem('fitness-cloud-sync-user', 'synthetic-B');
    window.dispatchEvent(new Event('yeoni-cloud-session-changed'));
  });
  await expect(button).toBeDisabled();
  await expect(panel.getByText('BMI: —', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('status')).toContainText('계정 상태가 바뀌었습니다');
  checks.push('account event clears output and blocks stale props until remount');
  await page.evaluate(() => {
    localStorage.setItem('ai-fitness-inbody-records', '{}');
    localStorage.setItem('ai-fitness-workout-completed-days', '{}');
  });
  await page.reload(); await button.click();
  await expect(panel.getByText(/마지막 체성분 기록 없음/)).toBeVisible();
  await expect(panel.getByText(/비교 가능한 최근 체성분 자료가 부족/)).toBeVisible();
  checks.push('new session has no old measurements or fabricated values');
  await page.evaluate(() => {
    window.__getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('synthetic storage unavailable'); };
  });
  await button.click();
  await expect(panel.getByRole('alert')).toContainText('저장된 기록을 읽지 못했습니다');
  await page.evaluate(() => { Storage.prototype.getItem = window.__getItem; });
  checks.push('storage read failure displayed without stale result');
  const scenarios = [
    {
      name: 'old measurements are stale, not a recent trend',
      records: { '2026-09-01': { muscleMass: 50, metricSources: source } },
      expected: '오래된 측정치 · 현재 비교 제외',
    },
    {
      name: 'OCR date conflict excludes the value',
      records: { '2026-10-20': { muscleMass: 50, metricSources: { ...source,
        measurementDate: { ...source.measurementDate, originalText: '2026-10-19' } } } },
      expected: '값 확인 필요 · 비교 제외',
    },
    {
      name: 'incompatible unit prevents comparison',
      records: { '2026-10-20': { muscleMass: 50, metricSources: { ...source,
        muscleMass: { ...source.muscleMass, originalUnit: '%' } } } },
      expected: '기기·출처·단위 확인 필요 · 비교 제외',
    },
    {
      name: 'changed device starts a single-observation series',
      records: { ...fixture, '2026-10-20': { muscleMass: 49, metricSources: { ...source,
        muscleMass: { ...source.muscleMass, device: 'OA long report' } } } },
      expected: '최근 1회 · 비교 자료 부족',
    },
    {
      name: 'missing latest measurement is historical rather than current',
      records: { '2026-10-10': { muscleMass: 50, metricSources: source },
        '2026-10-20': { bodyFatPercent: 24 } },
      expected: '최신 측정일에 없는 항목 · 과거 참고값',
    },
  ];
  for (const scenario of scenarios) {
    await page.evaluate(records => {
      localStorage.setItem('ai-fitness-inbody-records', JSON.stringify(records));
      window.dispatchEvent(new Event('yeoni-records-changed'));
    }, scenario.records);
    const saved = await storage(), requests = await page.evaluate(() => [...window.__calls]);
    await button.click();
    const muscle = panel.getByRole('listitem').filter({ hasText: '전체 근육량 추정치:' });
    await expect(muscle).toContainText(scenario.expected);
    await expect(muscle).not.toContainText('표시 수치 차이');
    await button.click();
    await expect(muscle).toContainText(scenario.expected);
    assert.equal(await storage(), saved);
    assert.deepEqual(await page.evaluate(() => window.__calls), requests);
    checks.push(scenario.name + '; repeat has no write/request');
  }
  await page.evaluate(records => {
    localStorage.setItem('ai-fitness-inbody-records', JSON.stringify(records));
    localStorage.setItem('ai-fitness-workout-completed-days', JSON.stringify({ '2026-10-20': { workoutFatigue: 4 } }));
    window.dispatchEvent(new Event('yeoni-records-changed'));
  }, fixture);
  await button.click();
  await expect(panel.getByText(/높은 피로 또는 중단 기록이 있습니다/).last()).toBeVisible();
  checks.push('high fatigue takes priority over comparable body trends');
  const configuration = buildCurrentWorkoutSettings(structuredClone(EMPTY_USER_WORKOUT_SETTINGS));
  const session = {
    workoutDone:true,workoutGroupId:'current-fullbody-strength-circuit',workoutStatus:'completed',
    workoutDifficulty:'easy',workoutFatigue:2,workoutBackStatus:'none',workoutMethod:CURRENT_WEEKLY_METHODS.mon,
    workoutExerciseRecords:['덤벨 고블릿 스쿼트','밴드 로우','덤벨 플로어프레스','루프밴드 사이드워크','버드독'].map((exerciseName,i)=>({
      exerciseName,status:'completed',sets:Array.from({length:3},(_,n)=>({
        setNumber:n+1,completed:true,plannedReps:i===1?10:i===4?6:8,reps:i===1?10:i===4?6:8,
        weightKg:i===0||i===2?5:undefined,bandLevel:i===1||i===3?'가벼움':undefined,
      })),
    })),
  };
  const sessions=Object.fromEntries(['2026-10-19','2026-10-16','2026-10-14','2026-10-12','2026-10-09','2026-10-05'].map(date=>[date,session]));
  await page.evaluate(({configuration,sessions,settingsKey,planKey})=>{
    localStorage.setItem(settingsKey,JSON.stringify(configuration));
    localStorage.setItem(planKey,'five-day-fullbody-circuit');
    localStorage.setItem('ai-fitness-workout-completed-days',JSON.stringify(sessions));
    window.dispatchEvent(new Event('yeoni-records-changed'));
  },{configuration,sessions,settingsKey:USER_WORKOUT_SETTINGS_KEY,planKey:SELECTED_WEEKLY_WORKOUT_PLAN_KEY});
  const savedCombined=await storage();
  for(const label of ['직후 피드백','주간 분석','월간 분석','장기 분석','계획 점검','계획안 받기']){
    await page.evaluate(()=>window.dispatchEvent(new Event('yeoni-records-changed')));
    await expect(panel.getByText('BMI: —',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:new RegExp('^'+label)}).click();
    const proposal=panel.getByRole('region',{name:'기록 기반 운동 구성 제안'});
    await expect(proposal.getByText(/검토할 변경:.*햄스트링/)).toBeVisible();
    await expect(proposal.getByText(/준비 조건:.*지지대/)).toBeVisible();
    await expect(proposal.getByText(/전체 근육량 추정치 근거/)).toBeVisible();
    await expect(proposal.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('button',{name:new RegExp('^'+label)})).toBeEnabled();
    assert.equal(await storage(),savedCombined);
    checks.push(label+': local body evidence and existing replacement preview; no settings write');
  }
  const payloads=await page.evaluate(()=>window.__payloads);
  assert.equal(payloads.length,6);
  for(const payload of payloads)assert.deepEqual(Object.keys(payload).sort(),
    (['plan','program'].includes(payload.analysisType)?['analysisType','currentSettings','outcomeBaseline','snapshot']:['analysisType','outcomeBaseline','snapshot']).sort());
  checks.push('six synthetic analysis requests retain original payload fields; no joined evidence sent');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(output,'combined-review-390.png'),fullPage:true});
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  const evidence = { passed: checks.length, checks, externalRequests: external.length, errors,
    limitation: 'Isolated actual components with synthetic history transport. Not hosted authentication or real account QA.' };
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  if (browser) await browser.close();
  await new Promise(r => server.close(r));
}
