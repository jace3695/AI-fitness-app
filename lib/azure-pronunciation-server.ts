// Server-only integration. No default usage ledger, credential lookup or network fallback.
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { AssessmentResult } from '../app/language/practice/assessment.ts';

export const AZURE_ASSESSMENT_POLICY = 'azure-ja-accuracy-fluency-v1';
export const AZURE_TRIAL_DATA_POLICY='trial-metadata-policy-v1'; // Proposed contract; not evidence of approval.
const MAX_WAV = 44 + 16000 * 2 * 30;
const MAX_BODY = Math.ceil(MAX_WAV / 3) * 4 + 12000;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
export class PronunciationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
const fail = (status: number, code: string): never => { throw new PronunciationError(status, code); };
export type AzureAssessmentEnvironment = Readonly<{
  [name: string]: string | undefined;
  AZURE_SPEECH_ASSESSMENT_ENABLED?: string; AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string; AZURE_SPEECH_RESOURCE_NAME?: string;
  VERCEL_ENV?: string; VERCEL_GIT_COMMIT_REF?: string;
}>;
/** An implementation must atomically consume BOTH shared and owner limits and
 * permanently deduplicate owner+requestId. Never refund uncertain/aborted calls.
 * The live route deliberately does not wire the draft adapter: envs alone never enable it.
 */
export type AssessmentUsageLedger = Readonly<{
  durable: true;
  consume(input: Readonly<{ owner: string; requestId: string; fingerprint: string; durationMs: number;resourceName:string;region:string }>, signal: AbortSignal): Promise<'accepted' | 'duplicate' | 'limit' | 'busy'>;
  isReady?(signal:AbortSignal):Promise<boolean>;
  settle?(input:Readonly<{owner:string;requestId:string}>,signal:AbortSignal):Promise<boolean>;
}>;
export type AzureAssessmentDependencies = Readonly<{
  env: AzureAssessmentEnvironment;
  authenticate(signal: AbortSignal): Promise<string | null>;
  usage?: AssessmentUsageLedger;
  usageForOwner?(owner:string):AssessmentUsageLedger;
  request: typeof fetch;
}>;

function config(env: AzureAssessmentEnvironment) {
  if (env.AZURE_SPEECH_ASSESSMENT_ENABLED !== 'true' || env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== 'agent/fitness-record-priority') return fail(503, 'unavailable');
  if (env.AZURE_SPEECH_REGION !== 'koreacentral' || !env.AZURE_SPEECH_KEY || !/^[A-Za-z0-9]{16,128}$/.test(env.AZURE_SPEECH_KEY) || !env.AZURE_SPEECH_RESOURCE_NAME || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(env.AZURE_SPEECH_RESOURCE_NAME)) return fail(503, 'unavailable');
  if(!env.AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(env.AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID)||env.AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID!==AZURE_TRIAL_DATA_POLICY)return fail(503,'unavailable');
  return { key: env.AZURE_SPEECH_KEY, host: `${env.AZURE_SPEECH_RESOURCE_NAME}.cognitiveservices.azure.com`,resourceName:env.AZURE_SPEECH_RESOURCE_NAME,region:env.AZURE_SPEECH_REGION,owner:env.AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID };
}

/** Initial supported subset: canonical 44-byte WAV header, PCM16 mono 16kHz.
 * WebM, MP4, compressed WAV and extra RIFF chunks require a separately reviewed decoder.
 */
export function validateAssessmentWav(bytes: Uint8Array): number {
  if (bytes.length < 46 || bytes.length > MAX_WAV) return fail(422, 'audio-format');
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.readUInt32LE(4) !== b.length - 8 || b.toString('ascii', 8, 12) !== 'WAVE' || b.toString('ascii', 12, 16) !== 'fmt ' || b.readUInt32LE(16) !== 16 || b.readUInt16LE(20) !== 1 || b.readUInt16LE(22) !== 1 || b.readUInt32LE(24) !== 16000 || b.readUInt32LE(28) !== 32000 || b.readUInt16LE(32) !== 2 || b.readUInt16LE(34) !== 16 || b.toString('ascii', 36, 40) !== 'data' || b.readUInt32LE(40) !== b.length - 44 || (b.length - 44) % 2) return fail(422, 'audio-format');
  return (b.length - 44) / 32;
}

async function boundedBytes(stream: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!stream) return fail(400, 'invalid-input');
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const next = await reader.read(); signal.throwIfAborted(); if (next.done) break;
      length += next.value.length; if (length > limit) return fail(413, 'too-large'); chunks.push(next.value);
    }
    return Buffer.concat(chunks, length);
  } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}

function parseEnvelope(bytes: Uint8Array) {
  let value: unknown; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail(400, 'invalid-input'); }
  if (!object(value) || !exact(value, ['requestId', 'language', 'referenceText', 'audioMime', 'audioBase64', 'consent']) || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.requestId) || value.language !== 'ja-JP' || typeof value.referenceText !== 'string' || !value.referenceText.trim() || value.referenceText.length > 1000 || value.audioMime !== 'audio/wav' || typeof value.audioBase64 !== 'string') return fail(400, 'invalid-input');
  const consent = value.consent;
  if (!object(consent) || !exact(consent, ['confirmed', 'requestId', 'providerId', 'policyVersion']) || consent.confirmed !== true || consent.requestId !== value.requestId || consent.providerId !== 'azure-speech' || consent.policyVersion !== AZURE_ASSESSMENT_POLICY) return fail(400, 'consent-required');
  if (value.audioBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.audioBase64)) return fail(400, 'invalid-input');
  const audio = Buffer.from(value.audioBase64, 'base64');
  if (audio.toString('base64') !== value.audioBase64) return fail(400, 'invalid-input');
  const durationMs = validateAssessmentWav(audio);
  return { requestId: value.requestId, referenceText: value.referenceText.trim(), audio, durationMs };
}

export function mapAzureAssessment(value: unknown, requestId: string): AssessmentResult {
  if (!object(value) || value.RecognitionStatus !== 'Success' || !Array.isArray(value.NBest) || !object(value.NBest[0])) return fail(422, 'no-score');
  const best = value.NBest[0];
  // REST short-audio returns top-level scores in NBest; SDK-shaped blocks aren't guessed.
  const accuracy = best.AccuracyScore, fluency = best.FluencyScore;
  if (typeof accuracy !== 'number' || typeof fluency !== 'number' || ![accuracy, fluency].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) return fail(422, 'no-score');
  return { requestId, providerId: 'azure-speech', language: 'ja-JP', source: 'provider-assessment', metrics: [{ name: 'accuracy', value: accuracy, min: 0, max: 100 }, { name: 'fluency', value: fluency, min: 0, max: 100 }] };
}

const notices: Record<string, string> = {
  'trial-only':'이번 시험은 지정된 계정에서 こんにちは。를 5초 이내로 녹음한 한 번만 확인해요. 다른 음성은 보내지 않았어요.',
  unavailable: '발음 채점은 아직 준비 중이에요. 녹음을 보내지 않았어요.',
  'login-required': '로그인을 확인해 주세요. 녹음을 보내지 않았어요.',
  'account-changed': '로그인 상태가 바뀌었어요. 다시 확인해 주세요.',
  'invalid-input': '연습 문장과 녹음 형식을 확인해 주세요.',
  'audio-format': '지금은 30초 이내의 WAV 녹음만 준비돼 있어요. 다른 형식은 보내지 않았어요.',
  'consent-required': '이번 녹음의 전송 안내와 동의를 확인해 주세요.',
  'too-large': '녹음이 너무 커서 보내지 않았어요.',
  'wrong-origin': '이 화면에서는 녹음을 보낼 수 없어요.',
  duplicate: '같은 요청을 다시 보내지 않았어요. 이전 결과를 확인해 주세요.',
  limit: '사용 한도를 확인할 수 없거나 한도에 도달했어요. 녹음을 보내지 않았어요.',
  busy: '이전 평가의 종료를 확인 중이에요. 녹음을 다시 보내지 않았어요.',
  'usage-pending': '평가 후 요청 정리를 확인하지 못했어요. 다시 보내지 않아요.',
  'no-score': '발음 점수를 확인하지 못했어요. 자동으로 다시 보내지 않아요.',
  interrupted: '기다리기를 멈췄어요. 이미 전달된 녹음의 서버 처리 종료를 뜻하지는 않아요.',
  failed: '결과를 확인하지 못했어요. 자동으로 다시 보내지 않아요.',
};

export function createAzureAssessmentHandler(deps: AzureAssessmentDependencies) {
  return async (request: Request): Promise<Response> => {
    const controller = new AbortController(); let expired = false;
    const onAbort = () => controller.abort(); request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) controller.abort();
    const timer = setTimeout(() => { expired = true; controller.abort(); }, 30000);
    const respond = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
    let abortListener: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => { abortListener = () => reject(new PronunciationError(504, 'interrupted')); controller.signal.addEventListener('abort', abortListener, { once: true }); if (controller.signal.aborted) abortListener(); });
    const active = () => controller.signal.throwIfAborted();
    let reservation:{owner:string;requestId:string}|null=null,providerStarted=false,providerFinished=false,settled=false,settleAttempted=false,ledger=deps.usage;
    try {
      const work = async () => {
        active(); const cfg = config(deps.env);
        // An environment flag cannot replace the missing shared durable limiter.
        if(!deps.usageForOwner&&(!ledger||ledger.durable!==true||!ledger.isReady||!ledger.settle))return fail(503,'unavailable');
        const sameOrigin=request.headers.get('origin')===new URL(request.url).origin;
        const sameSiteGet=request.method==='GET'&&!request.headers.has('origin')&&request.headers.get('sec-fetch-site')==='same-origin';
        if (!sameOrigin&&!sameSiteGet) return fail(403, 'wrong-origin');
        const owner = await deps.authenticate(controller.signal); active(); if (!owner) return fail(401, 'login-required');
        if(owner!==cfg.owner)return fail(403,'unavailable');
        ledger=deps.usageForOwner?deps.usageForOwner(owner):ledger;
        if(!ledger||ledger.durable!==true||!ledger.isReady||!ledger.settle)return fail(503,'unavailable');
        if(request.method==='GET'){
          const available=await ledger.isReady(controller.signal);active();
          return respond({available,providerId:'azure-speech',policyVersion:AZURE_ASSESSMENT_POLICY,region:'koreacentral'},200);
        }
        if(request.method!=='POST')return fail(400,'invalid-input');
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return fail(400, 'invalid-input');
        const input = parseEnvelope(await boundedBytes(request.body, MAX_BODY, controller.signal)); active();
        if(input.referenceText!=='こんにちは。'||input.durationMs>5000)return fail(422,'trial-only');
        const fingerprint = createHash('sha256').update(input.referenceText).update('\0').update(input.audio).digest('hex');
        const usage = await ledger.consume({ owner, requestId: input.requestId, fingerprint, durationMs: input.durationMs,resourceName:cfg.resourceName,region:cfg.region }, controller.signal); active();
        if (usage !== 'accepted') return fail(409, usage === 'duplicate' ? 'duplicate' : usage==='busy'?'busy':'limit');
        reservation={owner,requestId:input.requestId};
        if (await deps.authenticate(controller.signal) !== owner) return fail(401, 'account-changed'); active();
        const headers = { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json', 'Pronunciation-Assessment': Buffer.from(JSON.stringify({ ReferenceText: input.referenceText, GradingSystem: 'HundredMark', Granularity: 'FullText', Dimension: 'Comprehensive', EnableProsodyAssessment: false })).toString('base64') };
        providerStarted=true;
        const response = await deps.request(`https://${cfg.host}/stt/speech/recognition/conversation/cognitiveservices/v1?language=ja-JP&format=detailed`, { method: 'POST', headers, body: new Uint8Array(input.audio), signal: controller.signal, redirect: 'error' }); active();
        if (!response.ok) { void response.body?.cancel().catch(() => {}); return fail(503, 'failed'); }
        let raw: unknown; try { const bytes=await boundedBytes(response.body,256000,controller.signal);providerFinished=true;raw=JSON.parse(new TextDecoder().decode(bytes)); } catch { return fail(422, 'no-score'); }
        active();const result=mapAzureAssessment(raw,input.requestId);
        settleAttempted=true;settled=await ledger.settle(reservation,controller.signal);active();if(!settled)return fail(503,'usage-pending');
        return respond(result,200);
      };
      return await Promise.race([work(), cancelled]);
    } catch (error) {
      // Release only when never dispatched or the entire provider response finished.
      // Lost/aborted/uncertain work keeps the durable lease; no automatic expiry.
      if(reservation&&!settled&&!settleAttempted&&(!providerStarted||providerFinished)&&!controller.signal.aborted&&ledger?.settle){try{settleAttempted=true;settled=await Promise.race([ledger.settle(reservation,controller.signal),cancelled]);}catch{/* Remains blocked if cleanup cannot be confirmed. */}}
      const e = controller.signal.aborted || expired ? new PronunciationError(504, 'interrupted') : error instanceof PronunciationError ? error : new PronunciationError(503, 'failed');
      return respond({ error: notices[e.code] ?? notices.failed, code: e.code }, e.status);
    } finally { clearTimeout(timer); request.signal.removeEventListener('abort', onAbort); if (abortListener) controller.signal.removeEventListener('abort', abortListener); controller.abort(); }
  };
}
