/** Visual projection of the explicitly audited subset of Korean MFA v3 IPA.
 * Preserve source phones/times in manifests; these are not orthographic Jamo.
 * Unknown phones (especially spn) fail closed. No length/glide time is invented.
 * https://mfa-models.readthedocs.io/en/latest/mfa_phone_set.html#korean
 */
export const KOREAN_MFA_VISEMES = {
  'ɐ': 'a', 'ʌ': 'a', 'ʌː': 'a',
  i: 'i', 'iː': 'i', j: 'i',
  u: 'u', 'uː': 'u', w: 'u', 'ɥ': 'u',
  e: 'e', 'eː': 'e', 'ɛ': 'e', 'ɛː': 'e', o: 'o', 'oː': 'o',
  m: 'closed', p: 'closed', b: 'closed', 'pʰ': 'closed', 'p̚': 'closed', 'p͈': 'closed',
  'ɨ': 'small', 'ɨː': 'small', n: 'small', 'ɲ': 'small', 'ŋ': 'small',
  'ɭ': 'small', 'ʎ': 'small', 'ʎː': 'small', 'ɾ': 'small', 'ɾʲ': 'small',
  h: 'small', 'sʰ': 'small', 's͈': 'small', 'sʷ': 'u',
  'tɕ': 'small', 'tɕ͈': 'small', t: 'small', d: 'small', 't̚': 'small',
  k: 'small', 'ɡ': 'small', 'k͈': 'small', 'kʰ': 'small',
} as const;
