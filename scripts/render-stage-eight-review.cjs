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
const {Diagram}=load('components/drawing/Diagram.tsx');
const {IdentityDiagram} = load('components/drawing/IdentityPractice.tsx');
const {newDocument} = load('lib/drawing/model.ts');
const {identityState} = load('lib/drawing/identity.ts');
const pack=JSON.parse(fs.readFileSync('content/drawing/foundations-v1.json','utf8'));
const svg=(doc,mode)=>renderToStaticMarkup(React.createElement(IdentityDiagram,{doc,mode})).replace('<svg ','<svg width="380" height="380" ');
const dir='docs/drawing/stage-eight';fs.mkdirSync(dir,{recursive:true});
(async()=>{
 let count=0;
 for(const lesson of pack.lessons.slice(60,70)) for(const [i,example] of lesson.examples.entries()) for(const option of example.identity.options) {
  const doc=newDocument(lesson,example,pack.version);doc.identity={...identityState(doc),choice:option.id,features:['ears','spacing']};
  const panels=[['Baseline',svg(doc,'baseline')],['Target',svg(doc,'target')],['Easy features',svg(doc,'easy')],...lesson.steps.map((s,j)=>['Action '+(j+1),svg({...doc,step:j},'demo')]),...[['Happy comparison',example.identity.comparison],['Simplified sitting',example.identity.easyReference]].filter(x=>x[1]).map(([label,lines])=>[label,renderToStaticMarkup(React.createElement(Diagram,{example:{...example,lines},original:true})).replace('<svg ','<svg width="380" height="380" ')])];
  let out=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1350"><rect width="100%" height="100%" fill="white"/>`;
  for(const [j,[label,picture]] of panels.entries())out+=`<g transform="translate(${j%3*400} ${Math.floor(j/3)*450})"><text x="8" y="25" font-family="sans-serif" font-size="13">${lesson.id} / ${example.identity.family} / ${option.id} / ${label}</text><g transform="translate(10 50)">${picture}</g></g>`;
  out+='</svg>';const name=`${lesson.id.toLowerCase()}-${i+1}-${option.id}`;fs.writeFileSync(`${dir}/${name}.svg`,out);await sharp(Buffer.from(out)).png().toFile(`${dir}/${name}.png`);count++;
 }
 console.log(count+' identity review sheets; collection actions are compare/copy, not new line demonstrations');
})();
