"use client";

import { useEffect, useState } from "react";
import { RoutineSelection, WORKOUT_ROUTINE_SELECTION_KEY } from "../data/workouts";
import {
  DEFAULT_WEEKLY_WORKOUT_PLAN_ID,
  getDayWorkoutForPlan,
  getWeeklyWorkoutPlanById,
  getWorkoutGroupForPlanDay,
  dayIdToPlanKey,
  LEGACY_SELECTED_WEEKLY_WORKOUT_PLAN_KEY,
  SELECTED_WEEKLY_WORKOUT_PLAN_KEY,
  WEEKLY_WORKOUT_PLANS,
} from "../data/workoutPlans";
import {
  getWeeklyWorkoutCompletion,
  getDateForWorkoutDay,
  getWorkoutDayForDate,
  getWorkoutRecord,
  readWorkoutCompletionStore,
  WORKOUT_COMPLETED_DAYS_KEY,
  WorkoutCompletionStore,
  WorkoutDayRecord,
  ExerciseRecord,
  WorkoutFeedback,
  WorkoutOverallStatus,
} from "../data/workoutCompletion";
import {
  assessRecoveryMode,
  clearDailyCondition,
  ConditionSignalId,
  DailyConditionRecord,
  readDailyCondition,
  RecoveryDayRecord,
  RecoveryModeStore,
  saveDailyCondition,
  saveRecoveryRecord,
  RECOVERY_MODE_DAYS_KEY,
} from "../data/recoveryMode";
import { readJson, writeJson } from "../data/recordStorage";
import { getLocalDateKey } from "../data/dietPlans";
import WeeklyView from "../components/WeeklyView";
import DayView from "../components/DayView";
import SafetyView from "../components/SafetyView";
import RecordCalendarView from "../components/RecordCalendarView";
import SwitchOnModePanel from "../components/SwitchOnModePanel";
import PullupTrainingView from "../components/PullupTrainingView";
import CloudSyncPanel from "../components/CloudSyncPanel";
import ConditionCheckCard from "../components/ConditionCheckCard";
import AuthGate from "../components/AuthGate";
import WorkoutPlanEditor from "../components/WorkoutPlanEditor";
import WorkoutNotificationManager from "../components/WorkoutNotificationManager";
import WorkoutNotificationPanel from "../components/WorkoutNotificationPanel";
import DataBackupPanel from "../components/DataBackupPanel";
import AppIdentity from "../components/AppIdentity";
import AppModuleNav from "../components/AppModuleNav";
import FitnessAiCoachPanel from "../components/FitnessAiCoachPanel";
import {
  applyDayRoutineEdit,
  applyExerciseTargets,
  EMPTY_USER_WORKOUT_SETTINGS,
  readUserWorkoutSettings,
  saveUserWorkoutSettings,
  UserWorkoutSettings,
} from "../data/userWorkoutSettings";
import { DEFAULT_WORKOUT_METHOD, normalizeWorkoutMethod } from "../data/workoutMethods";

type TabId =
  | "ov"
  | "sun"
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "pullup"
  | "record"
  | "more"
  | "tips";
type WorkoutDayId = Extract<
  TabId,
  "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"
>;

const TABS: { id: TabId; label: string }[] = [
  { id: "ov", label: "주간 개요" },
  { id: "sun", label: "일요일" },
  { id: "mon", label: "월요일" },
  { id: "tue", label: "화요일" },
  { id: "wed", label: "수요일" },
  { id: "thu", label: "목요일" },
  { id: "fri", label: "금요일" },
  { id: "sat", label: "토요일" },
  { id: "pullup", label: "철봉 훈련" },
  { id: "record", label: "기록" },
  { id: "more", label: "더보기" },
  { id: "tips", label: "주의사항" },
];

const WORKOUT_DAY_IDS: WorkoutDayId[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

const ACTIVE_TAB_SESSION_KEY = "ai-fitness-active-tab";

const PRIMARY_NAV: {
  id: "home" | "workout" | "record" | "more";
  label: string;
  emoji: string;
}[] = [
  { id: "home", label: "오늘", emoji: "⌂" },
  { id: "workout", label: "운동하기", emoji: "▶" },
  { id: "record", label: "기록보기", emoji: "▦" },
  { id: "more", label: "설정", emoji: "⚙" },
];

function FitnessApp() {
  const [activeTab, setActiveTab] = useState<TabId>("ov");
  const [routineSelection, setRoutineSelection] =
    useState<RoutineSelection>("base");
  const [selectedWeeklyWorkoutPlanId, setSelectedWeeklyWorkoutPlanId] = useState(
    DEFAULT_WEEKLY_WORKOUT_PLAN_ID,
  );
  const [completedStore, setCompletedStore] = useState<WorkoutCompletionStore>(
    {},
  );
  const [recoveryToday, setRecoveryToday] = useState<RecoveryDayRecord | null>(
    null,
  );
  const [conditionToday, setConditionToday] = useState<DailyConditionRecord>();
  const [showBaseRoutine, setShowBaseRoutine] = useState(false);
  const [userWorkoutSettings, setUserWorkoutSettings] = useState<UserWorkoutSettings>(EMPTY_USER_WORKOUT_SETTINGS);

  useEffect(() => {
    const savedTab = window.sessionStorage.getItem(ACTIVE_TAB_SESSION_KEY);
    if (savedTab && TABS.some((tab) => tab.id === savedTab)) {
      setActiveTab(savedTab as TabId);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedRoutine = window.localStorage.getItem(
      WORKOUT_ROUTINE_SELECTION_KEY,
    ) as RoutineSelection | null;
    const validRoutine = savedRoutine === "base" || savedRoutine === "recovery";
    setRoutineSelection(validRoutine ? savedRoutine : "base");
    if (savedRoutine && !validRoutine) {
      window.localStorage.setItem(WORKOUT_ROUTINE_SELECTION_KEY, "base");
    }

    const savedWeeklyPlan =
      window.localStorage.getItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY) ||
      window.localStorage.getItem(LEGACY_SELECTED_WEEKLY_WORKOUT_PLAN_KEY) ||
      DEFAULT_WEEKLY_WORKOUT_PLAN_ID;
    const validWeeklyPlan = WEEKLY_WORKOUT_PLANS.some(
      (plan) => plan.id === savedWeeklyPlan,
    );
    const weeklyPlanId = validWeeklyPlan
      ? savedWeeklyPlan
      : DEFAULT_WEEKLY_WORKOUT_PLAN_ID;
    setSelectedWeeklyWorkoutPlanId(weeklyPlanId);
    window.localStorage.setItem(
      SELECTED_WEEKLY_WORKOUT_PLAN_KEY,
      weeklyPlanId,
    );
    window.localStorage.removeItem(LEGACY_SELECTED_WEEKLY_WORKOUT_PLAN_KEY);

    setCompletedStore(readWorkoutCompletionStore());
    setUserWorkoutSettings(readUserWorkoutSettings());
    setConditionToday(readDailyCondition());
    setRecoveryToday(
      assessRecoveryMode(
        getLocalDateKey(),
        ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(activeTab)
          ? (activeTab as WorkoutDayId)
          : null,
      ),
    );
  }, [activeTab]);

  const handleRoutineSelectionChange = (value: RoutineSelection) => {
    setRoutineSelection(value);
    window.localStorage.setItem(WORKOUT_ROUTINE_SELECTION_KEY, value);
    if (value === "recovery") setShowBaseRoutine(false);
  };

  const handleWeeklyWorkoutPlanChange = (planId: string) => {
    setSelectedWeeklyWorkoutPlanId(planId);
    window.localStorage.setItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY, planId);
  };

  const handleUserWorkoutSettingsChange = (settings: UserWorkoutSettings) => {
    setUserWorkoutSettings(settings);
    saveUserWorkoutSettings(settings);
  };

  const handleConditionSave = (signals: ConditionSignalId[], memo: string) => {
    const dateKey = getLocalDateKey();
    setConditionToday(saveDailyCondition(dateKey, signals, memo));
    setRecoveryToday(assessRecoveryMode(dateKey, todayWorkoutDay));
  };

  const handleConditionClear = () => {
    const dateKey = getLocalDateKey();
    clearDailyCondition(dateKey);
    setConditionToday(undefined);
    setRecoveryToday(assessRecoveryMode(dateKey, todayWorkoutDay));
  };

  const saveDayWorkout = (dayId: WorkoutDayId, pain: boolean, memo: string, cardioOptionId?: string, exerciseRecords?: ExerciseRecord[], selectedCardioMinutes?: number, feedback?: WorkoutFeedback) => {
    const dateKey = getDateForWorkoutDay(dayId);
    if (
      recoveryToday?.recoveryMode &&
      !window.confirm(
        "오늘은 회복 우선으로 기록되어 있습니다. 회복 기록을 해제하고 운동 완료로 변경할까요?",
      )
    )
      return;
    const selectedOptionalCardio = dayWorkout?.optionalCardio?.options.find((option) => option.id === cardioOptionId);
    const plannedExerciseNames = selectedOptionalCardio
      ? selectedOptionalCardio.id === "rest"
        ? ["휴식"]
        : [
            ...(dayWorkout?.optionalCardio?.warmup.map((exercise) => exercise.name) ?? []),
            ...selectedOptionalCardio.exercises.map((exercise) => exercise.name),
            ...(dayWorkout?.optionalCardio?.cooldown.map((exercise) => exercise.name) ?? []),
          ]
      : dayWorkout?.phases
          .flatMap((phase) => phase.exercises)
          .map((exercise) => exercise.name) ?? [];
    const exerciseNames = exerciseRecords?.length
      ? exerciseRecords.map((record) => record.exerciseName)
      : plannedExerciseNames;
    const completedExerciseCount = exerciseRecords?.filter((record) => record.status === "completed").length ?? 0;
    const detailedWorkoutStatus: WorkoutOverallStatus | undefined = exerciseRecords?.length
      ? completedExerciseCount === exerciseRecords.length
        ? "completed"
        : completedExerciseCount > 0
          ? "partial"
          : "stopped"
      : undefined;
    const recordedWorkoutStatus: WorkoutOverallStatus = feedback?.status === "stopped"
      ? "stopped"
      : detailedWorkoutStatus || feedback?.status || "completed";
    setCompletedStore((prev) => {
      const current = getWorkoutRecord(prev[dateKey]);
      const hasRosaryCardio = exerciseNames.includes("운동 전 묵주기도 슬라이딩보드");
      const hasPostWorkoutCardio =
        exerciseNames.includes("운동 후 슬라이딩보드 마무리");
      const next = {
        ...prev,
        [dateKey]: {
          ...current,
          workoutDone: recordedWorkoutStatus === "completed",
          workoutRoutineName: selectedWorkoutGroup?.name || dayWorkout?.title,
          workoutPlanName: selectedWeeklyWorkoutPlan.name,
          workoutGroupId: selectedWorkoutGroup?.id,
          workoutExerciseNames: exerciseNames,
          workoutSourceDay: baseDayWorkout?.tabLabel,
          workoutPain: pain,
          workoutMemo: selectedOptionalCardio?.id === 'rest' ? (memo.trim() || '토요일 선택 휴식') : memo.trim() || undefined,
          workoutStatus: recordedWorkoutStatus,
          workoutDifficulty: feedback?.difficulty || current.workoutDifficulty || "moderate",
          workoutFatigue: feedback?.fatigue || current.workoutFatigue || 2,
          workoutExerciseRecords: exerciseRecords || current.workoutExerciseRecords,
          workoutMethod: dayWorkout?.optionalCardio ? undefined : { ...activeWorkoutMethod },
          workoutRecordedAt: new Date().toISOString(),
          rosaryCardioDone: hasRosaryCardio || undefined,
          rosaryCardioMinutes: hasRosaryCardio ? 20 : undefined,
          rosaryDecades: hasRosaryCardio ? 5 : undefined,
          postWorkoutCardioDone: hasPostWorkoutCardio || undefined,
          postWorkoutCardioMinutes: hasPostWorkoutCardio ? 5 : undefined,
          cardioDone: selectedOptionalCardio ? selectedOptionalCardio.id !== 'rest' : current.cardioDone,
          cardioType: selectedOptionalCardio?.id === 'rest' ? undefined : selectedOptionalCardio?.name || current.cardioType,
          cardioMinutes: selectedOptionalCardio?.id === 'rest' ? undefined : selectedOptionalCardio ? (selectedCardioMinutes || current.cardioMinutes) : current.cardioMinutes,
        },
      };
      window.localStorage.setItem(
        WORKOUT_COMPLETED_DAYS_KEY,
        JSON.stringify(next),
      );
      return next;
    });
    const saved = saveRecoveryRecord(dateKey, {
      recoveryMode: false,
      completedAsRecovery: false,
      recoveryPriorityOnly: false,
      reasons: [],
      intensity: "normal",
    });
    setRecoveryToday(saved);
  };

  const cancelDayWorkout = (dayId: WorkoutDayId) => {
    const dateKey = getDateForWorkoutDay(dayId);
    setCompletedStore((prev) => {
      const current = getWorkoutRecord(prev[dateKey]);
      const next = {
        ...prev,
        [dateKey]: {
          ...current,
          workoutDone: false,
          workoutRoutineName: undefined,
          workoutPlanName: undefined,
          workoutGroupId: undefined,
          workoutExerciseNames: undefined,
          workoutSourceDay: undefined,
          workoutPain: undefined,
          workoutMemo: undefined,
          workoutStatus: undefined,
          workoutDifficulty: undefined,
          workoutFatigue: undefined,
          workoutExerciseRecords: undefined,
          rosaryCardioDone: undefined,
          rosaryCardioMinutes: undefined,
          rosaryDecades: undefined,
          postWorkoutCardioDone: undefined,
          postWorkoutCardioMinutes: undefined,
        },
      };
      window.localStorage.setItem(
        WORKOUT_COMPLETED_DAYS_KEY,
        JSON.stringify(next),
      );
      return next;
    });
  };

  const saveDayCardio = (type: string, minutes: number, memo: string) => {
    const dateKey = getLocalDateKey();
    setCompletedStore((prev) => {
      const current = getWorkoutRecord(prev[dateKey]);
      const next = {
        ...prev,
        [dateKey]: {
          ...current,
          cardioDone: true,
          cardioType: type,
          cardioMinutes: minutes,
          cardioMemo: memo.trim() || undefined,
        },
      };
      window.localStorage.setItem(
        WORKOUT_COMPLETED_DAYS_KEY,
        JSON.stringify(next),
      );
      return next;
    });
  };

  const cancelDayCardio = () => {
    const dateKey = getLocalDateKey();
    setCompletedStore((prev) => {
      const current = getWorkoutRecord(prev[dateKey]);
      const next = {
        ...prev,
        [dateKey]: {
          ...current,
          cardioDone: false,
          cardioType: undefined,
          cardioMinutes: undefined,
          cardioMemo: undefined,
        },
      };
      window.localStorage.setItem(
        WORKOUT_COMPLETED_DAYS_KEY,
        JSON.stringify(next),
      );
      return next;
    });
  };


  const saveFoamRoller = (record: Pick<WorkoutDayRecord, "foamRollerTiming" | "foamRollerAreas" | "foamRollerPain" | "foamRollerMemo">) => {
    const dateKey = getLocalDateKey();
    setCompletedStore((prev) => {
      const current = getWorkoutRecord(prev[dateKey]);
      const next = {
        ...prev,
        [dateKey]: {
          ...current,
          foamRollerDone: true,
          foamRollerTiming: record.foamRollerTiming,
          foamRollerAreas: record.foamRollerAreas?.length ? record.foamRollerAreas : undefined,
          foamRollerPain: record.foamRollerPain,
          foamRollerMemo: record.foamRollerMemo?.trim() || undefined,
        },
      };
      window.localStorage.setItem(WORKOUT_COMPLETED_DAYS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const cancelFoamRoller = () => {
    const dateKey = getLocalDateKey();
    setCompletedStore((prev) => {
      const current = getWorkoutRecord(prev[dateKey]);
      const next = {
        ...prev,
        [dateKey]: {
          ...current,
          foamRollerDone: false,
          foamRollerTiming: undefined,
          foamRollerAreas: undefined,
          foamRollerPain: undefined,
          foamRollerMemo: undefined,
        },
      };
      window.localStorage.setItem(WORKOUT_COMPLETED_DAYS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleTabChange = (id: string) => {
    const nextTab = id as TabId;
    window.sessionStorage.setItem(ACTIVE_TAB_SESSION_KEY, nextTab);
    setActiveTab(nextTab);
    // Scroll to top when switching tabs
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const recordRecoveryPriority = (memo = "") => {
    const dateKey = getLocalDateKey();
    if (
      getWorkoutRecord(completedStore[dateKey]).workoutDone &&
      !window.confirm(
        "오늘 운동 완료 기록이 있습니다. 회복 우선으로 변경하면 운동 완료 기록은 해제됩니다.",
      )
    )
      return;
    setCompletedStore((prev) => {
      const current = getWorkoutRecord(prev[dateKey]);
      const next = {
        ...prev,
        [dateKey]: {
          ...current,
          workoutDone: false,
          workoutRoutineName: undefined,
          workoutPlanName: undefined,
          workoutGroupId: undefined,
          workoutExerciseNames: undefined,
          workoutSourceDay: undefined,
          workoutPain: undefined,
          workoutMemo: undefined,
          rosaryCardioDone: undefined,
          rosaryCardioMinutes: undefined,
          rosaryDecades: undefined,
          postWorkoutCardioDone: undefined,
          postWorkoutCardioMinutes: undefined,
        },
      };
      window.localStorage.setItem(
        WORKOUT_COMPLETED_DAYS_KEY,
        JSON.stringify(next),
      );
      return next;
    });
    const saved = saveRecoveryRecord(dateKey, {
      recoveryMode: true,
      completedAsRecovery: true,
      recoveryPriorityOnly: true,
      intensity: "recovery",
      recoveryMemo: memo.trim() || undefined,
    });
    setRecoveryToday(saved);
  };

  const cancelRecoveryPriority = () => {
    const dateKey = getLocalDateKey();
    const store = readJson<RecoveryModeStore>(RECOVERY_MODE_DAYS_KEY, {});
    const current = store[dateKey] || {};
    const nextRecord = {
      ...current,
      recoveryMode: false,
      completedAsRecovery: false,
      recoveryPriorityOnly: false,
      recoveryMemo: undefined,
      updatedAt: new Date().toISOString(),
    };
    const next = { ...store, [dateKey]: nextRecord };
    writeJson(RECOVERY_MODE_DAYS_KEY, next);
    setRecoveryToday(nextRecord);
  };

  const completedDays = getWeeklyWorkoutCompletion(completedStore);
  const todayKey = getLocalDateKey();
  const activeWorkoutDateKey = WORKOUT_DAY_IDS.includes(activeTab as WorkoutDayId)
    ? getDateForWorkoutDay(activeTab as WorkoutDayId)
    : todayKey;
  const todayWorkoutDay = getWorkoutDayForDate();
  const todayDayName = [
    "일요일",
    "월요일",
    "화요일",
    "수요일",
    "목요일",
    "금요일",
    "토요일",
  ][new Date().getDay()];
  const selectedBaseWeeklyWorkoutPlan = getWeeklyWorkoutPlanById(
    selectedWeeklyWorkoutPlanId,
  );
  const selectedWeeklyWorkoutPlan = {
    ...selectedBaseWeeklyWorkoutPlan,
    days: WORKOUT_DAY_IDS.reduce((days, dayId) => {
      const customGroupId = userWorkoutSettings.weeklyGroups[dayId];
      if (customGroupId) days[dayIdToPlanKey[dayId]] = customGroupId;
      const dateGroupId = userWorkoutSettings.dateOverrides[getDateForWorkoutDay(dayId)]?.groupId;
      if (dateGroupId) days[dayIdToPlanKey[dayId]] = dateGroupId;
      return days;
    }, { ...selectedBaseWeeklyWorkoutPlan.days }),
  };
  const requiredWorkoutDays = WORKOUT_DAY_IDS.filter((dayId) => {
    const group = getWorkoutGroupForPlanDay(selectedWeeklyWorkoutPlan, dayId);
    return group.category !== "rest" && group.type !== "choice";
  });
  const painDays = WORKOUT_DAY_IDS.reduce<Record<WorkoutDayId, boolean>>(
    (result, dayId) => {
      result[dayId] = Boolean(
        getWorkoutRecord(completedStore[getDateForWorkoutDay(dayId)])
          .workoutPain,
      );
      return result;
    },
    {
      sun: false,
      mon: false,
      tue: false,
      wed: false,
      thu: false,
      fri: false,
      sat: false,
    },
  );
  const baseDayWorkout = WORKOUT_DAY_IDS.includes(activeTab as WorkoutDayId)
    ? getDayWorkoutForPlan(selectedWeeklyWorkoutPlan, activeTab as WorkoutDayId)
    : undefined;
  const selectedWorkoutGroup = baseDayWorkout
    ? getWorkoutGroupForPlanDay(selectedWeeklyWorkoutPlan, activeTab as WorkoutDayId)
    : undefined;
  const dayWorkout = baseDayWorkout
    ? applyExerciseTargets(
        applyDayRoutineEdit(
          baseDayWorkout,
          userWorkoutSettings.dateOverrides[getDateForWorkoutDay(activeTab as WorkoutDayId)]?.edit || userWorkoutSettings.weeklyEdits[activeTab as WorkoutDayId],
        ),
        userWorkoutSettings.exerciseTargets,
      )
    : undefined;
  const todayWorkout = todayWorkoutDay
    ? applyExerciseTargets(
        applyDayRoutineEdit(
          getDayWorkoutForPlan(selectedWeeklyWorkoutPlan, todayWorkoutDay),
          userWorkoutSettings.dateOverrides[todayKey]?.edit || userWorkoutSettings.weeklyEdits[todayWorkoutDay],
        ),
        userWorkoutSettings.exerciseTargets,
      )
    : undefined;
  const todayRecord = getWorkoutRecord(completedStore[todayKey]);
  const activeWorkoutRecord = getWorkoutRecord(completedStore[activeWorkoutDateKey]);
  const activeWorkoutMethod = WORKOUT_DAY_IDS.includes(activeTab as WorkoutDayId)
    ? normalizeWorkoutMethod(
        userWorkoutSettings.dateOverrides[getDateForWorkoutDay(activeTab as WorkoutDayId)]?.method ||
        userWorkoutSettings.weeklyMethods[activeTab as WorkoutDayId] ||
        DEFAULT_WORKOUT_METHOD,
      )
    : DEFAULT_WORKOUT_METHOD;
  const weeklyCompletedCount = requiredWorkoutDays.filter(
    (dayId) => completedDays[dayId],
  ).length;
  const activePrimaryNav =
    activeTab === "ov"
      ? "home"
      : WORKOUT_DAY_IDS.includes(activeTab as WorkoutDayId) ||
          activeTab === "pullup"
        ? "workout"
        : activeTab === "record"
          ? "record"
          : "more";
  const handlePrimaryNavigation = (
    id: (typeof PRIMARY_NAV)[number]["id"],
  ) => {
    if (id === "home") handleTabChange("ov");
    else if (id === "workout")
      handleTabChange(todayWorkoutDay || "mon");
    else if (id === "record") handleTabChange("record");
    else handleTabChange("more");
  };
  const selectedRecovery = routineSelection === "recovery";
  const displayedRecovery = selectedRecovery
    ? {
        recoveryMode: true,
        reasons: [],
        completedAsRecovery: recoveryToday?.completedAsRecovery,
        recoveryPriorityOnly: recoveryToday?.recoveryPriorityOnly,
        recoveryMemo: recoveryToday?.recoveryMemo,
        intensity: "recovery" as const,
        updatedAt: recoveryToday?.updatedAt,
      }
    : recoveryToday || undefined;

  return (
    <>
      <WorkoutNotificationManager />
    <div className="fitness-mobile-shell min-h-dvh bg-[#F6F7FB]">
      {/* ── Top Header ── */}
      <header className="app-module-header">
        <div className="app-module-header-inner">
          {/* Title Row */}
          <AppIdentity kind="fitness" title="재민님의 운동" subtitle="허리를 지키며 꾸준히" />
          <AppModuleNav items={PRIMARY_NAV.map((item) => ({ ...item, icon: item.emoji }))} activeId={activePrimaryNav} ariaLabel="운동 주요 메뉴" onSelect={(id) => handlePrimaryNavigation(id as (typeof PRIMARY_NAV)[number]["id"])} />
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        {activeTab === "ov" && (
          <div className="mx-auto w-full max-w-5xl">
            <section className="mb-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#534AB7] to-[#766EE5] p-5 text-white shadow-[0_16px_40px_rgba(83,74,183,0.22)] sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-white/75">
                    {todayDayName} · 오늘의 추천
                  </p>
                  <h2 className="mt-2 text-[24px] font-bold leading-tight">
                    {todayWorkout?.title || "오늘은 편하게 쉬는 날이에요"}
                  </h2>
                  <p className="mt-2 text-[13px] text-white/80">
                    {todayWorkout?.totalTime || "가벼운 호흡과 휴식"}
                  </p>
                </div>
                <span className="rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-bold">
                  {todayRecord.workoutDone ? "완료" : "진행 전"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleTabChange(todayWorkoutDay || "mon")}
                className="mt-5 w-full rounded-2xl bg-white px-4 py-3.5 text-[15px] font-bold text-[#3C3489] shadow-sm transition active:scale-[0.99]"
              >
                {todayRecord.workoutDone ? "오늘 운동 다시 보기" : "운동 시작하기"}
              </button>
            </section>

            <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
              <p className="text-[12px] font-bold text-[#534AB7]">딱 3가지만 하면 돼요</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {[
                  ["1", "시작 누르기", "오늘 운동은 이미 골라뒀어요"],
                  ["2", "하나씩 따라하기", "횟수와 쉬는 시간을 알려줘요"],
                  ["3", "느낌 고르고 저장", "쉬움·괜찮음·힘듦 중 선택"],
                ].map(([step, title, description]) => (
                  <div key={step} className="flex items-center gap-3 rounded-2xl bg-[#F6F7FB] p-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-[13px] font-bold text-white">
                      {step}
                    </span>
                    <div>
                      <p className="text-[13px] font-bold text-gray-900">{title}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
              <div className="min-h-20 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                <p className="text-[12px] text-gray-500">이번 주</p>
                <p className="mt-1 text-[20px] font-bold text-gray-900">
                  {weeklyCompletedCount}
                  <span className="text-[12px] font-medium text-gray-400">
                    {" "}
                    / {requiredWorkoutDays.length}일
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleTabChange("record")}
                className="min-h-20 rounded-2xl border border-gray-100 bg-white p-3 text-left shadow-sm"
              >
                <p className="text-[12px] text-gray-500">지난 기록</p>
                <p className="mt-1 text-[14px] font-bold text-[#534AB7]">달력 보기 →</p>
              </button>
              <button
                type="button"
                onClick={() => handleTabChange("pullup")}
                className="min-h-20 rounded-2xl border border-gray-100 bg-white p-3 text-left shadow-sm"
              >
                <p className="text-[12px] text-gray-500">3분 운동</p>
                <p className="mt-1 text-[14px] font-bold text-[#534AB7]">철봉 연습 →</p>
              </button>
            </section>
            <div className="mb-4">
              <FitnessAiCoachPanel mode="plan" onPlanApplied={handleUserWorkoutSettingsChange} />
            </div>
            <details className="mb-3 rounded-2xl border border-amber-100 bg-white shadow-sm">
              <summary className="cursor-pointer list-none p-4">
                <span className="block text-[14px] font-bold text-gray-900">몸이 아프거나 피곤한가요?</span>
                <span className="mt-1 block text-[11px] text-gray-500">그럴 때만 눌러서 알려주세요</span>
              </summary>
              <div className="border-t border-amber-100 px-3 pt-3 sm:px-4">
                <ConditionCheckCard value={conditionToday} onSave={handleConditionSave} onClear={handleConditionClear} />
              </div>
            </details>

            <details className="mb-5 rounded-2xl border border-gray-100 bg-white shadow-sm">
              <summary className="cursor-pointer list-none p-4">
                <span className="block text-[14px] font-bold text-gray-900">이번 주 운동표 보기</span>
                <span className="mt-1 block text-[11px] text-gray-500">다른 요일 운동이나 주간 계획을 볼 수 있어요</span>
              </summary>
              <div className="border-t border-gray-100 px-3 pt-4 sm:px-4">
                <WeeklyView
                  onTabChange={handleTabChange}
                  completedDays={completedDays}
                  painDays={painDays}
                  todayDayId={todayWorkoutDay}
                  plans={WEEKLY_WORKOUT_PLANS.map((plan) =>
                    plan.id === selectedWeeklyWorkoutPlan.id ? selectedWeeklyWorkoutPlan : plan,
                  )}
                  selectedPlanId={selectedWeeklyWorkoutPlan.id}
                  onPlanChange={handleWeeklyWorkoutPlanChange}
                />
              </div>
            </details>
          </div>
        )}

        {dayWorkout &&
          ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(
            activeTab,
          ) && (
            <div className="mx-auto w-full max-w-5xl">
              <section className="mb-4 rounded-3xl border border-[#D9D6FF] bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-bold text-[#534AB7]">
                      {TABS.find((tab) => tab.id === activeTab)?.label} 운동
                    </p>
                    <h2 className="mt-1 text-[20px] font-bold text-gray-900">
                      {dayWorkout.title}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTabChange("ov")}
                    className="rounded-xl bg-gray-50 px-3 py-2 text-[12px] font-bold text-gray-600"
                  >
                    홈
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-gray-500">
                  {selectedWeeklyWorkoutPlan.name} · {dayWorkout.totalTime}
                </p>
              </section>
              <DayView
                day={dayWorkout}
                workoutMethod={activeWorkoutMethod}
                isCompleted={
                  activeWorkoutRecord.workoutDone ??
                  false
                }
                onSaveWorkout={(pain, memo, cardioOptionId, exerciseRecords, cardioMinutes, feedback) =>
                  saveDayWorkout(activeTab as WorkoutDayId, pain, memo, cardioOptionId, exerciseRecords, cardioMinutes, feedback)
                }
                onCancelWorkout={() =>
                  cancelDayWorkout(activeTab as WorkoutDayId)
                }
                workoutPain={
                  activeWorkoutRecord.workoutPain
                }
                workoutMemo={
                  activeWorkoutRecord.workoutMemo
                }
                workoutStatus={activeWorkoutRecord.workoutStatus}
                workoutDifficulty={activeWorkoutRecord.workoutDifficulty}
                workoutFatigue={activeWorkoutRecord.workoutFatigue}
                workoutExerciseRecords={activeWorkoutRecord.workoutExerciseRecords}
                cardioDone={
                  activeWorkoutRecord.cardioDone
                }
                cardioType={
                  activeWorkoutRecord.cardioType
                }
                cardioMinutes={
                  activeWorkoutRecord.cardioMinutes
                }
                cardioMemo={
                  activeWorkoutRecord.cardioMemo
                }
                onSaveCardio={saveDayCardio}
                onCancelCardio={cancelDayCardio}
                foamRollerDone={
                  activeWorkoutRecord.foamRollerDone
                }
                foamRollerTiming={
                  activeWorkoutRecord.foamRollerTiming
                }
                foamRollerAreas={
                  activeWorkoutRecord.foamRollerAreas
                }
                foamRollerPain={
                  activeWorkoutRecord.foamRollerPain
                }
                foamRollerMemo={
                  activeWorkoutRecord.foamRollerMemo
                }
                onSaveFoamRoller={saveFoamRoller}
                onCancelFoamRoller={cancelFoamRoller}
                onPullupTraining={() => handleTabChange("pullup")}
                recovery={displayedRecovery}
                onRecordRecovery={recordRecoveryPriority}
                onCancelRecovery={cancelRecoveryPriority}
                showBaseRoutine={
                  !selectedRecovery &&
                  (showBaseRoutine || !displayedRecovery?.recoveryMode)
                }
                onShowRecommended={() => setShowBaseRoutine(false)}
                onShowBaseRoutine={() => setShowBaseRoutine(true)}
              />
            </div>
          )}

        {activeTab === "pullup" && (
          <div className="mx-auto w-full max-w-6xl">
            <PullupTrainingView />
          </div>
        )}

        {activeTab === "record" && <RecordCalendarView />}

        {activeTab === "more" && (
          <div className="mx-auto w-full max-w-5xl">
            <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
              <p className="text-[12px] font-bold text-[#534AB7]">쉬운 설정</p>
              <h2 className="mt-1 text-[22px] font-bold text-gray-900">큰 것만 먼저 고르세요</h2>
              <p className="mt-2 text-[13px] text-gray-500">아래 두 가지만 정하면 바로 운동할 수 있어요. 나머지는 앱이 추천값으로 준비합니다.</p>
              <div className="mt-4 rounded-2xl bg-[#F6F7FB] p-3">
                <p className="text-[12px] font-bold text-gray-700">1. 운동 계획</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {WEEKLY_WORKOUT_PLANS.map((plan) => (
                    <button key={plan.id} type="button" onClick={() => handleWeeklyWorkoutPlanChange(plan.id)} className={`rounded-xl border px-3 py-3 text-left ${selectedWeeklyWorkoutPlanId === plan.id ? "border-[#7F77DD] bg-white text-[#3C3489] shadow-sm" : "border-transparent bg-gray-100 text-gray-600"}`}>
                      <span className="block text-[13px] font-bold">{selectedWeeklyWorkoutPlanId === plan.id ? "✓ " : ""}{plan.name}</span>
                      <span className="mt-1 block text-[10px] opacity-70">{plan.recommendedFor}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 rounded-2xl bg-[#F6F7FB] p-3">
                <p className="text-[12px] font-bold text-gray-700">2. 오늘 강도</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => handleRoutineSelectionChange("base")} className={`rounded-xl px-3 py-3 text-[13px] font-bold ${routineSelection === "base" ? "bg-[#534AB7] text-white" : "bg-white text-gray-600"}`}>보통 운동</button>
                  <button type="button" onClick={() => handleRoutineSelectionChange("recovery")} className={`rounded-xl px-3 py-3 text-[13px] font-bold ${routineSelection === "recovery" ? "bg-emerald-600 text-white" : "bg-white text-gray-600"}`}>가볍게 회복</button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => handleTabChange("pullup")}
                  className="rounded-2xl bg-[#EEEDFE] p-4 text-left text-[#3C3489]"
                >
                  <span className="block text-[14px] font-bold">철봉 단계 훈련</span>
                  <span className="mt-1 block text-[11px]">3~5분 자세 연습</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTabChange("tips")}
                  className="rounded-2xl bg-red-50 p-4 text-left text-red-700"
                >
                  <span className="block text-[14px] font-bold">안전·중단 기준</span>
                  <span className="mt-1 block text-[11px]">통증 발생 시 확인</span>
                </button>
              </div>
            </section>
            <div className="space-y-3">
              <details className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                <summary className="cursor-pointer list-none p-4 text-[14px] font-bold text-gray-900 sm:p-5">세부 운동 편집 <span className="ml-1 text-[12px] font-normal text-gray-500">필요할 때만 · 요일·횟수·무게</span></summary>
                <div className="px-3 pb-3 sm:px-4 sm:pb-4"><WorkoutPlanEditor
                  settings={userWorkoutSettings}
                  records={completedStore}
                  defaultGroups={WORKOUT_DAY_IDS.reduce((result, dayId) => {
                    result[dayId] = selectedBaseWeeklyWorkoutPlan.days[dayIdToPlanKey[dayId]];
                    return result;
                  }, {} as Record<WorkoutDayId, string>)}
                  onChange={handleUserWorkoutSettingsChange}
                /></div>
              </details>
              <details className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                <summary className="cursor-pointer list-none p-4 text-[14px] font-bold text-gray-900 sm:p-5">강도 상세 설명 <span className="ml-1 text-[12px] font-normal text-gray-500">기본·회복 모드 안내</span></summary>
                <div className="px-3 pb-3 sm:px-4 sm:pb-4"><SwitchOnModePanel selection={routineSelection} onSelectionChange={handleRoutineSelectionChange} /></div>
              </details>
              <details className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                <summary className="cursor-pointer list-none p-4 text-[14px] font-bold text-gray-900 sm:p-5">운동 알림 <span className="ml-1 text-[12px] font-normal text-gray-500">요일과 시간</span></summary>
                <div className="px-3 pb-3 sm:px-4 sm:pb-4"><WorkoutNotificationPanel /></div>
              </details>
              <details className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                <summary className="cursor-pointer list-none p-4 text-[14px] font-bold text-gray-900 sm:p-5">기록 백업·기기 연결 <span className="ml-1 text-[12px] font-normal text-gray-500">고급 기능</span></summary>
                <div className="space-y-3 px-3 pb-3 sm:px-4 sm:pb-4"><DataBackupPanel /><CloudSyncPanel /></div>
              </details>
            </div>
          </div>
        )}

        {activeTab === "tips" && (
          <div className="mx-auto w-full max-w-5xl">
            <SafetyView />
          </div>
        )}
      </main>

      {/* Bottom padding for mobile nav */}
      <div className="h-24 md:h-4" />
    </div>
    </>
  );
}

export default function Page() {
  return <AuthGate><FitnessApp /></AuthGate>;
}
