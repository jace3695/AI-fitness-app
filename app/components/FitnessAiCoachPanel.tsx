"use client";

import { useState } from "react";
import { buildFitnessAiSnapshot } from "../data/fitnessAiSnapshot";
import type { RecordStores } from "../data/recordStorage";
import { authenticatedFetch } from "@/lib/supabase";

type AnalysisType = "latest" | "weekly" | "monthly";
type CoachResult = { analysisType: AnalysisType; analysisLabel: string; overview: string; positives: string[]; cautions: string[]; nextSession: string[]; rationale: string; safety: string; confidence: "높음" | "보통" | "낮음" };

const ANALYSIS_OPTIONS: { id: AnalysisType; title: string; description: string; action: string }[] = [
  { id: "latest", title: "운동 직후", description: "최근 1회 세트·통증·피로 분석", action: "직후 피드백" },
  { id: "weekly", title: "주간 리포트", description: "최근 7일 운동량과 회복 흐름", action: "주간 분석" },
  { id: "monthly", title: "월간 리포트", description: "이번 달 변화와 다음 달 제안", action: "월간 분석" },
];

export default function FitnessAiCoachPanel({ stores }: { stores: RecordStores }) {
  const [result, setResult] = useState<CoachResult | null>(null);
  const [analysisType, setAnalysisType] = useState<AnalysisType>("latest");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analyze = async (type: AnalysisType) => {
    setAnalysisType(type);
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await authenticatedFetch("/api/fitness/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisType: type, snapshot: buildFitnessAiSnapshot(stores) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "분석에 실패했습니다.");
      setResult(data as CoachResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "분석에 실패했습니다.");
    } finally { setLoading(false); }
  };

  return (
    <section className="rounded-3xl border border-violet-100 bg-gradient-to-br from-white to-[#F3F1FF] p-4 shadow-sm sm:p-5">
      <div><p className="text-[12px] font-bold text-[#534AB7]">AI 연이 운동 코치</p><h2 className="mt-1 text-[20px] font-extrabold text-gray-900">운동 직후부터 월간 흐름까지 분석해요</h2><p className="mt-1 text-[11px] leading-5 text-gray-500">원하는 범위만 선택해 분석합니다. 버튼을 누를 때만 AI 비용이 발생하며 계획은 자동 변경하지 않습니다.</p></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">{ANALYSIS_OPTIONS.map((option) => <button key={option.id} type="button" disabled={loading} onClick={() => void analyze(option.id)} className={`rounded-2xl border p-3 text-left transition disabled:opacity-50 ${analysisType === option.id ? "border-[#534AB7] bg-[#534AB7] text-white" : "border-violet-100 bg-white text-gray-800"}`}><span className="block text-[13px] font-extrabold">{loading && analysisType === option.id ? "분석 중…" : option.action}</span><span className={`mt-1 block text-[10px] leading-4 ${analysisType === option.id ? "text-white/75" : "text-gray-500"}`}>{option.description}</span></button>)}</div>
      {error ? <p className="mt-4 rounded-2xl bg-red-50 p-3 text-[12px] font-semibold text-red-700">{error}</p> : null}
      {result ? <div className="mt-5 space-y-3" aria-live="polite">
        <div className="rounded-2xl bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="text-[12px] font-bold text-gray-500">{result.analysisLabel}</p><span className="rounded-full bg-[#EEEDFE] px-2.5 py-1 text-[10px] font-bold text-[#534AB7]">확신도 {result.confidence}</span></div><p className="mt-2 text-[13px] leading-6 text-gray-800">{result.overview}</p></div>
        <div className="grid gap-3 md:grid-cols-2"><ResultList title="잘하고 있는 점" items={result.positives} tone="bg-emerald-50 text-emerald-900" /><ResultList title="주의해서 볼 점" items={result.cautions} tone="bg-amber-50 text-amber-950" /></div>
        <ResultList title={result.analysisType === "latest" ? "다음 1회 운동 제안" : result.analysisType === "weekly" ? "다음 7일 제안" : "다음 달 제안"} items={result.nextSession} tone="bg-white text-gray-800" numbered />
        <details className="rounded-2xl bg-white p-4 text-[12px] text-gray-600"><summary className="cursor-pointer font-bold text-gray-800">추천 근거 보기</summary><p className="mt-2 leading-5">{result.rationale}</p></details>
        <p className="rounded-2xl bg-red-50 p-3 text-[11px] leading-5 text-red-700"><b>안전 안내</b> · {result.safety}</p>
        <p className="text-[10px] text-gray-400">AI 제안은 참고용입니다. 적용 여부와 실제 운동량은 Jace님이 최종 결정합니다.</p>
      </div> : null}
    </section>
  );
}

function ResultList({ title, items, tone, numbered = false }: { title: string; items: string[]; tone: string; numbered?: boolean }) {
  return <div className={`rounded-2xl p-4 ${tone}`}><p className="text-[12px] font-bold">{title}</p>{items.length ? <ol className="mt-2 space-y-1.5 text-[12px] leading-5">{items.map((item, index) => <li key={`${title}-${index}`}>{numbered ? `${index + 1}. ` : "• "}{item}</li>)}</ol> : <p className="mt-2 text-[12px] opacity-70">기록이 더 쌓이면 안내할 수 있어요.</p>}</div>;
}
