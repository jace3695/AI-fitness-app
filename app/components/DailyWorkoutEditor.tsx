"use client";

import { useState } from "react";
import {
  EXCLUDED_EXERCISE_IDS,
  getWorkoutGroupById,
  WORKOUT_GROUPS,
  type WorkoutGroupExercise,
} from "../data/workoutGroups";
import type { WorkoutDayId } from "../data/workoutCompletion";
import { dayIdToKoreanLabel } from "../data/workoutPlans";
import type {
  CustomExercise,
  DayRoutineEdit,
  UserWorkoutSettings,
} from "../data/userWorkoutSettings";

type EditScope = "date" | "weekly";

interface DailyWorkoutEditorProps {
  dayId: WorkoutDayId;
  dateKey: string;
  defaultGroupId: string;
  recommendedGroupId: string;
  recommendationReason: string;
  settings: UserWorkoutSettings;
  onChange: (settings: UserWorkoutSettings) => void;
  onClose: () => void;
}

function readFirstNumber(text?: string) {
  const value = text?.match(/\d+/)?.[0];
  return value ? Number(value) : undefined;
}

function toCustomExercise(exercise: WorkoutGroupExercise): CustomExercise {
  return {
    id: `custom-${exercise.exerciseId}-${Date.now()}`,
    name: exercise.name || exercise.exerciseId,
    durationMinutes: exercise.duration ? readFirstNumber(exercise.duration) : undefined,
    reps: exercise.sets ? readFirstNumber(exercise.sets) : undefined,
    sets: exercise.sets?.match(/(\d+)\s*세트/) ? Number(exercise.sets.match(/(\d+)\s*세트/)?.[1]) : undefined,
  };
}

export default function DailyWorkoutEditor({
  dayId,
  dateKey,
  defaultGroupId,
  recommendedGroupId,
  recommendationReason,
  settings,
  onChange,
  onClose,
}: DailyWorkoutEditorProps) {
  const [scope, setScope] = useState<EditScope>("date");
  const [newExerciseName, setNewExerciseName] = useState("");
  const [notice, setNotice] = useState("");

  const dateOverride = settings.dateOverrides[dateKey];
  const weeklyGroupId = settings.weeklyGroups[dayId] || defaultGroupId;
  const groupId = scope === "date" ? dateOverride?.groupId || weeklyGroupId : weeklyGroupId;
  const group = getWorkoutGroupById(groupId);
  const recommendedGroup = getWorkoutGroupById(recommendedGroupId);
  const currentEdit: DayRoutineEdit = scope === "date"
    ? dateOverride?.edit || settings.weeklyEdits[dayId] || {}
    : settings.weeklyEdits[dayId] || {};
  const baseExercises = group.type === "choice"
    ? []
    : group.exercises.filter((exercise) => !EXCLUDED_EXERCISE_IDS.has(exercise.exerciseId));
  const recommendedExercises = recommendedGroup.type === "choice"
    ? []
    : recommendedGroup.exercises.filter((exercise) => !EXCLUDED_EXERCISE_IDS.has(exercise.exerciseId));
  const removedIds = new Set(currentEdit.removed || []);
  const visibleExercises = [
    ...baseExercises.filter((exercise) => !removedIds.has(exercise.exerciseId)),
    ...(currentEdit.customExercises || []).map((exercise) => ({
      exerciseId: exercise.id,
      name: exercise.name,
      sets: exercise.reps
        ? `${exercise.reps}회${exercise.sets ? ` × ${exercise.sets}세트` : ""}`
        : undefined,
      duration: exercise.durationMinutes ? `${exercise.durationMinutes}분` : undefined,
    })),
  ];
  const orderRank = new Map((currentEdit.order || []).map((id, index) => [id, index]));
  const orderedExercises = currentEdit.order?.length
    ? [...visibleExercises].sort(
        (a, b) =>
          (orderRank.get(a.exerciseId) ?? 999) -
          (orderRank.get(b.exerciseId) ?? 999),
      )
    : visibleExercises;
  const routineGroups = WORKOUT_GROUPS.filter(
    (item) => item.type !== "choice" || dayId === "sat",
  );

  const clearCurrentDateRoutine = () => {
    const dateOverrides = { ...settings.dateOverrides };
    if (dateOverride?.method) {
      dateOverrides[dateKey] = { method: dateOverride.method };
    } else {
      delete dateOverrides[dateKey];
    }
    return dateOverrides;
  };

  const updateEdit = (edit: DayRoutineEdit) => {
    setNotice("");
    if (scope === "weekly") {
      onChange({
        ...settings,
        weeklyEdits: { ...settings.weeklyEdits, [dayId]: edit },
        dateOverrides: clearCurrentDateRoutine(),
      });
      return;
    }
    onChange({
      ...settings,
      dateOverrides: {
        ...settings.dateOverrides,
        [dateKey]: { ...dateOverride, edit },
      },
    });
  };

  const changeGroup = (nextGroupId: string) => {
    setNotice("기본 루틴을 바꿨어요. 이제 필요한 운동만 빼거나 더하세요.");
    if (scope === "weekly") {
      onChange({
        ...settings,
        weeklyGroups: { ...settings.weeklyGroups, [dayId]: nextGroupId },
        weeklyEdits: { ...settings.weeklyEdits, [dayId]: {} },
        dateOverrides: clearCurrentDateRoutine(),
      });
      return;
    }
    onChange({
      ...settings,
      dateOverrides: {
        ...settings.dateOverrides,
        [dateKey]: { ...dateOverride, groupId: nextGroupId, edit: {} },
      },
    });
  };

  const resetChanges = () => {
    setNotice("기본 운동표로 돌아왔어요.");
    if (scope === "weekly") {
      const weeklyGroups = { ...settings.weeklyGroups };
      const weeklyEdits = { ...settings.weeklyEdits };
      delete weeklyGroups[dayId];
      delete weeklyEdits[dayId];
      onChange({ ...settings, weeklyGroups, weeklyEdits });
      return;
    }

    const dateOverrides = { ...settings.dateOverrides };
    if (dateOverride?.method) {
      dateOverrides[dateKey] = { method: dateOverride.method };
    } else {
      delete dateOverrides[dateKey];
    }
    onChange({ ...settings, dateOverrides });
  };

  const removeExercise = (exerciseId: string) => {
    const isCustom = (currentEdit.customExercises || []).some(
      (exercise) => exercise.id === exerciseId,
    );
    updateEdit(
      isCustom
        ? {
            ...currentEdit,
            customExercises: (currentEdit.customExercises || []).filter(
              (exercise) => exercise.id !== exerciseId,
            ),
            order: (currentEdit.order || []).filter((id) => id !== exerciseId),
          }
        : {
            ...currentEdit,
            removed: Array.from(
              new Set([...(currentEdit.removed || []), exerciseId]),
            ),
            order: (currentEdit.order || []).filter((id) => id !== exerciseId),
          },
    );
  };

  const restoreExercise = (exerciseId: string) => {
    updateEdit({
      ...currentEdit,
      removed: (currentEdit.removed || []).filter((id) => id !== exerciseId),
    });
  };

  const addExercise = (candidate?: WorkoutGroupExercise) => {
    const name = candidate?.name || newExerciseName.trim();
    if (!name) return;

    const removedBase = baseExercises.find(
      (exercise) => exercise.name === name && removedIds.has(exercise.exerciseId),
    );
    if (removedBase) {
      restoreExercise(removedBase.exerciseId);
      setNewExerciseName("");
      setNotice(`${name}을(를) 다시 넣었어요.`);
      return;
    }

    if (orderedExercises.some((exercise) => exercise.name === name)) {
      setNotice("이미 들어 있는 운동이에요.");
      return;
    }

    const customExercise = candidate
      ? toCustomExercise(candidate)
      : { id: `custom-${Date.now()}`, name, reps: 10, sets: 2 };
    updateEdit({
      ...currentEdit,
      customExercises: [
        ...(currentEdit.customExercises || []),
        customExercise,
      ],
      order: [
        ...orderedExercises.map((exercise) => exercise.exerciseId),
        customExercise.id,
      ],
    });
    setNewExerciseName("");
    setNotice(`${name}을(를) 추가했어요.`);
  };

  return (
    <section className="mb-4 rounded-3xl border-2 border-[#AFA9EC] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold text-[#534AB7]">쉽게 바꾸기</p>
          <h2 className="mt-1 text-xl font-bold text-gray-900">
            {dayIdToKoreanLabel[dayId]} 운동 만들기
          </h2>
          <p className="mt-1 text-[12px] text-gray-500">
            기본 루틴을 고른 뒤 필요 없는 운동은 빼고, 원하는 운동은 더하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-xl bg-gray-100 px-3 py-2 text-[12px] font-bold text-gray-600"
        >
          닫기
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-gray-50 p-1.5">
        <button
          type="button"
          onClick={() => setScope("date")}
          className={`rounded-xl px-3 py-2.5 text-[12px] font-bold ${scope === "date" ? "bg-white text-[#534AB7] shadow-sm" : "text-gray-500"}`}
        >
          이 날짜만
        </button>
        <button
          type="button"
          onClick={() => setScope("weekly")}
          className={`rounded-xl px-3 py-2.5 text-[12px] font-bold ${scope === "weekly" ? "bg-white text-[#534AB7] shadow-sm" : "text-gray-500"}`}
        >
          매주 {dayIdToKoreanLabel[dayId]}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        {scope === "date"
          ? `${dateKey}에만 적용됩니다.`
          : `앞으로 매주 ${dayIdToKoreanLabel[dayId]}에 적용됩니다.`}
      </p>

      <div className="mt-4 rounded-2xl bg-[#EEEDFE] p-4">
        <p className="text-[12px] font-bold text-[#534AB7]">오늘 추천 루틴</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[16px] font-bold text-[#312B67]">
              {recommendedGroup.name}
            </p>
            <p className="mt-1 text-[11px] text-[#625A9A]">
              {recommendationReason}
            </p>
          </div>
          <button
            type="button"
            onClick={() => changeGroup(recommendedGroup.id)}
            className="rounded-xl bg-[#534AB7] px-3 py-2.5 text-[12px] font-bold text-white"
          >
            추천 루틴 사용
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {recommendedGroup.type === "choice"
            ? recommendedGroup.options.map((option) => (
                <span key={option.id} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#534AB7]">
                  {option.name}
                </span>
              ))
            : recommendedExercises.slice(0, 8).map((exercise) => (
                <button
                  key={exercise.exerciseId}
                  type="button"
                  onClick={() => addExercise(exercise)}
                  className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#534AB7]"
                >
                  + {exercise.name || exercise.exerciseId}
                </button>
              ))}
        </div>
      </div>

      <label className="mt-4 block text-[13px] font-bold text-gray-800">
        기본 루틴 고르기
        <select
          value={groupId}
          onChange={(event) => changeGroup(event.target.value)}
          className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-[14px] font-normal"
        >
          {routineGroups.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.duration}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => changeGroup("cardio-foam-recovery")}
          className="rounded-xl bg-emerald-50 px-3 py-2.5 text-[12px] font-bold text-emerald-700"
        >
          가볍게 회복
        </button>
        <button
          type="button"
          onClick={resetChanges}
          className="rounded-xl bg-gray-100 px-3 py-2.5 text-[12px] font-bold text-gray-600"
        >
          기본으로 돌아가기
        </button>
      </div>

      <div className="mt-5">
        <p className="text-[13px] font-bold text-gray-800">
          내가 할 운동 {orderedExercises.length}개
        </p>
        {group.type === "choice" ? (
          <p className="mt-2 rounded-xl bg-blue-50 px-3 py-3 text-[12px] text-blue-700">
            선택 유산소는 운동 화면에서 슬라이딩보드·걷기·휴식 중 하나만 고르면 됩니다.
          </p>
        ) : (
          <div className="mt-2 grid gap-2">
            {orderedExercises.map((exercise, index) => (
              <div
                key={exercise.exerciseId}
                className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-gray-800">
                    {index + 1}. {exercise.name || exercise.exerciseId}
                  </p>
                  {(exercise.sets || exercise.duration) && (
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      {exercise.sets || exercise.duration}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeExercise(exercise.exerciseId)}
                  className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-red-600"
                >
                  빼기
                </button>
              </div>
            ))}
          </div>
        )}

        {baseExercises.some((exercise) => removedIds.has(exercise.exerciseId)) && (
          <div className="mt-3 rounded-xl border border-dashed border-gray-200 p-3">
            <p className="text-[11px] font-bold text-gray-500">뺀 운동 다시 넣기</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {baseExercises
                .filter((exercise) => removedIds.has(exercise.exerciseId))
                .map((exercise) => (
                  <button
                    key={exercise.exerciseId}
                    type="button"
                    onClick={() => restoreExercise(exercise.exerciseId)}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600"
                  >
                    + {exercise.name || exercise.exerciseId}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {group.type !== "choice" && (
        <div className="mt-4 rounded-2xl border border-gray-100 p-3">
          <label htmlFor="daily-custom-exercise" className="text-[12px] font-bold text-gray-700">
            원하는 운동 직접 추가
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="daily-custom-exercise"
              value={newExerciseName}
              onChange={(event) => setNewExerciseName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addExercise();
                }
              }}
              maxLength={40}
              placeholder="예: 의자 스쿼트"
              className="min-w-0 flex-1 rounded-xl bg-gray-50 px-3 py-2.5 text-[13px] outline-none ring-1 ring-gray-100 focus:ring-[#7F77DD]"
            />
            <button
              type="button"
              onClick={() => addExercise()}
              disabled={!newExerciseName.trim()}
              className="rounded-xl bg-[#534AB7] px-4 py-2.5 text-[12px] font-bold text-white disabled:bg-gray-300"
            >
              추가
            </button>
          </div>
          <p className="mt-2 text-[10px] text-gray-500">
            직접 추가한 운동은 기본 10회 × 2세트로 시작합니다. 자세한 횟수는 주간 운동표에서 바꿀 수 있어요.
          </p>
        </div>
      )}

      {notice && (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[12px] font-bold text-emerald-700">
          {notice}
        </p>
      )}
    </section>
  );
}
