"use client";

import { FormEvent, useState } from "react";
import type {
  InbodyRecordStore,
  WeightGoal,
  WeightRecordStore,
} from "../data/recordStorage";
import {
  getRollingWeightAverages,
  getWeightManagementSummary,
  type ChangeDirection,
  type MetricChange,
} from "../data/weightManagement";

interface Props {
  weights: WeightRecordStore;
  inbody: InbodyRecordStore;
  goal: WeightGoal;
  year: number;
  monthIndex: number;
  cutoffDateKey: string;
  onGoalChange: (goal: WeightGoal) => void;
}

function signed(value: number, unit: string) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}${unit}`;
}

function directionLabel(direction: ChangeDirection) {
  if (direction === "down") return "감소";
  if (direction === "up") return "증가";
  if (direction === "stable") return "유지";
  return "비교 부족";
}

function metricLabel(metric: MetricChange, unit: string) {
  if (metric.change === undefined) return "비교 기록 부족";
  return `${signed(metric.change, unit)} · ${directionLabel(metric.direction)}`;
}

const assessmentTone = {
  positive: "border-emerald-200 bg-emerald-50 text-emerald-900",
  neutral: "border-blue-200 bg-blue-50 text-blue-900",
  caution: "border-amber-200 bg-amber-50 text-amber-900",
  insufficient: "border-gray-200 bg-gray-50 text-gray-700",
} as const;

export default function WeightChart({
  weights,
  inbody,
  goal,
  year,
  monthIndex,
  cutoffDateKey,
  onGoalChange,
}: Props) {
  const [minimumDraft, setMinimumDraft] = useState(String(goal.minKg));
  const [maximumDraft, setMaximumDraft] = useState(String(goal.maxKg));
  const [goalMessage, setGoalMessage] = useState("");

  const summary = getWeightManagementSummary(
    weights,
    inbody,
    goal,
    cutoffDateKey,
  );
  const rollingAverageByDate = new Map(
    getRollingWeightAverages(weights, 7, cutoffDateKey).map((point) => [
      point.dateKey,
      point,
    ]),
  );
  const points = Object.entries(weights)
    .filter(([dateKey, record]) => {
      const [pointYear, pointMonth] = dateKey.split("-").map(Number);
      return (
        pointYear === year &&
        pointMonth === monthIndex + 1 &&
        dateKey <= cutoffDateKey &&
        Number.isFinite(record.weight) &&
        record.weight > 0
      );
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, record]) => {
      const rollingAverage = rollingAverageByDate.get(dateKey);
      return {
        dateKey,
        weight: record.weight,
        average:
          rollingAverage && rollingAverage.sampleCount >= 2
            ? rollingAverage.value
            : undefined,
      };
    });
  const chartValues = points.flatMap((point) => [
    point.weight,
    ...(point.average === undefined ? [] : [point.average]),
  ]);
  const rawMin = chartValues.length ? Math.min(...chartValues) : 0;
  const rawMax = chartValues.length ? Math.max(...chartValues) : 0;
  const range = Math.max(1, rawMax - rawMin);
  const min = rawMin - (range - (rawMax - rawMin)) / 2;
  const lastDate = new Date(year, monthIndex + 1, 0).getDate();
  const coordinates = points.map((point) => {
    const date = Number(point.dateKey.slice(8));
    const x = 8 + ((date - 1) * 84) / Math.max(1, lastDate - 1);
    return {
      ...point,
      x,
      weightY: 78 - ((point.weight - min) / range) * 58,
      averageY:
        point.average === undefined
          ? undefined
          : 78 - ((point.average - min) / range) * 58,
    };
  });
  const averageCoordinates = coordinates.filter(
    (point): point is typeof point & { average: number; averageY: number } =>
      point.average !== undefined && point.averageY !== undefined,
  );
  const progress = summary.goal.progressPercent;

  const saveGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const minKg = Math.round(Number(minimumDraft) * 10) / 10;
    const maxKg = Math.round(Number(maximumDraft) * 10) / 10;
    if (
      !Number.isFinite(minKg) ||
      !Number.isFinite(maxKg) ||
      minKg < 30 ||
      maxKg > 250 ||
      minKg > maxKg
    ) {
      setGoalMessage("최소 목표는 최대 목표보다 작게, 30~250kg 안에서 입력해주세요.");
      return;
    }
    onGoalChange({ minKg, maxKg });
    setGoalMessage(`목표를 ${minKg.toFixed(1)}~${maxKg.toFixed(1)}kg로 저장했습니다.`);
  };

  const remainingText =
    summary.goal.state === "within"
      ? "목표 범위 도달"
      : summary.goal.state === "above" && summary.goal.remainingKg !== undefined
        ? `${summary.goal.remainingKg.toFixed(1)}kg 남음`
        : summary.goal.state === "below" && summary.goal.remainingKg !== undefined
          ? `목표 하한보다 ${summary.goal.remainingKg.toFixed(1)}kg 낮음`
          : "체중 기록 필요";

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5 xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold text-[#534AB7]">체중관리</p>
          <h2 className="mt-1 text-[19px] font-extrabold text-gray-900">
            체중·체지방·골격근을 함께 봐요
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-gray-500">
            하루 수치보다 7일 평균과 같은 조건의 인바디 변화를 우선합니다.
          </p>
        </div>
        <span className="rounded-full bg-[#EEEDFE] px-3 py-1.5 text-[12px] font-bold text-[#3C3489]">
          목표 {goal.minKg.toFixed(1)}~{goal.maxKg.toFixed(1)}kg
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-gray-50 p-3">
          <p className="text-[11px] font-semibold text-gray-500">최근 체중</p>
          <p className="mt-1 text-[19px] font-extrabold text-gray-900">
            {summary.latest ? `${summary.latest.value.toFixed(1)}kg` : "기록 없음"}
          </p>
          <p className="mt-1 text-[10px] text-gray-400">
            {summary.latest?.dateKey ?? "이미지 또는 직접 입력"}
          </p>
        </div>
        <div className="rounded-2xl bg-[#F7F6FF] p-3">
          <p className="text-[11px] font-semibold text-gray-500">최근 7일 평균</p>
          <p className="mt-1 text-[19px] font-extrabold text-gray-900">
            {summary.sevenDayAverage !== undefined
              ? `${summary.sevenDayAverage.toFixed(1)}kg`
              : "기록 없음"}
          </p>
          <p className="mt-1 text-[10px] text-gray-400">
            최근 {summary.sevenDaySampleCount}회 측정 평균
          </p>
        </div>
        <div className="rounded-2xl bg-blue-50 p-3">
          <p className="text-[11px] font-semibold text-blue-700">이전 7일 대비</p>
          <p className="mt-1 text-[19px] font-extrabold text-blue-950">
            {summary.weeklyChange === undefined
              ? "비교 부족"
              : signed(summary.weeklyChange, "kg")}
          </p>
          <p className="mt-1 text-[10px] text-blue-600">
            두 기간 모두 2회 이상 기록 시 비교
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-3">
          <p className="text-[11px] font-semibold text-emerald-700">목표까지</p>
          <p className="mt-1 text-[17px] font-extrabold text-emerald-950">
            {remainingText}
          </p>
          <p className="mt-1 text-[10px] text-emerald-700">7일 평균 기준</p>
        </div>
      </div>

      {progress !== undefined && (
        <div className="mt-3 rounded-2xl border border-emerald-100 bg-white p-3">
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <span className="font-bold text-gray-700">시작 기록부터 목표 진행률</span>
            <span className="font-extrabold text-emerald-700">
              {Math.round(progress)}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="목표 체중 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-100"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width]"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
          <p className="mt-2 text-[10px] text-gray-400">
            시작 {summary.start?.value.toFixed(1)}kg · 현재는 최근 7일 평균 기준
          </p>
        </div>
      )}

      <div
        className={`mt-3 rounded-2xl border p-4 ${assessmentTone[summary.assessment.tone]}`}
      >
        <p className="text-[14px] font-extrabold">{summary.assessment.title}</p>
        <p className="mt-1 text-[12px] leading-5 opacity-80">
          {summary.assessment.description}
        </p>
        <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-3">
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <span className="font-semibold opacity-70">체중 평균</span>
            <b className="mt-0.5 block">
              {summary.weeklyChange === undefined
                ? "비교 기록 부족"
                : `${signed(summary.weeklyChange, "kg")} · ${directionLabel(summary.weeklyDirection)}`}
            </b>
          </div>
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <span className="font-semibold opacity-70">체지방률</span>
            <b className="mt-0.5 block">{metricLabel(summary.bodyFat, "%p")}</b>
          </div>
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <span className="font-semibold opacity-70">골격근량</span>
            <b className="mt-0.5 block">
              {metricLabel(summary.skeletalMuscle, "kg")}
            </b>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[14px] font-bold text-gray-800">
              {year}년 {monthIndex + 1}월 체중 흐름
            </p>
            <p className="mt-1 text-[11px] text-gray-500">
              회색은 실제 측정값, 보라색은 최근 7일 평균입니다.
            </p>
          </div>
          <div className="flex gap-3 text-[10px] font-semibold text-gray-500">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="h-0.5 w-4 bg-gray-400" /> 실제
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="h-0.5 w-4 bg-[#534AB7]" /> 7일 평균
            </span>
          </div>
        </div>
        {coordinates.length >= 2 ? (
          <svg
            viewBox="0 0 100 100"
            role="img"
            aria-label={`${year}년 ${monthIndex + 1}월 실제 체중과 7일 평균 변화`}
            className="mt-3 h-52 w-full overflow-visible"
          >
            <line x1="8" y1="78" x2="92" y2="78" stroke="#E5E7EB" strokeWidth="0.7" />
            <polyline
              fill="none"
              stroke="#9CA3AF"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={coordinates.map((point) => `${point.x},${point.weightY}`).join(" ")}
            />
            {averageCoordinates.length >= 2 && (
              <polyline
                fill="none"
                stroke="#534AB7"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={averageCoordinates
                  .map((point) => `${point.x},${point.averageY}`)
                  .join(" ")}
              />
            )}
            {coordinates.map((point) => (
              <circle
                key={point.dateKey}
                cx={point.x}
                cy={point.weightY}
                r="1.7"
                fill="#9CA3AF"
              />
            ))}
            {averageCoordinates.map((point) => (
              <circle
                key={`average-${point.dateKey}`}
                cx={point.x}
                cy={point.averageY}
                r="2.2"
                fill="#534AB7"
              />
            ))}
            {[coordinates[0], coordinates.at(-1)].map((point, index) =>
              point ? (
                <text
                  key={`date-${point.dateKey}`}
                  x={point.x}
                  y="94"
                  textAnchor={index === 0 ? "start" : "end"}
                  className="fill-gray-500 text-[5px]"
                >
                  {Number(point.dateKey.slice(8))}일
                </text>
              ) : null,
            )}
            {averageCoordinates.at(-1) && (
              <text
                x={averageCoordinates.at(-1)?.x}
                y={(averageCoordinates.at(-1)?.averageY ?? 20) - 5}
                textAnchor="end"
                className="fill-[#3C3489] text-[5px] font-bold"
              >
                평균 {averageCoordinates.at(-1)?.average.toFixed(1)}kg
              </text>
            )}
          </svg>
        ) : (
          <p className="mt-3 rounded-xl bg-white px-3 py-4 text-[12px] text-gray-500">
            이 달의 체중 기록이 2회 이상 쌓이면 실제 수치와 7일 평균을 비교해 보여줍니다.
          </p>
        )}
      </div>

      <details className="mt-3 rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-3 py-3 text-[12px] font-bold text-gray-600">
          목표 체중 바꾸기
        </summary>
        <form
          onSubmit={saveGoal}
          className="grid gap-3 border-t border-gray-100 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <label className="text-[12px] font-semibold text-gray-600">
            목표 최소
            <div className="mt-1 flex items-center rounded-xl border border-gray-200 px-3">
              <input
                type="number"
                min="30"
                max="250"
                step="0.1"
                required
                value={minimumDraft}
                onChange={(event) => {
                  setMinimumDraft(event.target.value);
                  setGoalMessage("");
                }}
                className="min-w-0 flex-1 py-2 text-[14px] outline-none"
              />
              <span className="text-[11px] text-gray-400">kg</span>
            </div>
          </label>
          <label className="text-[12px] font-semibold text-gray-600">
            목표 최대
            <div className="mt-1 flex items-center rounded-xl border border-gray-200 px-3">
              <input
                type="number"
                min="30"
                max="250"
                step="0.1"
                required
                value={maximumDraft}
                onChange={(event) => {
                  setMaximumDraft(event.target.value);
                  setGoalMessage("");
                }}
                className="min-w-0 flex-1 py-2 text-[14px] outline-none"
              />
              <span className="text-[11px] text-gray-400">kg</span>
            </div>
          </label>
          <button
            type="submit"
            className="rounded-xl bg-[#534AB7] px-4 py-2.5 text-[12px] font-bold text-white"
          >
            목표 저장
          </button>
        </form>
        {goalMessage && (
          <p
            role={goalMessage.includes("저장했습니다") ? "status" : "alert"}
            aria-live="polite"
            className={`px-3 pb-3 text-[11px] font-medium ${goalMessage.includes("저장했습니다") ? "text-emerald-700" : "text-red-700"}`}
          >
            {goalMessage}
          </p>
        )}
      </details>
      <p className="mt-3 text-[10px] leading-4 text-gray-400">
        인바디의 작은 변화는 수분·식사·측정 시간에 따라 달라질 수 있어 체지방률 ±0.3%p, 골격근량 ±0.2kg 이내는 유지로 표시합니다.
      </p>
    </section>
  );
}
