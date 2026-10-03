import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const target=resolve(process.argv[2] || '../deliverables/Yeoni_Voice_Comparison.html');
const evidence=resolve('docs/yeoni-voice-comparison/evidence/received-audio');
const sourcePlan=JSON.parse(readFileSync('docs/yeoni-voice-comparison/plan.json','utf8'));
const sourceClips=[...sourcePlan.baselines,...sourcePlan.candidate.clips];
mkdirSync(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.YEONI_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
const page=await context.newPage();
const errors=[],external=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>/^(file:|data:|blob:)/.test(route.request().url())?route.continue():(external.push(route.request().url()),route.abort()));
async function test(name,fn){await fn();results.push({name,passed:true});console.log('PASS',name);}
const play=id=>page.locator(`[data-clip="${id}"] [data-play]`).click();
try{
 await page.goto(pathToFileURL(target).href);
 await test('all four exact audio files are embedded and enabled, no autoplay',async()=>{
  assert.equal(await page.locator('audio').count(),1);
  assert.equal(await page.locator('audio').evaluate(a=>a.paused&&!a.currentSrc),true);
  assert.equal(await page.locator('[data-clip]').count(),4);
  assert.equal(await page.locator('[data-play]:disabled').count(),0);
  const embedded=await page.evaluate(()=>comparison.clips.map(c=>({id:c.id,src:c.src})));
  for(const clip of embedded){const expected=sourceClips.find(c=>c.id===clip.id);assert.equal(createHash('sha256').update(Buffer.from(clip.src.split(',')[1],'base64')).digest('hex'),expected.sha256);}
 });
 await test('comparison switches through one player; both attached WAVs play to completion at 1x',async()=>{
  await play('original-ko');await page.waitForFunction(()=>!document.querySelector('audio').paused);
  for(const id of ['candidate-ko','candidate-ja']){
   await play(id);
   await page.waitForFunction(()=>!document.querySelector('audio').paused&&document.querySelector('audio').currentTime>0);
   const actual=await page.locator('audio').evaluate(a=>({duration:a.duration,rate:a.playbackRate,error:a.error}));
   assert.ok(Math.abs(actual.duration-sourceClips.find(c=>c.id===id).durationSeconds)<.005);assert.equal(actual.rate,1);assert.equal(actual.error,null);
   await page.waitForFunction(()=>document.querySelector('audio').ended);
  }
  assert.equal(await page.locator('audio').count(),1);
 });
 await test('optional replacement preserves import provenance using UI-only fixtures',async()=>{
  for(const id of ['candidate-ko','candidate-ja'])await page.locator(`[data-clip="${id}"] summary`).click();
  await page.locator('#file-candidate-ko').setInputFiles('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3');
  await page.locator('#file-candidate-ja').setInputFiles('docs/yeoni-phase12/media/yeoni-zephyr-ja-approved.mp3');
  await page.waitForFunction(()=>document.querySelectorAll('[data-play="candidate-ko"]:disabled').length===0&&document.querySelectorAll('[data-play="candidate-ja"]:disabled').length===0);
  assert.match(await page.locator('[data-clip="candidate-ko"] .badge').textContent(),/출처 미확인/);
  await play('candidate-ko');await page.waitForFunction(()=>!document.querySelector('audio').paused);
  await play('candidate-ja');await page.waitForFunction(()=>!document.querySelector('audio').paused);
  assert.equal(await page.locator('audio').count(),1);
 });
 await test('invalid upload reports an error and retains last valid candidate',async()=>{
  await page.locator('#file-candidate-ko').setInputFiles({name:'invalid.wav',mimeType:'audio/wav',buffer:Buffer.from('not an audio file')});
  await page.getByText('재생할 수 없는 파일입니다. WAV 또는 MP3를 확인해 주세요.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-play="candidate-ko"]:disabled').count(),0);
 });
 await test('review saves and downloads; reload restores attached audio and saved review',async()=>{
  await page.locator('#notes').fill('UI verification fixture; not an actual listening verdict.');
  const downloadEvent=page.waitForEvent('download');await page.locator('#save-review').click();
  const download=await downloadEvent;
  const record=JSON.parse(readFileSync(await download.path(),'utf8'));
  assert.match(record.review.notes,/UI verification fixture/);assert.equal(record.automaticVerdict,false);
  assert.equal(record.clips.filter(c=>c.provenance==='user-imported-unverified').length,2);
  const planDownloadEvent=page.waitForEvent('download');await page.locator('#comparison-info summary').click();await page.locator('#request-plan').click();
  const requestPlan=JSON.parse(readFileSync(await (await planDownloadEvent).path(),'utf8'));
  assert.equal(requestPlan.candidate.generationApproved,sourcePlan.candidate.generationApproved);assert.equal(requestPlan.candidate.attemptsMade,sourcePlan.candidate.attemptsMade);
  await page.reload();
  assert.match(await page.locator('#notes').inputValue(),/UI verification fixture/);
  assert.equal(await page.locator('[data-play]:disabled').count(),0);
  assert.equal(await page.locator('audio').evaluate(a=>a.paused&&!a.currentSrc),true);
  await play('candidate-ko');await page.waitForFunction(()=>Math.abs(document.querySelector('audio').duration-5.72)<.005);
  await page.locator('audio').evaluate(a=>a.pause());
  const restoredDownloadEvent=page.waitForEvent('download');await page.locator('#save-review').click();
  const restoredRecord=JSON.parse(readFileSync(await(await restoredDownloadEvent).path(),'utf8'));
  assert.equal(restoredRecord.clips.filter(c=>c.provenance==='user-provided-comparison-audio').length,2);
  for(const clip of restoredRecord.clips)assert.equal(clip.sha256,sourceClips.find(c=>c.id===clip.id).sha256);
  await page.locator('#notes').fill('');
 });
 await test('mobile/desktop layout fits and all playback remains offline',async()=>{
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(width!==320)await page.screenshot({path:`${evidence}/comparison-${width}.png`,fullPage:true});}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 });
}finally{
 writeFileSync(`${evidence}/browser.json`,JSON.stringify({browser:'chromium',version:browser.version(),results,errors,externalRequests:external,candidateFiles:sourcePlan.candidate.clips.map(({id,sha256,durationSeconds})=>({id,sha256,durationSeconds})),optionalReplacementFixtures:'Original MP3s used only to check the optional file replacement flow; actual attached WAVs tested separately.',providerCalls:0,perceptualListeningVerified:false,webkitVerified:false,physicalIPhoneVerified:false},null,2)+'\n');
 await browser.close();
}
