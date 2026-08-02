"use client";

import { useMemo, useState } from "react";
import { WORKOUT_GROUPS, getWorkoutGroupById } from "../data/workoutGroups";
import { dayIdToKoreanLabel } from "../data/workoutPlans";
import { getDateForWorkoutDay, getWorkoutDayForDate, getWorkoutRecord, WorkoutCompletionStore, WorkoutDayId } from "../data/workoutCompletion";
import { DayRoutineEdit, ExerciseTarget, UserWorkoutSettings } from "../data/userWorkoutSettings";

const DAYS: WorkoutDayId[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
type EditScope = "weekly" | "week" | "today";

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
  const [scope, setScope] = useState<EditScope>("weekly");
  const [moveTarget, setMoveTarget] = useState<WorkoutDayId>("tue");
  const [newExerciseName, setNewExerciseName] = useState("");
  const todayDay = getWorkoutDayForDate() || "mon";
  const effectiveDay = scope === "today" ? todayDay : editingDay;
  const dateKey = getDateForWorkoutDay(effectiveDay);
  const dateOverride = settings.dateOverrides[dateKey];
  const weeklyGroupId = settings.weeklyGroups[effectiveDay] || defaultGroups[effectiveDay];
  const groupId = scope === "weekly" ? weeklyGroupId : dateOverride?.groupId || weeklyGroupId;
  const group = getWorkoutGroupById(groupId);
  const exercises = group.type === "choice" ? [] : group.exercises;
  const routineGroups = WORKOUT_GROUPS.filter((item) => item.type !== "choice" || effectiveDay === "sat");
  const changedDays = useMemo(() => DAYS.filter((day) => settings.weeklyGroups[day]), [settings.weeklyGroups]);
  const currentEdit = scope === "weekly" ? settings.weeklyEdits[effectiveDay] || {} : dateOverride?.edit || settings.weeklyEdits[effectiveDay] || {};

  const changeGroup = (nextGroupId: string) => {
    if (scope === "weekly") {
      onChange({ ...settings, weeklyGroups: { ...settings.weeklyGroups, [effectiveDay]: nextGroupId } });
      return;
    }
    onChange({ ...settings, dateOverrides: { ...settings.dateOverrides, [dateKey]: { ...dateOverride, groupId: nextGroupId } } });
  };

  const updateEdit = (edit: DayRoutineEdit) => {
    if (scope === "weekly") {
      onChange({ ...settings, weeklyEdits: { ...settings.weeklyEdits, [effectiveDay]: edit } });
      return;
    }
    onChange({ ...settings, dateOverrides: { ...settings.dateOverrides, [dateKey]: { ...dateOverride, edit } } });
  };

  const visibleExercises = [
    ...exercises.filter((exercise) => !(currentEdit.removed || []).includes(exercise.exerciseId)),
    ...(currentEdit.customExercises || []).map((exercise) => ({ exerciseId: exercise.id, name: exercise.name, sets: exercise.reps ? `${exercise.reps}회${exercise.sets ? ` × ${exercise.sets}세트` : ""}` : undefined, duration: exercise.durationMinutes ? `${exercise.durationMinutes}분` : undefined })),
  ];
  const orderRank = new Map((currentEdit.order || []).map((id, index) => [id, index]));
  const orderedExercises = currentEdit.order?.length ? [...visibleExercises].sort((a, b) => (orderRank.get(a.exerciseId) ?? 999) - (orderRank.get(b.exerciseId) ?? 999)) : visibleExercises;

  const moveExercise = (id: string, direction: -1 | 1) => {
    const ids = orderedExercises.map((exercise) => exercise.exerciseId);
    const index = ids.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    updateEdit({ ...currentEdit, order: ids });
  };

  const removeExercise = (id: string) => {
    const custom = (currentEdit.customExercises || []).some((exercise) => exercise.id === id);
    updateEdit(custom
      ? { ...currentEdit, customExercises: (currentEdit.customExercises || []).filter((exercise) => exercise.id !== id), order: (currentEdit.order || []).filter((item) => item !== id) }
      : { ...currentEdit, removed: Array.from(new Set([...(currentEdit.removed || []), id])), order: (currentEdit.order || []).filter((item) => item !== id) });
  };

  const addExercise = () => {
    const name = newExerciseName.trim();
    if (!name) return;
    const id = `custom-${Date.now()}`;
    updateEdit({ ...currentEdit, customExercises: [...(currentEdit.customExercises || []), { id, name, reps: 10, sets: 2 }], order: [...orderedExercises.map((exercise) => exercise.exerciseId), id] });
    setNewExerciseName("");
  };

  const swapDays = () => {
    if (moveTarget === effectiveDay) return;
    const sourceId = settings.weeklyGroups[effectiveDay] || defaultGroups[effectiveDay];
    const targetId = settings.weeklyGroups[moveTarget] || defaultGroups[moveTarget];
    if (scope === "weekly") {
      onChange({
        ...settings,
        weeklyGroups: { ...settings.weeklyGroups, [effectiveDay]: targetId, [moveTarget]: sourceId },
        weeklyEdits: { ...settings.weeklyEdits, [effectiveDay]: settings.weeklyEdits[moveTarget] || {}, [moveTarget]: settings.weeklyEdits[effectiveDay] || {} },
      });
      return;
    }
    const targetDate = getDateForWorkoutDay(moveTarget);
    const targetOverride = settings.dateOverrides[targetDate];
    onChange({
      ...settings,
      dateOverrides: {
        ...settings.dateOverrides,
        [dateKey]: { groupId: targetOverride?.groupId || targetId, edit: targetOverride?.edit || settings.weeklyEdits[moveTarget] },
        [targetDate]: { groupId: dateOverride?.groupId || sourceId, edit: dateOverride?.edit || settings.weeklyEdits[effectiveDay] },
      },
    });
  };

  const updateTarget = (name: string, patch: Partial<ExerciseTarget>) => {
    const current = settings.exerciseTargets[name] || {};
    const next = { ...current, ...patch };
    onChange({ ...settings, exerciseTargets: { ...settings.exerciseTargets, [name]: next } });
  };

  return <section className="mb-4 rounded-3xl border border-[#D9D6FF] bg-white p-5 shadow-sm sm:p-6">
    <p className="text-[12px] font-bold text-[#534AB7]">내 운동 설정</p>
    <h2 className="mt-1 text-xl font-bold text-gray-900">요일과 운동량 직접 바꾸기</h2>
    <p className="mt-2 text-sm text-gray-500">AI 기본값은 안전 기준과 현재 계획을 바탕으로 표시됩니다. 실제 적용값은 언제든 직접 바꿀 수 있습니다.</p>

    <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-gray-50 p-1.5">
      {([['weekly', '매주'], ['week', '이번 주만'], ['today', '오늘만']] as [EditScope, string][]).map(([value, label]) => <button key={value} type="button" onClick={() => setScope(value)} className={`rounded-xl px-2 py-2 text-xs font-bold ${scope === value ? "bg-white text-[#534AB7] shadow-sm" : "text-gray-500"}`}>{label}</button>)}
    </div>
    <p className="mt-2 text-xs text-gray-500">{scope === "weekly" ? "선택한 요일의 기본 계획을 앞으로 매주 변경합니다." : scope === "week" ? `이번 주 ${dateKey} 일정에만 적용합니다.` : `오늘(${dateKey}) 일정에만 적용하며 내일부터는 기본 계획으로 돌아갑니다.`}</p>

    <div className={`mt-5 grid grid-cols-7 gap-1 ${scope === "today" ? "opacity-50" : ""}`}>
      {DAYS.map((day) => <button key={day} type="button" disabled={scope === "today"} onClick={() => setEditingDay(day)} className={`rounded-xl py-2 text-xs font-bold ${effectiveDay === day ? "bg-[#534AB7] text-white" : "bg-gray-50 text-gray-500"}`}>{dayIdToKoreanLabel[day].slice(0, 1)}</button>)}
    </div>

    <label className="mt-4 block text-sm font-bold text-gray-700">{dayIdToKoreanLabel[effectiveDay]} {scope === "weekly" ? "기본" : "임시"} 루틴
      <select value={groupId} onChange={(e) => changeGroup(e.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 font-normal">
        {routineGroups.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.duration}</option>)}
      </select>
    </label>
    <div className="mt-2 flex gap-2"><button type="button" onClick={() => changeGroup("cardio-foam-recovery")} className="flex-1 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-700">🌿 회복 루틴으로 변경</button><button type="button" onClick={() => changeGroup("rest")} className="rounded-xl bg-gray-100 px-3 py-2.5 text-xs font-bold text-gray-600">휴식</button></div>
    {scope === "weekly" && <div className="mt-2 flex items-center justify-between rounded-xl bg-[#EEEDFE] px-3 py-2 text-xs text-[#3C3489]"><span>변경한 요일: {changedDays.length ? changedDays.map((day) => dayIdToKoreanLabel[day]).join(", ") : "없음"}</span><button type="button" onClick={() => onChange({ ...settings, weeklyGroups: {}, weeklyEdits: {} })} className="font-bold underline">주간 루틴 초기화</button></div>}
    {scope !== "weekly" && dateOverride && <button type="button" onClick={() => { const next = { ...settings.dateOverrides }; delete next[dateKey]; onChange({ ...settings, dateOverrides: next }); }} className="mt-2 w-full rounded-xl bg-[#EEEDFE] px-3 py-2 text-xs font-bold text-[#3C3489]">{scope === "today" ? "오늘" : "이 날짜"} 변경 취소</button>}

    {scope !== "today" && <div className="mt-3 rounded-2xl border border-gray-100 p-3"><p className="text-xs font-bold text-gray-700">운동일 이동·교환</p><div className="mt-2 flex gap-2"><select aria-label="교환할 요일" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value as WorkoutDayId)} className="min-w-0 flex-1 rounded-xl bg-gray-50 px-3 py-2 text-sm">{DAYS.filter((day) => day !== effectiveDay).map((day) => <option key={day} value={day}>{dayIdToKoreanLabel[day]}</option>)}</select><button type="button" onClick={swapDays} className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-bold text-white">서로 교환</button></div><p className="mt-1 text-[11px] text-gray-400">놓친 운동을 옮길 때 대상 요일과 계획을 서로 바꿉니다.</p></div>}

    {group.type === "choice" ? <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">선택 유산소의 시간은 운동 화면에서 직접 입력할 수 있습니다.</p> : <div className="mt-5 space-y-3">
      <div><h3 className="font-bold text-gray-900">운동 순서·추가·삭제</h3><p className="mt-1 text-xs text-gray-500">화살표로 순서를 바꾸고, 오늘 하지 않을 운동은 삭제할 수 있습니다.</p></div>
      <div className="space-y-2">{orderedExercises.map((exercise, index) => <div key={exercise.exerciseId} className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{index + 1}. {exercise.name}</span><button type="button" disabled={index === 0} onClick={() => moveExercise(exercise.exerciseId, -1)} className="rounded-lg bg-white px-2 py-1 text-xs disabled:opacity-30" aria-label={`${exercise.name} 위로 이동`}>↑</button><button type="button" disabled={index === orderedExercises.length - 1} onClick={() => moveExercise(exercise.exerciseId, 1)} className="rounded-lg bg-white px-2 py-1 text-xs disabled:opacity-30" aria-label={`${exercise.name} 아래로 이동`}>↓</button><button type="button" onClick={() => removeExercise(exercise.exerciseId)} className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600">삭제</button></div>)}</div>
      <div className="flex gap-2"><input aria-label="추가할 운동 이름" value={newExerciseName} onChange={(e) => setNewExerciseName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExercise(); } }} placeholder="추가할 운동 이름" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm" /><button type="button" onClick={addExercise} className="rounded-xl bg-[#534AB7] px-4 py-2 text-xs font-bold text-white">운동 추가</button></div>
      <div><h3 className="font-bold text-gray-900">운동별 내 설정</h3><p className="mt-1 text-xs text-gray-500">비워 두면 AI 기본값이 적용됩니다. 추천값 적용을 누르면 입력칸에 복사됩니다.</p></div>
      {orderedExercises.map((exercise) => {
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
