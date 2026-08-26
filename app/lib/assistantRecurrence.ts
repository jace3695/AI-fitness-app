export type RecurrenceRule = "none" | "daily" | "weekly" | "monthly";

export function parseRecurrence(message: string): RecurrenceRule {
  if (/(매일|매s*일|날마다|매일마다)/.test(message)) return "daily";
  if (/(매주|매s*주|주마다)/.test(message)) return "weekly";
  if (/(매월|매달|달마다|매s*월)/.test(message)) return "monthly";
  return "none";
}

export function recurrenceLabel(rule: RecurrenceRule) {
  return rule === "daily" ? "매일" : rule === "weekly" ? "매주" : rule === "monthly" ? "매월" : "반복 없음";
}

export function nextRecurringDueAt(dueAt: string | null, rule: RecurrenceRule, today: string) {
  if (rule === "none") return null;
  const baseDate = (dueAt?.slice(0, 10) || today).split("-").map(Number);
  const date = new Date(Date.UTC(baseDate[0], baseDate[1] - 1, baseDate[2]));
  if (rule === "daily") date.setUTCDate(date.getUTCDate() + 1);
  if (rule === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  if (rule === "monthly") {
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(originalDay, lastDay));
  }
  const next = date.toISOString().slice(0, 10);
  return `${next}T23:59:00+09:00`;
}
