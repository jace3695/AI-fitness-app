// Bounds client waiting, including preparation/authentication and response body.
// Cancellation cannot promise that an already accepted server request stops.
export const DIET_PHOTO_WAIT_MS = 45_000;

export function waitForDietPhoto<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(signal.reason ?? new Error('사진 분석을 중단했어요.')); };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason;
      return task();
    }).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
