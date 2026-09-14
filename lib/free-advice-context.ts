export const FREE_ADVICE_SCOPES = ["assistant", "language", "budget", "fitness"] as const;
export type FreeAdviceScope = typeof FREE_ADVICE_SCOPES[number];
export const FREE_ADVICE_LABELS: Record<FreeAdviceScope, string> = {
  assistant: "일상", language: "일본어 학습", budget: "가계부", fitness: "운동",
};
export type AdviceMetric = { id: string; label: string; value: number; unit: string };
export type FreeAdviceContext = {
  scope: FreeAdviceScope; startDate: string; endDate: string;
  recordCount: number; metrics: AdviceMetric[]; notes: string[];
};
export type AdviceRecords = {
  fitnessState?: unknown; languageState?: unknown;
  expenses?: unknown[]; income?: unknown[]; savings?: unknown[];
};

export function isFreeAdviceScope(value: unknown): value is FreeAdviceScope {
  return typeof value === "string" && FREE_ADVICE_SCOPES.includes(value as FreeAdviceScope);
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    if (!value.trim()) return {};
    return object(JSON.parse(value));
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown): unknown[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}
function number(value: unknown) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
export function adviceDateRange(now = new Date()) {
  const endDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const startDate = new Date(Date.parse(`${endDate}T12:00:00Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
  return { startDate, endDate };
}
function ageInDays(date: string, endDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return -1;
  const timestamp = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return -1;
  return (Date.parse(`${endDate}T12:00:00Z`) - timestamp) / 86_400_000;
}
function datedEntries(value: unknown, endDate: string) {
  return Object.entries(object(value)).filter(([date]) => {
    const age = ageInDays(date, endDate); return age >= 0 && age < 28;
  });
}

// Only these calculated numbers and fixed labels can leave the app. Never send
// record JSON, merchant names, notes, memories, account IDs or conversation logs.
export function buildFreeAdviceContext(scope: FreeAdviceScope, records: AdviceRecords, now = new Date()): FreeAdviceContext {
  const range = adviceDateRange(now);
  const result: FreeAdviceContext = { scope, ...range, recordCount: 0, metrics: [], notes: ["서버에 저장된 기록만 포함하며, 기록이 없는 날의 상태는 추정하지 않아요."] };
  const add = (id: string, label: string, value: number, unit: string) => result.metrics.push({ id, label, value: Math.round(value * 10) / 10, unit });
  if (scope === "fitness" || scope === "assistant") {
    const state = object(records.fitnessState);
    const workouts = datedEntries(state["ai-fitness-workout-completed-days"], range.endDate)
      .map(([date, raw]) => ({ date, row: typeof raw === "boolean" ? { workoutDone: raw } : object(raw) }));
    const performed = workouts.filter(({ row }) => row.workoutDone === true || row.workoutStatus === "completed" || row.workoutStatus === "partial");
    result.recordCount += workouts.length;
    add("workout.days", "최근 28일 운동 수행", performed.length, "일");
    add("workout.recent7", "최근 7일 운동 수행", performed.filter(({ date }) => ageInDays(date, range.endDate) < 7).length, "일");
    add("workout.previous7", "직전 7일 운동 수행", performed.filter(({ date }) => { const age = ageInDays(date, range.endDate); return age >= 7 && age < 14; }).length, "일");
    add("workout.stopped", "운동 중단 기록", workouts.filter(({ row }) => row.workoutStatus === "stopped").length, "일");
    add("workout.discomfort", "운동 불편·통증 신호", workouts.filter(({ row }) => row.workoutPain === true || ["pain", "worse"].includes(String(row.workoutBackStatus)) || (Array.isArray(row.workoutNeurologicalSymptoms) && row.workoutNeurologicalSymptoms.length > 0)).length, "일");
    add("workout.unknownBack", "허리 상태 미응답", workouts.filter(({ row }) => !["none", "stiff", "pain", "worse"].includes(String(row.workoutBackStatus)) && row.workoutPain !== true).length, "일");
    const waters = datedEntries(state["ai-fitness-water-intake"], range.endDate).map(([, value]) => number(value)).filter((value): value is number => value !== null);
    const meals = datedEntries(state["ai-fitness-diet-completed-days"], range.endDate);
    result.recordCount += meals.length + waters.length;
    add("diet.days", "식단을 기록한 날", meals.length, "일");
    add("water.days", "물 섭취 기록일", waters.length, "일");
    if (waters.length) add("water.average", "기록한 날의 평균 물 섭취", waters.reduce((sum, value) => sum + value, 0) / waters.length, "mL");
  }
  if (scope === "language" || scope === "assistant") {
    const state = object(records.languageState);
    const history = datedEntries(state.dailyLearningHistory, range.endDate);
    const activityDates = new Set(history.filter(([, value]) => {
      const row = object(value);
      return (number(row.completedCount) !== null && Number(row.completedCount) > 0) || (Array.isArray(row.completedIds) && row.completedIds.length > 0);
    }).map(([date]) => date));
    const curriculum = object(state.japaneseCurriculumProgressV1);
    for (const date of array(curriculum.activityDates)) {
      if (typeof date === "string" && ageInDays(date, range.endDate) >= 0 && ageInDays(date, range.endDate) < 28) activityDates.add(date);
    }
    const reviewKeys = ["wrongKana", "wrongKanaChars", "wrongWords", "wrongSentences", "japaneseCurriculumReviewV1"];
    const reviewCount = reviewKeys.reduce((sum, key) => sum + array(state[key]).length, 0);
    const grammarReview = array(state.grammarProgress).map(object).filter(row => Number(row.wrongCount) > 0 || row.lastResult === "wrong").length;
    result.recordCount += activityDates.size + reviewCount + grammarReview;
    add("language.days", "최근 28일 학습 활동 기록일", activityDates.size, "일");
    add("language.review", "현재 복습 목록 항목", reviewCount + grammarReview, "개");
    result.notes.push("복습 목록은 현재 저장된 항목 수로, 중복 가능성이 있어 서로 다른 문제 수나 전체 실력을 뜻하지 않아요.");
    result.notes.push("학습일은 일일 루틴과 새 과정의 활동 날짜를 합쳐 같은 날은 한 번만 셌어요. 과정 전체의 완료나 숙달을 뜻하지 않아요.");
  }
  if (scope === "budget" || scope === "assistant") {
    for (const [key, label, rows] of [
      ["expense", "지출", records.expenses ?? []], ["income", "수입", records.income ?? []], ["savings", "저축", records.savings ?? []],
    ] as const) {
      const valid = rows.map(object).filter(row => {
        const age = typeof row.date === "string" ? ageInDays(row.date, range.endDate) : -1;
        if (age < 0 || age >= 28) return false;
        if (number(row.amount) === null) throw new Error("저장된 금액을 확인하지 못했어요.");
        return true;
      });
      result.recordCount += valid.length;
      add(`budget.${key}Count`, `최근 28일 ${label} 기록`, valid.length, "건");
      add(`budget.${key}`, `최근 28일 ${label} 합계`, valid.reduce((sum, row) => sum + Number(row.amount), 0), "원");
      if (key === "expense") {
        add("budget.expenseRecent7", "최근 7일 지출", valid.filter(row => ageInDays(String(row.date), range.endDate) < 7).reduce((sum, row) => sum + Number(row.amount), 0), "원");
        add("budget.expensePrevious7", "직전 7일 지출", valid.filter(row => { const age = ageInDays(String(row.date), range.endDate); return age >= 7 && age < 14; }).reduce((sum, row) => sum + Number(row.amount), 0), "원");
      }
    }
    result.notes.push("월 전체가 아닌 최근 28일 합계예요. 기록이 없는 수입·지출·저축을 0원으로 실제 확정하지 않아요.");
  }
  return result;
}
