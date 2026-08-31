"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DIET_GOAL_CHECK_ITEMS,
  DIET_STATUS_LABELS,
  FASTING_STATUS_LABELS,
  formatDinnerCarbRecord,
  formatLunchCarbRecord,
  formatLunchProteinRecord,
  getLocalDateKey,
} from "../data/dietPlans";
import {
  CONDITION_SIGNAL_OPTIONS,
  RECOVERY_REASON_LABELS,
} from "../data/recoveryMode";
import {
  FOAM_ROLLER_AREAS,
  FOAM_ROLLER_TIMING_LABELS,
  FoamRollerTiming,
} from "../data/foamRoller";
import {
  isCardioDone,
  isPullupDone,
  isWorkoutDone,
  isWorkoutPerformed,
  removeCardioRecord,
  removeFoamRollerRecord,
  removeGeneralWorkoutRecord,
  removePullupRecord,
  WorkoutDifficulty,
  WorkoutOverallStatus,
  WorkoutDayRecord,
  WORKOUT_COMPLETED_DAYS_KEY,
} from "../data/workoutCompletion";
import {
  DAILY_NOTES_KEY,
  DailyNotesStore,
  RecordStores,
  getDietGoalCount,
  hasSafetyAlert,
  isDietSuccess,
  readRecordStores,
  writeJson,
} from "../data/recordStorage";
import BodyRecordCard from "./BodyRecordCard";
import MonthlySummaryCard from "./MonthlySummaryCard";
import RecordDashboard from "./RecordDashboard";
import WeightChart from "./WeightChart";

const weekDays = ["일", "월", "화", "수", "목", "금", "토"];
function parseKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function formatKoreanDate(key: string) {
  const d = parseKey(key);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function getCalendarCells(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1).getDay();
  const lastDate = new Date(year, monthIndex + 1, 0).getDate();
  return [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: lastDate }, (_, idx) =>
      getLocalDateKey(new Date(year, monthIndex, idx + 1)),
    ),
  ];
}

export default function RecordCalendarView() {
  const todayKey = getLocalDateKey();
  const today = parseKey(todayKey);
  const [visible, setVisible] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selected, setSelected] = useState(todayKey);
  const [stores, setStores] = useState<RecordStores | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingWorkout, setEditingWorkout] = useState(false);
  const [workoutStatusDraft, setWorkoutStatusDraft] = useState<WorkoutOverallStatus>("completed");
  const [workoutDifficultyDraft, setWorkoutDifficultyDraft] = useState<WorkoutDifficulty>("moderate");
  const [workoutFatigueDraft, setWorkoutFatigueDraft] = useState(2);
  const [workoutPainDraft, setWorkoutPainDraft] = useState(false);
  const [workoutMemoDraft, setWorkoutMemoDraft] = useState("");
  const [exerciseRecordsDraft, setExerciseRecordsDraft] = useState<WorkoutDayRecord["workoutExerciseRecords"]>([]);
  const [workoutNotice, setWorkoutNotice] = useState("");
  const [manualExerciseName, setManualExerciseName] = useState("");
  const [manualSets, setManualSets] = useState(1);
  const [manualReps, setManualReps] = useState(0);
  const [manualMinutes, setManualMinutes] = useState(0);
  const [editingSecondary, setEditingSecondary] = useState<"cardio" | "pullup" | "foam" | null>(null);
  const [cardioTypeDraft, setCardioTypeDraft] = useState("");
  const [cardioMinutesDraft, setCardioMinutesDraft] = useState(20);
  const [cardioMemoDraft, setCardioMemoDraft] = useState("");
  const [pullupStageDraft, setPullupStageDraft] = useState(1);
  const [pullupPainDraft, setPullupPainDraft] = useState(false);
  const [pullupMemoDraft, setPullupMemoDraft] = useState("");
  const [foamTimingDraft, setFoamTimingDraft] = useState<FoamRollerTiming>("before");
  const [foamAreasDraft, setFoamAreasDraft] = useState<string[]>([]);
  const [foamPainDraft, setFoamPainDraft] = useState(false);
  const [foamMemoDraft, setFoamMemoDraft] = useState("");
  useEffect(() => setStores(readRecordStores()), []);
  useEffect(
    () => setNoteDraft(stores?.notes[selected] || ""),
    [stores?.notes, selected],
  );
  const cells = useMemo(
    () => getCalendarCells(visible.getFullYear(), visible.getMonth()),
    [visible],
  );
  const selectedWorkout = stores?.workouts[selected];
  const selectedWorkoutRecord =
    typeof selectedWorkout === "object" && selectedWorkout
      ? selectedWorkout
      : undefined;
  useEffect(() => {
    setEditingWorkout(false);
    setEditingSecondary(null);
    setWorkoutStatusDraft(selectedWorkoutRecord?.workoutStatus || (selectedWorkoutRecord?.workoutDone ? "completed" : "stopped"));
    setWorkoutDifficultyDraft(selectedWorkoutRecord?.workoutDifficulty || "moderate");
    setWorkoutFatigueDraft(selectedWorkoutRecord?.workoutFatigue || 2);
    setWorkoutPainDraft(Boolean(selectedWorkoutRecord?.workoutPain));
    setWorkoutMemoDraft(selectedWorkoutRecord?.workoutMemo || "");
    setExerciseRecordsDraft(selectedWorkoutRecord?.workoutExerciseRecords || []);
    setCardioTypeDraft(selectedWorkoutRecord?.cardioType || "");
    setCardioMinutesDraft(selectedWorkoutRecord?.cardioMinutes || 20);
    setCardioMemoDraft(selectedWorkoutRecord?.cardioMemo || "");
    setPullupStageDraft(selectedWorkoutRecord?.pullupStage || 1);
    setPullupPainDraft(Boolean(selectedWorkoutRecord?.pullupPain));
    setPullupMemoDraft(selectedWorkoutRecord?.pullupMemo || "");
    setFoamTimingDraft(selectedWorkoutRecord?.foamRollerTiming || "before");
    setFoamAreasDraft(selectedWorkoutRecord?.foamRollerAreas || []);
    setFoamPainDraft(Boolean(selectedWorkoutRecord?.foamRollerPain));
    setFoamMemoDraft(selectedWorkoutRecord?.foamRollerMemo || "");
  }, [selected, selectedWorkoutRecord]);
  if (!stores)
    return (
      <div className="rounded-2xl bg-white p-4 text-[13px] text-gray-500">
        기록을 불러오는 중...
      </div>
    );
  const moveMonth = (delta: number) =>
    setVisible(new Date(visible.getFullYear(), visible.getMonth() + delta, 1));
  const saveNote = () => {
    const next: DailyNotesStore = { ...stores.notes };
    if (noteDraft.trim()) next[selected] = noteDraft.trim();
    else delete next[selected];
    writeJson(DAILY_NOTES_KEY, next);
    setStores({ ...stores, notes: next });
  };
  const selectedDiet = stores.diet[selected];
  const selectedRecovery = stores.recovery[selected];
  const selectedCondition = stores.conditions[selected];
  const conditionSignalLabels =
    selectedCondition?.signals.map(
      (signal) =>
        CONDITION_SIGNAL_OPTIONS.find((option) => option.id === signal)?.label ??
        signal,
    ) ?? [];
  const workoutPlanName = selectedWorkoutRecord?.workoutPlanName;
  const workoutGroupName = selectedWorkoutRecord?.workoutRoutineName;
  const workoutSourceDay = selectedWorkoutRecord?.workoutSourceDay;
  const workoutExerciseNames =
    selectedWorkoutRecord?.workoutExerciseNames ?? [];
  const workoutExerciseRecords =
    selectedWorkoutRecord?.workoutExerciseRecords ?? [];
  const partialCompletionPoint = selectedWorkoutRecord?.workoutStatus === "partial"
    ? [...workoutExerciseRecords].reverse().find((record) => record.status === "completed" || record.status === "partial")?.exerciseName
    : undefined;
  const pullupExerciseNames = selectedWorkoutRecord?.pullupExerciseNames ?? [];
  const selectedWater = stores.water[selected] || 0;
  const selectedDinner = stores.dinner[selected];
  const selectedDinnerCarb = formatDinnerCarbRecord(
    stores.dinnerCarbs[selected],
  );
  const selectedLunchCarb = formatLunchCarbRecord(stores.lunchCarbs[selected]);
  const selectedLunchProtein = formatLunchProteinRecord(
    stores.lunchProteins[selected],
  );
  const hasRosaryCardio = Boolean(selectedWorkoutRecord?.rosaryCardioDone);
  const hasPostWorkoutCardio = Boolean(
    selectedWorkoutRecord?.postWorkoutCardioDone || selectedWorkoutRecord?.postWorkoutCardioMinutes,
  );
  const foamTimingLabel = selectedWorkoutRecord?.foamRollerTiming ? FOAM_ROLLER_TIMING_LABELS[selectedWorkoutRecord.foamRollerTiming] : undefined;
  const anyRecord = Boolean(
    selectedDiet ||
    stores.workouts[selected] ||
    selectedRecovery ||
    selectedCondition ||
    selectedWater ||
    selectedDinner ||
    stores.weights[selected] ||
    stores.inbody[selected] ||
    stores.notes[selected] ||
    stores.dinnerCarbs[selected] ||
    stores.lunchCarbs[selected] ||
    stores.lunchProteins[selected],
  );
  const writeWorkoutStore = (workouts: RecordStores["workouts"]) => {
    writeJson(WORKOUT_COMPLETED_DAYS_KEY, workouts);
    setStores({ ...stores, workouts });
  };
  const saveWorkoutEdit = () => {
    if (!selectedWorkoutRecord) return;
    const exerciseRecords = exerciseRecordsDraft || [];
    const workoutExerciseNames = exerciseRecords.length
      ? exerciseRecords.map((record) => record.exerciseName)
      : selectedWorkoutRecord.workoutExerciseNames;
    writeWorkoutStore({
      ...stores.workouts,
      [selected]: {
        ...selectedWorkoutRecord,
        workoutDone: workoutStatusDraft === "completed",
        workoutStatus: workoutStatusDraft,
        workoutDifficulty: workoutDifficultyDraft,
        workoutFatigue: workoutFatigueDraft,
        workoutPain: workoutPainDraft,
        workoutMemo: workoutMemoDraft.trim() || undefined,
        workoutExerciseNames,
        workoutExerciseRecords: exerciseRecords.length ? exerciseRecords : undefined,
      },
    });
    setEditingWorkout(false);
    setWorkoutNotice("운동 기록을 수정했습니다.");
  };
  const addManualExercise = () => {
    const exerciseName = manualExerciseName.trim();
    if (!exerciseName) return;
    const sets = manualSets > 0 ? Array.from({ length: manualSets }, (_, index) => ({ setNumber: index + 1, completed: true, ...(manualReps > 0 ? { reps: manualReps } : {}) })) : undefined;
    setExerciseRecordsDraft((records) => [...(records || []), { exerciseName, status: "completed", sets, durationMinutes: manualMinutes > 0 ? manualMinutes : undefined }]);
    setManualExerciseName("");
    setManualSets(1);
    setManualReps(0);
    setManualMinutes(0);
  };
  const startNewWorkoutRecord = () => {
    if (selected > todayKey) return;
    setWorkoutStatusDraft("completed");
    setWorkoutDifficultyDraft("moderate");
    setWorkoutFatigueDraft(2);
    setWorkoutPainDraft(false);
    setWorkoutMemoDraft("");
    setExerciseRecordsDraft([]);
    setEditingWorkout(true);
  };
  const saveNewWorkoutRecord = () => {
    if (selected > todayKey || !exerciseRecordsDraft?.length) return;
    const exerciseNames = exerciseRecordsDraft.map((record) => record.exerciseName);
    writeWorkoutStore({ ...stores.workouts, [selected]: { ...(selectedWorkoutRecord || {}), workoutDone: workoutStatusDraft === "completed", workoutRoutineName: "나중에 직접 기록", workoutExerciseNames: exerciseNames, workoutPain: workoutPainDraft, workoutMemo: workoutMemoDraft.trim() || undefined, workoutStatus: workoutStatusDraft, workoutDifficulty: workoutDifficultyDraft, workoutFatigue: workoutFatigueDraft, workoutExerciseRecords: exerciseRecordsDraft } });
    setEditingWorkout(false);
    setWorkoutNotice("선택한 날짜에 운동 기록을 추가했습니다.");
  };
  const deleteWorkoutRecord = () => {
    if (!selectedWorkoutRecord || !window.confirm("선택한 날짜의 일반 운동 기록을 삭제할까요? 유산소·폼롤러·철봉 기록은 유지됩니다.")) return;
    const nextRecord = removeGeneralWorkoutRecord(selectedWorkoutRecord);
    const workouts = { ...stores.workouts };
    if (Object.keys(nextRecord).length) workouts[selected] = nextRecord;
    else delete workouts[selected];
    writeWorkoutStore(workouts);
    setWorkoutNotice("일반 운동 기록을 삭제했습니다.");
  };
  const saveSecondaryEdit = (kind: "cardio" | "pullup" | "foam") => {
    if (!selectedWorkoutRecord) return;
    const patch: Partial<WorkoutDayRecord> = kind === "cardio"
      ? { cardioDone: true, cardioType: cardioTypeDraft.trim() || "유산소", cardioMinutes: Math.max(1, cardioMinutesDraft), cardioMemo: cardioMemoDraft.trim() || undefined }
      : kind === "pullup"
        ? { pullupDone: true, pullupStage: Math.min(5, Math.max(1, pullupStageDraft)), pullupPain: pullupPainDraft, pullupMemo: pullupMemoDraft.trim() || undefined }
        : { foamRollerDone: true, foamRollerTiming: foamTimingDraft, foamRollerAreas: foamAreasDraft, foamRollerPain: foamPainDraft, foamRollerMemo: foamMemoDraft.trim() || undefined };
    writeWorkoutStore({
      ...stores.workouts,
      [selected]: { ...selectedWorkoutRecord, ...patch },
    });
    setEditingSecondary(null);
    setWorkoutNotice(`${kind === "cardio" ? "유산소" : kind === "pullup" ? "철봉" : "폼롤러"} 기록을 수정했습니다.`);
  };
  const deleteSecondaryRecord = (kind: "cardio" | "pullup" | "foam") => {
    if (!selectedWorkoutRecord) return;
    const label = kind === "cardio" ? "유산소" : kind === "pullup" ? "철봉" : "폼롤러";
    if (!window.confirm(`선택한 날짜의 ${label} 기록만 삭제할까요? 다른 기록은 유지됩니다.`)) return;
    const nextRecord = kind === "cardio"
      ? removeCardioRecord(selectedWorkoutRecord)
      : kind === "pullup"
        ? removePullupRecord(selectedWorkoutRecord)
        : removeFoamRollerRecord(selectedWorkoutRecord);
    const workouts = { ...stores.workouts };
    if (Object.keys(nextRecord).length) workouts[selected] = nextRecord;
    else delete workouts[selected];
    writeWorkoutStore(workouts);
    setEditingSecondary(null);
    setWorkoutNotice(`${label} 기록을 삭제했습니다.`);
  };
  return (
    <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
      <RecordDashboard
        stores={stores}
        year={visible.getFullYear()}
        monthIndex={visible.getMonth()}
      />
      <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => moveMonth(-1)}
            className="rounded-xl bg-gray-50 px-3 py-2 text-[13px] font-bold text-gray-600"
          >
            이전
          </button>
          <h2 className="text-[18px] font-bold text-gray-900">
            {visible.getFullYear()}년 {visible.getMonth() + 1}월
          </h2>
          <button
            onClick={() => moveMonth(1)}
            className="rounded-xl bg-gray-50 px-3 py-2 text-[13px] font-bold text-gray-600"
          >
            다음
          </button>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1 text-center">
          {weekDays.map((day) => (
            <div key={day} className="py-1 text-[11px] font-bold text-gray-400">
              {day}
            </div>
          ))}
          {cells.map((key, idx) => {
            if (!key) return <div key={`blank-${idx}`} />;
            const isToday = key === todayKey;
            const isSelected = key === selected;
            const dietSuccess = isDietSuccess(stores.diet[key]);
            const conditionRecommendation =
              stores.conditions[key]?.recommendation;
            const badges = [
              stores.recovery[key]?.completedAsRecovery
                ? "회"
                : typeof stores.workouts[key] === "object" && stores.workouts[key]?.workoutStatus === "partial"
                  ? "부"
                  : typeof stores.workouts[key] === "object" && stores.workouts[key]?.workoutStatus === "stopped"
                    ? "중"
                    : isWorkoutDone(stores.workouts[key])
                      ? "운"
                      : "",
              isCardioDone(stores.workouts[key]) ? "유" : "",
              stores.recovery[key]?.recoveryPriorityOnly ? "휴" : "",
              dietSuccess ? "식" : "",
              (stores.water[key] || 0) >= 2000 ? "💧" : "",
              stores.weights[key] ? "W" : "",
              stores.inbody[key] ? "I" : "",
              stores.notes[key] ? "✎" : "",
              hasSafetyAlert(stores.diet[key]) ? "⚠" : "",
              isPullupDone(stores.workouts[key]) ? "철" : "",
              (typeof stores.workouts[key] === "object" && stores.workouts[key]?.foamRollerDone) ? "폼" : "",
              conditionRecommendation === "normal"
                ? "컨정"
                : conditionRecommendation === "70%"
                  ? "컨70"
                  : conditionRecommendation === "recovery"
                    ? "컨회"
                    : "",
            ].filter(Boolean);
            return (
              <button
                key={key}
                onClick={() => { setSelected(key); setWorkoutNotice(""); }}
                className={`min-h-[56px] rounded-lg border p-1 text-left transition sm:min-h-[68px] sm:rounded-xl sm:p-1.5 ${isSelected ? "border-[#534AB7] bg-[#EEEDFE]" : isToday ? "border-[#AFA9EC] bg-white" : "border-gray-100 bg-gray-50"}`}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${isToday ? "bg-[#534AB7] text-white" : "text-gray-700"}`}
                >
                  {Number(key.slice(8))}
                </span>
                <div className="mt-1 flex flex-wrap gap-0.5">
                  {badges.map((badge, i) => (
                    <span
                      key={`${badge}-${i}`}
                      className="rounded-full bg-white px-1 text-[9px] font-bold text-gray-600 shadow-sm"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        <details className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
          <summary className="cursor-pointer font-bold text-gray-600">달력 표시 뜻 보기</summary>
          <p className="mt-2 leading-5">
            운=일반 운동 완료, 부=일부 완료, 중=중단, 유=유산소, 철=철봉, 회=회복 운동, 휴=회복 우선, 식=식단
            목표 달성, 폼=폼롤러, 컨정·컨70·컨회=컨디션 판정, 💧=물 2L,
            W=체중, I=인바디, ✎=메모, ⚠=안전 증상
          </p>
        </details>
      </section>
      <MonthlySummaryCard
        year={visible.getFullYear()}
        monthIndex={visible.getMonth()}
        stores={stores}
      />
      <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm sm:p-5">
        <p className="text-[12px] font-semibold text-[#534AB7]">
          선택 날짜 상세
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[18px] font-bold text-gray-900">{formatKoreanDate(selected)}</h3>
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${selected <= todayKey ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
            {selected <= todayKey ? "운동 기록 가능" : "미래 날짜"}
          </span>
        </div>
        {!anyRecord && (
          <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[13px] text-gray-500">
            기록이 없습니다.
          </p>
        )}
        <div className="mt-3 grid grid-cols-1 gap-2 text-[12px] text-gray-700 sm:grid-cols-2">
          <div className="rounded-xl bg-gray-50 p-3">
            운동
            <br />
            <b>
              {selectedRecovery?.completedAsRecovery
                ? "회복 운동 완료"
                : selectedRecovery?.recoveryPriorityOnly
                  ? "회복 우선 기록"
                  : selectedWorkoutRecord?.workoutStatus === "partial"
                    ? "일부 완료"
                    : selectedWorkoutRecord?.workoutStatus === "stopped"
                      ? "중단"
                      : isWorkoutDone(selectedWorkout)
                        ? selectedWorkoutRecord?.workoutRoutineName || "일반 운동 완료"
                        : "미완료"}
            </b>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            회복 우선
            <br />
            <b>
              {selectedRecovery?.recoveryMode ||
              selectedRecovery?.recoveryPriorityOnly
                ? "회복 우선일"
                : "아님"}
            </b>
            {selectedRecovery?.reasons?.length ? (
              <p className="mt-1">
                사유:{" "}
                {selectedRecovery.reasons
                  .map(
                    (reason) =>
                      RECOVERY_REASON_LABELS[
                        reason as keyof typeof RECOVERY_REASON_LABELS
                      ] || reason,
                  )
                  .join(" / ")}
              </p>
            ) : null}
            {selectedRecovery?.recoveryMemo && (
              <p className="mt-1">메모: {selectedRecovery.recoveryMemo}</p>
            )}
          </div>
          <div
            className={`rounded-xl p-3 sm:col-span-2 ${
              !selectedCondition
                ? "bg-gray-50 text-gray-700"
                : selectedCondition.recommendation === "recovery"
                ? "bg-red-50 text-red-900"
                : selectedCondition.recommendation === "70%"
                  ? "bg-amber-50 text-amber-900"
                  : "bg-emerald-50 text-emerald-900"
            }`}
          >
            운동 전 컨디션
            <br />
            <b>
              {selectedCondition
                ? selectedCondition.recommendation === "normal"
                  ? "정상 강도"
                  : selectedCondition.recommendation === "70%"
                    ? "약 70%로 조절"
                    : "회복 우선"
                : "미기록"}
            </b>
            {conditionSignalLabels.length ? (
              <p className="mt-1">선택 상태: {conditionSignalLabels.join(" · ")}</p>
            ) : null}
            {selectedCondition?.memo ? (
              <p className="mt-1">메모: {selectedCondition.memo}</p>
            ) : null}
          </div>
          {hasRosaryCardio && (
            <div className="rounded-xl bg-gray-50 p-3 sm:col-span-2">
              운동 전: 묵주기도 슬라이딩보드
              <br />
              <b>시간: {selectedWorkoutRecord?.rosaryCardioMinutes ?? 20}분</b>
              <br />
              <b>묵주기도: {selectedWorkoutRecord?.rosaryDecades ?? 5}단</b>
            </div>
          )}
          {hasPostWorkoutCardio && (
            <div className="rounded-xl bg-gray-50 p-3 sm:col-span-2">
              운동 후: 슬라이딩보드 마무리
              <br />
              <b>시간: {selectedWorkoutRecord?.postWorkoutCardioMinutes}분</b>
            </div>
          )}
          <div className="rounded-xl bg-gray-50 p-3 sm:col-span-2">
            운동 완료 상세
            <br />
            {workoutPlanName && (
              <p className="mb-1 text-[11px] font-bold text-[#27500A]">
                계획: {workoutPlanName}
              </p>
            )}
            {workoutGroupName && (
              <p className="mb-1 text-[11px] font-bold text-[#534AB7]">
                운동: {workoutGroupName}
              </p>
            )}
            {workoutSourceDay && (
              <p className="mb-1 text-[11px] font-bold text-[#534AB7]">
                수행 루틴 요일: {workoutSourceDay}
              </p>
            )}
            <b>
              {isWorkoutDone(selectedWorkout) || selectedWorkoutRecord?.workoutStatus
                ? workoutExerciseNames.length
                  ? workoutExerciseNames.join(" · ")
                  : selectedWorkoutRecord?.workoutStatus === "partial"
                    ? "일부 완료 기록"
                    : selectedWorkoutRecord?.workoutStatus === "stopped"
                      ? "중단 기록"
                      : "운동 이름 기록 없음"
                : "미기록"}
            </b>
            {isWorkoutPerformed(selectedWorkout) &&
              selectedWorkoutRecord?.workoutPain && (
                <p className="mt-1 font-bold text-red-600">
                  운동 통증 기록 있음 · 다음 운동은 강도를 낮추세요.
                </p>
              )}
            {selectedWorkoutRecord?.workoutStatus &&
              selectedWorkoutRecord?.workoutMemo && (
                <p className="mt-2 rounded-lg bg-white px-2 py-1 text-[11px] text-gray-600">
                  메모: {selectedWorkoutRecord.workoutMemo}
                </p>
              )}
            {selectedWorkoutRecord?.workoutStatus && (
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                <span className="rounded-full bg-[#EEEDFE] px-2.5 py-1 text-[#3C3489]">{selectedWorkoutRecord.workoutStatus === "partial" ? "일부 완료" : selectedWorkoutRecord.workoutStatus === "stopped" ? "중단" : "완료"}</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{selectedWorkoutRecord.workoutDifficulty === "easy" ? "쉬움" : selectedWorkoutRecord.workoutDifficulty === "hard" ? "힘듦" : "적당함"}</span>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">피로도 {selectedWorkoutRecord.workoutFatigue ?? 2}/5</span>
              </div>
            )}
            {partialCompletionPoint ? <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">일부 완료 지점: {partialCompletionPoint}까지 기록</p> : null}
            {selectedWorkoutRecord?.workoutStatus ? <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
              <button type="button" onClick={() => setEditingWorkout((value) => !value)} className="min-h-11 rounded-xl bg-[#534AB7] px-4 py-3 text-[13px] font-bold text-white">{editingWorkout ? "수정 화면 닫기" : "이 운동 기록 수정하기"}</button>
              <button type="button" onClick={deleteWorkoutRecord} className="min-h-11 rounded-xl bg-red-50 px-4 py-3 text-[12px] font-bold text-red-600">기록 삭제</button>
            </div> : selected <= todayKey ? <div className="mt-4 rounded-xl bg-[#F7F6FF] p-3"><p className="text-[12px] font-bold text-[#3C3489]">이날 한 운동을 지금 기록할 수 있어요.</p><button type="button" onClick={startNewWorkoutRecord} className="mt-2 min-h-12 w-full rounded-xl bg-[#534AB7] px-4 py-3 text-[14px] font-bold text-white">운동 기록 시작하기</button></div> : <p className="mt-3 rounded-xl bg-gray-100 px-3 py-3 text-[12px] font-bold text-gray-500">미래 날짜는 아직 기록할 수 없어요.</p>}
            {workoutNotice ? <p role="status" className="mt-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-bold text-emerald-700">{workoutNotice}</p> : null}
          </div>
          {editingWorkout ? <div className="rounded-2xl border-2 border-[#D9D6FF] bg-white p-4 sm:col-span-2">
            <p className="text-[16px] font-bold text-[#3C3489]">{selectedWorkoutRecord?.workoutStatus ? "운동 기록 고치기" : "지난 운동 기록하기"}</p>
            <p className="mt-1 text-[12px] text-gray-500">아래 순서대로 선택하고 저장하세요.</p>
            <p className="mt-4 text-[13px] font-bold text-gray-800"><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#534AB7] text-white">1</span>운동 결과 선택</p>
            <div className="mt-1 grid grid-cols-3 gap-2">{([['completed', '완료'], ['partial', '일부 완료'], ['stopped', '중단']] as [WorkoutOverallStatus, string][]).map(([value, label]) => <button key={value} type="button" onClick={() => setWorkoutStatusDraft(value)} className={`rounded-lg px-2 py-2 text-[11px] font-bold ${workoutStatusDraft === value ? 'bg-[#534AB7] text-white' : 'bg-gray-50 text-gray-600'}`}>{label}</button>)}</div>
            <p className="mt-3 text-[11px] font-bold text-gray-600">난이도</p>
            <div className="mt-1 grid grid-cols-3 gap-2">{([['easy', '쉬움'], ['moderate', '적당함'], ['hard', '힘듦']] as [WorkoutDifficulty, string][]).map(([value, label]) => <button key={value} type="button" onClick={() => setWorkoutDifficultyDraft(value)} className={`rounded-lg px-2 py-2 text-[11px] font-bold ${workoutDifficultyDraft === value ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-600'}`}>{label}</button>)}</div>
            <details className="mt-3 rounded-xl bg-gray-50 p-3"><summary className="cursor-pointer text-[12px] font-bold text-gray-600">피로도·통증·메모 더 적기</summary><label className="mt-3 block text-[11px] font-bold text-gray-600">피로도 {workoutFatigueDraft}/5<input type="range" min={1} max={5} value={workoutFatigueDraft} onChange={(event) => setWorkoutFatigueDraft(Number(event.target.value))} className="mt-2 block w-full accent-[#534AB7]" /></label><label className="mt-3 flex items-center gap-2 text-[11px] font-bold text-gray-600"><input type="checkbox" checked={workoutPainDraft} onChange={(event) => setWorkoutPainDraft(event.target.checked)} className="h-4 w-4 accent-red-600" />통증 있음</label><textarea value={workoutMemoDraft} onChange={(event) => setWorkoutMemoDraft(event.target.value)} placeholder="운동 메모" className="mt-2 min-h-16 w-full rounded-xl border border-gray-200 px-3 py-2 text-[12px]" /></details>
            <div className="mt-4 rounded-xl bg-[#F7F6FF] p-3"><p className="text-[13px] font-bold text-[#3C3489]"><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#534AB7] text-white">2</span>실제로 한 운동 추가</p><input value={manualExerciseName} onChange={(event) => setManualExerciseName(event.target.value)} placeholder="운동 이름 (예: 버드독)" className="mt-3 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px]" /><div className="mt-2 grid grid-cols-3 gap-2"><label className="text-[10px] font-bold text-gray-500">몇 세트<input type="number" min={0} value={manualSets} onChange={(event) => setManualSets(Math.max(0, Number(event.target.value) || 0))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 px-2 py-2 text-right text-[12px]" /></label><label className="text-[10px] font-bold text-gray-500">한 세트 횟수<input type="number" min={0} value={manualReps} onChange={(event) => setManualReps(Math.max(0, Number(event.target.value) || 0))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 px-2 py-2 text-right text-[12px]" /></label><label className="text-[10px] font-bold text-gray-500">몇 분<input type="number" min={0} value={manualMinutes} onChange={(event) => setManualMinutes(Math.max(0, Number(event.target.value) || 0))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 px-2 py-2 text-right text-[12px]" /></label></div><button type="button" disabled={!manualExerciseName.trim()} onClick={addManualExercise} className="mt-3 min-h-11 w-full rounded-xl bg-white px-3 py-2 text-[12px] font-bold text-[#534AB7] disabled:text-gray-300">이 운동 추가하기</button></div>
            {exerciseRecordsDraft?.length ? <div className="mt-3 space-y-2"><p className="text-[11px] font-bold text-gray-600">운동별 결과</p>{exerciseRecordsDraft.map((record, index) => <div key={`${record.exerciseName}-${index}`} className="rounded-xl bg-gray-50 p-2"><p className="text-[11px] font-bold text-gray-800">{record.exerciseName}</p><div className="mt-1 grid grid-cols-4 gap-1">{([['completed', '완료'], ['partial', '부분'], ['skipped', '건너뜀'], ['pending', '미완료']] as [typeof record.status, string][]).map(([value, label]) => <button key={value} type="button" onClick={() => setExerciseRecordsDraft((records) => records?.map((item, recordIndex) => recordIndex === index ? { ...item, status: value } : item))} className={`rounded-lg px-1 py-1.5 text-[10px] font-bold ${record.status === value ? 'bg-[#534AB7] text-white' : 'bg-white text-gray-500'}`}>{label}</button>)}</div></div>)}</div> : null}
            <p className="mt-4 text-[13px] font-bold text-gray-800"><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#534AB7] text-white">3</span>기록 저장</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={!selectedWorkoutRecord?.workoutStatus && !exerciseRecordsDraft?.length} onClick={selectedWorkoutRecord?.workoutStatus ? saveWorkoutEdit : saveNewWorkoutRecord} className="min-h-12 rounded-xl bg-[#534AB7] px-3 py-3 text-[13px] font-bold text-white disabled:bg-gray-200">{selectedWorkoutRecord?.workoutStatus ? "바뀐 기록 저장" : "운동 기록 저장"}</button><button type="button" onClick={() => setEditingWorkout(false)} className="min-h-12 rounded-xl bg-gray-100 px-3 py-3 text-[13px] font-bold text-gray-600">취소</button></div>
          </div> : null}
          {workoutExerciseRecords.length ? (
            <details className="rounded-xl bg-[#F7F6FF] p-3 sm:col-span-2">
              <summary className="cursor-pointer font-bold text-[#3C3489]">세트·횟수 상세 기록 보기</summary>
              <div className="mt-3 space-y-2">
                {workoutExerciseRecords.map((record, index) => (
                  <div key={`${record.exerciseName}-${index}`} className="rounded-xl bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <b>{record.exerciseName}</b>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${record.status === 'completed' ? 'bg-green-50 text-green-700' : record.status === 'partial' ? 'bg-amber-50 text-amber-700' : record.status === 'skipped' ? 'bg-gray-100 text-gray-500' : 'bg-gray-50 text-gray-500'}`}>
                        {record.status === 'completed' ? '완료' : record.status === 'partial' ? '부분 완료' : record.status === 'skipped' ? '건너뜀' : '미완료'}
                      </span>
                    </div>
                    {record.summary ? <p className="mt-1 text-[11px] text-gray-600">{record.summary}</p> : null}
                    {record.sets?.length ? (
                      <p className="mt-1 text-[11px] text-gray-500">
                        {record.sets.map((set) => {
                          const values = [
                            `${set.setNumber}세트${set.completed ? ' ✓' : ''}`,
                            set.reps !== undefined ? `${set.reps}회` : '',
                            set.leftReps !== undefined || set.rightReps !== undefined ? `좌 ${set.leftReps ?? '-'}회 · 우 ${set.rightReps ?? '-'}회` : '',
                            set.weightKg !== undefined ? `${set.weightKg}kg` : '',
                            set.durationSeconds !== undefined ? `${set.durationSeconds}초` : '',
                            set.bandLevel ? `밴드 ${set.bandLevel}` : '',
                            set.restAfterSeconds !== undefined ? `휴식 ${set.restAfterSeconds}초` : '',
                          ].filter(Boolean);
                          return values.join(' · ');
                        }).join(' / ')}
                      </p>
                    ) : null}
                    {record.durationMinutes !== undefined || record.distanceKm !== undefined || record.stepCount !== undefined ? (
                      <p className="mt-1 text-[11px] text-gray-500">
                        {[record.durationMinutes !== undefined ? `${record.durationMinutes}분` : '', record.distanceKm !== undefined ? `${record.distanceKm}km` : '', record.stepCount !== undefined ? `${record.stepCount.toLocaleString()}걸음` : ''].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                    {record.intervalWorkSeconds !== undefined || record.intervalRestSeconds !== undefined || record.intervalRounds !== undefined ? (
                      <p className="mt-1 text-[11px] text-gray-500">인터벌 {record.intervalWorkSeconds ?? '-'}초 운동 · {record.intervalRestSeconds ?? '-'}초 휴식 · {record.intervalRounds ?? '-'}회</p>
                    ) : null}
                    {record.painScore !== undefined ? <p className="mt-1 font-bold text-red-600">불편감 {record.painScore}/10</p> : null}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          {isCardioDone(selectedWorkout) && (
            <div className="rounded-xl bg-gray-50 p-3 sm:col-span-2">
              가벼운 유산소 완료
              <br />
              <b>
                {selectedWorkoutRecord?.cardioType || "선택 유산소"}{" "}
                {selectedWorkoutRecord?.cardioMinutes
                  ? `${selectedWorkoutRecord.cardioMinutes}분`
                  : ""}
              </b>
              {selectedWorkoutRecord?.cardioMemo && (
                <p className="mt-2 rounded-lg bg-white px-2 py-1 text-[11px] text-gray-600">
                  메모: {selectedWorkoutRecord.cardioMemo}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditingSecondary(editingSecondary === "cardio" ? null : "cardio")} className="rounded-lg bg-[#378ADD] px-3 py-2 text-[11px] font-bold text-white">유산소 기록 수정</button>
                <button type="button" onClick={() => deleteSecondaryRecord("cardio")} className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">유산소 기록 삭제</button>
              </div>
              {editingSecondary === "cardio" ? <div className="mt-3 rounded-xl border border-blue-100 bg-white p-3">
                <label className="block text-[11px] font-bold text-gray-600">유산소 종류<input value={cardioTypeDraft} onChange={(event) => setCardioTypeDraft(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-normal" /></label>
                <label className="mt-2 block text-[11px] font-bold text-gray-600">시간(분)<input type="number" min={1} max={300} value={cardioMinutesDraft} onChange={(event) => setCardioMinutesDraft(Number(event.target.value) || 1)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-normal" /></label>
                <label className="mt-2 block text-[11px] font-bold text-gray-600">메모<textarea value={cardioMemoDraft} onChange={(event) => setCardioMemoDraft(event.target.value)} className="mt-1 min-h-16 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>
                <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => saveSecondaryEdit("cardio")} className="rounded-lg bg-[#378ADD] px-3 py-2 font-bold text-white">수정 저장</button><button type="button" onClick={() => setEditingSecondary(null)} className="rounded-lg bg-gray-100 px-3 py-2 font-bold text-gray-600">취소</button></div>
              </div> : null}
            </div>
          )}

          {selectedWorkoutRecord?.foamRollerDone && (
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-900 sm:col-span-2">
              <b>{selectedWorkoutRecord.foamRollerPain ? "폼롤러 ⚠️ 통증 기록 있음" : "폼롤러 완료"}</b>
              <br />
              <span>시점: {foamTimingLabel || "미기록"}</span>
              <br />
              <span>부위: {selectedWorkoutRecord.foamRollerAreas?.length ? selectedWorkoutRecord.foamRollerAreas.join(" · ") : "미기록"}</span>
              <br />
              <span>통증: {selectedWorkoutRecord.foamRollerPain ? "있음" : "없음"}</span>
              {selectedWorkoutRecord.foamRollerMemo && (
                <p className="mt-2 rounded-lg bg-white px-2 py-1 text-[11px] text-gray-600">메모: {selectedWorkoutRecord.foamRollerMemo}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditingSecondary(editingSecondary === "foam" ? null : "foam")} className="rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white">폼롤러 기록 수정</button>
                <button type="button" onClick={() => deleteSecondaryRecord("foam")} className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">폼롤러 기록 삭제</button>
              </div>
              {editingSecondary === "foam" ? <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3 text-gray-700">
                <p className="text-[11px] font-bold">진행 시점</p><div className="mt-1 flex flex-wrap gap-1">{(Object.keys(FOAM_ROLLER_TIMING_LABELS) as FoamRollerTiming[]).map((timing) => <button key={timing} type="button" onClick={() => setFoamTimingDraft(timing)} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${foamTimingDraft === timing ? "bg-emerald-600 text-white" : "bg-gray-50 text-gray-600"}`}>{FOAM_ROLLER_TIMING_LABELS[timing]}</button>)}</div>
                <p className="mt-2 text-[11px] font-bold">진행 부위</p><div className="mt-1 flex flex-wrap gap-1">{FOAM_ROLLER_AREAS.map((area) => <button key={area} type="button" onClick={() => setFoamAreasDraft((areas) => areas.includes(area) ? areas.filter((item) => item !== area) : [...areas, area])} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${foamAreasDraft.includes(area) ? "bg-emerald-600 text-white" : "bg-gray-50 text-gray-600"}`}>{area}</button>)}</div>
                <label className="mt-2 flex items-center gap-2 text-[11px] font-bold"><input type="checkbox" checked={foamPainDraft} onChange={(event) => setFoamPainDraft(event.target.checked)} className="h-4 w-4 accent-red-600" />통증 있음</label>
                <label className="mt-2 block text-[11px] font-bold">메모<textarea value={foamMemoDraft} onChange={(event) => setFoamMemoDraft(event.target.value)} className="mt-1 min-h-16 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>
                <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => saveSecondaryEdit("foam")} className="rounded-lg bg-emerald-600 px-3 py-2 font-bold text-white">수정 저장</button><button type="button" onClick={() => setEditingSecondary(null)} className="rounded-lg bg-gray-100 px-3 py-2 font-bold text-gray-600">취소</button></div>
              </div> : null}
            </div>
          )}
          <div className="rounded-xl bg-gray-50 p-3 sm:col-span-2">
            철봉
            <br />
            <b>
              {isPullupDone(selectedWorkout)
                ? `철봉 ${selectedWorkoutRecord?.pullupStage ?? ""}단계 완료`
                : "미기록"}
            </b>
            {isPullupDone(selectedWorkout) &&
              selectedWorkoutRecord?.pullupPain && (
                <p className="mt-1 font-bold text-red-600">
                  철봉 통증 기록 있음 · 다음 운동은 강도를 낮추세요.
                </p>
              )}
            <p className="mt-1">
              {isPullupDone(selectedWorkout)
                ? pullupExerciseNames.length
                  ? pullupExerciseNames.join(" · ")
                  : "운동 이름 기록 없음"
                : ""}
            </p>
            {isPullupDone(selectedWorkout) &&
              selectedWorkoutRecord?.pullupMemo && (
                <p className="mt-2 rounded-lg bg-white px-2 py-1 text-[11px] text-gray-600">
                  메모: {selectedWorkoutRecord.pullupMemo}
                </p>
              )}
            {isPullupDone(selectedWorkout) ? <>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setEditingSecondary(editingSecondary === "pullup" ? null : "pullup")} className="rounded-lg bg-[#534AB7] px-3 py-2 text-[11px] font-bold text-white">철봉 기록 수정</button><button type="button" onClick={() => deleteSecondaryRecord("pullup")} className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">철봉 기록 삭제</button></div>
              {editingSecondary === "pullup" ? <div className="mt-3 rounded-xl border border-[#D9D6FF] bg-white p-3">
                <label className="block text-[11px] font-bold text-gray-600">철봉 단계<input type="number" min={1} max={5} value={pullupStageDraft} onChange={(event) => setPullupStageDraft(Number(event.target.value) || 1)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>
                <label className="mt-2 flex items-center gap-2 text-[11px] font-bold text-gray-600"><input type="checkbox" checked={pullupPainDraft} onChange={(event) => setPullupPainDraft(event.target.checked)} className="h-4 w-4 accent-red-600" />통증 있음</label>
                <label className="mt-2 block text-[11px] font-bold text-gray-600">메모<textarea value={pullupMemoDraft} onChange={(event) => setPullupMemoDraft(event.target.value)} className="mt-1 min-h-16 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>
                <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => saveSecondaryEdit("pullup")} className="rounded-lg bg-[#534AB7] px-3 py-2 font-bold text-white">수정 저장</button><button type="button" onClick={() => setEditingSecondary(null)} className="rounded-lg bg-gray-100 px-3 py-2 font-bold text-gray-600">취소</button></div>
              </div> : null}
            </> : null}
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            식단
            <br />
            <b>
              {selectedDiet?.dietStatus
                ? DIET_STATUS_LABELS[
                    selectedDiet.dietStatus as keyof typeof DIET_STATUS_LABELS
                  ]
                : "미기록"}
            </b>
            {selectedDiet?.dietMemo && (
              <p className="mt-1 text-[11px] text-gray-600">
                메모: {String(selectedDiet.dietMemo)}
              </p>
            )}
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            공복
            <br />
            <b>
              {selectedDiet?.fastingRecordStatus
                ? FASTING_STATUS_LABELS[
                    selectedDiet.fastingRecordStatus as keyof typeof FASTING_STATUS_LABELS
                  ]
                : selectedDiet?.fasting14h
                  ? "14시간 달성"
                  : hasSafetyAlert(selectedDiet)
                    ? "12시간 조절 가능"
                    : "미기록"}
            </b>
          </div>
          <div className="rounded-xl bg-gray-50 p-3 sm:col-span-2">
            기존 식단 목표
            <br />
            <b>
              {getDietGoalCount(selectedDiet)} / {DIET_GOAL_CHECK_ITEMS.length}
              개 완료
            </b>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            물 섭취
            <br />
            <b>{selectedWater.toLocaleString()}mL</b>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            저녁 18:30 이전
            <br />
            <b>
              {selectedDiet?.dinnerBefore1830
                ? "완료"
                : selectedDinner
                  ? `미달성(${selectedDinner})`
                  : "미기록"}
            </b>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            공복 타이머
            <br />
            <b>
              {selected === todayKey
                ? stores.fastingStart
                  ? `시작 ${stores.fastingStart} / 예상 종료 ${String((Number(stores.fastingStart.slice(0, 2)) + 14) % 24).padStart(2, "0")}${stores.fastingStart.slice(2)}`
                  : "미설정"
                : "개별 공복 기록 없음"}
            </b>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            안전 증상
            <br />
            <b>{hasSafetyAlert(selectedDiet) ? "기록 있음" : "없음"}</b>
          </div>
          <div className="rounded-xl bg-gray-50 p-3 sm:col-span-2">
            체중·인바디
            <br />
            <b>
              {stores.weights[selected]?.weight
                ? `${stores.weights[selected].weight.toFixed(1)}kg`
                : "체중 미기록"}
              {" · "}
              {stores.inbody[selected] ? "인바디 기록 있음" : "인바디 미기록"}
            </b>
          </div>
          <div className="rounded-xl bg-gray-50 p-3 sm:col-span-2">
            <span>{selectedLunchCarb.rice}</span>
            {selectedLunchCarb.carbs && (
              <>
                <br />
                <b>{selectedLunchCarb.carbs}</b>
              </>
            )}
            <br />
            <span>{selectedLunchProtein}</span>
            <p className="mt-1 text-[11px] text-gray-500">
              점심 밥량은 조리된 밥 무게이며, 참고 탄수화물은 단백질 합계에
              포함하지 않습니다.
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3 sm:col-span-2">
            <span>{selectedDinnerCarb.rice}</span>
            {selectedDinnerCarb.carbs && (
              <>
                <br />
                <b>{selectedDinnerCarb.carbs}</b>
              </>
            )}
            <p className="mt-1 text-[11px] text-gray-500">
              저녁 밥량은 조리된 밥 무게이며, 참고 탄수화물과 구분됩니다.
            </p>
          </div>
        </div>
      </section>
      <BodyRecordCard
        dateKey={selected}
        weights={stores.weights}
        inbody={stores.inbody}
        onChange={({ weights, inbody }) =>
          setStores({ ...stores, weights, inbody })
        }
      />
      <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm sm:p-5">
        <p className="text-[15px] font-bold text-gray-800">날짜별 메모</p>
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="오늘 컨디션, 허기, 운동 느낌 등을 적어주세요."
          className="mt-3 min-h-24 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={saveNote}
            className="flex-1 rounded-xl bg-[#534AB7] px-4 py-2 text-[13px] font-bold text-white"
          >
            저장
          </button>
          <button
            onClick={() => {
              setNoteDraft("");
              const next = { ...stores.notes };
              delete next[selected];
              writeJson(DAILY_NOTES_KEY, next);
              setStores({ ...stores, notes: next });
            }}
            className="rounded-xl bg-red-50 px-4 py-2 text-[13px] font-bold text-red-600"
          >
            삭제
          </button>
        </div>
      </section>
      <WeightChart
        weights={stores.weights}
        year={visible.getFullYear()}
        monthIndex={visible.getMonth()}
      />
    </div>
  );
}
