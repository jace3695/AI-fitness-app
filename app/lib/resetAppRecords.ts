import { supabase } from "./supabase";
import { APP_RECORD_KEYS, RECORD_RESET_STORAGE_EVENT, resetMarkerKey, type RecordResetApp } from "../data/appRecordReset";
import { getGrowthRoutinesStorageKey, parseGrowthRoutines } from "../data/growthRoutines";
import { pendingBudgetSaveKey } from "../budget/lib/pending-save";

export function clearGrowthRecordBackup(userId: string, marker: string) {
  const key = getGrowthRoutinesStorageKey(userId);
  const raw = window.localStorage.getItem(key);
  if (raw !== null) window.localStorage.setItem(key, JSON.stringify(parseGrowthRoutines(raw).map(routine => ({ ...routine, completedDates: [] }))));
  window.localStorage.setItem(`${key}:cloud-migrated`, "1");
  window.localStorage.setItem(`${key}:sync-token`, marker);
  window.localStorage.removeItem(`${key}:legacy-import`);
  window.localStorage.setItem(`${key}:record-reset`, marker);
}

export async function resetAppRecords(app: RecordResetApp, requestId: string, expectedUserId: string) {
  const run = () => performReset(app, requestId, expectedUserId);
  return "locks" in navigator ? navigator.locks.request(app === "growth" ? "ai-yeoni-growth-sync" : "ai-yeoni-record-reset", { mode: "exclusive" }, run) : run();
}

async function performReset(app: RecordResetApp, requestId: string, expectedUserId: string) {
  if (!supabase) throw new Error("클라우드 연결을 확인해 주세요.");
  if (!navigator.onLine) throw new Error("인터넷에 연결한 뒤 초기화해 주세요.");
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("로그인을 다시 확인해 주세요.");
  const userId = auth.user.id;
  if (!expectedUserId || userId !== expectedUserId) throw new Error("계정이 바뀌었어요. 초기화할 계정을 다시 확인해 주세요.");
  const { data, error } = await supabase.rpc("reset_my_app_records", { p_app: app, p_request_id: requestId, p_confirmation: "초기화" });
  if (error || data?.app !== app || data?.user_id !== userId || typeof data?.marker !== "string") {
    throw new Error("초기화 완료 여부를 확인하지 못했어요. 같은 버튼을 눌러 다시 확인해 주세요.");
  }
  const { data: current } = await supabase.auth.getUser();
  if (current.user?.id !== userId) throw new Error("계정이 바뀌었어요. 원래 계정에서 초기화 결과를 확인해 주세요.");
  if (app === "budget") window.localStorage.removeItem(pendingBudgetSaveKey(userId));
  if (window.localStorage.getItem(resetMarkerKey(app)) !== data.marker) {
    for (const key of APP_RECORD_KEYS[app]) window.localStorage.removeItem(key);
    window.localStorage.setItem(resetMarkerKey(app), data.marker);
  }
  if (app === "growth" && window.localStorage.getItem(`${getGrowthRoutinesStorageKey(userId)}:record-reset`) !== data.marker) clearGrowthRecordBackup(userId, data.marker);
  window.localStorage.setItem(RECORD_RESET_STORAGE_EVENT, JSON.stringify({ userId, app, marker: data.marker }));
  window.sessionStorage.setItem(`record-reset-receipt:${userId}:${app}`, "1");
  return data as { app: RecordResetApp; user_id: string; marker: string };
}
