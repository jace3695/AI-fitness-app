import { notFound } from 'next/navigation';
import { speechBoundaryOwnerHash } from '@/lib/speech-boundary-gate';
import AccessCheckClient from './AccessCheckClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function AccessCheckPage() {
  const ownerHash = speechBoundaryOwnerHash(process.env);
  if (!ownerHash) notFound();
  return <AccessCheckClient ownerHash={ownerHash} />;
}
