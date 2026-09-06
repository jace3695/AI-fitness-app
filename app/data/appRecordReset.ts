/** Explicit record ownership. Settings, auth and other apps are never prefix-deleted. */
export const RECORD_RESET_APPS = ["fitness", "diet", "language", "growth", "assistant", "budget"] as const;
export type RecordResetApp = typeof RECORD_RESET_APPS[number];

export const APP_RECORD_KEYS: Record<RecordResetApp, readonly string[]> = {
  fitness: [
    "ai-fitness-workout-completed-days", "ai-fitness-switchon-set-completions", "ai-fitness-switchon-ab-slide-checks",
    "ai-fitness-pullup-progress", "ai-fitness-weight-records", "ai-fitness-inbody-records", "ai-fitness-daily-notes",
    "ai-fitness-recovery-mode-days", "ai-fitness-daily-condition", "ai-fitness-sleep-status",
    "ai-fitness-alcohol-status", "ai-fitness-workout-condition", "ai-fitness-workout-plan-decision-history",
  ],
  diet: [
    "ai-fitness-diet-completed-days", "ai-fitness-diet-meal-log", "ai-fitness-protein-total",
    "ai-fitness-fasting-start-time", "ai-fitness-fasting-completed", "ai-fitness-water-intake",
    "ai-fitness-dinner-carb-choice", "ai-fitness-lunch-carb-choice", "ai-fitness-lunch-protein-choice",
    "ai-fitness-social-meal-mode", "ai-fitness-diet-symptoms", "ai-fitness-diet-dinner-completed-time",
  ],
  language: [
    "dailyRoutineProgress", "dailyLearningHistory", "japaneseCurriculumProgressV1", "japaneseCurriculumReviewV1",
    "savedWords", "savedSentences", "wrongKana", "wrongKanaChars", "wrongWords", "wrongSentences",
    "grammarProgress", "reviewCompletedItemsByDate",
  ],
  growth: [], assistant: [], budget: [],
};

export const APP_RESET_INFO: Record<RecordResetApp, { label: string; href: string; removes: string; keeps: string }> = {
  fitness: { label: "운동", href: "/fitness/settings", removes: "운동·세트·철봉 진도, 체중·체성분, 컨디션·메모, AI 운동 분석과 선택 이력", keeps: "운동표·운동 설정·체중 목표·알림, 식단 기록" },
  diet: { label: "식단", href: "/diet/settings", removes: "식사·단백질·물·공복 기록, 외식·증상 체크", keeps: "식단 단계·시작일·공복 방식, 운동·체중 기록" },
  language: { label: "일본어", href: "/language/settings", removes: "가나·수업 진도와 점수, 진행 중 수업, 오답·복습·학습 달력, 저장한 단어·문장", keeps: "교재·예문, 학습 시간·음성·캐릭터 설정" },
  growth: { label: "자기계발", href: "/growth/settings", removes: "루틴 실행·타자·손글씨 연습 기록, 주간 코칭 이력", keeps: "만든 루틴·목표, 자료함의 파일과 작품, 운동·일본어 원본 기록" },
  assistant: { label: "AI 연이", href: "/assistant/settings", removes: "대화, 저장한 기억, 할 일·회신 대기·프로젝트와 앱에 등록한 일정", keeps: "Google 캘린더의 원본 일정과 연결, 알림 설정, 다른 앱 기록, AI 사용량·요금 한도" },
  budget: { label: "가계부", href: "/budget", removes: "전체 기간의 지출·수입·저축 내역", keeps: "월별·분류별 예산, 반복지출 설정, 통화·계정·보안 설정" },
};

export function resetMarkerKey(app: RecordResetApp) {
  return app === "language" ? "languageRecordResetV1" : `ai-fitness-record-reset-${app}`;
}

function markerTime(value: unknown) {
  if (typeof value !== "string") return 0;
  const time = Date.parse(value.split("|")[0]);
  return Number.isFinite(time) ? time : 0;
}

/** A reset generation outranks edits from an older device, only for that app. */
export function respectRecordResets(remote: Record<string, unknown>, local: Record<string, unknown>, merged: Record<string, unknown>): Record<string, unknown> {
  const result = { ...merged };
  for (const app of RECORD_RESET_APPS) {
    const key = resetMarkerKey(app);
    if (remote[key] === local[key]) continue;
    const remoteTime = markerTime(remote[key]);
    const localTime = markerTime(local[key]);
    if (!remoteTime && !localTime) continue;
    const source = remoteTime >= localTime ? remote : local;
    for (const ownedKey of [...APP_RECORD_KEYS[app], key]) {
      if (ownedKey in source) result[ownedKey] = source[ownedKey];
      else delete result[ownedKey];
    }
  }
  return result;
}

export const RECORD_RESET_EVENT = "ai-yeoni-record-reset";
export const RECORD_RESET_STORAGE_EVENT = "ai-yeoni-record-reset-event";

export function isRecordResetRunning() {
  return typeof window !== "undefined" && document.documentElement.dataset.recordReset === "running";
}

export function setRecordResetRunning(running: boolean) {
  document.documentElement.dataset.recordReset = running ? "running" : "";
  window.dispatchEvent(new Event(RECORD_RESET_EVENT));
}
