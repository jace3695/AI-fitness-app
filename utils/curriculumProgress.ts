import { languageDocument } from "../app/data/languageRecordDocuments.ts";
import type { CourseTrack } from "@/data/curriculum";
import type { LearningSession } from "./learningSession";

export const CURRICULUM_PROGRESS_KEY = "japaneseCurriculumProgressV1";
export const CURRICULUM_REVIEW_KEY = "japaneseCurriculumReviewV1";

export type CurriculumReviewItem = {
  id: string;
  lessonId: string;
  lessonTitle: string;
  prompt: string;
  explanation: string;
  createdAt: string;
  wrongCount?: number;
  lastWrongAt?: string;
  nextReviewAt?: string;
  intervalDays?: number;
  lastSessionId?: string;
  lastSessionResult?: boolean;
  lastResponseMs?: number;
  lastModality?: 'meaning' | 'listening' | 'typing';
  lastNeededHelp?: boolean;
  reviewCount?: number;
  successStreak?: number;
};

export type LessonAttempt = { score: number; completedAt: string; sessionId?: string };

export type CurriculumProgress = {
  completedLessonIds: string[];
  quizScores: Record<string, number>;
  lastLessonId?: string;
  selectedTrack: CourseTrack;
  updatedAt?: string;
  lessonAttempts: Record<string, LessonAttempt[]>;
  activityDates: string[];
  activeSession?: LearningSession;
  lessonDrafts?: Record<string, LearningSession>;
  kanaCompletedGroups?: string[];
};

export const DEFAULT_CURRICULUM_PROGRESS: CurriculumProgress = {
  completedLessonIds: [],
  quizScores: {},
  selectedTrack: "foundation",
  lessonAttempts: {},
  activityDates: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadCurriculumProgress(raw?: string | null): CurriculumProgress {
  try {
    if (!raw) return DEFAULT_CURRICULUM_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<CurriculumProgress>;
    if (!isRecord(parsed)) return DEFAULT_CURRICULUM_PROGRESS;
    return {
      completedLessonIds: Array.isArray(parsed.completedLessonIds)
        ? parsed.completedLessonIds.filter((id): id is string => typeof id === "string")
        : [],
      quizScores:
        parsed.quizScores && typeof parsed.quizScores === "object" ? parsed.quizScores : {},
      lastLessonId: typeof parsed.lastLessonId === "string" ? parsed.lastLessonId : undefined,
      selectedTrack:
        parsed.selectedTrack === "work" || parsed.selectedTrack === "travel"
          ? parsed.selectedTrack
          : "foundation",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
      lessonAttempts: isRecord(parsed.lessonAttempts)
        ? Object.fromEntries(Object.entries(parsed.lessonAttempts).map(([id, attempts]) => [id, Array.isArray(attempts) ? attempts.filter((attempt): attempt is LessonAttempt => isRecord(attempt) && typeof attempt.score === "number" && typeof attempt.completedAt === "string") : []]))
        : {},
      activityDates: Array.isArray(parsed.activityDates)
        ? parsed.activityDates.filter((date): date is string => typeof date === "string")
        : [],
      activeSession: parsed.activeSession && typeof parsed.activeSession === "object" ? parsed.activeSession : undefined,
      lessonDrafts: isRecord(parsed.lessonDrafts) ? parsed.lessonDrafts as Record<string, LearningSession> : {},
      kanaCompletedGroups: Array.isArray(parsed.kanaCompletedGroups) ? parsed.kanaCompletedGroups.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return DEFAULT_CURRICULUM_PROGRESS;
  }
}


/** Read-only warning for a partial display. It never authorizes writing projected defaults. */
export function curriculumProgressReadError(raw?: string | null): string | null {
  if (raw == null) return null;
  try {
    const doc = languageDocument(raw, "object");
    for (const key of ["completedLessonIds", "activityDates", "kanaCompletedGroups"]) if (doc.has([key])) {
      for (let index = 0; index < doc.length([key]); index++) if (typeof doc.get([key, index]) !== "string") throw new Error();
    }
    for (const key of ["quizScores", "lessonAttempts", "lessonDrafts", "activeSession"]) if (doc.has([key])) languageDocument(doc.rawAt([key]), "object");
    const track = doc.get(["selectedTrack"]);
    if (track !== undefined && !["foundation", "work", "travel"].includes(String(track))) throw new Error();
    for (const key of ["lastLessonId", "updatedAt"]) if (doc.has([key]) && typeof doc.get([key]) !== "string") throw new Error();
    const scores = doc.get<Record<string, unknown>>(["quizScores"]);
    for (const key of Object.keys(scores ?? {})) if (typeof doc.get(["quizScores", key]) !== "number") throw new Error();
    return null;
  } catch { return "일부 학습 기록의 형식을 읽지 못해 확인 가능한 내용만 표시합니다. 원본은 보존했어요."; }
}
