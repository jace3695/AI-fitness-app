import type { Request } from '@playwright/test';
import { failureLabel } from './navigation-diagnostics.ts';

// Only fixed labels and lifecycle booleans may leave the disposable runner.
// Never retain the request URL, headers/body, account, or raw exception text.
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE'];
const resourceClasses = ['document', 'stylesheet', 'image', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'other'];
export function routeContinueFailure(request: Request, error: unknown) {
  let pageClosed: boolean | null = null, mainFrame: boolean | null = null, frameDetached: boolean | null = null;
  try {
    const frame = request.frame(), page = frame.page();
    pageClosed = page.isClosed(); mainFrame = frame === page.mainFrame(); frameDetached = frame.isDetached();
  } catch { /* Service-worker requests can have no associated frame. */ }
  return {
    method: methods.includes(request.method()) ? request.method() : 'OTHER',
    resourceClass: resourceClasses.includes(request.resourceType()) ? request.resourceType() : 'other',
    failure: failureLabel(error instanceof Error ? error.message : ''),
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
