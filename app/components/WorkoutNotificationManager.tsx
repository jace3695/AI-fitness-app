"use client";

import { useEffect } from "react";
import { getLocalDateKey } from "../data/dietPlans";
import { getWorkoutDayForDate, isWorkoutDone, readWorkoutCompletionStore } from "../data/workoutCompletion";
import { readWorkoutNotificationSettings, WorkoutNotificationSettings } from "../lib/workoutNotifications";

const SENT_KEY = "ai-fitness-workout-notifications-sent-v1";

export default function WorkoutNotificationManager() {
  useEffect(() => {
    let settings = readWorkoutNotificationSettings();
    const onSettings = (event: Event) => { settings = (event as CustomEvent<WorkoutNotificationSettings>).detail; };
    window.addEventListener("workout-notification-settings-changed", onSettings);

    const check = () => {
      if (!settings.enabled || !("Notification" in window) || Notification.permission !== "granted") return;
      const now = new Date();
      const day = getWorkoutDayForDate(now);
      if (!day || !settings.days.includes(day)) return;
      const [hour, minute] = settings.time.split(":").map(Number);
      const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
      const elapsed = Math.floor((now.getTime() - scheduled.getTime()) / 60000);
      const dateKey = getLocalDateKey(now);
      let sent: Record<string, boolean> = {};
      try {
        sent = JSON.parse(localStorage.getItem(SENT_KEY) || "{}") as Record<string, boolean>;
      } catch {
        localStorage.removeItem(SENT_KEY);
      }
      const notify = (key: string, title: string, body: string) => {
        if (sent[key]) return;
        try {
          new Notification(title, { body, tag: key });
        } catch {
          return;
        }
        sent[key] = true;
        localStorage.setItem(SENT_KEY, JSON.stringify(sent));
      };
      if (elapsed >= 0 && elapsed < 10) notify(`${dateKey}-start`, "오늘 운동 시간입니다", "컨디션을 확인하고 오늘 할 운동을 선택해 시작해 보세요.");
      if (settings.incompleteReminder && elapsed >= settings.incompleteDelayMinutes && elapsed < settings.incompleteDelayMinutes + 10 && !isWorkoutDone(readWorkoutCompletionStore()[dateKey])) notify(`${dateKey}-incomplete`, "오늘 운동이 아직 남아 있습니다", "전체를 못 해도 괜찮습니다. 할 운동만 골라 일부 완료로 기록해 보세요.");
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => { window.clearInterval(timer); window.removeEventListener("workout-notification-settings-changed", onSettings); };
  }, []);
  return null;
}
