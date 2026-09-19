import { dietPatterns, DIET_COMPARISON_MIN_DAYS } from '../data/dietPatterns';
import { DIGESTION_LABELS } from '../data/freeDietTools';

export default function DietPatterns({ store, today }: { store: Record<string, unknown>; today: string }) {
  const comparison = dietPatterns(store, today);
  if (!comparison) return null;
  const change = (delta: number | null) => delta === null
    ? `각 기간에 응답 ${DIET_COMPARISON_MIN_DAYS}일 이상이면 차이를 표시합니다.`
    : delta === 0 ? '응답일 비율 차이 0%p (반올림 기준)' : `이전 기간보다 응답일 비율 ${Math.abs(delta)}%p ${delta > 0 ? '높음' : '낮음'}`;
  return <section aria-label="28일 식단 기록 비교" className="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
    <h3 className="text-[15px] font-bold text-gray-900">28일 식단 기록 비교</h3>
    <p className="mt-2 text-xs leading-5 text-gray-500">한국 날짜로 어제까지 비교합니다. 오늘 입력과 미응답은 제외하며, 저장한 응답의 차이만 보여줍니다.</p>
    <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      {([{ label: '최근 28일', data: comparison.current }, { label: '이전 28일', data: comparison.previous }]).map(({ label, data }) => <article key={label} aria-label={label} className="min-w-0 rounded-xl bg-gray-50 p-3">
        <h4 className="text-sm font-bold">{label}</h4>
        <p className="mt-1 text-xs leading-5 text-gray-500">{data.start} ~ {data.end}</p>
        <ul className="mt-2 space-y-2 text-xs leading-5 text-gray-700">
          <li>소화 불편 {data.digestion.count}일 / 응답 {data.digestion.answers}일{data.digestion.rate === null ? ' · 비율 미기록' : ` · ${data.digestion.rate}%`}</li>
          <li>야식 {data.lateSnack.count}일 / 응답 {data.lateSnack.answers}일{data.lateSnack.rate === null ? ' · 비율 미기록' : ` · ${data.lateSnack.rate}%`}</li>
        </ul>
        <details className="mt-3 text-xs leading-5">
          <summary className="min-h-11 cursor-pointer py-3 font-bold">{label} 날짜별 근거</summary>
          {data.days.length ? <ul className="space-y-2">{data.days.map(day => <li key={day.date} className="break-words">{day.date} · 소화 {DIGESTION_LABELS[day.digestion]} · 야식 {day.lateSnack === 'yes' ? '예' : day.lateSnack === 'no' ? '아니요' : '미기록'}</li>)}</ul> : <p>이 기간에 저장된 식단 기록이 없습니다.</p>}
        </details>
      </article>)}
    </div>
    <ul className="mt-3 space-y-2 text-xs leading-5 text-gray-700">
      <li>소화 불편: {change(comparison.digestionDelta)}</li>
      <li>야식: {change(comparison.lateSnackDelta)}</li>
    </ul>
    <p className="mt-3 text-xs leading-5 text-gray-500">기록하지 않은 날의 상태는 알 수 없습니다. 응답한 날짜가 서로 달라 이 비교만으로 원인이나 건강 상태를 판단할 수 없습니다.</p>
  </section>;
}
