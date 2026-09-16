import type { SupabaseClient } from '@supabase/supabase-js';
import { isLanguageCommandProposal, languageCompletedIds, languageRecords, type LanguageCommandProposal, type LanguageRoutine } from './assistant-language-command.ts';

export async function proposeLanguageCompletion(db: SupabaseClient, owner: string, date: string, routineId: LanguageRoutine): Promise<LanguageCommandProposal | null> {
  const [language, assistant] = await Promise.all([
    db.from('language_user_state').select('state').eq('user_id', owner).maybeSingle(),
    db.from('user_app_state').select('state').eq('user_id', owner).maybeSingle(),
  ]);
  if (language.error || assistant.error) throw new Error('학습 기록을 확인하지 못했습니다. 다시 시도해 주세요.');
  const state = language.data?.state ?? {};
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('학습 기록 형식을 확인하지 못했습니다.');
  const expected = languageRecords(state);
  if (languageCompletedIds(expected, date).includes(routineId)) return null;
  const proposal: LanguageCommandProposal = {
    domain: 'language', ownerId: owner, requestId: crypto.randomUUID(), routineId, date, expected,
    resetMarkers: { language: state.languageRecordResetV1 ?? null, assistant: assistant.data?.state?.['ai-fitness-record-reset-assistant'] ?? null },
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  if (!isLanguageCommandProposal(proposal)) throw new Error('확인할 학습 기록을 준비하지 못했습니다. 언어 화면에서 기록을 확인해 주세요.');
  return proposal;
}
