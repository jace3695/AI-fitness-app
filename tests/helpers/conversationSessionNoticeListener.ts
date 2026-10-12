/** Loaded inside the synthetic tab realm; observes event metadata, not storage. */
export function install(observe: (event: { type: string; detail?: unknown }) => void) {
  const listener = (event: Event) => observe({ type: event.type, detail: (event as CustomEvent).detail });
  window.addEventListener('yeoni-records-changed', listener);
  window.addEventListener('yeoni-cloud-records-refresh', listener);
  return () => {
    window.removeEventListener('yeoni-records-changed', listener);
    window.removeEventListener('yeoni-cloud-records-refresh', listener);
  };
}

/** Fail only the next shipped notification schedule after durable local commit. */
export function failNextNotification() {
  const schedule = queueMicrotask; let failed = false;
  globalThis.queueMicrotask = callback => {
    if (!failed) { failed = true; throw new Error('PRIVATE_SYNTHETIC_NOTIFICATION_FAILURE'); }
    schedule(callback);
  };
  return () => { globalThis.queueMicrotask = schedule; };
}

export function captureDiagnostics(record: (method: string, values: unknown[]) => void) {
  const original = console;
  globalThis.console = { ...original,
    log: (...values: unknown[]) => record('log', values), info: (...values: unknown[]) => record('info', values),
    debug: (...values: unknown[]) => record('debug', values), warn: (...values: unknown[]) => record('warn', values),
    error: (...values: unknown[]) => record('error', values), trace: (...values: unknown[]) => record('trace', values),
  };
  return () => { globalThis.console = original; };
}
