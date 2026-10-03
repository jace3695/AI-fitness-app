import {chromium,webkit} from 'playwright';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {renderReferencePortrait} from './reference-renderer.mjs';
const kind=process.env.YEONI_BROWSER||'chromium';
assert.ok(['chromium','webkit'].includes(kind));
const root=new URL('../../',import.meta.url),assets=new URL('public/yeoni/human/reference-v3/',root);
const spec=JSON.parse(readFileSync(new URL('manifest.json',assets)));
const out=new URL(`.e2e/yeoni-reference-v3/${kind}/`,root);mkdirSync(out,{recursive:true});
const html=readFileSync(new URL('docs/yeoni-phase7/Yeoni_Human_A_Reference_Preview.html',root),'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(readFileSync(new URL(spec.base.image,assets))),hash(readFileSync(new URL('docs/yeoni-phase7/reference/human-a-selected.png',root))));
const browser=await ({chromium,webkit})[kind].launch({headless:true});
const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:940,height:1050}});
const page=await context.newPage(),results=[],errors=[],external=[];let identity;const cssFrames=[];let originalFrame;
const watch=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url())})};watch(page);
const test=async(name,fn)=>{await fn();results.push({name,passed:true})};
try{
 await page.goto(new URL('docs/yeoni-phase7/Yeoni_Human_A_Reference_Preview.html',root).href);
 const revised=page.locator('.revised'),original=page.locator('.original');originalFrame='data:image/png;base64,'+(await original.screenshot()).toString('base64');
 await test('reference and revised baseline display without JavaScript',async()=>{assert.equal(await page.locator('script,canvas').count(),0);assert.equal(await page.locator('.reference-patch:visible').count(),0);await page.screenshot({path:new URL('baseline.png',out).pathname,fullPage:true})});
 await test('seven mouths differ while the original comparison stays fixed',async()=>{const ref=hash(await original.screenshot()),states=[];for(const id of ['closed','a','i','u','e','o','small']){await page.locator('#reference-mouth-'+id).check();states.push(hash(await revised.screenshot()));assert.equal(hash(await original.screenshot()),ref)}assert.equal(new Set(states).size,7)});
 await test('independent blink states keep the selected mouth',async()=>{const states=[];for(const id of ['open','eyesHalf','eyesClosed']){await page.locator('#reference-eye-'+id).check();assert.equal(await page.locator('#reference-mouth-small').isChecked(),true);states.push(hash(await revised.screenshot()))}assert.equal(new Set(states).size,3);await page.screenshot({path:new URL('blink-and-mouth.png',out).pathname,fullPage:true})});
 await test('all 21 CSS-rendered eye and mouth combinations are captured for direct original comparison',async()=>{for(const eye of ['open','eyesHalf','eyesClosed']){await page.locator('#reference-eye-'+eye).check();for(const mouth of ['closed','a','i','u','e','o','small']){await page.locator('#reference-mouth-'+mouth).check();cssFrames.push({eye,mouth,src:'data:image/png;base64,'+(await revised.screenshot()).toString('base64')})}}assert.equal(cssFrames.length,21)});
 await test('same-position original overlay and full portrait work',async()=>{const before=hash(await revised.screenshot());await page.locator('#reference-overlay').check();assert.notEqual(hash(await revised.screenshot()),before);await page.screenshot({path:new URL('overlay.png',out).pathname,fullPage:true});await page.locator('#reference-overlay').uncheck();await page.locator('#reference-full').check();await page.locator('#reference-mouth-closed').check();await page.locator('#reference-eye-open').check();await page.screenshot({path:new URL('full-portrait.png',out).pathname,fullPage:true})});
 await test('320 390 736px layouts and reload restore the original baseline',async()=>{for(const width of [320,390,736]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)}await page.setViewportSize({width:390,height:950});await page.reload();assert.equal(await page.locator('.reference-patch:visible').count(),0);await page.screenshot({path:new URL('mobile-390.png',out).pathname,fullPage:true})});
 await test('sandbox without scripts still changes the intended face',async()=>{const srcdoc=html.replaceAll('&','&amp;').replaceAll('"','&quot;');await page.setContent(`<iframe sandbox="" style="width:100%;height:1200px;border:0" srcdoc="${srcdoc}"></iframe>`);const frame=page.frameLocator('iframe');await frame.locator('#reference-mouth-o').check();assert.equal(await frame.locator('.patch-o').isVisible(),true);assert.equal(await frame.locator('.patch-a').isVisible(),false)});
 const canvasPage=await browser.newPage({viewport:{width:1024,height:1250}});watch(canvasPage);
 await canvasPage.setContent('<canvas id="review" width="1024" height="1536"></canvas>');
 const imageData={};for(const file of [spec.base.image,...Object.values(spec.parts).flat().map(p=>p.image)])imageData[file]='data:image/'+(file.endsWith('.png')?'png':'webp')+';base64,'+readFileSync(new URL(file,assets)).toString('base64');
 await test('all 21 full-resolution states preserve pixels outside edited regions',async()=>{
  identity=await canvasPage.evaluate(async({spec,imageData,renderer,cssFrames,originalFrame})=>{
   const render=new Function('return '+renderer)();const images={};for(const[file,data]of Object.entries(imageData)){const im=new Image();im.src=data;await im.decode();images[file]=im}
   const factory=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
   const c=document.querySelector('#review'),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(images[spec.base.image],0,0);
   const original=new Uint8ClampedArray(ctx.getImageData(0,0,...spec.size).data),rows=[];
   for(const eye of ['open','eyesHalf','eyesClosed'])for(const mouth of ['closed','a','i','u','e','o','small']){
    render(ctx,images[spec.base.image],images,spec,eye,mouth,factory);
    const data=ctx.getImageData(0,0,...spec.size).data,regions=[...(spec.parts[eye]||[]),...(spec.parts[mouth]||[])].map(p=>p.rect);let changed=0,outside=0,edge=0;
    for(let p=0;p<data.length;p+=4){if(data[p]===original[p]&&data[p+1]===original[p+1]&&data[p+2]===original[p+2]&&data[p+3]===original[p+3])continue;changed++;const x=p/4%1024,y=Math.floor(p/4/1024);if(!regions.some(([rx,ry,w,h])=>x>=rx&&x<rx+w&&y>=ry&&y<ry+h))outside++;else if(!regions.some(([rx,ry,w,h])=>x>=rx+2&&x<rx+w-2&&y>=ry+2&&y<ry+h-2))edge++;}
    rows.push({eye,mouth,changed,outside,edge});
   }
   const sheets=[];
   for(const eye of ['open','eyesHalf','eyesClosed']){
    const tiles=[{mouth:'original',src:originalFrame},...cssFrames.filter(f=>f.eye===eye)];
    const sheet=factory(1680,860),s=sheet.getContext('2d');s.fillStyle='#fff';s.fillRect(0,0,1680,860);s.fillStyle='#222';s.font='22px sans-serif';
    for(const[i,t]of tiles.entries()){const im=new Image();im.src=t.src;await im.decode();const x=i%4*420,y=Math.floor(i/4)*430;s.fillText(t.mouth,x+10,y+25);s.drawImage(im,x,y+30,420,400)}
    sheets.push({eye,data:sheet.toDataURL()});
   }
   return {rows,sheets,width:1024,height:1536};
  },{spec,imageData,renderer:renderReferencePortrait.toString(),cssFrames,originalFrame});
  for(const r of identity.rows){assert.equal(r.outside,0,JSON.stringify(r));assert.equal(r.edge,0,JSON.stringify(r));if(r.eye==='open'&&r.mouth==='closed')assert.equal(r.changed,0);else assert.ok(r.changed>50)}
  for(const s of identity.sheets)writeFileSync(new URL('compare-'+s.eye+'.png',out),Buffer.from(s.data.split(',')[1],'base64'));delete identity.sheets;
 });
 await test('original image provenance and no errors or external requests',async()=>{assert.equal(spec.base.sha256,hash(readFileSync(new URL(spec.base.image,assets))));assert.deepEqual(errors,[]);assert.deepEqual(external,[])});
 await canvasPage.close();
}finally{writeFileSync(new URL('results.json',out),JSON.stringify({browser:kind,version:browser.version(),results,identity,errors,external,scope:'Original-preserving static face review; aesthetic judgement separately recorded, no speech/motion validation.'},null,2));await browser.close()}
console.log(`${kind}: ${results.length} reference comparison checks passed`);
