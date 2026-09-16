import type { SupabaseClient } from '@supabase/supabase-js';
import { isWorkoutCommandProposal, workoutDaySnapshot, workoutRecordStatus, type WorkoutCommandProposal } from './assistant-workout-command.ts';

export async function proposeWorkoutCompletion(db: SupabaseClient, owner: string, date: string): Promise<WorkoutCommandProposal | null> {
  const { data, error } = await db.from('user_app_state').select('state').eq('user_id', owner).maybeSingle();
  if (error) throw new Error('운동 기록을 확인하지 못했습니다. 다시 시도해 주세요.');
  const state = data?.state ?? {};
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('운동 기록 형식을 확인하지 못했습니다.');
  const expected = workoutDaySnapshot(state, date);
  const status = workoutRecordStatus(expected);
  if (status === 'completed') return null;
  if (status === 'detailed') throw new Error('오늘의 수행·통증 등 상세 기록이 있습니다. 운동 화면에서 확인하고 수정해 주세요.');
  const proposal: WorkoutCommandProposal = {
    domain: 'workout', ownerId: owner, requestId: crypto.randomUUID(), date, expected,
    resetMarkers: { fitness: state['ai-fitness-record-reset-fitness'] ?? null, assistant: state['ai-fitness-record-reset-assistant'] ?? null },
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  if (!isWorkoutCommandProposal(proposal)) throw new Error('확인할 운동 기록을 준비하지 못했습니다. 운동 화면에서 확인해 주세요.');
  return proposal;
}
