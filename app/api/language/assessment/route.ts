import {createServerSupabaseClient} from '@/lib/supabase-server';
import {createSpeechApiAssessmentRoute} from '@/lib/speech-api-route';

export const runtime='nodejs';
export const dynamic='force-dynamic';

// Disabled until separately reviewed Data API boundary, policy and secrets exist.
// No direct DB login, administrator key, or fallback path.
export async function POST(request:Request){
 return createSpeechApiAssessmentRoute({env:process.env,createClient:createServerSupabaseClient,request:fetch})(request);
}
export const GET=POST;
