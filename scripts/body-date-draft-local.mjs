// Reuse the actual calendar bundle/service-disabled fixture, replacing only its assertions.
import { readFileSync, writeFileSync } from 'node:fs';
const source=readFileSync('scripts/weight-goal-tabs-local.mjs','utf8');
const start=source.indexOf("await page.getByText('목표 체중 바꾸기'");
const end=source.indexOf(' if(errors.length');
if(start<0||end<0)throw Error('Calendar fixture boundary changed');
const assertions=`const input=page.locator('#body-weight-input');await input.fill('73.2');await page.getByPlaceholder('체중·인바디 메모').fill('synthetic draft');
 const calendar=page.getByTestId('record-shared-calendar');await calendar.locator('summary').first().click();const targetDay=new Date().getDate()===1?'2':'1';const target=calendar.getByRole('button').filter({has:page.locator('span').getByText(targetDay,{exact:true})});
 let prompts=0;page.on('dialog',async d=>{prompts++;await d.dismiss()});await target.click();await expect(input).toHaveValue('73.2');await expect(page.getByPlaceholder('체중·인바디 메모')).toHaveValue('synthetic draft');if(prompts!==1)throw Error('date change must explicitly confirm abandoning edited body form');passed.push('rejecting date change retains actual manual weight and memo');
 page.removeAllListeners('dialog');page.on('dialog',async d=>{prompts++;await d.accept()});await target.press('Enter');await expect(input).toHaveValue('');await expect(page.getByPlaceholder('체중·인바디 메모')).toHaveValue('');passed.push('accepting keyboard date change loads selected date without saving abandoned draft');
 page.removeAllListeners('dialog');const otherDay=targetDay==='1'?'2':'1';await calendar.getByRole('button').filter({has:page.locator('span').getByText(otherDay,{exact:true})}).click();if(prompts!==2)throw Error('pristine date navigation must not prompt');passed.push('clean form date navigation remains direct');
`;
const script=source.slice(0,start)+assertions+source.slice(end);
writeFileSync('scripts/browser-qa/.generated/body-date-draft-run.mjs',script.replace("'./browser-qa/node_modules/esbuild/lib/main.js'","'../node_modules/esbuild/lib/main.js'").replace("const out='scripts/browser-qa/.generated/weight-goal-tabs'","const out='scripts/browser-qa/.generated/body-date-draft'"));
await import('./browser-qa/.generated/body-date-draft-run.mjs?run='+Date.now());
