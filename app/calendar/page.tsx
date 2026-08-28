"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AuthGate from "../components/AuthGate";
import AppIdentity from "../components/AppIdentity";
import { supabase } from "../lib/supabase";
import { readRecordStores, type DietDayRecord } from "../data/recordStorage";
import { getWorkoutRecord, isWorkoutPerformed, type WorkoutDayRecord } from "../data/workoutCompletion";

type Task = { id: string; title: string; due_at: string | null; status: string };
type Budget = { id: string; date: string; amount: number | string; category?: string; description?: string; memo?: string };
type DayInfo = { workout?: WorkoutDayRecord; diet?: DietDayRecord; water?: number; note?: string; language?: { count: number; ids: string[] }; tasks?: Task[]; budget?: Budget[] };
const LANGUAGE: Record<string, string> = { kana: "가나", words: "단어", sentences: "문장", grammar: "문법", review: "복습" };

function parse(value: string | null) { try { return value ? JSON.parse(value) as Record<string, unknown> : {}; } catch { return {}; } }

function CalendarCard({ title, href, tone, children }: { title: string; href: string; tone: string; children: React.ReactNode }) {
  return <article className={`rounded-2xl border p-4 ${tone}`}><div className="flex justify-between"><b>{title}</b><Link href={href} className="text-xs font-bold">앱 열기 →</Link></div><div className="mt-2 space-y-1 text-sm text-gray-700">{children}</div></article>;
}

function UnifiedCalendar() {
  const [month, setMonth] = useState(() => { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const [info, setInfo] = useState<Record<string, DayInfo>>({});
  const [selected, setSelected] = useState("");
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;

  useEffect(() => {
    let active = true;
    const load = async () => {
      const next: Record<string, DayInfo> = {};
      const stores = readRecordStores();
      Object.entries(stores.workouts).forEach(([date, value]) => { if (date.startsWith(monthKey) && isWorkoutPerformed(value)) next[date] = { ...next[date], workout: getWorkoutRecord(value), note: stores.notes[date] }; });
      Object.entries(stores.diet).forEach(([date, value]) => { if (date.startsWith(monthKey) && Object.keys(value).length) next[date] = { ...next[date], diet: value, water: stores.water[date] }; });
      Object.entries(parse(localStorage.getItem("dailyLearningHistory"))).forEach(([date, value]) => {
        if (!date.startsWith(monthKey) || !value || typeof value !== "object") return;
        const row = value as Record<string, unknown>;
        const ids = Array.isArray(row.completedIds) ? row.completedIds.filter((id): id is string => typeof id === "string") : [];
        const count = Number(row.completedCount || ids.length);
        if (count) next[date] = { ...next[date], language: { count, ids } };
      });
      if (supabase) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const end = `${monthKey}-${new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()}`;
          const [tasks, budget] = await Promise.all([
            supabase.from("assistant_items").select("id,title,due_at,status").eq("user_id", user.id).gte("due_at", `${monthKey}-01T00:00:00+09:00`).lte("due_at", `${end}T23:59:59+09:00`).neq("status", "cancelled"),
            supabase.from("budget_transactions").select("*").eq("user_id", user.id).gte("date", `${monthKey}-01`).lte("date", end),
          ]);
          (tasks.data as Task[] | null)?.forEach((task) => { const date = task.due_at?.slice(0, 10); if (date) next[date] = { ...next[date], tasks: [...(next[date]?.tasks || []), task] }; });
          (budget.data as Budget[] | null)?.forEach((item) => { next[item.date] = { ...next[item.date], budget: [...(next[item.date]?.budget || []), item] }; });
        }
      }
      if (active) setInfo(next);
    };
    void load();
    return () => { active = false; };
  }, [month, monthKey]);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected("");
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selected]);

  const days = useMemo(() => [...Array(new Date(month.getFullYear(), month.getMonth(), 1).getDay()).fill(null), ...Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }, (_, index) => index + 1)], [month]);
  const row = selected ? info[selected] : undefined;
  const workout = row?.workout ? [row.workout.workoutRoutineName || row.workout.workoutPlanName, ...(row.workout.workoutExerciseNames || []), row.workout.cardioDone ? `${row.workout.cardioType || "유산소"} ${row.workout.cardioMinutes || 0}분` : "", row.workout.workoutMemo || row.note].filter(Boolean) as string[] : [];
  const diet = row?.diet ? [row.diet.dietStatus, row.diet.fastingRecordStatus ? `공복 ${row.diet.fastingRecordStatus}` : "", row.water ? `물 ${row.water.toLocaleString()}mL` : "", row.diet.dietMemo].filter((value): value is string => typeof value === "string" && Boolean(value)) : [];

  return <main className="min-h-dvh bg-[#F6F7FB] pb-28 text-[#242231]"><div className="mx-auto max-w-5xl px-4 py-7 sm:px-6 sm:py-10">
    <AppIdentity kind="calendar" title="통합 달력" subtitle="모든 앱의 날짜별 기록" />
    <section className="mt-4 rounded-3xl bg-white p-4 shadow-sm sm:p-6"><div className="flex items-center justify-between"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-xl bg-gray-100 px-3 py-2 font-bold">←</button><h2 className="text-xl font-bold">{month.getFullYear()}년 {month.getMonth() + 1}월</h2><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-xl bg-gray-100 px-3 py-2 font-bold">→</button></div>
      <div className="mt-5 grid grid-cols-7 text-center text-xs font-bold text-gray-400">{"일월화수목금토".split("").map((day) => <span key={day}>{day}</span>)}</div>
      <div className="mt-2 grid grid-cols-7 gap-1.5">{days.map((day, index) => { if (!day) return <span key={`empty-${index}`} />; const date = `${monthKey}-${String(day).padStart(2, "0")}`; const record = info[date]; return <button key={date} onClick={() => setSelected(date)} aria-label={`${date} 기록 상세 보기`} className={`min-h-20 overflow-hidden rounded-2xl border p-2.5 text-left transition sm:min-h-24 sm:p-3 ${selected === date ? "border-violet-600 bg-violet-50" : "border-gray-100 bg-gray-50 hover:border-violet-200 hover:bg-white"}`}><b className="block leading-none">{day}</b><span className="mt-2 flex flex-wrap gap-1 text-[10px] leading-none">{record?.tasks?.length ? <i className="rounded-full bg-violet-100 px-1.5 py-1 not-italic text-violet-700">할{record.tasks.length}</i> : null}{record?.workout ? <i className="rounded-full bg-blue-100 px-1.5 py-1 not-italic text-blue-700">운</i> : null}{record?.diet ? <i className="rounded-full bg-emerald-100 px-1.5 py-1 not-italic text-emerald-700">식</i> : null}{record?.language ? <i className="rounded-full bg-amber-100 px-1.5 py-1 not-italic text-amber-700">언{record.language.count}</i> : null}{record?.budget?.length ? <i className="rounded-full bg-orange-100 px-1.5 py-1 not-italic text-orange-700">가{record.budget.length}</i> : null}</span></button>; })}</div>
    </section>
    {selected ? <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(""); }}><section role="dialog" aria-modal="true" aria-labelledby="calendar-detail-title" className="max-h-[min(82dvh,760px)] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-7"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-bold text-violet-600">통합 기록</p><h2 id="calendar-detail-title" className="mt-1 text-xl font-bold">{selected} 기록 상세</h2></div><button type="button" onClick={() => setSelected("")} aria-label="기록 상세 닫기" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gray-100 text-xl font-bold text-gray-600 hover:bg-gray-200">×</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2">
      {row?.tasks?.length ? <CalendarCard title="연이 AI 비서" href="/assistant" tone="border-violet-100 bg-violet-50">{row.tasks.map((item) => <p key={item.id}>• {item.title} · {item.status === "completed" ? "완료" : "진행 중"}</p>)}</CalendarCard> : null}
      {row?.workout ? <CalendarCard title="운동" href="/fitness" tone="border-blue-100 bg-blue-50">{(workout.length ? workout : ["운동 완료"]).map((item, index) => <p key={index}>• {item}</p>)}</CalendarCard> : null}
      {row?.diet ? <CalendarCard title="식단" href="/diet" tone="border-emerald-100 bg-emerald-50">{(diet.length ? diet : ["식단 기록 완료"]).map((item, index) => <p key={index}>• {item}</p>)}</CalendarCard> : null}
      {row?.language ? <CalendarCard title="언어 학습" href="/language" tone="border-amber-100 bg-amber-50"><p>{row.language.count}개 과정 완료</p><p>{row.language.ids.map((id) => LANGUAGE[id] || id).join(" · ")}</p></CalendarCard> : null}
      {row?.budget?.length ? <CalendarCard title="가계부" href="/budget" tone="border-blue-100 bg-blue-50">{row.budget.map((item) => <p key={item.id}>• {item.category || item.description || item.memo || "거래"} · {Number(item.amount).toLocaleString()}원</p>)}</CalendarCard> : null}
    </div>{!row ? <p className="mt-5 rounded-2xl bg-gray-50 p-5 text-sm text-gray-500">이 날짜에 저장된 기록이 없습니다.</p> : null}</section></div> : null}
  </div></main>;
}

export default function Page() { return <AuthGate><UnifiedCalendar /></AuthGate>; }
