'use client';

import { useEffect, useState } from 'react';
import { ExerciseRecord, ExerciseSetRecord } from '../data/workoutCompletion';
import { Exercise } from '../data/workouts';
import { getProgressionAdvice, WorkoutIntensity } from '../data/workoutRecommendations';

function NumberInput({
  label,
  value,
  unit,
  step = 1,
  onChange,
}: {
  label: string;
  value?: number;
  unit: string;
  step?: number;
  onChange: (value?: number) => void;
}) {
  return (
    <label className="min-w-0 text-[11px] font-bold text-gray-500">
      {label}
      <span className="mt-1 flex items-center rounded-xl border border-gray-200 bg-white px-2">
        <input
          type="number"
          min={0}
          step={step}
          inputMode="decimal"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent py-2 text-right text-[14px] font-bold text-gray-900 outline-none"
        />
        <span className="ml-1 text-[11px] font-semibold text-gray-400">{unit}</span>
      </span>
    </label>
  );
}

function formatRest(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function ExerciseRecordEditor({
  exercise,
  value,
  previous,
  intensity = 'normal',
  onChange,
}: {
  exercise: Exercise;
  value: ExerciseRecord;
  previous?: ExerciseRecord;
  intensity?: WorkoutIntensity;
  onChange: (record: ExerciseRecord) => void;
}) {
  const [setRestSeconds, setSetRestSeconds] = useState(0);
  const isDumbbell = exercise.name.includes('덤벨');
  const isBand = exercise.name.includes('밴드');
  const isPullup = ['턱걸이', '철봉', '매달리기'].some((keyword) => exercise.name.includes(keyword));
  const isTimed = !exercise.sets && Boolean(value.durationMinutes !== undefined);

  useEffect(() => {
    if (setRestSeconds <= 0) return;
    const id = window.setInterval(() => setSetRestSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(id);
  }, [setRestSeconds]);

  const updateSet = (index: number, patch: Partial<ExerciseSetRecord>) => {
    const sets = (value.sets || []).map((set, setIndex) => setIndex === index ? { ...set, ...patch } : set);
    onChange({ ...value, sets });
  };

  const toggleSet = (index: number) => {
    const set = value.sets?.[index];
    if (!set) return;
    const completed = !set.completed;
    updateSet(index, { completed });
    if (completed && index < (value.sets?.length || 0) - 1) {
      setSetRestSeconds(exercise.restSeconds || 45);
    }
  };

  const copyPrevious = () => {
    if (!previous) return;
    onChange({
      ...previous,
      status: 'pending',
      sets: previous.sets?.map((set) => ({ ...set, completed: false })),
      painScore: undefined,
    });
  };

  return (
    <section className="mt-4 rounded-2xl border border-[#D9D6FF] bg-white p-4 text-left shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold text-[#534AB7]">오늘 수행 기록</p>
          <p className="mt-1 text-[11px] text-gray-500">입력한 값은 운동 완료 기록과 함께 날짜별로 저장됩니다.</p>
        </div>
        {previous && intensity === 'normal' ? (
          <button type="button" onClick={copyPrevious} className="shrink-0 rounded-xl bg-[#EEEDFE] px-3 py-2 text-[11px] font-bold text-[#3C3489]">
            이전과 동일
          </button>
        ) : null}
      </div>

      {previous ? (
        <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
          직전 기록: {previous.summary || '상세값 기록 있음'}
        </p>
      ) : (
        <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[11px] text-gray-400">이 운동의 직전 기록이 없습니다.</p>
      )}
      <p className={`mt-2 rounded-xl px-3 py-2 text-[11px] font-semibold leading-relaxed ${intensity === 'recovery' ? 'bg-red-50 text-red-700' : intensity === '70%' ? 'bg-amber-50 text-amber-800' : 'bg-[#EAF3DE] text-[#27500A]'}`}>
        진행 제안: {getProgressionAdvice(previous, intensity)}
      </p>

      {isTimed ? (
        <div className="mt-3 max-w-44">
          <NumberInput
            label="실제 운동시간"
            value={value.durationMinutes}
            unit="분"
            onChange={(durationMinutes) => onChange({ ...value, durationMinutes })}
          />
        </div>
      ) : null}

      {value.sets?.length ? (
        <div className="mt-3 space-y-2">
          {value.sets.map((set, index) => (
            <div key={set.setNumber} className={`rounded-2xl border p-3 ${set.completed ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-bold text-gray-800">{set.setNumber}세트</p>
                <button
                  type="button"
                  aria-pressed={set.completed}
                  onClick={() => toggleSet(index)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${set.completed ? 'bg-green-600 text-white' : 'bg-white text-gray-600'}`}
                >
                  {set.completed ? '완료됨' : '세트 완료'}
                </button>
              </div>
              <div className={`mt-2 grid gap-2 ${isDumbbell || isPullup ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <NumberInput label="횟수" value={set.reps} unit="회" onChange={(reps) => updateSet(index, { reps })} />
                {isDumbbell ? <NumberInput label="덤벨 중량" value={set.weightKg} unit="kg" step={0.5} onChange={(weightKg) => updateSet(index, { weightKg })} /> : null}
                {isPullup ? <NumberInput label="매달리기/버티기" value={set.durationSeconds} unit="초" onChange={(durationSeconds) => updateSet(index, { durationSeconds })} /> : null}
              </div>
              {isBand ? (
                <label className="mt-2 block text-[11px] font-bold text-gray-500">
                  밴드 강도
                  <select value={set.bandLevel || ''} onChange={(event) => updateSet(index, { bandLevel: event.target.value || undefined })} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] font-semibold text-gray-800">
                    <option value="">선택 안 함</option>
                    <option value="약">약</option>
                    <option value="중">중</option>
                    <option value="강">강</option>
                  </select>
                </label>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {setRestSeconds > 0 ? (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-[#E6F1FB] px-3 py-2 text-[#0C447C]">
          <span className="text-[12px] font-bold">세트 휴식 {formatRest(setRestSeconds)}</span>
          <button type="button" onClick={() => setSetRestSeconds(0)} className="rounded-lg bg-white px-2 py-1 text-[11px] font-bold">건너뛰기</button>
        </div>
      ) : null}
    </section>
  );
}
