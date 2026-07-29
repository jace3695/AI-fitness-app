import { RecordStores } from "../data/recordStorage";
import {
  formatShortDate,
  getBodyTrends,
  getExerciseProgress,
  getMonthlyWorkoutStats,
  getPainTrend,
  getWeeklyActivity,
} from "../data/recordAnalytics";
import RecordTrendChart from "./RecordTrendChart";

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

export default function RecordDashboard({
  stores,
  year,
  monthIndex,
}: {
  stores: RecordStores;
  year: number;
  monthIndex: number;
}) {
  const monthly = getMonthlyWorkoutStats(
    stores.workouts,
    year,
    monthIndex,
  );
  const weekly = getWeeklyActivity(stores.workouts);
  const maxWeeklyMinutes = Math.max(
    1,
    ...weekly.map((item) => item.minutes),
  );
  const body = getBodyTrends(stores.weights, stores.inbody);
  const pain = getPainTrend(stores.workouts);
  const progress = getExerciseProgress(stores.workouts);
  const currentWeek = weekly.at(-1);
  const previousWeek = weekly.at(-2);
  const weeklyDifference =
    currentWeek && previousWeek
      ? currentWeek.minutes - previousWeek.minutes
      : undefined;
  const summaryItems = [
    {
      label: "이번 달 운동",
      value: `${monthly.workoutDays}일`,
      detail: "일반·유산소·철봉 포함",
    },
    {
      label: "기록된 운동시간",
      value: formatMinutes(monthly.minutes),
      detail: "시간이 저장된 운동만 합산",
    },
    {
      label: "동작 완료율",
      value:
        monthly.completionRate === undefined
          ? "기록 없음"
          : `${monthly.completionRate}%`,
      detail: "완료·부분 완료·건너뜀 기준",
    },
    {
      label: "통증 기록일",
      value: `${monthly.painDays}일`,
      detail:
        monthly.painDays > 0 ? "날짜별 상세에서 확인" : "이번 달 기록 없음",
    },
  ];

  return (
    <section className="space-y-4 xl:col-span-2">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[12px] font-semibold text-[#534AB7]">
              기록·통계 대시보드
            </p>
            <h2 className="mt-1 text-[20px] font-extrabold text-gray-900">
              {year}년 {monthIndex + 1}월 운동 흐름
            </h2>
          </div>
          <p className="text-[11px] text-gray-400">
            달력을 이동하면 월간 지표도 함께 바뀝니다.
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl bg-[#F7F6FF] p-3 sm:p-4"
            >
              <p className="text-[11px] font-semibold text-gray-500">
                {item.label}
              </p>
              <p className="mt-1 text-[18px] font-extrabold text-gray-900">
                {item.value}
              </p>
              <p className="mt-1 text-[10px] leading-4 text-gray-400">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-bold text-gray-800">
                최근 6주 운동시간
              </p>
              <p className="mt-1 text-[11px] text-gray-500">
                실제로 시간이 저장된 운동만 보여줍니다.
              </p>
            </div>
            {currentWeek ? (
              <div className="text-right">
                <p className="text-[18px] font-extrabold text-[#534AB7]">
                  {formatMinutes(currentWeek.minutes)}
                </p>
                <p className="text-[10px] text-gray-400">
                  이번 주 {currentWeek.workoutDays}일
                </p>
              </div>
            ) : null}
          </div>
          <div
            className="mt-5 grid h-44 grid-cols-6 items-end gap-2"
            role="img"
            aria-label="최근 6주 기록된 운동시간 막대그래프"
          >
            {weekly.map((item, index) => {
              const height =
                item.minutes > 0
                  ? Math.max(10, (item.minutes / maxWeeklyMinutes) * 100)
                  : 3;
              const isCurrent = index === weekly.length - 1;
              return (
                <div
                  key={item.startKey}
                  className="flex h-full min-w-0 flex-col justify-end"
                >
                  <p className="mb-1 truncate text-center text-[9px] font-bold text-gray-500">
                    {item.minutes ? `${item.minutes}분` : "-"}
                  </p>
                  <div className="flex h-28 items-end rounded-lg bg-gray-50 px-1.5">
                    <div
                      className={`w-full rounded-t-md ${
                        isCurrent ? "bg-[#534AB7]" : "bg-[#AFA9EC]"
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <p className="mt-1 text-center text-[9px] text-gray-400">
                    {item.label}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
            {weeklyDifference === undefined
              ? "지난주와 비교할 기록이 없습니다."
              : weeklyDifference === 0
                ? "이번 주 기록시간은 지난주와 같습니다."
                : `이번 주는 지난주보다 ${Math.abs(weeklyDifference)}분 ${
                    weeklyDifference > 0 ? "많습니다." : "적습니다."
                  }`}
          </p>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
          <p className="text-[15px] font-bold text-gray-800">운동별 성장</p>
          <p className="mt-1 text-[11px] text-gray-500">
            최근 운동의 중량·시간·횟수를 직전 기록과 비교합니다.
          </p>
          {progress.length ? (
            <div className="mt-4 space-y-2">
              {progress.map((item) => {
                const change =
                  item.previousValue === undefined
                    ? undefined
                    : item.latestValue - item.previousValue;
                return (
                  <div
                    key={item.exerciseName}
                    className="rounded-xl bg-gray-50 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-bold text-gray-800">
                          {item.exerciseName}
                        </p>
                        <p className="mt-0.5 text-[10px] text-gray-400">
                          {item.metricLabel} ·{" "}
                          {formatShortDate(item.latestDateKey)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[13px] font-extrabold text-gray-900">
                          {item.latestValue}
                          {item.unit}
                        </p>
                        <p
                          className={`text-[10px] font-bold ${
                            change === undefined
                              ? "text-gray-400"
                              : change > 0
                                ? "text-green-600"
                                : change < 0
                                  ? "text-amber-600"
                                  : "text-gray-400"
                          }`}
                        >
                          {change === undefined
                            ? "첫 기록"
                            : change === 0
                              ? "직전과 동일"
                              : `직전보다 ${change > 0 ? "+" : ""}${change}${item.unit}`}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-gray-50 p-3 text-[12px] text-gray-400">
              동작별 상세 기록이 1회 이상 쌓이면 표시됩니다.
            </p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <div>
          <p className="text-[15px] font-bold text-gray-800">
            체성분·통증 변화
          </p>
          <p className="mt-1 text-[11px] text-gray-500">
            최근 12회 기록을 기준으로 변화 방향을 확인합니다.
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <RecordTrendChart
            title="체중"
            unit="kg"
            points={body.weight}
            color="#534AB7"
          />
          <RecordTrendChart
            title="체지방률"
            unit="%"
            points={body.bodyFat}
            color="#D85A30"
          />
          <RecordTrendChart
            title="골격근량"
            unit="kg"
            points={body.skeletalMuscle}
            color="#1D9A6C"
          />
          <RecordTrendChart
            title="운동 불편감"
            unit="/10"
            points={pain}
            color="#C43D4B"
          />
        </div>
      </section>
    </section>
  );
}
