"use client";

import { useMemo, useState } from "react";
import { WORKOUT_GROUPS, getWorkoutGroupById } from "../data/workoutGroups";
import { dayIdToKoreanLabel } from "../data/workoutPlans";
import { getWorkoutRecord, WorkoutCompletionStore, WorkoutDayId } from "../data/workoutCompletion";
import { ExerciseTarget, UserWorkoutSettings } from "../data/userWorkoutSettings";

const DAYS: WorkoutDayId[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function numberFrom(text: string | undefined, unit: string) {
  const match = text?.match(new RegExp(`(\\d+)(?:\\s*~\\s*(\\d+))?\\s*${unit}`));
  if (!match) return undefined;
  return match[2] ? Math.round((Number(match[1]) + Number(match[2])) / 2) : Number(match[1]);
}

function getAiTarget(name: string, base: ExerciseTarget, records: WorkoutCompletionStore) {
  const recent = Object.keys(records).sort((a, b) => b.localeCompare(a)).flatMap((date) => {
    const day = getWorkoutRecord(records[date]);
    return day.workoutExerciseRecords?.filter((item) => item.exerciseName === name) || [];
  }).slice(0, 3);
  if (!recent.length) return { target: base, reason: "아직 수행 기록이 없어 현재 주차 계획과 허리 안전 기준을 적용한 시작값입니다." };

  const needsReduction = recent.some((item) => (item.painScore || 0) > 0 || item.status === "partial" || item.status === "skipped");
  const completed = recent.filter((item) => item.status === "completed");
  if (needsReduction) {
    const reduce = (value: number | undefined) => value === undefined ? undefined : Math.max(1, Math.floor(value * 0.8));
    return {
      target: { sets: reduce(base.sets), reps: reduce(base.reps), durationMinutes: reduce(base.durationMinutes) },
      reason: `최근 ${recent.length}회 기록에 통증·부분 완료가 있어 기본 계획의 약 80%로 낮췄습니다.`,
    };
  }
  if (completed.length >= 2) {
    return {
      target: {
        sets: base.sets,
        reps: base.reps === undefined ? undefined : base.reps + 1,
        durationMinutes: base.durationMinutes === undefined ? undefined : base.durationMinutes + 1,
      },
      reason: `최근 ${completed.length}회 연속 완료했고 통증 기록이 없어 횟수 또는 시간을 한 단계만 올렸습니다.`,
    };
  }
  return { target: base, reason: `최근 ${recent.length}회 기록을 확인했습니다. 기록이 더 쌓일 때까지 현재 계획을 유지합니다.` };
}

export default function WorkoutPlanEditor({ settings, defaultGroups, records, onChange }: {
  settings: UserWorkoutSettings;
  defaultGroups: Record<WorkoutDayId, string>;
  records: WorkoutCompletionStore;
  onChange: (settings: UserWorkoutSettings) => void;
}) {
  const [editingDay, setEditingDay] = useState<WorkoutDayId>("mon");
  const groupId = settings.weeklyGroups[editingDay] || defaultGroups[editingDay];
  const group = getWorkoutGroupById(groupId);
  const exercises = group.type === "choice" ? [] : group.exercises;
  const routineGroups = WORKOUT_GROUPS.filter((item) => item.type !== "choice" || editingDay === "sat");
  const changedDays = useMemo(() => DAYS.filter((day) => settings.weeklyGroups[day]), [settings.weeklyGroups]);

  const updateTarget = (name: string, patch: Partial<ExerciseTarget>) => {
    const current = settings.exerciseTargets[name] || {};
    const next = { ...current, ...patch };
    onChange({ ...settings, exerciseTargets: { ...settings.exerciseTargets, [name]: next } });
  };

  return <section className="mb-4 rounded-3xl border border-[#D9D6FF] bg-white p-5 shadow-sm sm:p-6">
    <p className="text-[12px] font-bold text-[#534AB7]">내 운동 설정</p>
    <h2 className="mt-1 text-xl font-bold text-gray-900">요일과 운동량 직접 바꾸기</h2>
    <p className="mt-2 text-sm text-gray-500">AI 기본값은 안전 기준과 현재 계획을 바탕으로 표시됩니다. 실제 적용값은 언제든 직접 바꿀 수 있습니다.</p>

    <div className="mt-5 grid grid-cols-7 gap-1">
      {DAYS.map((day) => <button key={day} type="button" onClick={() => setEditingDay(day)} className={`rounded-xl py-2 text-xs font-bold ${editingDay === day ? "bg-[#534AB7] text-white" : "bg-gray-50 text-gray-500"}`}>{dayIdToKoreanLabel[day].slice(0, 1)}</button>)}
    </div>

    <label className="mt-4 block text-sm font-bold text-gray-700">{dayIdToKoreanLabel[editingDay]} 기본 루틴
      <select value={groupId} onChange={(e) => onChange({ ...settings, weeklyGroups: { ...settings.weeklyGroups, [editingDay]: e.target.value } })} className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-normal">
        {routineGroups.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.duration}</option>)}
      </select>
    </label>
    <div className="mt-2 flex items-center justify-between rounded-xl bg-[#EEEDFE] px-3 py-2 text-xs text-[#3C3489]"><span>변경한 요일: {changedDays.length ? changedDays.map((day) => dayIdToKoreanLabel[day]).join(", ") : "없음"}</span><button type="button" onClick={() => onChange({ ...settings, weeklyGroups: {} })} className="font-bold underline">주간 루틴 초기화</button></div>

    {group.type === "choice" ? <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">선택 유산소의 시간은 운동 화면에서 직접 입력할 수 있습니다.</p> : <div className="mt-5 space-y-3">
      <div><h3 className="font-bold text-gray-900">운동별 내 설정</h3><p className="mt-1 text-xs text-gray-500">비워 두면 AI 기본값이 적용됩니다. 추천값 적용을 누르면 입력칸에 복사됩니다.</p></div>
      {exercises.map((exercise) => {
        const name = exercise.name || exercise.exerciseId;
        const baseAi: ExerciseTarget = { sets: numberFrom(exercise.sets, "세트"), reps: numberFrom(exercise.sets, "회"), durationMinutes: numberFrom(exercise.duration, "분") };
        const recommendation = getAiTarget(name, baseAi, records);
        const ai = recommendation.target;
        const target = settings.exerciseTargets[name] || {};
        const fields = ai.durationMinutes !== undefined ? [{ key: "durationMinutes" as const, label: "시간", suffix: "분", value: target.durationMinutes }] : [
          { key: "reps" as const, label: "횟수", suffix: "회", value: target.reps },
          { key: "sets" as const, label: "세트", suffix: "세트", value: target.sets },
        ];
        return <div key={exercise.exerciseId} className="rounded-2xl border border-gray-100 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-gray-900">{name}</p><p className="mt-1 text-xs text-[#534AB7]">AI 추천: {ai.durationMinutes ? `${ai.durationMinutes}분` : ai.reps ? `${ai.reps}회${ai.sets ? ` × ${ai.sets}세트` : ""}` : exercise.sets || exercise.duration || "통증 없는 범위"}</p></div><button type="button" onClick={() => onChange({ ...settings, exerciseTargets: { ...settings.exerciseTargets, [name]: ai } })} className="shrink-0 rounded-lg bg-[#EEEDFE] px-2.5 py-1.5 text-[11px] font-bold text-[#3C3489]">추천값 적용</button></div>
          <div className="mt-3 grid grid-cols-2 gap-2">{fields.map((field) => <label key={field.key} className="text-xs font-bold text-gray-600">내 {field.label}<span className="mt-1 flex items-center rounded-xl bg-gray-50 px-3"><input type="number" min={1} value={field.value ?? ""} placeholder={String(ai[field.key] ?? "-")} onChange={(e) => updateTarget(name, { [field.key]: e.target.value ? Number(e.target.value) : undefined })} className="min-w-0 flex-1 bg-transparent py-2.5 text-right text-sm outline-none" /><span className="ml-1 font-normal">{field.suffix}</span></span></label>)}</div>
          <p className="mt-2 text-[11px] text-gray-400">추천 이유: {recommendation.reason}</p>
        </div>;
      })}
    </div>}
  </section>;
}
