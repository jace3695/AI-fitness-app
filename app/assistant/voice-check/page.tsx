import { notFound } from 'next/navigation';
import { isZephyrProbePreview } from '@/lib/zephyr-probe';
import VoiceCheck from './voice-check';

export const dynamic = 'force-dynamic';
export default function Page() {
  if (!isZephyrProbePreview()) notFound();
  return <VoiceCheck />;
}
