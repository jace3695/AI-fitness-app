import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { characterReplyEnabled } from '@/lib/yeoni/reply-plan';
import CharacterCheck from './CharacterCheck';
import DeviceCheck from './DeviceCheck';
import AlignmentCheck from './AlignmentCheck';
import GeneralAlignmentCheck from './GeneralAlignmentCheck';

export const dynamic = 'force-dynamic';
export const metadata = { title: '연이 답변과 캐릭터 연결', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  if (!characterReplyEnabled(process.env)) notFound();
  const mode = (await searchParams).mode;
  if (mode === 'alignment') return <main className="mx-auto max-w-4xl px-4 py-6 pb-32"><AlignmentCheck /></main>;
  if (mode === 'general') return <main className="mx-auto max-w-4xl px-4 py-6 pb-32"><GeneralAlignmentCheck /></main>;
  const deviceReview = mode === 'device';
  const [ko, ja] = await Promise.all([
    readFile(path.join(process.cwd(), 'docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3'), 'base64'),
    readFile(path.join(process.cwd(), 'docs/yeoni-voice-comparison/media/gemini-zephyr-ja-user.wav'), 'base64'),
  ]);
  if (deviceReview) return <main className="mx-auto max-w-4xl px-4 py-6 pb-32">
    <DeviceCheck audio={{ ko, ja }} />
  </main>;
  return <main className="mx-auto max-w-4xl px-4 py-8 pb-32">
    <h1 className="text-2xl font-bold">연이의 답변이 표정으로 이어져요</h1>
    <p className="my-4 text-sm leading-7">아래 ‘예시 기록으로 먼저 보기’에서 보낼 내용을 확인하고 무료 AI 조언을 요청해 주세요.
      이 검수 화면은 새 음성을 생성하지 않아요. 답변 문장이 저장된 한국어·일본어 음성과 정확히 맞을 때 ‘답변 듣기’가 켜집니다.</p>
    <p className="mb-5 text-sm"><a href="?mode=device" className="inline-flex min-h-11 items-center text-violet-800 underline underline-offset-4">저장 음성으로 iPhone 확인하기</a></p>
    <CharacterCheck audio={{ ko, ja }} />
  </main>;
}
