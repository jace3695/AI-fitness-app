"use client";

import AppCompanion from "@/components/AppCompanion";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DayWorkout } from "../data/workouts";
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
  DailyConditionStore,
  readDailyCondition,
  RecoveryDayRecord,
  RecoveryModeStore,
  saveDailyCondition,
  saveRecoveryRecord,
  RECOVERY_MODE_DAYS_KEY,
} from "../data/recoveryMode";
import { readJson, readRecordStores, writeJson } from "../data/recordStorage";
import type { WeightRecordStore } from "../data/recordStorage";
import { getLocalDateKey } from "../data/dietPlans";
import WeeklyView from "../components/WeeklyView";
import DayView from "../components/DayView";
import SafetyView from "../components/SafetyView";
import RecordCalendarView from "../components/RecordCalendarView";
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
import AdaptiveWorkoutReviewCard from "../components/AdaptiveWorkoutReviewCard";
import DailyWorkoutEditor from "../components/DailyWorkoutEditor";
import {
  applyDayRoutineEdit,
  applyExerciseTargets,
  getExerciseTargetsForDay,
  EMPTY_USER_WORKOUT_SETTINGS,
  readUserWorkoutSettings,
  saveUserWorkoutSettings,
  UserWorkoutSettings,
} from "../data/userWorkoutSettings";
import { DEFAULT_WORKOUT_METHOD, normalizeWorkoutMethod } from "../data/workoutMethods";
import {
  buildCurrentWorkoutSettings,
  CURRENT_PROGRAM_SCHEDULE,
  CURRENT_WORKOUT_DIRECTION_BACKUP_KEY,
  CURRENT_WORKOUT_DIRECTION_VERSION,
  CURRENT_WORKOUT_DIRECTION_VERSION_KEY,
  CURRENT_WEIGHT_BASELINE_KG,
  CURRENT_WEIGHT_BASELINE_DATE,
  CURRENT_WEEKLY_METHODS,
} from "../data/currentWorkoutDirection";
import { buildAdaptiveCoachAdvice } from "../data/workoutAdaptiveCoach";
import { buildAdaptiveWorkoutReview } from '../data/workoutAdaptiveReview';

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
  | "plan"
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
  { id: "plan", label: "주간 운동표" },
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
  { id: "more", label: "더보기", emoji: "⋯" },
];

function getWorkoutPreviewItems(day?: DayWorkout) {
  if (!day) return ["편하게 쉬기"];
  const names = day.optionalCardio
    ? day.optionalCardio.options.map((option) => option.name)
    : day.phases.flatMap((phase) =>
        phase.exercises.map((exercise) => exercise.name),
      );
  return Array.from(new Set(names));
}

function FitnessApp() {
  const [activeTab, setActiveTab] = useState<TabId>("ov");
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
  const [showDailyEditor, setShowDailyEditor] = useState(false);
  const [userWorkoutSettings, setUserWorkoutSettings] = useState<UserWorkoutSettings>(EMPTY_USER_WORKOUT_SETTINGS);
  const [weightRecords, setWeightRecords] = useState<WeightRecordStore>({});
  const [conditionRecords, setConditionRecords] = useState<DailyConditionStore>({});
  const [directionUpdateNotice, setDirectionUpdateNotice] = useState("");

  const refreshWorkoutReview = useCallback(() => {
    const stores = readRecordStores();
    setCompletedStore(stores.workouts);
    setWeightRecords(stores.weights);
    setConditionRecords(stores.conditions);
    setConditionToday(stores.conditions[getLocalDateKey()]);
    setUserWorkoutSettings(readUserWorkoutSettings());
    setSelectedWeeklyWorkoutPlanId(window.localStorage.getItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY) || DEFAULT_WEEKLY_WORKOUT_PLAN_ID);
  }, []);

  useEffect(() => {
    window.addEventListener('focus', refreshWorkoutReview);
    window.addEventListener('storage', refreshWorkoutReview);
    return () => {
      window.removeEventListener('focus', refreshWorkoutReview);
      window.removeEventListener('storage', refreshWorkoutReview);
    };
  }, [refreshWorkoutReview]);

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

    const savedWeeklyPlan =
      window.localStorage.getItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY) ||
      window.localStorage.getItem(LEGACY_SELECTED_WEEKLY_WORKOUT_PLAN_KEY) ||
      DEFAULT_WEEKLY_WORKOUT_PLAN_ID;
    const needsDirectionUpdate = window.localStorage.getItem(CURRENT_WORKOUT_DIRECTION_VERSION_KEY) !== CURRENT_WORKOUT_DIRECTION_VERSION;
    let settings = readUserWorkoutSettings();
    let weeklyPlanId = WEEKLY_WORKOUT_PLANS.some((plan) => plan.id === savedWeeklyPlan)
      ? savedWeeklyPlan
      : DEFAULT_WEEKLY_WORKOUT_PLAN_ID;
    if (needsDirectionUpdate) {
      if (!window.localStorage.getItem(CURRENT_WORKOUT_DIRECTION_BACKUP_KEY)) {
        window.localStorage.setItem(CURRENT_WORKOUT_DIRECTION_BACKUP_KEY, JSON.stringify({
          savedAt: new Date().toISOString(),
          selectedPlanId: weeklyPlanId,
          settings,
        }));
      }
      settings = buildCurrentWorkoutSettings(settings);
      saveUserWorkoutSettings(settings);
      weeklyPlanId = DEFAULT_WEEKLY_WORKOUT_PLAN_ID;
      window.localStorage.setItem(CURRENT_WORKOUT_DIRECTION_VERSION_KEY, CURRENT_WORKOUT_DIRECTION_VERSION);
      setDirectionUpdateNotice("현재 운동 방향에 맞춰 주 5일 근력·회복 교차 계획을 적용했습니다.");
    }
    setSelectedWeeklyWorkoutPlanId(weeklyPlanId);
    window.localStorage.setItem(
      SELECTED_WEEKLY_WORKOUT_PLAN_KEY,
      weeklyPlanId,
    );
    window.localStorage.removeItem(LEGACY_SELECTED_WEEKLY_WORKOUT_PLAN_KEY);

    setCompletedStore(readWorkoutCompletionStore());
    setUserWorkoutSettings(settings);
    const recordStores = readRecordStores();
    setWeightRecords(recordStores.weights);
    setConditionRecords(recordStores.conditions);
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

  const handleWeeklyWorkoutPlanChange = (planId: string) => {
    setSelectedWeeklyWorkoutPlanId(planId);
    window.localStorage.setItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY, planId);
  };

  const handleUserWorkoutSettingsChange = (settings: UserWorkoutSettings) => {
    saveUserWorkoutSettings(settings);
    setUserWorkoutSettings(settings);
  };

  const handleConditionSave = (signals: ConditionSignalId[], memo: string) => {
    const dateKey = getLocalDateKey();
    const condition = saveDailyCondition(dateKey, signals, memo);
    setConditionToday(condition);
    setConditionRecords((current) => ({ ...current, [dateKey]: condition }));
    setRecoveryToday(assessRecoveryMode(dateKey, todayWorkoutDay));
  };

  const handleConditionClear = () => {
    const dateKey = getLocalDateKey();
    clearDailyCondition(dateKey);
    setConditionToday(undefined);
    setConditionRecords(readRecordStores().conditions);
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
    const backStatus = feedback?.backStatus ?? (pain ? "pain" : "none");
    const neurologicalSymptoms = feedback?.neurologicalSymptoms ?? [];
    const hasSafetyPain = pain || backStatus === "pain" || backStatus === "worse" || neurologicalSymptoms.length > 0;
    setCompletedStore((prev) => {
      const current = getWorkoutRecord(prev[dateKey]);
      const hasWarmupSlidingBoard = exerciseNames.includes("운동 전 슬라이딩보드");
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
          workoutPain: hasSafetyPain,
          workoutBackStatus: backStatus,
          workoutNeurologicalSymptoms: neurologicalSymptoms.length ? neurologicalSymptoms : undefined,
          workoutPainExercise: feedback?.painExercise?.trim() || undefined,
          workoutPainSet: feedback?.painSet,
          workoutMemo: selectedOptionalCardio?.id === 'rest' ? (memo.trim() || '토요일 선택 휴식') : memo.trim() || undefined,
          workoutStatus: recordedWorkoutStatus,
          workoutDifficulty: feedback?.difficulty || current.workoutDifficulty || "moderate",
          workoutFatigue: feedback?.fatigue || current.workoutFatigue || 2,
          workoutExerciseRecords: exerciseRecords || current.workoutExerciseRecords,
          workoutMethod: dayWorkout?.optionalCardio ? undefined : { ...activeWorkoutMethod },
          workoutRecordedAt: new Date().toISOString(),
          rosaryCardioDone: hasWarmupSlidingBoard || undefined,
          rosaryCardioMinutes: hasWarmupSlidingBoard ? 20 : undefined,
          rosaryDecades: undefined,
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
          workoutBackStatus: undefined,
          workoutNeurologicalSymptoms: undefined,
          workoutPainExercise: undefined,
          workoutPainSet: undefined,
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
    setShowDailyEditor(false);
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
          workoutBackStatus: undefined,
          workoutNeurologicalSymptoms: undefined,
          workoutPainExercise: undefined,
          workoutPainSet: undefined,
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
  const adaptiveAdvice = useMemo(
    () => buildAdaptiveCoachAdvice(completedStore, weightRecords),
    [completedStore, weightRecords],
  );
  const todayKey = getLocalDateKey();
  const adaptiveReviewInput = { settings: userWorkoutSettings, workouts: completedStore, conditions: conditionRecords, selectedPlanId: selectedWeeklyWorkoutPlanId, today: todayKey };
  const safetyHold = buildAdaptiveWorkoutReview(adaptiveReviewInput).action === 'hold';
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
      const record = getWorkoutRecord(completedStore[getDateForWorkoutDay(dayId)]);
      result[dayId] = Boolean(
        record.workoutPain ||
        record.workoutBackStatus === "pain" ||
        record.workoutBackStatus === "worse" ||
        record.workoutNeurologicalSymptoms?.length,
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
        getExerciseTargetsForDay(userWorkoutSettings, activeTab as WorkoutDayId, activeWorkoutDateKey),
      )
    : undefined;
  const todayWorkout = todayWorkoutDay
    ? applyExerciseTargets(
        applyDayRoutineEdit(
          getDayWorkoutForPlan(selectedWeeklyWorkoutPlan, todayWorkoutDay),
          userWorkoutSettings.dateOverrides[todayKey]?.edit || userWorkoutSettings.weeklyEdits[todayWorkoutDay],
        ),
        getExerciseTargetsForDay(userWorkoutSettings, todayWorkoutDay, todayKey),
      )
    : undefined;
  const todayPreviewItems = getWorkoutPreviewItems(todayWorkout);
  const activeWorkoutDay = WORKOUT_DAY_IDS.includes(activeTab as WorkoutDayId)
    ? (activeTab as WorkoutDayId)
    : undefined;
  const activeDefaultGroupId = activeWorkoutDay
    ? selectedBaseWeeklyWorkoutPlan.days[dayIdToPlanKey[activeWorkoutDay]]
    : selectedBaseWeeklyWorkoutPlan.days.monday;
  const activeRecommendationGroupId =
    activeWorkoutDay &&
    getDateForWorkoutDay(activeWorkoutDay) === todayKey &&
    recoveryToday?.recoveryMode
      ? safetyHold ? 'rest' : "current-fullbody-recovery-circuit"
      : activeDefaultGroupId;
  const activeRecommendationReason = recoveryToday?.recoveryMode &&
    activeWorkoutDay &&
    getDateForWorkoutDay(activeWorkoutDay) === todayKey
    ? safetyHold ? '통증·신경 증상 기록이 있어 운동 변경보다 증상 확인과 휴식을 우선합니다.' : "오늘 몸 상태를 반영해 회복 루틴을 추천합니다."
    : `${selectedBaseWeeklyWorkoutPlan.weekLabel} 기본 운동표를 기준으로 추천합니다.`;
  const todayRecord = getWorkoutRecord(completedStore[todayKey]);
  const activeWorkoutRecord = getWorkoutRecord(completedStore[activeWorkoutDateKey]);
  const activeWorkoutMethod = WORKOUT_DAY_IDS.includes(activeTab as WorkoutDayId)
    ? normalizeWorkoutMethod(
        userWorkoutSettings.dateOverrides[getDateForWorkoutDay(activeTab as WorkoutDayId)]?.method ||
        userWorkoutSettings.weeklyMethods[activeTab as WorkoutDayId] ||
        (selectedWeeklyWorkoutPlanId === DEFAULT_WEEKLY_WORKOUT_PLAN_ID ? CURRENT_WEEKLY_METHODS[activeTab as WorkoutDayId] : DEFAULT_WORKOUT_METHOD),
      )
    : DEFAULT_WORKOUT_METHOD;
  const weeklyCompletedCount = requiredWorkoutDays.filter(
    (dayId) => completedDays[dayId],
  ).length;
  const activePrimaryNav =
    activeTab === "ov"
      ? "home"
      : WORKOUT_DAY_IDS.includes(activeTab as WorkoutDayId) ||
          activeTab === "pullup" ||
          activeTab === "plan"
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
  const displayedRecovery = recoveryToday || undefined;

  const openDailyEditor = (dayId: WorkoutDayId) => {
    handleTabChange(dayId);
    setShowDailyEditor(true);
  };

  return (
    <>
      <WorkoutNotificationManager />
    <div className="fitness-mobile-shell min-h-dvh bg-yeoni-bg">
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
        <div className="mx-auto max-w-5xl"><AppCompanion home={activeTab === "ov"} compact={activeTab !== "ov"} quiet={activeTab !== "ov"}>{activeTab === "ov" ? todayRecord.workoutDone ? "오늘 운동을 해냈네요! 편하게 쉬어요." : "몸 상태를 살피며, 하나씩 함께해요." : activeTab === "record" ? "숫자 하나보다 기록의 흐름을 함께 봐요. 입력한 값도 한 번 확인해 주세요." : activeTab === "more" ? "필요한 도구와 설정을 여기서 찾아봐요." : "내 속도에 맞춰 천천히 해봐요. 운동 중에는 조용히 기다릴게요."}</AppCompanion></div>
        {activeTab === "ov" && (
          <div className="mx-auto w-full max-w-5xl">
            {directionUpdateNotice && (
              <p role="status" className="mb-4 rounded-2xl border border-violet-100 bg-[#F3F1FF] px-4 py-3 text-[12px] font-bold text-[#3C3489]">
                {directionUpdateNotice}
              </p>
            )}
            <section className="mb-4 overflow-hidden rounded-3xl yeoni-summary p-5 text-white shadow-[0_16px_40px_rgba(83,74,183,0.22)] sm:p-6">
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
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-bold text-[#534AB7]">오늘 추천 운동</p>
                  <p className="mt-1 text-[11px] text-gray-500">운동표와 오늘 설정을 반영했습니다.</p>
                </div>
                {todayWorkoutDay && (
                  <button
                    type="button"
                    onClick={() => openDailyEditor(todayWorkoutDay)}
                    className="shrink-0 rounded-xl bg-[#EEEDFE] px-3 py-2 text-[12px] font-bold text-[#3C3489]"
                  >
                    오늘 운동 바꾸기
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {todayPreviewItems.slice(0, 7).map((name, index) => (
                  <span key={`${name}-${index}`} className="rounded-full bg-yeoni-bg px-3 py-1.5 text-[11px] font-semibold text-gray-700">
                    {index + 1}. {name}
                  </span>
                ))}
                {todayPreviewItems.length > 7 && (
                  <span className="rounded-full bg-[#EEEDFE] px-3 py-1.5 text-[11px] font-bold text-[#534AB7]">
                    +{todayPreviewItems.length - 7}개
                  </span>
                )}
              </div>
            </section>

            <section className="mb-4 rounded-3xl border border-violet-100 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-bold text-[#534AB7]">현재 운동 방향</p>
                  <h3 className="mt-1 text-[18px] font-extrabold text-gray-900">근력 3일 + 회복형 2일</h3>
                  <p className="mt-1 max-w-2xl text-[12px] leading-5 text-gray-500">체지방을 줄이면서 근육과 수행능력을 지키고, 복부·등·둔근·골반을 함께 써서 몸통 안정성을 높입니다.</p>
                </div>
                <div className="rounded-2xl bg-[#EEEDFE] px-4 py-2.5 text-right">
                  <p className="text-[10px] font-bold text-[#534AB7]">{adaptiveAdvice.weightSource === "record" ? "최근 체중 기록" : `${CURRENT_WEIGHT_BASELINE_DATE} 제공값`}</p>
                  <p className="text-[20px] font-extrabold text-[#3C3489]">{adaptiveAdvice.currentWeightKg || CURRENT_WEIGHT_BASELINE_KG}kg</p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {CURRENT_PROGRAM_SCHEDULE.map((item) => (
                  <div key={item.days} className={`rounded-2xl border p-3 ${item.tone === "violet" ? "border-violet-100 bg-[#F7F6FF]" : item.tone === "blue" ? "border-blue-100 bg-blue-50" : "border-emerald-100 bg-emerald-50"}`}>
                    <p className="text-[11px] font-bold text-gray-500">{item.days} · {item.intensity}</p>
                    <p className="mt-1 text-[14px] font-extrabold text-gray-900">{item.label}</p>
                    <p className="mt-1 text-[11px] text-gray-600">{item.duration}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 rounded-2xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">{adaptiveAdvice.weightAssessment}</p>
              <p className="mt-3 text-[10px] font-semibold text-gray-500">슬라이딩보드는 운동 라이브러리에 남아 있으며 현재 개인 루틴에서는 제외했습니다.</p>
            </section>

            <AdaptiveWorkoutReviewCard
              input={adaptiveReviewInput}
              onApply={handleUserWorkoutSettingsChange}
              onRefresh={refreshWorkoutReview}
            />

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
              <FitnessAiCoachPanel mode="plan" onPlanApplied={handleUserWorkoutSettingsChange} managedCircuit={selectedWeeklyWorkoutPlanId === DEFAULT_WEEKLY_WORKOUT_PLAN_ID} />
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
                <button
                  type="button"
                  onClick={() => handleTabChange("plan")}
                  className="mb-3 w-full rounded-xl bg-[#EEEDFE] px-4 py-3 text-[13px] font-bold text-[#3C3489]"
                >
                  주간 운동표 편집하기
                </button>
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-bold text-[#534AB7]">
                      {TABS.find((tab) => tab.id === activeTab)?.label} · {selectedWeeklyWorkoutPlan.weekLabel}
                    </p>
                    <p className="mt-1 text-[12px] text-gray-500">운동을 바꾸고 싶으면 여기서 바로 고르세요.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDailyEditor((visible) => !visible)}
                      className={`rounded-xl px-3 py-2 text-[12px] font-bold ${showDailyEditor ? "bg-[#534AB7] text-white" : "bg-[#EEEDFE] text-[#3C3489]"}`}
                    >
                      {showDailyEditor ? "편집 닫기" : "오늘 운동 바꾸기"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTabChange("ov")}
                      className="rounded-xl bg-gray-50 px-3 py-2 text-[12px] font-bold text-gray-600"
                    >
                      홈
                    </button>
                  </div>
                </div>
              </section>
              {showDailyEditor && activeWorkoutDay && (
                <DailyWorkoutEditor
                  dayId={activeWorkoutDay}
                  dateKey={getDateForWorkoutDay(activeWorkoutDay)}
                  defaultGroupId={activeDefaultGroupId}
                  recommendedGroupId={activeRecommendationGroupId}
                  recommendationReason={activeRecommendationReason}
                  settings={userWorkoutSettings}
                  onChange={handleUserWorkoutSettingsChange}
                  onClose={() => setShowDailyEditor(false)}
                />
              )}
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
                workoutBackStatus={activeWorkoutRecord.workoutBackStatus}
                workoutNeurologicalSymptoms={activeWorkoutRecord.workoutNeurologicalSymptoms}
                workoutPainExercise={activeWorkoutRecord.workoutPainExercise}
                workoutPainSet={activeWorkoutRecord.workoutPainSet}
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
                safetyHold={safetyHold}
                onRecordRecovery={recordRecoveryPriority}
                onCancelRecovery={cancelRecoveryPriority}
                showBaseRoutine={
                  showBaseRoutine || !displayedRecovery?.recoveryMode
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

        {activeTab === "plan" && (
          <div className="mx-auto w-full max-w-5xl">
            <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-bold text-[#534AB7]">주간 운동표</p>
                  <h2 className="mt-1 text-[22px] font-bold text-gray-900">일주일 운동을 정해요</h2>
                  <p className="mt-2 text-[13px] text-gray-500">먼저 기본 계획을 고르세요. 요일별 세부 변경은 아래에서 필요할 때만 하면 됩니다.</p>
                </div>
                <button type="button" onClick={() => handleTabChange("ov")} className="rounded-xl bg-gray-100 px-3 py-2 text-[12px] font-bold text-gray-600">운동 홈</button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {WEEKLY_WORKOUT_PLANS.map((plan) => (
                  <button key={plan.id} type="button" onClick={() => handleWeeklyWorkoutPlanChange(plan.id)} className={`rounded-2xl border px-4 py-3 text-left ${selectedWeeklyWorkoutPlanId === plan.id ? "border-[#7F77DD] bg-[#F7F6FF] text-[#3C3489] shadow-sm" : "border-gray-100 bg-gray-50 text-gray-600"}`}>
                    <span className="block text-[13px] font-bold">{selectedWeeklyWorkoutPlanId === plan.id ? "✓ " : ""}{plan.name}</span>
                    <span className="mt-1 block text-[10px] leading-relaxed opacity-75">{plan.recommendedFor}</span>
                  </button>
                ))}
              </div>
            </section>
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

        {activeTab === "more" && (
          <div className="mx-auto w-full max-w-5xl">
            <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
              <p className="text-[12px] font-bold text-[#534AB7]">더보기</p>
              <h2 className="mt-1 text-[22px] font-bold text-gray-900">알림과 기록 관리</h2>
              <Link href="/fitness/settings" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-red-50 px-4 text-sm font-bold text-red-700">운동 설정 · 기록 초기화 →</Link>
              <p className="mt-2 text-[13px] leading-relaxed text-gray-500">운동 선택과 편집은 각 요일의 <b className="text-gray-700">오늘 운동 바꾸기</b> 또는 <b className="text-gray-700">주간 운동표</b>에서 할 수 있어요.</p>
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

    </div>
    </>
  );
}

export default function Page() {
  return <AuthGate><FitnessApp /></AuthGate>;
}
