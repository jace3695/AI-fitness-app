export const EDIT_FIELDS = { category: '분류', amount: '금액', date: '날짜', payment: '결제수단', place: '장소', memo: '메모' } as const;
export type EditField = keyof typeof EDIT_FIELDS;
export type ExpenseField = Exclude<EditField, 'category'>;
export const PAYMENT_CHOICES = ['현금', '계좌이체', '체크카드', '휴대폰 소액결제', '충전카드'] as const;

export function parseWholeAmount(input: string): number | null {
  const text = input.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null;
  const value = Number(text.replaceAll(',', ''));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function amountRange(minimum: string, maximum: string) {
  const min = minimum.trim() ? parseWholeAmount(minimum) : null;
  const max = maximum.trim() ? parseWholeAmount(maximum) : null;
  const error = (minimum.trim() && min === null) || (maximum.trim() && max === null)
    ? '금액 조건은 0 이상의 정수로 입력해 주세요.'
    : min !== null && max !== null && min > max ? '최소 금액이 최대 금액보다 큽니다.' : '';
  return { error, matches: (amount: unknown) => !error && (min === null && max === null || Number.isSafeInteger(Number(amount)) && (min === null || Number(amount) >= min) && (max === null || Number(amount) <= max)) };
}

export function parseExpenseField(field: ExpenseField, input: string): { value: string | number; error: string } {
  if (field === 'amount') {
    const amount = parseWholeAmount(input);
    return amount !== null && amount > 0 ? { value: amount, error: '' } : { value: '', error: '각 내역의 새 금액을 0보다 큰 정수로 입력해 주세요.' };
  }
  if (field === 'date') {
    const date = new Date(`${input}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(input) && input >= '0001-01-01' && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === input
      ? { value: input, error: '' } : { value: '', error: '실제로 있는 날짜를 입력해 주세요.' };
  }
  if (field === 'payment') return { value: input, error: PAYMENT_CHOICES.some(choice => choice === input) ? '' : '결제수단을 선택해 주세요.' };
  const value = field === 'place' ? input.trim() : input;
  // Count Unicode code points as PostgreSQL length(text) does.
  const length = [...value].length;
  return { value, error: field === 'place' ? length >= 1 && length <= 200 ? '' : '장소는 1~200자로 입력해 주세요.' : length <= 1000 ? '' : '메모는 1,000자 이내로 입력해 주세요.' };
}

export function displayEditValue(field: EditField, value: unknown, currency: string) {
  if (value === null || value === undefined) return field === 'category' ? '미분류' : '미입력';
  if (field === 'amount') return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: ['KRW', 'USD', 'JPY'].includes(currency) ? currency : 'KRW', maximumFractionDigits: 0 }).format(Number(value));
  return value === '' ? '빈 값' : String(value);
}

export function historyCsv(rows: unknown[][]) {
  const escape = (value: unknown) => {
    const text = String(value ?? '');
    const safe = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
}
