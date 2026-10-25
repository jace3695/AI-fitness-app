// Real Recorder UI, no recording/decoder/provider invoked. In-memory isolated document.
import {build} from './browser-qa/node_modules/esbuild/lib/main.js';
import {chromium,expect} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const out='scripts/browser-qa/.generated/assessment-readiness';mkdirSync(out,{recursive:true});
const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import Recorder from './app/language/practice/Recorder';createRoot(document.getElementById('root')).render(<main style={{maxWidth:680,margin:'auto',padding:16}}><Recorder text='Synthetic reference only'/></main>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},tsconfig:'tsconfig.json'});
const css=(await postcss([tailwindcss({content:['app/language/practice/Recorder.tsx','app/language/practice/AssessmentAvailability.tsx']})]).process(readFileSync('app/globals.css','utf8'),{from:undefined})).css+readFileSync('app/language/language.css','utf8');
let browser,context,failure;const passed=[],errors=[],requests=[];
try {
 browser=await chromium.launch({channel:'msedge',headless:true});context=await browser.newContext({viewport:{width:390,height:844},permissions:[]});
 await context.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><body class="language-app-shell"><div id="root"></div></body></html>');
 await page.evaluate(()=>{window.qa={capture:0,fetch:0};Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>{window.qa.capture++;throw Error('Forbidden capture');}}});window.fetch=()=>{window.qa.fetch++;throw Error('Forbidden fetch');};});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const summary=page.locator('summary').filter({hasText:'발음 점수는 준비 중이에요'});
 await expect(summary).toBeVisible();await expect(page.getByRole('button',{name:'내 발음 녹음',exact:true})).toBeEnabled();
 await expect(summary.locator('..')).not.toHaveAttribute('open');passed.push('Recorder keeps local recording available; assessment details initially collapsed');
 await summary.focus();await page.keyboard.press('Enter');await expect(summary.locator('..')).toHaveAttribute('open','');
 const score=page.getByRole('button',{name:'발음 점수 받기 · 준비 중',exact:true});await expect(score).toBeVisible();await expect(score).toBeDisabled();
 await expect(page.getByText('일본어 억양은 점수를 매기지 않아요.',{exact:false})).toBeVisible();await expect(page.getByText('발음 정확도',{exact:true})).toBeVisible();await expect(page.getByText('말하기 흐름',{exact:true})).toBeVisible();
 const described=await score.getAttribute('aria-describedby');assert.ok(described);await expect(page.locator('[id="'+described+'"]')).toHaveText('서비스 연결과 전송 안내가 준비된 뒤 사용할 수 있어요.');passed.push('keyboard opens readiness; both supported metrics and unsupported intonation clear; disabled control has reason');
 for(const width of [390,1280]){await page.setViewportSize({width,height:844});await score.scrollIntoViewIfNeeded();const box=await score.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:out+'/readiness-'+width+'.png',fullPage:true});}passed.push('390 and desktop fit normal document flow without horizontal overflow');
 await summary.focus();await page.keyboard.press('Enter');await expect(summary.locator('..')).not.toHaveAttribute('open');await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'내 발음 녹음',exact:true})).toBeFocused();passed.push('collapsed auxiliary details preserve next keyboard action to local recording');
 assert.deepEqual(await page.evaluate(()=>window.qa),{capture:0,fetch:0});assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);passed.push('no capture, provider request, external resource or page error');
}catch(error){failure=error.stack||String(error);}finally{await context?.close();await browser?.close();writeFileSync(out+'/result.json',JSON.stringify({passed,errors,requests,failure,scope:'isolated real Recorder; no audio/score/credentials/user data'},null,2));console.log(JSON.stringify({passed,errors,requests,failure},null,2));}
if(failure)process.exitCode=1;
