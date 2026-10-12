"use client";

import { useEffect, useState } from "react";
import { getLocalDateKey } from "../data/dietPlans";
import { getWorkoutDayForDate, isWorkoutDone, WORKOUT_COMPLETED_DAYS_KEY, type WorkoutCompletionStore } from "../data/workoutCompletion";
import { DEFAULT_WORKOUT_NOTIFICATION_SETTINGS, WORKOUT_NOTIFICATION_SETTINGS_KEY, type WorkoutNotificationSettings } from "../lib/workoutNotifications";
import { isStorageOwnerCurrent, StorageSessionChangedError } from '../data/storageTransaction';
import { captureFitnessEditorOwner, fitnessStorageError, readFitnessValue, updateFitnessValues } from "../data/fitnessStorageUpdates";

const SENT_KEY = "ai-fitness-workout-notifications-sent-v1";

export default function WorkoutNotificationManager() {
  const [owner] = useState(captureFitnessEditorOwner);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const check = async () => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      try {
        const notifications = await updateFitnessValues(snapshot => {
          const settings = { ...DEFAULT_WORKOUT_NOTIFICATION_SETTINGS, ...readFitnessValue<Partial<WorkoutNotificationSettings>>(snapshot, WORKOUT_NOTIFICATION_SETTINGS_KEY, {}) };
          const now = new Date();
          const day = getWorkoutDayForDate(now);
          if (!active || !settings.enabled || settings.serverPushActive || !day || !settings.days.includes(day)) return { changes: {} as Record<string, string | null>, value: [] as { key: string; title: string; body: string; claim: string }[] };
          const [hour, minute] = settings.time.split(":").map(Number);
          const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
          const elapsed = Math.floor((now.getTime() - scheduled.getTime()) / 60000);
          const dateKey = getLocalDateKey(now);
          const sent = readFitnessValue<Record<string, boolean | string>>(snapshot, SENT_KEY, {});
          const notifications: { key: string; title: string; body: string; claim: string }[] = [];
          if (elapsed >= 0 && elapsed < 10 && !sent[`${dateKey}-start`]) notifications.push({ claim: crypto.randomUUID(), key: `${dateKey}-start`, title: "오늘 운동 시간입니다", body: "컨디션을 확인하고 오늘 할 운동을 선택해 시작해 보세요." });
          if (settings.incompleteReminder && elapsed >= settings.incompleteDelayMinutes && elapsed < settings.incompleteDelayMinutes + 10 && !sent[`${dateKey}-incomplete`] && !isWorkoutDone(readFitnessValue<WorkoutCompletionStore>(snapshot, WORKOUT_COMPLETED_DAYS_KEY, {})[dateKey])) notifications.push({ claim: crypto.randomUUID(), key: `${dateKey}-incomplete`, title: "오늘 운동이 아직 남아 있습니다", body: "전체를 못 해도 괜찮습니다. 할 운동만 골라 일부 완료로 기록해 보세요." });
          return { changes: notifications.length ? { [SENT_KEY]: JSON.stringify({ ...sent, ...Object.fromEntries(notifications.map(item => [item.key, item.claim])) }) } : {} as Record<string, string | null>, value: notifications };
        }, owner);
        // The durable claim prevents two participating tabs from displaying the same reminder.
        for (const notification of notifications) {
          if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
          let shown = false;
          try { if (active) { new Notification(notification.title, { body: notification.body, tag: notification.key }); shown = true; } }
          finally {
            await updateFitnessValues(snapshot => {
              const sent = readFitnessValue<Record<string, boolean | string>>(snapshot, SENT_KEY, {});
              if (sent[notification.key] !== notification.claim) return { changes: {} as Record<string, string | null>, value: undefined };
              const next = { ...sent };
              if (shown) next[notification.key] = true; else delete next[notification.key];
              return { changes: { [SENT_KEY]: JSON.stringify(next) }, value: undefined };
            }, owner);
          }
        }
      } catch (error) { if (active) setError(fitnessStorageError(error)); }
    };
    void check();
    const onSettings = () => { void check(); };
    window.addEventListener("workout-notification-settings-changed", onSettings);
    const timer = window.setInterval(() => void check(), 60_000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("workout-notification-settings-changed", onSettings); };
  }, [owner]);
  return error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p> : null;
}
