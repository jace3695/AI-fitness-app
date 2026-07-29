"use client";

import { useEffect, useState } from "react";
import {
  DIET_COMPLETED_DAYS_KEY,
  FastingRecordStatus,
  getLocalDateKey,
  PROTEIN_TARGET_GRAMS,
  PROTEIN_TOTAL_KEY,
  WATER_INTAKE_KEY,
} from "../data/dietPlans";

interface DietDayRecord {
  fastingRecordStatus?: FastingRecordStatus;
  fasting14h?: boolean;
}

interface TodayDashboardProps {
  workoutDone: boolean;
  workoutPain: boolean;
  recoveryRecommended: boolean;
  recoveryCompleted: boolean;
  onOpenWorkout: () => void;
  onOpenDiet: () => void;
  onOpenRecord: () => void;
}

interface TodayDietSummary {
  protein: number;
  water: number;
  fastingStatus: FastingRecordStatus;
  weeklyFastingCount: number;
}

const EMPTY_SUMMARY: TodayDietSummary = {
  protein: 0,
  water: 0,
  fastingStatus: "unrecorded",
  weeklyFastingCount: 0,
};

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function getMondayKey(date = new Date()) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = monday.getDay() === 0 ? -6 : 1 - monday.getDay();
  monday.setDate(monday.getDate() + offset);
  return getLocalDateKey(monday);
}

function readTodayDietSummary(): TodayDietSummary {
  const todayKey = getLocalDateKey();
  const dietStore = readStore<Record<string, DietDayRecord>>(
    DIET_COMPLETED_DAYS_KEY,
    {},
  );
  const proteinStore = readStore<Record<string, number>>(PROTEIN_TOTAL_KEY, {});
  const waterStore = readStore<Record<string, number>>(WATER_INTAKE_KEY, {});
  const todayDiet = dietStore[todayKey];
  const weekStart = getMondayKey();
  const weeklyFastingCount = Object.entries(dietStore).filter(
    ([dateKey, record]) =>
      dateKey >= weekStart &&
      dateKey <= todayKey &&
      (record.fastingRecordStatus === "14h" || record.fasting14h === true),
  ).length;

  return {
    protein: Math.max(0, Number(proteinStore[todayKey]) || 0),
    water: Math.max(0, Number(waterStore[todayKey]) || 0),
    fastingStatus:
      todayDiet?.fastingRecordStatus ??
      (todayDiet?.fasting14h ? "14h" : "unrecorded"),
    weeklyFastingCount,
  };
}

function statusTone(done: boolean) {
  return done
    ? "border-emerald-100 bg-emerald-50 text-emerald-800"
    : "border-gray-100 bg-white text-gray-800";
}

export default function TodayDashboard({
  workoutDone,
  workoutPain,
  recoveryRecommended,
  recoveryCompleted,
  onOpenWorkout,
  onOpenDiet,
  onOpenRecord,
}: TodayDashboardProps) {
  const [diet, setDiet] = useState<TodayDietSummary>(EMPTY_SUMMARY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setDiet(readTodayDietSummary());
      setHydrated(true);
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const proteinDone = diet.protein >= 110;
  const waterDone = diet.water >= 2000;
  const fastingDone = diet.fastingStatus === "14h";
  const adjustedFasting = diet.fastingStatus === "12h";
  const completedCount = [
    workoutDone || recoveryCompleted,
    proteinDone,
    waterDone,
    fastingDone || adjustedFasting,
  ].filter(Boolean).length;
  const progress = Math.round((completedCount / 4) * 100);

  const items = [
    {
      label: "운동",
      value: recoveryCompleted ? "회복 완료" : workoutDone ? "완료" : recoveryRecommended ? "조절 필요" : "진행 전",
      sub: workoutPain ? "통증 기록 확인 필요" : recoveryRecommended ? "상태 체크 결과 반영" : "오늘 계획 기준",
      done: workoutDone || recoveryCompleted,
      onClick: workoutPain ? onOpenRecord : onOpenWorkout,
    },
    {
      label: "단백질",
      value: hydrated ? `${diet.protein}g` : "불러오는 중",
      sub: `목표 약 ${PROTEIN_TARGET_GRAMS}g`,
      done: proteinDone,
      onClick: onOpenDiet,
    },
    {
      label: "물",
      value: hydrated ? `${diet.water.toLocaleString()}mL` : "불러오는 중",
      sub: "목표 2,000mL",
      done: waterDone,
      onClick: onOpenDiet,
    },
    {
      label: "공복",
      value:
        diet.fastingStatus === "14h"
          ? "14시간 달성"
          : diet.fastingStatus === "12h"
            ? "12시간 조절"
            : diet.fastingStatus === "missed"
              ? "미달성"
              : "미기록",
      sub: `이번 주 ${diet.weeklyFastingCount}/5일`,
      done: fastingDone || adjustedFasting,
      onClick: onOpenDiet,
    },
  ];

  return (
    <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-bold text-[#534AB7]">오늘 체크</p>
          <h3 className="mt-1 text-[18px] font-bold text-gray-900">
            {completedCount}/4 항목 관리
          </h3>
        </div>
        <span className="rounded-full bg-[#EEEDFE] px-3 py-1.5 text-[12px] font-bold text-[#3C3489]">
          {progress}%
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-[#534AB7] transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>

      {(recoveryRecommended || workoutPain) && (
        <button
          type="button"
          onClick={onOpenRecord}
          className="mt-3 w-full rounded-2xl bg-amber-50 px-3 py-2.5 text-left text-[12px] font-semibold leading-relaxed text-amber-900"
        >
          {workoutPain
            ? "통증 기록이 있습니다. 오늘 기록을 확인하고 운동 강도를 낮추세요."
            : "오늘 상태 체크에 따라 운동 강도 조절 또는 회복이 권장됩니다. 운동 화면에서 권장 강도를 확인하세요."}
        </button>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={`rounded-2xl border p-3 text-left transition active:scale-[0.99] ${statusTone(item.done)}`}
          >
            <span className="block text-[11px] opacity-65">{item.label}</span>
            <span className="mt-1 block text-[15px] font-bold">
              {item.value}
            </span>
            <span className="mt-1 block text-[10px] opacity-65">{item.sub}</span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
        14시간 공복은 주 5일 목표이며, 컨디션 저하일의 12시간 조절도 오늘
        관리에 반영됩니다. 24시간 단식은 포함하지 않습니다.
      </p>
    </section>
  );
}
