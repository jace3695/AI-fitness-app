import type { EvidenceModality, RecordTimezone, StudyStage, TaskFormat } from './types.ts';

export const STUDY_POLICY = Object.freeze({ version: 'legacy-study-v1' as const, dayMs: 86_400_000,
  almostDays: 3, almostSpanDays: 7, longTermDays: 5, longTermSpanDays: 30, longTermFinalGapDays: 14,
  intervals: [1, 3, 7, 14, 30] as readonly number[],
});
export const STAGE_LABELS: Readonly<Record<StudyStage, string>> = {
  not_started: '시작 전', learning: '학습 중', completed_once: '한 번 완료', needs_review: '복습 필요',
  almost_learned: '거의 익힘', long_term_record: '장기 기억 완료 · 기록 기준',
};
export const MODALITY_LABELS: Readonly<Record<EvidenceModality, string>> = { meaning: '뜻·읽기 선택', listening: '듣기 문제 응답', typing: '직접 입력' };
export const STUDY_DISCLOSURE = '저장된 문제 풀이 기록으로 정한 복습 단계예요. 실제 기억·말하기·필기 능력을 인증하지 않아요. AI Live 진도는 별도로 표시해요.';
export const POLICY_EXPLANATION = 'legacy-study-v1: 한 학습일에 한 번만 단계에 반영해요. 거의 익힘은 서로 다른 3일·실제 7일 간격, 장기 간격 복습 조건 충족은 서로 다른 5일·실제 30일·마지막 14일 간격이 필요해요. 검증된 인지과학 기준이 아닌 초기 기록 정책이에요.';
export const formatModality = (format: TaskFormat): EvidenceModality => format === 'typed_answer' ? 'typing' : format === 'listening_choice' ? 'listening' : 'meaning';

export function isRecordTimezone(value: string): boolean {
  if (/^[+-]\d{2}:\d{2}$/.test(value)) {
    const hours = Number(value.slice(1, 3)), minutes = Number(value.slice(4));
    return hours <= 14 && minutes <= 59 && (hours < 14 || minutes === 0) && value !== '-00:00';
  }
  // Reject runtime-specific abbreviations; UTC and named IANA paths are explicit.
  if (value !== 'UTC' && !value.includes('/')) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return true; } catch { return false; }
}

/** The generation's explicitly captured study-day zone is fixed; device timezone is never read. */
export function studyDay(instant: string, timezone: RecordTimezone): string {
  if (!isRecordTimezone(timezone)) throw new Error('Invalid study-day timezone');
  if (/^[+-]/.test(timezone)) {
    const minutes = (Number(timezone.slice(1, 3)) * 60 + Number(timezone.slice(4))) * (timezone[0] === '-' ? -1 : 1);
    return new Date(Date.parse(instant) + minutes * 60_000).toISOString().slice(0, 10);
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
