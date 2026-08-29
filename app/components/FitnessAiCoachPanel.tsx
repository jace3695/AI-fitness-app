"use client";

import { useState } from "react";
import { buildFitnessAiSnapshot } from "../data/fitnessAiSnapshot";
import type { RecordStores } from "../data/recordStorage";
import { getWorkoutGroupById } from "../data/workoutGroups";
import { getWorkoutMethodLabel } from "../data/workoutMethods";
import { applyWorkoutPlanProposal, WORKOUT_PLAN_DAY_LABELS } from "../data/workoutPlanProposal";
import type { WorkoutPlanProposal } from "../data/workoutPlanProposal";
import { SELECTED_WEEKLY_WORKOUT_PLAN_KEY } from "../data/workoutPlans";
import { readUserWorkoutSettings, saveUserWorkoutSettings } from "../data/userWorkoutSettings";
import { authenticatedFetch } from "@/lib/supabase";

type AnalysisType = "latest" | "weekly" | "monthly" | "plan";
type CoachResult = { analysisType: AnalysisType; analysisLabel: string; overview: string; positives: string[]; cautions: string[]; nextSession: string[]; rationale: string; safety: string; confidence: "높음" | "보통" | "낮음"; planProposal?: WorkoutPlanProposal };

const ANALYSIS_OPTIONS: { id: AnalysisType; title: string; description: string; action: string }[] = [
  { id: "latest", title: "운동 직후", description: "최근 1회 세트·통증·피로 분석", action: "직후 피드백" },
  { id: "weekly", title: "주간 리포트", description: "최근 7일 운동량과 회복 흐름", action: "주간 분석" },
  { id: "monthly", title: "월간 리포트", description: "이번 달 변화와 다음 달 제안", action: "월간 분석" },
  { id: "plan", title: "다음 주 계획", description: "누적 기록으로 7일 계획안 만들기", action: "계획안 받기" },
];

export default function FitnessAiCoachPanel({ stores }: { stores: RecordStores }) {
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
      } : undefined;
      const response = await authenticatedFetch("/api/fitness/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisType: type, snapshot: buildFitnessAiSnapshot(stores), currentSettings }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "분석에 실패했습니다.");
      setResult(data as CoachResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "분석에 실패했습니다.");
    } finally { setLoading(false); }
  };

  const applyPlan = (proposal: WorkoutPlanProposal) => {
    if (!window.confirm("이 AI 계획을 내 기본 운동 설정에 적용할까요? 현재 요일별 계획과 추천 운동량이 바뀝니다.")) return;
    const next = applyWorkoutPlanProposal(readUserWorkoutSettings(), proposal);
    saveUserWorkoutSettings(next);
    setApplyNotice("AI 계획을 적용했습니다. 운동하기에서 새 계획을 확인할 수 있어요.");
  };

  return (
    <section className="rounded-3xl border border-violet-100 bg-gradient-to-br from-white to-[#F3F1FF] p-4 shadow-sm sm:p-5">
      <div><p className="text-[12px] font-bold text-[#534AB7]">AI 연이 운동 코치</p><h2 className="mt-1 text-[20px] font-extrabold text-gray-900">분석하고 다음 운동계획도 제안해요</h2><p className="mt-1 text-[11px] leading-5 text-gray-500">버튼을 누를 때만 AI 비용이 발생합니다. 계획안은 내용을 확인하고 ‘적용하기’를 눌러야만 바뀝니다.</p></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{ANALYSIS_OPTIONS.map((option) => <button key={option.id} type="button" disabled={loading} onClick={() => void analyze(option.id)} className={`rounded-2xl border p-3 text-left transition disabled:opacity-50 ${analysisType === option.id ? "border-[#534AB7] bg-[#534AB7] text-white" : "border-violet-100 bg-white text-gray-800"}`}><span className="block text-[13px] font-extrabold">{loading && analysisType === option.id ? "분석 중…" : option.action}</span><span className={`mt-1 block text-[10px] leading-4 ${analysisType === option.id ? "text-white/75" : "text-gray-500"}`}>{option.description}</span></button>)}</div>
      {error ? <p className="mt-4 rounded-2xl bg-red-50 p-3 text-[12px] font-semibold text-red-700">{error}</p> : null}
      {result ? <div className="mt-5 space-y-3" aria-live="polite">
        <div className="rounded-2xl bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="text-[12px] font-bold text-gray-500">{result.analysisLabel}</p><span className="rounded-full bg-[#EEEDFE] px-2.5 py-1 text-[10px] font-bold text-[#534AB7]">확신도 {result.confidence}</span></div><p className="mt-2 text-[13px] leading-6 text-gray-800">{result.overview}</p></div>
        {result.planProposal ? <PlanProposalCard proposal={result.planProposal} onApply={() => applyPlan(result.planProposal!)} appliedNotice={applyNotice} /> : null}
        <div className="grid gap-3 md:grid-cols-2"><ResultList title="잘하고 있는 점" items={result.positives} tone="bg-emerald-50 text-emerald-900" /><ResultList title="주의해서 볼 점" items={result.cautions} tone="bg-amber-50 text-amber-950" /></div>
        <ResultList title={result.analysisType === "latest" ? "다음 1회 운동 제안" : result.analysisType === "weekly" ? "다음 7일 제안" : "다음 달 제안"} items={result.nextSession} tone="bg-white text-gray-800" numbered />
        <details className="rounded-2xl bg-white p-4 text-[12px] text-gray-600"><summary className="cursor-pointer font-bold text-gray-800">추천 근거 보기</summary><p className="mt-2 leading-5">{result.rationale}</p></details>
        <p className="rounded-2xl bg-red-50 p-3 text-[11px] leading-5 text-red-700"><b>안전 안내</b> · {result.safety}</p>
        <p className="text-[10px] text-gray-400">AI 제안은 참고용입니다. 적용 여부와 실제 운동량은 Jace님이 최종 결정합니다.</p>
      </div> : null}
    </section>
  );
}

function PlanProposalCard({ proposal, onApply, appliedNotice }: { proposal: WorkoutPlanProposal; onApply: () => void; appliedNotice: string }) {
  return <section className="rounded-2xl border-2 border-[#AFA9EC] bg-white p-4">
    <p className="text-[11px] font-bold text-[#534AB7]">적용 전 미리보기</p>
    <h3 className="mt-1 text-[17px] font-extrabold text-gray-900">{proposal.title}</h3>
    <p className="mt-1 text-[12px] leading-5 text-gray-600">{proposal.summary}</p>
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {proposal.days.map((day) => <div key={day.dayId} className="rounded-xl bg-[#F7F6FF] p-3">
        <div className="flex items-center justify-between gap-2"><p className="text-[12px] font-extrabold text-gray-800">{WORKOUT_PLAN_DAY_LABELS[day.dayId]}</p><span className="text-[10px] font-bold text-[#534AB7]">{getWorkoutMethodLabel(day.method.method)}</span></div>
        <p className="mt-1 text-[11px] font-semibold text-gray-700">{getWorkoutGroupById(day.groupId).name}</p>
        {day.reason ? <p className="mt-1 text-[10px] leading-4 text-gray-500">{day.reason}</p> : null}
      </div>)}
    </div>
    {proposal.exerciseTargets.length ? <details className="mt-3 rounded-xl bg-gray-50 p-3"><summary className="cursor-pointer text-[12px] font-bold text-gray-700">운동별 추천량 {proposal.exerciseTargets.length}개 보기</summary><div className="mt-2 space-y-2">{proposal.exerciseTargets.map((target) => <div key={target.exerciseName} className="rounded-lg bg-white p-2.5 text-[11px] text-gray-600"><b className="text-gray-800">{target.exerciseName}</b><span className="ml-2 text-[#534AB7]">{[target.sets ? `${target.sets}세트` : "", target.reps ? `${target.reps}회` : "", target.durationMinutes ? `${target.durationMinutes}분` : ""].filter(Boolean).join(" · ")}</span>{target.reason ? <p className="mt-1 text-[10px] text-gray-500">{target.reason}</p> : null}</div>)}</div></details> : null}
    {proposal.changes.length ? <div className="mt-3 rounded-xl bg-blue-50 p-3 text-[11px] leading-5 text-blue-900"><b>달라지는 점</b>{proposal.changes.map((item) => <p key={item}>• {item}</p>)}</div> : null}
    {proposal.cautions.length ? <div className="mt-2 rounded-xl bg-amber-50 p-3 text-[11px] leading-5 text-amber-900"><b>적용 전 확인</b>{proposal.cautions.map((item) => <p key={item}>• {item}</p>)}</div> : null}
    <button type="button" onClick={onApply} className="mt-4 w-full rounded-xl bg-[#534AB7] px-4 py-3 text-[14px] font-extrabold text-white">이 계획 적용하기</button>
    <p className="mt-2 text-center text-[10px] text-gray-400">누르기 전에는 현재 운동 설정이 바뀌지 않습니다.</p>
    {appliedNotice ? <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-center text-[11px] font-bold text-emerald-700">{appliedNotice}</p> : null}
  </section>;
}

function ResultList({ title, items, tone, numbered = false }: { title: string; items: string[]; tone: string; numbered?: boolean }) {
  return <div className={`rounded-2xl p-4 ${tone}`}><p className="text-[12px] font-bold">{title}</p>{items.length ? <ol className="mt-2 space-y-1.5 text-[12px] leading-5">{items.map((item, index) => <li key={`${title}-${index}`}>{numbered ? `${index + 1}. ` : "• "}{item}</li>)}</ol> : <p className="mt-2 text-[12px] opacity-70">기록이 더 쌓이면 안내할 수 있어요.</p>}</div>;
}
