import { LIVE_REPORT_FIELDS, type LiveReportDraft, type SaveLiveLessonInput } from '../../../lib/language-live/types.ts';

export type LiveEditorDraft = {
  version: 1;
  ownerId: string;
  draftId: string;
  lessonId: string;
  requestId: string;
  expectedRevision: number;
  updatedAt: string;
  rawText: string;
  report: LiveReportDraft | null;
  reviewed: boolean;
  submitted: boolean;
  allowDuplicate: boolean;
  duplicateReason: string;
};

// Local drafts can contain fixable validation errors (for example an invalid date),
// but must be safe to render before any component touches nested report fields.
export function isRenderableLiveReport(value: unknown, rawText: string): value is LiveReportDraft {
  if (!value || typeof value !== 'object') return false;
  const report = value as LiveReportDraft;
  if (report.rawText !== rawText || !['v1', 'v1.1', 'unknown'].includes(report.reportVersion) ||
    !report.fields || typeof report.fields !== 'object' || Array.isArray(report.fields) ||
    typeof report.topic !== 'string' || typeof report.stage !== 'string' ||
    (report.lessonDate !== null && typeof report.lessonDate !== 'string') ||
    typeof report.lessonTimezone !== 'string' || typeof report.unparsedText !== 'string' ||
    !Array.isArray(report.warnings) || report.warnings.some(item => typeof item !== 'string')) return false;
  return LIVE_REPORT_FIELDS.every(({ key }) => {
    const field = report.fields[key];
    return field && typeof field.text === 'string' && ['reported', 'unknown', 'none', 'not_learned'].includes(field.presence) &&
      (field.sourceBlocks === undefined || (Array.isArray(field.sourceBlocks) && field.sourceBlocks.every(block => typeof block === 'string')));
  });
}

/** Retrying a submitted draft always reconstructs the same explicit mutation. */
export function liveDraftSaveInput(draft: LiveEditorDraft): SaveLiveLessonInput {
  if (!draft.report) throw new Error('report_required');
  return {
    requestId: draft.requestId, lessonId: draft.lessonId, expectedRevision: draft.expectedRevision,
    report: draft.report, allowDuplicate: draft.allowDuplicate,
    duplicateReason: draft.allowDuplicate ? draft.duplicateReason : undefined,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export const draftPrefix = (owner: string) => `yeoni-language-live:${owner}:draft:v1:`;
export const draftKey = (owner: string, id: string) => `${draftPrefix(owner)}${id}`;

export function readLiveDrafts(storage: StorageLike, owner: string): { drafts: LiveEditorDraft[]; unreadable: boolean } {
  const drafts: LiveEditorDraft[] = [];
  let unreadable = false;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(draftPrefix(owner))) continue;
    try {
      const value: unknown = JSON.parse(storage.getItem(key) ?? 'null');
      if (!value || typeof value !== 'object') throw new Error('invalid draft');
      const draft = value as LiveEditorDraft;
      if (draft.version !== 1 || draft.ownerId !== owner || draftKey(owner, draft.draftId) !== key ||
        typeof draft.rawText !== 'string' || typeof draft.lessonId !== 'string' || typeof draft.requestId !== 'string' ||
        !Number.isSafeInteger(draft.expectedRevision) || draft.expectedRevision < 0 || draft.expectedRevision > 2_147_483_646 ||
        typeof draft.updatedAt !== 'string' || !Number.isFinite(Date.parse(draft.updatedAt)) ||
        typeof draft.reviewed !== 'boolean' || typeof draft.submitted !== 'boolean' ||
        typeof draft.allowDuplicate !== 'boolean' || typeof draft.duplicateReason !== 'string') throw new Error('invalid draft');
      // Full semantic validation happens on save so unfinished edits remain recoverable.
      if (draft.report !== null && !isRenderableLiveReport(draft.report, draft.rawText)) throw new Error('invalid report');
      if (draft.submitted && (!draft.report || !draft.reviewed)) throw new Error('invalid submitted draft');
      drafts.push(draft);
    } catch { unreadable = true; }
  }
  return { drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), unreadable };
}

/** Every recovery gets a tab-private writable key; the source stays read-only. */
export function forkLiveDraft(draft: LiveEditorDraft, draftId: string, updatedAt: string): LiveEditorDraft {
  if (draftId === draft.draftId) throw new Error('fresh_draft_id_required');
  return { ...draft, draftId, updatedAt };
}

/** Sequential stale-write detection, not an atomic localStorage compare-and-swap.
 * Editors must use a fresh draft ID when recovering across pages or tabs. */
export function persistLiveDraft(storage: StorageLike, draft: LiveEditorDraft, expected: string | null): string {
  const key = draftKey(draft.ownerId, draft.draftId);
  if (storage.getItem(key) !== expected) throw new Error('draft_changed');
  const encoded = JSON.stringify(draft);
  storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded) throw new Error('draft_changed');
  return encoded;
}

export function removeLiveDraft(storage: StorageLike, draft: LiveEditorDraft, expected: string | null): boolean {
  const key = draftKey(draft.ownerId, draft.draftId);
  if (expected === null || storage.getItem(key) !== expected) return false;
  storage.removeItem(key);
  return true;
}

/** Each channel of reads gets its own epoch; obsolete responses cannot set UI state. */
export class LiveRequestEpoch {
  private sequence = 0;
  private alive = true;
  start() { this.sequence += 1; return this.sequence; }
  accepts(sequence: number) { return this.alive && this.sequence === sequence; }
  invalidate() { this.sequence += 1; }
  close() { this.alive = false; this.invalidate(); }
}
