import type { Request } from '@playwright/test';
import { failureLabel } from './navigation-diagnostics.ts';

// Only fixed labels and lifecycle booleans may leave the disposable runner.
// Never retain the request URL, headers/body, account, or raw exception text.
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE'];
const resourceClasses = ['document', 'stylesheet', 'image', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'other'];
function errorMessage(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : undefined;
    return typeof message === 'string' ? message : '';
  }
  catch { return ''; }
}
export function routeContinueFailure(request: Request, error: unknown) {
  let pageClosed: boolean | null = null, mainFrame: boolean | null = null, frameDetached: boolean | null = null;
  try {
    const frame = request.frame(), page = frame.page();
    pageClosed = page.isClosed(); mainFrame = frame === page.mainFrame(); frameDetached = frame.isDetached();
  } catch { /* Service-worker requests can have no associated frame. */ }
  const message = errorMessage(error);
  // Distinguish known route ownership/protocol failures without retaining any
  // exception text. These are observations, never reasons to suppress errors.
  const routeError = /^(?:route\.continue: )?Route is already handled!(?:\n|$)/.test(message) ? 'already-handled'
    : /^(?:route\.continue: )?Protocol error \(/.test(message) ? 'protocol-error' : 'other';
  let requestFailure = 'unavailable';
  try {
    const failure = request.failure();
    const errorText = failure?.errorText;
    requestFailure = failure ? failureLabel(typeof errorText === 'string' ? errorText : '') : 'none';
  } catch { /* A detached/disposed request can no longer expose its failure. */ }
  return {
    method: methods.includes(request.method()) ? request.method() : 'OTHER',
    resourceClass: resourceClasses.includes(request.resourceType()) ? request.resourceType() : 'other',
    failure: failureLabel(message), routeError, requestFailure,
    pageClosed, navigationRequest: request.isNavigationRequest(), mainFrame, frameDetached,
  };
}

export class RouteContinueDiagnostics {
  readonly events: ReturnType<typeof routeContinueFailure>[] = [];
  dropped = 0;
  record(request: Request, error: unknown) {
    if (this.events.length >= 40) { this.dropped++; return null; }
    const event = routeContinueFailure(request, error);
    this.events.push(event);
    return event;
  }
}
