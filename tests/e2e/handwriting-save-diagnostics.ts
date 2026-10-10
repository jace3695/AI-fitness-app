import type { Page } from '@playwright/test';

/** Test-only observers: native calls, callback arguments and IDB events remain unchanged. */
export function observeHandwritingSaveBoundary() {
  const diagnostic = {
    phase: 'idle', encodingRequested: false, encodingReturned: false, encodingPngValid: false,
    pendingPutAttempted: false, pendingPutHasBlob: false, pendingPutReturned: false,
    pendingRequestSucceeded: false, pendingRequestFailed: false,
    pendingTransactionCompleted: false, pendingTransactionAborted: false,
    errorBoundary: 'none', errorName: 'none',
  };
  const observe = (read: () => void) => { try { read(); } catch { /* Diagnostics never alter the native operation. */ } };
  observe(() => { (window as unknown as { __qaHandwritingSaveBoundary: typeof diagnostic }).__qaHandwritingSaveBoundary = diagnostic; });
  const failed = (boundary: string, error: unknown) => {
    observe(() => {
      diagnostic.errorBoundary = boundary;
      diagnostic.errorName = 'other';
      const name = error && typeof error === 'object' && 'name' in error ? error.name : null;
      if (typeof name === 'string' && ['AbortError', 'ConstraintError', 'DataCloneError', 'DataError', 'InvalidStateError', 'NotSupportedError', 'QuotaExceededError', 'ReadOnlyError', 'TransactionInactiveError', 'UnknownError'].includes(name)) diagnostic.errorName = name;
    });
  };
  const toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (...args) {
    const callback = args[0];
    let selected = false;
    observe(() => { selected = typeof callback === 'function' && this.getAttribute('aria-label') === '수업 손글씨 연습장'; });
    if (!selected) return toBlob.apply(this, args);
    observe(() => { diagnostic.phase = 'encoding-png'; diagnostic.encodingRequested = true; });
    const forwarded: Parameters<HTMLCanvasElement['toBlob']> = [...args];
    forwarded[0] = function (this: unknown, ...values: Parameters<BlobCallback>) {
      observe(() => {
        const value = values[0];
        diagnostic.phase = 'encoded-png'; diagnostic.encodingReturned = true;
        diagnostic.encodingPngValid = value instanceof Blob && value.type === 'image/png' && value.size > 0;
      });
      callback.apply(this, values);
    };
    try {
      return toBlob.apply(this, forwarded);
    } catch (error) { failed('png-call', error); throw error; }
  };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    let selected = false;
    observe(() => { selected = this.transaction.db.name === 'yeoni-handwriting' && this.name === 'slots' && !!args[0]?.pending?.png; });
    if (!selected) return put.apply(this, args);
    observe(() => {
      diagnostic.phase = 'staging-png'; diagnostic.pendingPutAttempted = true;
      diagnostic.pendingPutHasBlob = args[0].pending.png instanceof Blob;
    });
    let request: IDBRequest;
    try { request = put.apply(this, args); }
    catch (error) { failed('pending-put', error); throw error; }
    observe(() => {
      diagnostic.pendingPutReturned = true;
      request.addEventListener('success', () => observe(() => { diagnostic.phase = 'pending-request-succeeded'; diagnostic.pendingRequestSucceeded = true; }), { once: true });
      request.addEventListener('error', () => observe(() => { diagnostic.pendingRequestFailed = true; failed('pending-request', request.error); }), { once: true });
      this.transaction.addEventListener('complete', () => observe(() => { diagnostic.phase = 'pending-transaction-completed'; diagnostic.pendingTransactionCompleted = true; }), { once: true });
      this.transaction.addEventListener('abort', () => observe(() => {
        diagnostic.phase = 'pending-transaction-aborted'; diagnostic.pendingTransactionAborted = true;
        // Preserve the more specific originating request error when available.
        if (!diagnostic.pendingRequestFailed) failed('pending-transaction', this.transaction.error);
      }), { once: true });
    });
    return request;
  };
}

export function sanitizeHandwritingSaveBoundary(value: unknown) {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const choice = (key: string, allowed: string[]) => typeof data[key] === 'string' && allowed.includes(data[key] as string) ? data[key] : 'unknown';
  const bit = (key: string) => typeof data[key] === 'boolean' ? data[key] : null;
  return {
    phase: choice('phase', ['idle', 'encoding-png', 'encoded-png', 'staging-png', 'pending-request-succeeded', 'pending-transaction-completed', 'pending-transaction-aborted']),
    encodingRequested: bit('encodingRequested'), encodingReturned: bit('encodingReturned'), encodingPngValid: bit('encodingPngValid'),
    pendingPutAttempted: bit('pendingPutAttempted'), pendingPutHasBlob: bit('pendingPutHasBlob'), pendingPutReturned: bit('pendingPutReturned'),
    pendingRequestSucceeded: bit('pendingRequestSucceeded'), pendingRequestFailed: bit('pendingRequestFailed'),
    pendingTransactionCompleted: bit('pendingTransactionCompleted'), pendingTransactionAborted: bit('pendingTransactionAborted'),
    errorBoundary: choice('errorBoundary', ['none', 'png-call', 'pending-put', 'pending-request', 'pending-transaction']),
    errorName: choice('errorName', ['none', 'AbortError', 'ConstraintError', 'DataCloneError', 'DataError', 'InvalidStateError', 'NotSupportedError', 'QuotaExceededError', 'ReadOnlyError', 'TransactionInactiveError', 'UnknownError', 'other']),
  };
}

export async function logHandwritingSaveBoundary(page: Page) {
  try {
    const value = await page.evaluate(() => (window as unknown as { __qaHandwritingSaveBoundary?: unknown }).__qaHandwritingSaveBoundary);
    console.log('QA_HANDWRITING_SAVE_BOUNDARY', JSON.stringify(sanitizeHandwritingSaveBoundary(value)));
  } catch { console.log('QA_HANDWRITING_SAVE_BOUNDARY', JSON.stringify({ unavailable: true })); }
}
