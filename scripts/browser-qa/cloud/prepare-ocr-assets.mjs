import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OCR_ASSETS, OCR_ASSET_ID, OCR_ASSET_PREFIX } from './ocr-assets.mjs';

export const assetDirectory = resolve('.e2e/component-browser/ocr-assets', OCR_ASSET_ID);
export function verifyOcrAsset(bytes, asset) {
  if (bytes.byteLength !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Pinned OCR asset mismatch: ${asset.name}`);
  return bytes;
}
async function readOptional(path) {
  try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
async function downloadModel(asset) {
  // Setup only. Never called by the fixture server or browser; no alternate URL/model fallback.
  const response = await fetch(asset.url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error('Pinned OCR model download failed');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > asset.bytes) throw new Error('Pinned OCR model size exceeded');
    chunks.push(chunk);
  }
  return verifyOcrAsset(Buffer.concat(chunks), asset);
}
export async function prepareOcrAssets() {
  if (process.env.YEONI_COMPONENT_QA !== '1' || process.env.VERCEL) throw new Error('Isolated OCR asset preparation only');
  const versions = await Promise.all(['tesseract.js', 'tesseract.js-core'].map(async name => JSON.parse(await readFile(resolve('node_modules', name, 'package.json'), 'utf8')).version));
  if (versions[0] !== '6.0.1' || versions[1] !== '6.1.2') throw new Error('Pinned OCR package version mismatch');
  await mkdir(assetDirectory, { recursive: true });
  for (const asset of OCR_ASSETS) {
    const destination = resolve(assetDirectory, asset.name);
    const cached = await readOptional(destination);
    // A corrupted cache fails visibly. It is not silently replaced, retried or switched to another model.
    if (cached) { verifyOcrAsset(cached, asset); continue; }
    const bytes = asset.source ? verifyOcrAsset(await readFile(resolve('node_modules', asset.source)), asset) : await downloadModel(asset);
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  await copyFile(resolve('node_modules/tesseract.js/LICENSE.md'), resolve(assetDirectory, 'LICENSE-tesseract.txt'));
  await copyFile(resolve('node_modules/tesseract.js-core/LICENSE'), resolve(assetDirectory, 'LICENSE-Apache-2.0.txt'));
  await copyFile(resolve('node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt'), resolve(assetDirectory, 'NOTICE-worker.txt'));
  await copyFile(resolve('docs/inbody-local-ocr-assets.md'), resolve(assetDirectory, 'ASSET-PROVENANCE.md'));
  console.log('Pinned local OCR assets verified; no image or OCR result supplied.');
}
export async function localOcrAssetRoutes() {
  if (process.env.YEONI_COMPONENT_QA !== '1' || process.env.VERCEL) throw new Error('Isolated OCR assets only');
  // Startup is verification-only. No networking, directory proxy or automatic model download.
  return Promise.all(OCR_ASSETS.map(async asset => {
    const path = resolve(assetDirectory, asset.name);
    verifyOcrAsset(await readFile(path), asset);
    return [`${OCR_ASSET_PREFIX}/${asset.name}`, [path, asset.name.endsWith('.js') ? 'application/javascript' : 'application/gzip']];
  }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareOcrAssets();
