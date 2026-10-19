import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, validateSettings, updateSettings, reserve, settle, release, summary, quote } from './index.ts';
const settings = { monthlyBudget: 100, perRequestBudget: 80, monthlyRequestLimit: 3 };
const fresh = () => createLedger('synthetic-account', settings);
const req = (id = 'one', estimatedCost = 60, month = '2026-10') => ({ id, fingerprint: 'synthetic-hash', month, estimatedCost });
const error = (code) => ({ code });

test('strict settings reject coercion, nonfinite, negatives, fractions, unsafe and contradictory values', () => {
  for (const field of Object.keys(settings)) for (const value of ['10', null, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateSettings({ ...settings, [field]: value }));
  }
  assert.throws(() => validateSettings({ ...settings, perRequestBudget: 101 }), error('request_budget_exceeds_monthly'));
  for (const field of Object.keys(settings)) {
    const value = { ...settings, [field]: 0 };
    if (field === 'monthlyBudget') value.perRequestBudget = 0;
    assert.throws(() => reserve(createLedger('test', value), req()), error('disabled'));
  }
});
test('reserve includes outstanding liabilities and exact boundary is accepted', () => {
  const base = fresh();
  const first = reserve(base, req());
  assert.equal(first.shouldDispatch, true);
  assert.equal(base.entries.length, 0);
  assert.throws(() => reserve(first.state, req('two', 41)), error('monthly_budget'));
  const full = reserve(first.state, req('two', 40)).state;
  assert.equal(summary(full, '2026-10').remaining, 0);
  assert.throws(() => reserve(base, req('x', 81)), error('per_request_limit'));
});
test('duplicate reserve never dispatches twice, including terminal entries', () => {
  let state = reserve(fresh(), req()).state;
  for (const next of [state, settle(state, 'one', 20), release(state, 'one', 'not_dispatched')]) {
    assert.equal(reserve(next, req()).shouldDispatch, false);
    assert.equal(reserve(next, req()).state, next);
    for (const change of [{ fingerprint: 'different' }, { estimatedCost: 59 }, { month: '2026-11' }]) {
      assert.throws(() => reserve(next, { ...req(), ...change }), error('idempotency_conflict'));
    }
  }
});
test('settlement replaces estimate, is idempotent and rejects inconsistent replays', () => {
  const reserved = reserve(fresh(), req()).state;
  const done = settle(reserved, 'one', 20);
  assert.deepEqual(summary(done, '2026-10'), { spent: 20, reserved: 0, committed: 20, remaining: 80, requests: 1, overBudget: false });
  assert.equal(settle(done, 'one', 20), done);
  assert.throws(() => settle(done, 'one', 21), error('settlement_conflict'));
  assert.throws(() => release(done, 'one', 'not_dispatched'), error('already_settled'));
  assert.equal(summary(settle(reserved, 'one', 0), '2026-10').spent, 0);
});
test('actual overrun is visible and stops further admission', () => {
  const state = settle(reserve(fresh(), req()).state, 'one', 120);
  assert.equal(summary(state, '2026-10').spent, 120);
  assert.equal(summary(state, '2026-10').overBudget, true);
  assert.throws(() => reserve(state, req('two', 0)), error('monthly_budget'));
});
test('release only with confirmed absence of billing; retains attempt count and tombstone', () => {
  const state = reserve(fresh(), req()).state;
  assert.throws(() => release(state, 'one', 'timeout'), error('unconfirmed_billing'));
  const next = release(state, 'one', 'provider_confirmed_unbilled');
  assert.equal(summary(next, '2026-10').remaining, 100);
  assert.equal(summary(next, '2026-10').requests, 1);
  assert.equal(release(next, 'one', 'not_dispatched'), next);
  assert.throws(() => settle(next, 'one', 10), error('already_released'));
});
test('request count includes failed attempts and zero cost requests', () => {
  let state = fresh();
  for (let i = 0; i < 3; i++) state = release(reserve(state, req(String(i), 0)).state, String(i), 'not_dispatched');
  assert.throws(() => reserve(state, req('four', 0)), error('monthly_request_limit'));
});
test('lowering settings keeps debt; later settlement uses original month', () => {
  const state = updateSettings(reserve(fresh(), req()).state, { ...settings, monthlyBudget: 40, perRequestBudget: 40 });
  assert.throws(() => reserve(state, req('two', 1)), error('monthly_budget'));
  const november = reserve(state, req('november', 30, '2026-11')).state;
  const done = settle(november, 'one', 70);
  assert.equal(summary(done, '2026-10').spent, 70);
  assert.equal(summary(done, '2026-11').reserved, 30);
});
test('invalid request, amount and unknown terminal transitions fail without mutation', () => {
  const state = fresh();
  for (const change of [{ month: '2026-13' }, { month: '2026-1' }, { id: '' }, { fingerprint: ' ' }, { estimatedCost: NaN }, { estimatedCost: -1 }]) {
    assert.throws(() => reserve(state, { ...req(), ...change }));
  }
  assert.throws(() => settle(state, 'absent', 0), error('unknown_request'));
  assert.throws(() => release(state, 'absent', 'not_dispatched'), error('unknown_request'));
  assert.equal(state.entries.length, 0);
});
const price = { source: 'explicit_configuration', reference: 'SYNTHETIC TEST ONLY', rates: { input: { microKrw: 7, perUnits: 3 }, output: { microKrw: 11, perUnits: 5 } } };
test('explicit dimension pricing rounds upward using exact integer arithmetic', () => {
  assert.equal(quote(price, { input: 1, output: 1 }), 6);
  assert.equal(quote(price, { input: 0, output: 0 }), 0);
  assert.throws(() => quote(price, { input: 1 }), error('price_dimension_mismatch'));
  assert.throws(() => quote(price, { input: 1, output: 1, unknown: 1 }), error('price_dimension_mismatch'));
  assert.throws(() => quote({ ...price, source: undefined }, { input: 1, output: 1 }), error('missing_price_source'));
  assert.throws(() => quote({ ...price, rates: { input: { microKrw: 1, perUnits: 0 } } }, { input: 1 }), error('invalid_price_divisor'));
  assert.throws(() => quote({ ...price, rates: { input: { microKrw: Number.MAX_SAFE_INTEGER, perUnits: 1 } } }, { input: 2 }), error('amount_overflow'));
});
test('immutable results cannot alter accounting and accounts are separate', () => {
  const state = reserve(fresh(), req()).state;
  assert.throws(() => { state.entries[0].estimatedCost = 0; }, TypeError);
  assert.throws(() => { state.settings.monthlyBudget = 999; }, TypeError);
  assert.equal(reserve(createLedger('another-account', settings), req()).shouldDispatch, true);
});
test('serialized synthetic competing reservations admit only affordable work', () => {
  let state = createLedger('synthetic', { monthlyBudget: 100, perRequestBudget: 10, monthlyRequestLimit: 1000 });
  let admitted = 0;
  for (let i = 0; i < 1000; i++) {
    try { state = reserve(state, req(String(i), 10)).state; admitted++; }
    catch (e) { assert.equal(e.code, 'monthly_budget'); }
  }
  assert.equal(admitted, 10);
  assert.equal(summary(state, '2026-10').committed, 100);
});
