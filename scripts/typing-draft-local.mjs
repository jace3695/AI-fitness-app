// Actual sentence-typing component, synthetic growth hook, fresh browser profile.
// No auth, real storage, microphone, external network or save-button actions.
import {build} from './browser-qa/node_modules/esbuild/lib/main.js';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve('scripts/browser-qa/.generated/typing-draft');mkdirSync(out,{recursive:true});
const compiled=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Page from './app/growth/typing/page';createRoot(document.getElementById('root')).render(<Page/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'isolated',setup(b){
 b.onResolve({filter:/useGrowthData$/},()=>({path:'growth',namespace:'fixture'}));
 b.onResolve({filter:/AppCompanion$|AppIdentity$|^next\/link$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='growth'?`export function useGrowthData(){return{routines:[{id:'synthetic-typing',category:'typing',target_minutes:5}],sessions:[],notice:'',loading:false,setNotice(){},saveSession(){window.__saveCalls++;throw Error('save forbidden')}}}`:a.path==='next/link'?`import React from 'react';export default({children,...p})=>React.createElement('a',p,children);`:'export default()=>null;',resolveDir:process.cwd()}));
}}]});
const js=compiled.outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/app.js'?js:'<!doctype html><html><meta charset="utf-8"><div id="root"></div><script>window.__saveCalls=0</script><script src="/app.js"></script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
let browser,context,page;const errors=[],passed=[];let failure;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
 const text=page.locator('textarea'),buttons=page.locator('button'),next=buttons.nth(0),restart=buttons.nth(1);await expect(text).toBeVisible();
 const heading=page.locator('section h1'),originalHeading=await heading.textContent(),passage=page.locator('section > p').first(),originalPassage=await passage.textContent();
 const draft='synthetic typing draft';await text.fill(draft);
 for(const [label,button] of [['different sentence',next],['restart',restart]]){
  let dialogs=0;const dismiss=async d=>{dialogs++;await d.dismiss();};page.on('dialog',dismiss);await button.click();page.off('dialog',dismiss);
  await expect(text).toHaveValue(draft);if(dialogs!==1)throw Error(label+' did not ask exactly once');await expect(passage).toHaveText(originalPassage);await expect(heading).toHaveText(originalHeading);passed.push(label+' cancel preserves draft and selected passage');
 }
 let dialogs=0;const accept=async d=>{dialogs++;await d.accept();};page.on('dialog',accept);await restart.click();page.off('dialog',accept);await expect(text).toHaveValue('');if(dialogs!==1)throw Error('restart acceptance');passed.push('explicit restart acceptance clears draft');
 dialogs=0;page.on('dialog',accept);await next.click();page.off('dialog',accept);await expect(text).toHaveValue('');await expect(passage).not.toHaveText(originalPassage);if(dialogs!==0)throw Error('empty draft must not prompt');passed.push('empty draft changes sentence without unnecessary dialog');
 await text.fill(draft);dialogs=0;page.on('dialog',accept);await next.focus();await page.keyboard.press('Enter');page.off('dialog',accept);await expect(text).toHaveValue('');if(dialogs!==1)throw Error('keyboard sentence switch acceptance');passed.push('keyboard sentence switch requires explicit acceptance');
 if(await page.evaluate(()=>window.__saveCalls)!==0)throw Error('unexpected save');if(errors.length)throw Error(errors.join('\n'));passed.push('no save calls or console errors');
}catch(e){failure=e;}
finally{writeFileSync(resolve(out,'result.json'),JSON.stringify({passed,errors,failure:failure?.message||null,syntheticOnly:true,realStorage:false},null,2));await context?.close();await browser?.close();await new Promise(r=>server.close(r));}
if(failure)throw failure;console.log(JSON.stringify({passed:passed.length,errors:errors.length}));
