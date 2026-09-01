"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildFitnessAiSnapshot } from "../data/fitnessAiSnapshot";
import { readRecordStores } from "../data/recordStorage";
import type { RecordStores } from "../data/recordStorage";
import { getWorkoutGroupById } from "../data/workoutGroups";
import { getWorkoutMethodLabel } from "../data/workoutMethods";
import { applyWorkoutPlanProposal, WORKOUT_PLAN_DAY_LABELS } from "../data/workoutPlanProposal";
import type { WorkoutPlanProposal, WorkoutPlanSelection } from "../data/workoutPlanProposal";
import { readWorkoutPlanDecisionHistory, saveWorkoutPlanDecision } from "../data/workoutPlanDecision";
import type { WorkoutDayId } from "../data/workoutCompletion";
import { SELECTED_WEEKLY_WORKOUT_PLAN_KEY } from "../data/workoutPlans";
import { readUserWorkoutSettings, saveUserWorkoutSettings } from "../data/userWorkoutSettings";
import type { UserWorkoutSettings } from "../data/userWorkoutSettings";
import { buildWorkoutProgramContext } from "../data/workoutProgramReview";
import type { WorkoutProgramAiReview } from "../data/workoutProgramReview";
import {
  buildWorkoutOutcomeBaseline,
  evaluateFitnessAiReviewOutcomes,
  normalizeFitnessAiReviewRecord,
  type FitnessAiAnalysisType,
  type FitnessAiPlanDecision,
  type FitnessAiReviewRecord,
  type FitnessAiReviewSource,
  type WorkoutOutcomeMetrics,
} from "../data/fitnessAiReviewHistory";
import { authenticatedFetch } from "@/lib/supabase";

type AnalysisType = FitnessAiAnalysisType;
type CoachResult = { analysisType: AnalysisType; analysisLabel: string; overview: string; positives: string[]; cautions: string[]; nextSession: string[]; rationale: string; safety: string; confidence: "높음" | "보통" | "낮음"; planProposal?: WorkoutPlanProposal; programReview?: WorkoutProgramAiReview; source?: FitnessAiReviewSource; historyId?: string | null; historySaved?: boolean };

const ANALYSIS_OPTIONS: { id: AnalysisType; title: string; description: string; action: string }[] = [
  { id: "latest", title: "운동 직후", description: "최근 1회 세트·통증·피로 분석", action: "직후 피드백" },
  { id: "weekly", title: "주간 리포트", description: "최근 7일 운동량과 회복 흐름", action: "주간 분석" },
  { id: "monthly", title: "월간 리포트", description: "이번 달 변화와 다음 달 제안", action: "월간 분석" },
  { id: "longTerm", title: "장기 변화", description: "최근 8주 비교와 12주 흐름", action: "장기 분석" },
  { id: "program", title: "내 계획 점검", description: "균형·운동량·허리 안전 먼저 확인", action: "계획 점검" },
  { id: "plan", title: "다음 주 계획", description: "누적 기록으로 7일 계획안 만들기", action: "계획안 받기" },
];

export default function FitnessAiCoachPanel({ stores, mode = "full", onPlanApplied }: { stores?: RecordStores; mode?: "full" | "plan"; onPlanApplied?: (settings: UserWorkoutSettings) => void }) {
  const [result, setResult] = useState<CoachResult | null>(null);
  const [analysisType, setAnalysisType] = useState<AnalysisType>(mode === "plan" ? "program" : "latest");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [applyNotice, setApplyNotice] = useState("");
  const [history, setHistory] = useState<FitnessAiReviewRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyNotice, setHistoryNotice] = useState("");
  const historyRequestId = useRef(0);

  const loadHistory = useCallback(async (showLoader = false) => {
    const requestId = ++historyRequestId.current;
    if (showLoader) setHistoryLoading(true);
    try {
      const response = await authenticatedFetch("/api/fitness/coach/history");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "AI 점검 기록을 불러오지 못했습니다.");
      const reviews = Array.isArray(data.reviews)
        ? data.reviews.flatMap((item: unknown) => {
            const review = normalizeFitnessAiReviewRecord(item);
            return review ? [review] : [];
          })
        : [];
      if (requestId !== historyRequestId.current) return;
      setHistory(reviews);
      setHistoryError("");
    } catch (caught) {
      if (requestId !== historyRequestId.current) return;
      setHistoryError(caught instanceof Error ? caught.message : "AI 점검 기록을 불러오지 못했습니다.");
    } finally {
      if (requestId === historyRequestId.current) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory(true);
    return () => {
      historyRequestId.current += 1;
    };
  }, [loadHistory]);

  const analyze = async (type: AnalysisType) => {
    setAnalysisType(type);
    setLoading(true); setError(""); setApplyNotice(""); setResult(null);
    try {
      const needsCurrentPlan = type === "plan" || type === "program";
      const selectedPlanId = needsCurrentPlan ? window.localStorage.getItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY) : null;
      const userSettings = needsCurrentPlan ? readUserWorkoutSettings() : undefined;
      const currentSettings = needsCurrentPlan ? {
        selectedPlanId,
        userSettings,
        recentPlanDecisions: readWorkoutPlanDecisionHistory().slice(0, 10),
        ...(type === "program" && userSettings ? { currentProgram: buildWorkoutProgramContext({ selectedPlanId, userSettings }) } : {}),
      } : undefined;
      const currentStores = stores ?? readRecordStores();
      const snapshot = {
        ...buildFitnessAiSnapshot(currentStores),
        recentPlanDecisions: readWorkoutPlanDecisionHistory().slice(0, 10),
      };
      const outcomeBaseline = buildWorkoutOutcomeBaseline(currentStores.workouts);
      const response = await authenticatedFetch("/api/fitness/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisType: type, snapshot, currentSettings, outcomeBaseline }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "분석에 실패했습니다.");
      setResult(data as CoachResult);
      if (data.historySaved) {
        setHistoryNotice("");
        void loadHistory();
      } else {
        setHistoryNotice("분석 결과는 표시했지만 클라우드 이력 저장은 완료하지 못했습니다.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "분석에 실패했습니다.");
    } finally { setLoading(false); }
  };

  const saveCloudDecision = async (
    decision: FitnessAiPlanDecision,
    selection?: WorkoutPlanSelection,
  ) => {
    if (!result?.historyId) {
      setHistoryNotice("계획 선택은 적용됐지만 이번 분석의 클라우드 이력은 저장되지 않았습니다.");
      return;
    }
    try {
      const currentStores = stores ?? readRecordStores();
      const response = await authenticatedFetch("/api/fitness/coach/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: result.historyId,
          decision,
          selection: {
            dayIds: selection?.dayIds ?? [],
            exerciseNames: selection?.exerciseNames ?? [],
          },
          outcomeBaseline: buildWorkoutOutcomeBaseline(currentStores.workouts),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "계획 선택을 저장하지 못했습니다.");
      setHistoryNotice("계획 선택과 비교 기준을 클라우드에 저장했습니다.");
      void loadHistory();
    } catch (caught) {
      setHistoryNotice(caught instanceof Error ? caught.message : "계획 선택의 클라우드 저장을 완료하지 못했습니다.");
    }
  };

  const applyPlan = (proposal: WorkoutPlanProposal, selection?: WorkoutPlanSelection) => {
    const partial = Boolean(selection);
    const message = partial
      ? "고른 요일과 운동량만 내 기본 운동 설정에 적용할까요?"
      : "이 AI 계획 전체를 내 기본 운동 설정에 적용할까요? 현재 요일별 계획과 추천 운동량이 바뀝니다.";
    if (!window.confirm(message)) return;
    const next = applyWorkoutPlanProposal(readUserWorkoutSettings(), proposal, selection);
    saveUserWorkoutSettings(next);
    onPlanApplied?.(next);
    saveWorkoutPlanDecision(partial ? "partial" : "applied", proposal, selection);
    void saveCloudDecision(partial ? "partial" : "applied", selection);
    setApplyNotice(partial ? "고른 항목만 적용했습니다. 나머지 설정은 그대로예요." : "AI 계획 전체를 적용했습니다. 운동하기에서 새 계획을 확인할 수 있어요.");
  };

  const keepPlan = (proposal: WorkoutPlanProposal) => {
    saveWorkoutPlanDecision("kept", proposal);
    void saveCloudDecision("kept");
    setApplyNotice("기존 계획을 유지했습니다. 운동 설정은 바뀌지 않았어요.");
  };

  return (
    <section className="rounded-3xl border border-violet-100 bg-gradient-to-br from-white to-[#F3F1FF] p-4 shadow-sm sm:p-5">
      <div><p className="text-[12px] font-bold text-[#534AB7]">AI 연이 운동 코치</p><h2 className="mt-1 text-[20px] font-extrabold text-gray-900">{mode === "plan" ? "내 운동계획을 먼저 점검해요" : "분석하고 다음 운동계획도 제안해요"}</h2><p className="mt-1 text-[11px] leading-5 text-gray-500">버튼을 누를 때만 AI 비용이 발생합니다. 점검과 계획은 미리보기만 보여주며 Jace님이 선택하기 전에는 절대 바뀌지 않습니다.</p></div>
      <div className={`mt-4 grid gap-2 ${mode === "full" ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"}`}>{ANALYSIS_OPTIONS.filter((option) => mode === "full" || option.id === "program" || option.id === "plan").map((option) => <button key={option.id} type="button" disabled={loading} onClick={() => void analyze(option.id)} className={`min-h-20 rounded-2xl border p-3 text-left transition disabled:opacity-50 ${analysisType === option.id ? "border-[#534AB7] bg-[#534AB7] text-white" : "border-violet-100 bg-white text-gray-800"}`}><span className="block text-[13px] font-extrabold">{loading && analysisType === option.id ? "기록을 분석하는 중…" : option.action}</span><span className={`mt-1 block text-[10px] leading-4 ${analysisType === option.id ? "text-white/75" : "text-gray-500"}`}>{option.description}</span></button>)}</div>
      {error ? <p className="mt-4 rounded-2xl bg-red-50 p-3 text-[12px] font-semibold text-red-700">{error}</p> : null}
      {historyNotice ? <p role="status" className="mt-3 rounded-2xl bg-blue-50 p-3 text-[11px] font-semibold text-blue-800">{historyNotice}</p> : null}
      {result ? <div className="mt-5 space-y-3" aria-live="polite">
        <div className="rounded-2xl bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="text-[12px] font-bold text-gray-500">{result.analysisLabel}</p><div className="flex items-center gap-2">{result.source === "local" ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">비용 0원 · 로컬</span> : null}{result.source === "recovered" ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">응답 보정 · 추가 호출 없음</span> : null}{result.source === "economy" ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">85% · 절약 AI</span> : null}<span className="rounded-full bg-[#EEEDFE] px-2.5 py-1 text-[10px] font-bold text-[#534AB7]">확신도 {result.confidence}</span></div></div><p className="mt-2 text-[13px] leading-6 text-gray-800">{result.overview}</p></div>
        {result.programReview ? <ProgramReviewCard review={result.programReview} /> : null}
        {result.planProposal ? <PlanProposalCard key={`${result.planProposal.title}-${result.planProposal.summary}`} proposal={result.planProposal} onApply={(selection) => applyPlan(result.planProposal!, selection)} onKeep={() => keepPlan(result.planProposal!)} appliedNotice={applyNotice} /> : null}
        <div className="grid gap-3 md:grid-cols-2"><ResultList title="잘하고 있는 점" items={result.positives} tone="bg-emerald-50 text-emerald-900" /><ResultList title="주의해서 볼 점" items={result.cautions} tone="bg-amber-50 text-amber-950" /></div>
        <ResultList title={result.analysisType === "latest" ? "다음 1회 운동 제안" : result.analysisType === "weekly" ? "다음 7일 제안" : result.analysisType === "longTerm" ? "다음 4주 제안" : result.analysisType === "program" ? "다음 확인 순서" : result.analysisType === "plan" ? "다음 주 계획 핵심" : "다음 달 제안"} items={result.nextSession} tone="bg-white text-gray-800" numbered />
        <details className="rounded-2xl bg-white p-4 text-[12px] text-gray-600"><summary className="cursor-pointer font-bold text-gray-800">추천 근거 보기</summary><p className="mt-2 leading-5">{result.rationale}</p></details>
        <p className="rounded-2xl bg-red-50 p-3 text-[11px] leading-5 text-red-700"><b>안전 안내</b> · {result.safety}</p>
        <p className="text-[10px] text-gray-400">AI 제안은 참고용입니다. 적용 여부와 실제 운동량은 Jace님이 최종 결정합니다.</p>
      </div> : null}
      <FitnessAiReviewHistoryPanel
        reviews={history}
        loading={historyLoading}
        error={historyError}
        workouts={(stores ?? (typeof window !== "undefined" ? readRecordStores() : undefined))?.workouts ?? {}}
      />
    </section>
  );
}

const DECISION_LABELS: Record<FitnessAiPlanDecision, string> = {
  applied: "추천 적용",
  partial: "일부 수정",
  kept: "기존 계획 유지",
};

const SOURCE_LABELS: Record<FitnessAiReviewSource, string> = {
  cloud: "AI 분석",
  economy: "절약 AI",
  local: "비용 0원 · 로컬",
  recovered: "응답 보정",
};

function formatReviewDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatOutcomeMetrics(metrics: WorkoutOutcomeMetrics) {
  const safetySignals = metrics.painDays + metrics.highFatigueDays + metrics.stoppedDays;
  return `운동 ${metrics.workoutDays}일 · 완료 ${metrics.completedSets}세트 · 회복 신호 ${safetySignals}건`;
}

function FitnessAiReviewHistoryPanel({ reviews, loading, error, workouts }: { reviews: FitnessAiReviewRecord[]; loading: boolean; error: string; workouts: RecordStores["workouts"] }) {
  return <details className="mt-4 rounded-2xl border border-violet-100 bg-white">
    <summary className="cursor-pointer list-none p-4">
      <span className="flex items-center justify-between gap-3">
        <span><span className="block text-[13px] font-extrabold text-gray-900">최근 AI 점검 기록과 효과</span><span className="mt-1 block text-[10px] leading-4 text-gray-500">기기 간 동기화 · 선택 후 1주와 4주를 실제 운동기록으로 비교</span></span>
        <span className="shrink-0 rounded-full bg-[#EEEDFE] px-2.5 py-1 text-[10px] font-bold text-[#534AB7]">추가 AI 비용 없음</span>
      </span>
    </summary>
    <div className="border-t border-violet-100 p-3 sm:p-4">
      {loading ? <p className="rounded-xl bg-gray-50 p-3 text-[11px] text-gray-500">점검 기록을 불러오는 중…</p> : null}
      {!loading && error ? <p className="rounded-xl bg-amber-50 p-3 text-[11px] font-semibold text-amber-800">{error}</p> : null}
      {!loading && !error && reviews.length === 0 ? <p className="rounded-xl bg-gray-50 p-3 text-[11px] leading-5 text-gray-500">새 AI 분석을 실행하면 결과가 여기에 안전한 요약으로 저장됩니다.</p> : null}
      {!loading && !error ? <div className="space-y-3">{reviews.slice(0, 5).map((review) => {
        const outcomes = evaluateFitnessAiReviewOutcomes(review, workouts);
        return <article key={review.id} className="rounded-2xl border border-gray-100 bg-[#FCFCFE] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-[11px] font-extrabold text-gray-800">{review.analysisLabel}</p><p className="mt-0.5 text-[9px] text-gray-400">{formatReviewDate(review.createdAt)} · {SOURCE_LABELS[review.source]}</p></div>
            {review.decision ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{DECISION_LABELS[review.decision]}</span> : review.summary.plan ? <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold text-gray-600">선택 전</span> : null}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-gray-600">{review.summary.overview}</p>
          {outcomes.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{outcomes.map((outcome) => {
            const tone = outcome.status === "caution"
              ? "border-red-100 bg-red-50 text-red-800"
              : outcome.status === "improved"
                ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                : outcome.status === "pending"
                  ? "border-violet-100 bg-[#F7F6FF] text-[#534AB7]"
                  : "border-gray-100 bg-gray-50 text-gray-700";
            return <div key={outcome.periodDays} className={`rounded-xl border p-3 ${tone}`}>
              <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-extrabold">{outcome.label}</p><span className="rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-bold">{outcome.statusLabel}</span></div>
              <p className="mt-1.5 text-[10px] leading-4">{outcome.detail}</p>
              {outcome.current ? <div className="mt-2 space-y-0.5 border-t border-current/10 pt-2 text-[9px] opacity-80"><p>선택 전 · {formatOutcomeMetrics(outcome.baseline)}</p><p>선택 후 · {formatOutcomeMetrics(outcome.current)}</p></div> : null}
            </div>;
          })}</div> : review.summary.plan ? <p className="mt-3 rounded-xl bg-gray-50 p-2.5 text-[10px] leading-4 text-gray-500">추천 적용·일부 수정·기존 계획 유지 중 하나를 선택하면 그 시점부터 효과 비교가 시작됩니다.</p> : null}
          <details className="mt-2 text-[10px] text-gray-500"><summary className="cursor-pointer font-bold text-gray-600">저장된 분석 요약 보기</summary><div className="mt-2 space-y-1 leading-4">{review.summary.positives.map((item, index) => <p key={`positive-${index}-${item}`}>• {item}</p>)}{review.summary.cautions.map((item, index) => <p key={`caution-${index}-${item}`}>• {item}</p>)}</div></details>
        </article>;
      })}</div> : null}
    </div>
  </details>;
}

function ProgramReviewCard({ review }: { review: WorkoutProgramAiReview }) {
  const toneStyles = {
    good: "border-emerald-100 bg-emerald-50 text-emerald-950",
    watch: "border-amber-100 bg-amber-50 text-amber-950",
    adjust: "border-violet-100 bg-[#F7F6FF] text-[#302E63]",
  } as const;
  const statusStyle = review.status === "회복 우선"
    ? "bg-red-50 text-red-700"
    : review.status === "기본 계획 유지"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-[#EEEDFE] text-[#534AB7]";
  return <section className="rounded-2xl border border-violet-100 bg-white p-4">
    <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-bold text-[#534AB7]">현재 프로그램 요약</p><h3 className="mt-1 text-[17px] font-extrabold text-gray-900">계획을 바꾸기 전 먼저 확인했어요</h3></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyle}`}>{review.status}</span></div>
    {review.summary ? <p className="mt-2 text-[12px] leading-5 text-gray-600">{review.summary}</p> : null}
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {review.cards.map((card) => <div key={`${card.label}-${card.value}`} className={`rounded-xl border p-3 ${toneStyles[card.tone]}`}><p className="text-[10px] font-bold opacity-75">{card.label}</p><p className="mt-1 text-[13px] font-extrabold">{card.value}</p><p className="mt-1 text-[10px] leading-4 opacity-80">{card.detail}</p></div>)}
    </div>
    {review.priorities.length ? <div className="mt-3 rounded-xl bg-gray-50 p-3"><p className="text-[11px] font-bold text-gray-800">먼저 확인할 점</p><ul className="mt-1.5 space-y-1 text-[11px] leading-5 text-gray-600">{review.priorities.map((item, index) => <li key={`${item}-${index}`}>• {item}</li>)}</ul></div> : null}
    <p className="mt-3 text-[10px] leading-4 text-gray-400">아래 조정안은 미리보기입니다. 추천 적용 또는 일부 수정을 확인하기 전에는 운동 설정이 바뀌지 않습니다.</p>
  </section>;
}

function PlanProposalCard({ proposal, onApply, onKeep, appliedNotice }: { proposal: WorkoutPlanProposal; onApply: (selection?: WorkoutPlanSelection) => void; onKeep: () => void; appliedNotice: string }) {
  const [partialMode, setPartialMode] = useState(false);
  const [selectedDayIds, setSelectedDayIds] = useState<WorkoutDayId[]>(proposal.days.map((day) => day.dayId));
  const [selectedExerciseNames, setSelectedExerciseNames] = useState<string[]>(proposal.exerciseTargets.map((target) => target.exerciseName));
  const toggleDay = (dayId: WorkoutDayId) => setSelectedDayIds((current) => current.includes(dayId) ? current.filter((item) => item !== dayId) : [...current, dayId]);
  const toggleExercise = (name: string) => setSelectedExerciseNames((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  const hasPartialSelection = selectedDayIds.length > 0 || selectedExerciseNames.length > 0;
  return <section className="rounded-2xl border-2 border-[#AFA9EC] bg-white p-4">
    <p className="text-[11px] font-bold text-[#534AB7]">적용 전 미리보기</p>
    <h3 className="mt-1 text-[17px] font-extrabold text-gray-900">{proposal.title}</h3>
    <p className="mt-1 text-[12px] leading-5 text-gray-600">{proposal.summary}</p>
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {proposal.days.map((day) => <div key={day.dayId} className="rounded-xl bg-[#F7F6FF] p-3">
        <div className="flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-[12px] font-extrabold text-gray-800">{partialMode ? <input type="checkbox" checked={selectedDayIds.includes(day.dayId)} onChange={() => toggleDay(day.dayId)} className="h-4 w-4 accent-[#534AB7]" /> : null}{WORKOUT_PLAN_DAY_LABELS[day.dayId]}</label><span className="text-[10px] font-bold text-[#534AB7]">{getWorkoutMethodLabel(day.method.method)}</span></div>
        <p className="mt-1 text-[11px] font-semibold text-gray-700">{getWorkoutGroupById(day.groupId).name}</p>
        {day.reason ? <p className="mt-1 text-[10px] leading-4 text-gray-500">{day.reason}</p> : null}
      </div>)}
    </div>
    {proposal.exerciseTargets.length ? <details className="mt-3 rounded-xl bg-gray-50 p-3" open={partialMode || undefined}><summary className="cursor-pointer text-[12px] font-bold text-gray-700">운동별 추천량 {proposal.exerciseTargets.length}개 보기</summary><div className="mt-2 space-y-2">{proposal.exerciseTargets.map((target) => <div key={target.exerciseName} className="rounded-lg bg-white p-2.5 text-[11px] text-gray-600"><label className="flex items-center gap-2"><span>{partialMode ? <input type="checkbox" checked={selectedExerciseNames.includes(target.exerciseName)} onChange={() => toggleExercise(target.exerciseName)} className="h-4 w-4 accent-[#534AB7]" /> : null}</span><b className="text-gray-800">{target.exerciseName}</b><span className="text-[#534AB7]">{[target.sets ? `${target.sets}세트` : "", target.reps ? `${target.reps}회` : "", target.durationMinutes ? `${target.durationMinutes}분` : ""].filter(Boolean).join(" · ")}</span></label>{target.reason ? <p className="mt-1 text-[10px] text-gray-500">{target.reason}</p> : null}</div>)}</div></details> : null}
    {proposal.changes.length ? <div className="mt-3 rounded-xl bg-blue-50 p-3 text-[11px] leading-5 text-blue-900"><b>달라지는 점</b>{proposal.changes.map((item) => <p key={item}>• {item}</p>)}</div> : null}
    {proposal.cautions.length ? <div className="mt-2 rounded-xl bg-amber-50 p-3 text-[11px] leading-5 text-amber-900"><b>적용 전 확인</b>{proposal.cautions.map((item) => <p key={item}>• {item}</p>)}</div> : null}
    {partialMode ? <div className="mt-4 rounded-xl border border-violet-100 bg-[#FAF9FF] p-3"><p className="text-[11px] font-bold text-[#534AB7]">바꿀 요일과 운동량만 체크하세요.</p><button type="button" disabled={!hasPartialSelection} onClick={() => onApply({ dayIds: selectedDayIds, exerciseNames: selectedExerciseNames })} className="mt-3 w-full rounded-xl bg-[#534AB7] px-4 py-3 text-[13px] font-extrabold text-white disabled:bg-gray-300">체크한 항목만 적용</button></div> : null}
    <div className="mt-4 grid gap-2 sm:grid-cols-3"><button type="button" onClick={() => onApply()} className="rounded-xl bg-[#534AB7] px-3 py-3 text-[13px] font-extrabold text-white">추천 적용</button><button type="button" onClick={() => setPartialMode((current) => !current)} className="rounded-xl bg-[#EEEDFE] px-3 py-3 text-[13px] font-extrabold text-[#443B97]">{partialMode ? "일부 수정 닫기" : "일부 수정"}</button><button type="button" onClick={onKeep} className="rounded-xl bg-gray-100 px-3 py-3 text-[13px] font-extrabold text-gray-600">기존 계획 유지</button></div>
    <p className="mt-2 text-center text-[10px] text-gray-400">선택하기 전에는 현재 운동 설정이 바뀌지 않습니다.</p>
    {appliedNotice ? <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-center text-[11px] font-bold text-emerald-700">{appliedNotice}</p> : null}
  </section>;
}

function ResultList({ title, items, tone, numbered = false }: { title: string; items: string[]; tone: string; numbered?: boolean }) {
  return <div className={`rounded-2xl p-4 ${tone}`}><p className="text-[12px] font-bold">{title}</p>{items.length ? <ol className="mt-2 space-y-1.5 text-[12px] leading-5">{items.map((item, index) => <li key={`${title}-${index}`}>{numbered ? `${index + 1}. ` : "• "}{item}</li>)}</ol> : <p className="mt-2 text-[12px] opacity-70">기록이 더 쌓이면 안내할 수 있어요.</p>}</div>;
}
