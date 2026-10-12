import { resolve } from 'node:path';

const kinds = { motion: 'Yeoni_Human_Motion_Preview.html', speech: 'Yeoni_Human_Speech_Preview.html' };
export function humanPreviewPath(kind) {
  const entry = kinds[kind];
  if (!entry) throw new Error('Unknown human preview');
  return resolve(process.env.YEONI_PREVIEW_ROOT || '.e2e/current-human-previews', entry);
}
