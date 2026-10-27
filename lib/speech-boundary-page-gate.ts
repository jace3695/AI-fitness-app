/** Fresh, body-free gate: an old offline/service-worker document is not authority. */
export async function verifyBoundaryPage(ownerHash: string, signal: AbortSignal, send: typeof fetch = fetch) {
  signal.throwIfAborted();
  const response = await send('/api/language/access-check', {
    method: 'HEAD',
    headers: { 'X-Yeoni-Boundary-Owner': ownerHash },
    cache: 'no-store', redirect: 'error', signal,
  });
  void response.body?.cancel().catch(() => {});
  signal.throwIfAborted();
  return response.status === 204;
}
