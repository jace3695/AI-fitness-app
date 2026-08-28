"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/supabase";

type Summary = { limitKrw: number; spentKrw: number; remainingKrw: number; percentage: number };

export default function AiBudgetPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => { void authenticatedFetch("/api/ai/usage").then(async (response) => { if (response.ok) setSummary(await response.json()); }); }, []);
  const percentage = summary?.percentage ?? 0;
  return (
    <section className="rounded-3xl border border-violet-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.14em] text-[#766DB8]">AI COST GUARD</p><h2 className="mt-1 text-lg font-bold">월 AI 비용 보호</h2></div><span className="rounded-full bg-[#EEEDFE] px-3 py-1 text-xs font-bold text-[#5146A6]">월 10,000원</span></div>
      <div className="mt-5 h-3 overflow-hidden rounded-full bg-[#EFEEF7]"><div className={`h-full rounded-full ${percentage >= 80 ? "bg-amber-500" : "bg-[#5A50B8]"}`} style={{ width: `${Math.min(100, percentage)}%` }} /></div>
      <div className="mt-3 flex justify-between text-sm"><span>사용 {Math.ceil(summary?.spentKrw ?? 0).toLocaleString()}원 ({percentage}%)</span><span className="font-semibold">남음 {Math.floor(summary?.remainingKrw ?? 10_000).toLocaleString()}원</span></div>
      <p className="mt-4 text-sm leading-6 text-gray-600">50%·80%·100% 도달 시 알려드리며, 100%에서는 유료 AI만 자동 중지합니다. 기록 조회·직접 입력과 앱 기능은 계속 사용할 수 있습니다.</p>
    </section>
  );
}
