import { buildBodyCompositionReview } from './bodyCompositionCoach.ts';
import { buildAdaptiveWorkoutReview } from './workoutAdaptiveReview.ts';
import { buildWorkoutProgramContext } from './workoutProgramReview.ts';
import type { RecordStores } from './recordStorage.ts';
import type { UserWorkoutSettings } from './userWorkoutSettings.ts';
import { isHomeSelectable } from './homeExerciseCatalog.ts';

/**
 * Join descriptive measurement evidence to the existing workout rule engine.
 * Body values never select an exercise, resistance, repetition or recovery dose.
 * Returns preview text only: no persistence or remote payload.
 */
export function buildBodyWorkoutReview(
  stores: Pick<RecordStores, 'inbody' | 'workouts' | 'conditions'>,
  settings: UserWorkoutSettings,
  selectedPlanId: string,
  today: string,
) {
  const body = buildBodyCompositionReview(stores, today);
  const adaptive = buildAdaptiveWorkoutReview({
    settings, selectedPlanId, today, workouts: stores.workouts, conditions: stores.conditions,
  });
  // Never let the combined preview contradict either existing safety check.
  const bodyHold = body.priority === 'pain' ||
    (body.priority === 'fatigue' && ['increase', 'replace'].includes(adaptive.action));
  const program = buildWorkoutProgramContext({ selectedPlanId, userSettings: settings });
  const excluded = program.days.some(day => day.exercises.some(exercise => !isHomeSelectable(exercise.id, exercise.name)));
  const held = adaptive.action === 'hold' || bodyHold || excluded;
  const evidence = body.metrics.filter(metric => metric.status === 'comparable').map(metric => ({
    key: metric.key, label: metric.label,
    summary: `${metric.fromDate} → ${metric.date}: 표시 수치 차이 ${metric.delta! > 0 ? '+' : ''}${metric.delta}${metric.unit === '%' ? '%p' : metric.unit}`,
  }));
  return {
    body,
    recommendation: {
      action: held ? 'hold' as const : adaptive.action,
      title: adaptive.action === 'hold' ? adaptive.title : bodyHold ? '운동 변경 보류 · 기록된 불편 먼저 확인'
        : excluded ? '제외 운동 포함 · 직접 설정 확인' : adaptive.title,
      reasons: adaptive.action === 'hold' ? adaptive.reasons : bodyHold ? [body.nextAction]
        : excluded ? ['현재 설정에 슬라이딩보드 또는 힙브릿지 제외 대상이 있습니다. 이 구성을 추천하지 않으며 기존 설정을 자동 수정하지 않습니다.'] : adaptive.reasons,
      evidenceCount: adaptive.evidenceCount,
      strengthCount: adaptive.strengthCount,
      // This panel cannot apply a stale proposal; the existing home confirmation
      // path recomputes records, settings and preparation checks before applying.
      change: !held && adaptive.change ? {
        before: adaptive.change.before, after: adaptive.change.after,
        preparation: adaptive.preparation,
      } : undefined,
    },
    composition: held ? undefined : {
      planName: program.selectedPlan.name,
      strengthDays: program.summary.strengthDays,
      recoveryDays: program.summary.recoveryDays,
      cardioDays: program.summary.cardioDays,
      coreDays: program.summary.coreDays,
      restDays: program.summary.restDays,
    },
    evidence,
    bodyRationale: evidence.length
      ? '비교 가능한 체성분 수치를 운동 기록과 함께 검토할 참고 근거로 연결했습니다. 수치 변화가 운동 타입·구성 변경의 원인이라는 뜻은 아닙니다.'
      : '비교 가능한 체성분 근거가 부족합니다. 누락·오래된 값·호환되지 않는 출처를 추천의 근거로 보충하지 않았습니다.',
    decisionBoundary: '운동 타입·구성 제안은 기존 수행·컨디션·통증·피로 규칙으로 계산합니다. 체성분 수치나 BMI만으로 운동 종류·중량·횟수를 정하지 않습니다. 변경은 운동 홈에서 최신 기록과 준비 조건을 다시 확인한 뒤 직접 선택합니다.',
  };
}
export type BodyWorkoutReview = ReturnType<typeof buildBodyWorkoutReview>;
