/** Local integration contract only. No provider, credential, recording or upload is created here. */
export const ASSESSMENT_LIMITS = Object.freeze({ language: 'ja-JP', maxDurationMs: 30_000, maxBytes: 5 * 1024 * 1024, maxText: 1000, waitMs: 30_000 });
export type AssessmentMetric = 'accuracy' | 'fluency';
export type AssessmentPolicy = Readonly<{ providerId: string; version: string; language: 'ja-JP'; mimeTypes: readonly string[]; metrics: readonly AssessmentMetric[] }>;
export type AssessmentRequest = Readonly<{ requestId: string; language: 'ja-JP'; referenceText: string; audio: Blob; durationMs: number }>;
export type AssessmentConsent = Readonly<{ confirmed: true; requestId: string; providerId: string; policyVersion: string }>;
export type AssessmentResult = Readonly<{ requestId: string; providerId: string; language: 'ja-JP'; source: 'provider-assessment'; metrics: readonly Readonly<{ name: AssessmentMetric; value: number; min: number; max: number }>[] }>;
export type AssessmentTransport = (request: AssessmentRequest, signal: AbortSignal) => Promise<unknown>;
export type AssessmentState = Readonly<{ status: 'unavailable' | 'idle' | 'waiting' | 'ready' | 'error' | 'cancelled'; notice: string; result: AssessmentResult | null }>;
const mimeTypes = new Set(['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav']);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);

export function validateAssessmentPolicy(value: unknown): AssessmentPolicy {
  if (!object(value) || !keys(value, ['providerId', 'version', 'language', 'mimeTypes', 'metrics']) || !id(value.providerId) || !id(value.version) || value.language !== 'ja-JP' ||
    !Array.isArray(value.mimeTypes) || !value.mimeTypes.length || value.mimeTypes.some(t => typeof t !== 'string' || !mimeTypes.has(t)) ||
    !Array.isArray(value.metrics) || !value.metrics.length || value.metrics.some(m => m !== 'accuracy' && m !== 'fluency') || new Set(value.metrics).size !== value.metrics.length) throw Error('발음 평가 연결 정보를 확인해 주세요.');
  return Object.freeze({ providerId: value.providerId, version: value.version, language: 'ja-JP', mimeTypes: Object.freeze([...value.mimeTypes]), metrics: Object.freeze([...value.metrics]) });
}
export function validateAssessmentRequest(value: unknown, policy: AssessmentPolicy): AssessmentRequest {
  if (!object(value) || !keys(value, ['requestId', 'language', 'referenceText', 'audio', 'durationMs']) || !id(value.requestId) || value.language !== policy.language ||
    typeof value.referenceText !== 'string' || !value.referenceText.trim() || value.referenceText.length > ASSESSMENT_LIMITS.maxText ||
    !(value.audio instanceof Blob) || value.audio.size < 1 || value.audio.size > ASSESSMENT_LIMITS.maxBytes || !policy.mimeTypes.includes(value.audio.type) ||
    typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs <= 0 || value.durationMs > ASSESSMENT_LIMITS.maxDurationMs) throw Error('문장과 녹음 길이·형식을 확인해 주세요.');
  return Object.freeze({ requestId: value.requestId, language: 'ja-JP', referenceText: value.referenceText.trim(), audio: value.audio, durationMs: value.durationMs });
}
export function validateAssessmentResult(value: unknown, request: AssessmentRequest, policy: AssessmentPolicy): AssessmentResult {
  if (!object(value) || !keys(value, ['requestId', 'providerId', 'language', 'source', 'metrics']) || value.requestId !== request.requestId || value.providerId !== policy.providerId || value.language !== 'ja-JP' || value.source !== 'provider-assessment' || !Array.isArray(value.metrics) || !value.metrics.length || value.metrics.length > policy.metrics.length) throw Error('평가 결과를 확인하지 못했어요.');
  const seen = new Set<string>();
  const metrics = value.metrics.map(m => {
    if (!object(m) || !keys(m, ['name', 'value', 'min', 'max']) || !policy.metrics.includes(m.name as AssessmentMetric) || seen.has(m.name as string) ||
      typeof m.value !== 'number' || typeof m.min !== 'number' || typeof m.max !== 'number' || ![m.value, m.min, m.max].every(Number.isFinite) || m.min >= m.max || m.value < m.min || m.value > m.max) throw Error('평가 결과를 확인하지 못했어요.');
    seen.add(m.name as string);return Object.freeze({ name: m.name as AssessmentMetric, value: m.value, min: m.min, max: m.max });
  });
  return Object.freeze({ requestId: request.requestId, providerId: policy.providerId, language: 'ja-JP', source: 'provider-assessment', metrics: Object.freeze(metrics) });
}

/** Mount per account; call setOwner on account change and dispose on page exit.
 * A future trusted adapter must validate actual decoded audio and provider capabilities again.
 * Policy injection is not authorization to transmit. No built-in transport exists. */
export class AssessmentSession {
  private state: AssessmentState;
  private policy?: AssessmentPolicy;
  private pending: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private used = new Set<string>();
  private owner: string | null;
  private transport?: AssessmentTransport;
  constructor(owner: string | null, transport?: AssessmentTransport, policy?: AssessmentPolicy) {
    this.owner = owner;this.transport = transport;
    if (policy && transport) this.policy = validateAssessmentPolicy(policy);
    this.state = this.empty();
  }
  private empty(): AssessmentState { return Object.freeze({ status: this.policy ? 'idle' : 'unavailable', notice: this.policy ? '' : '발음 평가 서비스는 아직 정하지 않았어요. 지금은 녹음하고 직접 들어볼 수 있어요.', result: null }); }
  snapshot() { return this.state; }
  setOwner(owner: string | null) {
    if (owner === this.owner) return;
    this.cancel();this.owner = owner;this.used.clear();this.state = this.empty();
  }
  cancel() {
    ++this.generation;this.pending?.abort();this.pending = null;
    this.state = Object.freeze({ status: 'cancelled', notice: '기다리기를 멈췄어요. 이미 전달된 녹음의 처리 종료까지 보장하지는 않아요.', result: null });
  }
  dispose() { this.cancel();this.disposed = true;this.owner = null;this.used.clear();this.state = this.empty(); }
  async assess(value: unknown, consent: unknown): Promise<AssessmentState> {
    if (this.disposed || !this.owner || !this.policy || !this.transport || this.pending) return this.state;
    let request: AssessmentRequest;
    try {
      request = validateAssessmentRequest(value, this.policy);
      if (!object(consent) || !keys(consent, ['confirmed', 'requestId', 'providerId', 'policyVersion']) || consent.confirmed !== true || consent.requestId !== request.requestId || consent.providerId !== this.policy.providerId || consent.policyVersion !== this.policy.version) throw Error('이번 녹음을 어디에 보낼지 확인하고 동의해 주세요.');
      if (this.used.has(request.requestId) || this.used.size >= 100) throw Error('같은 평가를 다시 보내지 않았어요. 새 요청은 내용을 확인한 뒤 시작해 주세요.');
    } catch (e) { this.state = Object.freeze({ status: 'error', notice: (e as Error).message, result: null });return this.state; }
    this.used.add(request.requestId);
    const controller = new AbortController(), ticket = ++this.generation, owner = this.owner;
    this.pending = controller;this.state = Object.freeze({ status: 'waiting', notice: '평가 결과를 기다려요.', result: null });
    let expired = false;
    let abort: () => void = () => {};
    const timer = setTimeout(() => { expired = true;controller.abort(); }, ASSESSMENT_LIMITS.waitMs);
    const current = () => !this.disposed && this.owner === owner && ticket === this.generation;
    try {
      const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new Error('cancelled'));controller.signal.addEventListener('abort', abort, { once: true }); });
      const result = await Promise.race([this.transport(request, controller.signal), cancelled]);
      if (current() && !controller.signal.aborted) this.state = Object.freeze({ status: 'ready', notice: '받은 평가 결과예요. 지원되는 항목만 확인해 주세요.', result: validateAssessmentResult(result, request, this.policy) });
    } catch {
      if (current()) this.state = Object.freeze({ status: 'error', notice: expired ? '시간이 지나 결과를 확인하지 못했어요. 자동으로 다시 보내지 않아요.' : '평가 결과를 확인하지 못했어요. 자동으로 다시 보내지 않아요.', result: null });
    } finally {
      clearTimeout(timer);controller.signal.removeEventListener('abort', abort);
      if (this.pending === controller) this.pending = null;
    }
    return current() ? this.state : Object.freeze({ status: 'cancelled', notice: '이전 요청을 사용하지 않아요.', result: null });
  }
}
