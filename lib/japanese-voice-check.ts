// One approved utterance. Never rotate this ID to retry an uncertain request.
export const JAPANESE_CHECK = Object.freeze({
  text: 'こんにちは。今日は、ゆっくり一歩ずつ進みましょう。',
  voice: 'ja-JP-Chirp3-HD-Zephyr',
  languageCode: 'ja-JP',
  requestId: '0d862ef8-b60d-41f4-b094-2936853cb905',
});
export function japaneseCheckEnabled(env: Record<string, string | undefined>) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'agent/yeoni-cat-animation-poc';
}
