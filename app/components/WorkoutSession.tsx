'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Exercise } from '../data/workouts';
import { ExerciseRecord, getPreviousExerciseRecord, readWorkoutCompletionStore, WorkoutDifficulty, WorkoutOverallStatus } from '../data/workoutCompletion';
import { getExerciseRecommendation, WorkoutIntensity } from '../data/workoutRecommendations';
import ExerciseGuidePanel, { getExerciseVideoHref, getExerciseVideoLabel } from './ExerciseGuidePanel';
import ExerciseRecordEditor from './ExerciseRecordEditor';
import { IntervalTimer } from './WorkoutControls';

type SessionMode = 'exercise' | 'setRest' | 'rest' | 'pain' | 'summary';

interface WorkoutSessionDraft {
  version: 1;
  exerciseSignature: string;
  savedAt: number;
  currentIndex: number;
  mode: SessionMode;
  completed: number[];
  skipped: number[];
  elapsedSeconds: number;
  timerSeconds: number;
  restSeconds: number;
  painScore: number;
  painSymptoms: string[];
  painMemo: string;
  overallStatus: WorkoutOverallStatus;
  difficulty: WorkoutDifficulty;
  fatigue: number;
  exerciseRecords: ExerciseRecord[];
}

export interface WorkoutSessionResult {
  pain: boolean;
  memo: string;
  exerciseRecords: ExerciseRecord[];
  status: WorkoutOverallStatus;
  difficulty: WorkoutDifficulty;
  fatigue: number;
}

const PAIN_SYMPTOMS = ['허리 통증', '다리 저림', '무릎 통증', '어지러움', '메스꺼움', '식은땀', '기타'];
const SESSION_DRAFT_KEY_PREFIX = 'ai-fitness-workout-session-draft';

function getSessionDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getExerciseSignature(exercises: Exercise[]) {
  return exercises.map((exercise) => exercise.name).join('|');
}

function getSessionDraftKey(exerciseSignature: string) {
  let hash = 0;
  for (let index = 0; index < exerciseSignature.length; index += 1) {
    hash = ((hash << 5) - hash + exerciseSignature.charCodeAt(index)) | 0;
  }
  return `${SESSION_DRAFT_KEY_PREFIX}:${getSessionDateKey()}:${Math.abs(hash)}`;
}

function readSessionDraft(key: string, exerciseSignature: string, exerciseCount: number) {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || 'null') as WorkoutSessionDraft | null;
    if (!parsed || parsed.version !== 1 || parsed.exerciseSignature !== exerciseSignature) return null;
    if (parsed.currentIndex < 0 || parsed.currentIndex >= exerciseCount || !Array.isArray(parsed.exerciseRecords)) return null;
    return parsed;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function getExerciseSeconds(exercise: Exercise) {
  const text = `${exercise.meta || ''} ${exercise.guide?.duration || ''}`;
  const minutes = text.match(/(\d+)(?:\s*~\s*\d+)?\s*분/);
  if (minutes) return Number(minutes[1]) * 60;
  const seconds = text.match(/(\d+)(?:\s*~\s*\d+)?\s*초/);
  return seconds ? Number(seconds[1]) : 0;
}

function getSuggestedReps(exercise: Exercise) {
  const text = `${exercise.meta || ''} ${exercise.guide?.reps || ''}`;
  const match = text.match(/(\d+)(?:\s*~\s*\d+)?\s*회/);
  return match ? Number(match[1]) : undefined;
}

function getRecommendedExerciseSeconds(exercise: Exercise, intensity: WorkoutIntensity) {
  const recommendation = getExerciseRecommendation(exercise, intensity);
  return recommendation.durationMinutes
    ? recommendation.durationMinutes * 60
    : getExerciseSeconds(exercise);
}

function buildExerciseRecord(exercise: Exercise, intensity: WorkoutIntensity): ExerciseRecord {
  const seconds = getExerciseSeconds(exercise);
  const recommendation = getExerciseRecommendation(exercise, intensity);
  const suggestedReps = recommendation.reps ?? getSuggestedReps(exercise);
  const setCount = recommendation.sets ?? exercise.sets;
  return {
    exerciseName: exercise.name,
    status: 'pending',
    executionContext: exercise.executionContext,
    durationMinutes: !exercise.sets && seconds
      ? recommendation.durationMinutes ?? Math.ceil(seconds / 60)
      : undefined,
    sets: setCount
      ? Array.from({ length: setCount }, (_, index) => ({
          setNumber: index + 1,
          completed: false,
          reps: suggestedReps !== undefined ? 0 : undefined,
          plannedReps: suggestedReps,
          plannedDurationSeconds: recommendation.durationMinutes ? recommendation.durationMinutes * 60 : getExerciseSeconds(exercise) || undefined,
          plannedRestSeconds: exercise.restSeconds,
        }))
      : undefined,
  };
}

function summarizeExerciseRecord(record: ExerciseRecord) {
  const cardioDetails = [
    record.durationMinutes !== undefined ? `${record.durationMinutes}분` : '',
    record.distanceKm !== undefined ? `${record.distanceKm}km` : '',
    record.stepCount !== undefined ? `${record.stepCount.toLocaleString()}걸음` : '',
    record.intervalWorkSeconds !== undefined && record.intervalRestSeconds !== undefined
      ? `${record.intervalWorkSeconds}초 운동/${record.intervalRestSeconds}초 휴식${record.intervalRounds ? ` × ${record.intervalRounds}회` : ''}`
      : '',
  ].filter(Boolean);
  if (cardioDetails.length) return cardioDetails.join(' · ');
  if (!record.sets?.length) return undefined;
  const completedSets = record.sets.filter((set) => set.completed).length;
  const first = record.sets[0];
  const details = [
    `${completedSets || record.sets.length}세트`,
    first.reps !== undefined ? `${first.reps}회` : '',
    first.leftReps !== undefined || first.rightReps !== undefined ? `좌 ${first.leftReps ?? '-'}회 · 우 ${first.rightReps ?? '-'}회` : '',
    first.weightKg !== undefined ? `${first.weightKg}kg` : '',
    first.durationSeconds !== undefined ? `${first.durationSeconds}초` : '',
    first.bandLevel ? `밴드 ${first.bandLevel}` : '',
    first.restAfterSeconds !== undefined ? `휴식 ${first.restAfterSeconds}초` : '',
  ].filter(Boolean);
  return details.join(' · ');
}

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function buildSessionMemo({
  elapsedSeconds,
  completedCount,
  skippedCount,
  painScore,
  painSymptoms,
  painMemo,
}: {
  elapsedSeconds: number;
  completedCount: number;
  skippedCount: number;
  painScore: number;
  painSymptoms: string[];
  painMemo: string;
}) {
  const lines = [
    `[따라하기 세션] ${Math.max(1, Math.ceil(elapsedSeconds / 60))}분`,
    `완료 ${completedCount}개${skippedCount ? ` · 건너뜀 ${skippedCount}개` : ''}`,
  ];
  if (painScore > 0 || painSymptoms.length) {
    lines.push(`통증 ${painScore}/10${painSymptoms.length ? ` · ${painSymptoms.join(', ')}` : ''}`);
  }
  if (painMemo.trim()) lines.push(painMemo.trim());
  return lines.join('\n');
}

function TimerButton({
  initialSeconds,
  restoredSeconds,
  onSecondsChange,
  onComplete,
  onStart,
}: {
  initialSeconds: number;
  restoredSeconds?: number;
  onSecondsChange: (seconds: number) => void;
  onComplete: () => void;
  onStart: () => void;
}) {
  const [seconds, setSeconds] = useState(restoredSeconds ?? initialSeconds);
  const [running, setRunning] = useState(false);
  const onSecondsChangeRef = useRef(onSecondsChange);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => { onSecondsChangeRef.current = onSecondsChange; }, [onSecondsChange]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    onSecondsChangeRef.current(seconds);
  }, [seconds]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(id);
          setRunning(false);
          queueMicrotask(() => onCompleteRef.current());
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (!initialSeconds) return null;
  return (
    <section className="mt-4 rounded-2xl bg-[#111827] p-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold text-white/60">동작 타이머</p>
          <p className="mt-1 font-mono text-[34px] font-bold tracking-tight">{formatClock(seconds)}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setRunning(false); setSeconds(initialSeconds); }} className="rounded-xl bg-white/10 px-3 py-2 text-[12px] font-bold">
            초기화
          </button>
          <button type="button" onClick={() => { setRunning((value) => !value); onStart(); }} className="min-w-20 rounded-xl bg-white px-3 py-2 text-[12px] font-bold text-gray-900">
            {running ? '일시정지' : seconds === initialSeconds ? '시작' : '계속'}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-white/60">시간이 끝나면 다음 동작 또는 휴식으로 자동 전환됩니다.</p>
    </section>
  );
}

function ElapsedClock({ initialSeconds, onSecondsChange }: { initialSeconds: number; onSecondsChange: (seconds: number) => void }) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const onSecondsChangeRef = useRef(onSecondsChange);

  useEffect(() => { onSecondsChangeRef.current = onSecondsChange; }, [onSecondsChange]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setSeconds((current) => {
        const next = current + 1;
        onSecondsChangeRef.current(next);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return <>{formatClock(seconds)}</>;
}

function RestCountdown({ initialSeconds, onSecondsChange, onComplete, onSkip }: { initialSeconds: number; onSecondsChange: (seconds: number) => void; onComplete: () => void; onSkip: () => void }) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const onSecondsChangeRef = useRef(onSecondsChange);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => { onSecondsChangeRef.current = onSecondsChange; }, [onSecondsChange]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(id);
          queueMicrotask(() => onCompleteRef.current());
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => { onSecondsChangeRef.current(seconds); }, [seconds]);

  return (
    <>
      <p className="mt-3 font-mono text-[64px] font-bold tracking-tight text-gray-900">{formatClock(seconds)}</p>
      <button type="button" onClick={onSkip} className="mt-6 rounded-2xl bg-[#534AB7] px-6 py-3 text-[14px] font-bold text-white">
        휴식 건너뛰고 다음
      </button>
    </>
  );
}

export default function WorkoutSession({
  exercises,
  title,
  startIndex = 0,
  intensity = 'normal',
  onClose,
  onFinish,
}: {
  exercises: Exercise[];
  title: string;
  startIndex?: number;
  intensity?: WorkoutIntensity;
  onClose: () => void;
  onFinish?: (result: WorkoutSessionResult) => void;
}) {
  const safeStartIndex = Math.min(Math.max(0, startIndex), Math.max(0, exercises.length - 1));
  const exerciseSignature = useMemo(() => getExerciseSignature(exercises), [exercises]);
  const draftKey = useMemo(() => getSessionDraftKey(`${exerciseSignature}:${intensity}`), [exerciseSignature, intensity]);
  const [initialDraft] = useState(() => readSessionDraft(draftKey, exerciseSignature, exercises.length));
  const [currentIndex, setCurrentIndex] = useState(initialDraft?.currentIndex ?? safeStartIndex);
  const [mode, setMode] = useState<SessionMode>(initialDraft?.mode ?? 'exercise');
  const [completed, setCompleted] = useState<Set<number>>(() => new Set(initialDraft?.completed ?? []));
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set(initialDraft?.skipped ?? []));
  const initialElapsedSeconds = initialDraft?.elapsedSeconds ?? 0;
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [painScore, setPainScore] = useState(initialDraft?.painScore ?? 0);
  const [painSymptoms, setPainSymptoms] = useState<string[]>(initialDraft?.painSymptoms ?? []);
  const [painMemo, setPainMemo] = useState(initialDraft?.painMemo ?? '');
  const [overallStatus, setOverallStatus] = useState<WorkoutOverallStatus>(initialDraft?.overallStatus ?? 'completed');
  const [difficulty, setDifficulty] = useState<WorkoutDifficulty>(initialDraft?.difficulty ?? 'moderate');
  const [fatigue, setFatigue] = useState(initialDraft?.fatigue ?? 2);
  const [exerciseRecords, setExerciseRecords] = useState<ExerciseRecord[]>(() => initialDraft?.exerciseRecords ?? exercises.map((item) => buildExerciseRecord(item, intensity)));
  const [restoredDraftVisible, setRestoredDraftVisible] = useState(Boolean(initialDraft));
  const [previousRecords] = useState<Record<string, ExerciseRecord>>(() => {
    const store = readWorkoutCompletionStore();
    return exercises.reduce<Record<string, ExerciseRecord>>((records, item) => {
      const previous = getPreviousExerciseRecord(store, item.name);
      if (previous) records[item.name] = { ...previous, summary: summarizeExerciseRecord(previous) };
      return records;
    }, {});
  });
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const shouldPersistDraftRef = useRef(true);
  const elapsedSecondsRef = useRef(initialElapsedSeconds);
  const timerSecondsRef = useRef(initialDraft?.timerSeconds ?? getRecommendedExerciseSeconds(exercises[safeStartIndex], intensity));
  const restSecondsRef = useRef(initialDraft?.restSeconds ?? 0);
  const exercise = exercises[currentIndex];
  const currentRecord = exerciseRecords[currentIndex];
  const currentSetIndex = currentRecord?.sets?.findIndex((set) => !set.completed) ?? -1;
  const currentSetNumber = currentSetIndex >= 0 ? currentSetIndex + 1 : currentRecord?.sets?.length;
  const currentSetCount = currentRecord?.sets?.length ?? 0;
  const recommendation = useMemo(() => getExerciseRecommendation(exercise, intensity), [exercise, intensity]);
  const initialTimerSeconds = useMemo(() => getRecommendedExerciseSeconds(exercise, intensity), [exercise, intensity]);
  const isLastExercise = currentIndex === exercises.length - 1;
  const progress = exercises.length ? ((completed.size + skipped.size) / exercises.length) * 100 : 0;

  const speak = useCallback((message: string) => {
    if (!voiceEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
    } finally {
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!navigator.wakeLock || wakeLockRef.current) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      wakeLockRef.current = sentinel;
      setWakeLockActive(true);
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null;
        setWakeLockActive(false);
      });
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const goToExercise = useCallback((nextIndex: number) => {
    const boundedIndex = Math.min(Math.max(0, nextIndex), exercises.length - 1);
    const nextExercise = exercises[boundedIndex];
    setCurrentIndex(boundedIndex);
    setMode('exercise');
    timerSecondsRef.current = getRecommendedExerciseSeconds(nextExercise, intensity);
    restSecondsRef.current = 0;
    speak(`다음 운동은 ${nextExercise.name}입니다.`);
  }, [exercises, intensity, speak]);

  const finishOrAdvance = useCallback(() => {
    const currentRecord = exerciseRecords[currentIndex];
    const nextSetIndex = currentRecord?.sets?.findIndex((set) => !set.completed) ?? -1;
    if (nextSetIndex >= 0 && currentRecord?.sets) {
      const isFinalSet = nextSetIndex === currentRecord.sets.length - 1;
      setExerciseRecords((records) => records.map((record, index) => index === currentIndex ? { ...record, sets: record.sets?.map((set, setIndex) => setIndex === nextSetIndex ? { ...set, completed: true, restAfterSeconds: isFinalSet ? undefined : (exercise.restSeconds || 45) } : set) } : record));
      if (!isFinalSet) {
        const setRestSeconds = exercise.restSeconds || 45;
        restSecondsRef.current = setRestSeconds;
        setMode('setRest');
        speak(`${nextSetIndex + 1}세트를 완료했습니다. ${setRestSeconds}초 세트 휴식을 시작합니다.`);
        return;
      }
    }
    setCompleted((current) => {
      const next = new Set(current);
      next.add(currentIndex);
      return next;
    });
    setExerciseRecords((records) => records.map((record, index) => index === currentIndex
      ? { ...record, status: 'completed', summary: summarizeExerciseRecord(record) }
      : record));
    if (isLastExercise) {
      setMode('summary');
      speak('오늘 운동을 모두 마쳤습니다.');
      return;
    }
    const nextRestSeconds = exercise.restSeconds || 0;
    if (nextRestSeconds > 0) {
      restSecondsRef.current = nextRestSeconds;
      setMode('rest');
      speak(`${nextRestSeconds}초 휴식을 시작합니다.`);
    } else {
      goToExercise(currentIndex + 1);
    }
  }, [currentIndex, exercise.restSeconds, exerciseRecords, goToExercise, isLastExercise, speak]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    void requestWakeLock();
    return () => {
      document.body.style.overflow = '';
      window.speechSynthesis?.cancel();
      void releaseWakeLock();
    };
  }, [releaseWakeLock, requestWakeLock]);

  const persistDraft = useCallback(() => {
    if (!shouldPersistDraftRef.current) return;
    const draft: WorkoutSessionDraft = {
      version: 1,
      exerciseSignature,
      savedAt: Date.now(),
      currentIndex,
      mode,
      completed: Array.from(completed),
      skipped: Array.from(skipped),
      elapsedSeconds: elapsedSecondsRef.current,
      timerSeconds: timerSecondsRef.current,
      restSeconds: restSecondsRef.current,
      painScore,
      painSymptoms,
      painMemo,
      overallStatus,
      difficulty,
      fatigue,
      exerciseRecords,
    };
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // 사생활 보호 모드나 저장공간 제한에서는 세션을 중단하지 않고 자동저장만 생략합니다.
    }
  }, [completed, currentIndex, difficulty, draftKey, exerciseRecords, exerciseSignature, fatigue, mode, overallStatus, painMemo, painScore, painSymptoms, skipped]);

  useEffect(() => {
    persistDraft();
  }, [persistDraft]);

  useEffect(() => {
    const checkpoint = window.setInterval(persistDraft, 15_000);
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') persistDraft();
    };
    window.addEventListener('pagehide', persistDraft);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.clearInterval(checkpoint);
      window.removeEventListener('pagehide', persistDraft);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      persistDraft();
    };
  }, [persistDraft]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !wakeLockActive) void requestWakeLock();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [requestWakeLock, wakeLockActive]);

  if (!exercise) return null;

  const togglePainSymptom = (symptom: string) => {
    setPainSymptoms((current) => current.includes(symptom) ? current.filter((item) => item !== symptom) : [...current, symptom]);
  };

  const completeSession = () => {
    shouldPersistDraftRef.current = false;
    window.localStorage.removeItem(draftKey);
    onFinish?.({
      pain: painScore > 0 || painSymptoms.length > 0,
      memo: buildSessionMemo({
        elapsedSeconds: elapsedSecondsRef.current,
        completedCount: completed.size,
        skippedCount: skipped.size,
        painScore,
        painSymptoms,
        painMemo,
      }),
      exerciseRecords,
      status: painScore > 0 || painSymptoms.length > 0 ? 'stopped' : overallStatus,
      difficulty,
      fatigue,
    });
    onClose();
  };

  const skipCurrent = () => {
    setSkipped((current) => new Set(current).add(currentIndex));
    setExerciseRecords((records) => records.map((record, index) => index === currentIndex ? { ...record, status: 'skipped' } : record));
    if (isLastExercise) setMode('summary');
    else goToExercise(currentIndex + 1);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#111827] p-0 sm:p-3" role="dialog" aria-modal="true" aria-label={`${title} 따라하기`}>
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden bg-white sm:rounded-3xl">
        <header className="shrink-0 border-b border-gray-100 bg-white px-4 pb-3 pt-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold text-[#534AB7]">{title}</p>
              <p className="mt-0.5 text-[12px] text-gray-400">
                운동 {currentIndex + 1}/{exercises.length}{currentSetCount ? ` · 세트 ${currentSetNumber}/${currentSetCount}` : ''} · <ElapsedClock initialSeconds={initialElapsedSeconds} onSecondsChange={(seconds) => { elapsedSecondsRef.current = seconds; }} />
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" aria-pressed={voiceEnabled} onClick={() => setVoiceEnabled((value) => !value)} className={`rounded-xl px-3 py-2 text-[12px] font-bold ${voiceEnabled ? 'bg-[#EEEDFE] text-[#3C3489]' : 'bg-gray-100 text-gray-500'}`}>
                음성 {voiceEnabled ? '켜짐' : '꺼짐'}
              </button>
              <button type="button" onClick={() => setShowExitConfirm(true)} className="rounded-xl bg-gray-100 px-3 py-2 text-[12px] font-bold text-gray-600">
                나가기
              </button>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-[#534AB7] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            {Math.round(progress)}% 완료 · 화면 꺼짐 방지 {wakeLockActive ? '작동 중' : '대기 중'}
          </p>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          {restoredDraftVisible && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-[#D9D6FF] bg-[#F7F6FF] p-4 text-left">
              <div><p className="text-[13px] font-bold text-[#3C3489]">이전 진행상태에서 이어서 시작했습니다.</p><p className="mt-1 text-[11px] text-gray-500">타이머는 안전을 위해 일시정지 상태로 복구됩니다.</p></div>
              <button type="button" onClick={() => setRestoredDraftVisible(false)} className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-gray-600">확인</button>
            </div>
          )}
          {mode === 'exercise' && (
            <>
              <section className="rounded-3xl bg-gradient-to-br from-[#EEEDFE] to-[#F7F6FF] p-5 text-center sm:p-7">
                <p className="text-[12px] font-bold text-[#534AB7]">지금 할 일</p>
                <h2 className="mt-2 text-[26px] font-bold text-gray-900 sm:text-[32px]">{exercise.name}</h2>
                {currentSetCount ? <p className="mt-2 text-[18px] font-extrabold text-[#3C3489]">{currentSetNumber}세트 진행</p> : null}
                {exercise.meta ? <p className="mt-2 text-[14px] font-semibold text-gray-600">{exercise.meta}</p> : null}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {exercise.sets ? <span className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-gray-700">{exercise.sets}세트</span> : null}
                  {exercise.restSeconds ? <span className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-gray-700">휴식 {exercise.restSeconds}초</span> : null}
                </div>
              </section>
              <details className={`mt-4 rounded-2xl border text-left ${intensity === 'recovery' ? 'border-red-200 bg-red-50 text-red-900' : intensity === '70%' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-green-100 bg-green-50 text-green-900'}`} open={intensity !== 'normal' || undefined}>
                <summary className="cursor-pointer list-none p-4"><span className="block text-[12px] font-bold">AI 추천 · {recommendation.headline}</span><span className="mt-1 block text-[11px] opacity-70">추천 이유가 궁금할 때 펼쳐보세요</span></summary>
                <div className="border-t border-black/5 p-4 pt-3"><p className="text-[12px] leading-relaxed">{recommendation.detail}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {recommendation.sets ? <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold">추천 {recommendation.sets}세트</span> : null}
                  {recommendation.reps ? <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold">추천 {recommendation.reps}회</span> : null}
                  {recommendation.durationMinutes ? <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold">추천 {recommendation.durationMinutes}분</span> : null}
                </div></div>
              </details>
              <TimerButton
                key={`${currentIndex}:${initialTimerSeconds}`}
                initialSeconds={initialTimerSeconds}
                restoredSeconds={timerSecondsRef.current}
                onSecondsChange={(seconds) => { timerSecondsRef.current = seconds; }}
                onStart={() => { void requestWakeLock(); }}
                onComplete={() => { speak('동작 시간이 끝났습니다.'); finishOrAdvance(); }}
              />
              {exercise.intervalPlan ? <IntervalTimer plan={exercise.intervalPlan} /> : null}
              <ExerciseRecordEditor
                exercise={exercise}
                value={exerciseRecords[currentIndex]}
                previous={previousRecords[exercise.name]}
                intensity={intensity}
                onChange={(record) => setExerciseRecords((records) => records.map((item, index) => index === currentIndex ? record : item))}
              />
              <details className="mt-4 rounded-2xl border border-gray-100 bg-white">
                <summary className="cursor-pointer list-none p-4"><span className="block text-[13px] font-bold text-gray-800">자세와 주의사항 보기</span><span className="mt-1 block text-[11px] text-gray-500">동작 방법이 헷갈릴 때만 펼쳐보세요</span></summary>
                <div className="border-t border-gray-100 px-3 pb-3"><ExerciseGuidePanel exercise={exercise} /></div>
              </details>
            </>
          )}

          {(mode === 'rest' || mode === 'setRest') && (
            <section className="grid min-h-[55vh] place-items-center text-center">
              <div>
                <p className="text-[13px] font-bold text-[#378ADD]">{mode === 'setRest' ? '세트 사이 휴식' : '다음 동작 전 휴식'}</p>
                <RestCountdown
                  key={`${mode}:${currentIndex}:${restSecondsRef.current}`}
                  initialSeconds={restSecondsRef.current}
                  onSecondsChange={(seconds) => { restSecondsRef.current = seconds; }}
                  onComplete={() => mode === 'setRest' ? setMode('exercise') : goToExercise(currentIndex + 1)}
                  onSkip={() => mode === 'setRest' ? setMode('exercise') : goToExercise(currentIndex + 1)}
                />
                <p className="mt-3 text-[14px] text-gray-500">{mode === 'setRest' ? `다음: ${exercise.name} ${(exerciseRecords[currentIndex]?.sets?.findIndex((set) => !set.completed) ?? 0) + 1}세트` : `다음: ${exercises[currentIndex + 1]?.name}`}</p>
              </div>
            </section>
          )}

          {mode === 'pain' && (
            <section className="mx-auto max-w-2xl rounded-3xl border-2 border-red-200 bg-red-50 p-5 text-red-900 sm:p-6">
              <p className="text-[13px] font-bold">안전 종료</p>
              <h2 className="mt-1 text-[24px] font-bold">운동을 즉시 멈추고 상태를 기록하세요.</h2>
              <p className="mt-2 text-[13px] leading-relaxed">허리 통증, 다리 저림, 날카로운 관절 통증 또는 어지러움이 지속되면 무리하지 말고 의료진과 상담하세요.</p>
              <label className="mt-5 block text-[13px] font-bold">
                불편감 강도: {painScore}/10
                <input type="range" min={0} max={10} value={painScore} onChange={(event) => setPainScore(Number(event.target.value))} className="mt-2 block w-full accent-red-600" />
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                {PAIN_SYMPTOMS.map((symptom) => (
                  <button key={symptom} type="button" aria-pressed={painSymptoms.includes(symptom)} onClick={() => togglePainSymptom(symptom)} className={`rounded-full px-3 py-2 text-[12px] font-bold ${painSymptoms.includes(symptom) ? 'bg-red-600 text-white' : 'bg-white text-red-800'}`}>
                    {symptom}
                  </button>
                ))}
              </div>
              <label className="mt-4 block text-[13px] font-bold">
                메모
                <textarea value={painMemo} onChange={(event) => setPainMemo(event.target.value)} placeholder="언제, 어느 부위가 불편했는지 입력" className="mt-2 min-h-24 w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-[13px] font-normal text-gray-800" />
              </label>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setMode('exercise')} className="rounded-xl bg-white px-4 py-3 text-[13px] font-bold text-red-800">입력 취소</button>
                <button type="button" onClick={() => {
                  setExerciseRecords((records) => records.map((record, index) => index === currentIndex ? { ...record, painScore, status: 'partial', summary: summarizeExerciseRecord(record) } : record));
                  setMode('summary');
                }} className="rounded-xl bg-red-600 px-4 py-3 text-[13px] font-bold text-white">기록하고 운동 종료</button>
              </div>
            </section>
          )}

          {mode === 'summary' && (
            <section className="mx-auto max-w-2xl rounded-3xl bg-[#F7F6FF] p-5 text-center sm:p-7">
              <p className="text-[13px] font-bold text-[#534AB7]">{painScore > 0 || painSymptoms.length ? '안전 종료 기록' : '세션 완료'}</p>
              <h2 className="mt-2 text-[26px] font-bold text-gray-900">{painScore > 0 || painSymptoms.length ? '회복을 우선하세요' : '오늘 운동을 마쳤습니다'}</h2>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-white p-3"><p className="text-[11px] text-gray-400">운동시간</p><p className="mt-1 text-[18px] font-bold">{Math.max(1, Math.ceil(elapsedSecondsRef.current / 60))}분</p></div>
                <div className="rounded-2xl bg-white p-3"><p className="text-[11px] text-gray-400">완료</p><p className="mt-1 text-[18px] font-bold">{completed.size}개</p></div>
                <div className="rounded-2xl bg-white p-3"><p className="text-[11px] text-gray-400">건너뜀</p><p className="mt-1 text-[18px] font-bold">{skipped.size}개</p></div>
              </div>
              {painScore > 0 || painSymptoms.length ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-[13px] font-bold text-red-700">통증 {painScore}/10 · {painSymptoms.join(', ') || '증상 미선택'}</p> : null}
              <div className="mt-4 space-y-4 rounded-2xl bg-white p-4 text-left">
                <div><p className="text-[12px] font-bold text-gray-700">전체 완료 상태</p><div className="mt-2 grid grid-cols-3 gap-2">{([['completed', '완료'], ['partial', '일부 완료'], ['stopped', '중단']] as [WorkoutOverallStatus, string][]).map(([value, label]) => <button key={value} type="button" disabled={painScore > 0 || painSymptoms.length > 0} onClick={() => setOverallStatus(value)} className={`rounded-xl px-2 py-2 text-[12px] font-bold ${((painScore > 0 || painSymptoms.length > 0) ? 'stopped' : overallStatus) === value ? 'bg-[#534AB7] text-white' : 'bg-gray-50 text-gray-600'} disabled:opacity-70`}>{label}</button>)}</div></div>
                <div><p className="text-[12px] font-bold text-gray-700">체감 난이도</p><div className="mt-2 grid grid-cols-3 gap-2">{([['easy', '쉬움'], ['moderate', '적당함'], ['hard', '힘듦']] as [WorkoutDifficulty, string][]).map(([value, label]) => <button key={value} type="button" onClick={() => setDifficulty(value)} className={`rounded-xl px-2 py-2 text-[12px] font-bold ${difficulty === value ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-600'}`}>{label}</button>)}</div></div>
                <details className="rounded-xl bg-gray-50 p-3"><summary className="cursor-pointer text-[12px] font-bold text-gray-700">피로도 상세 기록</summary><label className="mt-3 block text-[12px] font-bold text-gray-700">운동 후 피로도: {fatigue}/5<input type="range" min={1} max={5} value={fatigue} onChange={(event) => setFatigue(Number(event.target.value))} className="mt-2 block w-full accent-[#534AB7]" /></label></details>
              </div>
              <button type="button" onClick={completeSession} className="mt-5 w-full rounded-2xl bg-[#534AB7] px-4 py-3.5 text-[14px] font-bold text-white">
                기록 저장하고 종료
              </button>
            </section>
          )}
        </main>

        {mode === 'exercise' && (
          <footer className="shrink-0 border-t border-gray-100 bg-white/95 p-3 shadow-2xl sm:px-6">
            <button type="button" onClick={() => setMode('pain')} className="mb-2 w-full rounded-xl border border-red-100 bg-red-50 py-2.5 text-[12px] font-bold text-red-700">
              통증·저림·어지러움 발생
            </button>
            <div className="grid grid-cols-[0.8fr_1.6fr_0.8fr] gap-2">
              <button type="button" disabled={currentIndex === 0} onClick={() => goToExercise(currentIndex - 1)} className="min-h-14 rounded-xl bg-gray-100 py-3 text-[12px] font-bold text-gray-700 disabled:text-gray-300">이전</button>
              <button type="button" onClick={finishOrAdvance} className="min-h-14 rounded-xl bg-[#534AB7] py-3 text-[15px] font-extrabold text-white shadow-lg shadow-violet-200">{exerciseRecords[currentIndex]?.sets?.some((set) => !set.completed) ? `${(exerciseRecords[currentIndex]?.sets?.findIndex((set) => !set.completed) ?? 0) + 1}세트 완료` : isLastExercise ? '이 동작 완료' : '완료하고 다음'}</button>
              <button type="button" onClick={skipCurrent} className="min-h-14 rounded-xl bg-gray-100 py-3 text-[12px] font-bold text-gray-700">건너뛰기</button>
            </div>
            {getExerciseVideoHref(exercise) ? <a className="mt-2 block rounded-xl bg-[#111827] py-2.5 text-center text-[12px] font-bold text-white" href={getExerciseVideoHref(exercise)} target="_blank" rel="noopener noreferrer">{getExerciseVideoLabel(exercise)}</a> : null}
          </footer>
        )}

        {showExitConfirm && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4">
            <section className="w-full max-w-sm rounded-3xl bg-white p-5 text-center shadow-2xl">
              <h2 className="text-[20px] font-bold text-gray-900">운동을 종료할까요?</h2>
              <p className="mt-2 text-[13px] text-gray-500">저장 없이 종료하면 자동 저장된 임시 진행상태도 삭제됩니다.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setShowExitConfirm(false)} className="rounded-xl bg-gray-100 px-3 py-3 text-[13px] font-bold text-gray-700">계속 운동</button>
                <button type="button" onClick={() => { shouldPersistDraftRef.current = false; window.localStorage.removeItem(draftKey); onClose(); }} className="rounded-xl bg-red-600 px-3 py-3 text-[13px] font-bold text-white">저장 없이 종료</button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
