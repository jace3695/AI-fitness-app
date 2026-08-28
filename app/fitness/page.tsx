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
import TodayDashboard from "../components/TodayDashboard";
import ConditionCheckCard from "../components/ConditionCheckCard";
import AuthGate from "../components/AuthGate";
import WorkoutPlanEditor from "../components/WorkoutPlanEditor";
import WorkoutNotificationManager from "../components/WorkoutNotificationManager";
import WorkoutNotificationPanel from "../components/WorkoutNotificationPanel";
import DataBackupPanel from "../components/DataBackupPanel";
import AppIdentity from "../components/AppIdentity";
import AppModuleNav from "../components/AppModuleNav";
import {
  applyDayRoutineEdit,
  applyExerciseTargets,
  EMPTY_USER_WORKOUT_SETTINGS,
  readUserWorkoutSettings,
  saveUserWorkoutSettings,
  UserWorkoutSettings,
} from "../data/userWorkoutSettings";

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
  { id: "home", label: "홈", emoji: "⌂" },
  { id: "workout", label: "운동", emoji: "▶" },
  { id: "record", label: "기록", emoji: "▦" },
  { id: "more", label: "더보기", emoji: "•••" },
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
    <div className="min-h-dvh bg-[#F6F7FB]">
      {/* ── Top Header ── */}
      <header className="app-module-header">
        <div className="app-module-header-inner">
          {/* Title Row */}
          <AppIdentity kind="fitness" title="재민님의 운동" subtitle="허리를 지키며 꾸준히" />
          <AppModuleNav items={PRIMARY_NAV.map((item) => ({ ...item, icon: item.emoji }))} activeId={activePrimaryNav} ariaLabel="운동 주요 메뉴" onSelect={(id) => handlePrimaryNavigation(id as (typeof PRIMARY_NAV)[number]["id"])} />
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        {activeTab === "ov" && (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.65fr)] xl:gap-7">
            <div className="xl:sticky xl:top-24">
            <section className="mb-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#534AB7] to-[#766EE5] p-5 text-white shadow-[0_16px_40px_rgba(83,74,183,0.22)] sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-white/75">
                    {todayDayName} · 오늘의 추천
                  </p>
                  <h2 className="mt-2 text-[24px] font-bold leading-tight">
                    {todayWorkout?.title || "오늘은 회복을 우선하세요"}
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
                {todayRecord.workoutDone ? "오늘 운동 다시 보기" : "오늘 운동 시작"}
              </button>
            </section>

            <section className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                <p className="text-[11px] text-gray-400">이번 주</p>
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
                className="rounded-2xl border border-gray-100 bg-white p-3 text-left shadow-sm"
              >
                <p className="text-[11px] text-gray-400">몸 기록</p>
                <p className="mt-1 text-[14px] font-bold text-[#534AB7]">확인하기 →</p>
              </button>
              <button
                type="button"
                onClick={() => handleTabChange("pullup")}
                className="rounded-2xl border border-gray-100 bg-white p-3 text-left shadow-sm"
              >
                <p className="text-[11px] text-gray-400">짧은 운동</p>
                <p className="mt-1 text-[14px] font-bold text-[#534AB7]">철봉 훈련 →</p>
              </button>
            </section>
            <ConditionCheckCard
              value={conditionToday}
              onSave={handleConditionSave}
              onClear={handleConditionClear}
            />
            <TodayDashboard
              workoutDone={Boolean(todayRecord.workoutDone)}
              workoutPain={Boolean(todayRecord.workoutPain)}
              recoveryRecommended={Boolean(displayedRecovery?.recoveryMode)}
              recoveryCompleted={Boolean(displayedRecovery?.completedAsRecovery)}
              onOpenWorkout={() =>
                handleTabChange(todayWorkoutDay || "mon")
              }
              onOpenRecord={() => handleTabChange("record")}
            />
            </div>

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
              <p className="text-[12px] font-bold text-[#534AB7]">설정과 보조 기능</p>
              <h2 className="mt-1 text-[22px] font-bold text-gray-900">더보기</h2>
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
            <SwitchOnModePanel
              selection={routineSelection}
              onSelectionChange={handleRoutineSelectionChange}
            />
            <DataBackupPanel />
            <WorkoutNotificationPanel />
            <WorkoutPlanEditor
              settings={userWorkoutSettings}
              records={completedStore}
              defaultGroups={WORKOUT_DAY_IDS.reduce((result, dayId) => {
                result[dayId] = selectedBaseWeeklyWorkoutPlan.days[dayIdToPlanKey[dayId]];
                return result;
              }, {} as Record<WorkoutDayId, string>)}
              onChange={handleUserWorkoutSettingsChange}
            />
          </div>
        )}

        <div className={activeTab === "more" ? "mx-auto w-full max-w-5xl" : "hidden"}>
          <CloudSyncPanel />
        </div>

        {activeTab === "tips" && (
          <div className="mx-auto w-full max-w-5xl">
            <SafetyView />
          </div>
        )}
      </main>

      {/* Bottom padding for mobile nav */}
      <div className="h-20 md:h-4" />
    </div>
    </>
  );
}

export default function Page() {
  return <AuthGate><FitnessApp /></AuthGate>;
}
