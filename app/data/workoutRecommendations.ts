import { Exercise } from './workouts';
import { ExerciseRecord } from './workoutCompletion';

export type WorkoutIntensity = 'normal' | '70%' | 'recovery';

export interface ExerciseRecommendation {
  sets?: number;
  reps?: number;
  durationMinutes?: number;
  headline: string;
  detail: string;
}

function firstNumber(text: string, unit: '회' | '분') {
  const match = text.match(new RegExp(`(\\d+)(?:\\s*~\\s*\\d+)?\\s*${unit}`));
  return match ? Number(match[1]) : undefined;
}

function adjustedValue(value: number | undefined, ratio: number) {
  return value === undefined ? undefined : Math.max(1, Math.floor(value * ratio));
}

export function getExerciseRecommendation(
  exercise: Exercise,
  intensity: WorkoutIntensity,
): ExerciseRecommendation {
  const text = `${exercise.meta || ''} ${exercise.guide?.reps || ''} ${exercise.guide?.duration || ''}`;
  const baseReps = firstNumber(text, '회');
  const baseMinutes = firstNumber(text, '분');

  if (intensity === 'normal') {
    return {
      sets: exercise.sets || undefined,
      reps: baseReps,
      durationMinutes: !exercise.sets ? baseMinutes : undefined,
      headline: '오늘은 계획 강도로 진행',
      detail: '직전 기록보다 먼저 자세와 통증 여부를 확인하고, 여유가 있어도 한 번에 한 항목만 올리세요.',
    };
  }

  const ratio = intensity === '70%' ? 0.7 : 0.5;
  const sets = exercise.sets ? Math.max(1, Math.floor(exercise.sets * ratio)) : undefined;
  const reps = adjustedValue(baseReps, ratio);
  const durationMinutes = !exercise.sets ? adjustedValue(baseMinutes, ratio) : undefined;

  return {
    sets,
    reps,
    durationMinutes,
    headline: intensity === '70%' ? '오늘은 약 70%로 조절' : '회복 우선 · 기존 루틴은 최소량만',
    detail: intensity === '70%'
      ? '세트·횟수·시간을 함께 늘리지 말고 아래 추천량에서 시작하세요.'
      : '가능하면 회복 루틴을 선택하세요. 기존 루틴을 확인할 때도 통증 없는 범위에서 최소량만 진행하세요.',
  };
}

export function getProgressionAdvice(
  previous: ExerciseRecord | undefined,
  intensity: WorkoutIntensity,
) {
  if (intensity === 'recovery') {
    return '오늘은 강도를 올리지 않습니다. 증상이 가라앉고 일상 동작이 편해진 뒤 기본 계획으로 돌아오세요.';
  }
  if (intensity === '70%') {
    return '오늘은 직전 기록을 그대로 복사하지 말고 추천량으로 낮춥니다. 다음 운동도 불편감이 없을 때 원래 계획으로 돌아오세요.';
  }
  if (!previous) {
    return '첫 기록은 기준 만들기 단계입니다. 계획량을 통증 없이 마치는 것을 우선하세요.';
  }
  if ((previous.painScore || 0) > 0 || previous.status === 'partial') {
    return '직전 기록에 불편감 또는 부분 완료가 있습니다. 중량·횟수·시간 중 하나를 낮춰 진행하세요.';
  }
  const completedSets = (previous.sets ?? []).filter((set) => set.completed);
  const detailedBaseline = [
    previous.distanceKm !== undefined ? `${previous.distanceKm}km` : '',
    previous.stepCount !== undefined ? `${previous.stepCount.toLocaleString()}걸음` : '',
    previous.intervalRounds !== undefined ? `인터벌 ${previous.intervalRounds}회` : '',
    completedSets.some((set) => set.leftReps !== undefined || set.rightReps !== undefined) ? '좌우 횟수' : '',
    completedSets.some((set) => set.durationSeconds !== undefined) ? '유지시간' : '',
    completedSets.some((set) => set.restAfterSeconds !== undefined) ? '세트 휴식' : '',
  ].filter(Boolean);
  if (detailedBaseline.length) {
    return `직전 ${detailedBaseline.join(' · ')} 기록을 기준으로 먼저 유지하세요. 통증 없이 2회 연속 완료한 뒤 한 항목만 소폭 올리세요.`;
  }
  return '직전 기록을 먼저 유지하세요. 같은 계획을 통증 없이 2회 연속 마친 뒤 횟수 1~2회, 중량 0.5~1kg, 시간 1~2분 중 하나만 올리세요.';
}
