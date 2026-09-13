import assert from "node:assert/strict";
import test from "node:test";
import { buildAssistantWeeklyBriefing, getAssistantBudgetQueryStart } from "./assistantWeeklyBriefing.ts";

test("월초에는 지난달에 걸친 최근 7일 지출도 조회한다", () => {
  assert.equal(getAssistantBudgetQueryStart("2026-10-03"), "2026-09-27");
  assert.equal(getAssistantBudgetQueryStart("2026-10-20"), "2026-10-01");
});

test("최근 7일의 앱별 기록만 합산하고 같은 언어 학습일을 한 번만 센다", () => {
  const briefing = buildAssistantWeeklyBriefing({
    todayKey: "2026-09-13",
    items: [
      { status: "completed", due_at: null, updated_at: "2026-09-12T10:00:00+09:00" },
      { status: "completed", due_at: null, updated_at: "2026-09-01T10:00:00+09:00" },
      { status: "open", due_at: null, updated_at: "2026-09-13T10:00:00+09:00" },
    ],
    budgetTransactions: [
      { amount: 12000, date: "2026-09-08" },
      { amount: 99999, date: "2026-09-01" },
    ],
    appState: {
      "ai-fitness-workout-completed-days": JSON.stringify({
        "2026-09-08": { workoutStatus: "partial" },
        "2026-09-01": true,
      }),
      "ai-fitness-diet-completed-days": JSON.stringify({
        "2026-09-10": { proteinTotal: 100 },
        "2026-09-11": {},
      }),
    },
    languageState: {
      dailyLearningHistory: JSON.stringify({
        "2026-09-09": { completedIds: ["kana", "kana", "words"], completedCount: 1 },
      }),
    },
    growthSessions: [
      { routine_id: "one", session_date: "2026-09-07", status: "completed", actual_minutes: 10 },
      { routine_id: "one", session_date: "2026-09-13", status: "partial", actual_minutes: "5" },
      { routine_id: "one", session_date: "2026-09-01", status: "completed", actual_minutes: 100 },
    ],
  });

  assert.equal(briefing.startDate, "2026-09-07");
  assert.deepEqual(briefing.cards.map((card) => [card.area, card.value, card.detail]), [
    ["tasks", "1개 완료", "미완료 1개"],
    ["budget", "12,000원 지출", "최근 7일 1건"],
    ["fitness", "1일 실행", "완료·부분 완료 기록 기준"],
    ["diet", "1일 기록", "저장한 식단 날짜 기준"],
    ["language", "1일 학습", "완료 루틴 2개"],
    ["growth", "2일 실행", "기록 15분"],
  ]);
  assert.equal(briefing.recommendation.area, "diet");
});

test("기한이 지난 할 일은 주간 일관성 제안보다 먼저 안내한다", () => {
  const briefing = buildAssistantWeeklyBriefing({
    todayKey: "2026-09-13",
    items: [{ status: "open", due_at: "2026-09-10T23:59:00+09:00", updated_at: "2026-09-10T00:00:00+09:00" }],
    budgetTransactions: [], appState: {}, languageState: {}, growthSessions: [],
  });
  assert.equal(briefing.recommendation.area, "tasks");
  assert.match(briefing.recommendation.title, /1개/);
});

test("조회 실패 영역은 0으로 오해하지 않고 카드와 추천 후보에서 제외한다", () => {
  const briefing = buildAssistantWeeklyBriefing({
    todayKey: "2026-09-13", items: [], budgetTransactions: [], appState: null, languageState: null, growthSessions: [],
    available: { tasks: false, budget: false, fitness: false, diet: false, language: false, growth: false },
  });
  assert.deepEqual(briefing.cards, []);
  assert.equal(briefing.recommendation.area, "calendar");
});
