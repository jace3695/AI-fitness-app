import { isLiveUuid } from '../../../lib/language-live/learning-validation.ts';
import { validateLivePreparationInput } from '../../../lib/language-live/preparation-validation.ts';
import type { LivePreparation, LivePreparationRecord, SaveLivePreparationInput } from '../../../lib/language-live/preparation-types.ts';

export type LivePreparationDraft = {
  version: 1; ownerId: string; draftId: string; updatedAt: string;
  input: SaveLivePreparationInput; reviewed: boolean; submitted: boolean;
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export const preparationDraftPrefix = (owner: string) => `yeoni-language-live:${owner}:preparation-draft:v1:`;
export const preparationDraftKey = (owner: string, id: string) => `${preparationDraftPrefix(owner)}${id}`;
export function createPreparationDraft(ownerId: string, preparation: LivePreparation, ids: { draftId: string; preparationId: string; requestId: string; now: string }, record?: LivePreparationRecord): LivePreparationDraft {
  if (preparation.source.ownerId !== ownerId || (record && (record.user_id !== ownerId || record.payload.preparation.source.ownerId !== ownerId))) throw Error('source_mismatch');
  return { version: 1, ownerId, draftId: ids.draftId, updatedAt: ids.now, reviewed: false, submitted: false,
    input: { requestId: ids.requestId, preparationId: record?.preparation_id ?? ids.preparationId, expectedRevision: record?.revision ?? 0,
      preparation: structuredClone(preparation), editedText: record?.payload.editedText ?? preparation.generatedText, reviewed: true } };
}
export function forkPreparationDraft(draft: LivePreparationDraft, id: string, now: string): LivePreparationDraft {
  if (!isLiveUuid(id) || id === draft.draftId) throw Error('fresh_draft_id_required');
  return structuredClone({ ...draft, draftId: id, updatedAt: now });
}
export function readPreparationDrafts(storage: StorageLike, owner: string): { drafts: LivePreparationDraft[]; unreadable: boolean } {
  const drafts: LivePreparationDraft[] = []; let unreadable = false;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i); if (!key?.startsWith(preparationDraftPrefix(owner))) continue;
    try {
      const draft = JSON.parse(storage.getItem(key) ?? 'null') as LivePreparationDraft;
      if (!draft || draft.version !== 1 || draft.ownerId !== owner || !isLiveUuid(draft.draftId) || preparationDraftKey(owner, draft.draftId) !== key
        || typeof draft.updatedAt !== 'string' || !Number.isFinite(Date.parse(draft.updatedAt)) || typeof draft.reviewed !== 'boolean' || typeof draft.submitted !== 'boolean'
        || !draft.input || draft.input.preparation?.source?.ownerId !== owner || typeof draft.input.editedText !== 'string'
        || validateLivePreparationInput({ ...draft.input, editedText: draft.input.editedText.trim() ? draft.input.editedText : '_' }).length
        || (draft.submitted && (!draft.reviewed || validateLivePreparationInput(draft.input).length))) throw Error('invalid');
      drafts.push(draft);
    } catch { unreadable = true; }
  }
  return { drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), unreadable };
}
/** Tab-private IDs prevent concurrent writers; exact readback detects stale writes. */
export function persistPreparationDraft(storage: StorageLike, draft: LivePreparationDraft, expected: string | null): string {
  const key = preparationDraftKey(draft.ownerId, draft.draftId);
  if (storage.getItem(key) !== expected) throw Error('draft_changed');
  const encoded = JSON.stringify(draft); storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded) throw Error('draft_changed');
  return encoded;
}
export function removePreparationDraft(storage: StorageLike, draft: LivePreparationDraft, expected: string | null): boolean {
  const key = preparationDraftKey(draft.ownerId, draft.draftId);
  if (expected === null || storage.getItem(key) !== expected) return false;
  storage.removeItem(key); return true;
}
