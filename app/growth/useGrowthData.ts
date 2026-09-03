"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  cloudRoutineToLocal,
  periodStart,
  type GrowthRoutineRow,
  type GrowthSessionRow,
  type GrowthSessionSource,
  type GrowthSessionStatus,
} from "../data/growthPlatform";
import {
  DEFAULT_GROWTH_ROUTINES,
  GROWTH_ROUTINES_STORAGE_KEY,
  getGrowthLegacySessionCloudId,
  getGrowthRoutineCloudId,
  getGrowthRoutinesStorageKey,
  parseGrowthRoutines,
  type GrowthCategoryId,
  type GrowthRoutine,
} from "../data/growthRoutines";
import { getLocalDateKey } from "@/utils/dateKey";

type NewSession = {
  id?: string;
  routineId: string | null;
  sessionDate: string;
  status: GrowthSessionStatus;
  plannedMinutes: number;
  actualMinutes: number;
  memo?: string;
  source?: GrowthSessionSource;
  metrics?: Record<string, unknown>;
  startedAt?: string | null;
  endedAt?: string | null;
};

function readLocalValue(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeLocalValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeLocalValue(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* Preserve the in-memory state. */ }
}

type LegacyImportRecord = { token: string; raw: string };

function parseLegacyImportRecord(raw: string | null): LegacyImportRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return typeof value.token === "string" && value.token && typeof value.raw === "string" && value.raw
      ? { token: value.token, raw: value.raw }
      : null;
  } catch {
    return null;
  }
}

async function withGrowthSyncLock<T>(_userId: string, task: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return task();
  return navigator.locks.request("ai-yeoni-growth-sync", { mode: "exclusive" }, task);
}

function routineMatches(row: GrowthRoutineRow, routine: GrowthRoutine) {
  return row.title === routine.title
    && row.category === routine.category
    && row.target_minutes === routine.targetMinutes
    && row.enabled === routine.enabled;
}

async function resolveCloudRoutineId(userId: string, routine: GrowthRoutine, rows: GrowthRoutineRow[], source: GrowthRoutine[]) {
  if (rows.some((row) => row.id === routine.id)) return routine.id;
  const deterministicId = await getGrowthRoutineCloudId(userId, routine.id);
  if (rows.some((row) => row.id === deterministicId)) return deterministicId;
  const matches = rows.filter((row) => routineMatches(row, routine));
  const sourceMatches = source.filter((item) => item.title === routine.title
    && item.category === routine.category
    && item.targetMinutes === routine.targetMinutes
    && item.enabled === routine.enabled);
  return matches.length === 1 && sourceMatches.length === 1 ? matches[0].id : null;
}

async function resolveStrongOwnershipRoutineId(userId: string, routine: GrowthRoutine, rows: GrowthRoutineRow[]) {
  if (rows.some((row) => row.id === routine.id)) return routine.id;
  if (DEFAULT_GROWTH_ROUTINES.some((item) => item.id === routine.id)) return null;
  const deterministicId = await getGrowthRoutineCloudId(userId, routine.id);
  return rows.some((row) => row.id === deterministicId) ? deterministicId : null;
}

async function localRoutineRows(userId: string, routines: GrowthRoutine[], sortOffset = 0): Promise<GrowthRoutineRow[]> {
  const now = new Date().toISOString();
  return Promise.all(routines.map(async (routine, index) => ({
    id: await getGrowthRoutineCloudId(userId, routine.id),
    user_id: userId,
    category: routine.category,
    title: routine.title,
    target_minutes: routine.targetMinutes,
    enabled: routine.enabled,
    sort_order: Math.min(1000, sortOffset + index),
    created_at: now,
    updated_at: now,
  })));
}

export function useGrowthData(historyDays: number | null = 90, sessionProgramId?: string) {
  const [user, setUser] = useState<User | null>(null);
  const [routines, setRoutines] = useState<GrowthRoutineRow[]>([]);
  const [sessions, setSessions] = useState<GrowthSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [legacyBackupAvailable, setLegacyBackupAvailable] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) {
      setNotice("클라우드 연결 설정을 확인해 주세요.");
      setLoading(false);
      return;
    }
    const growthClient = supabase;
    setLoading(true);
    setNotice("");
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) {
      setUser(null);
      setRoutines([]);
      setSessions([]);
      setLegacyBackupAvailable(false);
      setNotice("로그인 정보를 확인하지 못했어요.");
      setLoading(false);
      return;
    }
    setUser(auth.user);
    const userId = auth.user.id;
    await withGrowthSyncLock(userId, async () => {
    const storageKey = getGrowthRoutinesStorageKey(userId);
    const migrationKey = `${storageKey}:cloud-migrated`;
    const syncKey = `${storageKey}:sync-token`;
    const pendingImportKey = `${storageKey}:legacy-import`;
    const legacyOwnerKey = `${GROWTH_ROUTINES_STORAGE_KEY}:owner`;
    const scopedRaw = readLocalValue(storageKey);
    const pendingImportSnapshot = readLocalValue(pendingImportKey);
    const pendingImport = parseLegacyImportRecord(pendingImportSnapshot);
    const syncToken = readLocalValue(syncKey);
    const migrationCompleteValue = pendingImport ? `legacy:${pendingImport.token}` : "1";
    const needsMigration = readLocalValue(migrationKey) !== migrationCompleteValue;
    const localSnapshotUnchanged = () => readLocalValue(storageKey) === scopedRaw
      && readLocalValue(pendingImportKey) === pendingImportSnapshot
      && readLocalValue(syncKey) === syncToken;
    const loadSessions = () => {
      const baseQuery = growthClient.from("growth_sessions").select("*").eq("user_id", userId);
      const datedQuery = historyDays === null ? baseQuery : baseQuery.gte("session_date", periodStart(getLocalDateKey(), historyDays));
      const filteredQuery = sessionProgramId ? datedQuery.contains("metrics", { programId: sessionProgramId }) : datedQuery;
      return filteredQuery.order("session_date", { ascending: false }).order("created_at", { ascending: false });
    };
    const [routineResult, initialSessionResult] = await Promise.all([
      growthClient.from("growth_routines").select("*").eq("user_id", userId).order("sort_order").order("created_at"),
      loadSessions(),
    ]);
    if (routineResult.error || initialSessionResult.error) {
      setNotice("클라우드 기록을 모두 불러오지 못했어요. 잠시 후 새로고침해 주세요.");
      setLoading(false);
      return;
    }

    let cloudRoutines = (routineResult.data ?? []) as GrowthRoutineRow[];
    let sessionRows = (initialSessionResult.data ?? []) as GrowthSessionRow[];
    const localSource = needsMigration
      ? pendingImport
        ? parseGrowthRoutines(pendingImport.raw)
        : scopedRaw !== null
          ? parseGrowthRoutines(scopedRaw)
          : cloudRoutines.length === 0 ? parseGrowthRoutines(null) : []
      : [];

    if (needsMigration && localSource.length) {
      const missing: GrowthRoutine[] = [];
      for (const routine of localSource) {
        if (!await resolveCloudRoutineId(userId, routine, cloudRoutines, localSource)) missing.push(routine);
      }
      if (missing.length) {
        const rows = await localRoutineRows(userId, missing, cloudRoutines.length);
        await growthClient.from("growth_routines").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
        const refreshed = await growthClient.from("growth_routines").select("*").eq("user_id", userId).order("sort_order").order("created_at");
        if (refreshed.error) {
          setNotice("기기 루틴을 클라우드로 옮기지 못했어요. 계정별 기기 저장값은 그대로 유지됩니다.");
          setLoading(false);
          return;
        }
        cloudRoutines = (refreshed.data ?? []) as GrowthRoutineRow[];
      }
      const unresolved = (await Promise.all(localSource.map((routine) => resolveCloudRoutineId(userId, routine, cloudRoutines, localSource)))).some((id) => !id);
      if (unresolved) {
        setNotice("기기 루틴을 클라우드로 옮기지 못했어요. 기존 기기 저장값은 그대로 유지됩니다.");
        setLoading(false);
        return;
      }
    }

    const lookupCompletedDates = async (source: GrowthRoutine[]) => {
      const targets = new Map<string, string>();
      const queries = [];
      for (const routine of source) {
        const routineId = await resolveCloudRoutineId(userId, routine, cloudRoutines, source);
        if (!routineId) continue;
        targets.set(routine.id, routineId);
        if (routine.completedDates.length) {
          queries.push(growthClient.from("growth_sessions")
            .select("routine_id,session_date")
            .eq("user_id", userId)
            .eq("routine_id", routineId)
            .eq("status", "completed")
            .in("session_date", routine.completedDates));
        }
      }
      const results = await Promise.all(queries);
      const failed = results.some((result) => result.error);
      const keys = new Set(results.flatMap((result) => result.data ?? [])
        .flatMap((session) => session.routine_id ? [`${session.routine_id}:${session.session_date}`] : []));
      return { targets, keys, failed };
    };

    if (needsMigration) {
      const legacySessions: Array<Record<string, unknown>> = [];
      const existingCompletions = await lookupCompletedDates(localSource);
      if (existingCompletions.failed) {
        setNotice("기기의 이전 완료 기록과 클라우드 기록을 안전하게 비교하지 못했어요. 원본은 보존했으며 다음에 다시 시도합니다.");
        setLoading(false);
        return;
      }
      for (const routine of localSource) {
        const routineId = existingCompletions.targets.get(routine.id);
        if (!routineId) continue;
        const missingDates = routine.completedDates.filter((date) => !existingCompletions.keys.has(`${routineId}:${date}`));
        const ids = await Promise.all(missingDates.map((date) => getGrowthLegacySessionCloudId(userId, routineId, date)));
        missingDates.forEach((date, index) => legacySessions.push({
          id: ids[index],
          user_id: userId,
          routine_id: routineId,
          session_date: date,
          status: "completed",
          planned_minutes: routine.targetMinutes,
          actual_minutes: routine.targetMinutes,
          memo: "기기 기록에서 안전하게 이전",
          source: "manual",
          metrics: { migrated: true },
        }));
      }
      if (legacySessions.length) {
        const migrated = await growthClient.from("growth_sessions").upsert(legacySessions, { onConflict: "id", ignoreDuplicates: true });
        if (migrated.error) {
          setNotice("기기의 이전 완료 기록을 클라우드로 옮기지 못했어요. 계정별 원본은 보존했으며 다음에 다시 시도합니다.");
          setLoading(false);
          return;
        }
        const refreshedSessions = await loadSessions();
        if (refreshedSessions.error) {
          setNotice("이전 기록은 보존했지만 최신 목록을 다시 불러오지 못했어요. 잠시 후 새로고침해 주세요.");
          setLoading(false);
          return;
        }
        sessionRows = (refreshedSessions.data ?? []) as GrowthSessionRow[];
      }
      if (!localSnapshotUnchanged()) {
        setNotice("다른 화면에서 기기 백업이 갱신되어 오래된 동기화를 중단했어요. 최신 화면에서 다시 확인해 주세요.");
        setLoading(false);
        return;
      }
      writeLocalValue(migrationKey, migrationCompleteValue);
    }

    setRoutines(cloudRoutines);
    setSessions(sessionRows);
    try {
      if (sessionProgramId) {
        setLegacyBackupAvailable(false);
        setLoading(false);
        return;
      }
      let shouldOfferLegacy = false;
      const legacyRaw = scopedRaw === null && !pendingImport ? readLocalValue(GROWTH_ROUTINES_STORAGE_KEY) : null;
      const legacyOwner = readLocalValue(legacyOwnerKey);
      if (legacyRaw && (!legacyOwner || legacyOwner === userId)) {
        const legacyRoutines = parseGrowthRoutines(legacyRaw);
        const existingCompletions = await lookupCompletedDates(legacyRoutines);
        if (existingCompletions.failed) {
          setLegacyBackupAvailable(false);
          setNotice("이전 기기 백업과 클라우드 기록을 비교하지 못했어요. 이전 백업은 변경하지 않았으니 잠시 후 새로고침해 주세요.");
          setLoading(false);
          return;
        }
        let ownershipVerified = legacyOwner === userId;
        if (!legacyOwner) {
          const strongMatches = await Promise.all(legacyRoutines.map((routine) => resolveStrongOwnershipRoutineId(userId, routine, cloudRoutines)));
          if (strongMatches.some(Boolean)) ownershipVerified = writeLocalValue(legacyOwnerKey, userId);
        }
        if (!ownershipVerified) {
          setLegacyBackupAvailable(false);
          setNotice("소유 계정을 확인할 수 없는 이전 기기 백업은 계정 간 기록이 섞이지 않도록 가져오지 않았어요. 원본은 이 기기에 그대로 보존됩니다.");
          setLoading(false);
          return;
        }
        for (const routine of legacyRoutines) {
          const routineId = existingCompletions.targets.get(routine.id);
          if (!routineId || routine.completedDates.some((date) => !existingCompletions.keys.has(`${routineId}:${date}`))) {
            shouldOfferLegacy = true;
            break;
          }
        }
      }
      setLegacyBackupAvailable(shouldOfferLegacy);
      if (shouldOfferLegacy) {
        setNotice("이전 형식의 기기 루틴 백업을 발견했어요. 계정 확인 후 직접 가져올 수 있습니다.");
        setLoading(false);
        return;
      }
      if (!localSnapshotUnchanged()) {
        setNotice("다른 화면에서 기기 백업이 갱신되어 이 화면의 오래된 백업 쓰기를 건너뛰었어요.");
        setLoading(false);
        return;
      }
      const completedByRoutine = new Map<string, string[]>();
      for (const session of sessionRows) {
        if (session.routine_id && session.status === "completed") {
          completedByRoutine.set(session.routine_id, [...(completedByRoutine.get(session.routine_id) ?? []), session.session_date]);
        }
      }
      if (!writeLocalValue(storageKey, JSON.stringify(
        cloudRoutines.map((routine) => cloudRoutineToLocal(routine, Array.from(new Set(completedByRoutine.get(routine.id) ?? [])))),
      ))) throw new Error("offline-backup-write-failed");
    } catch {
      setNotice((current) => current || "클라우드는 동기화했지만 이 기기의 오프라인 백업을 갱신하지 못했어요.");
    }
    setLoading(false);
    });
  }, [historyDays, sessionProgramId]);

  useEffect(() => { void load(); }, [load]);

  const importLegacyBackup = useCallback(async () => {
    if (!user) return { error: new Error("로그인이 필요합니다.") };
    const prepared = await withGrowthSyncLock(user.id, async () => {
      const ownerKey = `${GROWTH_ROUTINES_STORAGE_KEY}:owner`;
      const owner = readLocalValue(ownerKey);
      if (owner !== user.id) return { error: new Error(owner ? "다른 계정이 이미 확인한 백업입니다." : "소유 계정을 확인하지 못한 백업은 안전을 위해 가져올 수 없습니다."), token: null, storageKey: null, syncKey: null };
      const legacyRaw = readLocalValue(GROWTH_ROUTINES_STORAGE_KEY);
      if (!legacyRaw) return { error: new Error("가져올 이전 백업이 없습니다."), token: null, storageKey: null, syncKey: null };
      const storageKey = getGrowthRoutinesStorageKey(user.id);
      const syncKey = `${storageKey}:sync-token`;
      const token = crypto.randomUUID();
      if (!writeLocalValue(ownerKey, user.id)) return { error: new Error("백업 소유 계정을 안전하게 기록하지 못했습니다."), token: null, storageKey: null, syncKey: null };
      if (!writeLocalValue(syncKey, token)) return { error: new Error("안전한 가져오기 잠금을 만들지 못했습니다."), token: null, storageKey: null, syncKey: null };
      const importRecord = JSON.stringify({ token, raw: legacyRaw } satisfies LegacyImportRecord);
      if (!writeLocalValue(`${storageKey}:legacy-import`, importRecord)) {
        removeLocalValue(syncKey);
        return { error: new Error("가져오기 원본을 안전하게 보존하지 못했습니다."), token: null, storageKey: null, syncKey: null };
      }
      removeLocalValue(`${storageKey}:cloud-migrated`);
      return { error: null, token, storageKey, syncKey };
    });
    if (prepared.error || !prepared.token || !prepared.storageKey || !prepared.syncKey) return { error: prepared.error ?? new Error("가져오기를 준비하지 못했습니다.") };
    try {
      setLegacyBackupAvailable(false);
      await load();
    } finally {
      await withGrowthSyncLock(user.id, async () => {
        if (readLocalValue(prepared.syncKey!) === prepared.token) removeLocalValue(prepared.syncKey!);
      });
    }
    if (readLocalValue(`${prepared.storageKey}:cloud-migrated`) !== `legacy:${prepared.token}`) {
      return { error: new Error("이전 백업을 모두 확인하지 못했습니다. 원본을 보존했으니 다시 시도해 주세요.") };
    }
    setNotice((current) => current || "이전 기기 루틴과 완료 기록을 이 계정으로 가져왔어요.");
    return { error: null };
  }, [load, user]);

  const addRoutine = useCallback(async (input: { id?: string; title: string; category: GrowthCategoryId; targetMinutes: number }) => {
    if (!supabase || !user) return { error: new Error("로그인이 필요합니다.") };
    const now = new Date().toISOString();
    const result = await supabase.from("growth_routines").insert({
      ...(input.id ? { id: input.id } : {}),
      user_id: user.id,
      title: input.title.trim().slice(0, 60),
      category: input.category,
      target_minutes: Math.min(240, Math.max(5, Math.round(input.targetMinutes))),
      enabled: true,
      sort_order: routines.length,
      updated_at: now,
    }).select("*").single();
    if (!result.error) setRoutines((current) => [...current, result.data as GrowthRoutineRow]);
    return result;
  }, [routines.length, user]);

  const updateRoutine = useCallback(async (routineId: string, updates: Partial<Pick<GrowthRoutineRow, "title" | "category" | "target_minutes" | "enabled" | "sort_order">>) => {
    if (!supabase || !user) return { error: new Error("로그인이 필요합니다.") };
    const result = await supabase.from("growth_routines").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", routineId).eq("user_id", user.id).select("*").single();
    if (!result.error) setRoutines((current) => current.map((routine) => routine.id === routineId ? result.data as GrowthRoutineRow : routine));
    return result;
  }, [user]);

  const removeRoutine = useCallback(async (routineId: string) => {
    if (!supabase || !user) return { error: new Error("로그인이 필요합니다.") };
    const result = await supabase.from("growth_routines").delete().eq("id", routineId).eq("user_id", user.id);
    if (!result.error) setRoutines((current) => current.filter((routine) => routine.id !== routineId));
    return result;
  }, [user]);

  const saveSession = useCallback(async (input: NewSession) => {
    if (!supabase || !user) return { error: new Error("로그인이 필요합니다.") };
    const result = await supabase.from("growth_sessions").insert({
      ...(input.id ? { id: input.id } : {}),
      user_id: user.id,
      routine_id: input.routineId,
      session_date: input.sessionDate,
      status: input.status,
      planned_minutes: Math.min(240, Math.max(0, Math.round(input.plannedMinutes))),
      actual_minutes: Math.min(1440, Math.max(0, Math.round(input.actualMinutes))),
      memo: (input.memo ?? "").trim().slice(0, 500),
      source: input.source ?? "manual",
      metrics: input.metrics ?? {},
      started_at: input.startedAt ?? null,
      ended_at: input.endedAt ?? null,
      updated_at: new Date().toISOString(),
    }).select("*").single();
    if (!result.error) setSessions((current) => [result.data as GrowthSessionRow, ...current]);
    return result;
  }, [user]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!supabase || !user) return { error: new Error("로그인이 필요합니다.") };
    const result = await supabase.from("growth_sessions").delete().eq("id", sessionId).eq("user_id", user.id);
    if (!result.error) setSessions((current) => current.filter((session) => session.id !== sessionId));
    return result;
  }, [user]);

  return { user, routines, sessions, loading, notice, setNotice, legacyBackupAvailable, importLegacyBackup, refresh: load, addRoutine, updateRoutine, removeRoutine, saveSession, deleteSession };
}
