"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/supabase";

type BudgetStatus = "normal" | "notice" | "high_performance_limited" | "paid_ai_paused";
type AppUsage = { id: string; label: string; spentKrw: number; usageCount: number };
type Summary = {
  limitKrw: number;
  spentKrw: number;
  remainingKrw: number;
  percentage: number;
  status: BudgetStatus;
  apps: AppUsage[];
};

const STATUS_COPY: Record<BudgetStatus, { label: string; detail: string; color: string; bar: string }> = {
  normal: { label: "안정", detail: "이번 달 예산 안에서 사용 중이에요.", color: "bg-emerald-50 text-emerald-800", bar: "bg-[#5A50B8]" },
  notice: { label: "70% 안내", detail: "한도에 가까워지고 있어 미리 알려드려요.", color: "bg-amber-50 text-amber-900", bar: "bg-amber-500" },
  high_performance_limited: { label: "85% 절약 모드", detail: "고성능 AI는 절약 AI로 전환됩니다.", color: "bg-orange-50 text-orange-900", bar: "bg-orange-500" },
  paid_ai_paused: { label: "95% 유료 AI 중지", detail: "다음 달까지 유료 AI 호출을 멈췄어요.", color: "bg-red-50 text-red-800", bar: "bg-red-500" },
};

function roundUpKrw(value: number) {
  return Math.ceil(Math.max(0, value));
}

function formatKrw(value: number) {
  return `${roundUpKrw(value).toLocaleString()}원`;
}

export default function AiBudgetPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let active = true;
    void authenticatedFetch("/api/ai/usage")
      .then(async (response) => {
        if (!response.ok) return;
        const nextSummary = await response.json() as Summary;
        if (active) setSummary(nextSummary);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const percentage = summary?.percentage ?? 0;
  const status = summary?.status ?? "normal";
  const copy = STATUS_COPY[status];
  const displayedSpentKrw = roundUpKrw(summary?.spentKrw ?? 0);
  const displayedRemainingKrw = Math.max(0, (summary?.limitKrw ?? 10_000) - displayedSpentKrw);

  return (
    <section className="rounded-3xl border border-violet-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-[#766DB8]">AI COST GUARD</p>
          <h2 className="mt-1 text-lg font-bold">월 AI 비용 보호</h2>
          <p className="mt-1 text-sm leading-5 text-gray-600">이번 달 전체 사용액과 앱별 내역을 확인할 수 있어요.</p>
        </div>
        <span className="shrink-0 rounded-full bg-[#EEEDFE] px-3 py-1 text-xs font-bold text-[#5146A6]">월 10,000원</span>
      </div>

      <div className="mt-5" role="progressbar" aria-label="이번 달 AI 비용 사용률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
        <div className="h-3 overflow-hidden rounded-full bg-[#EFEEF7]"><div className={`h-full rounded-full transition-[width] ${copy.bar}`} style={{ width: `${Math.min(100, percentage)}%` }} /></div>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm"><span>사용 {formatKrw(displayedSpentKrw)} ({percentage}%)</span><span className="font-semibold">남음 {formatKrw(displayedRemainingKrw)}</span></div>
      </div>

      <div className={`mt-4 rounded-2xl px-3.5 py-3 text-sm ${copy.color}`}><b>{copy.label}</b><span className="ml-2">{copy.detail}</span></div>

      <div className="mt-5 rounded-2xl bg-[#FAFAFD] p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-gray-900">앱별 이번 달 사용</h3><span className="text-xs text-gray-500">유료 AI 호출 기준</span></div>
        {summary?.apps?.length ? <ul className="mt-3 space-y-2.5">{summary.apps.map((app) => <li key={app.id} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate font-medium text-gray-800">{app.label} <span className="font-normal text-gray-500">· {app.usageCount}회</span></span><span className="shrink-0 font-semibold text-[#5146A6]">{formatKrw(app.spentKrw)}</span></li>)}</ul> : <p className="mt-3 text-sm leading-5 text-gray-500">아직 이번 달 유료 AI 사용 내역이 없어요.</p>}
      </div>

      <p className="mt-4 text-sm leading-6 text-gray-600">70%에서 안내하고, 85%부터 고성능 AI는 절약 AI로 전환합니다. 95%부터는 유료 AI를 멈추지만 기록 조회·직접 입력·비용 없는 로컬 운동 계획은 계속 사용할 수 있어요.</p>
    </section>
  );
}
