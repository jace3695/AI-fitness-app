import { WorkoutDayId } from "../data/workoutCompletion";

export const WORKOUT_NOTIFICATION_SETTINGS_KEY = "ai-fitness-workout-notifications-v1";

export interface WorkoutNotificationSettings {
  enabled: boolean;
  days: WorkoutDayId[];
  time: string;
  incompleteReminder: boolean;
  incompleteDelayMinutes: number;
}

export const DEFAULT_WORKOUT_NOTIFICATION_SETTINGS: WorkoutNotificationSettings = {
  enabled: false,
  days: ["mon", "tue", "wed", "thu", "fri"],
  time: "20:00",
  incompleteReminder: true,
  incompleteDelayMinutes: 60,
};

export function readWorkoutNotificationSettings(): WorkoutNotificationSettings {
  if (typeof window === "undefined") return DEFAULT_WORKOUT_NOTIFICATION_SETTINGS;
  try {
    const saved = JSON.parse(localStorage.getItem(WORKOUT_NOTIFICATION_SETTINGS_KEY) || "null") as Partial<WorkoutNotificationSettings> | null;
    return saved ? { ...DEFAULT_WORKOUT_NOTIFICATION_SETTINGS, ...saved } : DEFAULT_WORKOUT_NOTIFICATION_SETTINGS;
  } catch {
    return DEFAULT_WORKOUT_NOTIFICATION_SETTINGS;
  }
}

export function saveWorkoutNotificationSettings(settings: WorkoutNotificationSettings) {
  localStorage.setItem(WORKOUT_NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent("workout-notification-settings-changed", { detail: settings }));
}

export function notificationSupportState(): "unsupported" | NotificationPermission {
  return typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission;
}
