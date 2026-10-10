import { AnalysisInputError } from './contracts.ts';

/** Deliberately bounded support, not guessed precision for arbitrary currency codes. */
export const CURRENCY_DECIMALS: Readonly<Record<string, number>> = Object.freeze({ KRW: 0, JPY: 0, USD: 2, EUR: 2, GBP: 2, KWD: 3, BHD: 3 });
export function parseMoney(amount: unknown, currency: unknown): { minor: number; decimals: number } {
  if (typeof currency !== 'string' || !Object.hasOwn(CURRENCY_DECIMALS, currency)) throw new AnalysisInputError('currency');
  const decimals = CURRENCY_DECIMALS[currency];
  if (typeof amount !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(amount) || amount.length > 32) throw new AnalysisInputError('money_decimal');
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > decimals) throw new AnalysisInputError('money_precision');
  const minor = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new AnalysisInputError('money_overflow');
  return { minor: Number(minor), decimals };
}
export function sumMinor(values: readonly number[]): number {
  let sum = BigInt(0);
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) throw new AnalysisInputError('money_minor');
    sum += BigInt(value);
  }
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new AnalysisInputError('money_overflow');
  return Number(sum);
}
export function formatMinor(value: number, currency: string): string {
  if (!Number.isSafeInteger(value) || value < 0 || !Object.hasOwn(CURRENCY_DECIMALS, currency)) throw new AnalysisInputError('money_minor');
  const decimals = CURRENCY_DECIMALS[currency], text = String(value).padStart(decimals + 1, '0');
  return decimals ? `${text.slice(0, -decimals)}.${text.slice(-decimals)}` : text;
}
