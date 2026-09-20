import { assertPastMealTime } from './diet-time.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dietDaySnapshot, dietNextSnapshot, isDietCommandProposal, type DietCommandChange, type DietCommandProposal } from './assistant-diet-command.ts';

export async function proposeDietCommand(db: SupabaseClient, owner: string, date: string, change: DietCommandChange): Promise<DietCommandProposal> {
  if (change.kind === 'time') assertPastMealTime(date, change.time);
  const { data, error } = await db.from('user_app_state').select('state').eq('user_id', owner).maybeSingle();
  if (error) throw new Error('식단 기록을 확인하지 못했습니다. 다시 시도해 주세요.');
  const state = data?.state ?? {};
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('식단 기록 형식을 확인하지 못했습니다.');
  const expected = dietDaySnapshot(state, date, change);
  dietNextSnapshot(expected, change, date);
  const proposal: DietCommandProposal = {
    domain: 'diet', ownerId: owner, requestId: crypto.randomUUID(), date, change, expected,
    resetMarkers: { diet: state['ai-fitness-record-reset-diet'] ?? null, assistant: state['ai-fitness-record-reset-assistant'] ?? null },
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  if (!isDietCommandProposal(proposal)) throw new Error('확인할 식단 기록을 준비하지 못했습니다. 식단 화면에서 확인해 주세요.');
  return proposal;
}
