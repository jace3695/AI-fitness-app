"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, Link2, Loader2, Pencil, Plus, Trash2, Unlink } from "lucide-react";
import { authenticatedFetch } from "@/lib/supabase";
import type { GoogleCalendarEvent } from "@/lib/google-calendar";

type ConnectionStatus = { loading: boolean; configured: boolean; connected: boolean; email?: string | null };
type EventForm = { title: string; date: string; allDay: boolean; startTime: string; endTime: string; description: string };

const inputClass = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function defaultForm(monthKey: string): EventForm {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  return {
    title: "",
    date: today.startsWith(monthKey) ? today : `${monthKey}-01`,
    allDay: false,
    startTime: "09:00",
    endTime: "10:00",
    description: "",
  };
}

export default function GoogleCalendarPanel({ monthKey, onEvents }: { monthKey: string; onEvents: (events: GoogleCalendarEvent[]) => void }) {
  const [status, setStatus] = useState<ConnectionStatus>({ loading: true, configured: true, connected: false });
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [form, setForm] = useState<EventForm>(() => defaultForm(monthKey));
  const [editingId, setEditingId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const response = await authenticatedFetch("/api/google-calendar/status", { cache: "no-store" });
      const data = await responseJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "연결 상태를 확인하지 못했습니다.");
      setStatus({
        loading: false,
        configured: data.configured === true,
        connected: data.connected === true,
        email: typeof data.email === "string" ? data.email : null,
      });
    } catch (error) {
      setStatus((current) => ({ ...current, loading: false, connected: false }));
      setMessage(error instanceof Error ? error.message : "연결 상태를 확인하지 못했습니다.");
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setBusy("load");
    try {
      const response = await authenticatedFetch(`/api/google-calendar/events?month=${encodeURIComponent(monthKey)}`, { cache: "no-store" });
      const data = await responseJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Google 일정을 불러오지 못했습니다.");
      const next = Array.isArray(data.events) ? data.events as GoogleCalendarEvent[] : [];
      setEvents(next);
      onEvents(next);
    } catch (error) {
      setEvents([]);
      onEvents([]);
      setMessage(error instanceof Error ? error.message : "Google 일정을 불러오지 못했습니다.");
    } finally {
      setBusy("");
    }
  }, [monthKey, onEvents]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("google");
    if (!result) return;
    setMessage(result === "connected" ? "Google Calendar가 연결되었습니다." : "Google 연결을 완료하지 못했습니다. 다시 시도해주세요.");
    const url = new URL(window.location.href);
    url.searchParams.delete("google");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useEffect(() => {
    if (status.connected) void loadEvents();
    else { setEvents([]); onEvents([]); }
  }, [loadEvents, onEvents, status.connected]);
  useEffect(() => { if (!editingId) setForm(defaultForm(monthKey)); }, [editingId, monthKey]);

  const connect = async () => {
    setBusy("connect");
    setMessage("");
    try {
      const response = await authenticatedFetch("/api/google-calendar/connect", { cache: "no-store" });
      const data = await responseJson(response);
      if (!response.ok || typeof data.authorizationUrl !== "string") throw new Error(typeof data.error === "string" ? data.error : "Google 연결을 시작하지 못했습니다.");
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      setBusy("");
      setMessage(error instanceof Error ? error.message : "Google 연결을 시작하지 못했습니다.");
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Google Calendar 연결을 해제할까요? Google에 저장된 일정은 삭제되지 않습니다.")) return;
    setBusy("disconnect");
    try {
      const response = await authenticatedFetch("/api/google-calendar/disconnect", { method: "POST" });
      const data = await responseJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "연결을 해제하지 못했습니다.");
      setStatus((current) => ({ ...current, connected: false, email: null }));
      setEvents([]);
      onEvents([]);
      setMessage("Google Calendar 연결을 해제했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "연결을 해제하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const saveEvent = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("save");
    setMessage("");
    try {
      const response = await authenticatedFetch("/api/google-calendar/events", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...(editingId ? { id: editingId } : {}) }),
      });
      const data = await responseJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "일정을 저장하지 못했습니다.");
      setMessage(data.duplicate === true ? "같은 일정이 이미 있어 중복으로 추가하지 않았습니다." : editingId ? "일정을 수정했습니다." : "일정을 추가했습니다.");
      setEditingId("");
      setShowForm(false);
      setForm(defaultForm(monthKey));
      await loadEvents();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "일정을 저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const editEvent = (item: GoogleCalendarEvent) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      date: item.date,
      allDay: item.allDay,
      startTime: item.startTime || "09:00",
      endTime: item.endTime || "10:00",
      description: item.description || "",
    });
    setShowForm(true);
    setMessage("");
  };

  const deleteEvent = async (item: GoogleCalendarEvent) => {
    if (!window.confirm(`“${item.title}” 일정을 Google Calendar에서 삭제할까요?`)) return;
    setBusy(`delete:${item.id}`);
    try {
      const response = await authenticatedFetch(`/api/google-calendar/events?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const data = await responseJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "일정을 삭제하지 못했습니다.");
      setMessage("일정을 삭제했습니다.");
      await loadEvents();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "일정을 삭제하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const sortedEvents = useMemo(() => [...events].sort((a, b) => `${a.date} ${a.startTime || ""}`.localeCompare(`${b.date} ${b.startTime || ""}`)), [events]);

  return <section className="mt-4 rounded-3xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-center gap-3">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-50 text-blue-600"><CalendarDays size={22} /></span>
      <div className="min-w-0 flex-1"><h2 className="font-bold">Google Calendar</h2><p className="text-xs text-gray-500">한 번 연결하면 이곳에서 일정 확인·추가·수정·삭제가 가능합니다.</p></div>
      {status.loading ? <span className="flex items-center gap-1 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" /> 확인 중</span> : status.connected ? <div className="flex gap-2"><button type="button" onClick={() => { setEditingId(""); setForm(defaultForm(monthKey)); setShowForm((value) => !value); }} className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white"><Plus size={14} />일정 추가</button><button type="button" onClick={disconnect} disabled={Boolean(busy)} className="flex items-center gap-1 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold disabled:opacity-50"><Unlink size={14} />해제</button></div> : <button type="button" onClick={connect} disabled={!status.configured || Boolean(busy)} className="flex items-center gap-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-gray-300">{busy === "connect" ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}Google 계정 연결</button>}
    </div>

    {!status.configured ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">운영 서버의 Google OAuth 설정을 마치면 연결 버튼이 활성화됩니다.</p> : null}
    {status.connected ? <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">연결됨{status.email ? ` · ${status.email}` : ""} · {monthKey} 일정 {events.length}개</p> : null}
    {message ? <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-xs ${message.includes("못") || message.includes("필요") || message.includes("만료") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{message}</p> : null}

    {showForm && status.connected ? <form onSubmit={saveEvent} className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
      <div className="flex items-center justify-between"><b className="text-sm">{editingId ? "Google 일정 수정" : "새 Google 일정"}</b><button type="button" onClick={() => { setShowForm(false); setEditingId(""); }} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-500">닫기</button></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-gray-600">무슨 일정인가요?</span><input required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 저녁 운동" className={inputClass} /></label>
        <label><span className="mb-1 block text-xs font-bold text-gray-600">날짜</span><input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} /></label>
        <label className="flex items-end"><span className="flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm"><input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} className="h-4 w-4" />하루 종일</span></label>
        {!form.allDay ? <><label><span className="mb-1 block text-xs font-bold text-gray-600">시작</span><input required type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={inputClass} /></label><label><span className="mb-1 block text-xs font-bold text-gray-600">끝</span><input required type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className={inputClass} /></label></> : null}
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-gray-600">메모 (선택)</span><textarea maxLength={1000} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} /></label>
      </div>
      <button disabled={busy === "save"} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:bg-gray-300">{busy === "save" ? <Loader2 size={16} className="animate-spin" /> : null}{editingId ? "수정 저장" : "Google Calendar에 추가"}</button>
    </form> : null}

    {status.connected ? <div className="mt-4"><div className="flex items-center justify-between"><b className="text-sm">{monthKey} 일정</b>{busy === "load" ? <Loader2 size={15} className="animate-spin text-blue-600" /> : null}</div>{sortedEvents.length ? <div className="mt-2 max-h-80 space-y-2 overflow-y-auto pr-1">{sortedEvents.map((item) => <article key={item.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.title}</p><p className="mt-0.5 text-xs text-gray-500">{item.date} · {item.allDay ? "종일" : `${item.startLabel}${item.endLabel ? `–${item.endLabel}` : ""}`}</p></div>{item.htmlLink ? <a href={item.htmlLink} target="_blank" rel="noreferrer" aria-label="Google Calendar에서 열기" className="grid h-8 w-8 place-items-center rounded-lg bg-white text-gray-500"><ExternalLink size={14} /></a> : null}<button type="button" onClick={() => editEvent(item)} aria-label={`${item.title} 수정`} className="grid h-8 w-8 place-items-center rounded-lg bg-white text-blue-600"><Pencil size={14} /></button><button type="button" onClick={() => deleteEvent(item)} disabled={busy === `delete:${item.id}`} aria-label={`${item.title} 삭제`} className="grid h-8 w-8 place-items-center rounded-lg bg-white text-red-600 disabled:opacity-40">{busy === `delete:${item.id}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</button></article>)}</div> : busy !== "load" ? <p className="mt-2 rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">이 달에는 Google 일정이 없습니다.</p> : null}</div> : null}
  </section>;
}
