import {nextWorkoutFeedbackSnapshot,type WorkoutFeedbackChange} from './assistant-workout-feedback-command.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isWorkoutCommandProposal, workoutDaySnapshot, workoutRecordStatus, type WorkoutCommandProposal } from './assistant-workout-command.ts';
import { nextWorkoutCardioSnapshot, type WorkoutCardioChange } from './assistant-workout-cardio-command.ts';

export async function proposeWorkoutCommand(db: SupabaseClient, owner: string, date: string, change?: WorkoutCardioChange | WorkoutFeedbackChange): Promise<WorkoutCommandProposal | null> {
  const { data, error } = await db.from('user_app_state').select('state').eq('user_id', owner).maybeSingle();
  if (error) throw new Error('운동 기록을 확인하지 못했습니다. 다시 시도해 주세요.');
  const state = data?.state ?? {};
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('운동 기록 형식을 확인하지 못했습니다.');
  const expected = workoutDaySnapshot(state, date);
  const status = workoutRecordStatus(expected);
  if (change) {
    const next = change.kind==='feedback'?nextWorkoutFeedbackSnapshot(expected,change):nextWorkoutCardioSnapshot(expected, change);
    // A read-only capability check keeps older deployments usable while the
    // additive database migration is awaiting approval or being rolled out.
    const validation = await db.rpc(change.kind==='feedback'?'assistant_workout_feedback_next':'assistant_workout_cardio_next', { p_snapshot: expected, p_change: change });
    if (validation.error) throw new Error(validation.error.code === 'PGRST202'
      ? '운동 상세 명령 저장은 아직 준비 중입니다. 운동 화면에서 기록해 주세요.'
      : '유산소 기록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    if (JSON.stringify(next) === JSON.stringify(expected)) return null;
  } else {
    if (status === 'completed') return null;
    if (status === 'detailed') throw new Error('오늘의 수행·통증 등 상세 기록이 있습니다. 운동 화면에서 확인하고 수정해 주세요.');
  }
  const proposal: WorkoutCommandProposal = {
    domain: 'workout', ownerId: owner, requestId: crypto.randomUUID(), date, expected,
    resetMarkers: { fitness: state['ai-fitness-record-reset-fitness'] ?? null, assistant: state['ai-fitness-record-reset-assistant'] ?? null },
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    ...(change ? { change } : {}),
  };
  if (!isWorkoutCommandProposal(proposal)) throw new Error('확인할 운동 기록을 준비하지 못했습니다. 운동 화면에서 확인해 주세요.');
  return proposal;
}
