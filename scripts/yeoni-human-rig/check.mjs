import {chromium,webkit} from 'playwright';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {renderHumanRig} from './render.mjs';
import {renderReferencePortrait} from '../yeoni-human-assets/reference-renderer.mjs';
const root=new URL('../../',import.meta.url),dir=new URL('public/yeoni/human/rig-v4/',root),kind=process.env.YEONI_BROWSER||'chromium';
const out=new URL(`.e2e/yeoni-human-rig-v4/${kind}/`,root);mkdirSync(out,{recursive:true});
const spec=JSON.parse(readFileSync(new URL('manifest.json',dir))),reference=JSON.parse(readFileSync(new URL('../reference-v3/manifest.json',dir)));
const pageHtml=readFileSync(new URL('docs/yeoni-phase7/rig-v4/Human_A_Rig_Preview.html',root),'utf8');
const assets={};for(const f of [spec.source.image,...Object.values(spec.layers).map(p=>p.image),...Object.values(spec.faceParts).flat().map(p=>p.image)])assets[f]=`data:image/${f.endsWith('.png')?'png':'webp'};base64,`+readFileSync(new URL(f,dir)).toString('base64');
for(const p of [spec.source,...Object.values(spec.layers),...Object.values(spec.faceParts).flat()])assert.equal(createHash('sha256').update(readFileSync(new URL(p.image,dir))).digest('hex'),p.sha256);
const browser=await({chromium,webkit})[kind].launch({headless:true});
const errors=[],external=[],results=[];let pixelResults;
const observe=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url())});};
const test=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS '+name)};
const eyes=['open','eyesHalf','eyesClosed'],mouths=['closed','a','i','u','e','o','small'];
try{
 const probe=await browser.newPage();observe(probe);
 await test('head/body reassembly preserves opaque original RGB and has an intact neck seam',async()=>{
  pixelResults=await probe.evaluate(async({assets,spec,reference,rigSource,refSource,eyes,mouths})=>{
   const images={};for(const[f,src]of Object.entries(assets)){const im=new Image();im.src=src;await im.decode();images[f]=im}
   const make=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c},a=make(1024,1536),b=make(1024,1536),ac=a.getContext('2d'),bc=b.getContext('2d');
   const rig=new Function('return '+rigSource)(),ref=new Function('return '+refSource)();
   const sourceImages=Object.fromEntries(Object.entries(images).map(([k,v])=>[k.replace('../reference-v3/',''),v]));
   rig(ac,images,spec,'open','closed',make);const neutral=ac.getImageData(0,0,1024,1536).data;
   ref(bc,images[spec.source.image],sourceImages,reference,'open','closed',make);const original=bc.getImageData(0,0,1024,1536).data;
   let opaque=0,opaqueChanged=0,transparent=0,seamChanged=0;
   for(let i=0;i<neutral.length;i+=4){if(neutral[i+3]===255){opaque++;if(neutral[i]!==original[i]||neutral[i+1]!==original[i+1]||neutral[i+2]!==original[i+2])opaqueChanged++;}if(neutral[i+3]===0)transparent++;}
   for(let y=732;y<748;y++)for(let x=425;x<615;x++){const i=(y*1024+x)*4;if(neutral[i+3]!==255||neutral[i]!==original[i]||neutral[i+1]!==original[i+1]||neutral[i+2]!==original[i+2])seamChanged++;}
   const rows=[];for(const eye of eyes)for(const mouth of mouths){
    rig(ac,images,spec,eye,mouth,make);ref(bc,images[spec.source.image],sourceImages,reference,eye,mouth,make);
    const x=ac.getImageData(0,0,1024,1536).data,y=bc.getImageData(0,0,1024,1536).data;
    const regions=[...(spec.faceParts[eye]||[]),...(spec.faceParts[mouth]||[])].map(p=>p.rect);
    let opaqueDifference=0,outsidePatchDifference=0;
    for(let i=0;i<x.length;i+=4){const px=i/4%1024,py=Math.floor(i/4/1024);if(x[i+3]===255&&(x[i]!==y[i]||x[i+1]!==y[i+1]||x[i+2]!==y[i+2]))opaqueDifference++;
     if(!regions.some(([rx,ry,rw,rh])=>px>=rx&&px<rx+rw&&py>=ry&&py<ry+rh)&&(x[i]!==neutral[i]||x[i+1]!==neutral[i+1]||x[i+2]!==neutral[i+2]||x[i+3]!==neutral[i+3]))outsidePatchDifference++;
    }rows.push({eye,mouth,opaqueDifference,outsidePatchDifference});
   }
   return{opaque,opaqueChanged,transparent,seamChanged,rows};
  },{assets,spec,reference,rigSource:renderHumanRig.toString(),refSource:renderReferencePortrait.toString(),eyes,mouths});
  assert.ok(pixelResults.opaque>1000000);assert.ok(pixelResults.transparent>400000);assert.equal(pixelResults.opaqueChanged,0);assert.equal(pixelResults.seamChanged,0);
 });
 await test('all 21 face states match approved opaque artwork and preserve pixels outside face patches',async()=>{for(const r of pixelResults.rows){assert.equal(r.opaqueDifference,0,JSON.stringify(r));assert.equal(r.outsidePatchDifference,0,JSON.stringify(r))}});
 await probe.close();
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:960,height:900},colorScheme:'light'}),page=await context.newPage();observe(page);
 await page.setContent(pageHtml);const target=page.locator('.rig-stage.revised'),shot=async name=>page.screenshot({path:new URL(name+'.png',out).pathname,fullPage:true});
 await test('script-free preview renders the original and transparent asset at the same scale',async()=>{
  assert.equal(await page.locator('script,canvas,audio,video').count(),0);
  const a=await page.locator('.rig-stage.original').boundingBox(),b=await target.boundingBox();assert.equal(a.width,b.width);assert.equal(a.height,b.height);await shot('full');
 });
 await test('every eye and mouth selector works without JavaScript and produces visual contact sheets',async()=>{
  await page.locator('#rig-face').check();
  const original='data:image/png;base64,'+(await page.locator('.rig-stage.original').screenshot()).toString('base64');
  for(const eye of eyes){await page.locator('#rig-eye-'+eye).check();const frames=[{label:'원본 A안',src:original}],unique=new Set();
   for(const mouth of mouths){await page.locator('#rig-mouth-'+mouth).check();for(const p of await page.locator('.rig-patch').all()){const cls=await p.getAttribute('class'),visible=await p.isVisible();assert.equal(visible,cls.split(' ').includes('patch-'+eye)||cls.split(' ').includes('patch-'+mouth));}
    const src=(await target.screenshot()).toString('base64');unique.add(src);frames.push({label:mouth,src:'data:image/png;base64,'+src});}
   assert.equal(unique.size,7);await contact(frames,'faces-'+eye);
  }
 });
 await test('full view face zoom overlay and dark backdrop remain inspectable',async()=>{
  await page.locator('#rig-eye-open').check();await page.locator('#rig-mouth-closed').check();await shot('face');
  await page.locator('#rig-overlay').check();await shot('overlay');await page.locator('#rig-overlay').uncheck();
  await page.locator('#rig-face').uncheck();const light=await target.screenshot();await page.locator('#rig-dark').check();assert.notDeepEqual(await target.screenshot(),light);await shot('dark');
 });
 await test('320/390px layouts and a script-blocked iframe retain usable selectors',async()=>{
  for(const width of [320,390]){await page.setViewportSize({width,height:900});const box=await page.locator('#yeoni-human-rig-v4').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);await shot('mobile-'+width);}
  const host=await context.newPage();observe(host);await host.setContent('<iframe sandbox="allow-same-origin" style="border:0;width:100%;height:1400px"></iframe>');await host.locator('iframe').evaluate((el,html)=>{el.srcdoc=html},pageHtml);
  const inner=host.frameLocator('iframe');await inner.locator('#rig-mouth-a').check();await inner.locator('.patch-a').waitFor({state:'visible'});await host.screenshot({path:new URL('sandbox.png',out).pathname,fullPage:true});await host.close();
 });
 await test('fresh loading resets controls with no runtime errors or external requests',async()=>{
  await page.setContent(pageHtml);assert.equal(await page.locator('#rig-eye-open').isChecked(),true);assert.equal(await page.locator('#rig-mouth-closed').isChecked(),true);assert.equal(await page.locator('#rig-dark').isChecked(),false);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 });
 await context.close();
}catch(e){results.push({passed:false,error:String(e)});console.error(e);process.exitCode=1;}
finally{writeFileSync(new URL('results.json',out),JSON.stringify({browser:kind,version:browser.version(),results,pixelResults,errors,external,scope:'Static prepared assets and script-free viewer only. Background/alpha and semitransparent outer edge RGB deliberately changed. Human motion, independent rigid head rotation, and speech are not validated.'},null,2));await browser.close();}
async function contact(frames,name){
 const p=await browser.newPage({viewport:{width:1440,height:770}});observe(p);
 await p.setContent('<style>body{margin:0;background:white;font:16px system-ui}.grid{display:grid;grid-template-columns:repeat(4,360px)}figure{margin:0}img{display:block;width:360px;height:auto}figcaption{text-align:center;height:30px}</style><div class="grid">'+frames.map(f=>`<figure><figcaption>${f.label}</figcaption><img src="${f.src}"></figure>`).join('')+'</div>');
 await p.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));await p.screenshot({path:new URL(name+'.png',out).pathname,fullPage:true});await p.close();
}
