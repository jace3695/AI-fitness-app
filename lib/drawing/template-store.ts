import { readTemplateZip, sha256, templatePath, type TemplateAsset } from './template-zip.ts';

// The same owner-scoped storage operations are used by the UI and browser checks.
export type TemplateStore = {
  upload: (path: string, bytes: Uint8Array<ArrayBuffer>, options: { contentType: string; upsert: boolean }) => Promise<{ error: unknown }>;
  download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
};

export async function loadTemplate(store: TemplateStore, owner: string, asset: TemplateAsset) {
  const result = await store.download(templatePath(owner, asset));
  if (result.error || !result.data) throw Error('이 자료를 아직 열 수 없어요. 원본 ZIP을 등록하거나 연결 후 다시 열어 주세요.');
  const bytes = new Uint8Array(await result.data.arrayBuffer());
  if (bytes.length !== asset.size || await sha256(bytes) !== asset.sha256) throw Error('원본 확인에 실패했어요. 다른 그림을 대신 표시하지 않았어요.');
  return new Blob([bytes], { type: 'image/png' });
}

export async function registerTemplates(store: TemplateStore, owner: string, buffer: ArrayBuffer, assets: TemplateAsset[], active: () => boolean, progress: (done: number, total: number) => void) {
  // Validate the whole archive before the first write. An incomplete ZIP uploads nothing.
  const files = await readTemplateZip(buffer, assets);
  let done = 0;
  for (const { asset, bytes } of files) {
    if (!active()) throw Error('화면이나 계정이 바뀌어 등록을 중단했어요.');
    // Never overwrite an existing original. A retry verifies the saved bytes instead.
    await store.upload(templatePath(owner, asset), bytes, { contentType: 'image/png', upsert: false });
    if (!active()) throw Error('화면이나 계정이 바뀌어 등록을 중단했어요.');
    try { await loadTemplate(store, owner, asset); }
    catch { throw Error('저장된 원본을 확인하지 못했어요. 같은 ZIP으로 다시 시도하면 이미 등록한 원본은 그대로 유지해요.'); }
    if (!active()) throw Error('화면이나 계정이 바뀌어 등록을 중단했어요.');
    progress(++done, files.length);
  }
  return done;
}
