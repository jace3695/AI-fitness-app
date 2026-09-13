"use client";

import { useUnsavedChanges } from "@/components/useUnsavedChanges";
import AppCompanion from "@/components/AppCompanion";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getLocalDateKey } from "@/utils/dateKey";
import { createQueuedRefresh } from "../lib/queuedRefresh";
import { recurrenceLabel, type RecurrenceRule } from "../lib/assistantRecurrence";
import AppIdentity from "../components/AppIdentity";
import {
  buildDietDailyStatus,
  buildFitnessDailyStatus,
  buildLanguageDailyStatus,
  EMPTY_DIET_DAILY_STATUS,
  EMPTY_FITNESS_DAILY_STATUS,
  EMPTY_LANGUAGE_DAILY_STATUS,
  type DietDailyStatus,
  parseStateObject,
  type FitnessDailyStatus,
  type LanguageDailyStatus,
} from "../data/dailyAppStatus";
import { buildAssistantNextAction } from "../data/assistantNextAction";
import {
  buildAssistantWeeklyBriefing,
  getAssistantBudgetQueryStart,
  getAssistantWeeklyStartDate,
  type AssistantWeeklyBriefing,
  type AssistantWeeklyArea,
} from "../data/assistantWeeklyBriefing";
import { isGrowthRoutineScheduled, summarizeGrowthRoutineWeek } from "../data/growthSchedule";
import { isRetiredGrowthRoutine } from "../data/growthRoutines";

type Filter = "all" | "task" | "project" | "waiting" | "memory";
type Item = {
  id: string;
  user_id: string;
  title: string;
  kind: "task" | "waiting" | "reminder";
  status: "open" | "in_progress" | "waiting" | "completed" | "cancelled";
  priority: number;
  project_id: string | null;
  due_at: string | null;
  recurrence_rule: RecurrenceRule;
  created_at: string;
  updated_at: string;
};
type Project = { id: string; name: string; status: string; priority: number; due_date: string | null; created_at: string };
type Memory = { id: string; topic: string; content: string; created_at: string };
type BudgetTransaction = { amount: number | string; date: string };
type BriefingGrowthRoutine = {
  id: string;
  title: string;
  preferred_days: number[];
  target_sessions_per_week: number;
};
type BriefingGrowthSession = {
  routine_id: string | null;
  session_date: string;
  actual_minutes: number | string;
  status: "completed" | "partial" | "stopped";
};
type BriefingSnapshot = {
  budget: { spent: number; budget: number | null; remaining: number | null; entries: number };
  fitness: FitnessDailyStatus;
  diet: DietDailyStatus;
  language: LanguageDailyStatus;
  growth: { completed: number; total: number; minutes: number };
};
type ChatMessage = { id: string; role: "user" | "assistant"; text: string; action?: { label: string; href: string } };
type StoredChatMessage = { id: string; role: "user" | "assistant"; content: string; action_label: string | null; action_href: string | null };

const EMPTY_BRIEFING: BriefingSnapshot = {
  budget: { spent: 0, budget: null, remaining: null, entries: 0 },
  fitness: EMPTY_FITNESS_DAILY_STATUS,
  diet: EMPTY_DIET_DAILY_STATUS,
  language: EMPTY_LANGUAGE_DAILY_STATUS,
  growth: { completed: 0, total: 0, minutes: 0 },
};

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "무엇을 도와드릴까요? 가계부·할 일·운동·언어 데이터를 조회하고 기록할 수 있어요.",
};

function formatWon(value: number) {
  return `${Math.abs(Math.round(value)).toLocaleString("ko-KR")}원`;
}

const filterLabels: Record<Filter, string> = { all: "전체", task: "할 일", project: "프로젝트", waiting: "회신 대기", memory: "기억" };

const weeklyCardTones: Record<AssistantWeeklyArea, string> = {
  tasks: "bg-violet-50 text-violet-950 ring-violet-100",
  budget: "bg-emerald-50 text-emerald-950 ring-emerald-100",
  fitness: "bg-orange-50 text-orange-950 ring-orange-100",
  diet: "bg-lime-50 text-lime-950 ring-lime-100",
  language: "bg-blue-50 text-blue-950 ring-blue-100",
  growth: "bg-fuchsia-50 text-fuchsia-950 ring-fuchsia-100",
};

export default function AssistantPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [briefing, setBriefing] = useState<BriefingSnapshot>(EMPTY_BRIEFING);
  const [weeklyBriefing, setWeeklyBriefing] = useState<AssistantWeeklyBriefing | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Exclude<Filter, "all">>("task");
  const [entryPriority, setEntryPriority] = useState(3);
  const [entryDueDate, setEntryDueDate] = useState("");
  const [entryProjectId, setEntryProjectId] = useState("");
  const [entryRecurrence, setEntryRecurrence] = useState<RecurrenceRule>("none");
  const [loading, setLoading] = useState(true);
  const [loadFailures, setLoadFailures] = useState<string[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(true);
  const [chatHistoryNotice, setChatHistoryNotice] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const mutationLocks = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<string[]>([]);
  useUnsavedChanges(Boolean(title.trim() || chatInput.trim() || saving || chatSending));
  const chatBoxRef = useRef<HTMLDivElement>(null);

  const signOut = async () => {
    await supabase?.auth.signOut();
    window.location.reload();
  };

  const loadChatHistory = useCallback(async () => {
    if (!supabase) return;
    setChatHistoryLoading(true);
    setChatHistoryNotice("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setChatHistoryLoading(false); return; }
    const { data, error } = await supabase
      .from("assistant_chat_messages")
      .select("id,role,content,action_label,action_href")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) {
      setChatHistoryNotice("지난 대화를 불러오지 못했어요. 새 대화는 계속할 수 있습니다.");
    } else {
      const restored = ([...(data ?? [])].reverse() as StoredChatMessage[]).map((row) => ({
        id: row.id,
        role: row.role,
        text: row.content,
        action: row.action_label && row.action_href && row.action_href !== "/growth/drawing" ? { label: row.action_label, href: row.action_href } : undefined,
      }));
      setChatMessages([WELCOME_MESSAGE, ...restored]);
    }
    setChatHistoryLoading(false);
  }, []);

  const sendChat = async (command?: string) => {
    const value = (command ?? chatInput).trim();
    if (!value || !supabase || chatSending || chatHistoryLoading) return;
    setChatInput("");
    setChatSending(true);
    const history = chatMessages.filter((chat) => chat.id !== "welcome").slice(-8).map(({ role, text }) => ({ role, text }));
    setChatMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: value }]);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("로그인이 필요합니다.");
      const response = await fetch("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ message: value, history }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "응답을 받지 못했습니다.");
      setChatMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: data.reply, action: data.action }]);
      if (data.historySaved === false) setChatHistoryNotice("응답은 받았지만 대화 이력을 저장하지 못했어요. 새로고침하면 이 대화가 보이지 않을 수 있어요.");
      if (data.changed) await load();
    } catch (error) {
      setChatMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요." }]);
    } finally { setChatSending(false); }
  };

  const load = useMemo(() => createQueuedRefresh(async () => {
    if (!supabase) return;
    setLoading(true);
    setMessage("");
    try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setLoadFailures(["로그인 확인"]); return; }

    const now = new Date();
    const todayKey = getLocalDateKey(now);
    const monthKey = `${todayKey.slice(0, 7)}-01`;
    const weeklyStartKey = getAssistantWeeklyStartDate(todayKey);
    const budgetQueryStart = getAssistantBudgetQueryStart(todayKey);
    const [itemResult, projectResult, memoryResult, budgetResult, monthlyBudgetResult, fitnessResult, languageResult, growthRoutineResult, growthSessionResult] = await Promise.all([
      supabase.from("assistant_items").select("id,user_id,title,kind,status,priority,project_id,due_at,recurrence_rule,created_at,updated_at").eq("user_id", auth.user.id).order("created_at", { ascending: false }),
      supabase.from("assistant_projects").select("id,name,status,priority,due_date,created_at").eq("user_id", auth.user.id).order("created_at", { ascending: false }),
      supabase.from("assistant_memories").select("id,topic,content,created_at").eq("user_id", auth.user.id).order("created_at", { ascending: false }),
      supabase.from("budget_transactions").select("amount,date").eq("user_id", auth.user.id).gte("date", budgetQueryStart).lte("date", todayKey),
      supabase.from("budget_monthly_budgets").select("total_amount").eq("user_id", auth.user.id).eq("budget_month", monthKey).maybeSingle(),
      supabase.from("user_app_state").select("state").eq("user_id", auth.user.id).maybeSingle(),
      supabase.from("language_user_state").select("state").eq("user_id", auth.user.id).maybeSingle(),
      supabase.from("growth_routines").select("*").eq("user_id", auth.user.id).eq("enabled", true),
      supabase.from("growth_sessions").select("routine_id,session_date,actual_minutes,status").eq("user_id", auth.user.id).gte("session_date", weeklyStartKey).lte("session_date", todayKey),
    ]);
    const failures = [
      itemResult.error && '할 일', projectResult.error && '프로젝트', memoryResult.error && '기억',
      (budgetResult.error || monthlyBudgetResult.error) && '가계부', fitnessResult.error && '운동·식단',
      languageResult.error && '언어학습', (growthRoutineResult.error || growthSessionResult.error) && '성장 기록',
    ].filter((value): value is string => Boolean(value));
    setLoadFailures(failures);
    if (!itemResult.error) setItems((itemResult.data ?? []) as Item[]);
    if (!projectResult.error) setProjects((projectResult.data ?? []) as Project[]);
    if (!memoryResult.error) setMemories((memoryResult.data ?? []) as Memory[]);
    const transactions = (budgetResult.data ?? []) as BudgetTransaction[];
    const monthlyTransactions = transactions.filter((item) => item.date >= monthKey);
    const spent = monthlyTransactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const monthlyBudget = monthlyBudgetResult.data ? Number(monthlyBudgetResult.data.total_amount) : null;
    const visibleGrowthRoutines = ((growthRoutineResult.data ?? []) as BriefingGrowthRoutine[]).filter((routine) => !isRetiredGrowthRoutine(routine));
    const visibleGrowthRoutineIds = new Set(visibleGrowthRoutines.map((routine) => routine.id));
    const visibleGrowthSessions = ((growthSessionResult.data ?? []) as BriefingGrowthSession[]).filter((row) => row.routine_id && visibleGrowthRoutineIds.has(row.routine_id));
    const todayGrowthSessions = visibleGrowthSessions.filter((row) => row.session_date === todayKey);
    const todayGrowthCompletedIds = new Set(todayGrowthSessions.filter((row) => row.status === "completed").map((row) => row.routine_id));
    const scheduledGrowthRoutines = visibleGrowthRoutines.filter((routine) => {
      const weekSummary = summarizeGrowthRoutineWeek(routine, visibleGrowthSessions, todayKey);
      return isGrowthRoutineScheduled(routine, todayKey) && (!weekSummary.achieved || todayGrowthCompletedIds.has(routine.id));
    });
    const appState = fitnessResult.data?.state ? parseStateObject(fitnessResult.data.state) : null;
    setBriefing(previous => ({
      budget: budgetResult.error || monthlyBudgetResult.error ? previous.budget : { spent, budget: monthlyBudget, remaining: monthlyBudget === null ? null : monthlyBudget - spent, entries: monthlyTransactions.length },
      fitness: fitnessResult.error ? previous.fitness : appState ? buildFitnessDailyStatus(appState, todayKey) : EMPTY_BRIEFING.fitness,
      diet: fitnessResult.error ? previous.diet : appState ? buildDietDailyStatus(appState, todayKey) : EMPTY_BRIEFING.diet,
      language: languageResult.error ? previous.language : languageResult.data?.state ? buildLanguageDailyStatus(parseStateObject(languageResult.data.state), todayKey) : EMPTY_BRIEFING.language,
      growth: growthRoutineResult.error || growthSessionResult.error ? previous.growth : {
        completed: scheduledGrowthRoutines.filter((routine) => todayGrowthCompletedIds.has(routine.id)).length,
        total: scheduledGrowthRoutines.length,
        minutes: todayGrowthSessions.reduce((sum, row) => sum + Number(row.actual_minutes || 0), 0),
      },
    }));
    setWeeklyBriefing(buildAssistantWeeklyBriefing({
      todayKey,
      items: itemResult.error ? [] : (itemResult.data ?? []) as Item[],
      budgetTransactions: budgetResult.error ? [] : transactions,
      appState,
      languageState: languageResult.data?.state ? parseStateObject(languageResult.data.state) : null,
      growthSessions: growthSessionResult.error ? [] : visibleGrowthSessions,
      available: {
        tasks: !itemResult.error,
        budget: !budgetResult.error,
        fitness: !fitnessResult.error,
        diet: !fitnessResult.error,
        language: !languageResult.error,
        growth: !growthRoutineResult.error && !growthSessionResult.error,
      },
    }));
    if (!failures.length) setLastLoadedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    } catch { setLoadFailures(['연결 확인']); }
    finally { setLoading(false); }
  }), []);

  useEffect(() => { void load(); void loadChatHistory(); }, [load, loadChatHistory]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);
  useEffect(() => {
    const box = chatBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [chatHistoryLoading, chatMessages, chatSending]);

  const addEntry = async (event: FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value || !supabase) return;
    setSaving(true);
    setMessage("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setSaving(false); return; }
    const result = kind === "project"
      ? await supabase.from("assistant_projects").insert({ user_id: auth.user.id, name: value, status: "active", priority: 3 })
      : kind === "memory"
        ? await supabase.from("assistant_memories").insert({ user_id: auth.user.id, topic: "일반", content: value, source: "manual", tags: [] })
      : await supabase.from("assistant_items").insert({ user_id: auth.user.id, title: value, kind, status: kind === "waiting" ? "waiting" : "open", priority: entryPriority, due_at: entryDueDate ? `${entryDueDate}T23:59:00+09:00` : null, project_id: entryProjectId || null, recurrence_rule: entryRecurrence });
    if (result.error) setMessage("저장하지 못했습니다. 입력 내용을 확인해 주세요.");
    else { setTitle(""); setEntryDueDate(""); setEntryProjectId(""); setEntryPriority(3); setEntryRecurrence("none"); await load(); }
    setSaving(false);
  };

  const toggleItem = async (item: Item) => {
    if (!supabase || mutationLocks.current.has(item.id)) return;
    mutationLocks.current.add(item.id);
    setBusyIds(Array.from(mutationLocks.current));
    setMessage('');
    try {
      const { error } = await supabase.rpc('set_assistant_item_completion', {
        p_item_id: item.id, p_completed: item.status !== 'completed', p_expected_updated_at: item.updated_at,
      });
      if (error) throw error;
      await load();
    } catch { setMessage('완료 상태를 확인하지 못했어요. 새로고침 후 다시 확인해 주세요. 반복 일정은 함께 저장됩니다.'); }
    finally { mutationLocks.current.delete(item.id); setBusyIds(Array.from(mutationLocks.current)); }
  };

  const toggleProject = async (project: Project) => {
    if (!supabase) return;
    const { error } = await supabase.from("assistant_projects").update({ status: project.status === "completed" ? "active" : "completed" }).eq("id", project.id);
    if (error) { setMessage("프로젝트 상태를 저장하지 못했어요. 다시 확인해 주세요."); return; }
    await load();
  };

  const remove = async (table: "assistant_items" | "assistant_projects" | "assistant_memories", id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) { setMessage("삭제하지 못했어요. 기록을 유지합니다."); return; }
    await load();
  };

  const clearChatHistory = async () => {
    if (!supabase || chatMessages.length <= 1 || !window.confirm("연이와 나눈 지난 대화를 모두 지울까요? 할 일·기억·운동 기록은 지워지지 않습니다.")) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error } = await supabase.from("assistant_chat_messages").delete().eq("user_id", auth.user.id);
    if (error) setChatHistoryNotice("대화 기록을 지우지 못했어요. 잠시 후 다시 시도해 주세요.");
    else {
      setChatMessages([WELCOME_MESSAGE]);
      setChatHistoryNotice("대화 기록을 지웠습니다.");
    }
  };

  const rows = useMemo(() => {
    const itemRows = items
      .filter((item) => filter === "all" || (filter === "waiting" ? item.kind === "waiting" : filter === "task" && item.kind !== "waiting"))
      .map((item) => ({ id: item.id, title: item.title, kind: item.kind === "waiting" ? "waiting" as const : "task" as const, done: item.status === "completed", created: item.created_at, source: item }));
    const projectRows = (filter === "all" || filter === "project")
      ? projects.map((project) => ({ id: project.id, title: project.name, kind: "project" as const, done: project.status === "completed", created: project.created_at, source: project }))
      : [];
    const memoryRows = (filter === "all" || filter === "memory")
      ? memories.map((memory) => ({ id: memory.id, title: memory.content, kind: "memory" as const, done: false, created: memory.created_at, source: memory }))
      : [];
    return [...itemRows, ...projectRows, ...memoryRows].sort((a, b) => b.created.localeCompare(a.created));
  }, [filter, items, memories, projects]);

  const openTasks = items.filter((item) => item.kind !== "waiting" && item.status !== "completed").length;
  const openProjects = projects.filter((project) => project.status !== "completed" && project.status !== "archived").length;
  const waiting = items.filter((item) => item.kind === "waiting" && item.status !== "completed").length;
  const todayKey = getLocalDateKey();
  const unavailableAll = loadFailures.includes('연결 확인') || loadFailures.includes('로그인 확인');
  const nextAction = loading || unavailableAll ? null : buildAssistantNextAction({
    items,
    budget: briefing.budget,
    fitness: briefing.fitness,
    diet: briefing.diet,
    language: briefing.language,
    growth: briefing.growth,
    todayKey,
    hour: Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' }).format(new Date())),
    available: {
      tasks: !unavailableAll && !loadFailures.includes('할 일'),
      budget: !unavailableAll && !loadFailures.includes('가계부'),
      fitness: !unavailableAll && !loadFailures.includes('운동·식단'),
      diet: !unavailableAll && !loadFailures.includes('운동·식단'),
      language: !unavailableAll && !loadFailures.includes('언어학습'),
      growth: !unavailableAll && !loadFailures.includes('성장 기록'),
    },
  });
  const todayItems = items.filter((item) => item.status !== "completed" && item.due_at && getLocalDateKey(new Date(item.due_at)) === todayKey).length;
  const today = new Intl.DateTimeFormat("ko-KR", { dateStyle: "full" }).format(new Date());
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const priorityLabel = (priority: number) => priority >= 5 ? "긴급" : priority === 4 ? "중요" : priority <= 2 ? "낮음" : "보통";

  return <main className="min-h-dvh bg-yeoni-bg text-[#242231]">
    <header className="app-module-header">
      <div className="app-module-header-inner">
        <AppIdentity kind="assistant" title="AI 연이" subtitle="한결같이 일상과 기록을 이어주는 비서" />
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-gray-500 sm:inline sm:text-sm">{today}</span>
          <button type="button" onClick={() => void signOut()} className="shrink-0 whitespace-nowrap rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600">로그아웃</button>
        </div>
      </div>
    </header>

    <div className="yeoni-page-content">
      <section className="grid gap-4 lg:grid-cols-[1.45fr_.55fr]">
        <article className="rounded-[30px] border border-violet-100 bg-white p-5 shadow-sm sm:p-7">
          <p className="text-xs font-bold text-[#766DB8]">함께 시작하는 하루</p>
          <h2 className="mb-5 mt-2 text-2xl font-bold text-[#353052]">오늘의 브리핑</h2>
          <AppCompanion home embedded quiet={chatSending}>{loading ? "안녕, Jace님! 오늘도 함께해요." : openTasks + openProjects + waiting ? `확인할 일 ${openTasks + openProjects + waiting}개, 하나씩 해볼까요?` : "오늘은 무엇부터 해볼까요?"}</AppCompanion>
        </article>
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          {[{ label: "중요 업무", value: openTasks }, { label: "진행 프로젝트", value: openProjects }, { label: "회신 대기", value: waiting }].map((stat) => <article key={stat.label} className="rounded-3xl border border-white bg-white p-4 shadow-sm lg:flex lg:items-center lg:justify-between lg:px-6"><span className="break-keep text-xs font-semibold text-gray-500">{stat.label}</span><b className="mt-2 block text-2xl text-[#5146A6] lg:mt-0">{loading || (!lastLoadedAt && loadFailures.length > 0) ? "—" : stat.value}</b></article>)}
        </div>
      </section>

      {loadFailures.length > 0 && <div role="status" className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800"><p>{loadFailures.join(' · ')} 정보를 불러오지 못했어요. {lastLoadedAt ? `마지막 정상 확인 ${lastLoadedAt}의 값을 유지합니다.` : '아래 숫자를 현재 기록으로 판단하지 마세요.'}</p><button type="button" disabled={loading} onClick={() => void load()} className="mt-2 min-h-11 rounded-xl bg-white px-4 font-bold">다시 불러오기</button></div>}
      {nextAction && <section aria-label="연이가 고른 다음 한 걸음" className="mt-5 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#5146A6] via-[#665CC0] to-[#7F77DD] p-5 text-white shadow-[0_18px_46px_rgba(81,70,166,0.24)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0"><p className="text-xs font-bold text-white/70">연이가 고른 다음 한 걸음 · {nextAction.eyebrow}</p><h2 className="mt-2 break-words text-xl font-extrabold sm:text-2xl">{nextAction.title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">{nextAction.detail}</p><p className="mt-2 text-[11px] font-semibold text-white/60">저장된 일정과 앱 상태만으로 순서를 정했어요.</p></div>
          <Link href={nextAction.href} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-extrabold text-[#3C3489] shadow-sm">{nextAction.label} →</Link>
        </div>
      </section>}
      <section aria-label="최근 7일 통합 브리핑" className="mt-5 rounded-[28px] border border-white bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[#766DB8]">AI 연이 7일 브리핑</p>
            <h2 className="mt-1 text-xl font-bold">이번 주 흐름 한눈에 보기</h2>
            <p className="mt-1 text-xs text-gray-500">저장된 기록만 집계하며 별도의 AI 비용은 사용하지 않습니다.</p>
          </div>
          {weeklyBriefing && (
            <span className="rounded-full bg-[#F1EFFF] px-3 py-2 text-xs font-bold text-[#5146A6]">
              {weeklyBriefing.startDate.slice(5).replace('-', '.')}~{weeklyBriefing.endDate.slice(5).replace('-', '.')}
            </span>
          )}
        </div>
        {loading && !weeklyBriefing ? (
          <p className="mt-4 rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">최근 7일 기록을 모으고 있어요.</p>
        ) : weeklyBriefing ? (
          <>
            <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[#312B67] p-4 text-white sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-bold text-white/60">연이의 이번 주 제안</p>
                <h3 className="mt-1 font-bold">{weeklyBriefing.recommendation.title}</h3>
                <p className="mt-1 text-xs leading-5 text-white/75">{weeklyBriefing.recommendation.detail}</p>
              </div>
              <Link href={weeklyBriefing.recommendation.href} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-4 text-xs font-bold text-[#3C3489]">
                {weeklyBriefing.recommendation.label} →
              </Link>
            </div>
            {weeklyBriefing.cards.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {weeklyBriefing.cards.map((card) => (
                  <Link key={card.area} href={card.href} className={`rounded-2xl p-4 ring-1 ${weeklyCardTones[card.area]}`}>
                    <p className="text-[11px] font-bold opacity-70">{card.label}</p>
                    <p className="mt-2 text-lg font-bold">{card.value}</p>
                    <p className="mt-1 text-[11px] opacity-65">{card.detail}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">연결된 주간 기록을 확인하지 못했어요. 위의 실패 영역을 다시 불러와 주세요.</p>
            )}
          </>
        ) : null}
      </section>
      <section className="mt-5 rounded-[28px] border border-white bg-white p-4 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-[#766DB8]">통합 오늘 브리핑</p><h2 className="mt-1 text-xl font-bold">앱별 오늘 상태</h2></div><button type="button" onClick={() => void load()} disabled={loading} className="rounded-full bg-[#F1EFFF] px-3 py-2 text-xs font-bold text-[#5146A6] disabled:opacity-50">{loading ? "동기화 중…" : "새로고침"}</button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{loading || (!lastLoadedAt && loadFailures.length > 0) ? <p className="col-span-full rounded-xl bg-gray-50 p-4 text-sm text-gray-500">{loading ? '앱별 기록을 확인하고 있어요.' : '현재 기록을 확인하지 못했어요. 위에서 다시 불러와 주세요.'}</p> : <>
          <Link href="#assistant-list" className="rounded-3xl bg-[#F7F6FF] p-5 ring-1 ring-[#ECE9FF]"><p className="text-xs font-bold text-[#766DB8]">일정·할 일</p><p className="mt-2 text-xl font-bold text-[#312B67]">오늘 {todayItems}건</p><p className="mt-1 text-xs text-gray-500">미완료 전체 {openTasks + waiting}건</p></Link>
          <Link href="/budget" className="rounded-3xl bg-emerald-50/70 p-5 ring-1 ring-emerald-100"><p className="text-xs font-bold text-emerald-700">이번 달 가계부</p><p className="mt-2 text-xl font-bold text-emerald-950">{formatWon(briefing.budget.spent)} 지출</p><p className={`mt-1 text-xs ${briefing.budget.remaining !== null && briefing.budget.remaining < 0 ? "font-bold text-red-600" : "text-gray-500"}`}>{briefing.budget.remaining === null ? `예산 미설정 · ${briefing.budget.entries}건` : briefing.budget.remaining >= 0 ? `${formatWon(briefing.budget.remaining)} 남음` : `${formatWon(briefing.budget.remaining)} 초과`}</p></Link>
          <Link href="/fitness" className="rounded-3xl bg-orange-50/70 p-5 ring-1 ring-orange-100"><p className="text-xs font-bold text-orange-700">오늘 운동</p><p className="mt-2 line-clamp-2 text-lg font-bold text-orange-950">{briefing.fitness.title}</p><p className={`mt-1 text-xs ${briefing.fitness.completed ? "font-bold text-emerald-700" : "text-gray-500"}`}>{briefing.fitness.detail}</p></Link>
          <Link href="/diet" className="rounded-3xl bg-lime-50/70 p-5 ring-1 ring-lime-100"><p className="text-xs font-bold text-lime-700">오늘 식단</p><p className="mt-2 line-clamp-2 text-lg font-bold text-lime-950">{briefing.diet.title}</p><p className={`mt-1 text-xs ${briefing.diet.completed ? "font-bold text-emerald-700" : "text-gray-500"}`}>{briefing.diet.detail}</p></Link>
          <Link href={briefing.language.nextHref} className="rounded-3xl bg-blue-50/70 p-5 ring-1 ring-blue-100"><p className="text-xs font-bold text-blue-700">오늘 언어 학습</p><p className="mt-2 text-xl font-bold text-blue-950">{briefing.language.completed}/{briefing.language.total} 완료</p><p className="mt-1 text-xs text-gray-500">{briefing.language.nextLabel}</p></Link>
          <Link href="/growth" className="rounded-3xl bg-fuchsia-50/70 p-5 ring-1 ring-fuchsia-100"><p className="text-xs font-bold text-fuchsia-700">오늘 자기계발</p><p className="mt-2 text-xl font-bold text-fuchsia-950">{briefing.growth.completed}/{briefing.growth.total} 완료</p><p className="mt-1 text-xs text-gray-500">기록 {briefing.growth.minutes}분</p></Link>
        </>}</div>
        <nav aria-label="다른 앱 바로가기" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Link href="/growth" className="rounded-2xl bg-violet-50 px-3 py-3 text-center text-xs font-bold text-violet-700">자기계발</Link>
          <Link href="/diet" className="rounded-2xl bg-emerald-50 px-3 py-3 text-center text-xs font-bold text-emerald-700">식단</Link>
          <Link href="/calendar" className="rounded-2xl bg-amber-50 px-3 py-3 text-center text-xs font-bold text-amber-700">통합 달력</Link>
          <Link href="/settings" className="rounded-2xl bg-gray-100 px-3 py-3 text-center text-xs font-bold text-gray-600">통합 설정</Link>
          <Link href="/assistant/settings" className="rounded-2xl bg-gray-100 px-3 py-3 text-center text-xs font-bold text-gray-600">연이 설정 · 기록 관리</Link>
        </nav>
      </section>

      <section className="mt-5 rounded-[28px] border border-white bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold text-[#766DB8]">YEONI AI CHAT</p><h2 className="mt-1 text-xl font-bold">연이에게 말하기</h2><p className="mt-1 text-sm text-gray-500">지난 대화를 기억하고, 직접 저장한 기억을 관련 답변에 반영합니다.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void clearChatHistory()} disabled={chatHistoryLoading || chatMessages.length <= 1} className="rounded-full bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600 disabled:opacity-40">대화 지우기</button><Link href="/assistant/quick" className="rounded-full bg-[#F1EFFF] px-3 py-2 text-xs font-bold text-[#5146A6]">Siri 빠른 명령 설정 →</Link></div></div>
        <div ref={chatBoxRef} aria-live="polite" className="mt-4 max-h-80 space-y-3 overflow-y-auto rounded-2xl bg-[#F7F6FF] p-3 sm:p-4">
          {chatHistoryLoading && <p className="text-xs font-semibold text-[#766DB8]">지난 대화를 불러오고 있어요…</p>}
          {chatMessages.map((chat) => <div key={chat.id} className={`flex ${chat.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${chat.role === "user" ? "bg-[#5146A6] text-white" : "bg-white text-gray-700 shadow-sm"}`}><p>{chat.text}</p>{chat.action && <Link href={chat.action.href} className="mt-2 inline-block rounded-full bg-[#F1EFFF] px-3 py-1.5 text-xs font-bold text-[#5146A6]">{chat.action.label} →</Link>}</div></div>)}
          {chatSending && <p className="text-xs font-semibold text-[#766DB8]">답변을 준비하고 있어요…</p>}
        </div>
        {chatHistoryNotice && <p role="status" className="mt-2 text-xs font-semibold text-amber-700">{chatHistoryNotice}</p>}
        <div className="mt-3 flex flex-wrap gap-2">{["오늘 자기계발 현황 알려줘", "타자 연습 완료했어", "오늘 일본어 학습 진도 알려줘", "오늘 운동 계획 보여줘"].map((sample) => <button key={sample} type="button" disabled={chatSending || chatHistoryLoading} onClick={() => void sendChat(sample)} className="rounded-full bg-[#F1EFFF] px-3 py-2 text-xs font-bold text-[#5146A6] disabled:opacity-50">{sample}</button>)}</div>
        <form onSubmit={(event) => { event.preventDefault(); void sendChat(); }} className="mt-3 flex gap-2">
          <label htmlFor="assistant-chat-input" className="sr-only">연이에게 보낼 명령</label><input id="assistant-chat-input" value={chatInput} disabled={chatHistoryLoading} onChange={(event) => setChatInput(event.target.value)} maxLength={500} placeholder="예: 오늘 할 일에 우유 사기 추가해줘" className="min-w-0 flex-1 rounded-2xl border-0 bg-yeoni-bg px-4 py-3 text-sm outline-none ring-1 ring-gray-100 focus:ring-[#7F77DD] disabled:opacity-50" />
          <button disabled={chatSending || chatHistoryLoading || !chatInput.trim()} className="rounded-2xl bg-[#5146A6] px-5 py-3 text-sm font-bold text-white disabled:bg-gray-300">전송</button>
        </form>
      </section>

      <section id="assistant-list" className="mt-5 scroll-mt-4 rounded-[28px] border border-white bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><h2 className="text-xl font-bold">해야 할 일</h2><div className="flex flex-wrap gap-2">{(Object.keys(filterLabels) as Filter[]).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-3 py-2 text-xs font-bold ${filter === value ? "bg-[#5146A6] text-white" : "bg-gray-100 text-gray-600"}`}>{filterLabels[value]}</button>)}</div></div>
        <form onSubmit={addEntry} className="mt-5 grid gap-2 rounded-2xl bg-yeoni-bg p-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto_auto_auto]">
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={kind === "project" ? 120 : 240} placeholder={kind === "memory" ? "예: 다음 일본 출장에서는 간사이 공항 이용" : "예: 금요일까지 일본 본사 결과 확인하기"} className="min-w-0 rounded-xl border-0 bg-white px-4 py-3 text-sm outline-none ring-1 ring-gray-100 focus:ring-[#7F77DD]" />
          <select value={kind} onChange={(event) => setKind(event.target.value as Exclude<Filter, "all">)} className="rounded-xl border-0 bg-white px-3 py-3 text-sm font-semibold outline-none ring-1 ring-gray-100"><option value="task">할 일</option><option value="project">프로젝트</option><option value="waiting">회신 대기</option><option value="memory">기억</option></select>
          <select aria-label="우선순위" value={entryPriority} disabled={kind === "project" || kind === "memory"} onChange={(event) => setEntryPriority(Number(event.target.value))} className="rounded-xl border-0 bg-white px-3 py-3 text-sm outline-none ring-1 ring-gray-100 disabled:opacity-50"><option value={5}>긴급</option><option value={4}>중요</option><option value={3}>보통</option><option value={2}>낮음</option></select>
          <input aria-label="마감일" type="date" value={entryDueDate} disabled={kind === "project" || kind === "memory"} onChange={(event) => setEntryDueDate(event.target.value)} className="rounded-xl border-0 bg-white px-3 py-3 text-sm outline-none ring-1 ring-gray-100 disabled:opacity-50" />
          <select aria-label="반복" value={entryRecurrence} disabled={kind === "project" || kind === "memory"} onChange={(event) => setEntryRecurrence(event.target.value as RecurrenceRule)} className="rounded-xl border-0 bg-white px-3 py-3 text-sm outline-none ring-1 ring-gray-100 disabled:opacity-50"><option value="none">반복 없음</option><option value="daily">매일</option><option value="weekly">매주</option><option value="monthly">매월</option></select>
          <select aria-label="연결 프로젝트" value={entryProjectId} disabled={kind === "project" || kind === "memory"} onChange={(event) => setEntryProjectId(event.target.value)} className="rounded-xl border-0 bg-white px-3 py-3 text-sm outline-none ring-1 ring-gray-100 disabled:opacity-50"><option value="">프로젝트 없음</option>{projects.filter((project) => project.status !== "completed" && project.status !== "archived").map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
          <button disabled={saving || !title.trim()} className="rounded-xl bg-[#5146A6] px-5 py-3 text-sm font-bold text-white disabled:bg-gray-300">{saving ? "저장 중…" : "추가"}</button>
        </form>
        {message && <p role="status" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>}

        <div className="mt-5 grid gap-2">
          {loading ? <p className="py-10 text-center text-sm text-gray-400">동기화 중…</p> : rows.length === 0 ? <p className="py-10 text-center text-sm leading-6 text-gray-400">{loadFailures.length ? "목록 조회를 확인하지 못했습니다." : "등록된 항목이 없습니다."}<br />떠오르는 일을 자연스럽게 적어보세요.</p> : rows.map((row) => <article key={`${row.kind}-${row.id}`} className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-gray-100 p-4 ${row.done ? "opacity-50" : ""}`}>
            {row.kind === "memory" ? <span aria-hidden="true" className="h-3 w-3 justify-self-center rounded-full bg-amber-400" /> : <button type="button" aria-label="완료 전환" disabled={busyIds.includes(row.id)} onClick={() => void (row.kind === "project" ? toggleProject(row.source as Project) : toggleItem(row.source as Item))} className={`h-11 w-11 rounded-full border-2 disabled:opacity-50 ${row.done ? "border-[#5146A6] bg-[#5146A6]" : "border-gray-300"}`}>{row.done && <span className="text-xs text-white">✓</span>}</button>}
            <div className="min-w-0"><p className={`truncate font-bold ${row.done ? "line-through" : ""}`}>{row.title}</p><div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-400"><span>{new Date(row.created).toLocaleString("ko-KR")}</span>{row.kind === "task" || row.kind === "waiting" ? <><span className={(row.source as Item).priority >= 4 ? "font-bold text-red-500" : ""}>우선순위 {priorityLabel((row.source as Item).priority)}</span>{(row.source as Item).due_at && <span className={!row.done && new Date((row.source as Item).due_at as string) < new Date() ? "font-bold text-red-500" : ""}>마감 {new Date((row.source as Item).due_at as string).toLocaleDateString("ko-KR")}</span>}{(row.source as Item).recurrence_rule !== "none" && <span className="font-bold text-[#766DB8]">{recurrenceLabel((row.source as Item).recurrence_rule)} 반복</span>}{(row.source as Item).project_id && <span>프로젝트 {projectNames.get((row.source as Item).project_id as string)}</span>}</> : null}</div></div>
            <div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${row.kind === "waiting" ? "bg-orange-50 text-orange-700" : row.kind === "project" ? "bg-blue-50 text-blue-700" : row.kind === "memory" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{filterLabels[row.kind]}</span><button type="button" aria-label="삭제" onClick={() => void remove(row.kind === "project" ? "assistant_projects" : row.kind === "memory" ? "assistant_memories" : "assistant_items", row.id)} className="px-1 text-xl text-gray-300 hover:text-red-500">×</button></div>
          </article>)}
        </div>
      </section>
      <footer className="mt-7 flex flex-wrap justify-center gap-x-4 gap-y-2 border-t border-white/80 pt-5 text-xs font-semibold text-gray-500">
        <Link href="/about">앱 소개</Link>
        <Link href="/privacy">개인정보처리방침</Link>
        <Link href="/terms">서비스 이용약관</Link>
      </footer>
    </div>
  </main>;
}
