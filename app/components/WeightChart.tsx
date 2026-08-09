import { WeightRecordStore } from '../data/recordStorage';

export default function WeightChart({ weights, year, monthIndex }: { weights: WeightRecordStore; year: number; monthIndex: number }) {
  const points = Object.entries(weights).filter(([key]) => {
    const [y, m] = key.split('-').map(Number); return y === year && m === monthIndex + 1;
  }).sort(([a], [b]) => a.localeCompare(b));
  if (points.length < 2) return <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm"><p className="text-[15px] font-bold text-gray-800">체중 변화 그래프</p><p className="mt-2 text-[13px] text-gray-500">체중 기록이 2개 이상 쌓이면 변화 그래프가 표시됩니다.</p></section>;
  const values = points.map(([, record]) => record.weight); const min = Math.min(...values); const max = Math.max(...values); const range = Math.max(1, max - min);
  const coords = points.map(([key, record], idx) => ({ key, x: 12 + (idx * 76) / (points.length - 1), y: 88 - ((record.weight - min) / range) * 64, weight: record.weight }));
  return <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm"><p className="text-[15px] font-bold text-gray-800">체중 변화 그래프</p><svg viewBox="0 0 100 112" className="mt-3 h-56 w-full overflow-visible"><polyline fill="none" stroke="#534AB7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={coords.map((p) => `${p.x},${p.y}`).join(' ')} />{coords.map((p) => <g key={p.key}><circle cx={p.x} cy={p.y} r="3" fill="#534AB7" /><text x={p.x} y={p.y - 6} textAnchor="middle" className="fill-gray-700 text-[5px] font-bold">{p.weight.toFixed(1)}</text><text x={p.x} y="104" textAnchor="middle" className="fill-gray-400 text-[5px]">{Number(p.key.slice(8))}일</text></g>)}</svg></section>;
}
