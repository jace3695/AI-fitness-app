"use client";

import { useEffect, useState } from "react";
import { WorkoutDayId } from "../data/workoutCompletion";
import {
  DEFAULT_WORKOUT_NOTIFICATION_SETTINGS,
  notificationSupportState,
  readWorkoutNotificationSettings,
  saveWorkoutNotificationSettings,
  WorkoutNotificationSettings,
} from "../lib/workoutNotifications";

const DAYS: { id: WorkoutDayId; label: string }[] = [
  { id: "mon", label: "월" }, { id: "tue", label: "화" }, { id: "wed", label: "수" },
  { id: "thu", label: "목" }, { id: "fri", label: "금" }, { id: "sat", label: "토" }, { id: "sun", label: "일" },
];

export default function WorkoutNotificationPanel() {
  const [settings, setSettings] = useState<WorkoutNotificationSettings>(DEFAULT_WORKOUT_NOTIFICATION_SETTINGS);
  const [permission, setPermission] = useState<"unsupported" | NotificationPermission>("default");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSettings(readWorkoutNotificationSettings());
    setPermission(notificationSupportState());
  }, []);

  const persist = (next: WorkoutNotificationSettings) => {
    setSettings(next);
    saveWorkoutNotificationSettings(next);
  };

  const enable = async () => {
    if (!("Notification" in window)) return setPermission("unsupported");
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      persist({ ...settings, enabled: true });
      new Notification("운동 알림이 켜졌습니다", { body: `${settings.time}에 운동 계획을 알려드릴게요.` });
      setMessage("알림 권한과 운동 알림을 켰습니다.");
    } else {
      persist({ ...settings, enabled: false });
      setMessage(result === "denied" ? "브라우저 설정에서 알림 권한을 허용해 주세요." : "알림 권한 요청을 취소했습니다.");
    }
  };

  const toggleDay = (day: WorkoutDayId) => {
    const days = settings.days.includes(day) ? settings.days.filter((item) => item !== day) : [...settings.days, day];
    persist({ ...settings, days });
  };

  return <section className="mb-4 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-bold text-[#534AB7]">운동 알림</p><h2 className="mt-1 text-xl font-bold text-gray-900">요일과 시간 알림</h2></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${settings.enabled && permission === "granted" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{settings.enabled && permission === "granted" ? "사용 중" : "꺼짐"}</span></div>
    <p className="mt-2 text-xs leading-relaxed text-gray-500">앱이 열려 있거나 백그라운드에 남아 있을 때 운동 시작과 미완료를 알려드립니다.</p>
    <div className="mt-4 flex flex-wrap gap-2">{DAYS.map((day) => <button key={day.id} type="button" aria-pressed={settings.days.includes(day.id)} onClick={() => toggleDay(day.id)} className={`h-10 w-10 rounded-full text-sm font-bold ${settings.days.includes(day.id) ? "bg-[#534AB7] text-white" : "bg-gray-100 text-gray-500"}`}>{day.label}</button>)}</div>
    <label className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-3 text-sm font-bold text-gray-700">운동 시작 시간<input type="time" value={settings.time} onChange={(event) => { if (event.target.value) persist({ ...settings, time: event.target.value }); }} className="rounded-lg border border-gray-200 bg-white px-3 py-2" /></label>
    <label className="mt-3 flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-3 text-sm font-bold text-gray-700"><input type="checkbox" checked={settings.incompleteReminder} onChange={(event) => persist({ ...settings, incompleteReminder: event.target.checked })} className="h-4 w-4" />운동 미완료 다시 알림<select aria-label="미완료 알림 시간" disabled={!settings.incompleteReminder} value={settings.incompleteDelayMinutes} onChange={(event) => persist({ ...settings, incompleteDelayMinutes: Number(event.target.value) })} className="ml-auto rounded-lg border border-gray-200 bg-white px-2 py-1.5 disabled:opacity-40"><option value={30}>30분 후</option><option value={60}>1시간 후</option><option value={120}>2시간 후</option></select></label>
    {permission === "unsupported" && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">현재 브라우저는 알림을 지원하지 않습니다.</p>}
    {permission === "denied" && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">알림이 차단되어 있습니다. 주소창의 사이트 권한에서 알림을 허용한 뒤 다시 확인해 주세요.</p>}
    {message && <p aria-live="polite" className="mt-3 text-xs font-bold text-[#3C3489]">{message}</p>}
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2"><button type="button" onClick={() => void enable()} disabled={permission === "unsupported"} className="rounded-xl bg-[#534AB7] px-4 py-3 text-sm font-bold text-white disabled:bg-gray-300">{settings.enabled ? "권한 다시 확인" : "알림 켜기"}</button><button type="button" onClick={() => { persist({ ...settings, enabled: false }); setMessage("운동 알림을 껐습니다."); }} className="rounded-xl bg-gray-100 px-4 py-3 text-sm font-bold text-gray-600">알림 끄기</button></div>
    <p className="mt-3 text-[11px] leading-relaxed text-gray-400">브라우저를 완전히 종료한 뒤에도 알림을 받으려면 서버 푸시 기능이 추가로 필요합니다.</p>
  </section>;
}
