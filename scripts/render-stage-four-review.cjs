// Render the actual production React diagrams for editorial review, without app auth/data.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const sharp = require('sharp');
const root = process.cwd();
const cache = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (!path.extname(file)) file += fs.existsSync(file+'.tsx') ? '.tsx' : '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const m = new Module(file, module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,m);
  const native = m.require.bind(m);
  m.require = name => name.startsWith('@/') ? load(name.slice(2)) : name.startsWith('.') ? load(path.resolve(path.dirname(file),name)) : native(name);
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,file);
  return m.exports;
}
const {Diagram} = load('components/drawing/Diagram.tsx');
const {MemoryHint} = load('components/drawing/MemoryPractice.tsx');
const {newDocument} = load('lib/drawing/model.ts');
const {memoryVisible} = load('lib/drawing/memory.ts');
const pack=JSON.parse(fs.readFileSync('content/drawing/foundations-v1.json','utf8'));
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const text=(s,y,size=16)=>Array.from({length:Math.ceil([...s].length/24)},(_,i)=>`<text x="12" y="${y+i*23}" font-family="sans-serif" font-size="${size}">${escape([...s].slice(i*24,(i+1)*24).join(''))}</text>`).join('');
const svg=(component,props,key)=>renderToStaticMarkup(React.createElement(component,props),{identifierPrefix:key}).replace('<svg ','<svg width="380" height="380" ');
const dir='docs/drawing/stage-four';fs.mkdirSync(dir,{recursive:true});
(async()=>{
 for(const lesson of pack.lessons.slice(28,34)) for(const [ei,example] of lesson.examples.entries()) {
  let out=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1740"><rect width="100%" height="100%" fill="white"/>`;
  const doc=newDocument(lesson,example,pack.version);
  out+=text(`${lesson.id} · ${example.name} · 관찰 원본`,22)+`<g transform="translate(10 55)">${svg(Diagram,{example,original:true},'ref')}</g>`;
  out+=`<g transform="translate(400 0)">${text('더 쉽게 · 기본 힌트',22)}<g transform="translate(10 55)">${svg(MemoryHint,{doc,easy:true},'easy')}</g>${text(lesson.easier,445)}</g>`;
  out+=`<g transform="translate(800 0)">${text('기억할 특징 선택',22)}${lesson.memoryPractice.features.map((f,i)=>text(f.label,100+i*50)).join('')}${text('가린 단계: 원본·세부 시범 없음',330)}</g>`;
  for(const [si,step] of lesson.steps.entries()) {
   const current={...doc,step:si};
   out+=`<g transform="translate(${si%3*400} ${560+Math.floor(si/3)*570})">${text(`${si+1}/5 · ${step.memoryPhase}`,22)}<g transform="translate(10 45)">`+(memoryVisible(current)?svg(Diagram,{example,original:true},`s${si}`):`<rect width="380" height="370" rx="20" fill="#f6f4fb" stroke="#c8c0d6"/>${text('원본 숨김 · 기억해서 그리는 빈 자리',180)}`)+`</g>${text(step.text,445)}</g>`;
  }
  out+='</svg>';const name=`${lesson.id.toLowerCase()}-${ei+1}`;fs.writeFileSync(`${dir}/${name}.svg`,out);await sharp(Buffer.from(out)).png().toFile(`${dir}/${name}.png`);
 }
 console.log('12 review sheets, 60 memory phases');
})();
