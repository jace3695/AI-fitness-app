import { CHARACTER_EMOTIONS, CHARACTER_GESTURES, type CharacterEmotion, type CharacterGesture } from './character-expression.ts';
import { GEMINI_ZEPHYR_VOICE, type LipSyncManifest } from './lip-sync.ts';

/** Final text only. Rules describe presentation, not model-inferred feelings. */
export type ReplyPlan = Readonly<{
  version: 1; responseId: string; spokenText: string;
  language: 'ko-KR' | 'ja-JP' | 'unsupported'; voice: string | null;
  emotion: CharacterEmotion; gesture: CharacterGesture | null; intentSource: 'rules-v1';
}>;
export function buildReplyPlan(reply: string, responseId: string, confirmation = false): ReplyPlan {
  const korean = /[가-힣]/u.test(reply), japanese = /[ぁ-ゖァ-ヺ]/u.test(reply);
  const language = korean && !japanese ? 'ko-KR' : japanese && !korean ? 'ja-JP' : 'unsupported';
  let emotion: CharacterEmotion = 'neutral', gesture: CharacterGesture | null = null;
  if (confirmation) { emotion = 'thinking'; gesture = 'tilt'; }
  else if (/(쉬는 게|쉬어|괜찮아요|무리하지|休み|無理しない)/u.test(reply)) { emotion = 'comforting'; gesture = 'nod'; }
  else if (/(천천히|함께 해|조금씩|ゆっくり|一歩ずつ)/u.test(reply)) { emotion = 'encouraging'; gesture = 'nod'; }
  else if (/^(안녕하세요|こんにちは)/u.test(reply)) { emotion = 'smile'; gesture = 'greet'; }
  return Object.freeze({ version: 1, responseId, spokenText: reply, language,
    voice: language === 'ko-KR' ? 'ko-KR-Chirp3-HD-Zephyr' : language === 'ja-JP' ? GEMINI_ZEPHYR_VOICE : null,
    emotion, gesture, intentSource: 'rules-v1' });
}
export function parseReplyEnvelope(input: unknown): Readonly<{ reply: string; plan: ReplyPlan; notice: string }> {
  if (!input || typeof input !== 'object') throw new Error('답변 형식을 확인하지 못했어요.');
  const value = input as Record<string, unknown>, plan = value.performance as ReplyPlan | undefined;
  if (typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 20_000
    || !plan || plan.version !== 1 || typeof plan.responseId !== 'string' || !plan.responseId || plan.responseId.length > 128
    || plan.spokenText !== value.reply || plan.intentSource !== 'rules-v1'
    || !CHARACTER_EMOTIONS.includes(plan.emotion) || (plan.gesture !== null && !CHARACTER_GESTURES.includes(plan.gesture)))
    throw new Error('답변과 발화 계획이 맞지 않아요.');
  const expected = buildReplyPlan(value.reply, plan.responseId);
  if (plan.language !== expected.language || plan.voice !== expected.voice) throw new Error('답변의 언어와 음성 설정이 맞지 않아요.');
  return Object.freeze({ reply: value.reply, plan: Object.freeze({ ...plan }),
    notice: value.proposal ? '기록 변경은 실행하지 않았어요. 기존 대화 화면에서 내용을 확인해 주세요.'
      : value.adviceRequest ? '기록을 사용하는 조언은 기존 대화 화면에서 이어 주세요.'
      : value.historySaved === false ? '답변은 받았지만 대화 이력을 저장하지 못했어요.' : '' });
}
export function matchesReplyClip(plan: ReplyPlan, manifest: LipSyncManifest) {
  return plan.spokenText === manifest.spokenText && plan.language === manifest.language
    && plan.voice === manifest.voice && manifest.alignment !== 'synthetic-clock-test';
}
export function characterReplyEnabled(env: Record<string, string | undefined>) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'agent/yeoni-cat-animation-poc';
}
export function adviceSpokenText(advice: { summary: string; nextSteps: readonly string[]; basis: string; limitations: string }) {
  return [advice.summary, ...advice.nextSteps, advice.basis, advice.limitations].join('\n');
}
