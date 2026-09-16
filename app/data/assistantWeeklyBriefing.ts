import { isWorkoutPerformed, type WorkoutCompletionStore } from "./workoutCompletion.ts";

export type AssistantWeeklyArea = "tasks" | "budget" | "fitness" | "diet" | "language" | "growth";

type WeeklyTask = {
  status: string;
  due_at: string | null;
  updated_at: string;
};

type WeeklyBudgetTransaction = { amount: number | string; date: string };
type WeeklyGrowthSession = {
  routine_id: string | null;
  session_date: string;
  status: string;
  actual_minutes: number | string;
};

export type AssistantWeeklyCard = {
  area: AssistantWeeklyArea;
  label: string;
  value: string;
  detail: string;
  href: string;
};

export type AssistantWeeklyBriefing = {
  startDate: string;
  endDate: string;
  cards: AssistantWeeklyCard[];
  recommendation: {
    area: AssistantWeeklyArea | "calendar";
    title: string;
    detail: string;
    label: string;
    href: string;
  };
};

export type AssistantWeeklyBriefingInput = {
  todayKey: string;
  items: WeeklyTask[];
  budgetTransactions: WeeklyBudgetTransaction[];
  appState: Record<string, unknown> | null;
  languageState: Record<string, unknown> | null;
  growthSessions: WeeklyGrowthSession[];
  available?: Partial<Record<AssistantWeeklyArea, boolean>>;
};

function parseRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getAssistantWeeklyStartDate(todayKey: string) {
  return shiftDateKey(todayKey, -6);
}

export function getAssistantBudgetQueryStart(todayKey: string) {
  const monthStart = `${todayKey.slice(0, 7)}-01`;
  const weeklyStart = getAssistantWeeklyStartDate(todayKey);
  return weeklyStart < monthStart ? weeklyStart : monthStart;
}

function seoulDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function inRange(dateKey: string, startDate: string, endDate: string) {
  return dateKey >= startDate && dateKey <= endDate;
}

function formatWon(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function buildAssistantWeeklyBriefing(input: AssistantWeeklyBriefingInput): AssistantWeeklyBriefing {
  const startDate = getAssistantWeeklyStartDate(input.todayKey);
  const available = {
    tasks: true,
    budget: true,
    fitness: true,
    diet: true,
    language: true,
    growth: true,
    ...input.available,
  };
  const cards: AssistantWeeklyCard[] = [];
  const openItems = input.items.filter((item) => !["completed", "cancelled"].includes(item.status));
  const completedItems = input.items.filter((item) =>
    item.status === "completed" && inRange(seoulDateKey(item.updated_at), startDate, input.todayKey)
  );
  const overdueItems = openItems.filter((item) => item.due_at && seoulDateKey(item.due_at) < input.todayKey);

  if (available.tasks) cards.push({
    area: "tasks",
    label: "일정·할 일",
    value: `${completedItems.length}개 완료`,
    detail: `미완료 ${openItems.length}개${overdueItems.length ? ` · 기한 지남 ${overdueItems.length}개` : ""}`,
    href: "#assistant-list",
  });

  const weeklyTransactions = input.budgetTransactions.filter((transaction) =>
    inRange(transaction.date, startDate, input.todayKey)
  );
  const weeklySpent = weeklyTransactions.reduce((sum, transaction) => {
    const amount = Number(transaction.amount);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  if (available.budget) cards.push({
    area: "budget",
    label: "가계부",
    value: `${formatWon(weeklySpent)} 지출`,
    detail: `최근 7일 ${weeklyTransactions.length}건`,
    href: "/budget",
  });

  const workoutStore = parseRecord(input.appState?.["ai-fitness-workout-completed-days"]) as WorkoutCompletionStore;
  const workoutDays = Object.entries(workoutStore).filter(([date, value]) =>
    inRange(date, startDate, input.todayKey) && isWorkoutPerformed(value)
  ).length;
  if (available.fitness) cards.push({
    area: "fitness",
    label: "운동",
    value: `${workoutDays}일 실행`,
    detail: workoutDays ? "완료·부분 완료 기록 기준" : "최근 7일 실행 기록 없음",
    href: "/fitness",
  });

  const dietStore = parseRecord(input.appState?.["ai-fitness-diet-completed-days"]);
  const dietDays = Object.entries(dietStore).filter(([date, value]) =>
    inRange(date, startDate, input.todayKey) && Object.keys(parseRecord(value)).length > 0
  ).length;
  if (available.diet) cards.push({
    area: "diet",
    label: "식단",
    value: `${dietDays}일 기록`,
    detail: dietDays ? "저장한 식단 날짜 기준" : "최근 7일 식단 기록 없음",
    href: "/diet",
  });

  const languageHistory = parseRecord(input.languageState?.dailyLearningHistory);
  let languageDays = 0;
  let languageRoutines = 0;
  for (const [date, rawEntry] of Object.entries(languageHistory)) {
    if (!inRange(date, startDate, input.todayKey)) continue;
    const entry = parseRecord(rawEntry);
    const ids = Array.isArray(entry.completedIds)
      ? new Set(entry.completedIds.filter((id) => typeof id === "string")).size
      : 0;
    const count = Math.min(5, Math.max(0, Number(entry.completedCount) || 0, ids));
    if (count > 0) languageDays += 1;
    languageRoutines += count;
  }
  if (available.language) cards.push({
    area: "language",
    label: "언어 학습",
    value: `${languageDays}일 학습`,
    detail: `완료 루틴 ${languageRoutines}개`,
    href: "/language",
  });

  const weeklyGrowthSessions = input.growthSessions.filter((session) =>
    inRange(session.session_date, startDate, input.todayKey)
  );
  const growthDays = new Set(weeklyGrowthSessions.map((session) => session.session_date)).size;
  const growthMinutes = weeklyGrowthSessions.reduce((sum, session) => {
    const minutes = Number(session.actual_minutes);
    return sum + (Number.isFinite(minutes) ? Math.max(0, minutes) : 0);
  }, 0);
  if (available.growth) cards.push({
    area: "growth",
    label: "자기계발",
    value: `${growthDays}일 실행`,
    detail: `기록 ${Math.round(growthMinutes)}분`,
    href: "/growth",
  });

  let recommendation: AssistantWeeklyBriefing["recommendation"];
  if (available.tasks && overdueItems.length) {
    recommendation = {
      area: "tasks",
      title: `기한이 지난 할 일 ${overdueItems.length}개부터 정리해요`,
      detail: `최근 7일 ${completedItems.length}개를 완료했고, 현재 미완료는 ${openItems.length}개입니다.`,
      label: "할 일 확인",
      href: "#assistant-list",
    };
  } else {
    const consistency = [
      available.diet && { area: "diet" as const, days: dietDays, goal: 5, label: "식단", href: "/diet" },
      available.language && { area: "language" as const, days: languageDays, goal: 5, label: "언어 학습", href: "/language" },
      available.fitness && { area: "fitness" as const, days: workoutDays, goal: 3, label: "운동", href: "/fitness" },
      available.growth && { area: "growth" as const, days: growthDays, goal: 3, label: "자기계발", href: "/growth" },
    ].filter((item): item is Exclude<typeof item, false> => Boolean(item))
      .sort((left, right) => left.days / left.goal - right.days / right.goal)[0];
    recommendation = consistency && consistency.days < consistency.goal
      ? {
          area: consistency.area,
          title: `${consistency.label}을 하루 더 이어가요`,
          detail: `최근 7일 ${consistency.days}일 기록했습니다. 이번 주에는 한 번만 더 실행해 흐름을 이어보세요.`,
          label: `${consistency.label} 열기`,
          href: consistency.href,
        }
      : {
          area: "calendar",
          title: consistency ? "이번 주 목표 흐름을 채웠어요" : "연결된 기록을 모두 확인했어요",
          detail: consistency ? "무리해서 횟수를 늘리기보다 현재 흐름을 편안하게 유지해 보세요." : "최근 7일 기록에서 추가로 제안할 영역이 없습니다.",
          label: "통합 달력 보기",
          href: "/calendar",
        };
  }

  return { startDate, endDate: input.todayKey, cards, recommendation };
}
