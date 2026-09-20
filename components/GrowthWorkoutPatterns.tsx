import { summarizeGrowthWorkoutPatterns } from '@/app/data/growthWorkoutPatterns';
import type { GrowthSessionStatus } from '@/app/data/growthPlatform';

const statusLabels = { completed: '완료', partial: '진행', stopped: '중단' };

export default function GrowthWorkoutPatterns({ days, workoutRecords }: {
  days: { date: string; status: GrowthSessionStatus }[]; workoutRecords: unknown;
}) {
  const pattern = summarizeGrowthWorkoutPatterns(days, workoutRecords);
  return <section aria-label="운동 기록과 루틴 비교" className="mt-5 border-t border-gray-100 pt-5">
    <h3 className="text-lg font-bold">운동 기록이 함께 있는 날은 어땠을까요?</h3>
    <p className="mt-2 text-sm leading-6 text-gray-600">선택한 루틴의 기록일만 비교해요. 본운동·유산소·철봉의 실행 표시를 확인하며, 폼롤러만 기록한 날은 포함하지 않아요.</p>
    <p className="mt-2 text-sm leading-6 text-gray-600">‘운동 기록 미확인’은 운동을 쉬었다는 뜻이 아니에요. 운동 여부나 부담이 루틴 결과의 원인이라고 단정하지 않습니다.</p>
    {!pattern ? <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">운동 기록 형식을 확인하지 못해 비교를 표시하지 않았어요. 기록을 다시 불러오거나 운동 캘린더에서 확인해 주세요.</p> : !days.length ? <p className="mt-3 text-sm text-gray-500">이 기간에는 비교할 루틴 기록이 없어요.</p> : <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {[{ label: '운동 기록 있음', value: pattern.withWorkout }, { label: '운동 기록 미확인', value: pattern.unconfirmed }].map(({ label, value }) => <div key={label} role="group" aria-label={label} className="rounded-xl bg-sky-50 p-3 text-sm">
          <h4 className="font-bold">{label}</h4>
          <p className="mt-1">루틴 완료 {value.completed}일 / 기록 {value.recorded}일</p>
          <p className="mt-1 text-xs">진행 {value.partial}일 · 중단 {value.stopped}일</p>
        </div>)}
      </div>
      <p className="mt-3 rounded-xl bg-gray-50 p-3 text-sm leading-6">{pattern.suggestion}</p>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">날짜별 비교 근거 보기</summary>
        <table className="w-full table-fixed text-center text-xs">
          <caption className="pb-2 text-left text-gray-500">선택한 루틴의 기록일과 같은 날짜의 운동 기록</caption>
          <thead><tr><th scope="col">날짜</th><th scope="col">루틴</th><th scope="col">운동 기록</th></tr></thead>
          <tbody>{pattern.evidence.map(day => <tr key={day.date} className="border-t border-gray-100">
            <th scope="row" className="py-2 font-normal">{day.date}</th><td>{statusLabels[day.status]}</td><td>{day.workoutRecorded ? '있음' : '미확인'}</td>
          </tr>)}</tbody>
        </table>
      </details>
    </>}
  </section>;
}
