"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabase";

const LANGUAGE_STORAGE_KEYS = [
  "dailyRoutineProgress", "dailyLearningHistory", "integratedLearningSettingsV1",
  "japaneseCurriculumProgressV1", "japaneseCurriculumReviewV1", "japaneseAppSettings",
  "learningSettings", "savedWords", "savedSentences", "wrongKana", "wrongKanaChars",
  "wrongWords", "wrongSentences", "grammarProgress", "reviewCompletedItemsByDate",
] as const;

type LanguageState = Record<string, string>;

function readLanguageState(): LanguageState {
  const state: LanguageState = {};
  for (const key of LANGUAGE_STORAGE_KEYS) {
    const value = window.localStorage.getItem(key);
    if (value !== null) state[key] = value;
  }
  return state;
}

function stableState(state: LanguageState) {
  return JSON.stringify(Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b))));
}

export default function LanguageCloudSync() {
  const [status, setStatus] = useState<"loading" | "synced" | "error">("loading");

  useEffect(() => {
    if (!supabase) return;
    const authClient = supabase;
    let active = true;
    let syncing = false;
    let lastSnapshot = "";
    let interval: ReturnType<typeof setInterval> | undefined;

    const upload = async (userId: string, state: LanguageState) => {
      if (syncing) return;
      syncing = true;
      const { error } = await authClient.from("language_user_state").upsert({
        user_id: userId,
        state,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (active) setStatus(error ? "error" : "synced");
      syncing = false;
    };

    const initialize = async () => {
      const { data: auth } = await authClient.auth.getUser();
      if (!auth.user || !active) return;

      const localState = readLanguageState();
      const { data, error } = await authClient
        .from("language_user_state")
        .select("state")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (error) {
        setStatus("error");
        return;
      }

      const remoteState = data?.state && typeof data.state === "object" ? data.state as LanguageState : {};
      const mergedState = { ...localState, ...remoteState };
      for (const [key, value] of Object.entries(remoteState)) {
        if (LANGUAGE_STORAGE_KEYS.includes(key as typeof LANGUAGE_STORAGE_KEYS[number]) && typeof value === "string") {
          window.localStorage.setItem(key, value);
        }
      }

      lastSnapshot = stableState(mergedState);
      if (!data || stableState(localState) !== lastSnapshot) await upload(auth.user.id, mergedState);
      else setStatus("synced");

      interval = setInterval(() => {
        const nextState = readLanguageState();
        const nextSnapshot = stableState(nextState);
        if (nextSnapshot !== lastSnapshot) {
          lastSnapshot = nextSnapshot;
          void upload(auth.user.id, nextState);
        }
      }, 2000);
    };

    void initialize();
    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, []);

  return <div role="status" className="fixed bottom-3 right-3 z-[100] rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-bold text-gray-500 shadow-md ring-1 ring-black/5 backdrop-blur">
    {status === "loading" ? "학습 기록 연결 중…" : status === "synced" ? "학습 기록 동기화됨" : "학습 기록 동기화 확인 필요"}
  </div>;
}
