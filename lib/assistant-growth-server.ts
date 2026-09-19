import type { SupabaseClient } from '@supabase/supabase-js';
import { GROWTH_ROUTINE_FIELDS, isGrowthCommandProposal, selectGrowthRoutine, type GrowthCompletion, type GrowthCommandProposal, type GrowthRoutineSnapshot } from './assistant-growth-command.ts';

export async function proposeGrowthCompletion(db: SupabaseClient, owner: string, date: string, command: GrowthCompletion): Promise<GrowthCommandProposal> {
  const [routines, state] = await Promise.all([
    db.from('growth_routines').select(GROWTH_ROUTINE_FIELDS).eq('user_id', owner).eq('enabled', true),
    db.from('user_app_state').select('state').eq('user_id', owner).maybeSingle(),
  ]);
  if (routines.error || state.error) throw new Error('자기계발 루틴과 기록 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
  const expected = selectGrowthRoutine(routines.data as unknown as GrowthRoutineSnapshot[], command.target);
  const sessions = await db.from('growth_sessions').select('id,status').eq('user_id', owner).eq('routine_id', expected.id).eq('session_date', date).limit(1);
  if (sessions.error) throw new Error('오늘 자기계발 기록을 확인하지 못했습니다. 다시 시도해 주세요.');
  if (sessions.data?.length) throw new Error('오늘 이 루틴의 기록이 이미 있습니다. 자기계발 화면에서 확인해 주세요. 기존 완료·일부 수행·중단 기록은 변경하지 않았습니다.');
  const current = state.data?.state ?? {};
  if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('기록 상태를 확인하지 못했습니다.');
  const proposal: GrowthCommandProposal = {
    domain: 'growth', ownerId: owner, requestId: crypto.randomUUID(), date, expected, actualMinutes: command.actualMinutes,
    resetMarkers: { growth: current['ai-fitness-record-reset-growth'] ?? null, assistant: current['ai-fitness-record-reset-assistant'] ?? null },
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  if (!isGrowthCommandProposal(proposal)) throw new Error('자기계발 확인 내용을 준비하지 못했습니다. 자기계발 화면에서 확인해 주세요.');
  return proposal;
}
