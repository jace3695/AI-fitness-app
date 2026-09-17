import { dietWorkoutContext } from '../data/dietWorkoutContext';

export default function DietWorkoutContext({ diet, workout, today }: { diet: unknown; workout: unknown; today: string }) {
  const data = dietWorkoutContext(diet, workout, today);
  return <section aria-label="운동과 식사 기록 함께 보기" className="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
    <h3 className="text-[15px] font-bold text-gray-900">운동과 식사 기록 함께 보기</h3>
    <p className="mt-2 text-xs leading-5 text-gray-500">한국 날짜로 어제까지 28일의 저장 기록입니다. 운동 표시가 없는 날은 휴식으로 판단하지 않습니다.</p>
    {!data ? <p role="alert" className="mt-3 text-xs leading-5 text-amber-700">기록 형식을 확인할 수 없어 집계를 표시하지 않습니다. 동기화 상태를 확인하고 새로고침해 주세요.</p> : <>
      <p className="mt-3 text-sm font-bold">운동 표시 {data.workoutDays}일</p>
      <p className="mt-2 text-xs leading-5">그날의 운동 후 식사 응답: 예 {data.yes}일 · 아니요 {data.no}일 · 미기록 {data.unrecorded}일</p>
      <details className="mt-3 text-xs leading-5">
        <summary className="min-h-11 cursor-pointer py-3 font-bold">운동·식사 날짜별 근거</summary>
        {data.days.length ? <ul className="space-y-3">{data.days.map(day => <li key={day.date} className="break-words rounded-xl bg-gray-50 p-3">
          <p className="font-bold">{day.date}</p>
          <p>운동 {day.workout === null ? '기록 형식 확인 필요' : day.workout ? '표시 있음' : '미확인'}</p>
          <p>운동 후 식사 {day.invalidMeal ? '기록 형식 확인 필요' : day.afterWorkoutMeal === 'yes' ? '예' : day.afterWorkoutMeal === 'no' ? '아니요' : '미기록'}</p>
          <p>마지막 식사 {day.invalidMeal || day.invalidClock ? '기록 형식 확인 필요' : day.lastMealTime ?? '시각 미기록'}</p>
        </li>)}</ul> : <p>이 기간에 저장된 운동·식단 기록이 없습니다.</p>}
      </details>
    </>}
    <p className="mt-3 text-xs leading-5 text-gray-500">마지막 식사와 운동 후 식사 응답은 별개입니다. 실제 운동 시작·종료 시각이 없어 시간 간격이나 식사의 적절성은 계산하지 않습니다.</p>
  </section>;
}
