import { showDrawingTools } from './drawing-tools';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import ts from 'typescript';
import { test, expect, login, synced } from './fixture';
import catalog from '../../content/drawing/template-catalog.json';
import { templatePath } from '../../lib/drawing/template-zip';

// Never put the private textbook in GitHub/CI. Run the shipping functions with
// 150 synthetic PNGs. Original ZIP hashes are checked separately, locally.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
const assets = catalog.assets.map(a => ({ ...a, size: png.length, sha256: createHash('sha256').update(png).digest('hex') }));
function zip() {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const asset of assets) {
    const name = Buffer.from(asset.path), body = deflateRawSync(png), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(png.length, 22); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(png.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body); centrals.push(central, name); offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(assets.length, 8); end.writeUInt16LE(assets.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return [...Buffer.concat([...locals, directory, end])];
}
const moduleSource = ['lib/drawing/template-zip.ts', 'lib/drawing/template-store.ts'].map(path => ts.transpileModule(
  readFileSync(path, 'utf8').replace(/^import .*from '\.\/template-zip\.ts';\n/m, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText.replace(/^export /gm, '')).join('\n');

test('drawing templates: browser decoder, 150 private uploads, interrupted retry, reload and access isolation', async ({ page, qa }) => {
  test.setTimeout(240_000);
  await login(page, qa.account); await synced(page); await page.goto('/growth/drawing'); await showDrawingTools(page);
  const section = page.getByRole('region', { name: '만능 템플릿 원본 자료' });
  await expect(section.getByLabel('템플릿 등록 상태')).toContainText('0 / 150');
  await section.getByText('처음 한 번 원본 ZIP 등록', { exact: true }).click();
  await section.getByLabel('만능 템플릿 ZIP').setInputFiles({ name: 'wrong.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid') });
  await expect(section.getByRole('status')).toContainText('원본 템플릿 ZIP');
  const session = (await qa.account.client.auth.getSession()).data.session!;
  const auth = { Authorization: `Bearer ${session.access_token}`, apikey: JSON.parse(readFileSync('.e2e/stack-status.json', 'utf8')).ANON_KEY };
  const install = async () => page.addScriptTag({ content: `{${moduleSource}\nwindow.drawingTemplateQA = { registerTemplates, loadTemplate };}` });
  await install();
  const payload = { owner: qa.account.id, assets, bytes: zip(), auth };
  // Actual browser HTTP to isolated Auth/Storage. No interception of successful
  // writes/reads. Supply only a fixture manifest and the storage adapter.
  const run = (mode: 'interrupt' | 'retry' | 'read') => page.evaluate(async ({ owner, assets, bytes, auth, mode }) => {
    const api = (window as unknown as { drawingTemplateQA: typeof import('../../lib/drawing/template-store') }).drawingTemplateQA;
    let reads = 0, progress = 0, duplicateWrites = 0, stopped = false;
    const store = {
      upload: async (path: string, body: Uint8Array<ArrayBuffer>) => {
        if (mode === 'read') throw Error('No writes allowed after reload');
        const r = await fetch(`http://127.0.0.1:54321/storage/v1/object/growth-resources/${path}`, { method: 'POST', headers: { ...auth, 'content-type': 'image/png', 'x-upsert': 'false' }, body });
        if (!r.ok) duplicateWrites++;
        return { error: r.ok ? null : 'upload error' };
      },
      download: async (path: string) => {
        reads++;
        if (mode === 'interrupt' && reads === 6) return { data: null, error: 'injected connection loss' };
        const r = await fetch(`http://127.0.0.1:54321/storage/v1/object/authenticated/growth-resources/${path}`, { headers: auth });
        return { data: r.ok ? await r.blob() : null, error: r.ok ? null : 'read error' };
      },
    };
    try {
      if (mode === 'read') { for (const asset of assets) { await api.loadTemplate(store, owner, asset); progress++; } }
      else await api.registerTemplates(store, owner, Uint8Array.from(bytes).buffer, assets, () => true, (done: number) => { progress = done; });
    } catch { stopped = true; }
    return { reads, progress, duplicateWrites, stopped };
  }, { ...payload, mode });
  expect(await run('interrupt')).toEqual({ reads: 6, progress: 5, duplicateWrites: 0, stopped: true });
  expect(await run('retry')).toEqual({ reads: 150, progress: 150, duplicateWrites: 6, stopped: false });
  const prefix = templatePath(qa.account.id, assets[0]).split('/').slice(0, -1).join('/');
  expect((await qa.account.client.storage.from('growth-resources').list(prefix, { limit: 200 })).data).toHaveLength(150);
  await page.reload(); await showDrawingTools(page); await install();
  expect(await run('read')).toEqual({ reads: 150, progress: 150, duplicateWrites: 0, stopped: false });
  const other = await qa.createAccount(), path = templatePath(qa.account.id, assets[0]);
  expect((await other.client.storage.from('growth-resources').download(path)).error).not.toBeNull();
  expect((await other.client.storage.from('growth-resources').upload(path, png, { upsert: true, contentType: 'image/png' })).error).not.toBeNull();
  expect((await page.request.get(`http://127.0.0.1:54321/storage/v1/object/public/growth-resources/${path}`)).ok()).toBe(false);
  // A listed object isn't proof of integrity: the real UI rejects wrong bytes.
  expect((await qa.account.client.storage.from('growth-resources').upload(templatePath(qa.account.id, catalog.assets[0]), png, { contentType: 'image/png' })).error).toBeNull();
  await page.getByRole('button', { name: '150종 둘러보기', exact: true }).click();
  await page.getByLabel('자료 종류').selectOption(catalog.assets[0].group);
  await section.getByRole('button', { name: catalog.assets[0].label, exact: true }).click();
  await expect(section.getByRole('status')).toContainText('원본 확인에 실패');
  await expect(section.getByRole('img')).toHaveCount(0);
  console.log('DRAWING_TEMPLATE_CHECK ' + JSON.stringify({ syntheticPngs: 150, interruptedAfter: 5, retryVerified: 150, reloadedReads: 150, privateSourceUploadedToCI: false }));
});
