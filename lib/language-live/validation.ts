import { LIVE_REPORT_FIELDS, LIVE_REPORT_MAX_LENGTH, LanguageLiveError, type LiveReportDraft, type LiveMutationTarget } from './types.ts';

export function isUnknownLiveValue(text: string): boolean {
  return /^(?:(?:미확인|확인\s*필요|알\s*수\s*없음|기록\s*없음|미기재|미상|unknown|n\/?a)[.!。]?)?$/i.test(text.trim());
}

/** Only calendar dates are accepted. No Date.parse rollover and no invented today. */
export function parseLiveLessonDate(text: string): string | null {
  const value = text.trim();
  const match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/.exec(value)
    ?? /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(0, 0, 0, 0);
  if (Number(year) < 1 || date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function normalizeLiveReportMetadata(report: LiveReportDraft): LiveReportDraft {
  return { ...report, lessonDate: parseLiveLessonDate(report.fields.lessonDate.text), topic: report.fields.topic.text.trim(), stage: report.fields.stage.text.trim() };
}

export function validateLiveReport(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['학습 보고서 형식을 확인해 주세요.'];
  const report = value as LiveReportDraft;
  if (typeof report.rawText !== 'string' || !report.rawText.trim()) errors.push('보고서 원문을 입력해 주세요.');
  else if (report.rawText.length > LIVE_REPORT_MAX_LENGTH) errors.push(`원문은 ${LIVE_REPORT_MAX_LENGTH.toLocaleString('ko-KR')}자까지 저장할 수 있어요. 원문을 잘라내지 않았어요.`);
  if (!['v1', 'v1.1', 'unknown'].includes(report.reportVersion)) errors.push('보고서 버전을 확인해 주세요.');
  if (report.source !== 'chatgpt_live_manual' || report.importFormat !== 'labelled_text' || report.structuredSchemaVersion !== 1) errors.push('보고서의 출처와 가져오기 형식을 확인해 주세요.');
  if (typeof report.parserVersion !== 'string' || !report.parserVersion || report.parserVersion.length > 50) errors.push('분석기 버전을 확인해 주세요.');
  if (!report.fields || typeof report.fields !== 'object' || Array.isArray(report.fields)) return [...errors, '25개 표준 항목을 확인해 주세요.'];
  if (Object.keys(report.fields).length !== LIVE_REPORT_FIELDS.length) errors.push('25개 표준 항목을 모두 유지해 주세요.');
  for (const { key, label } of LIVE_REPORT_FIELDS) {
    const field = report.fields[key];
    if (!field || typeof field.text !== 'string' || field.text.length > LIVE_REPORT_MAX_LENGTH || !['reported', 'unknown', 'none', 'not_learned'].includes(field.presence)) errors.push(`${label} 항목을 확인해 주세요.`);
    else if (field.sourceBlocks !== undefined && (!Array.isArray(field.sourceBlocks) || field.sourceBlocks.some(block => typeof block !== 'string' || block.length > LIVE_REPORT_MAX_LENGTH))) errors.push(`${label} 원문 분석 결과를 확인해 주세요.`);
  }
  const dateText = report.fields.lessonDate?.text;
  if (typeof dateText === 'string') {
    const parsed = parseLiveLessonDate(dateText);
    if (!parsed && !isUnknownLiveValue(dateText)) errors.push('학습 날짜를 YYYY-MM-DD로 고치거나 미확인으로 남겨 주세요.');
    if (report.lessonDate !== parsed) errors.push('학습 날짜와 분석 항목이 다릅니다. 날짜를 다시 확인해 주세요.');
  }
  if (report.topic !== report.fields.topic?.text?.trim() || report.stage !== report.fields.stage?.text?.trim()) errors.push('주제·단계와 분석 항목이 다릅니다. 내용을 다시 확인해 주세요.');
  if (typeof report.lessonTimezone !== 'string' || report.lessonTimezone.length > 100) errors.push('학습 시간대를 확인해 주세요.');
  else { try { new Intl.DateTimeFormat('en', { timeZone: report.lessonTimezone }); } catch { errors.push('학습 시간대를 확인해 주세요.'); } }
  if (!Array.isArray(report.warnings) || report.warnings.some(warning => typeof warning !== 'string' || warning.length > 1000) || report.warnings.length > 100) errors.push('분석 알림 형식을 확인해 주세요.');
  if (typeof report.unparsedText !== 'string' || report.unparsedText.length > LIVE_REPORT_MAX_LENGTH) errors.push('분류하지 못한 원문을 확인해 주세요.');
  try {
    if (new TextEncoder().encode(JSON.stringify(report)).length > 2_000_000) errors.push('분석 결과는 2MB까지 저장할 수 있어요. 원문은 보존하고 내용을 확인해 주세요.');
  } catch { errors.push('학습 보고서의 저장 형식을 확인해 주세요.'); }
  return errors;
}

export function assertLiveMutationTarget(target: LiveMutationTarget) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(target.lessonId) || !uuid.test(target.requestId) || !Number.isSafeInteger(target.expectedRevision) || target.expectedRevision < 0 || target.expectedRevision > 2_147_483_646) {
    throw new LanguageLiveError('validation', '저장할 수업과 버전을 다시 확인해 주세요.');
  }
}
