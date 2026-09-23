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
const {VariationDiagram} = load('components/drawing/VariationPractice.tsx');
const {newDocument} = load('lib/drawing/model.ts');
const {variationTarget} = load('lib/drawing/variation.ts');
const pack=JSON.parse(fs.readFileSync('content/drawing/foundations-v1.json','utf8'));
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const text=(s,y,size=16)=>Array.from({length:Math.ceil([...s].length/26)},(_,i)=>`<text x="12" y="${y+i*23}" font-family="sans-serif" font-size="${size}">${escape([...s].slice(i*26,(i+1)*26).join(''))}</text>`).join('');
const svg=(component,props,key)=>renderToStaticMarkup(React.createElement(component,props),{identifierPrefix:key}).replace('<svg ','<svg width="380" height="380" ');
const dir='docs/drawing/stage-five';fs.mkdirSync(dir,{recursive:true});
(async()=>{
 let count=0;
 for(const lesson of pack.lessons.slice(34,42)) for(const [ei,example] of lesson.examples.entries()) for(const choice of example.variations) {
  const doc={...newDocument(lesson,example,pack.version),variation:{choice:choice.id,changedChecked:false,keptChecked:false,note:''}};
  let out=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800"><rect width="100%" height="100%" fill="white"/>`;
  out+=text(`${lesson.id} · ${example.name} · 基本`.replace('基本','기본'),22)+`<g transform="translate(10 55)">${svg(Diagram,{example,original:true},'ref')}</g>`;
  out+=`<g transform="translate(400 0)">${text('변형 · '+choice.label,22)}<g transform="translate(10 55)">${svg(Diagram,{example:variationTarget(doc),original:true},'target')}</g>${text('바꿀 것: '+choice.changed,445)}</g>`;
  out+=`<g transform="translate(800 0)">${text('더 쉽게 · '+choice.easy,22)}<g transform="translate(10 55)">${svg(VariationDiagram,{doc,mode:'easy'},'easy')}</g>${text('유지: '+choice.kept,445)}</g>`;
  for(const [si,step] of lesson.steps.entries()) {
   out+=`<g transform="translate(${si%3*400} ${580+Math.floor(si/3)*600})">${text(`${si+1}/5 · ${step.action}`,22)}<g transform="translate(10 45)">${svg(VariationDiagram,{doc:{...doc,step:si},mode:'demo'},`s${si}`)}</g>${text(si===2?choice.instruction:step.text,445)}</g>`;
  }
  out+='</svg>';const name=`${lesson.id.toLowerCase()}-${ei+1}-${choice.id}`;fs.writeFileSync(`${dir}/${name}.svg`,out);await sharp(Buffer.from(out)).png().toFile(`${dir}/${name}.png`);count++;
 }
 console.log(`${count} review sheets, ${count*5} action panels`);
})();
