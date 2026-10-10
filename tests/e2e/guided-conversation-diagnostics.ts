import type { Page } from '@playwright/test';

type Phase = 'step-visible' | 'input-filled' | 'save-clicked' | 'saved' | 'reloaded' | 'send-clicked' | 'sent' | 'before-close' | 'close-clicked' | 'closed' | 'finished';
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

/** Bounded facts only; do not collect text, identities, storage or raw exceptions. */
export async function logGuidedBoundary(page: Page, level: 'beginner' | 'elementary' | 'intermediate', step: number, phase: Phase) {
  try {
    const raw = await page.locator('[data-conversation-diagnostic]').evaluateAll(elements => {
      if (elements.length !== 1) return null;
      try { return JSON.parse(elements[0].getAttribute('data-conversation-diagnostic') ?? 'null'); } catch { return null; }
    });
    console.info('QA_GUIDED_BOUNDARY', JSON.stringify({ level, step, phase, surface: raw ? 'present' : 'missing', ...sanitizeGuidedDiagnostic(raw) }));
  } catch {
    // Diagnostic collection must not replace the original assertion failure.
    console.info('QA_GUIDED_BOUNDARY', JSON.stringify({ level, step, phase, surface: 'unavailable' }));
  }
}
