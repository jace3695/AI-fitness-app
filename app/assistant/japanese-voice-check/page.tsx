import { notFound } from 'next/navigation';
import { JAPANESE_CHECK, japaneseCheckEnabled } from '@/lib/japanese-voice-check';
import JapaneseVoiceCheck from './JapaneseVoiceCheck';
export const dynamic = 'force-dynamic';
export const metadata = { title: '연이 일본어 음성 1회 생성', robots: { index: false, follow: false } };
export default function Page() {
  if (!japaneseCheckEnabled(process.env)) notFound();
  return <main className="mx-auto min-h-dvh w-full max-w-xl px-4 py-8 pb-32">
    <h1 className="text-xl font-bold">연이 일본어 음성 1회 생성</h1>
    <p className="mt-3 text-sm leading-6">승인한 문장을 일본어 Zephyr로 한 번 생성합니다. 받은 MP3는 립싱크 검증에 재사용합니다.</p>
    <blockquote lang="ja" className="mt-5 rounded-xl border p-4 leading-7">{JAPANESE_CHECK.text}</blockquote>
    <p className="mt-3 text-sm">일본어 · Google Zephyr · {Array.from(JAPANESE_CHECK.text).length}자</p>
    <JapaneseVoiceCheck />
  </main>;
}
