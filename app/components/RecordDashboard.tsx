import { RecordStores } from "../data/recordStorage";
import {
  formatShortDate,
  getBodyTrends,
  getBodyPartSetBreakdown,
  getExerciseProgress,
  getMonthlyWorkoutStats,
  getPainTrend,
  getRecentConditionSummary,
  getWeeklyActivity,
} from "../data/recordAnalytics";
import { CONDITION_SIGNAL_OPTIONS } from "../data/recoveryMode";
import RecordTrendChart from "./RecordTrendChart";
import FitnessAiCoachPanel from "./FitnessAiCoachPanel";
import { getBodyMetricSeries, getWholeMuscleTrend, latestBodyMeasurementDate, type ComparableBodyMetric } from '../data/bodyMetricComparison';

const CONDITION_LABEL_BY_ID = Object.fromEntries(
  CONDITION_SIGNAL_OPTIONS.map((item) => [item.id, item.label]),
);

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

function metricStatus(series: ReturnType<typeof getBodyMetricSeries>) {
  if (!series.points.length) return {note: '기록 없음', detail: '이 항목의 유효한 측정값이 없습니다. 빈칸을 0으로 채우지 않아요.'};
  if (series.points.length < 2) return {note: '비교 자료 부족', detail: '비교할 수 있는 기록이 1회뿐입니다. 다른 출처의 기록은 합치지 않아요.'};
  if (!series.sourceVerified) return {note: '출처 확인 필요', detail: '기기나 원문 단위가 확인되지 않았습니다. 표시된 숫자 차이만 참고해 주세요.'};
  if (series.note.includes('출처가 바뀐')) return {note: '출처가 다른 기록 제외', detail: '이전 출처와 다른 기록은 연결하지 않고 마지막 출처의 기록만 표시합니다.'};
  return {};
}

export default function RecordDashboard({
  stores,
  year,
  monthIndex,
  view = "all",
}: {
  stores: RecordStores;
  year: number;
  monthIndex: number;
  view?: "all" | "summary" | "body" | "workout";
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
  const latestBodyDate = latestBodyMeasurementDate(stores.inbody);
  const muscleTrend = getWholeMuscleTrend(stores.inbody);
  const pain = getPainTrend(stores.workouts);
  const progress = getExerciseProgress(stores.workouts);
  const bodyPartSets = getBodyPartSetBreakdown(stores.workouts, year, monthIndex);
  const maxBodyPartSets = Math.max(1, ...bodyPartSets.map((item) => item.sets));
  const condition = getRecentConditionSummary(stores.conditions);
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
      {(view === "all" || view === "workout") && <FitnessAiCoachPanel stores={stores} />}
      {(view === "all" || view === "summary") && <>
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
            {view === "summary" ? "체중관리·운동기록의 달력에서 월을 바꿀 수 있어요." : "달력을 이동하면 월간 지표도 함께 바뀝니다."}
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

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="text-[12px] text-gray-500">최근 체중</p>
        <p className="mt-1 text-[20px] font-extrabold text-gray-900">{body.weight.at(-1)?.value !== undefined ? `${body.weight.at(-1)!.value}kg` : "기록 없음"}</p>
        {body.weight.at(-1) && <p className="mt-1 text-[11px] text-gray-500">{formatShortDate(body.weight.at(-1)!.dateKey)}</p>}
      </div>
      </>}
      {(view === "all" || view === "workout") && <>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
          <p className="text-[15px] font-bold text-gray-800">이번 달 실제 운동량</p>
          <p className="mt-1 text-[11px] text-gray-500">완료한 세트의 실제 입력값만 계산합니다.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              ["완료 세트", `${monthly.completedSets}세트`],
              ["총 반복", `${monthly.totalReps.toLocaleString()}회`],
              ["중량 볼륨", monthly.volumeKg ? `${monthly.volumeKg.toLocaleString()}kg` : "기록 없음"],
              ["수행 운동", `${monthly.activeExerciseCount}종`],
            ].map(([label, value]) => <div key={label} className="rounded-xl bg-[#F7F6FF] p-3"><p className="text-[10px] font-semibold text-gray-500">{label}</p><p className="mt-1 text-[16px] font-extrabold text-gray-900">{value}</p></div>)}
          </div>
          <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[10px] leading-4 text-gray-500">중량 볼륨은 중량 × 실제 반복 횟수입니다. 맨몸·밴드 운동은 세트와 반복에만 포함됩니다.</p>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
          <p className="text-[15px] font-bold text-gray-800">부위별 완료 세트</p>
          <p className="mt-1 text-[11px] text-gray-500">운동 이름과 완료된 실제 세트를 기준으로 분류합니다.</p>
          {bodyPartSets.length ? <div className="mt-4 space-y-3">{bodyPartSets.map((item) => <div key={item.bodyPart}><div className="flex items-center justify-between text-[11px]"><span className="font-bold text-gray-700">{item.bodyPart}</span><span className="font-extrabold text-[#534AB7]">{item.sets}세트</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-[#766EE5]" style={{ width: `${Math.max(8, item.sets / maxBodyPartSets * 100)}%` }} /></div></div>)}</div> : <p className="mt-4 rounded-xl bg-gray-50 p-3 text-[12px] text-gray-400">세트별 완료 기록이 쌓이면 표시됩니다.</p>}
        </section>
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[15px] font-bold text-gray-800">
              최근 7일 운동 전 컨디션
            </p>
            <p className="mt-1 text-[11px] text-gray-500">
              저장한 30초 체크만 집계하며 미기록일은 정상으로 계산하지 않습니다.
            </p>
          </div>
          <p className="text-[12px] font-bold text-[#534AB7]">
            기록 {condition.recordedDays}/7일
          </p>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            {
              label: "정상",
              value: condition.normalDays,
              tone: "bg-emerald-50 text-emerald-800",
            },
            {
              label: "70% 조절",
              value: condition.adjustedDays,
              tone: "bg-amber-50 text-amber-900",
            },
            {
              label: "회복 우선",
              value: condition.recoveryDays,
              tone: "bg-red-50 text-red-800",
            },
          ].map((item) => (
            <div key={item.label} className={`rounded-2xl p-3 ${item.tone}`}>
              <p className="text-[10px] font-semibold opacity-70">
                {item.label}
              </p>
              <p className="mt-1 text-[18px] font-extrabold">{item.value}일</p>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
          {condition.topSignals.length
            ? `자주 기록된 상태: ${condition.topSignals
                .map(
                  (item) =>
                    `${CONDITION_LABEL_BY_ID[item.signal] ?? item.signal} ${item.count}회`,
                )
                .join(" · ")}`
            : "최근 7일에 선택한 불편 증상이 없습니다."}
        </div>
      </section>

      </>}
      {(view === "all" || view === "body" || view === "workout") && (
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <div>
          <p className="text-[15px] font-bold text-gray-800">
            {view === "workout" ? "운동 통증 변화" : view === "body" ? "체성분 변화" : "체성분·통증 변화"}
          </p>
          <p className="mt-1 text-[11px] text-gray-500">
            최근 12회 기록을 기준으로 변화 방향을 확인합니다.
          </p>
        </div>
        {view !== "workout" && <>
          <p className="mt-2 text-[11px] text-gray-500">기기 추정치 · 참고용 · 실제 근손실을 뜻하지 않아요.</p>
          <details data-testid="body-analysis-criteria" className="mt-2 rounded-xl border border-gray-100 p-3 text-[12px] text-gray-600">
            <summary className="cursor-pointer font-semibold focus-visible:outline focus-visible:outline-2">분석 기준 ⓘ</summary>
            <div className="mt-3 space-y-2 leading-5">
              <p>지표·기기 출처 표기·원문 단위가 같은 기록만 연결해요. 출처가 없으면 숫자 차이만 참고해 주세요. 같은 기기 표기가 같은 측정 조건을 뜻하지는 않아요.</p>
              <p>측정 조건 미확인: 수분·식사·측정 시간에 따라 값이 달라질 수 있어요. 근육률은 체중·지방 변화로도 오를 수 있으므로 kg와 함께 봐요.</p>
              <p>{muscleTrend.criteria}</p>
              {(body.bodyFat.length >= 2 && body.bodyFat.at(-1)?.dateKey === latestBodyDate || body.skeletalMuscle.length >= 2 && body.skeletalMuscle.at(-1)?.dateKey === latestBodyDate) && <div data-testid="body-display-thresholds">
                <p>체중관리 카드의 ‘유지’는 앱의 수치 표시 기준이며 의학적 판정이 아닙니다. 그래프의 첫 값·끝 값 차이와 달리 최근 두 기록을 비교합니다.</p>
                {body.bodyFat.length >= 2 && body.bodyFat.at(-1)?.dateKey === latestBodyDate && <p>체지방률: 차이의 절댓값이 0.3%p 미만이면 ‘유지’, 0.3%p 이상이면 증가·감소로 표시합니다.</p>}
                {body.skeletalMuscle.length >= 2 && body.skeletalMuscle.at(-1)?.dateKey === latestBodyDate && <p>골격근량: 차이의 절댓값이 0.2kg 미만이면 ‘유지’, 0.2kg 이상이면 증가·감소로 표시합니다.</p>}
              </div>}
            </div>
          </details>
        </>}
        {view !== "workout" && <section aria-label="전체 근육량과 근육률 추세" className="mt-4 rounded-xl bg-[#F7F6FF] p-4">
          <h3 className="text-[13px] font-bold">전체 근육량 추정치와 근육률</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[{name: '전체 근육량', item: muscleTrend.kg}, {name: '근육률', item: muscleTrend.rate}].map(({name, item}) => {
              return <div key={name} className="rounded-lg bg-white p-3 text-[12px]">
                <p className="font-semibold">{name} · {item.label}</p>
                <p>{item.last ? item.last.value.toFixed(1) + (item.unit === 'kg' ? 'kg' : '%') : '미제공'}{item.delta !== undefined && <> · 차이 {item.delta > 0 ? '+' : ''}{item.delta.toFixed(1)}{item.unit}</>}</p>
                {item.last && <p className="mt-1 text-[11px] text-gray-600">{item.first?.dateKey} ~ {item.last.dateKey} · {item.points.length}회</p>}
              </div>;
            })}
          </div>
          {(muscleTrend.divergent || !muscleTrend.paired) && <div className="mt-3 text-[12px]"><p>{muscleTrend.divergent ? 'kg와 %의 방향이 달라요' : '함께 비교할 자료 부족'}</p><details className="mt-1"><summary className="cursor-pointer focus-visible:outline focus-visible:outline-2">상세 보기</summary><p className="mt-2 leading-5">{muscleTrend.explanation}</p></details></div>}
          {muscleTrend.historical && <p className="mt-1 text-[11px]">전체 근육량은 가장 최근 체성분 기록에 없는 과거 수치입니다.</p>}
        </section>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {view !== "workout" && <>
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
            {...metricStatus(getBodyMetricSeries(stores.inbody, 'bodyFatPercent'))} changeUnit="%p"
            color="#D85A30"
          />
          <RecordTrendChart
            title="골격근량"
            unit="kg"
            points={body.skeletalMuscle}
            {...metricStatus(getBodyMetricSeries(stores.inbody, 'skeletalMuscleMass'))} detail={(metricStatus(getBodyMetricSeries(stores.inbody, 'skeletalMuscleMass')).detail || '') + ' OA 보고서는 골격근량을 제공하지 않아요. 전체·몸통 근육량으로 대신하지 않습니다. 기존 골격근량은 표시된 측정 날짜의 기록입니다.'}
            color="#1D9A6C"
          />
          {([
            ['muscleMass', '전체 근육량 (원문: 근육량)'], ['musclePercent', '근육률 (원문: 근육률)'], ['fatMass', '전체 지방량 (원문: 지방량)'],
            ['trunkMuscleMass', '몸통 근육량 (원문: 신체 근육량)'], ['trunkFatMass', '몸통 지방량 (원문: 체지방량)'],
          ] as [ComparableBodyMetric, string][]).map(([key, title]) => {
            const series = getBodyMetricSeries(stores.inbody, key);
            return <RecordTrendChart key={key} title={title} unit={key === 'musclePercent' ? '%' : 'kg'} changeUnit={key === 'musclePercent' ? '%p' : 'kg'} points={series.points} color="#1D9A6C" {...metricStatus(series)} />;
          })}
          </>}
          {view !== "body" && <RecordTrendChart
            title="운동 불편감"
            unit="/10"
            points={pain}
            color="#C43D4B"
          />}
        </div>
      </section>
      )}
    </section>
  );
}
