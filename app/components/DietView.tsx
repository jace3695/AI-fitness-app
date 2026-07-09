'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DIET_COMPLETED_DAYS_KEY,
  DIET_MODE_KEY,
  DIET_PHASE_KEY,
  DIET_PHASE_OPTIONS,
  DIET_PLANS,
  DIET_START_DATE_KEY,
  DietMode,
  DietPhaseId,
  DietStatus,
  FASTING_STATUS_LABELS,
  FastingRecordStatus,
  getAutoDietPhase,
  getDietStatusText,
  getLocalDateKey,
  getSwitchOnDay,
  DIET_STATUS_LABELS,
  simpleDietRecommendations,
} from '../data/dietPlans';
import { SWITCHON_DEFAULT_START_DATE, SWITCHON_START_DATE_KEY } from '../data/workouts';

type DietDayRecord = Record<string, unknown> & {
  dietStatus?: DietStatus;
  fastingHours?: number;
  fastingSuccess?: boolean;
  fastingRecordStatus?: FastingRecordStatus;
  dietMemo?: string;
};
type DietCompletedStore = Record<string, DietDayRecord>;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
function writeJson<T>(key: string, value: T) { window.localStorage.setItem(key, JSON.stringify(value)); }

export default function DietView() {
  const todayKey = getLocalDateKey();
  const [hydrated, setHydrated] = useState(false);
  const [startDate, setStartDate] = useState(SWITCHON_DEFAULT_START_DATE);
  const [mode, setMode] = useState<DietMode>('auto');
  const [manualPhase, setManualPhase] = useState<DietPhaseId>('week1');
  const [store, setStore] = useState<DietCompletedStore>({});
  const [dietStatus, setDietStatus] = useState<DietStatus>('normal');
  const [fastingStatus, setFastingStatus] = useState<FastingRecordStatus>('14h');
  const [dietMemo, setDietMemo] = useState('');
  const [message, setMessage] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    const existingDietStart = window.localStorage.getItem(DIET_START_DATE_KEY);
    const initialStart = existingDietStart || window.localStorage.getItem(SWITCHON_START_DATE_KEY) || SWITCHON_DEFAULT_START_DATE;
    setStartDate(initialStart);
    if (!existingDietStart) window.localStorage.setItem(DIET_START_DATE_KEY, initialStart);
    const oldPhase = window.localStorage.getItem(DIET_PHASE_KEY) as DietPhaseId | 'adaptation' | null;
    setManualPhase(oldPhase && oldPhase !== 'adaptation' ? oldPhase : 'week1');
    setMode((window.localStorage.getItem(DIET_MODE_KEY) as DietMode | null) || 'auto');
    const savedStore = readJson<DietCompletedStore>(DIET_COMPLETED_DAYS_KEY, {});
    setStore(savedStore);
    const today = savedStore[todayKey] || {};
    setDietStatus(today.dietStatus ?? 'normal');
    setFastingStatus(today.fastingRecordStatus ?? (today.fasting14h ? '14h' : '14h'));
    setDietMemo(today.dietMemo ?? '');
    setHydrated(true);
  }, [todayKey]);

  const switchDay = getSwitchOnDay(startDate, now);
  const currentPhase = mode === 'auto' ? getAutoDietPhase(switchDay) : manualPhase;
  const plan = DIET_PLANS[currentPhase];
  const today = store[todayKey] || {};

  const saveDiet = () => {
    const fastingHours = fastingStatus === '14h' ? 14 : fastingStatus === '12h' ? 12 : 0;
    const fastingSuccess = fastingStatus === '14h';
    const next = {
      ...store,
      [todayKey]: {
        ...today,
        dietStatus,
        fastingRecordStatus: fastingStatus,
        fastingHours,
        fastingSuccess,
        fasting14h: fastingStatus === '14h',
        safetyAlert: today.safetyAlert,
        dietMemo: dietMemo.trim() || undefined,
      },
    };
    setStore(next);
    writeJson(DIET_COMPLETED_DAYS_KEY, next);
    setMessage('식단 기록을 저장했습니다.');
  };

  const cancelDiet = () => {
    const nextRecord = { ...today };
    delete nextRecord.dietStatus;
    delete nextRecord.fastingRecordStatus;
    delete nextRecord.fastingHours;
    delete nextRecord.fastingSuccess;
    delete nextRecord.fasting14h;
    delete nextRecord.dietMemo;
    const next = { ...store, [todayKey]: nextRecord };
    setStore(next);
    writeJson(DIET_COMPLETED_DAYS_KEY, next);
    setDietStatus('normal');
    setFastingStatus('14h');
    setDietMemo('');
    setMessage('식단 기록을 취소했습니다.');
  };

  if (!hydrated) return <div className="rounded-2xl bg-white p-4 text-[13px] text-gray-500">식단 정보를 불러오는 중...</div>;

  return <div className="space-y-4">
    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <p className="text-[12px] font-semibold text-[#534AB7]">오늘 단계 카드</p>
      <h2 className="mt-1 text-[20px] font-bold text-gray-900">{getDietStatusText(switchDay, currentPhase)}</h2>
      <p className="mt-2 rounded-xl bg-[#EAF3DE] px-3 py-2 text-[12px] text-[#27500A]">{plan.description}</p>
      <p className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-800">이번 주 목표는 14시간 공복 5일 이상입니다. 컨디션이 좋지 않은 날은 12시간 공복으로 조절해도 됩니다. 24시간 단식은 현재 계획에서 제외합니다.</p>
      <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => { setMode('auto'); window.localStorage.setItem(DIET_MODE_KEY, 'auto'); }} className={`rounded-xl border px-3 py-2 text-[13px] font-semibold ${mode === 'auto' ? 'border-[#AFA9EC] bg-[#EEEDFE] text-[#3C3489]' : 'border-gray-100 bg-gray-50 text-gray-500'}`}>자동</button><button onClick={() => { setMode('manual'); window.localStorage.setItem(DIET_MODE_KEY, 'manual'); }} className={`rounded-xl border px-3 py-2 text-[13px] font-semibold ${mode === 'manual' ? 'border-[#AFA9EC] bg-[#EEEDFE] text-[#3C3489]' : 'border-gray-100 bg-gray-50 text-gray-500'}`}>수동</button></div>
      <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); window.localStorage.setItem(DIET_START_DATE_KEY, e.target.value); }} className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]" />
      {mode === 'manual' && <select value={manualPhase} onChange={(e) => { setManualPhase(e.target.value as DietPhaseId); window.localStorage.setItem(DIET_PHASE_KEY, e.target.value); }} className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]">{DIET_PHASE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
    </section>

    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <p className="text-[15px] font-bold text-gray-800">오늘 추천 식단 보기</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{simpleDietRecommendations.map((rec) => <article key={rec.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-3"><h3 className="text-[14px] font-bold text-gray-900">{rec.title}</h3><ul className="mt-2 space-y-1 text-[12px] text-gray-600">{rec.items.map((item) => <li key={item}>- {item}</li>)}</ul></article>)}</div>
    </section>

    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <p className="text-[15px] font-bold text-gray-800">오늘 식단 기록</p>
      <div className="mt-3"><p className="text-[12px] font-bold text-gray-600">식단 상태</p><div className="mt-2 flex flex-wrap gap-2">{Object.entries(DIET_STATUS_LABELS).map(([id, label]) => <button key={id} type="button" onClick={() => setDietStatus(id as DietStatus)} className={`rounded-full border px-3 py-2 text-[12px] font-bold ${dietStatus === id ? 'border-[#AFA9EC] bg-[#EEEDFE] text-[#3C3489]' : 'border-gray-200 bg-white text-gray-600'}`}>{label}</button>)}</div></div>
      <div className="mt-4"><p className="text-[12px] font-bold text-gray-600">공복</p><div className="mt-2 flex flex-wrap gap-2">{Object.entries(FASTING_STATUS_LABELS).map(([id, label]) => <button key={id} type="button" onClick={() => setFastingStatus(id as FastingRecordStatus)} className={`rounded-full border px-3 py-2 text-[12px] font-bold ${fastingStatus === id ? 'border-[#AFA9EC] bg-[#EEEDFE] text-[#3C3489]' : 'border-gray-200 bg-white text-gray-600'}`}>{label}</button>)}</div></div>
      <label className="mt-4 block text-[12px] font-bold text-gray-600">메모<textarea value={dietMemo} onChange={(e) => setDietMemo(e.target.value)} placeholder="오늘 식단 특이사항 입력" className="mt-2 min-h-24 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px] font-normal" /></label>
      <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={saveDiet} className="rounded-xl bg-[#534AB7] px-4 py-3 text-[14px] font-bold text-white">식단 기록 저장</button><button onClick={cancelDiet} className="rounded-xl bg-red-50 px-4 py-3 text-[14px] font-bold text-red-600">식단 기록 취소</button></div>
      {message && <p className="mt-2 rounded-xl bg-green-50 px-3 py-2 text-[12px] font-semibold text-green-700">{message}</p>}
    </section>

    <section className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      <button type="button" onClick={() => setShowDetails(!showDetails)} className="w-full rounded-xl bg-gray-50 px-3 py-2 text-[13px] font-bold text-gray-700">{showDetails ? '상세 기록 닫기' : '상세 기록 열기'}</button>
      {showDetails && <div className="mt-3 rounded-xl bg-gray-50 p-3 text-[12px] text-gray-600"><p>기존 세부 체크는 빠른 기록 흐름을 위해 기본 화면에서 숨겼습니다.</p><p className="mt-1">저장된 기존 localStorage 기록은 유지되며, 달력에서 과거 기록 확인이 가능합니다.</p></div>}
    </section>
  </div>;
}
