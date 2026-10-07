import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const root = new URL('../../', import.meta.url), dir = new URL('public/yeoni/human/rig-v4/', root);
const spec = JSON.parse(readFileSync(new URL('manifest.json', dir))), assets = {};
for (const name of ['head.png', 'body.png', 'assembled-preview.webp', ...Object.values(spec.faceParts).flat().map(p => p.image)])
  assets[name] = `data:image/${name.endsWith('.png') ? 'png' : 'webp'};base64,` + readFileSync(new URL(name, dir)).toString('base64');
const result = await build({ loader: { '.mp3': 'base64' }, entryPoints: [new URL('browser.tsx', import.meta.url).pathname], bundle: true,
  write: false, minify: true, keepNames: true, outfile: 'app.js', jsx: 'automatic', external: ['/yeoni-cat-sprite-v1.webp'],
  tsconfig: new URL('tsconfig.json', root).pathname, define: { 'process.env.NODE_ENV': '"production"' } });
const atlas = 'data:image/png;base64,' + readFileSync(new URL('public/yeoni/cat/preserved-motion-v3.png', root)).toString('base64');
const fallback = 'data:image/webp;base64,' + readFileSync(new URL('public/yeoni-cat-sprite-v1.webp', root)).toString('base64');
const js = result.outputFiles.find(f => f.path.endsWith('.js')).text.replaceAll('/yeoni/cat/preserved-motion-v3.png', atlas).replaceAll('</script', '<\\/script');
const css = result.outputFiles.find(f => f.path.endsWith('.css')).text.replaceAll('/yeoni-cat-sprite-v1.webp', fallback);
const out = new URL('docs/yeoni-phase12/', root); mkdirSync(out, { recursive: true });
writeFileSync(new URL('Yeoni_Japanese_LipSync_Preview.html', out), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data:;media-src blob: data:;connect-src 'none'"><title>연이 일본어 입 모양 기술 미리보기</title><style>${css}</style></head><body><div id="root"></div><script>window.CAT_OFFLINE_ASSET=${JSON.stringify(atlas)};window.HUMAN_OFFLINE_ASSETS=${JSON.stringify(assets)};${js}</script></body></html>`);
console.log('docs/yeoni-phase12/Yeoni_Japanese_LipSync_Preview.html');
