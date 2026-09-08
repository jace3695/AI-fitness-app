/** Coalesce overlapping refreshes, but always re-read after a request made in flight. */
export function createQueuedRefresh(read: () => Promise<void>) {
  let pending = false;
  let inFlight: Promise<void> | null = null;
  return () => {
    pending = true;
    if (!inFlight) {
      inFlight = Promise.resolve().then(async () => {
        do {
          pending = false;
          await read();
        } while (pending);
      }).finally(() => { inFlight = null; });
    }
    return inFlight;
  };
}
