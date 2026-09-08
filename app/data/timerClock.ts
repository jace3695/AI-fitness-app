export function elapsedSecondsSince(startedAt: number, initialSeconds: number, now: number) {
  return initialSeconds + Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function remainingSecondsUntil(deadline: number, now: number) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
