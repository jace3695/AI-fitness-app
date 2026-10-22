import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
const css = postcss.parse(readFileSync(new URL('../app/language/language.css',import.meta.url),'utf8'));
function declarations(selector: string){const out: Record<string,string>={};css.walkRules(r=>{if(r.selector===selector)r.walkDecls(d=>{out[d.prop]=d.value;});});return out;}
test('practice sync notice occupies document flow and retains status/retry information',()=>{
 const s=declarations('.language-app-shell:has(.practice-page) .yeoni-sync-notice');assert.equal(s.position,'static');assert.equal(s.inset,'auto');assert.equal(s['z-index'],'auto');assert.equal(s.transform,'none');
 const source=readFileSync(new URL('../components/LanguageCloudSync.tsx',import.meta.url),'utf8');assert.match(source,/서버 저장 확인/);assert.match(source,/다시 시도/);assert.match(source,/role={/);
});
test('starter is visibly bordered, keyboard focused and touch sized without shrinking text',()=>{
 const s=declarations('.language-app-shell .practice-example');assert.equal(s['min-height'],'44px');assert.equal(s['font-size'],'16px');assert.equal(s.border,'2px solid #534ab7');assert.ok(declarations('.language-app-shell .practice-example:focus-visible').outline);
});
test('compact start preserves two-line input and full visible transfer disclosure',()=>{
 const source=readFileSync(new URL('../app/language/practice/PracticeWorkspace.tsx',import.meta.url),'utf8');assert.ok(source.includes("rows={2}"));assert.match(source,/최근 대화 최대 4쌍/);assert.match(source,/Google 제품 개선/);assert.match(source,/다른 앱 기록·녹음/);assert.match(source,/aria-describedby="practice-data-use"/);assert.equal(declarations('.language-app-shell .practice-start p').margin,'6px 0');
});
