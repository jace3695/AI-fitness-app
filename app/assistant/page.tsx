"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Filter = "all" | "task" | "project" | "waiting";
type Item = {
  id: string;
  title: string;
  kind: "task" | "waiting" | "reminder";
  status: "open" | "in_progress" | "waiting" | "completed" | "cancelled";
  priority: number;
  created_at: string;
};
type Project = { id: string; name: string; status: string; priority: number; created_at: string };

const filterLabels: Record<Filter, string> = { all: "전체", task: "할 일", project: "프로젝트", waiting: "회신 대기" };

export default function AssistantPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Exclude<Filter, "all">>("task");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [itemResult, projectResult] = await Promise.all([
      supabase.from("assistant_items").select("id,title,kind,status,priority,created_at").order("created_at", { ascending: false }),
      supabase.from("assistant_projects").select("id,name,status,priority,created_at").order("created_at", { ascending: false }),
    ]);
    if (itemResult.error || projectResult.error) setMessage("비서 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    setItems((itemResult.data ?? []) as Item[]);
    setProjects((projectResult.data ?? []) as Project[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

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
      : await supabase.from("assistant_items").insert({ user_id: auth.user.id, title: value, kind, status: kind === "waiting" ? "waiting" : "open", priority: 3 });
    if (result.error) setMessage("저장하지 못했습니다. 입력 내용을 확인해 주세요.");
    else { setTitle(""); await load(); }
    setSaving(false);
  };

  const toggleItem = async (item: Item) => {
    if (!supabase) return;
    const completed = item.status === "completed";
    await supabase.from("assistant_items").update({
      status: completed ? (item.kind === "waiting" ? "waiting" : "open") : "completed",
      completed_at: completed ? null : new Date().toISOString(),
    }).eq("id", item.id);
    await load();
  };

  const toggleProject = async (project: Project) => {
    if (!supabase) return;
    await supabase.from("assistant_projects").update({ status: project.status === "completed" ? "active" : "completed" }).eq("id", project.id);
    await load();
  };

  const remove = async (table: "assistant_items" | "assistant_projects", id: string) => {
    if (!supabase) return;
    await supabase.from(table).delete().eq("id", id);
    await load();
  };

  const rows = useMemo(() => {
    const itemRows = items
      .filter((item) => filter === "all" || (filter === "waiting" ? item.kind === "waiting" : filter === "task" && item.kind !== "waiting"))
      .map((item) => ({ id: item.id, title: item.title, kind: item.kind === "waiting" ? "waiting" as const : "task" as const, done: item.status === "completed", created: item.created_at, source: item }));
    const projectRows = (filter === "all" || filter === "project")
      ? projects.map((project) => ({ id: project.id, title: project.name, kind: "project" as const, done: project.status === "completed", created: project.created_at, source: project }))
      : [];
    return [...itemRows, ...projectRows].sort((a, b) => b.created.localeCompare(a.created));
  }, [filter, items, projects]);

  const openTasks = items.filter((item) => item.kind !== "waiting" && item.status !== "completed").length;
  const openProjects = projects.filter((project) => project.status !== "completed" && project.status !== "archived").length;
  const waiting = items.filter((item) => item.kind === "waiting" && item.status !== "completed").length;
  const today = new Intl.DateTimeFormat("ko-KR", { dateStyle: "full" }).format(new Date());

  return <main className="min-h-dvh bg-[#F5F4FA] text-[#242231]">
    <header className="border-b border-white/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#5146A6] text-xl font-bold text-white">J</span><div><p className="text-xs font-bold tracking-[0.14em] text-[#766DB8]">JACE AI HUB</p><h1 className="text-lg font-bold">AI 비서</h1></div></Link>
        <span className="text-xs text-gray-500 sm:text-sm">{today}</span>
      </div>
    </header>

    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
      <section className="grid gap-4 lg:grid-cols-[1.45fr_.55fr]">
        <article className="rounded-[30px] bg-gradient-to-br from-[#5146A6] to-[#766DCE] p-6 text-white shadow-[0_22px_55px_rgba(81,70,166,0.22)] sm:p-8">
          <p className="text-sm font-semibold text-white/70">오늘의 브리핑</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight">좋은 하루입니다, Jace님.<br />중요한 일부터 정리할게요.</h2>
          <p className="mt-4 text-sm leading-6 text-white/80">{openTasks + openProjects + waiting ? `현재 확인할 항목이 ${openTasks + openProjects + waiting}개 있습니다.` : "급한 업무가 없습니다. 떠오르는 일을 바로 기록해 보세요."}</p>
        </article>
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          {[{ label: "중요 업무", value: openTasks }, { label: "진행 프로젝트", value: openProjects }, { label: "회신 대기", value: waiting }].map((stat) => <article key={stat.label} className="rounded-3xl border border-white bg-white p-4 shadow-sm lg:flex lg:items-center lg:justify-between lg:px-6"><span className="text-xs font-semibold text-gray-500">{stat.label}</span><b className="mt-2 block text-2xl text-[#5146A6] lg:mt-0">{stat.value}</b></article>)}
        </div>
      </section>

      <section className="mt-5 rounded-[28px] border border-white bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><h2 className="text-xl font-bold">해야 할 일</h2><div className="flex flex-wrap gap-2">{(Object.keys(filterLabels) as Filter[]).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-3 py-2 text-xs font-bold ${filter === value ? "bg-[#5146A6] text-white" : "bg-gray-100 text-gray-600"}`}>{filterLabels[value]}</button>)}</div></div>
        <form onSubmit={addEntry} className="mt-5 grid gap-2 rounded-2xl bg-[#F5F4FA] p-2 sm:grid-cols-[1fr_auto_auto]">
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={kind === "project" ? 120 : 240} placeholder="예: 금요일까지 일본 본사 결과 확인하기" className="min-w-0 rounded-xl border-0 bg-white px-4 py-3 text-sm outline-none ring-1 ring-gray-100 focus:ring-[#7F77DD]" />
          <select value={kind} onChange={(event) => setKind(event.target.value as Exclude<Filter, "all">)} className="rounded-xl border-0 bg-white px-3 py-3 text-sm font-semibold outline-none ring-1 ring-gray-100"><option value="task">할 일</option><option value="project">프로젝트</option><option value="waiting">회신 대기</option></select>
          <button disabled={saving || !title.trim()} className="rounded-xl bg-[#5146A6] px-5 py-3 text-sm font-bold text-white disabled:bg-gray-300">{saving ? "저장 중…" : "추가"}</button>
        </form>
        {message && <p role="status" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>}

        <div className="mt-5 grid gap-2">
          {loading ? <p className="py-10 text-center text-sm text-gray-400">동기화 중…</p> : rows.length === 0 ? <p className="py-10 text-center text-sm leading-6 text-gray-400">등록된 항목이 없습니다.<br />떠오르는 일을 자연스럽게 적어보세요.</p> : rows.map((row) => <article key={`${row.kind}-${row.id}`} className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-gray-100 p-4 ${row.done ? "opacity-50" : ""}`}>
            <button type="button" aria-label="완료 전환" onClick={() => void (row.kind === "project" ? toggleProject(row.source as Project) : toggleItem(row.source as Item))} className={`h-6 w-6 rounded-full border-2 ${row.done ? "border-[#5146A6] bg-[#5146A6]" : "border-gray-300"}`}>{row.done && <span className="text-xs text-white">✓</span>}</button>
            <div className="min-w-0"><p className={`truncate font-bold ${row.done ? "line-through" : ""}`}>{row.title}</p><p className="mt-1 text-xs text-gray-400">{new Date(row.created).toLocaleString("ko-KR")}</p></div>
            <div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${row.kind === "waiting" ? "bg-orange-50 text-orange-700" : row.kind === "project" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}>{filterLabels[row.kind]}</span><button type="button" aria-label="삭제" onClick={() => void remove(row.kind === "project" ? "assistant_projects" : "assistant_items", row.id)} className="px-1 text-xl text-gray-300 hover:text-red-500">×</button></div>
          </article>)}
        </div>
      </section>
    </div>
  </main>;
}
