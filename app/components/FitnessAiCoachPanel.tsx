"use client";

import { useState } from "react";
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
import { authenticatedFetch } from "@/lib/supabase";

type AnalysisType = "latest" | "weekly" | "monthly" | "longTerm" | "plan";
type CoachResult = { analysisType: AnalysisType; analysisLabel: string; overview: string; positives: string[]; cautions: string[]; nextSession: string[]; rationale: string; safety: string; confidence: "높음" | "보통" | "낮음"; planProposal?: WorkoutPlanProposal; source?: "cloud" | "local" };

const ANALYSIS_OPTIONS: { id: AnalysisType; title: string; description: string; action: string }[] = [
  { id: "latest", title: "운동 직후", description: "최근 1회 세트·통증·피로 분석", action: "직후 피드백" },
  { id: "weekly", title: "주간 리포트", description: "최근 7일 운동량과 회복 흐름", action: "주간 분석" },
  { id: "monthly", title: "월간 리포트", description: "이번 달 변화와 다음 달 제안", action: "월간 분석" },
  { id: "longTerm", title: "장기 변화", description: "최근 8주 비교와 12주 흐름", action: "장기 분석" },
  { id: "plan", title: "다음 주 계획", description: "누적 기록으로 7일 계획안 만들기", action: "계획안 받기" },
];

export default function FitnessAiCoachPanel({ stores, mode = "full", onPlanApplied }: { stores?: RecordStores; mode?: "full" | "plan"; onPlanApplied?: (settings: UserWorkoutSettings) => void }) {
  const [result, setResult] = useState<CoachResult | null>(null);
  const [analysisType, setAnalysisType] = useState<AnalysisType>("latest");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [applyNotice, setApplyNotice] = useState("");

  const analyze = async (type: AnalysisType) => {
    setAnalysisType(type);
    setLoading(true); setError(""); setApplyNotice(""); setResult(null);
    try {
      const currentSettings = type === "plan" ? {
        selectedPlanId: window.localStorage.getItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY),
        userSettings: readUserWorkoutSettings(),
        recentPlanDecisions: readWorkoutPlanDecisionHistory().slice(0, 10),
      } : undefined;
      const snapshot = {
        ...buildFitnessAiSnapshot(stores ?? readRecordStores()),
        recentPlanDecisions: readWorkoutPlanDecisionHistory().slice(0, 10),
      };
      const response = await authenticatedFetch("/api/fitness/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisType: type, snapshot, currentSettings }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "분석에 실패했습니다.");
      setResult(data as CoachResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "분석에 실패했습니다.");
    } finally { setLoading(false); }
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
    setApplyNotice(partial ? "고른 항목만 적용했습니다. 나머지 설정은 그대로예요." : "AI 계획 전체를 적용했습니다. 운동하기에서 새 계획을 확인할 수 있어요.");
  };

  const keepPlan = (proposal: WorkoutPlanProposal) => {
    saveWorkoutPlanDecision("kept", proposal);
    setApplyNotice("기존 계획을 유지했습니다. 운동 설정은 바뀌지 않았어요.");
  };

  return (
    <section className="rounded-3xl border border-violet-100 bg-gradient-to-br from-white to-[#F3F1FF] p-4 shadow-sm sm:p-5">
      <div><p className="text-[12px] font-bold text-[#534AB7]">AI 연이 운동 코치</p><h2 className="mt-1 text-[20px] font-extrabold text-gray-900">{mode === "plan" ? "내 기록으로 다음 주 계획 만들기" : "분석하고 다음 운동계획도 제안해요"}</h2><p className="mt-1 text-[11px] leading-5 text-gray-500">버튼을 누를 때만 AI 비용이 발생합니다. 계획은 미리보기만 보여주며 Jace님이 선택하기 전에는 절대 바뀌지 않습니다.</p></div>
      <div className={`mt-4 grid gap-2 ${mode === "full" ? "sm:grid-cols-2 lg:grid-cols-5" : ""}`}>{ANALYSIS_OPTIONS.filter((option) => mode === "full" || option.id === "plan").map((option) => <button key={option.id} type="button" disabled={loading} onClick={() => void analyze(option.id)} className={`rounded-2xl border p-3 text-left transition disabled:opacity-50 ${mode === "plan" || analysisType === option.id ? "border-[#534AB7] bg-[#534AB7] text-white" : "border-violet-100 bg-white text-gray-800"}`}><span className="block text-[13px] font-extrabold">{loading && analysisType === option.id ? "기록을 분석하는 중…" : mode === "plan" ? "AI 계획안 만들기" : option.action}</span><span className={`mt-1 block text-[10px] leading-4 ${mode === "plan" || analysisType === option.id ? "text-white/75" : "text-gray-500"}`}>{option.description}</span></button>)}</div>
      {error ? <p className="mt-4 rounded-2xl bg-red-50 p-3 text-[12px] font-semibold text-red-700">{error}</p> : null}
      {result ? <div className="mt-5 space-y-3" aria-live="polite">
        <div className="rounded-2xl bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="text-[12px] font-bold text-gray-500">{result.analysisLabel}</p><div className="flex items-center gap-2">{result.source === "local" ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">비용 0원 · 로컬</span> : null}<span className="rounded-full bg-[#EEEDFE] px-2.5 py-1 text-[10px] font-bold text-[#534AB7]">확신도 {result.confidence}</span></div></div><p className="mt-2 text-[13px] leading-6 text-gray-800">{result.overview}</p></div>
        {result.planProposal ? <PlanProposalCard key={`${result.planProposal.title}-${result.planProposal.summary}`} proposal={result.planProposal} onApply={(selection) => applyPlan(result.planProposal!, selection)} onKeep={() => keepPlan(result.planProposal!)} appliedNotice={applyNotice} /> : null}
        <div className="grid gap-3 md:grid-cols-2"><ResultList title="잘하고 있는 점" items={result.positives} tone="bg-emerald-50 text-emerald-900" /><ResultList title="주의해서 볼 점" items={result.cautions} tone="bg-amber-50 text-amber-950" /></div>
        <ResultList title={result.analysisType === "latest" ? "다음 1회 운동 제안" : result.analysisType === "weekly" ? "다음 7일 제안" : result.analysisType === "longTerm" ? "다음 4주 제안" : "다음 달 제안"} items={result.nextSession} tone="bg-white text-gray-800" numbered />
        <details className="rounded-2xl bg-white p-4 text-[12px] text-gray-600"><summary className="cursor-pointer font-bold text-gray-800">추천 근거 보기</summary><p className="mt-2 leading-5">{result.rationale}</p></details>
        <p className="rounded-2xl bg-red-50 p-3 text-[11px] leading-5 text-red-700"><b>안전 안내</b> · {result.safety}</p>
        <p className="text-[10px] text-gray-400">AI 제안은 참고용입니다. 적용 여부와 실제 운동량은 Jace님이 최종 결정합니다.</p>
      </div> : null}
    </section>
  );
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
