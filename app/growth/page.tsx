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
import { buildGrowthComparison, type GrowthSessionStatus } from "../data/growthPlatform";
import { GROWTH_CATEGORIES, GROWTH_ROUTINE_LIMIT, growthCategoryLabel, type GrowthCategoryId } from "../data/growthRoutines";
import { supabase } from "../lib/supabase";
import { getLocalDateKey } from "@/utils/dateKey";
import { useGrowthData } from "./useGrowthData";

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function comparisonLabel(delta: number, unit: string) {
  if (delta === 0) return "이전과 같음";
  return `이전보다 ${Math.abs(delta)}${unit} ${delta > 0 ? "증가" : "감소"}`;
}

export default function GrowthPage() {
  const growth = useGrowthData(90);
  const [fitness, setFitness] = useState(EMPTY_FITNESS_DAILY_STATUS);
  const [language, setLanguage] = useState(EMPTY_LANGUAGE_DAILY_STATUS);
  const [linkedLoading, setLinkedLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<GrowthCategoryId>("custom");
  const [targetMinutes, setTargetMinutes] = useState(15);
  const [activeRoutineId, setActiveRoutineId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sessionMemo, setSessionMemo] = useState("");
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordRoutineId, setRecordRoutineId] = useState("");
  const [recordDate, setRecordDate] = useState(getLocalDateKey());
  const [recordStatus, setRecordStatus] = useState<GrowthSessionStatus>("completed");
  const [recordMinutes, setRecordMinutes] = useState(10);
  const [recordMemo, setRecordMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const todayKey = useMemo(() => getLocalDateKey(), []);
  const todayLabel = useMemo(() => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date()), []);

  useEffect(() => {
    if (!startedAt) return;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    let active = true;
    const loadLinked = async () => {
      if (!supabase) { setLinkedLoading(false); return; }
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user || !active) { setLinkedLoading(false); return; }
      const [fitnessResult, languageResult] = await Promise.all([
        supabase.from("user_app_state").select("state").eq("user_id", auth.user.id).maybeSingle(),
        supabase.from("language_user_state").select("state").eq("user_id", auth.user.id).maybeSingle(),
      ]);
      if (!active) return;
      setFitness(fitnessResult.data?.state ? buildFitnessDailyStatus(parseStateObject(fitnessResult.data.state), todayKey) : EMPTY_FITNESS_DAILY_STATUS);
      setLanguage(languageResult.data?.state ? buildLanguageDailyStatus(parseStateObject(languageResult.data.state), todayKey) : EMPTY_LANGUAGE_DAILY_STATUS);
      setLinkedLoading(false);
    };
    void loadLinked();
    return () => { active = false; };
  }, [todayKey]);

  const enabledRoutines = growth.routines.filter((routine) => routine.enabled);
  const todayCompletedIds = new Set(growth.sessions.filter((session) => session.session_date === todayKey && session.status === "completed" && session.routine_id).map((session) => session.routine_id));
  const completedPersonalCount = enabledRoutines.filter((routine) => todayCompletedIds.has(routine.id)).length;
  const fitnessDone = fitness.synced && (fitness.completed || fitness.isRest);
  const languageDone = language.synced && language.completed >= language.total;
  const totalCount = enabledRoutines.length + 2;
  const completedCount = completedPersonalCount + Number(fitnessDone) + Number(languageDone);
  const progress = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;
  const week = buildGrowthComparison(growth.sessions, todayKey, 7);
  const month = buildGrowthComparison(growth.sessions, todayKey, 30);
  const activeRoutine = growth.routines.find((routine) => routine.id === activeRoutineId) ?? null;
  const recentSessions = growth.sessions.slice(0, 12);

  const startRoutine = (routineId: string) => {
    setActiveRoutineId(routineId);
    setStartedAt(new Date().toISOString());
    setElapsedSeconds(0);
    setSessionMemo("");
    growth.setNotice("타이머를 시작했어요. 실제 시작 시각으로 계산합니다.");
  };

  const finishActive = async (status: GrowthSessionStatus) => {
    if (!activeRoutine || !startedAt) return;
    setSaving(true);
    const endedAt = new Date().toISOString();
    const result = await growth.saveSession({
      routineId: activeRoutine.id,
      sessionDate: todayKey,
      status,
      plannedMinutes: activeRoutine.target_minutes,
      actualMinutes: Math.max(1, Math.round(elapsedSeconds / 60)),
      memo: sessionMemo,
      startedAt,
      endedAt,
    });
    setSaving(false);
    if (result.error) { growth.setNotice("실행 기록을 저장하지 못했어요. 다시 시도해 주세요."); return; }
    setActiveRoutineId(null); setStartedAt(null); setElapsedSeconds(0); setSessionMemo("");
    growth.setNotice(status === "completed" ? "완료 기록을 클라우드에 저장했어요." : status === "partial" ? "진행 기록을 저장했어요." : "중단 지점까지 안전하게 저장했어요.");
  };

  const quickToggle = async (routineId: string) => {
    const routine = growth.routines.find((item) => item.id === routineId);
    if (!routine || saving) return;
    setSaving(true);
    const completed = growth.sessions.filter((session) => session.routine_id === routineId && session.session_date === todayKey && session.status === "completed");
    const result = completed.length
      ? { error: (await Promise.all(completed.map((session) => growth.deleteSession(session.id)))).find((item) => item.error)?.error ?? null }
      : await growth.saveSession({ routineId, sessionDate: todayKey, status: "completed", plannedMinutes: routine.target_minutes, actualMinutes: routine.target_minutes, memo: "빠른 완료 기록" });
    setSaving(false);
    growth.setNotice(result.error ? "완료 상태를 저장하지 못했어요." : completed.length ? "오늘 완료 기록을 모두 취소했어요." : "오늘 완료로 기록했어요.");
  };

  const addRoutine = async (event: FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value || growth.routines.length >= GROWTH_ROUTINE_LIMIT) return;
    setSaving(true);
    const result = await growth.addRoutine({ title: value, category, targetMinutes });
    setSaving(false);
    if (result.error) { growth.setNotice("루틴을 추가하지 못했어요."); return; }
    setTitle(""); setCategory("custom"); setTargetMinutes(15);
    growth.setNotice("새 루틴을 모든 기기에서 볼 수 있게 저장했어요.");
  };

  const saveManualRecord = async (event: FormEvent) => {
    event.preventDefault();
    const routine = growth.routines.find((item) => item.id === recordRoutineId);
    if (!routine) return;
    setSaving(true);
    const result = await growth.saveSession({ routineId: routine.id, sessionDate: recordDate, status: recordStatus, plannedMinutes: routine.target_minutes, actualMinutes: recordMinutes, memo: recordMemo });
    setSaving(false);
    if (result.error) { growth.setNotice("기록을 저장하지 못했어요."); return; }
    setRecordOpen(false); setRecordMemo("");
    growth.setNotice(`${recordDate} 기록을 저장했어요.`);
  };

  return (
    <main className="min-h-dvh bg-[#F5F4FA] pb-10 text-[#242231]">
      <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="growth" title="자기계발" subtitle="시작부터 기록과 성장 확인까지" /><span className="text-xs font-semibold text-gray-500 sm:text-sm">{todayLabel}</span></div></header>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-9">
        <section className="rounded-[30px] bg-gradient-to-br from-violet-600 to-indigo-500 p-6 text-white shadow-[0_22px_55px_rgba(91,75,180,0.22)] sm:p-8">
          <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold text-white/75">오늘의 자기계발</p><strong className="mt-3 block text-4xl">{completedCount}/{totalCount}</strong><p className="mt-2 text-sm text-white/80">오늘 루틴 완료</p></div><strong className="text-2xl">{progress}%</strong></div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/20" aria-label={`오늘 자기계발 ${progress}% 완료`}><div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${progress}%` }} /></div>
          <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => setRecordOpen((value) => !value)} className="min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-violet-700">지난 기록 추가</button><Link href="/growth/review" className="inline-flex min-h-11 items-center rounded-xl bg-white/15 px-4 text-sm font-bold ring-1 ring-white/30">주간 코칭 보기</Link></div>
        </section>

        {recordOpen && <section className="mt-4 rounded-[26px] bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">날짜를 골라 기록하기</h2><form onSubmit={saveManualRecord} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><select required value={recordRoutineId} onChange={(event) => { const id = event.target.value; setRecordRoutineId(id); const routine = growth.routines.find((item) => item.id === id); if (routine) setRecordMinutes(routine.target_minutes); }} className="min-h-12 rounded-xl bg-gray-50 px-3 text-sm ring-1 ring-gray-200"><option value="">루틴 선택</option>{enabledRoutines.map((routine) => <option key={routine.id} value={routine.id}>{routine.title}</option>)}</select><input aria-label="기록 날짜" type="date" required max={todayKey} value={recordDate} onChange={(event) => setRecordDate(event.target.value)} className="min-h-12 rounded-xl bg-gray-50 px-3 text-sm ring-1 ring-gray-200" /><select aria-label="실행 상태" value={recordStatus} onChange={(event) => setRecordStatus(event.target.value as GrowthSessionStatus)} className="min-h-12 rounded-xl bg-gray-50 px-3 text-sm ring-1 ring-gray-200"><option value="completed">완료</option><option value="partial">진행</option><option value="stopped">중단</option></select><label className="flex min-h-12 items-center gap-2 rounded-xl bg-gray-50 px-3 text-sm ring-1 ring-gray-200"><span>실행</span><input aria-label="실행 시간" type="number" min={0} max={1440} value={recordMinutes} onChange={(event) => setRecordMinutes(Number(event.target.value))} className="w-14 bg-transparent font-bold outline-none" />분</label><button disabled={saving || !recordRoutineId} className="min-h-12 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:bg-gray-300">기록 저장</button><textarea value={recordMemo} onChange={(event) => setRecordMemo(event.target.value)} maxLength={500} placeholder="메모(선택)" className="min-h-20 rounded-xl bg-gray-50 p-3 text-sm ring-1 ring-gray-200 sm:col-span-2 lg:col-span-5" /></form></section>}

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          {[{ label: "최근 7일", value: week }, { label: "최근 30일", value: month }].map((item) => <article key={item.label} className="rounded-[26px] bg-white p-5 shadow-sm"><p className="text-xs font-bold text-violet-600">{item.label} 성장 기록</p><div className="mt-3 flex items-end justify-between gap-3"><div><strong className="text-3xl">{item.value.current.totalMinutes}분</strong><p className="mt-1 text-xs text-gray-500">{item.value.current.activeDays}일 실행 · 완료율 {item.value.current.completionRate}%</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${item.value.minuteDelta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{comparisonLabel(item.value.minuteDelta, "분")}</span></div></article>)}
        </section>

        <nav aria-label="자기계발 연습과 자료" className="mt-5 grid grid-cols-3 gap-3">
          <Link href="/growth/typing" className="rounded-3xl bg-blue-50 p-4 text-center ring-1 ring-blue-100"><span className="text-2xl" aria-hidden="true">⌨️</span><strong className="mt-2 block text-sm text-blue-900">타자 연습</strong><span className="mt-1 block text-xs text-blue-700">속도·정확도 저장</span></Link>
          <Link href="/growth/handwriting" className="rounded-3xl bg-amber-50 p-4 text-center ring-1 ring-amber-100"><span className="text-2xl" aria-hidden="true">✍️</span><strong className="mt-2 block text-sm text-amber-900">손글씨 연습</strong><span className="mt-1 block text-xs text-amber-700">Apple Pencil 지원</span></Link>
          <Link href="/growth/resources" className="rounded-3xl bg-emerald-50 p-4 text-center ring-1 ring-emerald-100"><span className="text-2xl" aria-hidden="true">📚</span><strong className="mt-2 block text-sm text-emerald-900">내 자료</strong><span className="mt-1 block text-xs text-emerald-700">비공개 보관·검색</span></Link>
        </nav>

        {activeRoutine && <section className="mt-5 rounded-[28px] bg-[#242231] p-6 text-white shadow-xl"><p className="text-xs font-bold text-violet-300">실행 중</p><h2 className="mt-2 text-2xl font-bold">{activeRoutine.title}</h2><p aria-live="polite" className="mt-5 font-mono text-5xl font-bold tracking-tight">{formatDuration(elapsedSeconds)}</p><p className="mt-2 text-sm text-white/60">목표 {activeRoutine.target_minutes}분</p><textarea value={sessionMemo} onChange={(event) => setSessionMemo(event.target.value)} maxLength={500} placeholder="지금 느낀 점이나 다음에 할 일을 적어두세요" className="mt-5 min-h-20 w-full rounded-2xl border-0 bg-white/10 p-4 text-sm text-white placeholder:text-white/40 ring-1 ring-white/15" /><div className="mt-4 grid grid-cols-3 gap-2"><button disabled={saving} onClick={() => void finishActive("stopped")} className="min-h-12 rounded-xl bg-white/10 text-sm font-bold">중단 저장</button><button disabled={saving} onClick={() => void finishActive("partial")} className="min-h-12 rounded-xl bg-violet-400/30 text-sm font-bold">진행 저장</button><button disabled={saving} onClick={() => void finishActive("completed")} className="min-h-12 rounded-xl bg-emerald-500 text-sm font-bold">완료 저장</button></div></section>}

        <section className="mt-5 rounded-[28px] bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-violet-600">클라우드 동기화</p><h2 className="mt-1 text-xl font-bold">나의 루틴</h2></div><button type="button" aria-expanded={editing} onClick={() => setEditing((value) => !value)} className="min-h-11 rounded-full bg-gray-100 px-4 text-xs font-bold text-gray-700">{editing ? "편집 닫기" : "루틴 편집"}</button></div>
          <p className="mt-2 text-xs leading-5 text-gray-500">운동과 일본어는 각 앱의 오늘 기록이 자동으로 반영됩니다.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <article className={`rounded-2xl border p-4 ${languageDone ? "border-emerald-100 bg-emerald-50" : "border-blue-100 bg-blue-50"}`}>
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-blue-700">일본어</p><h3 className="mt-1 font-bold text-blue-950">{linkedLoading ? "기록 불러오는 중" : `${language.completed}/${language.total} 완료`}</h3></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${languageDone ? "bg-emerald-100 text-emerald-700" : "bg-white text-blue-700"}`}>{languageDone ? "완료" : "학습"}</span></div>
              <p className="mt-2 text-xs text-gray-600">{linkedLoading ? "일본어 앱 기록을 확인하고 있어요." : language.nextLabel}</p>
              <Link href={language.nextHref} className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 text-xs font-bold text-white">{languageDone ? "일본어 앱 보기" : "이어하기"} →</Link>
            </article>
            <article className={`rounded-2xl border p-4 ${fitnessDone ? "border-emerald-100 bg-emerald-50" : "border-orange-100 bg-orange-50"}`}>
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-orange-700">운동</p><h3 className="mt-1 font-bold text-orange-950">{linkedLoading ? "기록 불러오는 중" : fitness.title}</h3></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${fitnessDone ? "bg-emerald-100 text-emerald-700" : "bg-white text-orange-700"}`}>{fitnessDone ? fitness.isRest ? "회복일" : "완료" : "운동"}</span></div>
              <p className="mt-2 text-xs text-gray-600">{linkedLoading ? "운동 앱 기록을 확인하고 있어요." : fitness.detail}</p>
              <Link href="/fitness" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-orange-600 px-4 text-xs font-bold text-white">운동 앱 열기 →</Link>
            </article>
          </div>
          <div className="mt-3 space-y-3">{growth.loading ? <p className="py-8 text-center text-sm text-gray-400">개인 루틴을 안전하게 동기화하고 있어요…</p> : enabledRoutines.map((routine) => { const completed = todayCompletedIds.has(routine.id); return <article key={routine.id} className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border p-4 ${completed ? "border-emerald-100 bg-emerald-50" : "border-gray-100"}`}><button disabled={saving} type="button" onClick={() => void quickToggle(routine.id)} aria-label={`${routine.title} ${completed ? "완료 취소" : "빠른 완료"}`} className={`grid h-11 w-11 place-items-center rounded-full border-2 text-lg font-bold ${completed ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 text-transparent"}`}>✓</button><div className="min-w-0"><p className="text-xs font-bold text-violet-600">{growthCategoryLabel(routine.category)}</p><h3 className={`mt-1 truncate font-bold ${completed ? "text-gray-500 line-through" : "text-gray-900"}`}>{routine.title}</h3><p className="mt-1 text-xs text-gray-500">목표 {routine.target_minutes}분</p></div><button type="button" disabled={Boolean(activeRoutine) || completed} onClick={() => startRoutine(routine.id)} className="min-h-11 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white disabled:bg-gray-200 disabled:text-gray-500">{completed ? "완료" : activeRoutineId === routine.id ? "진행 중" : "시작"}</button></article>; })}</div>
          {growth.notice && <p role="status" className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{growth.notice}</p>}
          {editing && <div className="mt-5 rounded-3xl bg-[#F7F6FF] p-4 sm:p-5"><h3 className="font-bold">개인 루틴 편집</h3><p className="mt-1 text-xs leading-5 text-gray-500">운동·일본어는 위에서 자동 연결되며, 아래에서는 개인 루틴만 편집합니다. 변경 내용은 계정에 저장되어 iPhone과 iPad에서 함께 보입니다.</p><form onSubmit={addRoutine} className="mt-4 grid gap-2 sm:grid-cols-[auto_1fr_auto_auto]"><select value={category} onChange={(event) => setCategory(event.target.value as GrowthCategoryId)} className="min-h-12 rounded-xl bg-white px-3 text-sm ring-1 ring-gray-200">{GROWTH_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} placeholder="예: 타자 정확도 연습" className="min-h-12 rounded-xl bg-white px-4 text-sm ring-1 ring-gray-200" /><label className="flex min-h-12 items-center gap-2 rounded-xl bg-white px-3 text-sm ring-1 ring-gray-200">목표 <input type="number" min={5} max={240} step={5} value={targetMinutes} onChange={(event) => setTargetMinutes(Number(event.target.value))} className="w-14 bg-transparent font-bold outline-none" />분</label><button disabled={saving || !title.trim() || growth.routines.length >= GROWTH_ROUTINE_LIMIT} className="min-h-12 rounded-xl bg-violet-600 px-5 text-sm font-bold text-white disabled:bg-gray-300">추가</button></form><div className="mt-4 space-y-2">{growth.routines.map((routine) => <div key={routine.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-3"><button type="button" onClick={() => void growth.updateRoutine(routine.id, { enabled: !routine.enabled })} className={`min-h-10 rounded-lg px-3 text-xs font-bold ${routine.enabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{routine.enabled ? "사용 중" : "숨김"}</button><span className="min-w-0 flex-1 truncate text-sm font-semibold">{routine.title} · {routine.target_minutes}분</span><button type="button" onClick={() => void growth.removeRoutine(routine.id)} className="min-h-10 rounded-lg bg-red-50 px-3 text-xs font-bold text-red-600">삭제</button></div>)}</div></div>}
        </section>

        <section className="mt-5 rounded-[28px] bg-white p-4 shadow-sm sm:p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-bold text-violet-600">실행 이력</p><h2 className="mt-1 text-xl font-bold">최근 기록</h2></div><button type="button" onClick={() => void growth.refresh()} className="rounded-full bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">새로고침</button></div><div className="mt-4 space-y-2">{recentSessions.length ? recentSessions.map((session) => { const routine = growth.routines.find((item) => item.id === session.routine_id); const statusLabel = session.status === "completed" ? "완료" : session.status === "partial" ? "진행" : "중단"; return <article key={session.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-2xl bg-gray-50 p-4"><div><div className="flex flex-wrap items-center gap-2"><strong>{routine?.title ?? "삭제된 루틴"}</strong><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${session.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{statusLabel}</span></div><p className="mt-1 text-xs text-gray-500">{session.session_date} · {session.actual_minutes}분{session.memo ? ` · ${session.memo}` : ""}</p></div><button type="button" aria-label="기록 삭제" onClick={() => void growth.deleteSession(session.id)} className="text-xl text-gray-300">×</button></article>; }) : <p className="py-7 text-center text-sm text-gray-400">아직 실행 기록이 없습니다.</p>}</div></section>

      </div>
    </main>
  );
}
