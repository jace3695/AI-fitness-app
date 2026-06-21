import { RecordStores, getMonthDateKeys, isDietSuccess } from '../data/recordStorage';

export default function MonthlySummaryCard({ year, monthIndex, stores }: { year: number; monthIndex: number; stores: RecordStores }) {
  const keys = getMonthDateKeys(year, monthIndex);
  const monthWeights = Object.entries(stores.weights).filter(([key]) => keys.includes(key)).sort(([a], [b]) => a.localeCompare(b));
  const first = monthWeights[0]?.[1].weight;
  const last = monthWeights[monthWeights.length - 1]?.[1].weight;
  const change = first !== undefined && last !== undefined ? last - first : null;
  const items = [
    ['운동 완료', `${keys.filter((key) => stores.workouts[key]).length}회`],
    ['식단 성공일', `${keys.filter((key) => isDietSuccess(stores.diet[key])).length}일`],
    ['물 2L 달성', `${keys.filter((key) => (stores.water[key] || 0) >= 2000).length}일`],
    ['체중 기록', `${monthWeights.length}회`],
    ['인바디 기록', `${keys.filter((key) => stores.inbody[key]).length}회`],
    ['첫/마지막 체중', first === undefined || last === undefined ? '기록 없음' : `${first.toFixed(1)} → ${last.toFixed(1)}kg`],
    ['체중 변화', change === null ? '기록 없음' : `${change > 0 ? '+' : ''}${change.toFixed(1)}kg`],
  ];
  return <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm"><p className="text-[15px] font-bold text-gray-800">월간 요약</p><div className="mt-3 grid grid-cols-2 gap-2">{items.map(([label, value]) => <div key={label} className="rounded-xl bg-gray-50 p-3"><p className="text-[11px] text-gray-500">{label}</p><p className="mt-1 text-[14px] font-bold text-gray-800">{value}</p></div>)}</div></section>;
}
