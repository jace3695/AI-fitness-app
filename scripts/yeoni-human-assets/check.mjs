import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const kind=process.env.YEONI_BROWSER || 'chromium';
assert.ok(['chromium','webkit'].includes(kind));
const output=new URL(`../../.e2e/yeoni-human-assets/${kind}/`,import.meta.url);mkdirSync(output,{recursive:true});
const browser=await ({chromium,webkit})[kind].launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000}});
const errors=[],external=[],results=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url())});
const test=async(name,fn)=>{await fn();results.push({name,passed:true})};
const portrait=page.locator('#portrait');const pixels=()=>portrait.evaluate(c=>c.toDataURL());
try {
 await page.goto(new URL('../../docs/yeoni-phase7/Yeoni_Human_A_Asset_Preview.html',import.meta.url).href);
 await page.waitForFunction(()=>document.querySelector('#portrait').dataset.mouth==='closed');
 await test('offline images load; static default; no audio or animation',async()=>{assert.equal(await portrait.getAttribute('data-eye'),'eyesOpen');assert.equal(await page.locator('audio,video').count(),0);assert.equal(await page.evaluate(()=>Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)),true);const before=await pixels();await page.waitForTimeout(200);assert.equal(await pixels(),before)});
 await page.screenshot({path:new URL('desktop.png',output).pathname,fullPage:true});
 await test('six distinct mouth compositions and pressed state',async()=>{const states=[];for(const id of ['closed','a','i','u','e','o']){const b=page.locator(`#mouth [data-id="${id}"]`);await b.click();assert.equal(await portrait.getAttribute('data-mouth'),id);assert.equal(await b.getAttribute('aria-pressed'),'true');states.push(await pixels())}assert.equal(new Set(states).size,6)});
 await test('three eye states preserve selected mouth',async()=>{const states=[];for(const id of ['eyesOpen','eyesHalf','eyesClosed']){await page.locator(`#eye [data-id="${id}"]`).click();assert.equal(await portrait.getAttribute('data-mouth'),'o');states.push(await pixels())}assert.equal(new Set(states).size,3)});
 await test('white lavender dark background and reset',async()=>{for(const b of await page.locator('#background button').all()){await b.click();assert.equal(await b.getAttribute('aria-pressed'),'true')}await page.screenshot({path:new URL('dark.png',output).pathname});await page.locator('#reset').click();assert.equal(await portrait.getAttribute('data-mouth'),'closed');assert.equal(await portrait.getAttribute('data-eye'),'eyesOpen')});
 await test('320 390 430 1280px layouts; six-mouth comparison visible',async()=>{for(const width of [320,390,430,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(width===390)await page.screenshot({path:new URL('mobile-390.png',output).pathname,fullPage:true})}await page.locator('.comparison').screenshot({path:new URL('mouth-comparison.png',output).pathname})});
 await test('reload returns default; no runtime errors or network requests',async()=>{await page.reload();await page.waitForFunction(()=>document.querySelector('#portrait').dataset.mouth==='closed');assert.equal(await portrait.getAttribute('data-eye'),'eyesOpen');assert.deepEqual(errors,[]);assert.deepEqual(external,[])});
}finally{writeFileSync(new URL('results.json',output),JSON.stringify({browser:kind,version:browser.version(),results,errors,external,scope:'Static asset-review HTML only; no human animation or speech validation.'},null,2));await browser.close()}
console.log(`${kind}: ${results.length} human static asset checks passed`);
