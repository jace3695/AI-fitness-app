import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as materials from '../app/data/handwritingMaterials.ts';
import { hashBytes } from '../lib/handwriting-draft.ts';
const owner = '00000000-0000-4000-8000-000000000821', other = '00000000-0000-4000-8000-000000000822';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const env = { owner, page: 2, objects: new Map<string, Blob>(), uploads: [] as string[], downloads: [] as string[], clicks: 0,
    pdfBlock: null as ReturnType<typeof deferred> | null, uploadBlock: null as ReturnType<typeof deferred> | null, wrongReadback: false, uploadStarted: deferred() };
  let cursor = 0;
  const modules = {
    react: {
      useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (value: unknown) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
      useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
      useEffect(effect: () => void, deps?: unknown[]) { const slot = cursor++; const old = slots[slot] as unknown[] | undefined; if (!deps || !old || old.some((value, index) => value !== deps[index])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
    },
    '@/app/lib/supabase': { supabase: {
      auth: { getUser: async () => ({ data: { user: { id: env.owner } }, error: null }) },
      storage: { from() { return {
        async download(path: string) {
          env.downloads.push(path); if (path.endsWith('workbook.pdf')) await env.pdfBlock?.promise;
          const data = env.objects.get(path) ?? null;
          return { data: data && env.wrongReadback && path.endsWith('workbook.pdf') ? new Blob(['wrong']) : data, error: data ? null : Error('missing') };
        },
        async upload(path: string, bytes: Blob | Uint8Array, options: { upsert: boolean }) {
          assert.equal(options.upsert, false); env.uploads.push(path); env.uploadStarted.resolve(); await env.uploadBlock?.promise;
          if (!env.objects.has(path)) env.objects.set(path, bytes instanceof Blob ? bytes : new Blob([new Uint8Array(bytes)]));
          return { error: null };
        },
      }; } },
    } },
    '@/app/data/handwritingMaterials': materials, '@/lib/handwriting-draft': { hashBytes },
  };
  const exports = {} as typeof import('../app/growth/handwriting/usePrivateMaterials');
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/handwriting/usePrivateMaterials.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, {
    Blob, Error, Uint8Array, atob, JSON, URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} }, setTimeout: () => 0,
    document: { body: { append() {} }, createElement: () => ({ click() { env.clicks++; }, remove() {} }) },
  })(exports, (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name as keyof typeof modules]; });
  const isOwnerActive = (id: string) => env.owner === id;
  const render = () => { cursor = 0; const result = exports.usePrivateMaterials(env.owner, env.page, isOwnerActive); effects.splice(0).forEach(effect => effect()); return result; };
  render();
  return { env, render, unmount: () => cleanups.forEach(cleanup => cleanup?.()), async settle() { for (let i = 0; i < 15; i++) { await tick(); render(); } return render(); } };
}
async function syntheticPackage() {
  const bytes = new TextEncoder().encode('synthetic material bytes'), sha256 = await hashBytes(bytes);
  return new Blob([JSON.stringify({ format: materials.HANDWRITING_PACKAGE_FORMAT, files: materials.HANDWRITING_FILE_NAMES.map(name => ({ name, mimeType: name === 'workbook.pdf' ? 'application/pdf' : 'image/webp', base64: Buffer.from(bytes).toString('base64'), sha256 })) })], { type: 'application/json' }) as File;
}
test('changing lesson during a PDF download does not strand its busy state or cancel the same-owner request', async t => {
  const qa = fixture(); t.after(qa.unmount); await qa.settle();
  qa.env.objects.set(materials.handwritingMaterialPath(owner, 'workbook.pdf'), new Blob(['synthetic PDF']));
  const blocked = deferred(); qa.env.pdfBlock = blocked; const download = qa.render().downloadPdf(); await tick();
  qa.env.page = 3; qa.render(); blocked.resolve(); await download;
  assert.equal(qa.render().opening, false); assert.equal(qa.env.clicks, 1);
});
test('material import survives a same-owner lesson change and verifies every uploaded object plus exact marker', async t => {
  const qa = fixture(); t.after(qa.unmount); await qa.settle();
  const blocked = deferred(); qa.env.uploadBlock = blocked; const importing = qa.render().importPackage(await syntheticPackage());
  await Promise.race([qa.env.uploadStarted.promise, importing]); assert.equal(qa.env.uploads.length, 1);
  qa.env.page = 3; qa.render(); qa.env.uploadBlock = null; blocked.resolve(); await importing;
  assert.equal(qa.render().importing, false); assert.equal(qa.env.uploads.length, 55);
  for (const path of qa.env.uploads) assert.ok(qa.env.downloads.includes(path), `Missing exact readback for ${path}`);
  assert.equal(await qa.env.objects.get(materials.handwritingMaterialPath(owner, 'ready.txt'))!.text(), materials.HANDWRITING_PACKAGE_FORMAT);
});
test('wrong uploaded bytes never publish the ready marker and owner switches stop further uploads', async t => {
  for (const fault of ['hash', 'owner']) {
    const qa = fixture(); t.after(qa.unmount); await qa.settle(); const file = await syntheticPackage();
    qa.env.wrongReadback = fault === 'hash'; const blocked = deferred(); qa.env.uploadBlock = blocked;
    const importing = qa.render().importPackage(file); await Promise.race([qa.env.uploadStarted.promise, importing]);
    if (fault === 'owner') { qa.env.owner = other; qa.render(); }
    qa.env.uploadBlock = null; blocked.resolve(); await importing;
    assert.equal(qa.env.uploads.length, 1); assert.ok(!qa.env.uploads.some(path => path.endsWith('ready.txt')));
  }
});
