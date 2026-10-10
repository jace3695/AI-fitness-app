import type { GoogleCalendarEvent } from "./google-calendar.ts";

export type GoogleCalendarLoadState = {
  monthKey: string;
  phase: "loading" | "success" | "error" | "disconnected";
  // null means this month's events have never been confirmed. [] is a known empty result.
  events: GoogleCalendarEvent[] | null;
  error: string | null;
};

export type GoogleCalendarConnectionStatus = {
  loading: boolean;
  configured: boolean;
  connected: boolean | null;
  error: string | null;
  email?: string | null;
};

export function parseGoogleCalendarConnectionStatus(value: unknown): GoogleCalendarConnectionStatus {
  if (!value || typeof value !== "object" || !("configured" in value) || !("connected" in value)
    || typeof value.configured !== "boolean" || typeof value.connected !== "boolean"
    || (!value.configured && value.connected)) {
    throw new Error("연결 상태를 확인하지 못했습니다.");
  }
  return {
    loading: false, configured: value.configured, connected: value.connected, error: null,
    email: "email" in value && typeof value.email === "string" ? value.email : null,
  };
}

export function initialGoogleCalendarLoad(monthKey: string): GoogleCalendarLoadState {
  return { monthKey, phase: "loading", events: null, error: null };
}

export function visibleGoogleCalendarLoad(
  monthKey: string,
  status: GoogleCalendarConnectionStatus,
  eventState: GoogleCalendarLoadState,
): GoogleCalendarLoadState {
  const current = eventState.monthKey === monthKey ? eventState : initialGoogleCalendarLoad(monthKey);
  if (status.error) return { ...current, phase: "error", error: status.error };
  if (status.loading || status.connected === null) return { ...current, phase: "loading", error: null };
  // A disconnected account cannot confirm whether Google has events.
  if (!status.connected) return { monthKey, phase: "disconnected", events: null, error: null };
  return current;
}

function isCalendarEvent(value: unknown): value is GoogleCalendarEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === "string" && event.id.length > 0
    && typeof event.title === "string"
    && typeof event.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.date)
    && typeof event.startLabel === "string" && typeof event.allDay === "boolean"
    && ["endLabel", "startTime", "endTime", "htmlLink", "description"].every(key => event[key] === undefined || typeof event[key] === "string");
}

// Own request identity independently of React rendering. Aborting is an optimization;
// the identity check also rejects stale responses from transports that ignore abort.
export function createGoogleCalendarLoader(
  request: (url: string, init: RequestInit) => Promise<Response>,
  onState: (state: GoogleCalendarLoadState) => void,
) {
  let state = initialGoogleCalendarLoad("");
  let pending: { monthKey: string; controller: AbortController; promise: Promise<void> } | null = null;
  const publish = (next: GoogleCalendarLoadState) => { state = next; onState(next); };
  const cancel = () => {
    const previous = pending;
    pending = null;
    previous?.controller.abort();
  };

  return {
    cancel,
    clear(monthKey: string) {
      cancel();
      publish(initialGoogleCalendarLoad(monthKey));
    },
    load(monthKey: string): Promise<void> {
      // Repeated clicks share the in-flight read; a month change supersedes it.
      if (pending?.monthKey === monthKey) return pending.promise;
      cancel();
      const current = { monthKey, controller: new AbortController(), promise: Promise.resolve() };
      pending = current;
      publish({ ...initialGoogleCalendarLoad(monthKey), events: state.monthKey === monthKey ? state.events : null });
      current.promise = (async () => {
        try {
          const response = await request(`/api/google-calendar/events?month=${encodeURIComponent(monthKey)}`, {
            cache: "no-store", signal: current.controller.signal,
          });
          const data: unknown = await response.json().catch(() => null);
          if (!response.ok) {
            const error = data && typeof data === "object" && "error" in data ? data.error : null;
            throw new Error(typeof error === "string" ? error : "Google 일정을 불러오지 못했습니다.");
          }
          if (!data || typeof data !== "object" || !("events" in data)
            || !Array.isArray(data.events) || !data.events.every(isCalendarEvent)) {
            throw new Error("Google 일정 응답을 확인하지 못했습니다. 다시 불러와 주세요.");
          }
          if (pending === current) publish({ monthKey, phase: "success", events: data.events, error: null });
        } catch (error) {
          if (pending === current) publish({ ...state, phase: "error", error: error instanceof Error ? error.message : "Google 일정을 불러오지 못했습니다." });
        } finally {
          if (pending === current) pending = null;
        }
      })();
      return current.promise;
    },
  };
}
