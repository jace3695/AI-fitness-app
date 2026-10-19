/** Pure application ledger. Money is integer micro-KRW (1 KRW = 1,000,000).
 * The host MUST serialize transitions per account and persist before dispatch.
 * No provider, network, clock, environment, storage or FREE_MODE dependency.
 */
export type Settings = Readonly<{
  monthlyBudget: number; perRequestBudget: number; monthlyRequestLimit: number;
}>;
export type Request = Readonly<{
  id: string; fingerprint: string; month: string; estimatedCost: number;
}>;
export type Entry = Request & Readonly<{
  status: 'reserved' | 'settled' | 'released'; actualCost?: number;
}>;
export type Ledger = Readonly<{ accountId: string; settings: Settings; entries: readonly Entry[] }>;
export class BudgetError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'BudgetError'; this.code = code; }
}
function fail(code: string): never { throw new BudgetError(code); }
function integer(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid_nonnegative_integer');
  return value;
}
function label(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('invalid_identifier');
  return value;
}
function monthKey(value: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) fail('invalid_month');
  return value;
}
function exactNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('amount_overflow');
  return Number(value);
}
export function validateSettings(value: Settings): Settings {
  if (!value || typeof value !== 'object') fail('invalid_settings');
  const monthlyBudget = integer(value.monthlyBudget);
  const perRequestBudget = integer(value.perRequestBudget);
  const monthlyRequestLimit = integer(value.monthlyRequestLimit);
  if (perRequestBudget > monthlyBudget) fail('request_budget_exceeds_monthly');
  return Object.freeze({ monthlyBudget, perRequestBudget, monthlyRequestLimit });
}
function freezeLedger(accountId: string, settings: Settings, entries: readonly Entry[]): Ledger {
  return Object.freeze({ accountId, settings, entries: Object.freeze(entries) });
}
export function createLedger(accountId: string, settings: Settings): Ledger {
  return freezeLedger(label(accountId), validateSettings(settings), []);
}
export function updateSettings(state: Ledger, settings: Settings): Ledger {
  // Lowering limits never erases liabilities; it blocks subsequent admission.
  return freezeLedger(state.accountId, validateSettings(settings), state.entries);
}
export function summary(state: Ledger, month: string) {
  monthKey(month);
  let spent = BigInt(0), reserved = BigInt(0), requests = 0;
  for (const entry of state.entries) {
    if (entry.month !== month) continue;
    // Accepted attempts count even when proven unbilled, preventing retry bypass.
    requests++;
    if (entry.status === 'settled') spent += BigInt(entry.actualCost!);
    if (entry.status === 'reserved') reserved += BigInt(entry.estimatedCost);
  }
  const committed = spent + reserved;
  const available = BigInt(state.settings.monthlyBudget) - committed;
  return Object.freeze({ spent: exactNumber(spent), reserved: exactNumber(reserved),
    committed: exactNumber(committed), remaining: exactNumber(available > BigInt(0) ? available : BigInt(0)),
    requests, overBudget: committed > BigInt(state.settings.monthlyBudget) });
}
export function reserve(state: Ledger, request: Request): Readonly<{
  state: Ledger; entry: Entry; shouldDispatch: boolean;
}> {
  label(request.id); label(request.fingerprint); monthKey(request.month); integer(request.estimatedCost);
  const prior = state.entries.find(e => e.id === request.id);
  if (prior) {
    if (prior.fingerprint !== request.fingerprint || prior.month !== request.month || prior.estimatedCost !== request.estimatedCost)
      fail('idempotency_conflict');
    return Object.freeze({ state, entry: prior, shouldDispatch: false });
  }
  const totals = summary(state, request.month);
  const limits = state.settings;
  if (!limits.monthlyBudget || !limits.perRequestBudget || !limits.monthlyRequestLimit) fail('disabled');
  if (request.estimatedCost > limits.perRequestBudget) fail('per_request_limit');
  if (totals.requests >= limits.monthlyRequestLimit) fail('monthly_request_limit');
  if (BigInt(totals.committed) + BigInt(request.estimatedCost) > BigInt(limits.monthlyBudget)) fail('monthly_budget');
  const entry: Entry = Object.freeze({ id: request.id, fingerprint: request.fingerprint,
    month: request.month, estimatedCost: request.estimatedCost, status: 'reserved' });
  return Object.freeze({ state: freezeLedger(state.accountId, limits, [...state.entries, entry]), entry, shouldDispatch: true });
}
function replace(state: Ledger, entry: Entry): Ledger {
  return freezeLedger(state.accountId, state.settings, state.entries.map(e => e.id === entry.id ? Object.freeze(entry) : e));
}
function find(state: Ledger, id: string): Entry {
  label(id);
  return state.entries.find(e => e.id === id) ?? fail('unknown_request');
}
export function settle(state: Ledger, id: string, actualCost: number): Ledger {
  integer(actualCost);
  const entry = find(state, id);
  if (entry.status === 'settled') {
    if (entry.actualCost !== actualCost) fail('settlement_conflict');
    return state;
  }
  if (entry.status === 'released') fail('already_released');
  // Never clamp actual charges to estimates. Overspend must remain visible.
  const next = replace(state, { ...entry, status: 'settled', actualCost });
  summary(next, entry.month); // Fail atomically if numeric storage would overflow.
  return next;
}
export function release(state: Ledger, id: string, evidence: 'not_dispatched' | 'provider_confirmed_unbilled'): Ledger {
  if (evidence !== 'not_dispatched' && evidence !== 'provider_confirmed_unbilled') fail('unconfirmed_billing');
  const entry = find(state, id);
  if (entry.status === 'settled') fail('already_settled');
  if (entry.status === 'released') return state;
  return replace(state, { ...entry, status: 'released' });
}

/** Explicit rates in budget currency; no implicit FX or default provider prices.
 * Each dimension can represent input/output/cached tokens, characters, etc.
 * The adapter must provide ALL billable dimensions and upper bounds for admission.
 */
export type Price = Readonly<{
  source: 'provider_verified' | 'explicit_configuration'; reference: string;
  rates: Readonly<Record<string, Readonly<{ microKrw: number; perUnits: number }>>>;
}>;
export function quote(price: Price, units: Readonly<Record<string, number>>): number {
  if (!price || !['provider_verified', 'explicit_configuration'].includes(price.source)) fail('missing_price_source');
  label(price.reference);
  if (!price.rates || !units || !Object.keys(price.rates).length) fail('missing_price_dimensions');
  const keys = Object.keys(price.rates);
  if (keys.length !== Object.keys(units).length || keys.some(k => !Object.hasOwn(units, k))) fail('price_dimension_mismatch');
  let total = BigInt(0);
  for (const key of keys) {
    const rate = price.rates[key];
    const numerator = BigInt(integer(rate.microKrw)) * BigInt(integer(units[key]));
    const denominator = BigInt(integer(rate.perUnits));
    if (!denominator) fail('invalid_price_divisor');
    total += (numerator + denominator - BigInt(1)) / denominator;
  }
  return exactNumber(total);
}
