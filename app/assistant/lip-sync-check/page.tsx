import { notFound } from 'next/navigation';
import ZephyrReadButton from '@/components/ZephyrReadButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: '연이 립싱크 테스트 음성', robots: { index: false, follow: false } };

const text = '안녕하세요. 오늘 일정을 알려드릴게요. 오늘은 조금 쉬는 게 좋겠어요.';

export default function Page() {
  if (process.env.VERCEL_ENV !== 'preview'
    || process.env.VERCEL_GIT_COMMIT_REF !== 'agent/yeoni-cat-animation-poc') notFound();

  return <main className="mx-auto min-h-dvh w-full max-w-xl px-4 py-8 pb-32">
    <h1 className="text-xl font-bold">연이 립싱크 테스트 음성</h1>
    <p className="mt-3 text-sm leading-6">승인한 39자 문장을 한 번 생성하고, 받은 음성을 저장해 립싱크 검증에 재사용합니다.</p>
    <blockquote className="mt-5 rounded-xl border p-4 leading-7">{text}</blockquote>
    <ZephyrReadButton text={text} />
    <p className="mt-4 text-sm leading-6">생성 후 오디오 메뉴에서 다운로드하세요. 저장하기 전에는 이 화면을 새로고침하거나 닫지 마세요.</p>
    <p className="mt-2 text-sm leading-6">실패하거나 결과가 불확실하면 추가로 생성하지 않습니다. 기존 로그인과 무료 음성 사용 한도가 적용됩니다.</p>
  </main>;
}
