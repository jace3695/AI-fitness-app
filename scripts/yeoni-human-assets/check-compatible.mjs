import { chromium, webkit } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const kind=process.env.YEONI_BROWSER || 'chromium';
assert.ok(['chromium','webkit'].includes(kind));
const out=new URL(`../../.e2e/yeoni-preview-compatible/${kind}/`,import.meta.url);mkdirSync(out,{recursive:true});
const url=new URL('../../docs/yeoni-phase7/Yeoni_Human_A_Compatible_Preview.html',import.meta.url);
const html=readFileSync(url,'utf8');assert.ok(!/<script|<canvas/.test(html));
const browser=await ({chromium,webkit})[kind].launch({headless:true});
const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:760,height:900}});
const page=await context.newPage();const external=[],errors=[],results=[];
page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url())});page.on('pageerror',e=>errors.push(e.message));
const test=async(name,fn)=>{await fn();results.push({name,passed:true})};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 await test('legacy Canvas preview has no initialization when JavaScript is disabled',async()=>{await page.goto(new URL('../../docs/yeoni-phase7/Yeoni_Human_A_Asset_Preview.html',import.meta.url).href);assert.equal(await page.locator('#portrait').getAttribute('data-mouth'),null);assert.match(await page.locator('#status').innerText(),/불러오는 중/)});
 await page.goto(url.href);
 await test('compatible portrait loads without JavaScript or Canvas',async()=>{assert.equal(await page.locator('canvas,script').count(),0);assert.equal(await page.locator('.eyesOpen').isVisible(),true);assert.equal(await page.locator('.closed').isVisible(),true);await page.screenshot({path:new URL('initial.png',out).pathname,fullPage:true})});
 await test('six radio mouth choices produce six distinct displayed portraits with JS disabled',async()=>{const hashes=[];for(const id of ['closed','a','i','u','e','o']){await page.locator(`#yeoni-mouth-${id}`).check();assert.equal(await page.locator(`.yeoni-mouth.${id}`).isVisible(),true);hashes.push(digest(await page.locator('.yeoni-stage').screenshot()))}assert.equal(new Set(hashes).size,6)});
 await test('eye changes preserve mouth and backgrounds change with native controls',async()=>{for(const id of ['open','half','closed'])await page.locator(`#yeoni-eye-${id}`).check();assert.equal(await page.locator('.eyesClosed').isVisible(),true);assert.equal(await page.locator('.yeoni-mouth.o').isVisible(),true);const before=digest(await page.locator('.yeoni-stage').screenshot());await page.locator('#yeoni-background-contrast').check();assert.notEqual(digest(await page.locator('.yeoni-stage').screenshot()),before);await page.screenshot({path:new URL('dark-closed.png',out).pathname,fullPage:true})});
 await test('320 and 390px layout and reload remain useful with JS disabled',async()=>{for(const width of [320,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)}await page.reload();assert.equal(await page.locator('.closed').isVisible(),true);await page.screenshot({path:new URL('mobile-390.png',out).pathname,fullPage:true})});
 await test('sandboxed iframe permits static rendering and native mouth selection without scripts',async()=>{const srcdoc=html.replaceAll('&','&amp;').replaceAll('"','&quot;');await page.setContent(`<iframe sandbox="" style="width:100%;height:900px;border:0" srcdoc="${srcdoc}"></iframe>`);const frame=page.frameLocator('iframe');await frame.locator('#yeoni-mouth-u').check();assert.equal(await frame.locator('.yeoni-mouth.u').isVisible(),true);assert.equal(await frame.locator('.yeoni-mouth.closed').isVisible(),false);await page.screenshot({path:new URL('sandbox.png',out).pathname});assert.deepEqual(external,[]);assert.deepEqual(errors,[])});
}finally{writeFileSync(new URL('results.json',out),JSON.stringify({browser:kind,version:browser.version(),javaScriptEnabled:false,results,external,errors,scope:'JS-disabled browsers and sandboxed iframe; actual user ChatGPT preview still needs user confirmation.'},null,2));await browser.close()}
console.log(`${kind}: ${results.length} script-disabled compatibility checks passed`);
