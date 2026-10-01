import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
const root = new URL('../../', import.meta.url), out = new URL('scripts/browser-qa/.generated/yeoni-control/', root);
mkdirSync(out, { recursive: true });
await build({ loader: { '.mp3': 'base64' }, entryPoints: [new URL('browser.tsx', import.meta.url).pathname], bundle: true,
  outfile: new URL('app.js', out).pathname, jsx: 'automatic', external: ['/yeoni-cat-sprite-v1.webp'],
  tsconfig: new URL('tsconfig.json', root).pathname, define: { 'process.env.NODE_ENV': '"development"' } });
await build({ entryPoints: [new URL('probe.ts', import.meta.url).pathname], bundle: true, outfile: new URL('probe.js', out).pathname,
  format: 'iife', globalName: 'controlReview', tsconfig: new URL('tsconfig.json', root).pathname });
const routes = new Map([['/app.js', [new URL('app.js', out), 'text/javascript']], ['/app.css', [new URL('app.css', out), 'text/css']], ['/probe.js', [new URL('probe.js', out), 'text/javascript']]]);
const dir = new URL('public/yeoni/human/rig-v4/', root), spec = JSON.parse(readFileSync(new URL('manifest.json', dir)));
for (const name of ['head.png', 'body.png', 'assembled-preview.webp', ...Object.values(spec.faceParts).flat().map(p => p.image)])
  routes.set(new URL(name, 'http://127.0.0.1:8880/yeoni/human/rig-v4/').pathname, [new URL(name, dir), 'image/' + (name.endsWith('.png') ? 'png' : 'webp')]);
for (const name of ['yeoni/cat/preserved-motion-v3.png', 'yeoni-cat-sprite-v1.webp'])
  routes.set('/' + name, [new URL('public/' + name, root), name.endsWith('.png') ? 'image/png' : 'image/webp']);
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><title>연이 두 모습 공통 제어</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
export const server = createServer((req, res) => {
  if (req.headers.host !== '127.0.0.1:8880') { res.writeHead(403); res.end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;media-src blob: data:;connect-src 'none';frame-ancestors 'none'");
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const path = new URL(req.url, 'http://127.0.0.1:8880').pathname;
  if (path === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  const file = routes.get(path); if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file[1]); res.end(readFileSync(file[0]));
});
await new Promise(resolve => server.listen(8880, '127.0.0.1', resolve));
process.on('SIGINT', () => server.close());
