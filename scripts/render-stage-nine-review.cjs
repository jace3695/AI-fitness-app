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

const {OriginalDiagram}=load('components/drawing/OriginalPractice.tsx');
const dir='docs/drawing/stage-nine';fs.mkdirSync(dir,{recursive:true});
const picture=(props)=>renderToStaticMarkup(React.createElement(OriginalDiagram,props)).replace('<svg ','<svg width="300" height="300" ');
async function sheet(name,items){let out='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="'+Math.ceil(items.length/4)*340+'"><rect width="100%" height="100%" fill="white"/>';items.forEach(([label,props],i)=>{out+='<g transform="translate('+(i%4*300)+' '+Math.floor(i/4)*340+')"><text x="8" y="24" font-size="14" font-family="sans-serif">'+label+'</text><g transform="translate(0 30)">'+picture(props)+'</g></g>';});out+='</svg>';fs.writeFileSync(dir+'/'+name+'.svg',out);await sharp(Buffer.from(out)).png().toFile(dir+'/'+name+'.png');}
(async()=>{
for(const motif of ['sprout','bird'])for(const body of ['round','tall'])for(const mark of ['single','split']){
const design={motif,body,mark,palette:0},items=[['base',{design}],['happy',{design,expression:'happy'}],['surprised',{design,expression:'surprised'}],['wave',{design,pose:'wave'}],['sit',{design,pose:'sit'}],['walk',{design,pose:'walk'}],['easy',{design,easy:true}],['color',{design,colored:true}]];
await sheet('variants-'+motif+'-'+body+'-'+mark,items);
}
for(let n=71;n<=80;n++)for(const motif of ['sprout','bird']){const design={motif,body:'round',mark:'single',palette:0},props={design,expression:n===77?'happy':n===78?'surprised':'neutral',pose:n===79?'sit':'stand',colored:n===76},items=[['target',props],...Array.from({length:5},(_,i)=>['action '+i,{...props,step:n===76?4:i,colorStep:i}]),['easy',{...props,easy:true}],['palette 2',{...props,design:{...design,palette:1},colored:true}]];await sheet('d'+n+'-'+motif,items);}
console.log('20 lesson sheets plus 8 variant sheets rendered from actual React diagrams.');
})();
