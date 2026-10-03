// Produce a reviewable offline HTML with the exact component and assets from this branch.
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const result = await build({ loader: { '.mp3': 'base64' }, entryPoints: [resolve(root, 'scripts/yeoni-speech-poc/browser.tsx')], bundle: true,
  write: false, minify: true, outfile: 'app.js', jsx: 'automatic', external: ['/yeoni-cat-sprite-v1.webp'],
  tsconfig: resolve(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' } });
const atlas = 'data:image/png;base64,' + readFileSync(resolve(root, 'public/yeoni/cat/preserved-motion-v3.png')).toString('base64');
const fallback = 'data:image/webp;base64,' + readFileSync(resolve(root, 'public/yeoni-cat-sprite-v1.webp')).toString('base64');
const js = result.outputFiles.find(f => f.path.endsWith('.js')).text.replaceAll('/yeoni/cat/preserved-motion-v3.png', atlas).replaceAll('</script', '<\\/script');
const css = result.outputFiles.find(f => f.path.endsWith('.css')).text.replaceAll('/yeoni-cat-sprite-v1.webp', fallback);
const directory = resolve(root, 'docs/yeoni-phase5'); mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'Yeoni_Lip_Sync_Dev_Preview.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data:;connect-src 'none';media-src blob: data:"><title>연이 입 모양 동기화 개발 미리보기</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);
console.log('docs/yeoni-phase5/Yeoni_Lip_Sync_Dev_Preview.html');
