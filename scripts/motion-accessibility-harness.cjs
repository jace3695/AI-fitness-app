const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

module.exports = function buildHarness(dependencies, out, options = {}) {
  const root = path.resolve(__dirname, '..');
  const fromDeps = createRequire(path.join(path.resolve(dependencies), '_motion_check.cjs'));
  const ts = fromDeps('typescript');
  const modules = [], ids = new Map();
  function pack(file) {
    if (ids.has(file)) return ids.get(file);
    const id = modules.length; ids.set(file, id); modules.push('');
    let source = fs.readFileSync(file, 'utf8');
    if (/\.tsx?$/.test(file)) source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
    source = source.replace(/require\(['"]([^'"]+)['"]\)/g, (_, name) => {
      const candidate = path.resolve(path.dirname(file), name);
      const target = name.startsWith('.') ? [candidate, candidate + '.ts', candidate + '.tsx', candidate + '.js'].find(p => fs.existsSync(p) && fs.statSync(p).isFile()) : fromDeps.resolve(name);
      if (!target) throw Error(`Unresolved: ${name}`);
      return `require(${pack(target)})`;
    });
    modules[id] = `function(module,exports,require){${source}\n}`; return id;
  }
  const react = pack(fromDeps.resolve('react')), dom = pack(fromDeps.resolve('react-dom/client'));
  const entry = options.entry || 'app/components/ExerciseMotionDemo.tsx';
  const demo = pack(path.join(root, entry));
  const wall = pack(path.join(root, 'app/components/WallPushupDemo.tsx'));
  fs.mkdirSync(out, { recursive: true });
  // Generate actual Tailwind utility CSS; no blanket button/input sizes that mask defects.
  const input = path.join(out, 'input.css'), css = path.join(out, 'utilities.css');
  fs.writeFileSync(input, '@tailwind base;\n@tailwind components;\n@tailwind utilities;');
  const config = path.join(out, 'tailwind.config.cjs');
  fs.writeFileSync(config, `module.exports=${JSON.stringify({ content: [path.join(root, 'app/components/*.tsx').replaceAll('\\', '/')], theme: {}, plugins: [] })};`);
  execFileSync(process.execPath, [fromDeps.resolve('tailwindcss/lib/cli.js'), '-i', input, '-o', css, '-c', config], { cwd: root, stdio: 'pipe' });
  const bundle = `const process={env:{NODE_ENV:'production'}};const modules=[${modules.join(',')}],cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}const React=require(${react}),Demo=require(${demo}).default,Wall=require(${wall}).default;const root=require(${dom}).createRoot(document.getElementById('root'));window.show=id=>root.render(id==='wall-pushup'?React.createElement(Wall,{key:id}):React.createElement(Demo,{exerciseId:id}));`;
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Motion accessibility fixture</title><style>${fs.readFileSync(css, 'utf8')}body{padding:12px}#root{max-width:420px;margin:auto}</style><main id="root"></main><script>${bundle.replaceAll('</script', '<\\/script')}</script></html>`;
  const program = ts.createProgram([entry, 'app/components/ExerciseMotionDemo.tsx', 'app/components/WallPushupDemo.tsx'].map(f => path.join(root, f)), { noEmit: true, allowImportingTsExtensions: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, baseUrl: root, paths: { react: [path.join(dependencies, '@types/react/index.d.ts')], 'react/*': [path.join(dependencies, '@types/react/*')] }, typeRoots: [path.join(dependencies, '@types')], types: ['react'] });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => '\n' }));
  return { html, chromium: fromDeps('@playwright/test').chromium };
};
