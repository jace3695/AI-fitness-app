import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
const git = (...args) => execFileSync('git',args,{encoding:'utf8'}).trim();
const hash = data => createHash('sha256').update(data).digest('hex');
const additions = [
 'app/api/fitness/body-analysis-history/', 'app/components/BodyAnalysisHistory.tsx',
 'lib/body-analysis-history.ts', 'tests/body-analysis-history.test.ts',
 'components/yeoni/CommonCharacter', 'components/yeoni/common-character-host.module.css',
 'lib/yeoni/common-host-policy', 'lib/yeoni/speech-participant',
 'docs/body-analysis-history/', 'docs/yeoni-common/', 'docs/local-integration-followup.md',
 'docs/final-candidate-verification.md', 'scripts/yeoni-common/',
 'scripts/body-analysis-history-local-browser.mjs', 'scripts/first-use-advice-local-browser.mjs',
 'scripts/workout-speech-focus-browser.mjs', 'scripts/local-non-sql-tests.mjs', 'scripts/freeze-local-candidate.mjs',
];
const tracked = git('diff','--name-only','-z').split('\0').filter(Boolean);
const untracked = git('ls-files','--others','--exclude-standard','-z').split('\0').filter(p=>p&&additions.some(prefix=>p.startsWith(prefix)));
const files = [...new Set([...tracked,...untracked])].sort().map(path=>{
 const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:hash(bytes)};
});
const candidateSha256=hash(JSON.stringify(files));
const out='scripts/browser-qa/.generated/final-candidate/'+candidateSha256;
for(const f of files){const target=out+'/files/'+f.path;mkdirSync(dirname(target),{recursive:true});copyFileSync(f.path,target);}
const logs=['unit','ai-budget'].map(name=>{const path='scripts/browser-qa/.generated/final-candidate/'+name+'.log';return {path,sha256:hash(readFileSync(path))};});
const manifest={baselineCommit:git('rev-parse','HEAD'),state:'local-uncommitted-not-published',candidateSha256,files,logs,validation:{unit:910,aiBudget:26,total:936,failed:0,skipped:0,historyUi:9,commonCharacterUi:15,workoutSpeechUi:3,types:'passed',lint:'passed',build:'passed',actualDbAuthRls:'not-run',physicalDevice:'not-run'},snapshotDirectory:out,manifestSelfExcluded:true};
writeFileSync('docs/final-candidate-manifest.json',JSON.stringify(manifest,null,2)+'\n');
writeFileSync(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({candidateSha256,files:files.length,snapshotDirectory:out}));
