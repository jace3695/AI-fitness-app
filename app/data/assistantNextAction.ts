import type { DietDailyStatus, FitnessDailyStatus, LanguageDailyStatus } from './dailyAppStatus.ts';

export type NextActionArea = 'task' | 'budget' | 'fitness' | 'diet' | 'language' | 'growth' | 'waiting' | 'calendar';

export type AssistantActionItem = {
  title: string;
  kind: 'task' | 'waiting' | 'reminder';
  status: 'open' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';
  priority: number;
  due_at: string | null;
  created_at: string;
};

export type AssistantNextAction = {
  area: NextActionArea;
  eyebrow: string;
  title: string;
  detail: string;
  label: string;
  href: string;
};

export type AssistantNextActionInput = {
  items: AssistantActionItem[];
  budget: { remaining: number | null };
  fitness: FitnessDailyStatus;
  diet: DietDailyStatus;
  language: LanguageDailyStatus;
  growth: { completed: number; total: number };
  todayKey: string;
  hour: number;
  available?: Partial<Record<'tasks' | 'budget' | 'fitness' | 'diet' | 'language' | 'growth', boolean>>;
};

function seoulDateKey(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(parsed);
}

function actionForTask(item: AssistantActionItem, todayKey: string): AssistantNextAction {
  const dueKey = item.due_at ? seoulDateKey(item.due_at) : '';
  const timing = dueKey < todayKey ? '마감이 지난 할 일' : '오늘 마감 할 일';
  return {
    area: 'task', eyebrow: timing, title: item.title,
    detail: `우선순위 ${item.priority >= 5 ? '긴급' : item.priority >= 4 ? '중요' : '보통'} · 완료하면 다음 행동을 다시 골라드려요.`,
    label: '할 일 확인', href: '#assistant-list',
  };
}

export function buildAssistantNextAction(input: AssistantNextActionInput): AssistantNextAction {
  const available = {
    tasks: true, budget: true, fitness: true, diet: true, language: true, growth: true,
    ...input.available,
  };
  const actionable = available.tasks ? input.items
    .filter((item) => item.kind !== 'waiting' && !['completed', 'cancelled'].includes(item.status))
    .sort((left, right) => {
      const leftDue = left.due_at ? seoulDateKey(left.due_at) : '9999-12-31';
      const rightDue = right.due_at ? seoulDateKey(right.due_at) : '9999-12-31';
      return leftDue.localeCompare(rightDue) || right.priority - left.priority || left.created_at.localeCompare(right.created_at);
    }) : [];
  const due = actionable.find((item) => item.due_at && seoulDateKey(item.due_at) <= input.todayKey);
  if (due) return actionForTask(due, input.todayKey);

  const important = actionable.find((item) => item.priority >= 4);
  if (important) return {
    area: 'task', eyebrow: '중요 할 일', title: important.title,
    detail: '우선순위가 높은 미완료 항목입니다. 완료하면 다음 행동을 다시 골라드려요.',
    label: '할 일 확인', href: '#assistant-list',
  };

  if (available.budget && input.budget.remaining !== null && input.budget.remaining < 0) return {
    area: 'budget', eyebrow: '예산 확인 필요', title: `${Math.abs(Math.round(input.budget.remaining)).toLocaleString('ko-KR')}원 초과했어요`,
    detail: '이번 달 지출 내역과 남은 고정비를 먼저 확인해보세요.',
    label: '가계부에서 확인', href: '/budget',
  };

  if (available.fitness && input.fitness.synced && !input.fitness.completed && !input.fitness.isRest) return {
    area: 'fitness', eyebrow: '오늘의 운동', title: input.fitness.title,
    detail: input.fitness.detail,
    label: '운동 시작', href: '/fitness',
  };

  if (actionable[0]) return {
    area: 'task', eyebrow: '다음 할 일', title: actionable[0].title,
    detail: '마감일이 없거나 아직 남아 있는 할 일입니다.',
    label: '할 일 확인', href: '#assistant-list',
  };

  if (available.diet && input.diet.synced && !input.diet.completed && input.hour >= 18) return {
    area: 'diet', eyebrow: '저녁 기록', title: input.diet.title,
    detail: input.diet.detail,
    label: '식단 기록', href: '/diet',
  };

  if (available.language && input.language.synced && input.language.completed < input.language.total) {
    const nextLabel = input.language.nextLabel.replace(/^다음 학습:\s*/, '');
    return {
      area: 'language', eyebrow: '오늘의 언어 학습', title: input.language.nextLabel,
      detail: `${input.language.completed}/${input.language.total} 완료 · 이어서 한 묶음만 진행해보세요.`,
      label: `${nextLabel} 학습 시작`, href: input.language.nextHref,
    };
  }

  if (available.growth && input.growth.total > input.growth.completed) return {
    area: 'growth', eyebrow: '오늘의 자기계발', title: `루틴 ${input.growth.total - input.growth.completed}개 남았어요`,
    detail: `${input.growth.completed}/${input.growth.total} 완료 · 지금 할 수 있는 짧은 루틴부터 골라보세요.`,
    label: '루틴 이어가기', href: '/growth',
  };

  if (available.diet && input.diet.synced && !input.diet.completed) return {
    area: 'diet', eyebrow: '오늘의 식단', title: input.diet.title,
    detail: input.diet.detail,
    label: '식단 기록', href: '/diet',
  };

  const waiting = available.tasks ? input.items.find((item) => item.kind === 'waiting' && !['completed', 'cancelled'].includes(item.status)) : undefined;
  if (waiting) return {
    area: 'waiting', eyebrow: '회신 대기', title: waiting.title,
    detail: '답변이 왔는지 확인하고 상태를 정리해보세요.',
    label: '대기 목록 확인', href: '#assistant-list',
  };

  return {
    area: 'calendar', eyebrow: '오늘 기록 정리 완료', title: '남은 일정만 가볍게 확인해요',
    detail: '현재 연결된 기록에는 바로 처리할 항목이 없습니다.',
    label: '통합 달력 보기', href: '/calendar',
  };
}
