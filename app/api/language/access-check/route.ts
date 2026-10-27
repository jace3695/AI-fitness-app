import { speechBoundaryOwnerHash } from '@/lib/speech-boundary-gate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** No auth, records, RPC or provider call. This only rechecks page visibility. */
export function HEAD(request: Request) {
  const ownerHash = speechBoundaryOwnerHash(process.env);
  const allowed = ownerHash && request.headers.get('X-Yeoni-Boundary-Owner') === ownerHash;
  return new Response(null, { status: allowed ? 204 : 404, headers: { 'Cache-Control': 'private, no-store' } });
}
