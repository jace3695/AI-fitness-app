'use client';

import { useEffect, useMemo, useState } from 'react';
import { SWITCHON_DEFAULT_START_DATE, SWITCHON_START_DATE_KEY } from '../data/workouts';
import {
  COMMON_DIET_RULES,
  DIET_CHECK_ITEMS,
  DIET_COMPLETED_DAYS_KEY,
  DIET_MODE_KEY,
  DIET_PHASE_KEY,
  DIET_PHASE_OPTIONS,
  DIET_PLANS,
  DIET_START_DATE_KEY,
  DINNER_COMPLETED_TIME_KEY,
  DietCheckMap,
  DietMode,
  DietPhaseId,
  FASTING_START_TIME_KEY,
  SAFETY_WARNING,
  WATER_INTAKE_KEY,
  WORKOUT_COMPLETED_DAYS_KEY,
  getAutoDietPhase,
  getDietStatusText,
  getLocalDateKey,
  getSwitchOnDay,
} from '../data/dietPlans';

type MealChecks = Record<string, boolean>;
type DietDayRecord = DietCheckMap & { meals?: MealChecks; safetyAlert?: boolean };
type DietCompletedStore = Record<string, DietDayRecord>;
type WorkoutDayId = 'mon' | 'tue' | 'thu' | 'fri' | 'sat';

const weekdayMap: Record<number, WorkoutDayId | null> = { 0: null, 1: 'mon', 2: 'tue', 3: null, 4: 'thu', 5: 'fri', 6: 'sat' };

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function addHours(dateKey: string, time: string, hours: number) {
  const [hour, minute] = time.split(':').map(Number);
  const base = new Date(`${dateKey}T${String(hour || 0).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}:00`);
  base.setHours(base.getHours() + hours);
  return base;
}

function formatTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function DetailList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <details className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
    <summary className="cursor-pointer text-[12px] font-semibold text-gray-700">{title}</summary>
    <ul className="mt-2 space-y-1 text-[12px] text-gray-600">
      {items.map((item) => <li key={item} className="flex gap-1.5"><span>•</span><span>{item}</span></li>)}
    </ul>
  </details>;
}

export default function DietView() {
  const todayKey = getLocalDateKey();
  const [hydrated, setHydrated] = useState(false);
  const [startDate, setStartDate] = useState(SWITCHON_DEFAULT_START_DATE);
  const [mode, setMode] = useState<DietMode>('auto');
  const [manualPhase, setManualPhase] = useState<DietPhaseId>('adaptation');
  const [store, setStore] = useState<DietCompletedStore>({});
  const [fastingStart, setFastingStart] = useState('18:30');
  const [waterStore, setWaterStore] = useState<Record<string, number>>({});
  const [dinnerStore, setDinnerStore] = useState<Record<string, string>>({});
  const [now, setNow] = useState(new Date());
  const [workoutDone, setWorkoutDone] = useState(false);

  useEffect(() => {
    const existingDietStart = window.localStorage.getItem(DIET_START_DATE_KEY);
    const workoutStart = window.localStorage.getItem(SWITCHON_START_DATE_KEY);
    const initialStart = existingDietStart || workoutStart || SWITCHON_DEFAULT_START_DATE;
    setStartDate(initialStart);
    if (!existingDietStart) window.localStorage.setItem(DIET_START_DATE_KEY, initialStart);
    setMode((window.localStorage.getItem(DIET_MODE_KEY) as DietMode | null) || 'auto');
    setManualPhase((window.localStorage.getItem(DIET_PHASE_KEY) as DietPhaseId | null) || 'adaptation');
    setStore(readJson<DietCompletedStore>(DIET_COMPLETED_DAYS_KEY, {}));
    setFastingStart(window.localStorage.getItem(FASTING_START_TIME_KEY) || '18:30');
    setWaterStore(readJson<Record<string, number>>(WATER_INTAKE_KEY, {}));
    setDinnerStore(readJson<Record<string, string>>(DINNER_COMPLETED_TIME_KEY, {}));
    const workout = readJson<Partial<Record<WorkoutDayId, boolean>>>(WORKOUT_COMPLETED_DAYS_KEY, {});
    const dayId = weekdayMap[new Date().getDay()];
    setWorkoutDone(dayId ? Boolean(workout[dayId]) : false);
    setHydrated(true);
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const switchDay = useMemo(() => getSwitchOnDay(startDate, now), [startDate, now]);
  const currentPhase = mode === 'auto' ? getAutoDietPhase(switchDay) : manualPhase;
  const plan = DIET_PLANS[currentPhase];
  const today = store[todayKey] || {};
  const water = waterStore[todayKey] || 0;
  const fastingEnd = addHours(todayKey, fastingStart, 14);
  const fastingReached = now >= fastingEnd;
  const dinnerTime = dinnerStore[todayKey];
  const checkCount = DIET_CHECK_ITEMS.filter((item) => Boolean(today[item.id])).length + (workoutDone ? 1 : 0);

  const updateStore = (next: DietCompletedStore) => {
    setStore(next);
    window.localStorage.setItem(DIET_COMPLETED_DAYS_KEY, JSON.stringify(next));
  };

  const patchToday = (patch: DietDayRecord) => updateStore({ ...store, [todayKey]: { ...today, ...patch } });
  const toggleCheck = (id: keyof DietCheckMap) => patchToday({ [id]: !today[id] });
  const toggleMeal = (mealId: string) => patchToday({ meals: { ...(today.meals || {}), [mealId]: !today.meals?.[mealId] } });

  const addWater = (ml: number) => {
    const next = { ...waterStore, [todayKey]: Math.max(0, water + ml) };
    setWaterStore(next);
    window.localStorage.setItem(WATER_INTAKE_KEY, JSON.stringify(next));
    if (next[todayKey] >= 2000 && !today.water2l) patchToday({ water2l: true });
  };

  const completeDinner = () => {
    const time = formatTime(new Date());
    const next = { ...dinnerStore, [todayKey]: time };
    setDinnerStore(next);
    window.localStorage.setItem(DINNER_COMPLETED_TIME_KEY, JSON.stringify(next));
    patchToday({ dinnerBefore1830: time <= '18:30' });
  };

  const changeStartDate = (value: string) => {
    setStartDate(value);
    window.localStorage.setItem(DIET_START_DATE_KEY, value);
  };

  const changeMode = (nextMode: DietMode) => {
    setMode(nextMode);
    window.localStorage.setItem(DIET_MODE_KEY, nextMode);
  };

  const changeManualPhase = (phase: DietPhaseId) => {
    setManualPhase(phase);
    window.localStorage.setItem(DIET_PHASE_KEY, phase);
  };

  const changeFastingStart = (value: string) => {
    setFastingStart(value);
    window.localStorage.setItem(FASTING_START_TIME_KEY, value);
  };

  if (!hydrated) return <div className="rounded-2xl bg-white p-4 text-[13px] text-gray-500">식단 정보를 불러오는 중...</div>;

  return <div className="space-y-4">
    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <p className="text-[12px] font-semibold text-[#534AB7]">현재 단계</p>
      <h2 className="mt-1 text-[20px] font-bold text-gray-900">{getDietStatusText(switchDay, currentPhase)}</h2>
      <p className="mt-1 text-[13px] text-gray-500">{plan.description}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => changeMode('auto')} className={`rounded-xl border px-3 py-2 text-[13px] font-semibold ${mode === 'auto' ? 'border-[#AFA9EC] bg-[#EEEDFE] text-[#3C3489]' : 'border-gray-100 bg-gray-50 text-gray-500'}`}>자동</button>
        <button onClick={() => changeMode('manual')} className={`rounded-xl border px-3 py-2 text-[13px] font-semibold ${mode === 'manual' ? 'border-[#AFA9EC] bg-[#EEEDFE] text-[#3C3489]' : 'border-gray-100 bg-gray-50 text-gray-500'}`}>수동</button>
      </div>
      <label className="mt-3 block text-[12px] font-semibold text-gray-600">시작일 변경</label>
      <input type="date" value={startDate} onChange={(e) => changeStartDate(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]" />
      {mode === 'manual' && <select value={manualPhase} onChange={(e) => changeManualPhase(e.target.value as DietPhaseId)} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]">
        {DIET_PHASE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>}
      <p className="mt-2 rounded-xl bg-[#EAF3DE] px-3 py-2 text-[12px] text-[#27500A]">오늘 단계: {plan.label} · {plan.badge}</p>
    </section>

    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <p className="text-[15px] font-bold text-gray-800">공통 식단 기준</p>
      <div className="mt-2 grid gap-1.5 text-[12px] text-gray-600">{COMMON_DIET_RULES.map((rule) => <div key={rule} className="rounded-lg bg-gray-50 px-2.5 py-1.5">✅ {rule}</div>)}</div>
      <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">⚠️ {SAFETY_WARNING}</div>
      <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">24시간 단식은 기본 루틴이 아니라 선택 항목 / 의료진 상담 권장입니다.</div>
    </section>

    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <p className="text-[15px] font-bold text-gray-800">오늘 식단</p>
      <div className="mt-3 space-y-3">{plan.meals.map((meal) => <div key={meal.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
        <label className="flex items-start gap-3"><input type="checkbox" checked={Boolean(today.meals?.[meal.id])} onChange={() => toggleMeal(meal.id)} className="mt-1 h-4 w-4 accent-[#534AB7]" />
          <span><span className="text-[12px] font-bold text-[#534AB7]">{meal.time}</span><span className="ml-2 text-[14px] font-bold text-gray-800">{meal.title}</span></span></label>
        <ul className="mt-2 space-y-1 pl-7 text-[13px] text-gray-600">{meal.items.map((item) => <li key={item}>• {item}</li>)}</ul>
        <div className="mt-2 space-y-2"><DetailList title="선택지" items={meal.options} /><DetailList title="대체 식품" items={meal.alternatives} /></div>
      </div>)}</div>
      <div className="mt-3 space-y-2"><DetailList title="허용 음식" items={plan.allowedFoods} /><DetailList title="주의 음식 / 안내" items={plan.cautionFoods} /><DetailList title="공복 가이드" items={plan.fasting} /></div>
      <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-[12px] text-blue-700">운동 후: {plan.exerciseAfter}</p>
    </section>

    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <p className="text-[15px] font-bold text-gray-800">공복 시간</p>
      <label className="mt-2 block text-[12px] text-gray-500">공복 시작 시간</label>
      <input type="time" value={fastingStart} onChange={(e) => changeFastingStart(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]" />
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]"><div className="rounded-xl bg-gray-50 p-3"><b>예상 종료</b><br />{formatTime(fastingEnd)}</div><div className="rounded-xl bg-gray-50 p-3"><b>현재 상태</b><br />{fastingReached ? '14시간 달성 가능' : '공복 진행 중'}</div></div>
    </section>

    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <p className="text-[15px] font-bold text-gray-800">물 섭취</p>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-gray-100"><div className="h-full bg-[#378ADD]" style={{ width: `${Math.min(100, (water / 2000) * 100)}%` }} /></div>
      <p className="mt-2 text-[13px] text-gray-600">오늘 누적 {water}mL / 2,000mL</p>
      <div className="mt-3 grid grid-cols-3 gap-2"><button onClick={() => addWater(250)} className="rounded-xl bg-blue-50 px-3 py-2 text-[13px] font-semibold text-blue-700">+250mL</button><button onClick={() => addWater(500)} className="rounded-xl bg-blue-50 px-3 py-2 text-[13px] font-semibold text-blue-700">+500mL</button><button onClick={() => addWater(-250)} className="rounded-xl bg-gray-50 px-3 py-2 text-[13px] font-semibold text-gray-500">-250mL</button></div>
    </section>

    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <p className="text-[15px] font-bold text-gray-800">저녁 마감</p>
      <button onClick={completeDinner} className="mt-3 w-full rounded-xl bg-[#534AB7] px-4 py-3 text-[14px] font-bold text-white">저녁 식사 완료</button>
      <p className="mt-2 text-[12px] text-gray-600">완료 시간: {dinnerTime || '미기록'} · 18:30 이전 완료 여부: {today.dinnerBefore1830 ? '달성' : '미달성/미기록'}</p>
      {formatTime(now) > '18:30' && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-700">현재 시간이 18:30 이후입니다. 늦은 식사는 가볍게 하고 내일 점심 탄수화물을 조절하세요.</p>}
    </section>

    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <p className="text-[15px] font-bold text-gray-800">운동·식단 현황 통합</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-gray-700">
        <div className="rounded-xl bg-gray-50 p-3">운동 완료<br /><b>{workoutDone ? '완료' : '미완료/휴식일'}</b></div>
        <div className="rounded-xl bg-gray-50 p-3">체크 완료<br /><b>{checkCount} / {DIET_CHECK_ITEMS.length + 1}</b></div>
        <div className="rounded-xl bg-gray-50 p-3">물 섭취량<br /><b>{water}mL</b></div>
        <div className="rounded-xl bg-gray-50 p-3">공복 목표<br /><b>{fastingReached || today.fasting14h ? '달성 가능/달성' : '진행 중'}</b></div>
      </div>
      <div className="mt-3 space-y-2">{DIET_CHECK_ITEMS.map((item) => <label key={item.id} className="flex items-center gap-2 rounded-xl border border-gray-100 px-3 py-2 text-[13px] text-gray-700"><input type="checkbox" checked={Boolean(today[item.id])} onChange={() => toggleCheck(item.id)} className="h-4 w-4 accent-[#534AB7]" />{item.label}</label>)}
        <label className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[13px] text-gray-500"><input type="checkbox" checked={workoutDone} readOnly className="h-4 w-4" />운동 완료 (운동 탭 기록 자동 표시)</label></div>
    </section>

    <section className="rounded-2xl bg-white border border-red-100 p-4 shadow-sm">
      <button onClick={() => patchToday({ safetyAlert: true })} className="w-full rounded-xl bg-red-600 px-4 py-3 text-[14px] font-bold text-white">두통·어지러움·저림 발생</button>
      {today.safetyAlert && <div className="mt-3 rounded-2xl bg-red-50 p-4 text-[13px] text-red-800"><p className="font-bold">즉시 식단 강도를 완화하고 단식·운동을 중단하세요.</p><p className="mt-1">물과 휴식을 우선하고, 허리 통증 악화 또는 다리 저림이 있으면 운동은 쉬세요. 증상이 심하거나 지속되면 의료진과 상담하세요.</p>{plan.warningAction && <ul className="mt-2 space-y-1">{plan.warningAction.map((item) => <li key={item}>• {item}</li>)}</ul>}</div>}
    </section>
  </div>;
}
