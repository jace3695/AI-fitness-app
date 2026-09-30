// Separate visual-only lab. No app router, authentication, database or .env access.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const output = resolve(root, 'scripts/browser-qa/.generated/yeoni-emotion-poc');
mkdirSync(output, { recursive: true });
await build({ loader: { '.mp3': 'base64' }, entryPoints: [resolve(here, 'browser.tsx')], bundle: true, outfile: resolve(output, 'app.js'),
  jsx: 'automatic', external: ['/yeoni-cat-sprite-v1.webp'], tsconfig: resolve(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' } });
const routes = new Map([
  ['/app.js', [resolve(output, 'app.js'), 'text/javascript']],
  ['/app.css', [resolve(output, 'app.css'), 'text/css']],
  ['/yeoni/cat/poc-speech-atlas-v1.png', [resolve(root, 'public/yeoni/cat/poc-speech-atlas-v1.png'), 'image/png']],
  ['/yeoni-cat-sprite-v1.webp', [resolve(root, 'public/yeoni-cat-sprite-v1.webp'), 'image/webp']],
]);
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><title>연이 표정과 몸짓 개발 미리보기</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
export const server = createServer((req, res) => {
  if (req.headers.host !== '127.0.0.1:8876') { res.writeHead(403); res.end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; media-src blob: data:; frame-ancestors 'none'");
  const path = new URL(req.url, 'http://127.0.0.1:8876').pathname;
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  if (path === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
  const entry = routes.get(path);
  if (!entry) { res.writeHead(404); res.end('Not found'); return; }
  res.setHeader('Content-Type', entry[1]); res.end(readFileSync(entry[0]));
});
await new Promise(resolve => server.listen(8876, '127.0.0.1', resolve));
console.log('Yeoni visual-only lab: http://127.0.0.1:8876');
process.on('SIGINT', () => server.close());
