import type { BrowserContext, Page, Request, Response } from '@playwright/test';

// Only fixed labels may leave the disposable runner: never URLs, query strings,
// headers, bodies, console messages, account IDs or raw exception messages.
export function routeLabel(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.origin !== 'http://127.0.0.1:3000') return 'other-origin';
    return ['/', '/diet/settings', '/growth', '/growth/drawing', '/fitness'].includes(url.pathname)
      ? url.pathname : 'other-app-route';
  } catch { return 'unknown'; }
}

export function failureLabel(raw: string): string {
  if (/WebKit encountered an internal error/i.test(raw)) return 'webkit-internal';
  if (/crash/i.test(raw)) return 'crash';
  if (/closed|disconnected/i.test(raw)) return 'closed-or-disconnected';
  if (/timeout|timed out/i.test(raw)) return 'timeout';
  if (/abort|cancel|ERR_ABORTED/i.test(raw)) return 'aborted';
  if (/reset|ECONNRESET/i.test(raw)) return 'connection-reset';
  return 'other';
}

export function pageErrorLabel(error: Error): string {
  const message = error.message ?? '';
  if (!message.trim()) return 'empty-page-error';
  if (/^(?:Unhandled Promise Rejection:\s*)?(?:undefined|null|\[object Object\])$/.test(message.trim())) return 'non-error-rejection';
  if (/abort|cancel/i.test(message) || error.name === 'AbortError') return 'request-aborted';
  if (/load failed|failed to fetch|fetch failed|network.*lost|networkerror/i.test(message)) return 'fetch-load-failed';
  if (/hydration|hydrating|Minified React error #4(?:18|23|25)/i.test(message)) return 'react-hydration';
  if (/chunkload|loading chunk|dynamically imported module/i.test(message)) return 'script-chunk-load';
  if (/indexeddb|transaction.*inactive|database.*closed/i.test(message)) return 'indexeddb';
  if (/quota/i.test(message) || error.name === 'QuotaExceededError') return 'storage-quota';
  if (error.name === 'ReferenceError') return 'script-reference';
  if (error.name === 'TypeError') return 'script-type';
  if (error.name === 'SyntaxError') return 'script-syntax';
  return 'other-page-error';
}

export function pageErrorDetails(error: Error) {
  const names = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'AbortError', 'Unhandled Promise Rejection'];
  const frames = [...(error.stack ?? '').matchAll(/http:\/\/127\.0\.0\.1:3000\/_next\/static\/chunks\/([a-zA-Z0-9_-]+\.js):(\d+):(\d+)/g)]
    .slice(0, 3).map(match => ({ chunk: match[1], line: Number(match[2]), column: Number(match[3]) }));
  return { kind: names.includes(error.name) ? error.name : 'other', messageLength: Math.min((error.message ?? '').length, 10000), frames };
}

export function observeNavigation(context: BrowserContext) {
  const started = Date.now();
  const events: { ms: number; event: string; route?: string; status?: number; failure?: string }[] = [];
  let dropped = 0;
  let crashed = false;
  let disconnected = false;
  let pageErrors = 0;
  const add = (event: string, details = {}) => {
    if (events.length === 80) { events.shift(); dropped++; }
    events.push({ ms: Date.now() - started, event, ...details });
  };
  const cleanups: (() => void)[] = [];
  const seen = new Set<Page>();
  const watchPage = (page: Page) => {
    if (seen.has(page)) return;
    seen.add(page);
    const crash = () => { crashed = true; add('page-crash'); };
    const error = (error: Error) => { pageErrors++; add('page-error', { route: routeLabel(page.url()), failure: pageErrorLabel(error), details: pageErrorDetails(error) }); };
    page.on('crash', crash); page.on('pageerror', error);
    cleanups.push(() => { page.off('crash', crash); page.off('pageerror', error); });
  };
  const documentRequest = (request: Request) => request.isNavigationRequest() && request.resourceType() === 'document';
  const request = (request: Request) => {
    if (documentRequest(request)) add('document-request', { route: routeLabel(request.url()) });
  };
  const response = (response: Response) => {
    if (documentRequest(response.request())) add('document-response', { route: routeLabel(response.url()), status: response.status() });
  };
  const failed = (request: Request) => {
    if (documentRequest(request)) add('document-failed', { route: routeLabel(request.url()), failure: failureLabel(request.failure()?.errorText ?? '') });
    else {
      const url = new URL(request.url());
      const kind = url.origin === 'http://127.0.0.1:54321' ? (url.pathname.startsWith('/auth/') ? 'auth-request' : 'data-request')
        : url.origin === 'http://127.0.0.1:3000' ? (url.pathname.startsWith('/_next/') ? 'next-resource' : 'app-resource') : 'other-resource';
      add('resource-failed', { route: kind, failure: failureLabel(request.failure()?.errorText ?? '') });
    }
  };
  const browser = context.browser();
  const disconnect = () => { disconnected = true; add('browser-disconnected'); };
  context.on('page', watchPage); context.pages().forEach(watchPage);
  context.on('request', request); context.on('response', response); context.on('requestfailed', failed);
  browser?.on('disconnected', disconnect);
  return () => {
    // Detach before the fixture's intentional context.close().
    context.off('page', watchPage); context.off('request', request);
    context.off('response', response); context.off('requestfailed', failed);
    browser?.off('disconnected', disconnect); cleanups.forEach(cleanup => cleanup());
    return { startedAt: started, crashed, disconnected, pageErrors, dropped, events };
  };
}
