import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const budget=readFileSync(new URL('../app/budget/page.tsx',import.meta.url),'utf8');
const body=readFileSync(new URL('../app/components/BodyRecordCard.tsx',import.meta.url),'utf8');
function handler(source:string, marker:string) {
 const tree=ts.createSourceFile('screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let expression='';
 const visit=(node:ts.Node)=>{
  if(ts.isJsxOpeningElement(node)&&node.getText(tree).includes(marker)) {
   const attr=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='onClick') as ts.JsxAttribute|undefined;
   if(attr?.initializer&&ts.isJsxExpression(attr.initializer)) expression=attr.initializer.expression!.getText(tree);
  }
  ts.forEachChild(node,visit);
 };visit(tree);assert.ok(expression);return expression;
}

test('budget examples only fill empty input; draft, loading and dictation remain untouched',()=>{
 const click=handler(budget,'key={example}');
 for(const props of [{input:'',aiLoading:false,listening:false},{input:'my draft',aiLoading:false,listening:false},{input:'',aiLoading:true,listening:false},{input:'',aiLoading:false,listening:true}]) {
  const changes:string[]=[];
  vm.runInNewContext('('+click+')()', {...props,example:'synthetic example',setInput:(v:string)=>changes.push(v),setFeedback:()=>{}});
  assert.deepEqual(changes,props.input||props.aiLoading||props.listening?[]:['synthetic example']);
 }
});
test('budget keeps explicit review/save actions and native optional examples',()=>{
 assert.match(budget,/<details[^>]*>\s*<summary[^>]*>어떻게 적나요\?/);
 assert.match(budget,/onClick=\{handleAddTransaction\}/);assert.match(budget,/onClick=\{handleConfirmSave\}/);
 assert.match(budget,/AI가 제안한 결과는 자동 저장되지 않아요/);
 assert.match(budget,/disabled=\{isSavingRecords \|\| hasPendingSave\}/);
 assert.match(budget,/minHeight: 44/);assert.match(budget,/flexWrap: 'wrap'/);
});
test('body entry shortcut focuses manual weight or imported date without changing any draft',()=>{
 const click=handler(body,'document.getElementById');
 for(const draft of [null,{date:'2026-10-20',patch:{weight:'80'},memo:'keep'}]) {
  const before=JSON.stringify(draft),focused:string[]=[];
  vm.runInNewContext('('+click+')()', {draft,document:{getElementById:(id:string)=>({focus:()=>focused.push(id)})}});
  assert.deepEqual(focused,[draft?'body-measurement-date':'body-weight-input']);assert.equal(JSON.stringify(draft),before);
 }
});
test('body keeps photo limits and confirmation visible, existing save/date guards and editable values',()=>{
 assert.match(body,/id="body-weight-input"[\s\S]*?value=\{visibleForm.weight/);
 assert.match(body,/id="body-measurement-date"[\s\S]*?value=\{draft.date\}/);
 assert.match(body,/오아 앱의 긴 건강보고서 사진만 읽을 수 있어요/);
 assert.match(body,/사진은 기기 안에서 읽어요/);
 assert.match(body,/onClick=\{draft \? saveImport : save\}/);
 assert.match(body,/Boolean\(draft && !validMeasurementDate/);
 const photo=body.slice(body.indexOf('사진으로 입력'),body.indexOf('{draft && <section aria-label="가져오기 확인"'));
 assert.ok(photo.includes('checked={confirmedPro}'));assert.ok(photo.includes('다른 기기·양식은 선택하지 마세요'));
 assert.ok(photo.indexOf('checked={confirmedPro}')<photo.indexOf('<details'));
 assert.match(body,/onChange=\{importOaReport\}/);
});

test('voice fills once without parsing; edits, navigation and duplicate callbacks cannot replace draft',async()=>{
 const start=budget.indexOf('  const handleVoiceInput =');const end=budget.indexOf('\n  const ',start+10);
 const code=ts.transpileModule(budget.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const stale of [false,true]){
  let callback: (s:string)=>void=()=>{};let text='';const epoch={current:0};let writes=0;
  const run=vm.runInNewContext(code+'\nhandleVoiceInput',{
   input:'',aiLoading:false,listening:false,savingRecordsRef:{current:false},pendingSaveRef:{current:null},voiceInputEpoch:epoch,
   Capacitor:{isNativePlatform:()=>false},runWebSpeechRecognition:(f:(s:string)=>void)=>{callback=f;},
   setInput:(f:(s:string)=>string)=>{text=f(text);writes++;},setFeedback:()=>{}
  });
  await run();if(stale){epoch.current++;text='preserved edit';}callback('spoken text');callback('duplicate');
  assert.equal(text,stale?'preserved edit':'spoken text');assert.equal(writes,stale?0:1);
 }
 assert.match(budget,/useEffect\(\(\) => \(\) => \{ voiceInputEpoch.current \+= 1 \}, \[user\?\.id, tab, input, showConfirm, aiLoading\]\)/);
});
