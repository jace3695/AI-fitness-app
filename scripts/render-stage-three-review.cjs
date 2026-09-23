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
const {CopyGuide} = load('components/drawing/CopyPractice.tsx');
const pack=JSON.parse(fs.readFileSync('content/drawing/foundations-v1.json','utf8'));
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const text=(s,y,size=16)=>Array.from({length:Math.ceil([...s].length/24)},(_,i)=>`<text x="12" y="${y+i*23}" font-family="sans-serif" font-size="${size}">${escape([...s].slice(i*24,(i+1)*24).join(''))}</text>`).join('');
const svg=(component,props,key)=>renderToStaticMarkup(React.createElement(component,props),{identifierPrefix:key}).replace('<svg ','<svg width="380" height="380" ');
const dir='docs/drawing/stage-three';fs.mkdirSync(dir,{recursive:true});
(async()=>{
 for(const lesson of pack.lessons.slice(16,28)) {
  for(const [ei,example] of lesson.examples.entries()) {
   const height=530+Math.ceil(lesson.steps.length/3)*540;
   let out=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="100%" height="100%" fill="white"/>`;
   for(const [i,label] of ['원본','시작 연습장','더 쉽게'].entries())out+=`<g transform="translate(${i*400} 0)">`+text(`${lesson.id} · ${example.name} · ${label}`,22)+`<g transform="translate(10 55)">`+(i===0?svg(Diagram,{example,original:true},`${lesson.id}-${ei}-ref`):svg(CopyGuide,{example,lesson,step:0,help:lesson.help,easy:i===2},`${lesson.id}-${ei}-g${i}`))+'</g></g>';
   for(const [si,step] of lesson.steps.entries())out+=`<g transform="translate(${si%3*400} ${530+Math.floor(si/3)*540})">`+text(`${si+1}/${lesson.steps.length} · 선생님 시범`,22)+`<g transform="translate(10 35)">`+svg(Diagram,{example,lesson,step:si,help:3},`${lesson.id}-${ei}-s${si}`)+'</g>'+text(step.text,428)+'</g>';
   out+='</svg>';const name=`${lesson.id.toLowerCase()}-${ei+1}`;fs.writeFileSync(`${dir}/${name}.svg`,out);await sharp(Buffer.from(out)).png().toFile(`${dir}/${name}.png`);
  }
 }
 console.log(JSON.stringify({lessons:12,examples:24,panels:pack.lessons.slice(16,28).reduce((n,l)=>n+l.steps.length*l.examples.length,0)}));
})();
