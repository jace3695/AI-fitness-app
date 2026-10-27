const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=process.env.MOTION_CHECK_OUTPUT?path.resolve(process.env.MOTION_CHECK_OUTPUT):path.resolve(__dirname,'../docs/exercise-motion/batch19-static-evidence');
const {html,chromium}=require('./motion-accessibility-harness.cjs')(path.resolve(process.argv[2]),path.join(out,'generated'),{entry:'app/components/PreparationPoseDemo.tsx'});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:320,height:740},reducedMotion:'reduce'});
 await context.route('**/*',r=>r.abort());
 const page=await context.newPage(),errors=[],rows=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.setContent(html);
  for(const id of ['ab-slider-ready-position']){
   await page.evaluate(id=>window.show(id),id);
   const svg=page.getByRole('img');await svg.waitFor();
   assert.ok(await svg.getAttribute('aria-labelledby'));
   assert.equal(await page.locator('button,input,svg animate,svg animateTransform').count(),0);
   const before=await svg.innerHTML();
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await svg.innerHTML(),before);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(out,id+'-320.png'),fullPage:true});
   await page.evaluate(()=>document.documentElement.style.fontSize='200%');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(out,id+'-320-large-text.png'),fullPage:true});
   await page.evaluate(()=>document.documentElement.style.fontSize='');
   rows.push({id,staticAcrossMotionPreference:true,noPlaybackControls:true,accessibleSvg:true,noOverflow320:true,noOverflow200PercentText:true});
  }
  await page.evaluate(()=>window.show('unsupported'));
  await page.waitForFunction(()=>document.querySelector('#root').children.length===0);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'after.json'),JSON.stringify({scope:'independent static asset; not app routing or a completed moving demonstration',entry:'PreparationPoseDemo',strictTypes:true,rows,unsupportedReturnsNull:true,pageErrors:errors},null,2));
  console.log('PASS 1 independent static preparation asset (not app routing): strict types, semantics, 320px and 200% text');
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
