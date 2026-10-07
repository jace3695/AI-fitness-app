import { characterReplyEnabled } from './reply-plan.ts';

/** App rollout only; review pages keep their independent Preview restriction. */
export function assistantCharacterEnabled(env: Record<string, string | undefined>) {
  if (env.YEONI_ASSISTANT_CHARACTER_ENABLED === '0') return false;
  if (characterReplyEnabled(env)) return true;
  return env.VERCEL_ENV === 'production' && env.YEONI_ASSISTANT_CHARACTER_ENABLED === '1';
}
