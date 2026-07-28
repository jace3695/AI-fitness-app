'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Exercise } from '../data/workouts';
import { ExerciseRecord, getPreviousExerciseRecord, readWorkoutCompletionStore } from '../data/workoutCompletion';
import ExerciseGuidePanel, { getExerciseVideoHref, getExerciseVideoLabel } from './ExerciseGuidePanel';
import ExerciseRecordEditor from './ExerciseRecordEditor';
import { IntervalTimer } from './WorkoutControls';

type SessionMode = 'exercise' | 'rest' | 'pain' | 'summary';

export interface WorkoutSessionResult {
  pain: boolean;
  memo: string;
  exerciseRecords: ExerciseRecord[];
}

const PAIN_SYMPTOMS = ['허리 통증', '다리 저림', '무릎 통증', '어지러움', '메스꺼움', '식은땀', '기타'];

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

function buildExerciseRecord(exercise: Exercise): ExerciseRecord {
  const seconds = getExerciseSeconds(exercise);
  const suggestedReps = getSuggestedReps(exercise);
  return {
    exerciseName: exercise.name,
    status: 'pending',
    durationMinutes: !exercise.sets && seconds ? Math.ceil(seconds / 60) : undefined,
    sets: exercise.sets
      ? Array.from({ length: exercise.sets }, (_, index) => ({
          setNumber: index + 1,
          completed: false,
          reps: suggestedReps,
        }))
      : undefined,
  };
}

function summarizeExerciseRecord(record: ExerciseRecord) {
  if (record.durationMinutes !== undefined) return `${record.durationMinutes}분`;
  if (!record.sets?.length) return undefined;
  const completedSets = record.sets.filter((set) => set.completed).length;
  const first = record.sets[0];
  const details = [
    `${completedSets || record.sets.length}세트`,
    first.reps !== undefined ? `${first.reps}회` : '',
    first.weightKg !== undefined ? `${first.weightKg}kg` : '',
    first.durationSeconds !== undefined ? `${first.durationSeconds}초` : '',
    first.bandLevel ? `밴드 ${first.bandLevel}` : '',
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
  running,
  seconds,
  initialSeconds,
  onToggle,
  onReset,
}: {
  running: boolean;
  seconds: number;
  initialSeconds: number;
  onToggle: () => void;
  onReset: () => void;
}) {
  if (!initialSeconds) return null;
  return (
    <section className="mt-4 rounded-2xl bg-[#111827] p-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold text-white/60">동작 타이머</p>
          <p className="mt-1 font-mono text-[34px] font-bold tracking-tight">{formatClock(seconds)}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onReset} className="rounded-xl bg-white/10 px-3 py-2 text-[12px] font-bold">
            초기화
          </button>
          <button type="button" onClick={onToggle} className="min-w-20 rounded-xl bg-white px-3 py-2 text-[12px] font-bold text-gray-900">
            {running ? '일시정지' : seconds === initialSeconds ? '시작' : '계속'}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-white/60">시간이 끝나면 다음 동작 또는 휴식으로 자동 전환됩니다.</p>
    </section>
  );
}

export default function WorkoutSession({
  exercises,
  title,
  startIndex = 0,
  onClose,
  onFinish,
}: {
  exercises: Exercise[];
  title: string;
  startIndex?: number;
  onClose: () => void;
  onFinish?: (result: WorkoutSessionResult) => void;
}) {
  const safeStartIndex = Math.min(Math.max(0, startIndex), Math.max(0, exercises.length - 1));
  const [currentIndex, setCurrentIndex] = useState(safeStartIndex);
  const [mode, setMode] = useState<SessionMode>('exercise');
  const [completed, setCompleted] = useState<Set<number>>(() => new Set());
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(() => getExerciseSeconds(exercises[safeStartIndex]));
  const [timerRunning, setTimerRunning] = useState(false);
  const [restSeconds, setRestSeconds] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [painScore, setPainScore] = useState(0);
  const [painSymptoms, setPainSymptoms] = useState<string[]>([]);
  const [painMemo, setPainMemo] = useState('');
  const [exerciseRecords, setExerciseRecords] = useState<ExerciseRecord[]>(() => exercises.map(buildExerciseRecord));
  const [previousRecords] = useState<Record<string, ExerciseRecord>>(() => {
    const store = readWorkoutCompletionStore();
    return exercises.reduce<Record<string, ExerciseRecord>>((records, item) => {
      const previous = getPreviousExerciseRecord(store, item.name);
      if (previous) records[item.name] = { ...previous, summary: summarizeExerciseRecord(previous) };
      return records;
    }, {});
  });
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const autoAdvanceRef = useRef(false);
  const exercise = exercises[currentIndex];
  const initialTimerSeconds = useMemo(() => getExerciseSeconds(exercise), [exercise]);
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
    setTimerRunning(false);
    setTimerSeconds(getExerciseSeconds(nextExercise));
    speak(`다음 운동은 ${nextExercise.name}입니다.`);
  }, [exercises, speak]);

  const finishOrAdvance = useCallback(() => {
    setCompleted((current) => {
      const next = new Set(current);
      next.add(currentIndex);
      return next;
    });
    setTimerRunning(false);
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
      setRestSeconds(nextRestSeconds);
      setMode('rest');
      speak(`${nextRestSeconds}초 휴식을 시작합니다.`);
    } else {
      goToExercise(currentIndex + 1);
    }
  }, [currentIndex, exercise.restSeconds, goToExercise, isLastExercise, speak]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    void requestWakeLock();
    return () => {
      document.body.style.overflow = '';
      window.speechSynthesis?.cancel();
      void releaseWakeLock();
    };
  }, [releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    const id = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (mode !== 'exercise' || !timerRunning || timerSeconds <= 0) return;
    const id = window.setInterval(() => setTimerSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(id);
  }, [mode, timerRunning, timerSeconds]);

  useEffect(() => {
    if (mode !== 'exercise' || !timerRunning || timerSeconds !== 0 || autoAdvanceRef.current) return;
    autoAdvanceRef.current = true;
    speak('동작 시간이 끝났습니다.');
    finishOrAdvance();
  }, [finishOrAdvance, mode, speak, timerRunning, timerSeconds]);

  useEffect(() => {
    autoAdvanceRef.current = false;
  }, [currentIndex]);

  useEffect(() => {
    if (mode !== 'rest' || restSeconds <= 0) return;
    const id = window.setInterval(() => setRestSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(id);
  }, [mode, restSeconds]);

  useEffect(() => {
    if (mode !== 'rest' || restSeconds !== 0) return;
    goToExercise(currentIndex + 1);
  }, [currentIndex, goToExercise, mode, restSeconds]);

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
    onFinish?.({
      pain: painScore > 0 || painSymptoms.length > 0,
      memo: buildSessionMemo({
        elapsedSeconds,
        completedCount: completed.size,
        skippedCount: skipped.size,
        painScore,
        painSymptoms,
        painMemo,
      }),
      exerciseRecords,
    });
    onClose();
  };

  const skipCurrent = () => {
    setSkipped((current) => new Set(current).add(currentIndex));
    setExerciseRecords((records) => records.map((record, index) => index === currentIndex ? { ...record, status: 'skipped' } : record));
    setTimerRunning(false);
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
                {currentIndex + 1} / {exercises.length} · {formatClock(elapsedSeconds)}
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
            화면 꺼짐 방지 {wakeLockActive ? '작동 중' : '미지원 또는 대기 중'}
          </p>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          {mode === 'exercise' && (
            <>
              <section className="rounded-3xl bg-gradient-to-br from-[#EEEDFE] to-[#F7F6FF] p-5 text-center sm:p-7">
                <p className="text-[12px] font-bold text-[#534AB7]">현재 동작</p>
                <h2 className="mt-2 text-[26px] font-bold text-gray-900 sm:text-[32px]">{exercise.name}</h2>
                {exercise.meta ? <p className="mt-2 text-[14px] font-semibold text-gray-600">{exercise.meta}</p> : null}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {exercise.sets ? <span className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-gray-700">{exercise.sets}세트</span> : null}
                  {exercise.restSeconds ? <span className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-gray-700">휴식 {exercise.restSeconds}초</span> : null}
                </div>
              </section>
              <TimerButton
                running={timerRunning}
                seconds={timerSeconds}
                initialSeconds={initialTimerSeconds}
                onToggle={() => {
                  setTimerRunning((value) => !value);
                  void requestWakeLock();
                }}
                onReset={() => {
                  setTimerRunning(false);
                  setTimerSeconds(initialTimerSeconds);
                }}
              />
              {exercise.intervalPlan ? <IntervalTimer plan={exercise.intervalPlan} /> : null}
              <ExerciseRecordEditor
                exercise={exercise}
                value={exerciseRecords[currentIndex]}
                previous={previousRecords[exercise.name]}
                onChange={(record) => setExerciseRecords((records) => records.map((item, index) => index === currentIndex ? record : item))}
              />
              <ExerciseGuidePanel exercise={exercise} />
            </>
          )}

          {mode === 'rest' && (
            <section className="grid min-h-[55vh] place-items-center text-center">
              <div>
                <p className="text-[13px] font-bold text-[#378ADD]">다음 동작 전 휴식</p>
                <p className="mt-3 font-mono text-[64px] font-bold tracking-tight text-gray-900">{formatClock(restSeconds)}</p>
                <p className="mt-3 text-[14px] text-gray-500">다음: {exercises[currentIndex + 1]?.name}</p>
                <button type="button" onClick={() => goToExercise(currentIndex + 1)} className="mt-6 rounded-2xl bg-[#534AB7] px-6 py-3 text-[14px] font-bold text-white">
                  휴식 건너뛰고 다음
                </button>
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
                <div className="rounded-2xl bg-white p-3"><p className="text-[11px] text-gray-400">운동시간</p><p className="mt-1 text-[18px] font-bold">{Math.max(1, Math.ceil(elapsedSeconds / 60))}분</p></div>
                <div className="rounded-2xl bg-white p-3"><p className="text-[11px] text-gray-400">완료</p><p className="mt-1 text-[18px] font-bold">{completed.size}개</p></div>
                <div className="rounded-2xl bg-white p-3"><p className="text-[11px] text-gray-400">건너뜀</p><p className="mt-1 text-[18px] font-bold">{skipped.size}개</p></div>
              </div>
              {painScore > 0 || painSymptoms.length ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-[13px] font-bold text-red-700">통증 {painScore}/10 · {painSymptoms.join(', ') || '증상 미선택'}</p> : null}
              <button type="button" onClick={completeSession} className="mt-5 w-full rounded-2xl bg-[#534AB7] px-4 py-3.5 text-[14px] font-bold text-white">
                기록 저장하고 종료
              </button>
            </section>
          )}
        </main>

        {mode === 'exercise' && (
          <footer className="shrink-0 border-t border-gray-100 bg-white/95 p-3 shadow-2xl sm:px-6">
            <button type="button" onClick={() => { setTimerRunning(false); setMode('pain'); }} className="mb-2 w-full rounded-xl bg-red-50 py-2.5 text-[12px] font-bold text-red-700">
              통증·저림·어지러움 발생
            </button>
            <div className="grid grid-cols-[0.8fr_1.6fr_0.8fr] gap-2">
              <button type="button" disabled={currentIndex === 0} onClick={() => goToExercise(currentIndex - 1)} className="rounded-xl bg-gray-100 py-3 text-[12px] font-bold text-gray-700 disabled:text-gray-300">이전</button>
              <button type="button" onClick={finishOrAdvance} className="rounded-xl bg-[#534AB7] py-3 text-[13px] font-bold text-white">{isLastExercise ? '이 동작 완료' : '완료하고 다음'}</button>
              <button type="button" onClick={skipCurrent} className="rounded-xl bg-gray-100 py-3 text-[12px] font-bold text-gray-700">건너뛰기</button>
            </div>
            {getExerciseVideoHref(exercise) ? <a className="mt-2 block rounded-xl bg-[#111827] py-2.5 text-center text-[12px] font-bold text-white" href={getExerciseVideoHref(exercise)} target="_blank" rel="noopener noreferrer">{getExerciseVideoLabel(exercise)}</a> : null}
          </footer>
        )}

        {showExitConfirm && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4">
            <section className="w-full max-w-sm rounded-3xl bg-white p-5 text-center shadow-2xl">
              <h2 className="text-[20px] font-bold text-gray-900">운동을 종료할까요?</h2>
              <p className="mt-2 text-[13px] text-gray-500">아직 저장하지 않은 세션 진행 내용은 사라집니다.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setShowExitConfirm(false)} className="rounded-xl bg-gray-100 px-3 py-3 text-[13px] font-bold text-gray-700">계속 운동</button>
                <button type="button" onClick={onClose} className="rounded-xl bg-red-600 px-3 py-3 text-[13px] font-bold text-white">저장 없이 종료</button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
