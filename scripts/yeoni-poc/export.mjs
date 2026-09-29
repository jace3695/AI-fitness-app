// Produce a reviewable offline HTML with the exact component and assets from this branch.
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const result = await build({ entryPoints: [resolve(root, 'scripts/yeoni-poc/browser.tsx')], bundle: true,
  write: false, minify: true, outfile: 'app.js', jsx: 'automatic', external: ['/yeoni-cat-sprite-v1.webp'],
  tsconfig: resolve(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' } });
const atlas = 'data:image/png;base64,' + readFileSync(resolve(root, 'public/yeoni/cat/poc-atlas-v1.png')).toString('base64');
const fallback = 'data:image/webp;base64,' + readFileSync(resolve(root, 'public/yeoni-cat-sprite-v1.webp')).toString('base64');
const js = result.outputFiles.find(f => f.path.endsWith('.js')).text.replaceAll('/yeoni/cat/poc-atlas-v1.png', atlas).replaceAll('</script', '<\\/script');
const css = result.outputFiles.find(f => f.path.endsWith('.css')).text.replaceAll('/yeoni-cat-sprite-v1.webp', fallback);
const directory = resolve(root, 'docs/yeoni-phase4'); mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'Yeoni_Cat_Animation_Preview.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data:;connect-src 'none'"><title>연이 고양이 움직임 미리보기</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
console.log('docs/yeoni-phase4/Yeoni_Cat_Animation_Preview.html');
