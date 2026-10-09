const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL_UNITS = ['', '십', '백', '천'];
const LARGE_UNITS = ['', '만', '억', '조'];

function readInteger(digits: string): string {
  if (digits === '0') return '영';
  const groups: string[] = [];
  for (let end = digits.length, group = 0; end > 0; end -= 4, group++) {
    const chunk = digits.slice(Math.max(0, end - 4), end);
    let reading = '';
    for (let i = 0; i < chunk.length; i++) {
      const digit = Number(chunk[i]), place = chunk.length - i - 1;
      if (digit) reading += (digit === 1 && place > 0 ? '' : DIGITS[digit]) + SMALL_UNITS[place];
    }
    if (reading) groups.unshift((group === 1 && reading === '일' ? '' : reading) + LARGE_UNITS[group]);
  }
  return groups.join('');
}

/** Bounded KRW integer reading for NEW synthesis only, never a saved-audio transcript repair.
 * Keep time, counters, decimals, signs, IDs, malformed grouping and unknown suffixes intact.
 * String grouping avoids precision loss. Supported magnitude: 0 through 9,999,999,999,999,999.
 */
export function normalizeKoreanCurrencySpeech(text: string): string {
  return text.replace(
    /(?<![\p{L}\p{N}_.,+\-])(?:0|[1-9]\d{0,15}|[1-9]\d{0,2}(?:,\d{3}){1,5})([ \t]*)원(?=$|[^\p{L}\p{N}_]|(?:이에요|입니다|이네요|이었어요|이라고|이라면|으로|부터|까지|보다|씩|만|도|을|은|에|과)(?=$|[^\p{L}\p{N}_]))/gu,
    (match: string, space: string, offset: number) => {
      // A separated sign is still part of the unsupported signed amount.
      if (/[+\-]\s*$/.test(text.slice(0, offset))) return match;
      const digits = match.slice(0, -1).trim().replaceAll(',', '');
      if (digits.length > 16) return match;
      return readInteger(digits) + space + '원';
    },
  );
}
