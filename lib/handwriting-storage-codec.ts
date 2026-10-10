import { HANDWRITING_MAX_CHECKPOINT_BYTES, HANDWRITING_MAX_PNG_BYTES, hashBytes, parseHandwritingRecord, type FrozenHandwritingSave, type HandwritingDraft, type HandwritingRecord, type HandwritingTombstone, type Raster } from './handwriting-draft.ts';

type StoredPng = { encoding: 'handwriting-png-bytes-v1'; type: 'image/png'; bytes: Uint8Array };
export type StoredHandwritingRecord = HandwritingTombstone | (Omit<HandwritingDraft, 'pending'> & {
  pending: (Omit<FrozenHandwritingSave, 'png'> & { png: Blob | StoredPng | null }) | null;
});
const invalid = (): never => { throw Error('handwriting_draft_invalid'); };

/** Bound the extra snapshot allocation before copying the complete runtime record. */
function boundSnapshot(record: HandwritingRecord) {
  if (record.state !== 'active') return;
  if (!Array.isArray(record.undo) || record.undo.length > 5) invalid();
  let size = 0;
  for (const raster of [record.raster, ...record.undo.map(frame => frame.raster)]) {
    if (!raster) continue;
    if (!(raster.pixels instanceof Uint8ClampedArray)) invalid();
    size += raster.pixels.byteLength;
    if (size > HANDWRITING_MAX_CHECKPOINT_BYTES) throw Error('handwriting_checkpoint_oversize');
  }
  const png = record.pending?.png;
  if (png) {
    if (!(png instanceof Blob) || png.type !== 'image/png' || png.size < 1 || png.size > HANDWRITING_MAX_PNG_BYTES) invalid();
    size += png.size;
  }
  if (size > HANDWRITING_MAX_CHECKPOINT_BYTES) throw Error('handwriting_checkpoint_oversize');
}
function snapshotRecord(record: HandwritingRecord): HandwritingRecord {
  if (record.state !== 'active') return structuredClone(record);
  // structuredClone(view) also copies its entire backing buffer. Copy only each
  // bounded view here, and clone all metadata before yielding to asynchronous work.
  const raster = (value: Raster | null): Raster | null => value ? { ...structuredClone({ ...value, pixels: null }), pixels: new Uint8ClampedArray(value.pixels) } : null;
  return { ...structuredClone({ ...record, raster: null, undo: [] }), raster: raster(record.raster),
    undo: record.undo.map(frame => ({ ...structuredClone({ ...frame, raster: null }), raster: raster(frame.raster)! })) };
}

/** Snapshot before any await. Only the IDB wire representation changes; the job remains a Blob. */
export async function encodeHandwritingStorageRecord(record: HandwritingRecord): Promise<{ runtime: HandwritingRecord; stored: StoredHandwritingRecord }> {
  boundSnapshot(record);
  const runtime = snapshotRecord(record);
  await parseHandwritingRecord(runtime, runtime.owner);
  if (runtime.state !== 'active' || !runtime.pending?.png) return { runtime, stored: runtime };
  const pending = runtime.pending, png = pending.png!;
  const bytes = new Uint8Array(await png.arrayBuffer());
  if (bytes.byteLength !== png.size || bytes.byteLength < 1 || bytes.byteLength > HANDWRITING_MAX_PNG_BYTES || await hashBytes(bytes) !== pending.pngSha256) invalid();
  return { runtime, stored: { ...runtime, pending: { ...pending, png: { encoding: 'handwriting-png-bytes-v1', type: 'image/png', bytes } } } };
}

/** New readers accept legacy Blobs without migration; old readers reject this explicit tag. */
export async function decodeHandwritingStorageRecord(value: unknown, owner: string): Promise<HandwritingRecord | null> {
  const record = value as StoredHandwritingRecord | null | undefined;
  if (record?.state !== 'active' || !record.pending?.png || record.pending.png instanceof Blob) return parseHandwritingRecord(value, owner);
  const png = record.pending.png;
  if (!png || typeof png !== 'object' || Object.keys(png).sort().join('|') !== 'bytes|encoding|type'
    || png.encoding !== 'handwriting-png-bytes-v1' || png.type !== 'image/png'
    || !(png.bytes instanceof Uint8Array) || !(png.bytes.buffer instanceof ArrayBuffer)
    || png.bytes.byteLength < 1 || png.bytes.byteLength > HANDWRITING_MAX_PNG_BYTES) invalid();
  // Copy only the view, including a nonzero byteOffset, never unrelated backing bytes.
  const blob = new Blob([new Uint8Array(png.bytes).buffer], { type: 'image/png' });
  return parseHandwritingRecord({ ...record, pending: { ...record.pending, png: blob } }, owner);
}
