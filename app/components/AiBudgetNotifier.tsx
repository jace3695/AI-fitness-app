"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/supabase";

type Summary = { limitKrw: number; spentKrw: number; percentage: number; reachedThreshold: number };

export default function AiBudgetNotifier() {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const response = await authenticatedFetch("/api/ai/usage").catch(() => null);
      if (!active || !response?.ok) return;
      const summary = await response.json() as Summary;
      if (!summary.reachedThreshold) return;
      const month = new Date().toISOString().slice(0, 7);
      const key = `ai-budget-notice-${month}-${summary.reachedThreshold}`;
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "shown");
      setNotice(summary.reachedThreshold >= 95
        ? "이번 달 AI 비용이 95%에 도달해 유료 AI 호출을 멈췄습니다. 기록 조회·직접 입력은 계속 사용할 수 있어요."
        : summary.reachedThreshold >= 85
          ? `이번 달 AI 비용이 85%에 도달해 고성능 AI를 절약 AI로 전환했습니다. (${Math.ceil(summary.spentKrw).toLocaleString()}원)`
          : `이번 달 AI 비용이 70%에 도달했습니다. (${Math.ceil(summary.spentKrw).toLocaleString()}원)`);
    };
    void check();
    const timer = window.setInterval(() => void check(), 5 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (!notice) return null;
  return <div className="fixed inset-x-0 top-20 z-[110] flex justify-center px-4" role="status"><div className="flex w-full max-w-xl items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 shadow-lg"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-bold ring-1 ring-amber-200">확인</button></div></div>;
}
