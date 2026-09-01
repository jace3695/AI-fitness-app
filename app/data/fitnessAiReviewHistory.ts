import { getLocalDateKey } from "./dietPlans.ts";
import { getWorkoutPeriodSummary } from "./recordAnalytics.ts";
import type { WorkoutCompletionStore } from "./workoutCompletion.ts";

export type FitnessAiAnalysisType =
  | "latest"
  | "weekly"
  | "monthly"
  | "longTerm"
  | "plan"
  | "program";
export type FitnessAiReviewSource = "cloud" | "economy" | "local" | "recovered";
export type FitnessAiPlanDecision = "applied" | "partial" | "kept";
export type FitnessAiConfidence = "높음" | "보통" | "낮음";

export interface WorkoutOutcomeMetrics {
  workoutDays: number;
  minutes: number;
  completionRate?: number;
  painDays: number;
  highFatigueDays: number;
  stoppedDays: number;
  completedSets: number;
}

export interface WorkoutOutcomeBaseline {
  oneWeek: WorkoutOutcomeMetrics;
  fourWeeks: WorkoutOutcomeMetrics;
}

export interface FitnessAiReviewSummary {
  overview: string;
  positives: string[];
  cautions: string[];
  nextSession: string[];
  rationale: string;
  safety: string;
  confidence: FitnessAiConfidence;
  plan?: {
    title: string;
    summary: string;
    changes: string[];
    cautions: string[];
  };
  program?: {
    status: string;
    summary: string;
    priorities: string[];
  };
}

export interface FitnessAiReviewRecord {
  id: string;
  analysisType: FitnessAiAnalysisType;
  analysisLabel: string;
  source: FitnessAiReviewSource;
  summary: FitnessAiReviewSummary;
  baseline: WorkoutOutcomeBaseline;
  decision?: FitnessAiPlanDecision;
  decisionSelection: {
    dayIds: string[];
    exerciseNames: string[];
  };
  decidedAt?: string;
  createdAt: string;
}

export type FitnessAiOutcomeStatus =
  | "pending"
  | "insufficient"
  | "improved"
  | "maintained"
  | "caution";

export interface FitnessAiOutcomeAssessment {
  periodDays: 7 | 28;
  label: "1주 효과" | "4주 효과";
  status: FitnessAiOutcomeStatus;
  statusLabel: string;
  detail: string;
  remainingDays: number;
  baseline: WorkoutOutcomeMetrics;
  current?: WorkoutOutcomeMetrics;
}

const ANALYSIS_TYPES: FitnessAiAnalysisType[] = [
  "latest",
  "weekly",
  "monthly",
  "longTerm",
  "plan",
  "program",
];
const SOURCES: FitnessAiReviewSource[] = ["cloud", "economy", "local", "recovered"];
const DECISIONS: FitnessAiPlanDecision[] = ["applied", "partial", "kept"];

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeList(value: unknown, maxItems = 4, maxLength = 240) {
  return Array.isArray(value)
    ? value
        .map((item) => safeText(item, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

function safeNumber(value: unknown, max: number) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(0, Math.round(number))) : 0;
}

export function normalizeWorkoutOutcomeMetrics(value: unknown): WorkoutOutcomeMetrics {
  const record = objectValue(value);
  const completionRate = record.completionRate === null || record.completionRate === undefined
    ? Number.NaN
    : Number(record.completionRate);
  return {
    workoutDays: safeNumber(record.workoutDays, 366),
    minutes: safeNumber(record.minutes, 100_000),
    completionRate: Number.isFinite(completionRate)
      ? Math.min(100, Math.max(0, Math.round(completionRate)))
      : undefined,
    painDays: safeNumber(record.painDays, 366),
    highFatigueDays: safeNumber(record.highFatigueDays, 366),
    stoppedDays: safeNumber(record.stoppedDays, 366),
    completedSets: safeNumber(record.completedSets, 100_000),
  };
}

export function normalizeWorkoutOutcomeBaseline(value: unknown): WorkoutOutcomeBaseline {
  const record = objectValue(value);
  return {
    oneWeek: normalizeWorkoutOutcomeMetrics(record.oneWeek),
    fourWeeks: normalizeWorkoutOutcomeMetrics(record.fourWeeks),
  };
}

export function buildFitnessAiReviewSummary(value: unknown): FitnessAiReviewSummary {
  const record = objectValue(value);
  const planProposal = objectValue(record.planProposal);
  const programReview = objectValue(record.programReview);
  const confidence = safeText(record.confidence, 10);
  return {
    overview: safeText(record.overview, 700),
    positives: safeList(record.positives),
    cautions: safeList(record.cautions),
    nextSession: safeList(record.nextSession, 6),
    rationale: safeText(record.rationale, 500),
    safety: safeText(record.safety, 400),
    confidence: ["높음", "보통", "낮음"].includes(confidence)
      ? (confidence as FitnessAiConfidence)
      : "낮음",
    ...(safeText(planProposal.title, 120)
      ? {
          plan: {
            title: safeText(planProposal.title, 120),
            summary: safeText(planProposal.summary, 500),
            changes: safeList(planProposal.changes, 4),
            cautions: safeList(planProposal.cautions, 4),
          },
        }
      : {}),
    ...(safeText(programReview.status, 40) || safeText(programReview.summary, 500)
      ? {
          program: {
            status: safeText(programReview.status, 40),
            summary: safeText(programReview.summary, 500),
            priorities: safeList(programReview.priorities, 4),
          },
        }
      : {}),
  };
}

export function normalizeFitnessAiReviewRecord(value: unknown): FitnessAiReviewRecord | null {
  const row = objectValue(value);
  const id = safeText(row.id, 80);
  const analysisType = safeText(row.analysis_type ?? row.analysisType, 20);
  const source = safeText(row.source, 20);
  const createdAt = safeText(row.created_at ?? row.createdAt, 80);
  if (
    !id ||
    !ANALYSIS_TYPES.includes(analysisType as FitnessAiAnalysisType) ||
    !SOURCES.includes(source as FitnessAiReviewSource) ||
    !createdAt
  ) {
    return null;
  }
  const decisionValue = safeText(row.decision, 20);
  const selection = objectValue(row.decision_selection ?? row.decisionSelection);
  const decidedAt = safeText(row.decided_at ?? row.decidedAt, 80);
  return {
    id,
    analysisType: analysisType as FitnessAiAnalysisType,
    analysisLabel: safeText(row.analysis_label ?? row.analysisLabel, 100),
    source: source as FitnessAiReviewSource,
    summary: buildFitnessAiReviewSummary(row.result_summary ?? row.summary),
    baseline: normalizeWorkoutOutcomeBaseline({
      oneWeek: row.baseline_7d ?? objectValue(row.baseline).oneWeek,
      fourWeeks: row.baseline_28d ?? objectValue(row.baseline).fourWeeks,
    }),
    ...(DECISIONS.includes(decisionValue as FitnessAiPlanDecision)
      ? { decision: decisionValue as FitnessAiPlanDecision }
      : {}),
    decisionSelection: {
      dayIds: safeList(selection.dayIds, 7, 20),
      exerciseNames: safeList(selection.exerciseNames, 20, 120),
    },
    ...(decidedAt ? { decidedAt } : {}),
    createdAt,
  };
}

function addLocalDays(date: Date, days: number) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

function calendarDayDifference(later: Date, earlier: Date) {
  const laterUtc = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const earlierUtc = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.floor((laterUtc - earlierUtc) / 86_400_000);
}

function outcomeMetricsForRange(
  workouts: WorkoutCompletionStore,
  start: Date,
  end: Date,
) {
  return normalizeWorkoutOutcomeMetrics(
    getWorkoutPeriodSummary(workouts, getLocalDateKey(start), getLocalDateKey(end)),
  );
}

export function buildWorkoutOutcomeBaseline(
  workouts: WorkoutCompletionStore,
  baseDate = new Date(),
): WorkoutOutcomeBaseline {
  const end = addLocalDays(baseDate, -1);
  return {
    oneWeek: outcomeMetricsForRange(workouts, addLocalDays(end, -6), end),
    fourWeeks: outcomeMetricsForRange(workouts, addLocalDays(end, -27), end),
  };
}

function assessCompletedPeriod(
  periodDays: 7 | 28,
  baseline: WorkoutOutcomeMetrics,
  current: WorkoutOutcomeMetrics,
): Omit<FitnessAiOutcomeAssessment, "periodDays" | "label" | "remainingDays" | "baseline" | "current"> {
  if (current.workoutDays === 0 && current.completedSets === 0) {
    return {
      status: "insufficient",
      statusLabel: "기록 부족",
      detail: "비교 기간에 완료한 운동 기록이 없어 효과를 판단하지 않았습니다.",
    };
  }
  if (
    current.painDays > baseline.painDays ||
    current.highFatigueDays > baseline.highFatigueDays ||
    current.stoppedDays > baseline.stoppedDays
  ) {
    return {
      status: "caution",
      statusLabel: "회복 확인",
      detail: "통증·높은 피로·중단 기록이 기준 기간보다 늘었습니다. 강도를 올리지 말고 회복 상태를 먼저 확인하세요.",
    };
  }
  const completionImproved =
    current.completionRate !== undefined &&
    baseline.completionRate !== undefined &&
    current.completionRate >= baseline.completionRate + 5;
  const consistencyImproved =
    current.workoutDays > baseline.workoutDays ||
    current.completedSets > baseline.completedSets;
  if (completionImproved || consistencyImproved) {
    return {
      status: "improved",
      statusLabel: "개선 신호",
      detail: `안전 신호가 늘지 않은 상태에서 ${periodDays === 7 ? "운동 완료나 꾸준함" : "4주 운동 흐름"}이 기준 기간보다 좋아졌습니다.`,
    };
  }
  return {
    status: "maintained",
    statusLabel: "유지 신호",
    detail: "통증·높은 피로·중단 기록이 늘지 않았고 운동 흐름도 비슷하게 유지됐습니다.",
  };
}

export function evaluateFitnessAiReviewOutcomes(
  review: FitnessAiReviewRecord,
  workouts: WorkoutCompletionStore,
  now = new Date(),
): FitnessAiOutcomeAssessment[] {
  if (!review.decision || !review.decidedAt) return [];
  const decidedAt = new Date(review.decidedAt);
  if (Number.isNaN(decidedAt.getTime())) return [];
  const elapsedDays = Math.max(0, calendarDayDifference(now, decidedAt));

  return ([7, 28] as const).map((periodDays) => {
    const label = periodDays === 7 ? "1주 효과" : "4주 효과";
    const baseline = periodDays === 7 ? review.baseline.oneWeek : review.baseline.fourWeeks;
    const remainingDays = Math.max(0, periodDays - elapsedDays);
    if (remainingDays > 0) {
      return {
        periodDays,
        label,
        status: "pending",
        statusLabel: `${remainingDays}일 후 확인`,
        detail: "선택 이후 기록이 충분히 쌓이면 자동으로 비교합니다. 추가 AI 호출은 없습니다.",
        remainingDays,
        baseline,
      };
    }
    const start = addLocalDays(decidedAt, 1);
    const end = addLocalDays(decidedAt, periodDays);
    const current = outcomeMetricsForRange(workouts, start, end);
    return {
      periodDays,
      label,
      ...assessCompletedPeriod(periodDays, baseline, current),
      remainingDays: 0,
      baseline,
      current,
    };
  });
}
