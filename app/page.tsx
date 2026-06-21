'use client';

import { useEffect, useState } from 'react';
import { ADAPTATION_WORKOUTS, SWITCHON_DEFAULT_START_DATE, SWITCHON_MODE_KEY, SWITCHON_START_DATE_KEY, SwitchOnSelection, WORKOUTS } from './data/workouts';
import { getDateForWorkoutDay, getWeeklyWorkoutCompletion, readWorkoutCompletionStore, WORKOUT_COMPLETED_DAYS_KEY, WorkoutCompletionStore } from './data/workoutCompletion';
import WeeklyView from './components/WeeklyView';
import DayView from './components/DayView';
import DietView from './components/DietView';
import SafetyView from './components/SafetyView';
import RecordCalendarView from './components/RecordCalendarView';
import SwitchOnModePanel, { SwitchOnMode } from './components/SwitchOnModePanel';
import PullupTrainingView from './components/PullupTrainingView';

type TabId = 'ov' | 'mon' | 'tue' | 'thu' | 'fri' | 'sat' | 'pullup' | 'diet' | 'record' | 'tips';
type WorkoutDayId = Extract<TabId, 'mon' | 'tue' | 'thu' | 'fri' | 'sat'>;

const TABS: { id: TabId; label: string }[] = [
  { id: 'ov',   label: '주간 개요' },
  { id: 'mon',  label: '월요일' },
  { id: 'tue',  label: '화요일' },
  { id: 'thu',  label: '목요일' },
  { id: 'fri',  label: '금요일' },
  { id: 'sat',  label: '토요일' },
  { id: 'pullup', label: '철봉 훈련' },
  { id: 'diet', label: '식단' },
  { id: 'record', label: '기록' },
  { id: 'tips', label: '주의사항' },
];

export default function Page() {
  const [activeTab, setActiveTab] = useState<TabId>('ov');
  const [startDate, setStartDate] = useState(SWITCHON_DEFAULT_START_DATE);
  const [switchMode, setSwitchMode] = useState<SwitchOnMode>('auto');
  const [completedStore, setCompletedStore] = useState<WorkoutCompletionStore>({});

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setStartDate(window.localStorage.getItem(SWITCHON_START_DATE_KEY) || SWITCHON_DEFAULT_START_DATE);
    setSwitchMode((window.localStorage.getItem(SWITCHON_MODE_KEY) as SwitchOnMode | null) || 'auto');

    setCompletedStore(readWorkoutCompletionStore());
  }, []);

  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    window.localStorage.setItem(SWITCHON_START_DATE_KEY, value);
  };

  const handleSwitchModeChange = (value: SwitchOnMode) => {
    setSwitchMode(value);
    window.localStorage.setItem(SWITCHON_MODE_KEY, value);
  };

  const getSwitchSelection = (): SwitchOnSelection => {
    if (switchMode !== 'auto') return switchMode;
    const start = new Date(`${startDate || SWITCHON_DEFAULT_START_DATE}T00:00:00`);
    const today = new Date();
    const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.floor((current.getTime() - start.getTime()) / 86400000);
    if (diff <= 0) return 'adapt1';
    if (diff === 1) return 'adapt2';
    if (diff === 2) return 'adapt3';
    return 'base';
  };

  const toggleDayComplete = (dayId: WorkoutDayId) => {
    setCompletedStore((prev) => {
      const dateKey = getDateForWorkoutDay(dayId);
      const next = { ...prev, [dateKey]: !prev[dateKey] };
      window.localStorage.setItem(WORKOUT_COMPLETED_DAYS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleTabChange = (id: string) => {
    setActiveTab(id as TabId);
    // Scroll to top when switching tabs
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const completedDays = getWeeklyWorkoutCompletion(completedStore);
  const switchSelection = getSwitchSelection();
  const baseDayWorkout = WORKOUTS.find((w) => w.id === activeTab);
  const dayWorkout = baseDayWorkout && switchSelection !== 'base' ? ADAPTATION_WORKOUTS[switchSelection] : baseDayWorkout;

  return (
    <div className="min-h-dvh bg-gray-50">
      {/* ── Top Header ── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-0">
          {/* Title Row */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🏋️</span>
            <div>
              <h1 className="text-[20px] font-semibold text-gray-800 leading-tight">AI 운동</h1>
              <p className="text-[12px] text-gray-400 leading-tight">재민님 맞춤 홈트 플랜 v7</p>
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
                    ? 'border-[#534AB7] text-[#534AB7] bg-[#EEEDFE]/30'
                    : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
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
        <SwitchOnModePanel startDate={startDate} mode={switchMode} selection={switchSelection} onStartDateChange={handleStartDateChange} onModeChange={handleSwitchModeChange} />
        {activeTab === 'ov' && (
          <WeeklyView onTabChange={handleTabChange} completedDays={completedDays} />
        )}

        {dayWorkout && ['mon', 'tue', 'thu', 'fri', 'sat'].includes(activeTab) && (
          <DayView
            day={dayWorkout}
            isCompleted={completedDays[activeTab as WorkoutDayId]}
            onToggleComplete={() => toggleDayComplete(activeTab as WorkoutDayId)}
            onPullupTraining={() => handleTabChange('pullup')}
          />
        )}

        {activeTab === 'pullup' && <PullupTrainingView />}

        {activeTab === 'diet' && <DietView />}

        {activeTab === 'record' && <RecordCalendarView />}

        {activeTab === 'tips' && <SafetyView />}
      </main>

      {/* ── Bottom Navigation (Mobile) ── */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-30 md:hidden safe-area-bottom">
        <div className="flex justify-around py-2">
          {[
            { id: 'ov',   emoji: '📅', label: '개요' },
            { id: 'mon',  emoji: '💪', label: '월' },
            { id: 'tue',  emoji: '🦵', label: '화' },
            { id: 'thu',  emoji: '🔝', label: '목' },
            { id: 'fri',  emoji: '⚡', label: '금' },
            { id: 'sat',  emoji: '🔥', label: '토' },
            { id: 'diet', emoji: '🥗', label: '식단' },
            { id: 'record', emoji: '📈', label: '기록' },
            { id: 'tips', emoji: '⚠️', label: '주의' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              className={`flex flex-col items-center gap-0.5 px-1 py-1 rounded-lg transition-colors min-w-[36px] ${
                activeTab === item.id
                  ? 'text-[#534AB7]'
                  : 'text-gray-400'
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
