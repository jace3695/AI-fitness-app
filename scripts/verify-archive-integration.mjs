import { spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out='scripts/browser-qa/.generated/archive-integration';
mkdirSync(out,{recursive:true});
const buildEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|SystemRoot|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(k)));
Object.assign(buildEnv,{NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4318',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_local_only',NODE_OPTIONS:'--require '+JSON.stringify(resolve('scripts/next-local-network-guard.cjs'))});
const jobs=[
 ['unit',['scripts/test.mjs']],
 ['ai-budget',['--experimental-strip-types','--test','modules/ai-budget-control/budget.test.mjs','modules/ai-budget-control/persistence.test.mjs']],
 ['types',['node_modules/typescript/bin/tsc','--noEmit']],
 ['lint',['node_modules/eslint/bin/eslint.js','--max-warnings=0','components/ConfirmedConversationArchive.tsx','lib/confirmed-conversation-archive.ts','app/api/confirmed-conversation-archive/route.ts','app/language/practice/PracticeWorkspace.tsx','app/assistant/AssistantClient.tsx','app/data/appRecordReset.ts','tests/confirmed-conversation-archive.test.ts']],
 ['archive-browser',['scripts/confirmed-archive-local-browser.mjs']],
 ['body-history-browser',['scripts/body-analysis-history-local-browser.mjs']],
 ['body-chat-browser',['scripts/local-body-chat-browser.mjs']],
 ['practice-browser',['scripts/japanese-practice-local-browser.mjs']],
 ['legacy-browser',['scripts/japanese-conversation-local-browser.mjs']],
 ['next-browser',['scripts/next-archive-integration.mjs']],
 ['production-build',['node_modules/next/dist/bin/next','build']],
];
const results=[];
for(const [name,args] of jobs){
 const fd=openSync(`${out}/${name}.log`,'w');
 const started=new Date().toISOString();
 const run=spawnSync(process.execPath,args,{env:name==='production-build'?buildEnv:process.env,stdio:['ignore',fd,fd],windowsHide:true});
 closeSync(fd);
 const result={name,started,finished:new Date().toISOString(),exitCode:run.status,error:run.error?.message??null};
 results.push(result);console.log(JSON.stringify(result));
 writeFileSync(`${out}/verification.json`,JSON.stringify(results,null,2));
 if(run.status!==0){process.exitCode=1;break;}
}
