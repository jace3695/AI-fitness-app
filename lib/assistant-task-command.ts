import type { RecurrenceRule } from '../app/lib/assistantRecurrence.ts';

export type TaskCommandValues = {
  title: string;
  due_at: string | null;
  priority: number;
  recurrence_rule: RecurrenceRule;
  project_id: string | null;
};

export type TaskCommandProposal = {
  domain?: 'task';
  requestId: string;
  operation: 'create' | 'update';
  itemId: string | null;
  expected: Record<string, unknown> | null;
  values: TaskCommandValues;
  projectName: string | null;
  resetMarker: string | null;
  expiresAt: string;
};

export type TaskCommandReceipt = {
  id: string;
  operation: 'create' | 'update';
  item_id: string;
  before_record: Record<string, unknown> | null;
  after_record: TaskCommandValues;
  created_at: string;
  undone_at: string | null;
};

export function commandDueDate(message: string, today: string) {
  const explicit = message.match(/(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})일?/);
  const monthDay = message.match(/(\d{1,2})월\s*(\d{1,2})일/);
  let result: string | null = null;
  if (explicit) result = `${explicit[1]}-${explicit[2].padStart(2, '0')}-${explicit[3].padStart(2, '0')}`;
  else if (monthDay) result = `${today.slice(0, 4)}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`;
  else if (/모레|내일|오늘/.test(message)) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + (/모레/.test(message) ? 2 : /내일/.test(message) ? 1 : 0));
    result = date.toISOString().slice(0, 10);
  }
  if (result && (Number.isNaN(Date.parse(`${result}T12:00:00Z`)) || new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result)) {
    throw new Error('존재하는 날짜를 말씀해 주세요. 예: 9월 20일');
  }
  return result;
}

export function taskCommandDateLabel(value: unknown) {
  if (typeof value !== 'string' || !value) return '마감 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '날짜 확인 필요' : new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}
