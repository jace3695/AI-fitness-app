import Link from 'next/link';
import { FREE_ADVICE_LABELS, type FreeAdviceScope } from '@/lib/free-advice-context';

export default function YeoniAdviceEntry({ scope }: { scope: FreeAdviceScope }) {
  return <section aria-label={`${FREE_ADVICE_LABELS[scope]} 연이에게 물어보기`} className="my-5 rounded-3xl border border-violet-100 bg-white p-4 sm:p-5">
    <h2 className="text-lg font-bold">연이에게 물어보세요</h2>
    <p className="mt-2 text-sm text-gray-600">기록 확인부터 무료 AI 조언까지 한 대화에서 이어가요.</p>
    <Link href={`/assistant?advice=${scope}#yeoni-chat`} className="mt-3 inline-flex min-h-11 items-center rounded-2xl bg-[#F1EFFF] px-4 py-2 text-sm font-bold text-[#5146A6]">연이에게 물어보기</Link>
  </section>;
}
