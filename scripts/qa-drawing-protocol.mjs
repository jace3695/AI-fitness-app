import { stripVTControlCharacters } from 'node:util';

// Opt-in diagnostic for the Chromium drawing reload/action + unroute stalls.
// Protocol payloads exist only while parsing a pipe line. Retain an allowlisted
// method, boundary and timing; never retain params/results/errors or raw IDs.
const commands = new Set([
  'Runtime.evaluate', 'Runtime.callFunctionOn', 'Runtime.awaitPromise',
  'Runtime.getProperties', 'Runtime.releaseObject',
  'DOM.describeNode', 'DOM.resolveNode', 'DOM.getContentQuads', 'DOM.scrollIntoViewIfNeeded',
  'Input.dispatchMouseEvent',
  'Page.navigate', 'Page.reload', 'Page.handleJavaScriptDialog',
  'Fetch.enable', 'Fetch.disable', 'Fetch.continueRequest', 'Fetch.fulfillRequest', 'Fetch.failRequest',
  'Network.setCacheDisabled',
  'Target.createTarget', 'Target.closeTarget', 'Target.disposeBrowserContext',
  'Browser.close',
]);
const events = new Set([
  'Page.frameNavigated', 'Page.frameStartedLoading', 'Page.frameStoppedLoading',
  'Page.domContentEventFired', 'Page.loadEventFired',
  'Page.javascriptDialogOpening', 'Page.javascriptDialogClosed',
  'Runtime.executionContextCreated', 'Runtime.executionContextDestroyed',
  'Runtime.executionContextsCleared', 'Runtime.exceptionThrown',
  'Inspector.targetCrashed', 'Inspector.detached',
  'Target.attachedToTarget', 'Target.detachedFromTarget', 'Fetch.requestPaused',
]);
const eventLimit = 160;
const pendingLimit = 128;

export function drawingProtocolEnabled(env) {
  return env.QA_DRAWING_PROTOCOL === '1';
}

export function drawingProtocolBoundary(line) {
  if (line.startsWith('QA_NAVIGATION_FAILURE ')) return 'test-failure';
  if (/^(?:failed|timedOut): /.test(line)) return 'failed-test-end';
  if (!line.startsWith('QA_CLEANUP_PHASE ')) return null;
  try {
    const value = JSON.parse(line.slice('QA_CLEANUP_PHASE '.length));
    if (!['traffic-drain', 'unroute', 'context-close', 'account-cleanup'].includes(value?.phase)
      || !['start', 'end'].includes(value?.boundary)) return null;
    return value.phase + '-' + value.boundary;
  } catch { return null; }
}

export function observeDrawingProtocol(now = Date.now) {
  const recent = [];
  // Correlation keys are transient and bounded. They never enter a snapshot.
  const pending = new Map();
  let droppedEvents = 0;
  let droppedPending = 0;
  let malformedMessages = 0;
  const clock = () => Math.max(0, Math.round(now()));
  const add = (method, boundary, elapsedMs) => {
    if (recent.length === eventLimit) { recent.shift(); droppedEvents++; }
    recent.push({ at: clock(), method, boundary, ...(elapsedMs === undefined ? {} : { elapsedMs }) });
  };
  return {
    ingest(raw) {
      // Playwright's debug formatter emits one JSON envelope per line. Unknown,
      // oversized or truncated lines fail closed and cannot reach an artifact.
      const line = stripVTControlCharacters(raw);
      const match = line.match(/(?:^|\s)pw:protocol\s+(SEND ►|◀ RECV)\s+(\{.*\})(?:\s+\+\d+(?:ms|s|m|h))?\s*$/);
      if (!match || line.length > 2_000_000) {
        if (line.includes('pw:protocol')) malformedMessages++;
        return;
      }
      let value;
      try { value = JSON.parse(match[2]); } catch { malformedMessages++; return; }
      if (!value || typeof value !== 'object' || Array.isArray(value)) { malformedMessages++; return; }
      const isSend = match[1] === 'SEND ►';
      if (!isSend && !Object.hasOwn(value, 'id')) {
        if (events.has(value.method)) add(value.method, 'event');
        return;
      }
      if (!Number.isSafeInteger(value.id) || value.id < 0
        || (value.sessionId !== undefined && (typeof value.sessionId !== 'string' || value.sessionId.length > 256))) {
        malformedMessages++; return;
      }
      const key = JSON.stringify([value.sessionId ?? '', value.id]);
      if (isSend) {
        if (!commands.has(value.method)) return;
        if (pending.has(key)) droppedPending++;
        if (!pending.has(key) && pending.size === pendingLimit) {
          pending.delete(pending.keys().next().value); droppedPending++;
        }
        pending.set(key, { method: value.method, at: clock() });
        add(value.method, 'send');
      } else {
        const request = pending.get(key);
        if (!request) return;
        pending.delete(key);
        add(request.method, Object.hasOwn(value, 'error') ? 'reject' : 'resolve', Math.max(0, clock() - request.at));
      }
    },
    reset() {
      // Playwright can restart a worker's browser after a failed test. Reused
      // protocol IDs must never correlate commands from different processes.
      recent.length = 0;
      pending.clear();
    },
    snapshot() {
      return {
        at: clock(), droppedEvents, droppedPending, malformedMessages,
        events: recent.map(value => ({ ...value })),
        pending: [...pending.values()].map(value => ({ method: value.method, ageMs: Math.max(0, clock() - value.at) })),
      };
    },
  };
}
