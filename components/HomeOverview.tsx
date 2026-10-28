'use client';

import Link from 'next/link';
import type { AssistantNextAction } from '@/app/data/assistantNextAction';

export type HomeOverviewProps = {
  action: AssistantNextAction | null;
  loading: boolean;
  failures: string[];
  lastLoadedAt: string | null;
  onRetry: () => void;
};

/** Presentation only. Home keeps ownership of loading, availability and action priority. */
export default function HomeOverview({ action, loading, failures, lastLoadedAt, onRetry }: HomeOverviewProps) {
  const titleCharacters = Array.from(action?.title ?? '');
  const longTitle = titleCharacters.length > 80;
  const titlePreview = longTitle ? `${titleCharacters.slice(0, 40).join('').trimEnd()}…` : action?.title;
  return <section aria-label="지금 확인할 요약" className="rounded-[28px] border border-white bg-white p-[16px] shadow-sm sm:p-6">
    <h2 className="text-lg font-bold">지금 확인할 요약</h2>
    {loading && <p role="status" className="mt-3 rounded-xl bg-gray-50 p-3 text-sm">현재 기록을 확인하고 있어요.</p>}
    {failures.length > 0 && <div role="status" className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
      <p>{failures.join(' · ')} 정보를 불러오지 못했어요. {lastLoadedAt ? `마지막 정상 확인 ${lastLoadedAt}의 값을 유지합니다.` : '아래 숫자를 현재 기록으로 판단하지 마세요.'}</p>
      <button type="button" disabled={loading} onClick={onRetry} className="mt-2 min-h-11 rounded-xl bg-white px-4 font-bold disabled:opacity-50">다시 불러오기</button>
    </div>}
    {!loading && action && <section aria-label="연이가 고른 다음 한 걸음" className="mt-3 rounded-2xl bg-gradient-to-br from-[#5146A6] via-[#665CC0] to-[#7F77DD] p-[12px] text-white [overflow-wrap:anywhere]">
      <Link href={action.href} className="inline-flex min-h-11 w-full min-w-0 items-center justify-center rounded-xl bg-white px-[8px] py-2 text-center text-sm font-extrabold text-[#3C3489] break-keep"><span className="min-w-0">{action.label} →</span></Link>
      <p className="mt-3 text-xs font-bold text-white/80">연이가 고른 다음 한 걸음 · {action.eyebrow}</p>
      <h3 className="mt-2 text-xl font-extrabold">{titlePreview}</h3>
      {longTitle && <details key={action.title} className="mt-2 rounded-xl border border-white/30 p-[8px]">
        <summary className="cursor-pointer py-2 text-sm font-bold">전체 제목 보기</summary>
        <div role="region" aria-label="전체 제목" className="mt-2 whitespace-pre-wrap text-xl font-extrabold">{action.title}</div>
      </details>}
      <p className="mt-2 text-sm leading-6 text-white/90">{action.detail}</p>
      <p className="mt-2 text-[11px] leading-5 text-white/80">저장된 일정과 앱 상태만으로 순서를 정했어요.</p>
    </section>}
    <p className="mt-1 text-xs leading-5 text-gray-600">저장된 기록 기준입니다. 미기록은 미수행으로 단정하지 않습니다.</p>
    <nav aria-label="홈 주요 영역" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold text-[#5146A6]">
      <Link href="#yeoni-chat" className="inline-flex min-h-11 items-center">연이에게 말하기 ↓</Link>
      <Link href="#today-apps" className="inline-flex min-h-11 items-center">앱별 오늘 상태 ↓</Link>
    </nav>
  </section>;
}
