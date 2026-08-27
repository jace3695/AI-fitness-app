"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AuthGate from "../components/AuthGate";
import { supabase } from "../lib/supabase";
import { readRecordStores } from "../data/recordStorage";
import { isWorkoutPerformed } from "../data/workoutCompletion";

type Task = { id: string; title: string; due_at: string | null; status: string };
type DayInfo = { workout?: boolean; diet?: boolean; language?: number; tasks?: Task[] };

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}

function UnifiedCalendar() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [info, setInfo] = useState<Record<string, DayInfo>>({});
  const [selected, setSelected] = useState("");
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;

  useEffect(() => {
    let active = true;
    const load = async () => {
      const next: Record<string, DayInfo> = {};
      const stores = readRecordStores();
      Object.entries(stores.workouts).forEach(([date, record]) => { if (date.startsWith(monthKey) && isWorkoutPerformed(record)) next[date] = { ...next[date], workout: true }; });
      Object.entries(stores.diet).forEach(([date, record]) => { if (date.startsWith(monthKey) && record && Object.keys(record).length) next[date] = { ...next[date], diet: true }; });
      const history = parseObject(window.localStorage.getItem("dailyLearningHistory"));
      Object.entries(history).forEach(([date, value]) => {
        if (!date.startsWith(monthKey) || !value || typeof value !== "object") return;
        const row = value as Record<string, unknown>;
        const count = Number(row.completedCount || (Array.isArray(row.completedIds) ? row.completedIds.length : 0));
        if (count) next[date] = { ...next[date], language: count };
      });
      if (supabase) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const start = `${monthKey}-01T00:00:00+09:00`;
          const endDate = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
          const end = `${monthKey}-${endDate}T23:59:59+09:00`;
          const { data } = await supabase.from("assistant_items").select("id,title,due_at,status").eq("user_id", user.id).gte("due_at", start).lte("due_at", end).neq("status", "cancelled");
          (data as Task[] | null)?.forEach((task) => { const date = task.due_at?.slice(0, 10); if (date) next[date] = { ...next[date], tasks: [...(next[date]?.tasks || []), task] }; });
        }
      }
      if (active) setInfo(next);
    };
    void load();
    return () => { active = false; };
  }, [month, monthKey]);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  }, [month]);
  const selectedInfo = selected ? info[selected] : undefined;

  return (
    <main className="min-h-dvh bg-[#F6F7FB] pb-28 text-[#242231]">
      <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6 sm:py-10">
        <p className="text-xs font-bold tracking-[0.14em] text-[#766DB8]">JACE AI CALENDAR</p>
        <h1 className="mt-1 text-3xl font-bold">통합 달력</h1>
        <p className="mt-2 text-sm text-gray-500">할 일·운동·식단·언어 학습을 날짜별로 함께 확인합니다.</p>
        <section className="mt-6 rounded-3xl bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center justify-between">
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-xl bg-gray-100 px-3 py-2 font-bold">←</button>
            <h2 className="text-xl font-bold">{month.getFullYear()}년 {month.getMonth() + 1}월</h2>
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-xl bg-gray-100 px-3 py-2 font-bold">→</button>
          </div>
          <div className="mt-5 grid grid-cols-7 text-center text-xs font-bold text-gray-400">{"일월화수목금토".split("").map((d) => <span key={d}>{d}</span>)}</div>
          <div className="mt-2 grid grid-cols-7 gap-1.5">
            {days.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} />;
              const date = `${monthKey}-${String(day).padStart(2, "0")}`;
              const row = info[date];
              return <button key={date} onClick={() => setSelected(date)} className={`min-h-20 rounded-2xl border p-2 text-left ${selected === date ? "border-[#534AB7] bg-[#F1EFFF]" : "border-gray-100 bg-gray-50"}`}><b>{day}</b><span className="mt-1 flex flex-wrap gap-1 text-[10px]">{row?.tasks?.length ? <i className="rounded bg-violet-100 px-1 not-italic text-violet-700">할 {row.tasks.length}</i> : null}{row?.workout ? <i className="rounded bg-blue-100 px-1 not-italic text-blue-700">운</i> : null}{row?.diet ? <i className="rounded bg-emerald-100 px-1 not-italic text-emerald-700">식</i> : null}{row?.language ? <i className="rounded bg-amber-100 px-1 not-italic text-amber-700">언 {row.language}</i> : null}</span></button>;
            })}
          </div>
        </section>
        {selected && <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm"><h2 className="font-bold">{selected} 기록</h2><div className="mt-3 flex flex-wrap gap-2 text-xs font-bold"><Link href="/assistant" className="rounded-xl bg-violet-50 px-3 py-2 text-violet-700">할 일</Link><Link href="/fitness" className="rounded-xl bg-blue-50 px-3 py-2 text-blue-700">운동</Link><Link href="/diet" className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700">식단</Link><Link href="/language" className="rounded-xl bg-amber-50 px-3 py-2 text-amber-700">언어</Link></div>{selectedInfo?.tasks?.map((task) => <p key={task.id} className="mt-3 text-sm">• {task.title}{task.status === "completed" ? " · 완료" : ""}</p>)}{!selectedInfo && <p className="mt-3 text-sm text-gray-400">저장된 기록이 없습니다.</p>}</section>}
      </div>
    </main>
  );
}

export default function Page() { return <AuthGate><UnifiedCalendar /></AuthGate>; }
