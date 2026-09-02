"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import AppIdentity from "../components/AppIdentity";
import {
  buildFitnessDailyStatus,
  buildLanguageDailyStatus,
  EMPTY_FITNESS_DAILY_STATUS,
  EMPTY_LANGUAGE_DAILY_STATUS,
  parseStateObject,
} from "../data/dailyAppStatus";
import {
  DEFAULT_GROWTH_ROUTINES,
  GROWTH_CATEGORIES,
  GROWTH_ROUTINES_STORAGE_KEY,
  growthCategoryLabel,
  parseGrowthRoutines,
  toggleGrowthRoutineDate,
  type GrowthCategoryId,
  type GrowthRoutine,
} from "../data/growthRoutines";
import { supabase } from "../lib/supabase";
import { getLocalDateKey } from "@/utils/dateKey";

function cloneDefaultRoutines() {
  return DEFAULT_GROWTH_ROUTINES.map((routine) => ({ ...routine, completedDates: [] }));
}

export default function GrowthPage() {
  const [routines, setRoutines] = useState<GrowthRoutine[]>(cloneDefaultRoutines);
  const [localReady, setLocalReady] = useState(false);
  const [linkedLoading, setLinkedLoading] = useState(true);
  const [linkedNotice, setLinkedNotice] = useState("");
  const [fitness, setFitness] = useState(EMPTY_FITNESS_DAILY_STATUS);
  const [language, setLanguage] = useState(EMPTY_LANGUAGE_DAILY_STATUS);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<GrowthCategoryId>("custom");
  const [targetMinutes, setTargetMinutes] = useState(15);
  const [saveNotice, setSaveNotice] = useState("");
  const todayKey = useMemo(() => getLocalDateKey(), []);
  const todayLabel = useMemo(
    () => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date()),
    [],
  );

  useEffect(() => {
    try {
      setRoutines(parseGrowthRoutines(window.localStorage.getItem(GROWTH_ROUTINES_STORAGE_KEY)));
    } catch {
      setSaveNotice("개인 루틴 저장값을 읽지 못해 기본 루틴을 보여드려요.");
    }
    setLocalReady(true);
  }, []);

  useEffect(() => {
    if (!localReady) return;
    try {
      window.localStorage.setItem(GROWTH_ROUTINES_STORAGE_KEY, JSON.stringify(routines));
    } catch {
      setSaveNotice("이번 화면에는 반영했지만 이 기기에 저장하지 못했어요.");
    }
  }, [localReady, routines]);

  useEffect(() => {
    let active = true;
    const loadLinkedApps = async () => {
      if (!supabase) {
        if (active) {
          setLinkedNotice("앱 연결 설정을 확인해 주세요.");
          setLinkedLoading(false);
        }
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      if (!active) return;
      if (!auth.user) {
        setLinkedLoading(false);
        return;
      }

      const [fitnessResult, languageResult] = await Promise.all([
        supabase.from("user_app_state").select("state").eq("user_id", auth.user.id).maybeSingle(),
        supabase.from("language_user_state").select("state").eq("user_id", auth.user.id).maybeSingle(),
      ]);
      if (!active) return;
      if (fitnessResult.error || languageResult.error) {
        setLinkedNotice("운동 또는 일본어 기록을 모두 불러오지 못했어요. 각 앱은 계속 사용할 수 있습니다.");
      }
      setFitness(fitnessResult.data?.state
        ? buildFitnessDailyStatus(parseStateObject(fitnessResult.data.state), todayKey)
        : EMPTY_FITNESS_DAILY_STATUS);
      setLanguage(languageResult.data?.state
        ? buildLanguageDailyStatus(parseStateObject(languageResult.data.state), todayKey)
        : EMPTY_LANGUAGE_DAILY_STATUS);
      setLinkedLoading(false);
    };
    void loadLinkedApps();
    return () => { active = false; };
  }, [todayKey]);

  const enabledRoutines = routines.filter((routine) => routine.enabled);
  const completedPersonalCount = enabledRoutines.filter((routine) => routine.completedDates.includes(todayKey)).length;
  const fitnessDone = fitness.synced && (fitness.completed || fitness.isRest);
  const languageDone = language.synced && language.completed >= language.total;
  const totalCount = enabledRoutines.length + 2;
  const completedCount = completedPersonalCount + Number(fitnessDone) + Number(languageDone);
  const progress = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;
  const nextPersonal = enabledRoutines.find((routine) => !routine.completedDates.includes(todayKey));
  const nextAction = !languageDone
    ? { title: language.nextLabel, detail: `일본어 ${language.completed}/${language.total} 완료`, href: language.nextHref, button: "일본어 시작" }
    : !fitnessDone
      ? { title: fitness.title, detail: fitness.detail, href: "/fitness", button: "운동 시작" }
      : nextPersonal
        ? { title: nextPersonal.title, detail: `${nextPersonal.targetMinutes}분만 집중해 보세요.`, href: `#routine-${nextPersonal.id}`, button: "루틴 보기" }
        : { title: "오늘 루틴을 모두 마쳤어요", detail: "충분히 잘했습니다. 편안하게 쉬어도 좋아요.", href: "#today-routines", button: "완료 확인" };

  const toggleRoutine = (routineId: string) => {
    setRoutines((current) => current.map((routine) =>
      routine.id === routineId ? toggleGrowthRoutineDate(routine, todayKey) : routine));
    setSaveNotice("");
  };

  const addRoutine = (event: FormEvent) => {
    event.preventDefault();
    const safeTitle = title.trim();
    if (!safeTitle || routines.length >= 12) return;
    setRoutines((current) => [...current, {
      id: crypto.randomUUID(),
      category,
      title: safeTitle.slice(0, 60),
      targetMinutes: Math.min(240, Math.max(5, Math.round(targetMinutes))),
      enabled: true,
      completedDates: [],
    }]);
    setTitle("");
    setCategory("custom");
    setTargetMinutes(15);
    setSaveNotice("새 루틴을 추가했어요.");
  };

  const removeRoutine = (routineId: string) => {
    setRoutines((current) => current.filter((routine) => routine.id !== routineId));
    setSaveNotice("루틴을 삭제했어요.");
  };

  const restoreDefaults = () => {
    setRoutines(cloneDefaultRoutines());
    setSaveNotice("간단한 기본 루틴으로 복원했어요.");
  };

  return (
    <main className="min-h-dvh bg-[#F5F4FA] pb-8 text-[#242231]">
      <header className="app-module-header">
        <div className="app-module-header-inner">
          <AppIdentity kind="growth" title="자기계발" subtitle="오늘 할 일만 쉽고 간단하게" />
          <span className="text-xs font-semibold text-gray-500 sm:text-sm">{todayLabel}</span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-9">
        <section className="rounded-[30px] bg-gradient-to-br from-violet-600 to-indigo-500 p-6 text-white shadow-[0_22px_55px_rgba(91,75,180,0.22)] sm:p-8">
          <p className="text-sm font-bold text-white/75">오늘의 자기계발</p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div><strong className="text-4xl">{completedCount}/{totalCount}</strong><p className="mt-2 text-sm text-white/80">오늘 루틴 완료</p></div>
            <strong className="text-2xl">{progress}%</strong>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/20" aria-label={`오늘 자기계발 ${progress}% 완료`}>
            <div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </section>

        <section className="mt-5 rounded-[28px] bg-white p-5 shadow-sm sm:p-6">
          <p className="text-xs font-bold text-violet-600">지금 할 일</p>
          <h2 className="mt-2 text-2xl font-bold">{linkedLoading ? "오늘 기록을 연결하고 있어요" : nextAction.title}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-500">{linkedLoading ? "잠시만 기다려 주세요." : nextAction.detail}</p>
          {!linkedLoading && <Link href={nextAction.href} className="mt-4 inline-flex min-h-12 items-center rounded-2xl bg-violet-600 px-5 py-3 text-sm font-bold text-white">{nextAction.button} →</Link>}
        </section>

        <section id="today-routines" className="mt-5 scroll-mt-5 rounded-[28px] bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-bold text-violet-600">연결된 앱</p><h2 className="mt-1 text-xl font-bold">오늘 루틴</h2></div>
            <button type="button" onClick={() => setEditing((value) => !value)} className="min-h-11 rounded-full bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700" aria-expanded={editing}>{editing ? "편집 닫기" : "루틴 편집"}</button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <article className="rounded-3xl bg-blue-50 p-5 ring-1 ring-blue-100">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-blue-700">일본어</p><h3 className="mt-2 text-lg font-bold text-blue-950">{language.completed}/{language.total} 완료</h3></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${languageDone ? "bg-emerald-100 text-emerald-700" : "bg-white text-blue-700"}`}>{languageDone ? "완료" : "진행 중"}</span></div>
              <p className="mt-2 text-sm text-gray-600">{language.nextLabel}</p>
              <Link href={language.nextHref} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">{languageDone ? "일본어 앱 보기" : "이어하기"} →</Link>
            </article>
            <article className="rounded-3xl bg-orange-50 p-5 ring-1 ring-orange-100">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-orange-700">운동</p><h3 className="mt-2 text-lg font-bold text-orange-950">{fitness.title}</h3></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${fitnessDone ? "bg-emerald-100 text-emerald-700" : "bg-white text-orange-700"}`}>{fitnessDone ? fitness.isRest ? "회복일" : "완료" : "예정"}</span></div>
              <p className="mt-2 text-sm text-gray-600">{fitness.detail}</p>
              <Link href="/fitness" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-white">운동 앱 열기 →</Link>
            </article>
          </div>

          <div className="mt-5 space-y-3">
            {enabledRoutines.map((routine) => {
              const completed = routine.completedDates.includes(todayKey);
              return (
                <article id={`routine-${routine.id}`} key={routine.id} className={`flex scroll-mt-5 items-center gap-3 rounded-2xl border p-4 ${completed ? "border-emerald-100 bg-emerald-50" : "border-gray-100 bg-white"}`}>
                  <button type="button" onClick={() => toggleRoutine(routine.id)} aria-label={`${routine.title} ${completed ? "완료 취소" : "완료"}`} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 text-lg font-bold ${completed ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 text-transparent"}`}>✓</button>
                  <div className="min-w-0 flex-1"><p className="text-xs font-bold text-violet-600">{growthCategoryLabel(routine.category)}</p><h3 className={`mt-1 font-bold ${completed ? "text-gray-500 line-through" : "text-gray-900"}`}>{routine.title}</h3><p className="mt-1 text-xs text-gray-500">목표 {routine.targetMinutes}분</p></div>
                  <span className="text-xs font-bold text-gray-400">{completed ? "완료" : "할 일"}</span>
                </article>
              );
            })}
            {!localReady && <p className="py-5 text-center text-sm text-gray-400">개인 루틴을 불러오고 있어요…</p>}
            {localReady && enabledRoutines.length === 0 && <p className="py-5 text-center text-sm leading-6 text-gray-400">표시할 개인 루틴이 없습니다.<br />루틴 편집에서 쉽게 추가할 수 있어요.</p>}
          </div>

          {(linkedNotice || saveNotice) && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{linkedNotice || saveNotice}</p>}

          {editing && (
            <div className="mt-5 rounded-3xl bg-[#F7F6FF] p-4 sm:p-5">
              <h3 className="font-bold">개인 루틴 편집</h3>
              <p className="mt-1 text-xs leading-5 text-gray-500">이 단계에서는 이 기기에만 저장됩니다. 그림 연습은 보류 상태라 넣지 않았어요.</p>
              <form onSubmit={addRoutine} className="mt-4 grid gap-2 sm:grid-cols-[auto_1fr_auto_auto]">
                <select aria-label="분야" value={category} onChange={(event) => setCategory(event.target.value as GrowthCategoryId)} className="min-h-12 rounded-xl border-0 bg-white px-3 text-sm ring-1 ring-gray-200">{GROWTH_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                <input aria-label="루틴 이름" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} placeholder="예: 타자 정확도 연습" className="min-h-12 min-w-0 rounded-xl border-0 bg-white px-4 text-sm ring-1 ring-gray-200" />
                <label className="flex min-h-12 items-center gap-2 rounded-xl bg-white px-3 text-sm ring-1 ring-gray-200"><span className="whitespace-nowrap text-gray-500">목표</span><input aria-label="목표 시간(분)" type="number" min={5} max={240} step={5} value={targetMinutes} onChange={(event) => setTargetMinutes(Number(event.target.value))} className="w-14 border-0 bg-transparent font-bold outline-none" /><span>분</span></label>
                <button disabled={!title.trim() || routines.length >= 12} className="min-h-12 rounded-xl bg-violet-600 px-5 text-sm font-bold text-white disabled:bg-gray-300">추가</button>
              </form>
              <div className="mt-4 space-y-2">{routines.map((routine) => <div key={routine.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-3"><span className="min-w-0 truncate text-sm font-semibold">{routine.title} · {routine.targetMinutes}분</span><button type="button" onClick={() => removeRoutine(routine.id)} className="min-h-10 shrink-0 rounded-lg bg-red-50 px-3 text-xs font-bold text-red-600">삭제</button></div>)}</div>
              <button type="button" onClick={restoreDefaults} className="mt-4 min-h-11 rounded-xl bg-white px-4 text-xs font-bold text-gray-600 ring-1 ring-gray-200">기본 루틴으로 복원</button>
            </div>
          )}
        </section>

        <p className="mt-5 text-center text-xs leading-5 text-gray-500">추천은 저장된 오늘 기록만 보고 정하며 AI 비용은 들지 않습니다.<br />일본어와 운동 기록은 각 기존 앱에서 그대로 관리합니다.</p>
      </div>
    </main>
  );
}
