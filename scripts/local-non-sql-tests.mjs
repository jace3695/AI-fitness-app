// Conservative follow-up subset while SQL execution is explicitly withheld.
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const walk = p => readdirSync(p,{withFileTypes:true}).flatMap(d => d.isDirectory() ? walk(p+'/'+d.name) : d.name.endsWith('.test.ts') ? [p+'/'+d.name] : []);
const all=['app','lib','tests'].flatMap(walk).sort();
const excluded=all.filter(p=>/pglite|postgres|\.sql|child_process|execute_sql/i.test(readFileSync(p,'utf8')));
const included=all.filter(p=>!excluded.includes(p));
const out='scripts/browser-qa/.generated/integrated-followup';mkdirSync(out,{recursive:true});
writeFileSync(out+'/scope.json',JSON.stringify({included,excluded,note:'Conservative no-SQL subset; not full-suite success.'},null,2));
const r=spawnSync(process.execPath,['--experimental-strip-types','--test',...included],{encoding:'utf8',maxBuffer:32*1024*1024});
writeFileSync(out+'/non-sql.log',(r.stdout||'')+(r.stderr||''));
console.log(JSON.stringify({exitCode:r.status,includedFiles:included.length,excludedFiles:excluded.length,summary:(r.stdout||'').split('\n').filter(l=>/^ℹ (tests|pass|fail|skipped|cancelled|duration)/.test(l))}));
if(r.error)throw r.error;process.exitCode=r.status??1;
