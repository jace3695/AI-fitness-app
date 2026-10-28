import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildComponentSite, outputDirectory } from './build.mjs';
import { localOcrAssetRoutes } from './prepare-ocr-assets.mjs';
import { OCR_ASSET_PREFIX } from './ocr-assets.mjs';

if (process.env.YEONI_COMPONENT_QA !== '1' || process.env.VERCEL) throw new Error('Isolated component server only; deployment refused.');
await buildComponentSite();
// Exact public fixture allowlist. No directory serving, proxy, arbitrary URL or environment endpoint.
const assets = new Map([
  ['/', [resolve(outputDirectory, 'index.html'), 'text/html; charset=utf-8']],
  ['/fixture.js', [resolve(outputDirectory, 'fixture.js'), 'application/javascript']],
  ['/fixture.css', [resolve(outputDirectory, 'fixture.css'), 'text/css']],
  ['/saved-ko.mp3', [resolve('docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3'), 'audio/mpeg']],
  ['/yeoni/cat/preserved-motion-v3.png', [resolve('public/yeoni/cat/preserved-motion-v3.png'), 'image/png']],
  ['/yeoni-cat-sprite-v1.webp', [resolve('public/yeoni-cat-sprite-v1.webp'), 'image/webp']],
  ...await localOcrAssetRoutes(),
]);
const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1:3107');
  const asset = url.pathname.startsWith(`${OCR_ASSET_PREFIX}/`) && url.search ? undefined : assets.get(url.pathname);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!asset || !['GET', 'HEAD'].includes(request.method || '')) { response.writeHead(404); response.end(); return; }
  try {
    const bytes = await readFile(asset[0]);
    response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': bytes.byteLength });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(500); response.end('Fixture asset unavailable'); }
});
server.listen(3107, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
