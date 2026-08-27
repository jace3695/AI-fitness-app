"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { CalendarDays, Link2, Unlink } from "lucide-react";

export type GoogleCalendarEvent = { id: string; title: string; date: string; startLabel: string; htmlLink?: string };
type TokenClient = { requestAccessToken: (options?: { prompt?: string }) => void };
declare global { interface Window { google?: { accounts: { oauth2: { initTokenClient: (options: Record<string, unknown>) => TokenClient; revoke: (token: string, callback: () => void) => void } } } } }

export default function GoogleCalendarPanel({ monthKey, onEvents }: { monthKey: string; onEvents: (events: GoogleCalendarEvent[]) => void }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID;
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { const saved = window.sessionStorage.getItem("jace-google-calendar-token") || ""; setToken(saved); }, []);
  useEffect(() => {
    if (!token) { onEvents([]); return; }
    const [year, month] = monthKey.split("-").map(Number);
    const timeMin = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const timeMax = new Date(Date.UTC(year, month, 1)).toISOString();
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (response.status === 401) { window.sessionStorage.removeItem("jace-google-calendar-token"); setToken(""); throw new Error("Google 연결이 만료되었습니다. 다시 연결해주세요."); }
        if (!response.ok) throw new Error("Google 일정을 불러오지 못했습니다.");
        return response.json();
      })
      .then((data) => onEvents((Array.isArray(data.items) ? data.items : []).flatMap((item: Record<string, unknown>) => {
        const start = item.start as Record<string, string> | undefined;
        const raw = start?.dateTime || start?.date;
        if (!raw || typeof item.id !== "string") return [];
        return [{ id: item.id, title: typeof item.summary === "string" ? item.summary : "제목 없는 일정", date: raw.slice(0, 10), startLabel: start?.date ? "종일" : new Date(raw).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }), htmlLink: typeof item.htmlLink === "string" ? item.htmlLink : undefined }];
      })))
      .catch((error: Error) => setMessage(error.message));
  }, [monthKey, onEvents, token]);

  const connect = () => {
    if (!clientId || !window.google) return;
    const client = window.google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: "https://www.googleapis.com/auth/calendar.readonly", callback: (response: { access_token?: string; error?: string }) => {
      if (!response.access_token) { setMessage(response.error || "Google 연결을 완료하지 못했습니다."); return; }
      window.sessionStorage.setItem("jace-google-calendar-token", response.access_token); setToken(response.access_token); setMessage("");
    } });
    client.requestAccessToken({ prompt: "consent" });
  };
  const disconnect = () => {
    const finish = () => { window.sessionStorage.removeItem("jace-google-calendar-token"); setToken(""); onEvents([]); };
    if (token && window.google) window.google.accounts.oauth2.revoke(token, finish); else finish();
  };

  return <section className="mt-4 rounded-3xl border border-blue-100 bg-white p-5 shadow-sm">
    <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setReady(true)} />
    <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-blue-600"><CalendarDays size={21} /></span><div className="min-w-0 flex-1"><h2 className="font-bold">Google Calendar</h2><p className="text-xs text-gray-500">기본 캘린더 일정을 통합 달력에서 읽기 전용으로 표시합니다.</p></div>{token ? <button onClick={disconnect} className="flex items-center gap-1 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold"><Unlink size={14} />해제</button> : <button onClick={connect} disabled={!ready || !clientId} className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:bg-gray-300"><Link2 size={14} />연결</button>}</div>
    {!clientId ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Google OAuth 클라이언트 ID 설정 후 연결 버튼이 활성화됩니다.</p> : null}{message ? <p className="mt-3 text-xs text-red-600">{message}</p> : null}
  </section>;
}
