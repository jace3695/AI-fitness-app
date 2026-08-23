"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getLocalDateKey } from "@/utils/dateKey";

const DAILY_LEARNING_HISTORY_STORAGE_KEY = "dailyLearningHistory";
const LEARNING_SETTINGS_STORAGE_KEY = "learningSettings";
const DEFAULT_DAILY_GOAL_COUNT = 5;

type DailyLearningHistoryItem = {
  completedIds: string[];
  completedCount: number;
  totalCount: number;
  updatedAt: string;
};

type DailyLearningHistoryStorage = Record<string, DailyLearningHistoryItem>;
type LearningSettings = {
  dailyGoalCount?: number;
};
const getSafeCompletedIds = (value: unknown) =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

const routineLabelMap: Record<string, string> = {
  kana: "가나",
  words: "단어",
  sentences: "문장",
  grammar: "문법",
  review: "복습",
};

const routineOrder = ["kana", "words", "sentences", "grammar", "review"] as const;
const toDateKey = getLocalDateKey;

const parseDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const getCompletedCount = (entry?: DailyLearningHistoryItem) => {
  if (!entry) return 0;

  const countFromField = Number.isFinite(entry.completedCount) ? entry.completedCount : 0;
  const countFromIds = getSafeCompletedIds(entry.completedIds).length;

  return Math.max(countFromField, countFromIds, 0);
};

const getDayVisual = (completedCount: number) => {
  if (completedCount >= 5) {
    return { background: "#d8ffe7", tone: "#0f6b37", label: "5/5" };
  }
  if (completedCount >= 3) {
    return { background: "#ecfff4", tone: "#167948", label: `${Math.min(completedCount, 5)}/5` };
  }
  if (completedCount >= 1) {
    return { background: "#f6fffa", tone: "#1c8c56", label: `${Math.min(completedCount, 5)}/5` };
  }

  return { background: "#ffffff", tone: "#6b7280", label: "" };
};

const getStreakDays = (history: DailyLearningHistoryStorage, today: Date) => {
  let streak = 0;
  const cursor = new Date(today);

  while (true) {
    const key = toDateKey(cursor);
    const entry = history[key];
    if (!entry || getCompletedCount(entry) <= 0) break;

    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
};

const getMonthDays = (viewDate: Date) => {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startWeekday = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const days: Array<Date | null> = [];
  for (let i = 0; i < startWeekday; i += 1) {
    days.push(null);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    days.push(new Date(year, month, day));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
};

const getSafeDailyGoalCount = (value: unknown) => {
  if (!Number.isFinite(value)) return DEFAULT_DAILY_GOAL_COUNT;

  const rounded = Math.round(value as number);
  if (rounded < 1 || rounded > 5) return DEFAULT_DAILY_GOAL_COUNT;

  return rounded;
};

export default function CalendarPage() {
  const today = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDateKey, setSelectedDateKey] = useState(toDateKey(today));

  const [history, setHistory] = useState<DailyLearningHistoryStorage>({});
  const [dailyGoalCount, setDailyGoalCount] = useState(DEFAULT_DAILY_GOAL_COUNT);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const loadHistory = () => {
      try {
        const raw = window.localStorage.getItem(DAILY_LEARNING_HISTORY_STORAGE_KEY);
        if (!raw) {
          setHistory({});
          return;
        }
        const parsed: unknown = JSON.parse(raw);
        setHistory(typeof parsed === "object" && parsed !== null ? (parsed as DailyLearningHistoryStorage) : {});
      } catch {
        setHistory({});
      }
    };

    const loadLearningSettings = () => {
      try {
        const raw = window.localStorage.getItem(LEARNING_SETTINGS_STORAGE_KEY);
        if (!raw) {
          setDailyGoalCount(DEFAULT_DAILY_GOAL_COUNT);
          return;
        }

        const parsed: unknown = JSON.parse(raw);
        const dailyGoal =
          typeof parsed === "object" && parsed !== null
            ? (parsed as LearningSettings).dailyGoalCount
            : undefined;
        setDailyGoalCount(getSafeDailyGoalCount(dailyGoal));
      } catch {
        setDailyGoalCount(DEFAULT_DAILY_GOAL_COUNT);
      }
    };

    loadHistory();
    loadLearningSettings();
    window.addEventListener("storage", loadHistory);
    window.addEventListener("storage", loadLearningSettings);
    window.addEventListener("focus", loadHistory);
    window.addEventListener("focus", loadLearningSettings);

    return () => {
      window.removeEventListener("storage", loadHistory);
      window.removeEventListener("storage", loadLearningSettings);
      window.removeEventListener("focus", loadHistory);
      window.removeEventListener("focus", loadLearningSettings);
    };
  }, []);

  const calendarDays = useMemo(() => getMonthDays(viewDate), [viewDate]);
  const monthStats = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    return Object.entries(history).reduce(
      (acc, [dateKey, entry]) => {
        if (!entry || getCompletedCount(entry) <= 0) return acc;

        const date = parseDateKey(dateKey);
        if (!date) return acc;
        if (date.getFullYear() !== year || date.getMonth() !== month) return acc;

        return {
          learnedDays: acc.learnedDays + 1,
          totalCompletedRoutines: acc.totalCompletedRoutines + getCompletedCount(entry),
        };
      },
      { learnedDays: 0, totalCompletedRoutines: 0 },
    );
  }, [history, viewDate]);

  const streakDays = useMemo(() => getStreakDays(history, today), [history, today]);
  const todayEntry = history[toDateKey(today)];
  const todayCompletedCount = getCompletedCount(todayEntry);
  const todayGoalRate = Math.round(Math.min(todayCompletedCount / dailyGoalCount, 1) * 100);
  const todayOverallRate = Math.round((todayCompletedCount / routineOrder.length) * 100);

  const moveMonth = (diff: number) => {
    const nextMonthDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + diff, 1);
    setViewDate(nextMonthDate);
    setSelectedDateKey(toDateKey(nextMonthDate));
  };

  const moveToCurrentMonth = () => {
    const currentMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);
    setViewDate(currentMonthDate);
    setSelectedDateKey(toDateKey(today));
  };

  const selectedEntry = history[selectedDateKey];
  const selectedCompletedIds = getSafeCompletedIds(selectedEntry?.completedIds);
  const selectedCompletedIdSet = new Set(selectedCompletedIds);
  const completedRoutines = routineOrder.filter((id) => selectedCompletedIdSet.has(id));
  const incompletedRoutines = routineOrder.filter((id) => !selectedCompletedIdSet.has(id));
  const hasLearningRecord = Boolean(selectedEntry && selectedCompletedIds.length > 0);
  const selectedDateLabel = selectedDateKey.replaceAll("-", ".");
  const isSelectedToday = selectedDateKey === toDateKey(today);

  const stats = [
    { label: "연속 학습일", value: `${streakDays}일`, tone: "#3b82f6" },
    { label: "이번 달 학습일", value: `${monthStats.learnedDays}일`, tone: "#4f46e5" },
    { label: "이번 달 완료 루틴", value: `${monthStats.totalCompletedRoutines}개`, tone: "#0ea5e9" },
    { label: "목표 달성률", value: `${todayGoalRate}%`, tone: "#f59e0b" },
    { label: "전체 완료율", value: `${todayOverallRate}%`, tone: "#fb7185" },
  ];

  return (
    <section style={{ display: "grid", gap: "14px" }}>
      <div className="page-header card" style={{ marginBottom: 0 }}>
        <h1 style={{ marginBottom: "6px" }}>학습 달력</h1>
        <p className="muted" style={{ margin: 0 }}>
          날짜별 학습 기록과 목표 달성률을 확인해 보세요.
        </p>
      </div>

      <section className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          {stats.map((item) => (
            <div
              key={item.label}
              style={{
                border: "1px solid #dbe8fb",
                background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
                borderRadius: "12px",
                padding: "12px",
                boxShadow: "0 5px 12px rgba(75, 115, 178, 0.08)",
              }}
            >
              <div style={{ color: "#64748b", fontSize: "12px", fontWeight: 600 }}>{item.label}</div>
              <div style={{ marginTop: "5px", color: item.tone, fontSize: "24px", fontWeight: 800, lineHeight: 1.2 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <button type="button" onClick={() => moveMonth(-1)} className="btn" style={{ minHeight: "40px", padding: "8px 14px", fontSize: "14px" }}>
            이전 달
          </button>
          <h2
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 800,
              color: "#1e3a8a",
              border: "1px solid #d6e4f8",
              borderRadius: "999px",
              padding: "8px 14px",
              background: "#f4f8ff",
            }}
          >
            {viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월
          </h2>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" onClick={moveToCurrentMonth} style={{ minHeight: "40px", padding: "8px 13px", borderRadius: "10px", border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", fontWeight: 700 }}>
              이번 달
            </button>
            <button type="button" onClick={() => moveMonth(1)} className="btn" style={{ minHeight: "40px", padding: "8px 14px", fontSize: "14px" }}>
              다음 달
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "7px", marginBottom: "8px" }}>
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
            <div key={day} style={{ textAlign: "center", fontSize: "12px", color: "#64748b", fontWeight: 700 }}>
              {day}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "7px" }}>
          {calendarDays.map((day, index) => {
            if (!day) return <div key={`empty-${index}`} style={{ minHeight: "68px" }} />;

            const dateKey = toDateKey(day);
            const entry = history[dateKey];
            const completedCount = getCompletedCount(entry);
            const isToday = isSameDay(day, today);
            const isSelected = selectedDateKey === dateKey;
            const visual = getDayVisual(completedCount);
            const baseBorder = isSelected ? "2px solid #2563eb" : "1px solid #d4deee";
            const todayShadow = isToday
              ? "inset 0 0 0 1px rgba(37, 99, 235, 0.28), 0 5px 12px rgba(37, 99, 235, 0.2)"
              : "0 4px 10px rgba(84, 110, 153, 0.07)";

            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => setSelectedDateKey(dateKey)}
                style={{
                  minHeight: "68px",
                  borderRadius: "12px",
                  border: baseBorder,
                  background: visual.background,
                  color: "#1f2937",
                  fontWeight: isToday ? 800 : 600,
                  boxShadow: todayShadow,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "3px",
                  padding: "6px 4px",
                }}
              >
                <div>{day.getDate()}</div>
                {visual.label && (
                  <div style={{ fontSize: "11px", color: visual.tone, fontWeight: 700 }}>
                    {visual.label}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card" style={{ marginTop: 0 }}>
        <h2 style={{ marginTop: 0, marginBottom: "12px", color: "#1e40af" }}>{selectedDateLabel} 학습 상세</h2>

        {!hasLearningRecord ? (
          <p className="muted" style={{ marginTop: 0, marginBottom: isSelectedToday ? "12px" : 0 }}>
            아직 완료된 루틴이 없어요. 오늘 루틴부터 차근차근 시작해 보세요.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div style={{ border: "1px solid #bde9cb", background: "#f2fff7", borderRadius: "12px", padding: "12px" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "14px", color: "#166534" }}>완료한 루틴</h3>
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {completedRoutines.map((id) => (
                  <li key={id}>{routineLabelMap[id] ?? id}</li>
                ))}
              </ul>
            </div>
            <div style={{ border: "1px solid #e1e8f4", background: "#f8faff", borderRadius: "12px", padding: "12px" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "14px", color: "#475569" }}>미완료 루틴</h3>
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {incompletedRoutines.map((id) => (
                  <li key={id}>{routineLabelMap[id] ?? id}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {isSelectedToday && (
          <div
            style={{
              marginTop: "14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
              borderTop: "1px solid #e5ebf7",
              paddingTop: "12px",
            }}
          >
            <p className="muted" style={{ margin: 0 }}>
              오늘 기록을 확인했다면 홈으로 이동해 남은 루틴을 이어서 진행해 보세요.
            </p>
            <Link
              href="/language"
              style={{
                display: "inline-block",
                textDecoration: "none",
                border: "1px solid #fecdd3",
                borderRadius: "10px",
                padding: "9px 13px",
                fontSize: "14px",
                fontWeight: 700,
                color: "#be123c",
                background: "#fff1f2",
                whiteSpace: "nowrap",
              }}
            >
              홈으로 돌아가 오늘 루틴 하기
            </Link>
          </div>
        )}
      </section>
    </section>
  );
}
