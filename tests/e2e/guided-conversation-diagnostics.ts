import type { Page } from '@playwright/test';

type Phase = 'step-visible' | 'exposure-ready' | 'input-filled' | 'save-clicked' | 'saved' | 'reloaded' | 'send-clicked' | 'sent' | 'before-close' | 'before-recovery' | 'recovered' | 'pending-close-confirmed' | 'close-abandoned' | 'replacement-close-clicked' | 'close-clicked' | 'closed' | 'finished';
export function sanitizeGuidedDiagnostic(value: unknown) {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const choice = (key: string, allowed: readonly string[]) => typeof data[key] === 'string' && allowed.includes(data[key] as string) ? data[key] : 'unknown';
  const bit = (key: string) => typeof data[key] === 'boolean' ? data[key] : null;
  const count = (key: string) => Number.isInteger(data[key]) && Number(data[key]) >= 0 && Number(data[key]) <= 10000 ? data[key] : null;
  const exposure = data.exposure && typeof data.exposure === 'object' ? data.exposure as Record<string, unknown> : {};
  return {
    status: choice('status', ['unavailable', 'idle', 'unsaved', 'saving', 'pending', 'uncertain', 'saved']),
    available: bit('available'), busy: bit('busy'), contextCurrent: bit('contextCurrent'),
    errorCode: choice('errorCode', ['none', 'changed-before-action', 'capacity-exceeded', 'source-conflict', 'storage-unconfirmed', 'other-safe-error']),
    commandKind: choice('commandKind', ['none', 'append', 'close']),
    commandBoundary: choice('commandBoundary', ['none', 'entered', 'head-changed', 'editor-changed', 'saving-draft', 'after-save-changed', 'pre-capture-changed', 'captured', 'staged', 'applied', 'failed']),
    editorPresent: bit('editorPresent'), editorDirty: bit('editorDirty'), editorOnActiveStep: bit('editorOnActiveStep'),
    stepIndex: count('stepIndex'), submittedSteps: count('submittedSteps'), totalSteps: count('totalSteps'),
    turnCount: count('turnCount'), draftCount: count('draftCount'),
    pendingKind: choice('pendingKind', ['none', 'append', 'close', 'create', 'draft', 'cancel', 'delete']),
    exposure: Object.fromEntries(['example', 'reading', 'meaning', 'hint'].map(key => [key, typeof exposure[key] === 'string' && ['shown', 'not-shown', 'unknown'].includes(exposure[key]) ? exposure[key] : 'unknown'])),
    closedBoundary: bit('closedBoundary'),
  };
}

/** Read only committed fixed diagnostics, never editor text or storage bytes. */
export async function readGuidedDiagnostic(page: Page) {
  const raw = await page.locator('[data-conversation-diagnostic]').evaluateAll(elements => {
    if (elements.length !== 1) return null;
    try { return JSON.parse(elements[0].getAttribute('data-conversation-diagnostic') ?? 'null'); } catch { return null; }
  });
  return { surface: raw ? 'present' : 'missing', ...sanitizeGuidedDiagnostic(raw) };
}

/** Bounded facts only; do not collect text, identities, storage or raw exceptions. */
export async function logGuidedBoundary(page: Page, level: 'beginner' | 'elementary' | 'intermediate', step: number, phase: Phase) {
  try {
    console.info('QA_GUIDED_BOUNDARY', JSON.stringify({ level, step, phase, ...await readGuidedDiagnostic(page) }));
  } catch {
    // Diagnostic collection must not replace the original assertion failure.
    console.info('QA_GUIDED_BOUNDARY', JSON.stringify({ level, step, phase, surface: 'unavailable' }));
  }
}

export const GUIDED_CHECKPOINT_REASONS = ['invalid-envelope', 'changed-scope', 'authority-or-status', 'wrong-step', 'progress-or-editor', 'pending-kind', 'draft-transition', 'command-boundary', 'operation-identity', 'command-payload', 'unresolved-operation', 'terminal-transition', 'missing-storage', 'read-failed', 'changed-after-observation'] as const;
export type GuidedCheckpointReason = typeof GUIDED_CHECKPOINT_REASONS[number];
/** One fixed-schema failure row. Never serialize the inspected storage/input. */
export function logGuidedCheckpointRefusal(value: unknown, level: 'beginner' | 'elementary' | 'intermediate', step: number, checkpointKind: 'draft' | 'append' | 'close', reason: GuidedCheckpointReason) {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  try {
    console.info('QA_GUIDED_BOUNDARY', JSON.stringify({
      level: ['beginner', 'elementary', 'intermediate'].includes(level) ? level : 'unknown',
      step: Number.isInteger(step) && step >= 0 && step <= 10000 ? step : null, phase: 'checkpoint-refused',
      checkpointKind: ['draft', 'append', 'close'].includes(checkpointKind) ? checkpointKind : 'unknown',
      proof: GUIDED_CHECKPOINT_REASONS.includes(reason) ? reason : 'unknown',
      surface: typeof data.surface === 'string' && ['present', 'missing', 'unavailable'].includes(data.surface) ? data.surface : 'unavailable', ...sanitizeGuidedDiagnostic(data) }));
  } catch { /* Diagnostics must not replace the original assertion failure. */ }
}
