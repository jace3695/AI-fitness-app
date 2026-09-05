import { isWorkoutDone } from '../data/workoutCompletion';
import { RecordStores, getMonthDateKeys, isDietSuccess } from '../data/recordStorage';
import { getWeightManagementSummary } from '../data/weightManagement';

export default function MonthlySummaryCard({ year, monthIndex, stores }: { year: number; monthIndex: number; stores: RecordStores }) {
  const keys = getMonthDateKeys(year, monthIndex);
  const monthWeights = Object.entries(stores.weights).filter(([key]) => keys.includes(key)).sort(([a], [b]) => a.localeCompare(b));
  const latestMonthWeightDate = monthWeights.at(-1)?.[0];
  const weightSummary = latestMonthWeightDate
    ? getWeightManagementSummary(
        stores.weights,
        {},
        stores.weightGoal,
        latestMonthWeightDate,
      )
    : getWeightManagementSummary({}, {}, stores.weightGoal);
  const items = [
    ['운동 완료', `${keys.filter((key) => isWorkoutDone(stores.workouts[key])).length}회`],
    ['식단 성공일', `${keys.filter((key) => isDietSuccess(stores.diet[key])).length}일`],
    ['물 2L 달성', `${keys.filter((key) => (stores.water[key] || 0) >= 2000).length}일`],
    ['체중 기록', `${monthWeights.length}회`],
    ['인바디 기록', `${keys.filter((key) => stores.inbody[key]).length}회`],
    ['컨디션 기록', `${keys.filter((key) => stores.conditions[key]).length}일`],
    ['70% 조절', `${keys.filter((key) => stores.conditions[key]?.recommendation === '70%').length}일`],
    ['회복 우선', `${keys.filter((key) => stores.conditions[key]?.recommendation === 'recovery').length}일`],
    ['최근 7일 평균', weightSummary.sevenDayAverage === undefined ? '기록 없음' : `${weightSummary.sevenDayAverage.toFixed(1)}kg (${weightSummary.sevenDaySampleCount}회)`],
    ['이전 7일 대비', weightSummary.weeklyChange === undefined ? '비교 기록 부족' : `${weightSummary.weeklyChange > 0 ? '+' : ''}${weightSummary.weeklyChange.toFixed(1)}kg`],
  ];
  return <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm"><p className="text-[15px] font-bold text-gray-800">월간 요약</p><div className="mt-3 grid grid-cols-2 gap-2">{items.map(([label, value]) => <div key={label} className="rounded-xl bg-gray-50 p-3"><p className="text-[11px] text-gray-500">{label}</p><p className="mt-1 text-[14px] font-bold text-gray-800">{value}</p></div>)}</div></section>;
}
