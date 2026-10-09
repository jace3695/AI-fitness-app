/** Live reports are independent of legacy curriculum completion and review keys. */
/** UTF-16 code units, the same unit as String.length and the SQL validation helper. */
export const LIVE_REPORT_MAX_LENGTH = 100_000;
export const LIVE_REPORT_TIMEZONE = 'Asia/Seoul';
export const LIVE_REPORT_FIELDS = [
  { key: 'lessonDate', label: '학습 날짜' },
  { key: 'topic', label: '수업 주제' },
  { key: 'stage', label: '현재 학습 단계' },
  { key: 'kana', label: '오늘 배운 히라가나·가타카나' },
  { key: 'vocabulary', label: '오늘 배운 단어' },
  { key: 'grammar', label: '오늘 배운 문법' },
  { key: 'expressions', label: '오늘 배운 표현' },
  { key: 'listening', label: '듣기 학습 결과' },
  { key: 'speaking', label: '말하기 학습 결과' },
  { key: 'reading', label: '읽기 학습 결과' },
  { key: 'writing', label: '쓰기 학습 결과' },
  { key: 'errors', label: '틀린 부분' },
  { key: 'corrections', label: '교정한 표현과 교정 이유' },
  { key: 'recurringDifficulties', label: '반복적으로 어려워하는 부분' },
  { key: 'confidentContent', label: '충분히 익힌 내용' },
  { key: 'reviewNeeds', label: '복습이 필요한 내용' },
  { key: 'nextLessonRecommendations', label: '다음 수업 권장 내용' },
  { key: 'aiAssessmentNotes', label: 'AI 평가 참고사항' },
  { key: 'previousReviewResults', label: '이전 학습 복습 결과' },
  { key: 'forgettingObservations', label: '학습 중 발견한 망각 항목' },
  { key: 'relearningActivities', label: '재학습 수행 내역' },
  { key: 'reassessments', label: '재평가 결과' },
  { key: 'stateChanges', label: '학습 상태 변경 내역' },
  { key: 'nextReviewRecommendations', label: '다음 복습 권장 시점' },
  { key: 'evidenceAndUncertainty', label: '평가 근거 및 불확실성' },
] as const;

export type LiveFieldKey = typeof LIVE_REPORT_FIELDS[number]['key'];
export type LiveFieldPresence = 'reported' | 'unknown' | 'none' | 'not_learned';
export type LiveFieldValue = { text: string; presence: LiveFieldPresence; sourceBlocks?: string[] };
export type LiveReportDraft = {
  rawText: string;
  reportVersion: 'v1' | 'v1.1' | 'unknown';
  parserVersion: string;
  source: 'chatgpt_live_manual';
  importFormat: 'labelled_text';
  structuredSchemaVersion: 1;
  fields: Record<LiveFieldKey, LiveFieldValue>;
  lessonDate: string | null;
  lessonTimezone: string;
  topic: string;
  stage: string;
  warnings: string[];
  unparsedText: string;
};
export type LiveLessonOperation = 'create' | 'edit' | 'delete' | 'restore';
export type LiveLesson = {
  user_id: string;
  lesson_id: string;
  revision: number;
  operation: LiveLessonOperation;
  report: LiveReportDraft;
  created_at: string;
  request_id: string;
  payload_hash: string;
  previous_revision: number;
  restored_from_revision: number | null;
  duplicate_reason: string | null;
};
export type LiveMutationTarget = { requestId: string; lessonId: string; expectedRevision: number };
export type SaveLiveLessonInput = LiveMutationTarget & { report: LiveReportDraft; allowDuplicate?: boolean; duplicateReason?: string };
export type RestoreLiveLessonInput = LiveMutationTarget & { restoreRevision: number };
export type LiveErrorCode = 'schema_unavailable' | 'unauthenticated' | 'account_changed' | 'conflict' | 'duplicate' | 'validation' | 'verification' | 'storage';
export class LanguageLiveError extends Error {
  readonly code: LiveErrorCode;
  constructor(code: LiveErrorCode, message: string) { super(message); this.name = 'LanguageLiveError'; this.code = code; }
}
