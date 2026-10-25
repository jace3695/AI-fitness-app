import { ASSESSMENT_LIMITS, validateAssessmentPolicy, validateAssessmentRequest, validateAssessmentResult, type AssessmentPolicy, type AssessmentRequest, type AssessmentTransport } from './assessment.ts';

/** Trusted, explicitly configured integration seam. No SDK, endpoint or default driver. */
export type DecodedAssessmentAudio = Readonly<{ samples: Float32Array; sampleRate: number; channels: 1 }>;
export type AssessmentDriver = Readonly<{
  policy: AssessmentPolicy;
  decode: (audio: Blob, signal: AbortSignal) => Promise<DecodedAssessmentAudio>;
  evaluate: (input: Readonly<{ referenceText: string; language: 'ja-JP'; audio: DecodedAssessmentAudio }>, signal: AbortSignal) => Promise<unknown>;
}>;

function assertActive(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Assessment cancelled');
}

/** Use only behind AssessmentSession's owner/consent/timeout gate.
 * A driver policy is a capability declaration, never permission to transmit.
 * Decoder/SDK resources must be released by the driver on success, failure and abort.
 */
export function createAssessmentAdapter(driver: AssessmentDriver): AssessmentTransport {
  const policy = validateAssessmentPolicy(driver.policy);
  if (policy.metrics.length !== 2 || !policy.metrics.includes('accuracy') || !policy.metrics.includes('fluency')) throw new Error('Accuracy and fluency support required');
  return async (value: AssessmentRequest, signal: AbortSignal) => {
    assertActive(signal);
    const request = validateAssessmentRequest(value, policy);
    const audio = await driver.decode(request.audio, signal);
    assertActive(signal);
    // Do not trust MIME metadata or the client-reported duration as decoded evidence.
    if (!(audio.samples instanceof Float32Array) || !Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 48000 || audio.channels !== 1 || !audio.samples.length || audio.samples.length > audio.sampleRate * ASSESSMENT_LIMITS.maxDurationMs / 1000 || audio.samples.some(sample => !Number.isFinite(sample) || Math.abs(sample) > 1)) throw new Error('Unsupported decoded audio');
    const raw = await driver.evaluate({ referenceText: request.referenceText, language: 'ja-JP', audio }, signal);
    assertActive(signal);
    const result = validateAssessmentResult(raw, request, policy);
    if (result.metrics.length !== 2) throw new Error('Incomplete assessment');
    return result;
  };
}
