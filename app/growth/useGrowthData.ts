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
  GROWTH_ROUTINES_STORAGE_KEY,
  parseGrowthRoutines,
  type GrowthCategoryId,
} from "../data/growthRoutines";
import { getLocalDateKey } from "@/utils/dateKey";

type NewSession = {
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

function localRoutineRows(userId: string): GrowthRoutineRow[] {
  const stored = typeof window === "undefined" ? null : window.localStorage.getItem(GROWTH_ROUTINES_STORAGE_KEY);
  const now = new Date().toISOString();
  return parseGrowthRoutines(stored).map((routine, index) => ({
    id: crypto.randomUUID(),
    user_id: userId,
    category: routine.category,
    title: routine.title,
    target_minutes: routine.targetMinutes,
    enabled: routine.enabled,
    sort_order: index,
    created_at: now,
    updated_at: now,
  }));
}

export function useGrowthData(historyDays = 90) {
  const [user, setUser] = useState<User | null>(null);
  const [routines, setRoutines] = useState<GrowthRoutineRow[]>([]);
  const [sessions, setSessions] = useState<GrowthSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!supabase) {
      setNotice("클라우드 연결 설정을 확인해 주세요.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotice("");
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) {
      setNotice("로그인 정보를 확인하지 못했어요.");
      setLoading(false);
      return;
    }
    setUser(auth.user);
    const startDate = periodStart(getLocalDateKey(), historyDays);
    let [routineResult, sessionResult] = await Promise.all([
      supabase.from("growth_routines").select("*").eq("user_id", auth.user.id).order("sort_order").order("created_at"),
      supabase.from("growth_sessions").select("*").eq("user_id", auth.user.id).gte("session_date", startDate).order("session_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    if (routineResult.error || sessionResult.error) {
      setNotice("클라우드 기록을 모두 불러오지 못했어요. 잠시 후 새로고침해 주세요.");
      setLoading(false);
      return;
    }

    let cloudRoutines = (routineResult.data ?? []) as GrowthRoutineRow[];
    if (cloudRoutines.length === 0) {
      const localRoutines = localRoutineRows(auth.user.id);
      const insertResult = await supabase.from("growth_routines").insert(localRoutines).select("*");
      if (insertResult.error) {
        setNotice("기기 루틴을 클라우드로 옮기지 못했어요. 기존 기기 저장값은 그대로 유지됩니다.");
      } else {
        cloudRoutines = (insertResult.data ?? []) as GrowthRoutineRow[];
        const legacy = parseGrowthRoutines(window.localStorage.getItem(GROWTH_ROUTINES_STORAGE_KEY));
        const legacySessions = legacy.flatMap((routine, index) => routine.completedDates.map((date) => ({
          user_id: auth.user!.id,
          routine_id: cloudRoutines[index]?.id ?? null,
          session_date: date,
          status: "completed" as const,
          planned_minutes: routine.targetMinutes,
          actual_minutes: routine.targetMinutes,
          memo: "기기 기록에서 안전하게 이전",
          source: "manual" as const,
          metrics: { migrated: true },
        }))).filter((row) => row.routine_id);
        if (legacySessions.length) {
          await supabase.from("growth_sessions").insert(legacySessions);
          sessionResult = await supabase.from("growth_sessions").select("*").eq("user_id", auth.user.id).gte("session_date", startDate).order("session_date", { ascending: false }).order("created_at", { ascending: false });
        }
      }
    }
    setRoutines(cloudRoutines);
    setSessions((sessionResult.data ?? []) as GrowthSessionRow[]);
    try {
      const completedByRoutine = new Map<string, string[]>();
      for (const session of (sessionResult.data ?? []) as GrowthSessionRow[]) {
        if (session.routine_id && session.status === "completed") {
          completedByRoutine.set(session.routine_id, [...(completedByRoutine.get(session.routine_id) ?? []), session.session_date]);
        }
      }
      window.localStorage.setItem(GROWTH_ROUTINES_STORAGE_KEY, JSON.stringify(
        cloudRoutines.map((routine) => cloudRoutineToLocal(routine, Array.from(new Set(completedByRoutine.get(routine.id) ?? [])))),
      ));
    } catch {
      setNotice((current) => current || "클라우드는 동기화했지만 이 기기의 오프라인 백업을 갱신하지 못했어요.");
    }
    setLoading(false);
  }, [historyDays]);

  useEffect(() => { void load(); }, [load]);

  const addRoutine = useCallback(async (input: { title: string; category: GrowthCategoryId; targetMinutes: number }) => {
    if (!supabase || !user) return { error: new Error("로그인이 필요합니다.") };
    const now = new Date().toISOString();
    const result = await supabase.from("growth_routines").insert({
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

  return { user, routines, sessions, loading, notice, setNotice, refresh: load, addRoutine, updateRoutine, removeRoutine, saveSession, deleteSession };
}
