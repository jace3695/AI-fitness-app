/** Visual projection of the pinned Korean MFA v3 IPA inventory.
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
  // Bilabial closures stay closed under palatalization, rounding and length.
  'bʲ': 'closed', 'bʷ': 'closed', 'mʲ': 'closed', 'mʲː': 'closed', 'mː': 'closed',
  'pʰː': 'closed', 'pʲ': 'closed', 'pʲː': 'closed', 'pʷ': 'closed',
  'p͈ʲ': 'closed', 'p͈ʷ': 'closed', 'p͈ː': 'closed',
  // Explicit rounding is displayed for non-closure consonants. MFA represents
  // /h/ before rounded vowels as labial fricatives; these are not stop closures.
  'dʑʷ': 'u', 'dʷ': 'u', 'kʷ': 'u', 'kʷː': 'u', 'k͈ʷ': 'u', 's͈ʷ': 'u',
  'tɕʷ': 'u', 'tɕʷː': 'u', 'tɕ͈ʷ': 'u', 'tʷ': 'u', 'tʷː': 'u',
  'ɡʷ': 'u', 'ɸ': 'u', 'ɸʷ': 'u', 'ɾʷ': 'u', 'β': 'u', 'βʷ': 'u',
  // Non-labial consonants use the existing narrow consonant pose. This visual
  // projection does not claim to render tongue place, tension or aspiration.
  c: 'small', 'cʰ': 'small', 'cʰː': 'small', 'c͈': 'small', 'dʑ': 'small',
  'dʲ': 'small', 'kʰː': 'small', 'k̚': 'small', 'k͈ː': 'small', 'nː': 'small',
  s: 'small', 'sʰː': 'small', 'sː': 'small', 's͈ː': 'small',
  'tɕʰ': 'small', 'tɕʰː': 'small', 'tɕː': 'small', 'tɕ͈ː': 'small',
  'tʰ': 'small', 'tʰː': 'small', 'tʲ': 'small', 't͈': 'small', 't͈ʲ': 'small', 't͈ː': 'small',
  x: 'small', 'ç': 'small', 'ɕʰ': 'small', 'ɕ͈': 'small', 'ɟ': 'small',
  'ɣ': 'small', 'ɦ': 'small', 'ɭː': 'small', 'ɰ': 'small', 'ʝ': 'small',
} as const;
