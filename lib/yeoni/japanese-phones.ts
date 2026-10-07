import type { Viseme } from './lip-sync.ts';

/** Open JTalk segment symbols, not kana, romaji spelling or prosody tokens.
 * Vocabulary: https://r9y9.github.io/ttslearn/latest/_modules/ttslearn/tacotron/frontend/openjtalk.html
 * This is a conservative projection onto the existing artwork, not an articulation model.
 * N and cl do not imply bilabial closure. Japanese j is NOT the Korean IPA glide j.
 * AEIOU retain their vowel shapes when devoiced; silence is supplied explicitly.
 */
export const JAPANESE_OPENJTALK_VISEMES: Readonly<Record<string, Viseme>> = Object.freeze({
  a: 'a', A: 'a', i: 'i', I: 'i', u: 'u', U: 'u', e: 'e', E: 'e', o: 'o', O: 'o',
  b: 'closed', by: 'closed', m: 'closed', my: 'closed', p: 'closed', py: 'closed',
  N: 'small', cl: 'small', ch: 'small', d: 'small', dy: 'small', f: 'small', g: 'small', gy: 'small',
  h: 'small', hy: 'small', j: 'small', k: 'small', ky: 'small', n: 'small', ny: 'small',
  r: 'small', ry: 'small', s: 'small', sh: 'small', t: 'small', ts: 'small', ty: 'small', v: 'small', z: 'small',
  w: 'u', y: 'i', pau: 'rest', sil: 'rest',
});
export const JAPANESE_VOWELS: ReadonlySet<string> = new Set(['a', 'i', 'u', 'e', 'o', 'A', 'I', 'U', 'E', 'O']);
export const JAPANESE_GLIDES: ReadonlySet<string> = new Set(['w', 'y']);
