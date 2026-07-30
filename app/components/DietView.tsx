'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_DINNER_CARB_RECORD,
  DEFAULT_LUNCH_CARB_RECORD,
  DEFAULT_LUNCH_PROTEIN_RECORD,
  DEFAULT_MEAL_LOG,
  DIET_COMPLETED_DAYS_KEY,
  DIET_MEAL_LOG_KEY,
  DIET_MODE_KEY,
  DIET_PHASE_KEY,
  DIET_PHASE_OPTIONS,
  DIET_PLANS,
  DIET_START_DATE_KEY,
  DINNER_CARB_CHOICE_KEY,
  DINNER_CARB_OPTIONS,
  DINNER_COMPLETED_TIME_KEY,
  FASTING_START_TIME_KEY,
  FASTING_STATUS_LABELS,
  LUNCH_CARB_CHOICE_KEY,
  LUNCH_PROTEIN_CHOICE_KEY,
  PROTEIN_TARGET_GRAMS,
  PROTEIN_TOTAL_KEY,
  SOCIAL_MEAL_GUIDES,
  SOCIAL_MEAL_MODE_LABELS,
  SOCIAL_MEAL_MODE_KEY,
  WATER_INTAKE_KEY,
  DietMealLog,
  DietMode,
  DietPhaseId,
  DietStatus,
  DinnerCarbRecord,
  FastingRecordStatus,
  LunchCarbRecord,
  LunchProteinRecord,
  ProteinChoice,
  ProteinGramChoice,
  SocialMealMode,
  calculateProteinTotal,
  getAutoDietPhase,
  getDietStatusText,
  getLocalDateKey,
  getProteinStatus,
  getSwitchOnDay,
  normalizeDinnerCarbRecord,
  normalizeLunchCarbRecord,
  normalizeLunchProteinRecord,
  proteinChoiceGrams,
  DIET_STATUS_LABELS,
} from '../data/dietPlans';
import { SWITCHON_DEFAULT_START_DATE, SWITCHON_START_DATE_KEY } from '../data/workouts';

type MealCompletion = {
  breakfast: boolean;
  lunch: boolean;
  afternoon: boolean;
  dinner: boolean;
};

type DietDayRecord = Record<string, unknown> & {
  dietStatus?: DietStatus;
  fastingHours?: number;
  fastingSuccess?: boolean;
  fastingRecordStatus?: FastingRecordStatus;
  dietMemo?: string;
  meals?: Partial<MealCompletion>;
  proteinTotal?: number;
  waterMl?: number;
  lastMealTime?: string;
};

type DietCompletedStore = Record<string, DietDayRecord>;
type NumberStore = Record<string, number>;
type StringStore = Record<string, string>;

const FOOD_PROTEIN_OPTIONS: { value: ProteinGramChoice; label: string }[] = [
  { value: 'none', label: '미기록' },
  { value: '20', label: '20g' },
  { value: '25', label: '25g' },
  { value: '30', label: '30g' },
  { value: 'custom', label: '직접 입력' },
];

const SHAKE_OPTIONS: { value: ProteinChoice; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'half', label: '0.5회 · 16g' },
  { value: 'full', label: '1회 · 31g' },
];

const EMPTY_LUNCH_CARB: LunchCarbRecord = {
  ...DEFAULT_LUNCH_CARB_RECORD,
  amountType: 'none',
  grams: 0,
  estimatedCarbs: 0,
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readCurrentFastingStart(todayKey: string) {
  const raw = window.localStorage.getItem(FASTING_START_TIME_KEY);
  if (!raw) return '';
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      const value = (parsed as Record<string, unknown>)[todayKey];
      return typeof value === 'string' ? value : '';
    }
  } catch {
    return '';
  }
  return '';
}

function addHoursToTime(time: string, hours: number) {
  if (!/^\d{2}:\d{2}$/.test(time)) return '시간 미설정';
  const [hour, minute] = time.split(':').map(Number);
  const rawTotalMinutes = hour * 60 + minute + hours * 60;
  const totalMinutes = rawTotalMinutes % (24 * 60);
  const dayLabel = rawTotalMinutes >= 24 * 60 ? '다음 날' : '당일';
  return `${dayLabel} ${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function getMondayKey(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = monday.getDay();
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
  return getLocalDateKey(monday);
}

function getDateKeysInRange(start: string, end: string) {
  if (!start || !end || end < start) return [];
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const cursor = new Date(startYear, (startMonth || 1) - 1, startDay || 1);
  const finalDate = new Date(endYear, (endMonth || 1) - 1, endDay || 1);
  const dates: string[] = [];
  while (cursor <= finalDate && dates.length < 31) {
    dates.push(getLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function formatScheduleDate(dateKey: string) {
  const [, month, day] = dateKey.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

function getMealCompletion(log: DietMealLog, lunchSupplement: number): MealCompletion {
  return {
    breakfast: log.breakfastShake,
    lunch:
      log.lunchRice ||
      log.lunchProteinChoice !== 'none' ||
      lunchSupplement > 0,
    afternoon: log.afternoonShake !== 'none',
    dinner:
      log.dinnerProteinChoice !== 'none' ||
      log.dinnerCarb !== 'none' ||
      log.afterDinnerShake !== 'none',
  };
}

function choiceButton(active: boolean) {
  return `rounded-xl border px-3 py-2 text-[12px] font-bold transition ${
    active
      ? 'border-[#AFA9EC] bg-[#EEEDFE] text-[#3C3489]'
      : 'border-gray-200 bg-white text-gray-600'
  }`;
}

export default function DietView() {
  const todayKey = getLocalDateKey();
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [startDate, setStartDate] = useState(SWITCHON_DEFAULT_START_DATE);
  const [mode, setMode] = useState<DietMode>('auto');
  const [manualPhase, setManualPhase] = useState<DietPhaseId>('week1');
  const [store, setStore] = useState<DietCompletedStore>({});
  const [mealStore, setMealStore] = useState<Record<string, DietMealLog>>({});
  const [mealLog, setMealLog] = useState<DietMealLog>(DEFAULT_MEAL_LOG);
  const [waterStore, setWaterStore] = useState<NumberStore>({});
  const [water, setWater] = useState(0);
  const [lunchCarbStore, setLunchCarbStore] = useState<Record<string, LunchCarbRecord>>({});
  const [lunchCarb, setLunchCarb] = useState<LunchCarbRecord>(EMPTY_LUNCH_CARB);
  const [dinnerCarbStore, setDinnerCarbStore] = useState<Record<string, DinnerCarbRecord>>({});
  const [dinnerCarb, setDinnerCarb] = useState<DinnerCarbRecord>(DEFAULT_DINNER_CARB_RECORD);
  const [lunchProteinStore, setLunchProteinStore] = useState<Record<string, LunchProteinRecord>>({});
  const [lunchProtein, setLunchProtein] = useState<LunchProteinRecord>(DEFAULT_LUNCH_PROTEIN_RECORD);
  const [dinnerTimeStore, setDinnerTimeStore] = useState<StringStore>({});
  const [socialStore, setSocialStore] = useState<Record<string, SocialMealMode>>({});
  const [socialMeal, setSocialMeal] = useState<SocialMealMode>('none');
  const [travelStart, setTravelStart] = useState(todayKey);
  const [travelEnd, setTravelEnd] = useState(todayKey);
  const [dietStatus, setDietStatus] = useState<DietStatus>('normal');
  const [fastingStatus, setFastingStatus] = useState<FastingRecordStatus>('unrecorded');
  const [lastMealTime, setLastMealTime] = useState('');
  const [dietMemo, setDietMemo] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const existingDietStart = window.localStorage.getItem(DIET_START_DATE_KEY);
    const initialStart =
      existingDietStart ||
      window.localStorage.getItem(SWITCHON_START_DATE_KEY) ||
      SWITCHON_DEFAULT_START_DATE;
    setStartDate(initialStart);
    if (!existingDietStart) window.localStorage.setItem(DIET_START_DATE_KEY, initialStart);

    const oldPhase = window.localStorage.getItem(DIET_PHASE_KEY) as
      | DietPhaseId
      | 'adaptation'
      | null;
    setManualPhase(oldPhase && oldPhase !== 'adaptation' ? oldPhase : 'week1');
    setMode((window.localStorage.getItem(DIET_MODE_KEY) as DietMode | null) || 'auto');

    const savedDiet = readJson<DietCompletedStore>(DIET_COMPLETED_DAYS_KEY, {});
    const savedMeals = readJson<Record<string, DietMealLog>>(DIET_MEAL_LOG_KEY, {});
    const savedWater = readJson<NumberStore>(WATER_INTAKE_KEY, {});
    const savedLunchCarbs = readJson<Record<string, LunchCarbRecord>>(LUNCH_CARB_CHOICE_KEY, {});
    const savedDinnerCarbs = readJson<Record<string, DinnerCarbRecord>>(DINNER_CARB_CHOICE_KEY, {});
    const savedLunchProtein = readJson<Record<string, LunchProteinRecord>>(LUNCH_PROTEIN_CHOICE_KEY, {});
    const savedDinnerTimes = readJson<StringStore>(DINNER_COMPLETED_TIME_KEY, {});
    const savedSocial = readJson<Record<string, SocialMealMode>>(SOCIAL_MEAL_MODE_KEY, {});
    const today = savedDiet[todayKey] || {};
    const todayMeal = savedMeals[todayKey] || DEFAULT_MEAL_LOG;

    setStore(savedDiet);
    setMealStore(savedMeals);
    setMealLog(todayMeal);
    setWaterStore(savedWater);
    setWater(savedWater[todayKey] || Number(today.waterMl) || 0);
    setLunchCarbStore(savedLunchCarbs);
    setLunchCarb(
      savedLunchCarbs[todayKey]
        ? normalizeLunchCarbRecord(savedLunchCarbs[todayKey])
        : EMPTY_LUNCH_CARB,
    );
    setDinnerCarbStore(savedDinnerCarbs);
    setDinnerCarb(normalizeDinnerCarbRecord(savedDinnerCarbs[todayKey] || todayMeal.dinnerCarb));
    setLunchProteinStore(savedLunchProtein);
    setLunchProtein(normalizeLunchProteinRecord(savedLunchProtein[todayKey]));
    setDinnerTimeStore(savedDinnerTimes);
    setSocialStore(savedSocial);
    setSocialMeal(savedSocial[todayKey] || 'none');
    setDietStatus((today.dietStatus as DietStatus | undefined) ?? 'normal');
    setFastingStatus(
      (today.fastingRecordStatus as FastingRecordStatus | undefined) ??
        (today.fasting14h ? '14h' : 'unrecorded'),
    );
    setLastMealTime(
      (typeof today.lastMealTime === 'string' && today.lastMealTime) ||
        savedDinnerTimes[todayKey] ||
        readCurrentFastingStart(todayKey) ||
        (savedMeals[todayKey] ? todayMeal.lastMealTime : '') ||
        '',
    );
    setDietMemo(typeof today.dietMemo === 'string' ? today.dietMemo : '');
    setHydrated(true);

    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, [todayKey]);

  const switchDay = useMemo(() => getSwitchOnDay(startDate, now), [startDate, now]);
  const currentPhase = mode === 'auto' ? getAutoDietPhase(switchDay) : manualPhase;
  const plan = DIET_PLANS[currentPhase];
  const proteinTotal = calculateProteinTotal(mealLog, lunchProtein.protein);
  const proteinStatus = getProteinStatus(proteinTotal);
  const mealCompletion = getMealCompletion(mealLog, lunchProtein.protein);
  const completedMeals = Object.values(mealCompletion).filter(Boolean).length;
  const weekStart = getMondayKey(now);
  const weeklyFastingCount = Object.entries(store).filter(
    ([date, record]) =>
      date >= weekStart &&
      date <= todayKey &&
      (record.fastingRecordStatus === '14h' || record.fasting14h === true),
  ).length;
  const nextMeal12 = addHoursToTime(lastMealTime, 12);
  const nextMeal14 = addHoursToTime(lastMealTime, 14);
  const scheduleGuide = SOCIAL_MEAL_GUIDES[socialMeal];
  const awayLunch = socialMeal === 'lunch' || socialMeal === 'all-day' || socialMeal === 'travel';
  const awayDinner = socialMeal === 'dinner' || socialMeal === 'all-day' || socialMeal === 'travel';
  const upcomingSchedules = Object.entries(socialStore)
    .filter(([date, schedule]) => date >= todayKey && schedule !== 'none')
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 14);

  const updateLunchCarb = (patch: Partial<LunchCarbRecord>) => {
    const next = normalizeLunchCarbRecord({ ...lunchCarb, ...patch });
    setLunchCarb(next);
    setMealLog((current) => ({
      ...current,
      lunchRice: next.amountType !== 'none',
    }));
  };

  const updateDinnerCarb = (patch: Partial<DinnerCarbRecord>) => {
    const next = normalizeDinnerCarbRecord({ ...dinnerCarb, ...patch });
    setDinnerCarb(next);
    setMealLog((current) => ({ ...current, dinnerCarb: next.amountType }));
  };

  const updateLunchProtein = (type: LunchProteinRecord['type'], custom?: number) => {
    setLunchProtein(
      normalizeLunchProteinRecord({
        type,
        customProtein: custom ?? lunchProtein.customProtein,
      }),
    );
  };

  const recordCurrentTime = () => {
    const value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setLastMealTime(value);
    setMealLog((current) => ({ ...current, lastMealTime: value }));
  };

  const selectScheduleMode = (value: SocialMealMode) => {
    setSocialMeal(value);
    setDietStatus(value === 'none' ? 'normal' : 'dining');
    if (value === 'dinner' || value === 'all-day' || value === 'travel') {
      setMealLog((current) => ({ ...current, afterDinnerShake: 'none' }));
    }
    setMessage('');
  };

  const applyTravelSchedule = () => {
    const dates = getDateKeysInRange(travelStart, travelEnd);
    if (!dates.length) {
      setMessage('여행 종료일을 시작일 이후로 선택해주세요.');
      return;
    }
    const nextSocial = { ...socialStore };
    dates.forEach((date) => {
      nextSocial[date] = 'travel';
    });
    setSocialStore(nextSocial);
    writeJson(SOCIAL_MEAL_MODE_KEY, nextSocial);
    if (dates.includes(todayKey)) selectScheduleMode('travel');
    setMessage(
      dates.length === 31 && travelEnd > dates[dates.length - 1]
        ? '여행 일정은 한 번에 최대 31일까지 등록할 수 있습니다.'
        : `${formatScheduleDate(dates[0])}~${formatScheduleDate(dates[dates.length - 1])} 여행 일정을 저장했습니다.`,
    );
  };

  const removePlannedSchedule = (date: string) => {
    const nextSocial = { ...socialStore };
    delete nextSocial[date];
    setSocialStore(nextSocial);
    writeJson(SOCIAL_MEAL_MODE_KEY, nextSocial);
    if (date === todayKey) selectScheduleMode('none');
    setMessage(`${formatScheduleDate(date)} 예외 일정을 삭제했습니다.`);
  };

  const saveDiet = () => {
    const fastingHours = fastingStatus === '14h' ? 14 : fastingStatus === '12h' ? 12 : 0;
    const previousToday = store[todayKey] || {};
    const nextDiet: DietCompletedStore = {
      ...store,
      [todayKey]: {
        ...previousToday,
        dietStatus,
        fastingRecordStatus: fastingStatus,
        fastingHours,
        fastingSuccess: fastingStatus === '14h',
        fasting14h: fastingStatus === '14h',
        meals: mealCompletion,
        proteinTotal,
        proteinDone: proteinTotal >= 100,
        lunchProtein:
          mealLog.lunchProteinChoice !== 'none' || lunchProtein.protein > 0,
        noDinnerCarbs:
          dinnerCarb.amountType === 'none' ||
          (dinnerCarb.grams >= 50 && dinnerCarb.grams <= 80),
        water2l: water >= 2000,
        waterMl: water,
        dinnerBefore1830: Boolean(lastMealTime) && lastMealTime <= '18:30',
        lastMealTime,
        socialMeal,
        dietMemo: dietMemo.trim() || undefined,
      },
    };
    const nextMeals = {
      ...mealStore,
      [todayKey]: { ...mealLog, lastMealTime },
    };
    const nextWater = { ...waterStore, [todayKey]: water };
    const nextLunchCarbs = { ...lunchCarbStore, [todayKey]: lunchCarb };
    const nextDinnerCarbs = { ...dinnerCarbStore, [todayKey]: dinnerCarb };
    const nextLunchProteins = { ...lunchProteinStore, [todayKey]: lunchProtein };
    const nextDinnerTimes = { ...dinnerTimeStore, [todayKey]: lastMealTime };
    const nextSocial = { ...socialStore, [todayKey]: socialMeal };

    setStore(nextDiet);
    setMealStore(nextMeals);
    setWaterStore(nextWater);
    setLunchCarbStore(nextLunchCarbs);
    setDinnerCarbStore(nextDinnerCarbs);
    setLunchProteinStore(nextLunchProteins);
    setDinnerTimeStore(nextDinnerTimes);
    setSocialStore(nextSocial);
    writeJson(DIET_COMPLETED_DAYS_KEY, nextDiet);
    writeJson(DIET_MEAL_LOG_KEY, nextMeals);
    writeJson(PROTEIN_TOTAL_KEY, {
      ...readJson<NumberStore>(PROTEIN_TOTAL_KEY, {}),
      [todayKey]: proteinTotal,
    });
    writeJson(WATER_INTAKE_KEY, nextWater);
    writeJson(LUNCH_CARB_CHOICE_KEY, nextLunchCarbs);
    writeJson(DINNER_CARB_CHOICE_KEY, nextDinnerCarbs);
    writeJson(LUNCH_PROTEIN_CHOICE_KEY, nextLunchProteins);
    writeJson(DINNER_COMPLETED_TIME_KEY, nextDinnerTimes);
    writeJson(SOCIAL_MEAL_MODE_KEY, nextSocial);
    window.localStorage.setItem(FASTING_START_TIME_KEY, lastMealTime);
    setMessage('오늘 식단 기록을 저장했습니다.');
  };

  const resetDiet = () => {
    const nextDiet = { ...store };
    const nextMeals = { ...mealStore };
    const nextWater = { ...waterStore };
    const nextLunchCarbs = { ...lunchCarbStore };
    const nextDinnerCarbs = { ...dinnerCarbStore };
    const nextLunchProteins = { ...lunchProteinStore };
    const nextDinnerTimes = { ...dinnerTimeStore };
    const nextSocial = { ...socialStore };
    const nextProteinTotals = readJson<NumberStore>(PROTEIN_TOTAL_KEY, {});

    delete nextDiet[todayKey];
    delete nextMeals[todayKey];
    delete nextWater[todayKey];
    delete nextLunchCarbs[todayKey];
    delete nextDinnerCarbs[todayKey];
    delete nextLunchProteins[todayKey];
    delete nextDinnerTimes[todayKey];
    delete nextSocial[todayKey];
    delete nextProteinTotals[todayKey];

    setStore(nextDiet);
    setMealStore(nextMeals);
    setMealLog(DEFAULT_MEAL_LOG);
    setWaterStore(nextWater);
    setWater(0);
    setLunchCarbStore(nextLunchCarbs);
    setLunchCarb(EMPTY_LUNCH_CARB);
    setDinnerCarbStore(nextDinnerCarbs);
    setDinnerCarb(DEFAULT_DINNER_CARB_RECORD);
    setLunchProteinStore(nextLunchProteins);
    setLunchProtein(DEFAULT_LUNCH_PROTEIN_RECORD);
    setDinnerTimeStore(nextDinnerTimes);
    setSocialStore(nextSocial);
    setSocialMeal('none');
    setDietStatus('normal');
    setFastingStatus('unrecorded');
    setLastMealTime('');
    setDietMemo('');

    writeJson(DIET_COMPLETED_DAYS_KEY, nextDiet);
    writeJson(DIET_MEAL_LOG_KEY, nextMeals);
    writeJson(PROTEIN_TOTAL_KEY, nextProteinTotals);
    writeJson(WATER_INTAKE_KEY, nextWater);
    writeJson(LUNCH_CARB_CHOICE_KEY, nextLunchCarbs);
    writeJson(DINNER_CARB_CHOICE_KEY, nextDinnerCarbs);
    writeJson(LUNCH_PROTEIN_CHOICE_KEY, nextLunchProteins);
    writeJson(DINNER_COMPLETED_TIME_KEY, nextDinnerTimes);
    writeJson(SOCIAL_MEAL_MODE_KEY, nextSocial);
    window.localStorage.removeItem(FASTING_START_TIME_KEY);
    setMessage('오늘 식단 기록을 초기화했습니다.');
  };

  if (!hydrated) {
    return (
      <div className="rounded-2xl bg-white p-4 text-[13px] text-gray-500">
        식단 정보를 불러오는 중...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#534AB7] to-[#7B73D4] p-5 text-white shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold text-white/75">오늘의 식단</p>
            <h2 className="mt-1 text-[22px] font-bold">
              {getDietStatusText(switchDay, currentPhase)}
            </h2>
            <p className="mt-1 text-[12px] text-white/80">
              14시간 공복 주 5일 이상 · 컨디션 저하 시 12시간 조절
            </p>
          </div>
          <span className="rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-bold">
            이번 주 {weeklyFastingCount}/5일
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['단백질', `${proteinTotal} / ${PROTEIN_TARGET_GRAMS}g`],
            ['물', `${water.toLocaleString()} / 2,000mL`],
            ['식사 기록', `${completedMeals} / 4`],
            ['14시간 종료', nextMeal14],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-white/12 p-3 backdrop-blur">
              <p className="text-[11px] text-white/70">{label}</p>
              <p className="mt-1 text-[15px] font-bold">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[#D9D6F5] bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold text-[#534AB7]">오늘 식사 일정</p>
            <h3 className="mt-1 text-[17px] font-bold text-gray-900">
              일정에 맞춰 식단 기준을 바꾸세요
            </h3>
            <p className="mt-1 text-[12px] text-gray-500">
              외식이나 여행은 실패가 아니라 별도의 관리 방식으로 기록됩니다.
            </p>
          </div>
          <span className="rounded-full bg-[#EEEDFE] px-3 py-1.5 text-[11px] font-bold text-[#3C3489]">
            {SOCIAL_MEAL_MODE_LABELS[socialMeal]}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(Object.entries(SOCIAL_MEAL_MODE_LABELS) as [SocialMealMode, string][]).map(
            ([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => selectScheduleMode(id)}
                className={`${choiceButton(socialMeal === id)} min-h-12`}
              >
                {label}
              </button>
            ),
          )}
        </div>

        <div className="mt-4 rounded-2xl bg-[#F7F6FF] p-4">
          <p className="text-[13px] font-bold text-[#3C3489]">{scheduleGuide.summary}</p>
          <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-gray-600">
            {scheduleGuide.goals.map((goal) => (
              <li key={goal}>• {goal}</li>
            ))}
          </ul>
        </div>

        {socialMeal === 'travel' && (
          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
            <p className="text-[13px] font-bold text-blue-900">여행 기간 한 번에 등록</p>
            <p className="mt-1 text-[11px] text-blue-700">
              선택한 기간은 기기 간 동기화되며, 각 날짜에 여행 식단 기준이 표시됩니다.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <label className="text-[11px] font-bold text-blue-900">
                시작일
                <input
                  type="date"
                  value={travelStart}
                  onChange={(event) => setTravelStart(event.target.value)}
                  className="mt-1 block w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-[13px] text-gray-800"
                />
              </label>
              <label className="text-[11px] font-bold text-blue-900">
                종료일
                <input
                  type="date"
                  min={travelStart}
                  value={travelEnd}
                  onChange={(event) => setTravelEnd(event.target.value)}
                  className="mt-1 block w-full rounded-xl border border-blue-100 bg-white px-3 py-2 text-[13px] text-gray-800"
                />
              </label>
              <button
                type="button"
                onClick={applyTravelSchedule}
                className="self-end rounded-xl bg-blue-700 px-4 py-2.5 text-[12px] font-bold text-white"
              >
                여행 기간 적용
              </button>
            </div>
          </div>
        )}

        {upcomingSchedules.length > 0 && (
          <details className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-3">
            <summary className="cursor-pointer text-[12px] font-bold text-gray-700">
              예정된 외식·여행 {upcomingSchedules.length}일
            </summary>
            <div className="mt-3 space-y-2">
              {upcomingSchedules.map(([date, schedule]) => (
                <div
                  key={date}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2"
                >
                  <div>
                    <p className="text-[12px] font-bold text-gray-800">
                      {formatScheduleDate(date)}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {SOCIAL_MEAL_MODE_LABELS[schedule]}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePlannedSchedule(date)}
                    className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-600"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-bold text-gray-900">오늘 식사 기록</h3>
                <p className="mt-1 text-[12px] text-gray-500">
                  실제로 먹은 항목만 선택하면 단백질 합계에 반영됩니다.
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${proteinStatus.bg} ${proteinStatus.color}`}>
                {proteinStatus.label}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              <article className="rounded-2xl bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-bold text-gray-900">아침</p>
                    <p className="text-[11px] text-gray-500">퓨어프로틴7 1회 기준</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setMealLog((current) => ({
                        ...current,
                        breakfastShake: !current.breakfastShake,
                      }))
                    }
                    className={choiceButton(mealLog.breakfastShake)}
                  >
                    {mealLog.breakfastShake ? '섭취 · 31g' : '미섭취'}
                  </button>
                </div>
              </article>

              <article className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[14px] font-bold text-gray-900">점심</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  {awayLunch
                    ? '식당 식사 · 정확한 무게를 몰라도 가장 가까운 양으로 기록'
                    : '통곡물밥 100~130g + 실제 식품 단백질 20g 이상'}
                </p>
                <div className="mt-3">
                  <p className="text-[11px] font-bold text-gray-600">밥량 · 조리 후 무게</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DINNER_CARB_OPTIONS.filter((option) =>
                      ['none', '100', 'two-third-bowl', 'custom'].includes(option.id),
                    ).map((option) => (
                      <button
                        key={`lunch-${option.id}`}
                        type="button"
                        onClick={() => updateLunchCarb({ amountType: option.id })}
                        className={choiceButton(lunchCarb.amountType === option.id)}
                      >
                        {option.id === 'two-third-bowl' ? '130g' : option.label}
                      </button>
                    ))}
                  </div>
                  {lunchCarb.amountType === 'custom' && (
                    <label className="mt-2 flex items-center gap-2 text-[12px] text-gray-600">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={lunchCarb.grams || ''}
                        onChange={(event) =>
                          updateLunchCarb({ grams: Math.max(0, Number(event.target.value) || 0) })
                        }
                        className="w-28 rounded-xl border border-gray-200 bg-white px-3 py-2"
                        aria-label="점심 밥량"
                      />
                      g
                    </label>
                  )}
                </div>
                <div className="mt-3">
                  <label className="text-[11px] font-bold text-gray-600" htmlFor="lunch-food-protein">
                    식품 단백질
                  </label>
                  <select
                    id="lunch-food-protein"
                    value={mealLog.lunchProteinChoice}
                    onChange={(event) =>
                      setMealLog((current) => ({
                        ...current,
                        lunchProteinChoice: event.target.value as ProteinGramChoice,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px]"
                  >
                    {FOOD_PROTEIN_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {mealLog.lunchProteinChoice === 'custom' && (
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={mealLog.lunchProteinCustom || ''}
                      onChange={(event) =>
                        setMealLog((current) => ({
                          ...current,
                          lunchProteinCustom: Math.max(0, Number(event.target.value) || 0),
                        }))
                      }
                      className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px]"
                      placeholder="단백질 g"
                      aria-label="점심 식품 단백질 직접 입력"
                    />
                  )}
                </div>
                <div className="mt-3">
                  <p className="text-[11px] font-bold text-gray-600">부족할 때 프로틴 보충</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      ['none', '없음'],
                      ['half', '0.5회 · 16g'],
                      ['full', '1회 · 31g'],
                      ['custom', '직접 입력'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateLunchProtein(value as LunchProteinRecord['type'])}
                        className={choiceButton(lunchProtein.type === value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {lunchProtein.type === 'custom' && (
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={lunchProtein.customProtein || ''}
                      onChange={(event) =>
                        updateLunchProtein('custom', Math.max(0, Number(event.target.value) || 0))
                      }
                      className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px]"
                      placeholder="단백질 g"
                      aria-label="점심 프로틴 단백질 직접 입력"
                    />
                  )}
                </div>
              </article>

              <article className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[14px] font-bold text-gray-900">오후 보충</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SHAKE_OPTIONS.map((option) => (
                    <button
                      key={`afternoon-${option.value}`}
                      type="button"
                      onClick={() =>
                        setMealLog((current) => ({
                          ...current,
                          afternoonShake: option.value,
                        }))
                      }
                      className={choiceButton(mealLog.afternoonShake === option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl bg-gray-50 p-4">
                <p className="text-[14px] font-bold text-gray-900">저녁</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  {awayDinner
                    ? '외식·약속 식사 · 단백질과 채소를 먼저, 밥·면은 먹은 만큼 기록'
                    : '단백질 20g 이상 + 채소 · 밥은 기본 제외'}
                </p>
                <label className="mt-3 block text-[11px] font-bold text-gray-600" htmlFor="dinner-food-protein">
                  식품 단백질
                </label>
                <select
                  id="dinner-food-protein"
                  value={mealLog.dinnerProteinChoice}
                  onChange={(event) =>
                    setMealLog((current) => ({
                      ...current,
                      dinnerProteinChoice: event.target.value as ProteinGramChoice,
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px]"
                >
                  {FOOD_PROTEIN_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {mealLog.dinnerProteinChoice === 'custom' && (
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={mealLog.dinnerProteinCustom || ''}
                    onChange={(event) =>
                      setMealLog((current) => ({
                        ...current,
                        dinnerProteinCustom: Math.max(0, Number(event.target.value) || 0),
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px]"
                    placeholder="단백질 g"
                    aria-label="저녁 식품 단백질 직접 입력"
                  />
                )}
                <p className="mt-3 text-[11px] font-bold text-gray-600">밥량 · 필요할 때만</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DINNER_CARB_OPTIONS.filter((option) =>
                    ['none', '50', '80', '100', 'custom'].includes(option.id),
                  ).map((option) => (
                    <button
                      key={`dinner-${option.id}`}
                      type="button"
                      onClick={() => updateDinnerCarb({ amountType: option.id })}
                      className={choiceButton(dinnerCarb.amountType === option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {dinnerCarb.amountType === 'custom' && (
                  <label className="mt-2 flex items-center gap-2 text-[12px] text-gray-600">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={dinnerCarb.grams || ''}
                      onChange={(event) =>
                        updateDinnerCarb({ grams: Math.max(0, Number(event.target.value) || 0) })
                      }
                      className="w-28 rounded-xl border border-gray-200 bg-white px-3 py-2"
                      aria-label="저녁 밥량"
                    />
                    g
                  </label>
                )}
                <p className="mt-3 text-[11px] font-bold text-gray-600">저녁 후 프로틴</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SHAKE_OPTIONS.map((option) => (
                    <button
                      key={`after-dinner-${option.value}`}
                      type="button"
                      onClick={() =>
                        setMealLog((current) => ({
                          ...current,
                          afterDinnerShake: option.value,
                        }))
                      }
                      className={choiceButton(mealLog.afterDinnerShake === option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">
                  늦은 시간·속쓰림·회식 후에는 추가 프로틴을 생략합니다.
                </p>
              </article>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="text-[15px] font-bold text-gray-900">단백질 합계</h3>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="text-[28px] font-bold text-gray-900">{proteinTotal}g</p>
              <p className="text-[12px] text-gray-500">목표 {PROTEIN_TARGET_GRAMS}g</p>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-[#534AB7] transition-all"
                style={{ width: `${Math.min(100, (proteinTotal / PROTEIN_TARGET_GRAMS) * 100)}%` }}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="text-[15px] font-bold text-gray-900">물 섭취</h3>
            <p className="mt-2 text-[20px] font-bold text-blue-700">
              {water.toLocaleString()}mL
            </p>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(100, (water / 2000) * 100)}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[250, 500, -250].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setWater((current) => Math.max(0, current + amount))}
                  className={`rounded-xl px-2 py-2 text-[12px] font-bold ${
                    amount > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-500'
                  }`}
                >
                  {amount > 0 ? '+' : ''}
                  {amount}mL
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="text-[15px] font-bold text-gray-900">공복 기록</h3>
            <label className="mt-3 block text-[11px] font-bold text-gray-600" htmlFor="last-meal-time">
              마지막 음식·프로틴 섭취시간
            </label>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <input
                id="last-meal-time"
                type="time"
                value={lastMealTime}
                onChange={(event) => setLastMealTime(event.target.value)}
                className="min-w-0 rounded-xl border border-gray-200 px-3 py-2 text-[13px]"
              />
              <button
                type="button"
                onClick={recordCurrentTime}
                className="rounded-xl bg-gray-100 px-3 py-2 text-[12px] font-bold text-gray-700"
              >
                지금
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-xl bg-amber-50 p-3 text-amber-800">
                <p className="text-[10px] font-bold">12시간 조절</p>
                <p className="mt-1 text-[15px] font-bold">{nextMeal12}</p>
              </div>
              <div className="rounded-xl bg-green-50 p-3 text-green-800">
                <p className="text-[10px] font-bold">14시간 달성</p>
                <p className="mt-1 text-[15px] font-bold">{nextMeal14}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(FASTING_STATUS_LABELS).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFastingStatus(id as FastingRecordStatus)}
                  className={choiceButton(fastingStatus === id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-[11px] font-semibold text-blue-800">
              24시간 단식은 계획에 포함하지 않습니다. 속쓰림·어지럼·손떨림·컨디션 저하가 있으면 12시간으로 조절하세요.
            </p>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="text-[15px] font-bold text-gray-900">오늘 상태</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(DIET_STATUS_LABELS).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDietStatus(id as DietStatus)}
                  className={choiceButton(dietStatus === id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-[#F7F6FF] px-3 py-2">
              <p className="text-[10px] font-bold text-[#534AB7]">적용 중인 식사 일정</p>
              <p className="mt-1 text-[13px] font-bold text-[#3C3489]">
                {SOCIAL_MEAL_MODE_LABELS[socialMeal]}
              </p>
            </div>
            <label className="mt-4 block text-[11px] font-bold text-gray-600" htmlFor="diet-memo">
              메모
            </label>
            <textarea
              id="diet-memo"
              value={dietMemo}
              onChange={(event) => setDietMemo(event.target.value)}
              placeholder="속쓰림, 허기, 회식 등 특이사항"
              className="mt-2 min-h-24 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px]"
            />
          </section>
        </aside>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-[13px] font-bold text-gray-900">{plan.description}</p>
            <p className="mt-1 text-[11px] text-gray-500">
              입력값은 오늘 날짜의 기존 식단·달력 기록과 함께 저장됩니다.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={saveDiet}
              className="rounded-xl bg-[#534AB7] px-6 py-3 text-[14px] font-bold text-white"
            >
              오늘 식단 저장
            </button>
            <button
              type="button"
              onClick={resetDiet}
              className="rounded-xl bg-red-50 px-5 py-3 text-[14px] font-bold text-red-600"
            >
              오늘 기록 초기화
            </button>
          </div>
        </div>
        {message && (
          <p role="status" className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-[12px] font-semibold text-green-700">
            {message}
          </p>
        )}
      </section>

      <details className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-[13px] font-bold text-gray-700">
          식단 단계 설정
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setMode('auto');
              window.localStorage.setItem(DIET_MODE_KEY, 'auto');
            }}
            className={choiceButton(mode === 'auto')}
          >
            시작일 기준 자동
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('manual');
              window.localStorage.setItem(DIET_MODE_KEY, 'manual');
            }}
            className={choiceButton(mode === 'manual')}
          >
            단계 직접 선택
          </button>
          <input
            type="date"
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
              window.localStorage.setItem(DIET_START_DATE_KEY, event.target.value);
            }}
            className="rounded-xl border border-gray-200 px-3 py-2 text-[13px]"
            aria-label="식단 시작일"
          />
          {mode === 'manual' && (
            <select
              value={manualPhase}
              onChange={(event) => {
                setManualPhase(event.target.value as DietPhaseId);
                window.localStorage.setItem(DIET_PHASE_KEY, event.target.value);
              }}
              className="rounded-xl border border-gray-200 px-3 py-2 text-[13px]"
              aria-label="식단 단계"
            >
              {DIET_PHASE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </details>
    </div>
  );
}
