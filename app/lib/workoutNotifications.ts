import { captureStorageOwner, isStorageOwnerCurrent, StorageSessionChangedError, readStorageSnapshot, type StorageOwnerToken } from '../data/storageTransaction';
import { readFitnessValue, updateFitnessValues } from '../data/fitnessStorageUpdates';
import { WorkoutDayId } from "../data/workoutCompletion";
import { supabase } from "./supabase";

export const WORKOUT_NOTIFICATION_SETTINGS_KEY = "ai-fitness-workout-notifications-v1";

export interface WorkoutNotificationSettings {
  enabled: boolean;
  days: WorkoutDayId[];
  time: string;
  incompleteReminder: boolean;
  incompleteDelayMinutes: number;
  serverPushActive?: boolean;
}

export const VAPID_PUBLIC_KEY = "BAZxKBZTZpZxwRchjNON0IfKrwgbISZ8SsgyDTrj6lWSK_k0GYgYnkSHW5p_lNYMiTuuxSkUVXh36U5XiKB7MF0";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(Array.from(raw, (character) => character.charCodeAt(0)));
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
    const saved = JSON.parse(readStorageSnapshot(window.localStorage).getItem(WORKOUT_NOTIFICATION_SETTINGS_KEY) || "null") as Partial<WorkoutNotificationSettings> | null;
    if (!saved) return DEFAULT_WORKOUT_NOTIFICATION_SETTINGS;
    const merged = { ...DEFAULT_WORKOUT_NOTIFICATION_SETTINGS, ...saved };
    return {
      ...merged,
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(merged.time)
        ? merged.time
        : DEFAULT_WORKOUT_NOTIFICATION_SETTINGS.time,
    };
  } catch {
    return DEFAULT_WORKOUT_NOTIFICATION_SETTINGS;
  }
}

export async function saveWorkoutNotificationSettings(settings: Partial<WorkoutNotificationSettings> | ((current: WorkoutNotificationSettings) => WorkoutNotificationSettings), owner?: StorageOwnerToken) {
  const saved = await updateFitnessValues(snapshot => {
    const current = { ...DEFAULT_WORKOUT_NOTIFICATION_SETTINGS, ...readFitnessValue<Partial<WorkoutNotificationSettings>>(snapshot, WORKOUT_NOTIFICATION_SETTINGS_KEY, {}) };
    const value = typeof settings === 'function' ? settings(current) : { ...current, ...settings };
    return { changes: { [WORKOUT_NOTIFICATION_SETTINGS_KEY]: JSON.stringify(value) }, value };
  }, owner);
  window.dispatchEvent(new CustomEvent("workout-notification-settings-changed", { detail: saved }));
  return saved;
}

export function notificationSupportState(): "unsupported" | NotificationPermission {
  return typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission;
}

export function serverPushSupportState() {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
}

export async function enableServerPush(settings: WorkoutNotificationSettings, owner: StorageOwnerToken = captureStorageOwner()) {
  const checkOwner = () => { if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError(); };
  checkOwner();
  if (!supabase || !serverPushSupportState()) throw new Error("이 기기에서는 서버 알림을 사용할 수 없습니다.");
  const { data: { user } } = await supabase.auth.getUser();
  checkOwner();
  if (user?.id !== owner.userId) throw new StorageSessionChangedError();
  if (!user) throw new Error("서버 알림을 사용하려면 다시 로그인해 주세요.");
  const registration = await navigator.serviceWorker.ready;
  checkOwner();
  let subscription = await registration.pushManager.getSubscription();
  checkOwner();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  checkOwner();
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("알림 구독 정보를 만들지 못했습니다.");
  const { error } = await supabase.from("push_subscriptions").upsert({
    user_id: user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    days: settings.days,
    workout_time: settings.time,
    incomplete_reminder: settings.incompleteReminder,
    incomplete_delay_minutes: settings.incompleteDelayMinutes,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
    enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  checkOwner();
  if (error) throw error;
  return subscription;
}

export async function updateServerPushSettings(settings: WorkoutNotificationSettings, owner: StorageOwnerToken = captureStorageOwner()) {
  const checkOwner = () => { if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError(); };
  checkOwner();
  if (!supabase || !settings.serverPushActive || !serverPushSupportState()) return;
  const registration = await navigator.serviceWorker.ready;
  checkOwner();
  const subscription = await registration.pushManager.getSubscription();
  checkOwner();
  if (!subscription) return;
  const { error } = await supabase.from("push_subscriptions").update({
    days: settings.days,
    workout_time: settings.time,
    incomplete_reminder: settings.incompleteReminder,
    incomplete_delay_minutes: settings.incompleteDelayMinutes,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
    enabled: settings.enabled,
    updated_at: new Date().toISOString(),
  }).eq("endpoint", subscription.endpoint).eq("user_id", owner.userId);
  checkOwner();
  if (error) throw error;
}

export async function disableServerPush(owner: StorageOwnerToken = captureStorageOwner()) {
  const checkOwner = () => { if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError(); };
  checkOwner();
  if (!supabase || !serverPushSupportState()) return;
  const registration = await navigator.serviceWorker.ready;
  checkOwner();
  const subscription = await registration.pushManager.getSubscription();
  checkOwner();
  if (!subscription) return;
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", owner.userId);
  checkOwner();
  if (error) throw error;
  await subscription.unsubscribe();
}
