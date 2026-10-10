import { assertLanguageRecordSource, type LanguageRecordContext, type LanguageRecordSnapshot } from './languageCloudSync.ts';
import type { LanguageBytes, LanguageStorageKey } from './languageStorageBoundary.ts';
import { LanguageSourceConflictError, languageDocument } from './languageRecordDocuments.ts';

export interface LanguageRowHandle { readonly viewId: string }
type RowPrivate = { source: LanguageRecordSnapshot; key: LanguageStorageKey; index: number; raw: string };
const handles = new WeakMap<LanguageRowHandle, RowPrivate>();
const views = new Map<string, Map<string, string>>();
export function isLanguageRowHandle(value: unknown): value is LanguageRowHandle { return Boolean(value && typeof value === 'object' && handles.has(value as LanguageRowHandle)); }
function identity(key: LanguageStorageKey, raw: string): string {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `opaque:${raw}`;
    const doc = languageDocument(raw, 'object');
    const fields = key === 'japaneseCurriculumReviewV1' ? ['id'] : key === 'grammarProgress' ? ['lessonId']
      : key === 'savedWords' ? ['word', 'meaning', 'category'] : key === 'savedSentences' ? ['japanese', 'meaning', 'category']
        : key === 'wrongWords' ? ['word', 'meaning', 'category', 'quizType', 'createdAt'] : key === 'wrongSentences' ? ['japanese', 'quizType', 'createdAt']
          : key === 'wrongKana' ? ['char', 'mode', 'createdAt'] : [];
    if (!fields.length) return `opaque:${raw}`;
    const values = fields.map(field => doc.get([field]));
    if (typeof values[0] !== 'string') return `opaque:${raw}`;
    return `known:${JSON.stringify(values)}`;
  } catch { return `opaque:${raw}`; }
}
export function captureLanguageRows(source: LanguageRecordSnapshot, key: LanguageStorageKey): { handle: LanguageRowHandle; index: number; value: unknown; raw: string }[] {
  assertLanguageRecordSource(source, source.context);
  const doc = languageDocument(source.records[key], 'array');
  // Presentation identities have no mutation authority. New source handles always carry
  // complete array CAS, even when an existing React view key can remain mounted.
  const origin = `${source.context.userId}\0${source.context.epoch}\0${key}`;
  let cache = views.get(origin); if (!cache) { cache = new Map(); views.set(origin, cache); }
  const counts = new Map<string, number>();
  return Array.from({ length: doc.length() }, (_, index) => {
    const raw = doc.rawAt([index])!, id = identity(key, raw), occurrence = counts.get(id) ?? 0; counts.set(id, occurrence + 1);
    const identityKey = `${id}\0${occurrence}`; let viewId = cache.get(identityKey); if (!viewId) { viewId = crypto.randomUUID(); cache.set(identityKey, viewId); }
    const handle = Object.freeze({ viewId }); handles.set(handle, { source, key, index, raw });
    return { handle, index, value: doc.get([index]), raw };
  });
}
export function languageRowOriginal(handle: LanguageRowHandle): Readonly<RowPrivate> {
  const value = handles.get(handle); if (!value) throw new LanguageSourceConflictError(); return Object.freeze({ ...value });
}
export function languageRowKey(handle: LanguageRowHandle): LanguageStorageKey {
  const value = handles.get(handle); if (!value) throw new LanguageSourceConflictError(); return value.key;
}
export function languageRowSource(handle: LanguageRowHandle): LanguageRecordSnapshot {
  const value = handles.get(handle); if (!value) throw new LanguageSourceConflictError(); return value.source;
}
export function resolveLanguageRow(handle: LanguageRowHandle, context: LanguageRecordContext, fresh: LanguageBytes): number {
  const value = handles.get(handle); if (!value) throw new LanguageSourceConflictError();
  assertLanguageRecordSource(value.source, context);
  if (value.source.records[value.key] !== fresh[value.key]) throw new LanguageSourceConflictError();
  const doc = languageDocument(fresh[value.key], 'array');
  if (doc.rawAt([value.index]) !== value.raw) throw new LanguageSourceConflictError(); return value.index;
}
