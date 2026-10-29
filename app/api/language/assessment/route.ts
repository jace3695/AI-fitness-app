import {createServerSupabaseClient} from '@/lib/supabase-server';
import {createSpeechRetentionApiAssessmentRoute} from '@/lib/speech-retention-api-route';

export const runtime='nodejs';
export const dynamic='force-dynamic';

// V2 remains unavailable while retention/cleanup policy is null or unreviewed.
// Source wiring only: no migration, activation, scheduler or deployment is performed.
// No direct DB login, administrator key, or fallback path.
export async function POST(request:Request){
 return createSpeechRetentionApiAssessmentRoute({env:process.env,createClient:createServerSupabaseClient,request:fetch})(request);
}
export const GET=POST;
