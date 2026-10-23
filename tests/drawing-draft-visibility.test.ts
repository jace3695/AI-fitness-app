import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app/growth/drawing/page.tsx',import.meta.url),'utf8');
test('default simple editor exposes real local save failure and pending state before optional details',()=>{
 const start=source.indexOf('{simple && <div className="mt-4">');assert.ok(start>=0);
 const block=source.slice(start,source.indexOf('</div>}',start));
 const expression=block.match(/<p role="status"[^>]*>{([\s\S]*)}<\/p>/)?.[1];assert.ok(expression);
 for(const localStatus of ['임시 저장 공간을 쓰지 못했어요. 화면을 닫기 전에 내보내기 또는 저장해 주세요.','이 기기에 임시 보관 중 · 클라우드 저장 전'])assert.equal(vm.runInNewContext(expression,{localStatus,dirty:true}),localStatus);
 assert.match(vm.runInNewContext(expression,{localStatus:'',dirty:true}),/아직 저장 전/);
 assert.match(vm.runInNewContext(expression,{localStatus:'클라우드 저장 확인 완료',dirty:false}),/저장했어요/);
});
