import type { CourseTrack } from "@/data/curriculum";

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
};

export type LessonAttempt = { score: number; completedAt: string };

export type CurriculumProgress = {
  completedLessonIds: string[];
  quizScores: Record<string, number>;
  lastLessonId?: string;
  selectedTrack: CourseTrack;
  updatedAt?: string;
  lessonAttempts: Record<string, LessonAttempt[]>;
  activityDates: string[];
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

export function loadCurriculumProgress(): CurriculumProgress {
  if (typeof window === "undefined") return DEFAULT_CURRICULUM_PROGRESS;
  try {
    const raw = window.localStorage.getItem(CURRICULUM_PROGRESS_KEY);
    if (!raw) return DEFAULT_CURRICULUM_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<CurriculumProgress>;
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
    };
  } catch {
    return DEFAULT_CURRICULUM_PROGRESS;
  }
}

export function saveCurriculumProgress(progress: CurriculumProgress) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    CURRICULUM_PROGRESS_KEY,
    JSON.stringify({ ...progress, updatedAt: new Date().toISOString() }),
  );
}

