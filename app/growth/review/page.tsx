"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppIdentity from "../../components/AppIdentity";
import type { GrowthAiReviewRow } from "../../data/growthPlatform";
import { supabase } from "../../lib/supabase";
import { useGrowthData } from "../useGrowthData";

function sourceLabel(source: GrowthAiReviewRow["source"]) {
  if (source === "cloud") return "저비용 AI 분석";
  if (source === "economy") return "AI 절약 분석";
  if (source === "recovered") return "기록 기반 안전 대체";
  return "무료 기록 분석";
}

export default function GrowthReviewPage() {
  const growth = useGrowthData(40);
  const growthUser = growth.user;
  const setGrowthNotice = growth.setNotice;
  const [reviews, setReviews] = useState<GrowthAiReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const latest = reviews[0] ?? null;

  const load = useCallback(async () => {
    if (!supabase || !growthUser) return;
    setLoading(true);
    const result = await supabase.from("growth_ai_reviews").select("*").eq("user_id", growthUser.id).order("created_at", { ascending: false }).limit(8);
    if (result.error) setGrowthNotice("지난 코칭을 불러오지 못했어요.");
    else setReviews((result.data ?? []) as GrowthAiReviewRow[]);
    setLoading(false);
  }, [growthUser, setGrowthNotice]);

  useEffect(() => { void load(); }, [load]);

  const generate = async (force = false) => {
    if (!supabase || generating) return;
    setGenerating(true);
    growth.setNotice("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");
      const response = await fetch("/api/growth/coach", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ force }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "코칭을 만들지 못했습니다.");
      setReviews((current) => [payload.review as GrowthAiReviewRow, ...current.filter((review) => review.id !== payload.review.id)]);
      setSelected([]);
      growth.setNotice(payload.reused ? "오늘 만든 코칭을 다시 보여드려요. 추가 비용은 들지 않았습니다." : "새 주간 코칭을 저장했어요. 아직 어떤 제안도 적용하지 않았습니다.");
    } catch (error) {
      growth.setNotice(error instanceof Error ? error.message : "코칭을 만들지 못했습니다.");
    } finally { setGenerating(false); }
  };

  const saveDecision = async (decision: "applied" | "partial" | "kept") => {
    if (!supabase || !growth.user || !latest || latest.decision) return;
    if (decision !== "kept") {
      const chosen = latest.suggestions.filter((suggestion) => selected.includes(suggestion.id) && suggestion.routineId && suggestion.recommendedMinutes);
      const results = await Promise.all(chosen.map((suggestion) => growth.updateRoutine(suggestion.routineId!, { target_minutes: suggestion.recommendedMinutes! })));
      if (results.some((result) => result.error)) { growth.setNotice("일부 루틴을 바꾸지 못해 결정은 저장하지 않았어요."); return; }
    }
    const now = new Date().toISOString();
    const result = await supabase.from("growth_ai_reviews").update({ decision, decision_selection: decision === "kept" ? [] : selected, decided_at: now }).eq("id", latest.id).eq("user_id", growth.user.id).select("*").single();
    if (result.error) { growth.setNotice("코칭 선택을 저장하지 못했어요."); return; }
    setReviews((current) => current.map((review) => review.id === latest.id ? result.data as GrowthAiReviewRow : review));
    growth.setNotice(decision === "kept" ? "현재 루틴을 그대로 유지하기로 저장했어요." : "선택한 제안만 루틴에 적용했어요.");
  };

  return <main className="min-h-dvh bg-[#F5F4FA] pb-10 text-[#242231]">
    <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="growth" title="주간 성장 코칭" subtitle="기록을 보고 제안만 만드는 연이" /><Link href="/growth" className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">자기계발 홈</Link></div></header>
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-9">
      <section className="rounded-[30px] bg-gradient-to-br from-[#5146A6] to-[#766DCE] p-6 text-white shadow-lg sm:p-8"><p className="text-sm font-bold text-white/70">월 AI 비용 10,000원 이내 보호</p><h1 className="mt-2 text-3xl font-bold">기록이 있으면 더 정확하게,<br />AI가 없어도 안전하게 분석해요.</h1><p className="mt-3 text-sm leading-6 text-white/75">메모와 파일 내용은 AI에 보내지 않습니다. 최근 루틴별 횟수·시간·완료 상태만 집계해 사용합니다.</p><div className="mt-5 flex flex-wrap gap-2"><button disabled={generating || growth.loading} onClick={() => void generate(false)} className="min-h-12 rounded-xl bg-white px-5 text-sm font-bold text-[#5146A6] disabled:opacity-50">{generating ? "코칭 만드는 중…" : latest ? "오늘 코칭 보기" : "주간 코칭 만들기"}</button>{latest && <button disabled={generating} onClick={() => void generate(true)} className="min-h-12 rounded-xl bg-white/10 px-5 text-sm font-bold ring-1 ring-white/30">새로 분석</button>}</div></section>

      {growth.notice && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{growth.notice}</p>}
      {loading ? <p className="py-12 text-center text-sm text-gray-400">지난 코칭을 불러오고 있어요…</p> : latest ? <>
        <section className="mt-5 rounded-[28px] bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold text-violet-600">{latest.period_start} ~ {latest.period_end}</p><h2 className="mt-1 text-2xl font-bold">이번 주 요약</h2></div><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">{sourceLabel(latest.source)}</span></div><p className="mt-5 rounded-2xl bg-[#F7F6FF] p-4 text-sm leading-7 text-gray-700">{latest.summary.overview || "기록을 더 모으면 요약이 나타납니다."}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-emerald-50 p-4"><h3 className="font-bold text-emerald-800">잘 이어간 점</h3><ul className="mt-2 space-y-1 text-sm leading-6 text-emerald-950">{latest.summary.positives?.length ? latest.summary.positives.map((item) => <li key={item}>• {item}</li>) : <li>• 첫 기록부터 차근차근 모아보세요.</li>}</ul></div><div className="rounded-2xl bg-amber-50 p-4"><h3 className="font-bold text-amber-800">주의할 점</h3><ul className="mt-2 space-y-1 text-sm leading-6 text-amber-950">{latest.summary.cautions?.length ? latest.summary.cautions.map((item) => <li key={item}>• {item}</li>) : <li>• 무리하게 시간을 늘리지 않아도 됩니다.</li>}</ul></div></div></section>

        <section className="mt-5 rounded-[28px] bg-white p-5 shadow-sm sm:p-6"><p className="text-xs font-bold text-violet-600">사용자 확인 필수</p><h2 className="mt-1 text-xl font-bold">적용할 제안만 고르세요</h2><p className="mt-2 text-sm text-gray-500">버튼을 누르기 전에는 루틴이 바뀌지 않습니다.</p><div className="mt-4 space-y-3">{latest.suggestions.length ? latest.suggestions.map((suggestion) => { const routine = growth.routines.find((item) => item.id === suggestion.routineId); const checked = selected.includes(suggestion.id); return <label key={suggestion.id} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${checked ? "border-violet-400 bg-violet-50" : "border-gray-100"}`}><input type="checkbox" disabled={Boolean(latest.decision) || !routine || !suggestion.recommendedMinutes} checked={checked} onChange={() => setSelected((current) => checked ? current.filter((id) => id !== suggestion.id) : [...current, suggestion.id])} className="mt-1 h-5 w-5 accent-violet-600" /><span><strong className="block">{suggestion.title}</strong><span className="mt-1 block text-sm leading-6 text-gray-600">{suggestion.reason}</span>{routine && suggestion.recommendedMinutes && <span className="mt-2 block text-xs font-bold text-violet-700">{routine.title}: {routine.target_minutes}분 → {suggestion.recommendedMinutes}분</span>}</span></label>; }) : <p className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">지금 바꿀 제안이 없습니다. 현재 루틴을 유지해도 좋아요.</p>}</div>{latest.decision ? <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">결정 저장됨: {latest.decision === "kept" ? "현재 유지" : "선택 제안 적용"}</p> : <div className="mt-5 grid grid-cols-2 gap-3"><button onClick={() => void saveDecision("kept")} className="min-h-12 rounded-xl bg-gray-100 text-sm font-bold text-gray-700">현재 루틴 유지</button><button disabled={!selected.length} onClick={() => void saveDecision(selected.length === latest.suggestions.length ? "applied" : "partial")} className="min-h-12 rounded-xl bg-violet-600 text-sm font-bold text-white disabled:bg-gray-300">선택한 제안 적용</button></div>}</section>
      </> : <section className="mt-5 rounded-[28px] bg-white p-8 text-center shadow-sm"><p className="text-4xl">🌱</p><h2 className="mt-3 text-xl font-bold">아직 만든 코칭이 없습니다</h2><p className="mt-2 text-sm text-gray-500">위 버튼을 누르면 최근 기록으로 첫 코칭을 만들어요.</p></section>}
    </div>
  </main>;
}
