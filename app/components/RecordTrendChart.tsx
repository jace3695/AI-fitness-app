import { TrendPoint, formatShortDate } from "../data/recordAnalytics";

function formatValue(value: number, digits: number) {
  return value.toFixed(digits);
}

export default function RecordTrendChart({
  title,
  unit,
  points,
  color,
  digits = 1,
  note,
  detail,
  changeUnit = unit,
}: {
  title: string;
  unit: string;
  points: TrendPoint[];
  color: string;
  digits?: number;
  note?: string;
  detail?: string;
  changeUnit?: string;
}) {
  const latest = points.at(-1);
  const first = points[0];
  const change =
    latest && first && points.length > 1 ? latest.value - first.value : null;

  if (!latest) {
    return (
      <section data-trend-chart={title} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <p className="text-[12px] font-bold text-gray-700">{title}</p>
        <p className="mt-3 text-[12px] text-gray-400">{note || '기록이 아직 없습니다.'}</p>
        {detail && <details className="mt-2 text-[11px] text-gray-500"><summary className="cursor-pointer focus-visible:outline focus-visible:outline-2">상세 보기</summary><p className="mt-2 leading-5">{detail}</p></details>}
      </section>
    );
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? 50 : 6 + (index * 88) / (points.length - 1),
    y: 72 - ((point.value - min) / range) * 48,
  }));

  return (
    <section data-trend-chart={title} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-bold text-gray-700">{title}</p>
          <p className="mt-1 text-[20px] font-extrabold text-gray-900">
            {formatValue(latest.value, digits)}
            <span className="ml-1 text-[11px] font-semibold text-gray-400">
              {unit}
            </span>
          </p>
        </div>
        {change !== null ? (
          <span
            className="rounded-full bg-white px-2 py-1 text-[11px] font-bold"
            style={{ color }}
          >
            {change > 0 ? "+" : ""}
            {formatValue(change, digits)}
            {changeUnit}
          </span>
        ) : null}
      </div>
      <svg
        viewBox="0 0 100 86"
        role="img"
        aria-label={`${title} 최근 ${points.length}회 변화`}
        className="mt-2 h-28 w-full overflow-visible"
      >
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={coordinates.map((point) => `${point.x},${point.y}`).join(" ")}
        />
        {coordinates.map((point, index) => (
          <g key={`${point.dateKey}-${index}`}>
            <circle cx={point.x} cy={point.y} r="2.8" fill={color} />
            {(index === 0 || index === coordinates.length - 1) && (
              <text
                x={point.x}
                y="84"
                textAnchor={index === 0 ? "start" : "end"}
                className="fill-gray-400 text-[5px]"
              >
                {formatShortDate(point.dateKey)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <p className="mt-1 text-[10px] text-gray-400">
        {first.dateKey} ~ {latest.dateKey} · {points.length}회
      </p>
      {note && <p className="mt-2 text-[11px] text-gray-500">{note}</p>}
      {detail && <details className="mt-1 text-[11px] text-gray-500"><summary className="cursor-pointer focus-visible:outline focus-visible:outline-2">상세 보기</summary><p className="mt-2 leading-5">{detail}</p></details>}
    </section>
  );
}
