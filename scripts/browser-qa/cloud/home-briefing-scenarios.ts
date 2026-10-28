import { buildDietDailyStatus, buildFitnessDailyStatus, buildLanguageDailyStatus, LANGUAGE_ROUTINES, EMPTY_DIET_DAILY_STATUS, EMPTY_FITNESS_DAILY_STATUS, EMPTY_LANGUAGE_DAILY_STATUS } from '../../../app/data/dailyAppStatus.ts';
import type { AssistantActionItem, AssistantNextActionInput } from '../../../app/data/assistantNextAction.ts';

export const HOME_BRIEFING_SCENARIOS = ['empty', 'loading', 'partial-failure', 'completed', 'due-priority', 'important-priority', 'budget-next'] as const;
export type HomeBriefingScenario = typeof HOME_BRIEFING_SCENARIOS[number];
const todayKey = '2026-09-12';
const task = (title: string, status: AssistantActionItem['status'], priority: number, due_at: string | null): AssistantActionItem => ({
  title, kind: 'task', status, priority, due_at, created_at: '2026-09-01T00:00:00Z',
});

/** Fixed, synthetic already-read status inputs. No real account, storage or provider. */
export function briefingScenario(scenario: HomeBriefingScenario): AssistantNextActionInput {
  const empty: AssistantNextActionInput = { items: [], budget: { remaining: null },
    fitness: { ...EMPTY_FITNESS_DAILY_STATUS }, diet: { ...EMPTY_DIET_DAILY_STATUS }, language: { ...EMPTY_LANGUAGE_DAILY_STATUS },
    growth: { completed: 0, total: 0 }, todayKey, hour: 8 };
  if (scenario === 'empty' || scenario === 'loading') return empty;
  const completed: AssistantNextActionInput = { ...empty, budget: { remaining: 1000 },
    fitness: buildFitnessDailyStatus({ 'ai-fitness-workout-completed-days': { [todayKey]: { workoutStatus: 'completed' } } }, todayKey, new Date('2026-09-12T12:00:00+09:00')),
    diet: buildDietDailyStatus({ 'ai-fitness-diet-completed-days': { [todayKey]: { dietStatus: 'normal' } } }, todayKey),
    language: buildLanguageDailyStatus({ dailyRoutineProgress: { date: todayKey, completedIds: LANGUAGE_ROUTINES.map(item => item.id) } }, todayKey), growth: { completed: 2, total: 2 },
    items: [task('합성 완료 항목', 'completed', 5, '2026-09-10T12:00:00+09:00'), task('합성 취소 항목', 'cancelled', 5, '2026-09-10T12:00:00+09:00')] };
  if (scenario === 'completed') return completed;
  if (scenario === 'partial-failure') return { ...completed,
    items: [task('합성 조회 실패 영역의 이전 할 일', 'open', 5, '2026-09-10T12:00:00+09:00')], budget: { remaining: -999999 },
    available: { tasks: false, budget: false } };
  return { ...completed, budget: { remaining: -2500 }, items: [...completed.items,
    task('합성 중요 할 일', scenario === 'budget-next' ? 'completed' : 'open', 5, null),
    task('합성 오늘 마감', scenario === 'due-priority' ? 'open' : 'completed', 3, '2026-09-12T23:59:00+09:00'),
  ] };
}
