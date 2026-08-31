"use client";

import { useMemo, useState } from "react";
import { WORKOUT_GROUPS, getWorkoutGroupById } from "../data/workoutGroups";
import { dayIdToKoreanLabel } from "../data/workoutPlans";
import { getDateForWorkoutDay, getWorkoutDayForDate, getWorkoutRecord, WorkoutCompletionStore, WorkoutDayId } from "../data/workoutCompletion";
import { DayRoutineEdit, ExerciseTarget, UserWorkoutSettings } from "../data/userWorkoutSettings";
import { readJson, WEIGHT_RECORDS_KEY, WeightRecordStore } from "../data/recordStorage";
import { DEFAULT_WORKOUT_METHOD, getWorkoutMethodLabel, normalizeWorkoutMethod, WORKOUT_METHOD_OPTIONS } from "../data/workoutMethods";
import type { WorkoutMethodConfig } from "../data/workoutMethods";

const DAYS: WorkoutDayId[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
type EditScope = "weekly" | "week" | "today";
type RecommendationLevel = "start" | "reduce" | "maintain" | "increase";

interface AiRecommendation {
  target: ExerciseTarget;
  level: RecommendationLevel;
  title: string;
  summary: string;
  evidence: string[];
  nextStep: string;
}

const RECOMMENDATION_STYLE: Record<RecommendationLevel, { badge: string; panel: string }> = {
  start: { badge: "bg-blue-50 text-blue-700", panel: "border-blue-100 bg-blue-50/50" },
  reduce: { badge: "bg-amber-100 text-amber-800", panel: "border-amber-200 bg-amber-50" },
  maintain: { badge: "bg-gray-100 text-gray-700", panel: "border-gray-200 bg-gray-50" },
  increase: { badge: "bg-emerald-100 text-emerald-800", panel: "border-emerald-200 bg-emerald-50" },
};

function numberFrom(text: string | undefined, unit: string) {
  const match = text?.match(new RegExp(`(\\d+)(?:\\s*~\\s*(\\d+))?\\s*${unit}`));
  if (!match) return undefined;
  return match[2] ? Math.round((Number(match[1]) + Number(match[2])) / 2) : Number(match[1]);
}

function getAiTarget(name: string, base: ExerciseTarget, records: WorkoutCompletionStore, userTarget?: ExerciseTarget): AiRecommendation {
  const sortedDates = Object.keys(records).sort((a, b) => b.localeCompare(a));
  const recent = sortedDates.flatMap((date) => {
    const day = getWorkoutRecord(records[date]);
    return day.workoutExerciseRecords?.filter((item) => item.exerciseName === name).map((item) => ({ ...item, date })) || [];
  }).slice(0, 3);
  if (!recent.length) return {
    target: base,
    level: "start",
    title: "안전한 시작값",
    summary: "아직 이 운동의 수행 기록이 없어 현재 주차 계획과 허리 안전 기준을 적용했습니다.",
    evidence: ["최근 수행 기록 없음", "현재 주차 계획", "허리 안전 기준"],
    nextStep: "운동 후 완료 상태·난이도·피로도와 실제 수행량을 기록하면 다음 추천이 더 정교해집니다.",
  };

  const recentDays = sortedDates.slice(0, 7).map((date) => ({ date, record: getWorkoutRecord(records[date]) }));
  const latestDay = recentDays[0]?.record;
  const completedDays = recentDays.filter(({ record }) => record.workoutDone).length;
  const lastDate = recent[0]?.date;
  const intervalDays = lastDate ? Math.floor((Date.now() - new Date(`${lastDate}T00:00:00`).getTime()) / 86400000) : 0;
  const weights = readJson<WeightRecordStore>(WEIGHT_RECORDS_KEY, {});
  const recentWeights = Object.entries(weights).sort(([a], [b]) => b.localeCompare(a)).slice(0, 2);
  const weightRecordGap = recentWeights.length === 2 ? Math.abs((new Date(`${recentWeights[0][0]}T00:00:00`).getTime() - new Date(`${recentWeights[1][0]}T00:00:00`).getTime()) / 86400000) : 0;
  const weightChangeRate = recentWeights.length === 2 && weightRecordGap <= 14 ? ((recentWeights[0][1].weight - recentWeights[1][1].weight) / recentWeights[1][1].weight) * 100 : 0;
  const userPrefersLower = (base.sets && userTarget?.sets && userTarget.sets < base.sets) || (base.reps && userTarget?.reps && userTarget.reps < base.reps) || (base.durationMinutes && userTarget?.durationMinutes && userTarget.durationMinutes < base.durationMinutes);
  const needsReduction = recent.some((item) => (item.painScore || 0) > 0 || item.status === "partial" || item.status === "skipped") || latestDay?.workoutStatus === "stopped" || latestDay?.workoutDifficulty === "hard" || (latestDay?.workoutFatigue || 0) >= 4 || intervalDays >= 10;
  const completed = recent.filter((item) => item.status === "completed");
  if (needsReduction) {
    const reduce = (value: number | undefined) => value === undefined ? undefined : Math.max(1, Math.floor(value * 0.8));
    const signals = [(latestDay?.workoutFatigue || 0) >= 4 ? "피로도" : "", latestDay?.workoutDifficulty === "hard" ? "체감 난이도" : "", latestDay?.workoutStatus === "stopped" ? "중단 기록" : "", intervalDays >= 10 ? "운동 간격" : "", recent.some((item) => (item.painScore || 0) > 0) ? "통증" : ""].filter(Boolean);
    return {
      target: { sets: reduce(base.sets), reps: reduce(base.reps), durationMinutes: reduce(base.durationMinutes) },
      level: "reduce",
      title: "오늘은 강도 낮춤",
      summary: `최근 기록의 ${signals.join("·") || "부분 완료"}를 반영해 기본 계획의 약 80%로 낮췄습니다.`,
      evidence: signals.length ? signals.map((signal) => `${signal} 확인`) : ["일부 완료 기록"],
      nextStep: "낮춘 양으로 통증 없이 마치고 피로도 3 이하이면 다음 기록에서 다시 유지 또는 증가를 검토합니다.",
    };
  }
  if (userPrefersLower) {
    return {
      target: userTarget || base,
      level: "maintain",
      title: "내 설정 유지",
      summary: "직접 낮춘 운동량을 선호하는 경향을 반영해 현재 내 설정을 유지합니다.",
      evidence: ["기본값보다 낮은 내 설정", `최근 기록 ${recent.length}회`],
      nextStep: "현재 양이 편안해질 때만 추천값 적용을 눌러 변경하세요. 자동으로 내 설정을 덮어쓰지 않습니다.",
    };
  }
  if (weightChangeRate <= -2 && (latestDay?.workoutFatigue || 0) >= 3) {
    return {
      target: base,
      level: "maintain",
      title: "현재 강도 유지",
      summary: `최근 체중 변화(${weightChangeRate.toFixed(1)}%)와 피로도를 함께 고려해 증량하지 않습니다.`,
      evidence: [`14일 이내 체중 ${weightChangeRate.toFixed(1)}%`, `최근 피로도 ${latestDay?.workoutFatigue || 0}/5`],
      nextStep: "체중 감량 중에는 운동량 증가보다 현재 양을 안정적으로 반복하고 회복 상태를 확인하세요.",
    };
  }
  if (completed.length >= 2 && completedDays <= 5 && intervalDays <= 7 && latestDay?.workoutDifficulty !== "hard" && (latestDay?.workoutFatigue || 0) <= 3) {
    return {
      target: {
        sets: base.sets,
        reps: base.reps === undefined ? undefined : base.reps + 1,
        durationMinutes: base.durationMinutes === undefined ? undefined : base.durationMinutes + 1,
      },
      level: "increase",
      title: "한 항목만 소폭 증가",
      summary: "안전하게 완료한 기록이 쌓여 횟수 또는 시간을 한 단계만 올렸습니다.",
      evidence: [`최근 완료 ${completed.length}회`, `주간 운동 ${completedDays}일`, `운동 간격 ${intervalDays}일`, `피로도 ${latestDay?.workoutFatigue || 0}/5`],
      nextStep: "증가한 양에서 자세가 흐트러지거나 통증이 생기면 즉시 이전 양으로 돌아가세요.",
    };
  }
  return {
    target: base,
    level: "maintain",
    title: "현재 강도 유지",
    summary: `최근 ${recent.length}회 기록을 확인했으며, 판단에 필요한 기록이 더 쌓일 때까지 현재 계획을 유지합니다.`,
    evidence: [`최근 기록 ${recent.length}/3회`, `최근 완료 ${completed.length}회`, `주간 운동 ${completedDays}일`],
    nextStep: "통증 없이 2회 이상 완료하고 피로도 3 이하를 유지하면 한 항목의 소폭 증가를 검토합니다.",
  };
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
  const changedDays = useMemo(() => DAYS.filter((day) => settings.weeklyGroups[day] || settings.weeklyEdits[day] || settings.weeklyMethods[day]), [settings.weeklyEdits, settings.weeklyGroups, settings.weeklyMethods]);
  const currentEdit = scope === "weekly" ? settings.weeklyEdits[effectiveDay] || {} : dateOverride?.edit || settings.weeklyEdits[effectiveDay] || {};
  const currentMethod = normalizeWorkoutMethod(scope === "weekly" ? settings.weeklyMethods[effectiveDay] : dateOverride?.method || settings.weeklyMethods[effectiveDay]);

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

  const updateMethod = (patch: Partial<WorkoutMethodConfig>) => {
    const method = normalizeWorkoutMethod({ ...currentMethod, ...patch });
    if (scope === "weekly") {
      onChange({ ...settings, weeklyMethods: { ...settings.weeklyMethods, [effectiveDay]: method } });
      return;
    }
    onChange({ ...settings, dateOverrides: { ...settings.dateOverrides, [dateKey]: { ...dateOverride, method } } });
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
        weeklyMethods: { ...settings.weeklyMethods, [effectiveDay]: settings.weeklyMethods[moveTarget] || DEFAULT_WORKOUT_METHOD, [moveTarget]: settings.weeklyMethods[effectiveDay] || DEFAULT_WORKOUT_METHOD },
      });
      return;
    }
    const targetDate = getDateForWorkoutDay(moveTarget);
    const targetOverride = settings.dateOverrides[targetDate];
    onChange({
      ...settings,
      dateOverrides: {
        ...settings.dateOverrides,
        [dateKey]: { groupId: targetOverride?.groupId || targetId, edit: targetOverride?.edit || settings.weeklyEdits[moveTarget], method: targetOverride?.method || settings.weeklyMethods[moveTarget] },
        [targetDate]: { groupId: dateOverride?.groupId || sourceId, edit: dateOverride?.edit || settings.weeklyEdits[effectiveDay], method: dateOverride?.method || settings.weeklyMethods[effectiveDay] },
      },
    });
  };

  const updateTarget = (name: string, patch: Partial<ExerciseTarget>) => {
    const current = settings.exerciseTargets[name] || {};
    const next = { ...current, ...patch };
    onChange({ ...settings, exerciseTargets: { ...settings.exerciseTargets, [name]: next } });
  };

  return <section className="mb-4 rounded-3xl border border-[#D9D6FF] bg-white p-4 shadow-sm sm:p-6">
    <p className="text-[12px] font-bold text-[#534AB7]">필요한 것만 바꾸기</p>
    <h2 className="mt-1 text-xl font-bold text-gray-900">어느 날 운동을 바꿀까요?</h2>
    <p className="mt-2 text-sm text-gray-500">기간과 요일을 고른 뒤 운동만 선택하면 끝입니다. 횟수와 방식은 바꾸고 싶을 때만 열어보세요.</p>

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
    {scope === "weekly" && <div className="mt-2 flex items-center justify-between rounded-xl bg-[#EEEDFE] px-3 py-2 text-xs text-[#3C3489]"><span>변경한 요일: {changedDays.length ? changedDays.map((day) => dayIdToKoreanLabel[day]).join(", ") : "없음"}</span><button type="button" onClick={() => onChange({ ...settings, weeklyGroups: {}, weeklyEdits: {}, weeklyMethods: {} })} className="font-bold underline">주간 루틴 초기화</button></div>}
    {scope !== "weekly" && dateOverride && <button type="button" onClick={() => { const next = { ...settings.dateOverrides }; delete next[dateKey]; onChange({ ...settings, dateOverrides: next }); }} className="mt-2 w-full rounded-xl bg-[#EEEDFE] px-3 py-2 text-xs font-bold text-[#3C3489]">{scope === "today" ? "오늘" : "이 날짜"} 변경 취소</button>}

    {scope !== "today" && <div className="mt-3 rounded-2xl border border-gray-100 p-3"><p className="text-xs font-bold text-gray-700">운동일 이동·교환</p><div className="mt-2 flex gap-2"><select aria-label="교환할 요일" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value as WorkoutDayId)} className="min-w-0 flex-1 rounded-xl bg-gray-50 px-3 py-2 text-sm">{DAYS.filter((day) => day !== effectiveDay).map((day) => <option key={day} value={day}>{dayIdToKoreanLabel[day]}</option>)}</select><button type="button" onClick={swapDays} className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-bold text-white">서로 교환</button></div><p className="mt-1 text-[11px] text-gray-400">놓친 운동을 옮길 때 대상 요일과 계획을 서로 바꿉니다.</p></div>}

    <details className="mt-4 rounded-2xl border border-[#D9D6FF] bg-[#F7F6FF]">
      <summary className="cursor-pointer list-none p-4">
        <span className="block text-sm font-bold text-gray-900">운동 방식 바꾸기</span>
        <span className="mt-1 block text-[11px] text-gray-500">지금은 {getWorkoutMethodLabel(currentMethod.method)} · 서킷·슈퍼세트·인터벌은 여기서 선택</span>
      </summary>
      <section className="border-t border-[#D9D6FF] p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-[#534AB7]">운동 수행 방식</p><h3 className="mt-1 text-base font-bold text-gray-900">{getWorkoutMethodLabel(currentMethod.method)}</h3></div><button type="button" onClick={() => updateMethod(DEFAULT_WORKOUT_METHOD)} className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-gray-500">기본값</button></div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{WORKOUT_METHOD_OPTIONS.map((option) => <button key={option.id} type="button" onClick={() => updateMethod({ method: option.id })} className={`rounded-xl px-2 py-2.5 text-xs font-bold ${currentMethod.method === option.id ? "bg-[#534AB7] text-white" : "bg-white text-gray-600"}`}>{option.label}</button>)}</div>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{WORKOUT_METHOD_OPTIONS.find((option) => option.id === currentMethod.method)?.description}</p>
      {currentMethod.method !== "standard" && currentMethod.method !== "free" ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="text-[11px] font-bold text-gray-600">{currentMethod.method === "superset" ? "반복 세트" : "라운드"}<span className="mt-1 flex items-center rounded-xl bg-white px-3"><input aria-label="라운드 수" type="number" min={1} max={8} value={currentMethod.rounds} onChange={(event) => updateMethod({ rounds: Number(event.target.value) })} className="min-w-0 flex-1 bg-transparent py-2.5 text-right text-sm outline-none" /><span className="ml-1 font-normal">회</span></span></label>
        {currentMethod.method === "interval" ? <label className="text-[11px] font-bold text-gray-600">운동 시간<span className="mt-1 flex items-center rounded-xl bg-white px-3"><input aria-label="인터벌 운동 시간" type="number" min={10} max={600} step={5} value={currentMethod.workSeconds} onChange={(event) => updateMethod({ workSeconds: Number(event.target.value) })} className="min-w-0 flex-1 bg-transparent py-2.5 text-right text-sm outline-none" /><span className="ml-1 font-normal">초</span></span></label> : null}
        <label className="text-[11px] font-bold text-gray-600">{currentMethod.method === "interval" ? "구간 휴식" : "묶음 후 휴식"}<span className="mt-1 flex items-center rounded-xl bg-white px-3"><input aria-label="운동 방식 휴식 시간" type="number" min={0} max={300} step={5} value={currentMethod.restSeconds} onChange={(event) => updateMethod({ restSeconds: Number(event.target.value) })} className="min-w-0 flex-1 bg-transparent py-2.5 text-right text-sm outline-none" /><span className="ml-1 font-normal">초</span></span></label>
      </div> : null}
      <p className="mt-3 rounded-xl bg-white px-3 py-2 text-[11px] font-semibold text-gray-600">준비운동과 마무리는 한 번만 진행하고 선택한 방식은 본운동에만 적용됩니다. 통증·저림이 있으면 방식과 관계없이 즉시 중단하세요.</p>
      </section>
    </details>

    {group.type === "choice" ? <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">선택 유산소의 시간은 운동 화면에서 직접 입력할 수 있습니다.</p> : <div className="mt-5 space-y-3">
      <details className="rounded-2xl border border-gray-100 bg-white">
        <summary className="cursor-pointer list-none p-4"><span className="block text-sm font-bold text-gray-900">운동 순서·추가·삭제</span><span className="mt-1 block text-[11px] text-gray-500">필요할 때만 운동 목록을 직접 편집하세요</span></summary>
        <div className="space-y-2 border-t border-gray-100 p-3">{orderedExercises.map((exercise, index) => <div key={exercise.exerciseId} className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{index + 1}. {exercise.name}</span><button type="button" disabled={index === 0} onClick={() => moveExercise(exercise.exerciseId, -1)} className="rounded-lg bg-white px-2 py-1 text-xs disabled:opacity-30" aria-label={`${exercise.name} 위로 이동`}>↑</button><button type="button" disabled={index === orderedExercises.length - 1} onClick={() => moveExercise(exercise.exerciseId, 1)} className="rounded-lg bg-white px-2 py-1 text-xs disabled:opacity-30" aria-label={`${exercise.name} 아래로 이동`}>↓</button><button type="button" onClick={() => removeExercise(exercise.exerciseId)} className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600">삭제</button></div>)}</div>
        <div className="flex gap-2 px-3 pb-3"><input aria-label="추가할 운동 이름" value={newExerciseName} onChange={(e) => setNewExerciseName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExercise(); } }} placeholder="추가할 운동 이름" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm" /><button type="button" onClick={addExercise} className="rounded-xl bg-[#534AB7] px-4 py-2 text-xs font-bold text-white">운동 추가</button></div>
      </details>
      <div><h3 className="font-bold text-gray-900">횟수와 시간 바꾸기</h3><p className="mt-1 text-xs text-gray-500">AI 추천을 확인하고 원하는 운동만 바꿀 수 있습니다. 바꾸지 않으면 안전한 기본값이 그대로 적용됩니다.</p></div>
      <div className="rounded-2xl border border-[#D9D6FF] bg-[#F7F6FF] p-3 text-xs leading-relaxed text-[#3C3489]">
        <p className="font-bold">AI 추천을 읽는 방법</p>
        <p className="mt-1">최근 3회 수행과 통증·난이도·피로도·운동 간격을 먼저 보고, 체중 변화와 직접 바꾼 운동량을 함께 확인합니다.</p>
        <div className="mt-2 flex flex-wrap gap-1.5"><span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">시작값</span><span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">강도 낮춤</span><span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700">현재 유지</span><span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800">소폭 증가</span></div>
      </div>
      {orderedExercises.map((exercise) => {
        const name = exercise.name || exercise.exerciseId;
        const baseAi: ExerciseTarget = { sets: numberFrom(exercise.sets, "세트"), reps: numberFrom(exercise.sets, "회"), durationMinutes: numberFrom(exercise.duration, "분") };
        const recommendation = getAiTarget(name, baseAi, records, settings.exerciseTargets[name]);
        const ai = recommendation.target;
        const target = settings.exerciseTargets[name] || {};
        const fields = ai.durationMinutes !== undefined ? [{ key: "durationMinutes" as const, label: "시간", suffix: "분", value: target.durationMinutes }] : [
          { key: "reps" as const, label: "횟수", suffix: "회", value: target.reps },
          { key: "sets" as const, label: "세트", suffix: "세트", value: target.sets },
        ];
        return <div key={exercise.exerciseId} className="rounded-2xl border border-gray-100 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-gray-900">{name}</p><p className="mt-1 text-xs text-[#534AB7]">AI 추천: {ai.durationMinutes ? `${ai.durationMinutes}분` : ai.reps ? `${ai.reps}회${ai.sets ? ` × ${ai.sets}세트` : ""}` : exercise.sets || exercise.duration || "통증 없는 범위"}</p></div><button type="button" onClick={() => onChange({ ...settings, exerciseTargets: { ...settings.exerciseTargets, [name]: ai } })} className="shrink-0 rounded-lg bg-[#EEEDFE] px-2.5 py-1.5 text-[11px] font-bold text-[#3C3489]">추천값 적용</button></div>
          <div className={`mt-3 rounded-xl border p-3 ${RECOMMENDATION_STYLE[recommendation.level].panel}`}>
            <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${RECOMMENDATION_STYLE[recommendation.level].badge}`}>{recommendation.title}</span></div>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-700">{recommendation.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{recommendation.evidence.map((item) => <span key={item} className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-gray-600">{item}</span>)}</div>
            <details className="mt-2 text-[11px] text-gray-600"><summary className="cursor-pointer font-bold">다음 추천이 달라지는 조건</summary><p className="mt-1.5 leading-relaxed">{recommendation.nextStep}</p></details>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">{fields.map((field) => <label key={field.key} className="text-xs font-bold text-gray-600">내 {field.label}<span className="mt-1 flex items-center rounded-xl bg-gray-50 px-3"><input type="number" min={1} value={field.value ?? ""} placeholder={String(ai[field.key] ?? "-")} onChange={(e) => updateTarget(name, { [field.key]: e.target.value ? Number(e.target.value) : undefined })} className="min-w-0 flex-1 bg-transparent py-2.5 text-right text-sm outline-none" /><span className="ml-1 font-normal">{field.suffix}</span></span></label>)}</div>
        </div>;
      })}
    </div>}
  </section>;
}
