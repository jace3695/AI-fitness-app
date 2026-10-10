import { captureStorageOwner, isStorageOwnerCurrent, StorageSessionChangedError, requireStorageLocks, updateStorageBatch, type StorageOwnerToken } from '../data/storageTransaction';
import { supabase } from "./supabase";
import { APP_RECORD_KEYS, RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT, resetMarkerKey, type RecordResetApp } from "../data/appRecordReset";
import { getGrowthRoutinesStorageKey, parseGrowthRoutines } from "../data/growthRoutines";
import { pendingBudgetSaveKey } from "../budget/lib/pending-save";
import { assertLanguageResetCurrent, captureLanguageReset, completeLanguageReset, establishLanguageReset, markLanguageResetUncertain, requireLanguageEvidenceCleanup, type LanguageResetContext } from "../data/languageResetFence.ts";
import { LANGUAGE_LEGACY_EVIDENCE_RELEASE } from "../data/languageLegacyEvidenceRelease.ts";
import { cleanupLanguageLegacyEvidenceForReset } from "../data/languageLegacyEvidenceRepository.ts";
import { LANGUAGE_MARKER_KEY, LanguageBoundaryError, parseLanguageMarker, validateLanguageWire } from "../data/languageStorageBoundary.ts";

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
  // Cancel in-flight language work synchronously, before an outer lock can queue
  // this request. The durable fence below carries cancellation across reloads.
  if (app === "language") window.dispatchEvent(new Event(RECORD_RESET_EVENT));
  const owner = captureStorageOwner();
  if (owner.userId !== expectedUserId) throw new Error("계정이 바뀌었어요. 초기화할 계정을 다시 확인해 주세요.");
  requireStorageLocks();
  if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
  const language = app === "language" ? captureLanguageReset(requestId, expectedUserId) : null;
  const run = () => language ? performLanguageReset(language) : performReset(app, requestId, expectedUserId, owner);
  return "locks" in navigator ? navigator.locks.request(app === "growth" ? "ai-yeoni-growth-sync" : "ai-yeoni-record-reset", { mode: "exclusive" }, run) : run();
}

type ResetReceipt = { app: RecordResetApp; user_id: string; marker: string };

async function performLanguageReset(captured: LanguageResetContext): Promise<ResetReceipt> {
  assertLanguageResetCurrent(captured);
  if (!supabase) throw new Error("클라우드 연결을 확인해 주세요.");
  if (!navigator.onLine) throw new Error("인터넷에 연결한 뒤 초기화해 주세요.");
  const client = supabase;
  let context = await establishLanguageReset(captured);
  const retrying = captured.fence?.requestId === captured.requestId;
  let mayHaveDispatched = retrying && captured.fence?.state !== "completed";
  let receipt: ResetReceipt | undefined;
  try {
    assertLanguageResetCurrent(context);
    const { data: auth, error: authError } = await client.auth.getUser();
    assertLanguageResetCurrent(context);
    if (authError || auth.user?.id !== context.owner.userId) throw new Error("로그인 계정을 다시 확인해 주세요.");

    // The server remembers only its current reset marker. An old request ID
    // must never be blindly redispatched after a later reset replaced it.
    const expected = parseLanguageMarker(context.fence!.expectedMarker);
    if (retrying || (expected.kind === 'valid' && expected.requestId === context.requestId)) {
      const { data: row, error } = await client.from("language_user_state").select("state").eq("user_id", context.owner.userId).maybeSingle();
      assertLanguageResetCurrent(context);
      if (error) throw error;
      const state = row === null ? {} : validateLanguageWire(row.state);
      const remoteMarker = Object.hasOwn(state, LANGUAGE_MARKER_KEY) ? state[LANGUAGE_MARKER_KEY] as string : null;
      const remote = parseLanguageMarker(remoteMarker);
      if (remote.kind === 'valid' && remote.requestId === context.requestId) {
        receipt = { app: "language", user_id: context.owner.userId, marker: remote.raw };
      } else if (context.fence!.state === 'completed' || remoteMarker !== context.fence!.expectedMarker) {
        throw new LanguageBoundaryError("서버의 초기화 표식이 달라졌습니다. 이전 요청을 다시 실행하지 않고 기록을 보존했습니다. 별도 확인이 필요합니다.");
      }
    }
    if (!receipt) {
      assertLanguageResetCurrent(context);
      mayHaveDispatched = true;
      const { data, error } = await client.rpc("reset_my_app_records", { p_app: "language", p_request_id: context.requestId, p_confirmation: "초기화" });
      assertLanguageResetCurrent(context);
      const marker = parseLanguageMarker(data?.marker);
      if (error || data?.app !== "language" || data?.user_id !== context.owner.userId
        || marker.kind !== 'valid' || marker.requestId !== context.requestId) {
        throw new Error("초기화 완료 여부를 확인하지 못했어요. 같은 버튼을 눌러 다시 확인해 주세요.");
      }
      receipt = { app: "language", user_id: context.owner.userId, marker: marker.raw };
    }

    const { data: current, error: currentError } = await client.auth.getUser();
    assertLanguageResetCurrent(context);
    if (currentError || current.user?.id !== context.owner.userId) throw new Error("계정이 바뀌었어요. 원래 계정에서 초기화 결과를 확인해 주세요.");
    if (LANGUAGE_LEGACY_EVIDENCE_RELEASE.resetProtocol === 'protocol-required') {
      context = await requireLanguageEvidenceCleanup(context, receipt.marker);
      assertLanguageResetCurrent(context);
      context = await cleanupLanguageLegacyEvidenceForReset(context, receipt.marker);
      assertLanguageResetCurrent(context);
    }
    context = await completeLanguageReset(context, receipt.marker);
    assertLanguageResetCurrent(context);
    window.localStorage.setItem(RECORD_RESET_STORAGE_EVENT, JSON.stringify({ userId: context.owner.userId, app: "language", marker: receipt.marker }));
    assertLanguageResetCurrent(context);
    window.sessionStorage.setItem(`record-reset-receipt:${context.owner.userId}:language`, "1");
    assertLanguageResetCurrent(context);
    return receipt;
  } catch (error) {
    if (mayHaveDispatched) {
      try { await markLanguageResetUncertain(context); } catch { /* Pending/receipt bytes stay fail-closed; never repair a changed owner or corrupt control. */ }
    }
    if (error instanceof StorageSessionChangedError) {
      if (mayHaveDispatched) error.message += " 초기화 요청이 서버에 전달되었을 수 있으니 원래 계정에서 같은 요청 결과를 확인해 주세요.";
      throw error;
    }
    if (error instanceof LanguageBoundaryError) throw error;
    if (receipt) throw new Error('클라우드 초기화는 완료됐지만 이 기기의 정리를 확인하지 못했어요. 같은 버튼으로 다시 확인해 주세요. 손상되거나 지원하지 않는 기기 기록은 별도 복구가 필요합니다.');
    if (mayHaveDispatched) throw new Error('초기화 요청의 서버 처리 결과가 아직 확인되지 않았어요. 기록을 보존했으니 같은 요청으로 다시 확인해 주세요.');
    if (error instanceof LanguageBoundaryError) throw error;
    throw new Error('학습 초기화를 진행하지 못했습니다. 기기 기록은 보존했습니다.');
  }
}

async function performReset(app: RecordResetApp, requestId: string, expectedUserId: string, owner: StorageOwnerToken) {
  if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
  if (!supabase) throw new Error("클라우드 연결을 확인해 주세요.");
  if (!navigator.onLine) throw new Error("인터넷에 연결한 뒤 초기화해 주세요.");
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("로그인을 다시 확인해 주세요.");
  if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
  const userId = auth.user.id;
  if (!expectedUserId || userId !== expectedUserId) throw new Error("계정이 바뀌었어요. 초기화할 계정을 다시 확인해 주세요.");
  const { data, error } = await supabase.rpc("reset_my_app_records", { p_app: app, p_request_id: requestId, p_confirmation: "초기화" });
  if (error || data?.app !== app || data?.user_id !== userId || typeof data?.marker !== "string") {
    throw new Error("초기화 완료 여부를 확인하지 못했어요. 같은 버튼을 눌러 다시 확인해 주세요.");
  }
  if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
  const { data: current } = await supabase.auth.getUser();
  if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
  if (current.user?.id !== userId) throw new Error("계정이 바뀌었어요. 원래 계정에서 초기화 결과를 확인해 주세요.");
  try {
    await updateStorageBatch(window.localStorage, snapshot => {
      if (snapshot.getItem(resetMarkerKey(app)) === data.marker) return {};
      return { ...Object.fromEntries(APP_RECORD_KEYS[app].map(key => [key, null])), [resetMarkerKey(app)]: data.marker };
    }, { owner });
    if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
    if (app === "budget") window.localStorage.removeItem(pendingBudgetSaveKey(userId));
    if (app === "growth" && window.localStorage.getItem(`${getGrowthRoutinesStorageKey(userId)}:record-reset`) !== data.marker) clearGrowthRecordBackup(userId, data.marker);
    window.localStorage.setItem(RECORD_RESET_STORAGE_EVENT, JSON.stringify({ userId, app, marker: data.marker }));
    window.sessionStorage.setItem(`record-reset-receipt:${userId}:${app}`, "1");
  } catch (error) {
    throw new Error(`클라우드 초기화는 완료됐지만 이 기기의 정리를 확인하지 못했어요. 같은 버튼으로 다시 확인해 주세요. ${error instanceof Error ? error.message : ''}`);
  }
  return data as { app: RecordResetApp; user_id: string; marker: string };
}
