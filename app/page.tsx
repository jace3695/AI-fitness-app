"use client";

import { useEffect, useState } from "react";
import { RoutineSelection, WORKOUT_ROUTINE_SELECTION_KEY } from "./data/workouts";
import {
  DEFAULT_WEEKLY_WORKOUT_PLAN_ID,
  getDayWorkoutForPlan,
  getWeeklyWorkoutPlanById,
  getWorkoutGroupForPlanDay,
  SELECTED_WEEKLY_WORKOUT_PLAN_KEY,
  WEEKLY_WORKOUT_PLANS,
} from "./data/workoutPlans";
import {
  getWeeklyWorkoutCompletion,
  getWorkoutDayForDate,
  getWorkoutRecord,
  readWorkoutCompletionStore,
  WORKOUT_COMPLETED_DAYS_KEY,
  WorkoutCompletionStore,
  WorkoutDayRecord,
} from "./data/workoutCompletion";
import {
  assessRecoveryMode,
  RecoveryDayRecord,
  saveRecoveryRecord,
  RECOVERY_MODE_DAYS_KEY,
} from "./data/recoveryMode";
import { getLocalDateKey } from "./data/dietPlans";
import WeeklyView from "./components/WeeklyView";
import DayView from "./components/DayView";
import DietView from "./components/DietView";
import SafetyView from "./components/SafetyView";
import RecordCalendarView from "./components/RecordCalendarView";
import SwitchOnModePanel from "./components/SwitchOnModePanel";
import PullupTrainingView from "./components/PullupTrainingView";

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
  | "diet"
  | "record"
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
  { id: "diet", label: "식단" },
  { id: "record", label: "기록" },
  { id: "tips", label: "주의사항" },
];

export default function Page() {
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
  const [showBaseRoutine, setShowBaseRoutine] = useState(false);

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

    setSelectedWeeklyWorkoutPlanId(
      window.localStorage.getItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY) ||
        DEFAULT_WEEKLY_WORKOUT_PLAN_ID,
    );

    setCompletedStore(readWorkoutCompletionStore());
    setRecoveryToday(
      assessRecoveryMode(
        getLocalDateKey(),
        ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(activeTab)
          ? (activeTab as WorkoutDayId)
          : null,
      ),
    );
  }, [activeTab]);

  useEffect(() => {
    const todayWorkoutDay = getWorkoutDayForDate();
    if (todayWorkoutDay) {
      setActiveTab(todayWorkoutDay);
    }
  }, []);

  const handleRoutineSelectionChange = (value: RoutineSelection) => {
    setRoutineSelection(value);
    window.localStorage.setItem(WORKOUT_ROUTINE_SELECTION_KEY, value);
    if (value === "recovery") setShowBaseRoutine(false);
  };

  const handleWeeklyWorkoutPlanChange = (planId: string) => {
    setSelectedWeeklyWorkoutPlanId(planId);
    window.localStorage.setItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY, planId);
  };

  const saveDayWorkout = (dayId: WorkoutDayId, pain: boolean, memo: string) => {
    const dateKey = getLocalDateKey();
    if (
      recoveryToday?.recoveryMode &&
      !window.confirm(
        "오늘은 회복 우선으로 기록되어 있습니다. 회복 기록을 해제하고 운동 완료로 변경할까요?",
      )
    )
      return;
    const exerciseNames =
      dayWorkout?.phases
        .flatMap((phase) => phase.exercises)
        .map((exercise) => exercise.name) ?? [];
    setCompletedStore((prev) => {
      const current = getWorkoutRecord(prev[dateKey]);
      const hasRosaryCardio = exerciseNames.includes("운동 전 묵주기도 슬라이딩보드");
      const hasPostWorkoutCardio =
        exerciseNames.includes("운동 후 슬라이딩보드 마무리");
      const next = {
        ...prev,
        [dateKey]: {
          ...current,
          workoutDone: true,
          workoutRoutineName: selectedWorkoutGroup?.name || dayWorkout?.title,
          workoutPlanName: selectedWeeklyWorkoutPlan.name,
          workoutGroupId: selectedWorkoutGroup?.id,
          workoutExerciseNames: exerciseNames,
          workoutSourceDay: baseDayWorkout?.tabLabel,
          workoutPain: pain,
          workoutMemo: memo.trim() || undefined,
          rosaryCardioDone: hasRosaryCardio || undefined,
          rosaryCardioMinutes: hasRosaryCardio ? 20 : undefined,
          rosaryDecades: hasRosaryCardio ? 5 : undefined,
          postWorkoutCardioDone: hasPostWorkoutCardio || undefined,
          postWorkoutCardioMinutes: hasPostWorkoutCardio ? 5 : undefined,
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
    const dateKey = getLocalDateKey();
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
    setActiveTab(id as TabId);
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
    const raw = window.localStorage.getItem(RECOVERY_MODE_DAYS_KEY);
    const store = raw ? JSON.parse(raw) : {};
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
    window.localStorage.setItem(RECOVERY_MODE_DAYS_KEY, JSON.stringify(next));
    setRecoveryToday(nextRecord);
  };

  const completedDays = getWeeklyWorkoutCompletion(completedStore);
  const todayKey = getLocalDateKey();
  const todayDayName = [
    "일요일",
    "월요일",
    "화요일",
    "수요일",
    "목요일",
    "금요일",
    "토요일",
  ][new Date().getDay()];
  const selectedWeeklyWorkoutPlan = getWeeklyWorkoutPlanById(
    selectedWeeklyWorkoutPlanId,
  );
  const baseDayWorkout = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(activeTab)
    ? getDayWorkoutForPlan(selectedWeeklyWorkoutPlan, activeTab as WorkoutDayId)
    : undefined;
  const selectedWorkoutGroup = baseDayWorkout
    ? getWorkoutGroupForPlanDay(selectedWeeklyWorkoutPlan, activeTab as WorkoutDayId)
    : undefined;
  const dayWorkout = baseDayWorkout;
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
    <div className="min-h-dvh bg-gray-50">
      {/* ── Top Header ── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-0">
          {/* Title Row */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🏋️</span>
            <div>
              <h1 className="text-[20px] font-semibold text-gray-800 leading-tight">
                AI 운동
              </h1>
              <p className="text-[12px] text-gray-400 leading-tight">
                재민님 맞춤 홈트 플랜 v7
              </p>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="tab-scroll flex gap-0.5 overflow-x-auto border-b border-gray-100 -mx-4 px-4">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`shrink-0 text-[12px] px-3 py-2 border-b-2 font-medium transition-colors whitespace-nowrap rounded-t-md ${
                  activeTab === tab.id
                    ? "border-[#534AB7] text-[#534AB7] bg-[#EEEDFE]/30"
                    : "border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="max-w-3xl mx-auto px-4 py-5">
        <SwitchOnModePanel
          selection={routineSelection}
          onSelectionChange={handleRoutineSelectionChange}
        />
        {activeTab === "ov" && (
          <WeeklyView
            onTabChange={handleTabChange}
            completedDays={completedDays}
            plans={WEEKLY_WORKOUT_PLANS}
            selectedPlanId={selectedWeeklyWorkoutPlan.id}
            onPlanChange={handleWeeklyWorkoutPlanChange}
          />
        )}

        {dayWorkout &&
          ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].includes(
            activeTab,
          ) && (
            <>
              <section className="mb-4 rounded-2xl border border-[#D9D6FF] bg-white p-4 shadow-sm">
                <p className="text-[12px] font-bold text-[#534AB7]">
                  오늘 추천 루틴
                </p>
                <h2 className="mt-1 text-[18px] font-bold text-gray-900">
                  오늘은 {todayDayName}입니다.
                </h2>
                <p className="mt-2 text-[13px] font-semibold text-gray-700">
                  선택된 계획: {selectedWeeklyWorkoutPlan.name}
                  <br />
                  오늘 추천 운동: {dayWorkout.title}
                </p>
                <p className="mt-2 text-[12px] text-gray-500">
                  선택한 주간 계획의 요일 배치에 따라 오늘 운동이 자동 선택되었습니다.
                  이번 주 계획을 바꾸려면 주간 개요에서 다른 계획을 선택하세요.
                </p>
              </section>
              <DayView
                day={dayWorkout}
                isCompleted={
                  getWorkoutRecord(completedStore[todayKey]).workoutDone ??
                  false
                }
                onSaveWorkout={(pain, memo) =>
                  saveDayWorkout(activeTab as WorkoutDayId, pain, memo)
                }
                onCancelWorkout={() =>
                  cancelDayWorkout(activeTab as WorkoutDayId)
                }
                workoutPain={
                  getWorkoutRecord(completedStore[todayKey]).workoutPain
                }
                workoutMemo={
                  getWorkoutRecord(completedStore[todayKey]).workoutMemo
                }
                cardioDone={
                  getWorkoutRecord(completedStore[todayKey]).cardioDone
                }
                cardioType={
                  getWorkoutRecord(completedStore[todayKey]).cardioType
                }
                cardioMinutes={
                  getWorkoutRecord(completedStore[todayKey]).cardioMinutes
                }
                cardioMemo={
                  getWorkoutRecord(completedStore[todayKey]).cardioMemo
                }
                onSaveCardio={saveDayCardio}
                onCancelCardio={cancelDayCardio}
                foamRollerDone={
                  getWorkoutRecord(completedStore[todayKey]).foamRollerDone
                }
                foamRollerTiming={
                  getWorkoutRecord(completedStore[todayKey]).foamRollerTiming
                }
                foamRollerAreas={
                  getWorkoutRecord(completedStore[todayKey]).foamRollerAreas
                }
                foamRollerPain={
                  getWorkoutRecord(completedStore[todayKey]).foamRollerPain
                }
                foamRollerMemo={
                  getWorkoutRecord(completedStore[todayKey]).foamRollerMemo
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
            </>
          )}

        {activeTab === "pullup" && <PullupTrainingView />}

        {activeTab === "diet" && <DietView />}

        {activeTab === "record" && <RecordCalendarView />}

        {activeTab === "tips" && <SafetyView />}
      </main>

      {/* ── Bottom Navigation (Mobile) ── */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-30 md:hidden safe-area-bottom">
        <div className="flex justify-around py-2">
          {[
            { id: "ov", emoji: "📅", label: "개요" },
            { id: "sun", emoji: "😴", label: "일" },
            { id: "mon", emoji: "💪", label: "월" },
            { id: "tue", emoji: "🦵", label: "화" },
            { id: "wed", emoji: "🌿", label: "수" },
            { id: "thu", emoji: "🚶", label: "목" },
            { id: "fri", emoji: "⚡", label: "금" },
            { id: "sat", emoji: "🔥", label: "토" },
            { id: "diet", emoji: "🥗", label: "식단" },
            { id: "record", emoji: "📈", label: "기록" },
            { id: "tips", emoji: "⚠️", label: "주의" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              className={`flex flex-col items-center gap-0.5 px-1 py-1 rounded-lg transition-colors min-w-[36px] ${
                activeTab === item.id ? "text-[#534AB7]" : "text-gray-400"
              }`}
            >
              <span className="text-[18px] leading-none">{item.emoji}</span>
              <span className="text-[9px] font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Bottom padding for mobile nav */}
      <div className="h-20 md:h-4" />
    </div>
  );
}
