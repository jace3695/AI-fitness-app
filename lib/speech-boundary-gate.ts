import 'server-only';
import { createHash } from 'node:crypto';
import { SUPABASE_URL } from './supabase-config.ts';

/** Server-only visibility gate. Never serialize the configured account ID. */
export function speechBoundaryOwnerHash(env: Readonly<Record<string, string | undefined>>) {
  const owner = env.AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID;
  if (env.VERCEL_ENV !== 'preview'
    || env.VERCEL_GIT_COMMIT_REF !== 'agent/fitness-record-priority'
    || env.NEXT_PUBLIC_SUPABASE_URL !== SUPABASE_URL
    || env.NEXT_PUBLIC_SUPABASE_URL !== 'https://piqqukiiacncfbztktga.supabase.co'
    || env.YEONI_SPEECH_API_SCHEMA !== 'yeoni_speech_proof_candidate'
    || env.AZURE_SPEECH_ASSESSMENT_ENABLED !== 'false'
    || env.YEONI_SPEECH_API_BOUNDARY_REVIEWED
    || env.AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID
    || !owner || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(owner)) return null;
  return createHash('sha256').update(owner).digest('hex');
}
