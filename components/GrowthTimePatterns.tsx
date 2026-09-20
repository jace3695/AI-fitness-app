import type { GrowthSessionRow } from '@/app/data/growthPlatform';
import { summarizeGrowthTimePatterns } from '@/app/data/growthTimePatterns';

const statusLabels = { completed: '완료', partial: '진행', stopped: '중단' };

export default function GrowthTimePatterns({ sessions, routineId, days }: {
  sessions: GrowthSessionRow[]; routineId: string; days: { date: string; status: GrowthSessionRow['status'] }[];
}) {
  const pattern = summarizeGrowthTimePatterns(sessions, routineId, days);
  return <section aria-label="루틴 시작 시간대별 패턴" className="mt-5 border-t border-gray-100 pt-5">
    <h3 className="text-lg font-bold">어느 시간대에 시작했을까요?</h3>
    <p className="mt-2 text-sm leading-6 text-gray-600">한국 시간 기준이에요. 실제 시작 시각이 있는 기록만 비교하며, 저장한 시각으로 대신 계산하지 않아요.</p>
    {!days.length ? <p className="mt-3 text-sm text-gray-500">이 기간에는 비교할 루틴 기록이 없어요.</p> : <>
      <p className="mt-3 text-sm font-bold">시간대 확인 {pattern.recorded}일 · 비교 제외 {pattern.unconfirmed}일</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {pattern.groups.map(group => <div key={group.label} role="group" aria-label={`${group.label} 시작`} className="rounded-xl bg-violet-50 p-3 text-sm">
          <h4 className="font-bold">{group.label} <span className="font-normal">{group.range}</span></h4>
          <p className="mt-1">완료 {group.completed}일 / 기록 {group.recorded}일</p>
          <p className="mt-1 text-xs">진행 {group.partial}일 · 중단 {group.stopped}일</p>
        </div>)}
      </div>
      <p className="mt-3 rounded-xl bg-gray-50 p-3 text-sm leading-6">{pattern.suggestion}</p>
      <p className="mt-2 text-xs leading-5 text-gray-500">각각 4일 이상 기록된 시간대끼리 비교해요. 시간대가 결과의 원인이라는 뜻은 아니며, 목표와 일정은 자동으로 바꾸지 않아요.</p>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">시간대별 근거 보기</summary>
        <p className="mb-2 text-xs leading-5 text-gray-500">같은 날은 완료 → 진행 → 중단 순으로 하루 집계해요. 그 상태의 기록에 시각이 없거나 여러 시간대가 섞이면 제외해요. 한국 시간의 시작 날짜가 기록 날짜와 다른 경우도 제외하며, 과거 여행지의 시간대는 추정하지 않아요.</p>
        <table className="w-full table-fixed text-center text-xs">
          <caption className="pb-2 text-left text-gray-500">기록일별 시작 시간대와 제외 이유</caption>
          <thead><tr><th scope="col">기록일</th><th scope="col">시작 시간대</th><th scope="col">루틴</th></tr></thead>
          <tbody>{pattern.evidence.map(day => <tr key={day.date} className="border-t border-gray-100">
            <th scope="row" className="py-2 font-normal">{day.date}</th><td className="break-words py-2">{day.slot ?? day.reason}{day.clock && <span className="block text-gray-500">{day.clock}</span>}</td><td>{statusLabels[day.status]}</td>
          </tr>)}</tbody>
        </table>
      </details>
    </>}
  </section>;
}
