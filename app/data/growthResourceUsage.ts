import type { SupabaseClient } from '@supabase/supabase-js';
import type { GrowthResourceRow } from './growthPlatform.ts';

const DAY = 86_400_000;

export function resourceToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function validResourceUsageDate(value: string | null, today = resourceToday()) {
  return value === null || (validDate(value) && validDate(today) && value <= today);
}

export function resourceUsage(value: string | null | undefined, today = resourceToday()) {
  if (!value) return { kind: 'unknown' as const, label: '활용일 미기록' };
  if (!validResourceUsageDate(value, today)) return { kind: 'unknown' as const, label: '활용일 확인 필요' };
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${value}T00:00:00Z`)) / DAY);
  return { kind: days >= 30 ? 'revisit' as const : 'recent' as const, label: `마지막 활용일 ${value}`, days };
}

export type UsageResult =
  | { kind: 'confirmed' | 'changed'; row: GrowthResourceRow }
  | { kind: 'uncertain' | 'missing' | 'invalid' };

// Read-only recovery: never repeat a write when its response was lost.
export async function confirmResourceUsage(client: SupabaseClient, owner: string, id: string, desired: string | null): Promise<UsageResult> {
  try {
    const { data, error } = await client.from('growth_resources').select('*').eq('user_id', owner).eq('id', id).abortSignal(AbortSignal.timeout(15_000)).maybeSingle();
    if (error) return { kind: 'uncertain' };
    if (!data) return { kind: 'missing' };
    return { kind: data.last_used_on === desired ? 'confirmed' : 'changed', row: data as GrowthResourceRow };
  } catch { return { kind: 'uncertain' }; }
}

export async function saveResourceUsage(client: SupabaseClient, owner: string, previous: GrowthResourceRow, desired: string | null): Promise<UsageResult> {
  if (previous.user_id !== owner || !Object.hasOwn(previous, 'last_used_on') || !validResourceUsageDate(desired)) return { kind: 'invalid' };
  try {
    let update = client.from('growth_resources').update({ last_used_on: desired, updated_at: new Date().toISOString() })
      .eq('user_id', owner).eq('id', previous.id).eq('updated_at', previous.updated_at);
    update = previous.last_used_on == null ? update.is('last_used_on', null) : update.eq('last_used_on', previous.last_used_on);
    await update.abortSignal(AbortSignal.timeout(15_000));
  } catch { /* The server may have committed; inspect the stored value below. */ }
  return confirmResourceUsage(client, owner, previous.id, desired);
}
