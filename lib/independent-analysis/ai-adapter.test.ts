import assert from 'node:assert/strict';
import test from 'node:test';
import { runMockAnalysis } from './ai-mock-adapter.ts';
import { validateAnalysisCandidate } from './ai-response.ts';
import { analyzeSnapshot, projectAnalysisFacts } from './index.ts';
import type { AnalysisCandidate, AnalysisConsent, ConfirmedMockUsage, MockAdapterDependencies,
  MockAnalysisInput, MockProviderRequest, ReservationBinding } from './ai-contracts.ts';
import type { SnapshotInput, SourceInput } from './contracts.ts';

// Synthetic only: no keys, current prices, real owners, real records or network.
const OWNER = 'SYNTHETIC_OWNER';
const AS_OF = '2026-10-09T17:00:00Z';
const NOW = '2026-10-09T17:10:00Z';
function source(id: string, records: unknown[] = []): SourceInput {
  return { sourceId: id, sourceVersion: 'fixture-v1', status: records.length ? 'ok' : 'empty',
    coverage: { startDate: '2026-01-01', endDateExclusive: '2027-01-01', complete: true, totalRows: records.length }, records };
}
function snapshot(): SnapshotInput {
  return { schemaVersion: 1, ownerId: OWNER, asOf: AS_OF, timeZone: 'Asia/Seoul', sources: {
    weight: source('PRIVATE_WEIGHT_SOURCE', [{ id: 'PRIVATE_ROW', ownerId: OWNER, revision: 1, date: '2026-10-09', value: 70, unit: 'kg', memo: 'PRIVATE_MEMO' }]),
    workout: source('PRIVATE_WORKOUT_SOURCE'), spending: source('PRIVATE_MONEY_SOURCE'),
  } };
}
function input(): MockAnalysisInput {
  return { mode: 'mock_only', requestId: 'fixture-request', ownerId: OWNER, snapshot: snapshot(),
    selection: { provider: 'fixture-provider', model: 'fixture-model', tier: 'routine' }, domains: ['weight'], need: 'meaningful_change',
    budget: { currency: 'KRW', overallLimitMicros: 1_000, analysisLimit: { enabled: true, limitMicros: 500 }, maxRequestMicros: 100, policyVersion: 'fixture-policy' },
    price: { kind: 'synthetic_fixture', provider: 'fixture-provider', model: 'fixture-model', tier: 'routine', version: 'fixture-price',
      validFrom: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z', currency: 'KRW', maximumChargeMicros: 100,
      maxOutputTokens: 1_000, completePayloadAndAllBillableUnitsBounded: true },
  };
}
function candidate(): AnalysisCandidate {
  return { schemaVersion: 1, confidence: 'HIGH', claims: [{ section: 'summary', kind: 'fact', text: '기록된 체중입니다.',
    evidenceIds: ['weight.yesterday.mean'], numbers: [{ evidenceId: 'weight.yesterday.mean', value: 70, unit: 'kg' }] }] };
}
function harness(i = input()) {
  let now = NOW;
  let consent: AnalysisConsent | null = { status: 'granted', ownerId: OWNER, requestId: i.requestId, revision: 'fixture-consent',
    provider: i.selection.provider, model: i.selection.model, purpose: 'independent_daily_analysis', dataScope: 'minimal_recorded_metrics_v1',
    domains: [...i.domains], frequency: 'single_mock_attempt', validFrom: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' };
  const calls = { reserve: 0, claim: 0, generate: 0, settle: 0, hold: 0, consent: 0 };
  const requests: MockProviderRequest[] = [], settled: ConfirmedMockUsage[] = [];
  const reservations = new Map<string, { binding: ReservationBinding; retainedChargeMicros: number; state: 'reserved' | 'claimed' | 'settled' | 'uncertain' }>();
  let spent = 0, frozen = false;
  const response = { provider: i.selection.provider, model: i.selection.model, finish: 'complete', candidate: candidate(),
    usage: { billableUnitsComplete: true, inputTokens: 100, outputTokens: 100, actualChargeMicros: 60, currency: 'KRW' } };
  const deps: MockAdapterDependencies = {
    now: () => now,
    readConsent: async () => { calls.consent++; return structuredClone(consent); },
    provider: { kind: 'mock', ...i.selection, generate: async request => { calls.generate++; requests.push(request); return response; } },
    budget: { kind: 'mock',
      reserve: async binding => {
        calls.reserve++;
        if (reservations.has(binding.requestId)) return { status: 'duplicate' };
        const outstanding = [...reservations.values()].reduce((sum, r) => sum + r.retainedChargeMicros, 0);
        if (frozen || spent + outstanding + binding.maximumChargeMicros > binding.overallLimitMicros
          || (binding.analysisLimit.enabled && spent + outstanding + binding.maximumChargeMicros > binding.analysisLimit.limitMicros!)) return { status: 'denied' };
        reservations.set(binding.requestId, { binding, retainedChargeMicros: binding.maximumChargeMicros, state: 'reserved' });
        return { status: 'reserved', binding: structuredClone(binding), atomicOverallAndCategoryCheck: true };
      },
      claimDispatch: async binding => {
        calls.claim++;
        const reservation = reservations.get(binding.requestId);
        if (frozen || !reservation || reservation.state !== 'reserved') return 'denied';
        reservation.state = 'claimed'; return 'claimed';
      },
      settle: async (binding, usage) => {
        calls.settle++; settled.push(usage);
        const reservation = reservations.get(binding.requestId);
        if (!reservation || reservation.state !== 'claimed') return 'uncertain';
        reservation.state = 'settled'; reservation.retainedChargeMicros = 0;
        spent += usage.actualChargeMicros; frozen ||= usage.overrun; return 'recorded';
      },
      holdUnknown: async (binding, liability) => {
        calls.hold++;
        const reservation = reservations.get(binding.requestId);
        if (!reservation) return 'uncertain';
        reservation.retainedChargeMicros = Math.max(reservation.retainedChargeMicros, liability.retainedChargeMicros);
        reservation.state = 'uncertain'; frozen ||= liability.blockFurtherDispatch; return 'recorded';
      },
    },
  };
  return { i, deps, calls, requests, response, settled, reservations,
    get consent() { return consent; }, set consent(value: AnalysisConsent | null) { consent = value; },
    set now(value: string) { now = value; } };
}

test('D01 valid local fixture yields a held-for-review candidate, never publishable completion', async () => {
  const h = harness(), before = JSON.stringify(h.i), result = await runMockAnalysis(h.i, h.deps);
  assert.equal(result.state, 'review_required'); assert.equal(result.reason, 'semantic_and_safety_review_required');
  assert.equal(result.accounting, 'settled'); assert.equal(result.actualChargeMicros, 60); assert.equal(result.retainedChargeMicros, 0);
  assert.equal(h.calls.generate, 1); assert.equal(JSON.stringify(h.i), before);
});
test('D02 minimal projection excludes owner, source, row, memo and unselected domains', async () => {
  const h = harness(); Object.assign(h.i.selection, { unknownSecret: 'DO_NOT_COPY' });
  h.i.snapshot.sources.spending = source('PRIVATE_MONEY_SOURCE', [{ id: 'PRIVATE_MONEY_ROW', ownerId: OWNER,
    revision: 1, date: '2026-10-11', kind: 'expense', amount: '999', currency: 'KRW' }]);
  await runMockAnalysis(h.i, h.deps);
  const sent = JSON.stringify(h.requests[0]);
  for (const marker of [OWNER, 'PRIVATE_', 'DO_NOT_COPY', 'spending.', 'workout.', 'future_excluded']) assert.equal(sent.includes(marker), false, marker);
  assert.equal(h.requests[0].evidence.sensitive, true); assert.ok(Object.isFrozen(h.requests[0].evidence.facts));
  assert.throws(() => { h.requests[0].model = 'changed'; }, TypeError);
});
for (const [name, edit] of Object.entries({
  missing: (h: ReturnType<typeof harness>) => { h.consent = null; },
  revoked: (h: ReturnType<typeof harness>) => { h.consent!.status = 'revoked'; },
  provider: (h: ReturnType<typeof harness>) => { h.consent!.provider = 'another'; },
  model: (h: ReturnType<typeof harness>) => { h.consent!.model = 'another'; },
  owner: (h: ReturnType<typeof harness>) => { h.consent!.ownerId = 'another'; },
  request: (h: ReturnType<typeof harness>) => { h.consent!.requestId = 'another'; },
  domain: (h: ReturnType<typeof harness>) => { h.consent!.domains = ['spending']; },
  expired: (h: ReturnType<typeof harness>) => { h.consent!.expiresAt = NOW; },
  future: (h: ReturnType<typeof harness>) => { h.consent!.validFrom = '2026-10-10T00:00:00Z'; },
  purpose: (h: ReturnType<typeof harness>) => { Object.assign(h.consent!, { purpose: 'manual_advice' }); },
  scope: (h: ReturnType<typeof harness>) => { Object.assign(h.consent!, { dataScope: 'all_records' }); },
  frequency: (h: ReturnType<typeof harness>) => { Object.assign(h.consent!, { frequency: 'daily' }); },
})) test(`D03 ${name} consent blocks reservation and generation`, async () => {
  const h = harness(); edit(h); const result = await runMockAnalysis(h.i, h.deps);
  assert.equal(result.state, 'blocked'); assert.equal(h.calls.reserve, 0); assert.equal(h.calls.generate, 0);
});
test('D04 absent consent service or invalid clock fails closed without raw error disclosure', async () => {
  const h = harness(); h.deps.readConsent = async () => { throw Error('SECRET_ERROR'); };
  const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.reason, 'consent_unavailable');
  assert.equal(JSON.stringify(result).includes('SECRET'), false); assert.equal(h.calls.generate, 0);
  h.deps.now = () => { throw Error('SECRET_CLOCK'); }; assert.equal((await runMockAnalysis(h.i, h.deps)).reason, 'price_or_snapshot_expired');
});
test('D05 live mode, live dependency, provider/model changes and implicit tier upgrades fail closed', async () => {
  for (const edit of [
    (h: ReturnType<typeof harness>) => Object.assign(h.i, { mode: 'live' }),
    (h: ReturnType<typeof harness>) => Object.assign(h.deps.provider, { kind: 'live' }),
    (h: ReturnType<typeof harness>) => Object.assign(h.deps.budget, { kind: 'live' }),
    (h: ReturnType<typeof harness>) => { h.deps.provider.provider = 'different'; },
    (h: ReturnType<typeof harness>) => { h.deps.provider.model = 'different'; },
    (h: ReturnType<typeof harness>) => { h.i.need = 'complex_review'; },
  ]) { const h = harness(); edit(h); await runMockAnalysis(h.i, h.deps); assert.equal(h.calls.generate, 0); assert.equal(h.calls.reserve, 0); }
});
test('D06 no-change and insufficient-data decisions skip without claiming user well-being', async () => {
  for (const need of ['no_meaningful_change', 'insufficient_data'] as const) {
    const h = harness(); h.i.need = need; const result = await runMockAnalysis(h.i, h.deps);
    assert.equal(result.reason, need); assert.equal(result.candidate, undefined); assert.equal(h.calls.consent, 0);
  }
});
test('D07 missing/zero/unsafe overall or category budget blocks, category OFF preserves overall cap', async () => {
  for (const [overall, category, maximum] of [[null, 500, 100], [0, 500, 100], [1_000, null, 100], [1_000, 0, 100], [50, 500, 100], [1_000, 500, NaN], [Infinity, 500, 100], [1_000, 500, -1]]) {
    const h = harness(); h.i.budget.overallLimitMicros = overall; h.i.budget.analysisLimit = { enabled: true, limitMicros: category }; h.i.budget.maxRequestMicros = maximum!;
    await runMockAnalysis(h.i, h.deps); assert.equal(h.calls.generate, 0); assert.equal(h.calls.reserve, 0);
  }
  const h = harness(); h.i.budget.analysisLimit = { enabled: false }; h.i.budget.overallLimitMicros = 99;
  assert.equal((await runMockAnalysis(h.i, h.deps)).reason, 'budget_exceeded');
  h.i.budget.overallLimitMicros = 100; assert.equal((await runMockAnalysis(h.i, h.deps)).state, 'review_required');
});
test('D08 absent, expired, mismatched, non-synthetic or unbounded price cannot dispatch', async () => {
  for (const patch of [{ expiresAt: NOW }, { model: 'different' }, { currency: 'USD' }, { maximumChargeMicros: 99 },
    { kind: 'live_price' }, { completePayloadAndAllBillableUnitsBounded: false }, { maxOutputTokens: 0 }]) {
    const h = harness(); Object.assign(h.i.price, patch); await runMockAnalysis(h.i, h.deps); assert.equal(h.calls.generate, 0); assert.equal(h.calls.reserve, 0);
  }
});
test('D09 stale, future, mixed-owner, incomplete and unavailable snapshots block', async () => {
  for (const edit of [
    (i: MockAnalysisInput) => { i.snapshot.asOf = '2026-10-09T15:00:00Z'; },
    (i: MockAnalysisInput) => { i.snapshot.asOf = '2026-10-10T00:00:00Z'; },
    (i: MockAnalysisInput) => { i.snapshot.ownerId = 'OTHER_OWNER'; },
    (i: MockAnalysisInput) => { Object.assign(i.snapshot.sources.weight.records[0]!, { ownerId: 'OTHER' }); },
    (i: MockAnalysisInput) => { i.snapshot.sources.weight.coverage.totalRows = 2; },
    (i: MockAnalysisInput) => { i.snapshot.sources.weight.currentVersion = 'new-version'; },
    (i: MockAnalysisInput) => { i.snapshot.sources.spending.status = 'unavailable'; },
  ]) { const h = harness(); edit(h.i); await runMockAnalysis(h.i, h.deps); assert.equal(h.calls.generate, 0); assert.equal(h.calls.reserve, 0); }
});
test('D10 empty observations do not justify an AI call', async () => {
  const h = harness(); h.i.snapshot.sources.weight = source('weight');
  assert.equal((await runMockAnalysis(h.i, h.deps)).reason, 'insufficient_data'); assert.equal(h.calls.generate, 0);
});
test('D11 uncertain reservation, throw, missing atomic check and mismatched binding retain the ceiling with no generation', async () => {
  for (const kind of ['uncertain', 'throw', 'atomic', 'binding']) {
    const h = harness(); h.deps.budget.reserve = async binding => {
      if (kind === 'throw') throw Error('PRIVATE_ERROR');
      if (kind === 'uncertain') return { status: 'uncertain' };
      return { status: 'reserved', binding: kind === 'binding' ? { ...binding, payloadJson: 'different' } : binding,
        atomicOverallAndCategoryCheck: (kind !== 'atomic') as true };
    };
    const result = await runMockAnalysis(h.i, h.deps);
    assert.equal(result.reason, 'reservation_uncertain'); assert.equal(result.retainedChargeMicros, 100);
    assert.equal(result.actualChargeMicros, null); assert.equal(h.calls.generate, 0);
  }
});
test('D12 uncertain or rejected dispatch claim never generates and never releases a reservation', async () => {
  for (const claim of ['denied', 'uncertain'] as const) {
    const h = harness(); h.deps.budget.claimDispatch = async () => claim;
    const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.accounting, 'retained'); assert.equal(result.retainedChargeMicros, 100); assert.equal(h.calls.generate, 0);
  }
});
test('D13 revoke during reserve or claim prevents generation; post-dispatch revoke settles cost but drops candidate', async () => {
  for (const stage of ['reserve', 'claim', 'generate'] as const) {
    const h = harness();
    if (stage === 'reserve') { const original = h.deps.budget.reserve; h.deps.budget.reserve = async b => { const result = await original(b); h.consent!.status = 'revoked'; return result; }; }
    if (stage === 'claim') { const original = h.deps.budget.claimDispatch; h.deps.budget.claimDispatch = async b => { const result = await original(b); h.consent!.status = 'revoked'; return result; }; }
    if (stage === 'generate') { const original = h.deps.provider.generate; h.deps.provider.generate = async r => { const result = await original(r); h.consent!.status = 'revoked'; return result; }; }
    const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.reason, 'consent_changed'); assert.equal(result.candidate, undefined);
    assert.equal(h.calls.generate, stage === 'generate' ? 1 : 0); assert.equal(h.calls.settle, stage === 'generate' ? 1 : 0);
  }
});
test('D14 consent revision changes and expiry while reserving fail closed', async () => {
  for (const change of ['revision', 'expiry', 'price']) {
    const h = harness(), original = h.deps.budget.reserve;
    h.deps.budget.reserve = async b => { const result = await original(b);
      if (change === 'revision') h.consent!.revision = 'changed';
      if (change === 'expiry') h.consent!.expiresAt = NOW;
      if (change === 'price') h.now = '2026-11-01T00:00:00Z';
      return result; };
    await runMockAnalysis(h.i, h.deps); assert.equal(h.calls.generate, 0);
  }
});
test('D15 uncertain provider outcome retains ceiling, no retry and duplicate request cannot generate again', async () => {
  const h = harness(); h.deps.provider.generate = async () => { h.calls.generate++; throw Error('RAW_SECRET'); };
  const first = await runMockAnalysis(h.i, h.deps), second = await runMockAnalysis(h.i, h.deps);
  assert.equal(first.reason, 'provider_outcome_unknown'); assert.equal(first.retainedChargeMicros, 100); assert.equal(first.actualChargeMicros, null);
  assert.equal(second.reason, 'reservation_duplicate'); assert.equal(h.calls.generate, 1); assert.equal(h.calls.settle, 0);
});
test('D16 missing/partial/coerced/negative usage cannot settle as zero', async () => {
  for (const usage of [undefined, {}, { ...harness().response.usage, billableUnitsComplete: false },
    { ...harness().response.usage, inputTokens: '100' }, { ...harness().response.usage, actualChargeMicros: -1 },
    { ...harness().response.usage, actualChargeMicros: NaN }, { ...harness().response.usage, currency: 'USD' }]) {
    const h = harness(); Object.assign(h.response, { usage }); const result = await runMockAnalysis(h.i, h.deps);
    assert.equal(result.reason, 'usage_unknown'); assert.equal(result.retainedChargeMicros, 100); assert.equal(result.actualChargeMicros, null); assert.equal(h.calls.settle, 0);
  }
});
test('D17 wrong response provider/model leaves billing uncertain and drops candidate', async () => {
  for (const field of ['provider', 'model'] as const) {
    const h = harness(); h.response[field] = 'wrong'; const result = await runMockAnalysis(h.i, h.deps);
    assert.equal(result.reason, 'response_provider_mismatch'); assert.equal(result.accounting, 'retained'); assert.equal(h.calls.settle, 0);
  }
});
test('D18 cost overrun settles full value without clamping and blocks future mock reservations', async () => {
  const h = harness(); h.response.usage.actualChargeMicros = 150;
  const result = await runMockAnalysis(h.i, h.deps);
  assert.equal(result.reason, 'charge_or_usage_overrun'); assert.equal(result.actualChargeMicros, 150); assert.equal(h.settled[0].actualChargeMicros, 150); assert.equal(result.blockFurtherDispatch, true);
  h.i.requestId = 'another-request'; h.consent!.requestId = h.i.requestId;
  assert.equal((await runMockAnalysis(h.i, h.deps)).reason, 'reservation_denied'); assert.equal(h.calls.generate, 1);
});
test('D19 uncertain settlement holds candidate and at least the full observed charge', async () => {
  for (const cost of [60, 150]) {
    const h = harness(); h.response.usage.actualChargeMicros = cost; h.deps.budget.settle = async () => 'uncertain';
    const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.reason, 'settlement_uncertain'); assert.equal(result.candidate, undefined);
    assert.equal(result.retainedChargeMicros, Math.max(100, cost)); assert.equal(result.actualChargeMicros, cost);
  }
});
test('D20 truncation or malformed candidate never refunds a completed usage charge', async () => {
  for (const incomplete of [true, false]) {
    const h = harness(); if (incomplete) h.response.finish = 'length'; else Object.assign(h.response, { candidate: 'not JSON' });
    const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.candidate, undefined); assert.equal(result.accounting, 'settled'); assert.equal(result.actualChargeMicros, 60); assert.equal(h.calls.settle, 1);
  }
});
test('D21 simultaneous duplicate calls rely on one atomic fixture reservation/claim', async () => {
  const h = harness(); const results = await Promise.all(Array.from({ length: 20 }, () => runMockAnalysis(h.i, h.deps)));
  assert.equal(h.calls.generate, 1); assert.equal(results.filter(result => result.state === 'review_required').length, 1);
  assert.equal(results.filter(result => result.reason === 'reservation_duplicate').length, 19);
});
test('D22 injected allocator conservatively counts simultaneous outstanding reservations against both caps', async () => {
  const h = harness(); h.deps.readConsent = async (_owner, requestId) => ({ ...h.consent!, requestId });
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => runMockAnalysis({ ...h.i, requestId: `fixture-${index}` }, h.deps)));
  assert.equal(h.calls.generate, 5); assert.equal(results.filter(result => result.reason === 'reservation_denied').length, 15);
});
test('D23 caller input mutation while consent is pending cannot change frozen payload or charge bound', async () => {
  const h = harness(), original = h.deps.readConsent;
  h.deps.readConsent = async (...args) => { h.i.domains.push('spending'); h.i.budget.maxRequestMicros = 1_000; return original(...args); };
  const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.state, 'review_required');
  assert.equal(h.reservations.get('fixture-request')!.binding.maximumChargeMicros, 100);
  assert.equal(h.requests[0].evidence.facts.some(fact => fact.id.startsWith('spending.')), false);
});

const evidence = () => projectAnalysisFacts(analyzeSnapshot(snapshot()));
test('D24 response rejects extra fields, empty claims, invalid kinds, control text and oversized prose', () => {
  for (const raw of [{ ...candidate(), tool_calls: [] }, { ...candidate(), claims: [] }, null, [], '{bad', ' '.repeat(32_001)]) assert.equal(validateAnalysisCandidate(raw, evidence()).ok, false);
  for (const patch of [{ kind: 'diagnosis' }, { section: 'unapproved' }, { text: 'x'.repeat(1_001) }, { text: 'line\ncontrol' }, { text: '체중은 999입니다.' }]) {
    const raw = candidate(); Object.assign(raw.claims[0], patch); assert.equal(validateAnalysisCandidate(raw, evidence()).ok, false);
  }
});
test('D25 missing/unknown/duplicate evidence and wrong number/unit/unknown-as-zero are rejected', () => {
  for (const patch of [{ evidenceIds: [] }, { evidenceIds: ['missing'] }, { evidenceIds: ['weight.yesterday.mean', 'weight.yesterday.mean'] },
    { numbers: [] }, { numbers: [{ evidenceId: 'weight.yesterday.mean', value: 71, unit: 'kg' }] },
    { numbers: [{ evidenceId: 'weight.yesterday.mean', value: 70, unit: 'lb' }] },
    { evidenceIds: ['weight.today.mean'], numbers: [{ evidenceId: 'weight.today.mean', value: 0, unit: 'kg' }] }]) {
    const raw = candidate(); Object.assign(raw.claims[0], patch); assert.equal(validateAnalysisCandidate(raw, evidence()).ok, false);
  }
});
test('D26 questions can cite unknown evidence but are LOW; inference cannot claim HIGH or fact certainty', () => {
  const raw = candidate(); raw.claims[0] = { section: 'user_question', kind: 'question', text: '오늘 기록을 확인해 주시겠어요?', evidenceIds: ['weight.today.mean'], numbers: [] };
  const question = validateAnalysisCandidate(raw, evidence()); assert.equal(question.ok && question.candidate.confidence, 'LOW');
  raw.claims[0] = { section: 'possible_cause', kind: 'inference', text: '기록만으로 원인은 확정할 수 없습니다.', evidenceIds: ['weight.yesterday.mean'], numbers: [] };
  const inference = validateAnalysisCandidate(raw, evidence()); assert.equal(inference.ok && inference.candidate.confidence, 'MEDIUM');
  raw.claims[0].kind = 'fact'; assert.equal(validateAnalysisCandidate(raw, evidence()).ok, false);
});
test('D27 spelled-out numbers and medical/financial prose are never called safe or published by structural validation', async () => {
  for (const text of ['The weight is nine hundred kilograms.', 'This proves a serious illness.', 'Move all savings into this asset.']) {
    const h = harness(); h.response.candidate.claims[0].text = text;
    const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.state, 'review_required');
    assert.equal(result.reason, 'semantic_and_safety_review_required');
  }
});
test('D28 mock adapter makes zero network calls on successful, failed and skipped paths', async () => {
  const original = globalThis.fetch; let network = 0;
  globalThis.fetch = (() => { network++; throw Error('Network forbidden'); }) as typeof fetch;
  try {
    const h = harness(); await runMockAnalysis(h.i, h.deps);
    h.consent = null; await runMockAnalysis(h.i, h.deps);
    h.i.need = 'no_meaningful_change'; await runMockAnalysis(h.i, h.deps);
  } finally { globalThis.fetch = original; }
  assert.equal(network, 0);
});
test('D29 fully explicit zero-cost fixture may use a zero envelope; missing usage never implies free', async () => {
  const h = harness(); h.i.budget.overallLimitMicros = 0; h.i.budget.analysisLimit = { enabled: true, limitMicros: 0 };
  h.i.budget.maxRequestMicros = 0; h.i.price.maximumChargeMicros = 0; h.response.usage.actualChargeMicros = 0;
  const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.state, 'review_required'); assert.equal(result.actualChargeMicros, 0);
});
test('D30 exceeding enforced output-token bound blocks even when mock charge does not exceed reservation', async () => {
  const h = harness(); h.response.usage.outputTokens = h.i.price.maxOutputTokens + 1;
  const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.reason, 'charge_or_usage_overrun'); assert.equal(result.blockFurtherDispatch, true);
  assert.equal(h.settled[0].actualChargeMicros, 60); assert.equal(result.candidate, undefined);
});
test('D31 explicitly selected and consented complex tier works without automatic model routing', async () => {
  const i = input(); i.need = 'complex_review'; i.selection.tier = 'complex'; i.selection.model = 'fixture-complex';
  i.price.tier = 'complex'; i.price.model = i.selection.model;
  const h = harness(i); const result = await runMockAnalysis(h.i, h.deps);
  assert.equal(result.state, 'review_required'); assert.equal(h.requests[0].model, 'fixture-complex');
});
test('D32 provider target mutation while reservation is pending blocks generation', async () => {
  const h = harness(), original = h.deps.budget.reserve;
  h.deps.budget.reserve = async b => { const result = await original(b); h.deps.provider.model = 'unexpected'; return result; };
  const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.reason, 'provider_model_mismatch'); assert.equal(h.calls.generate, 0);
});
test('D33 settlement exception does not cancel charge or reveal exception details', async () => {
  const h = harness(); h.deps.budget.settle = async () => { throw Error('SECRET_LEDGER'); };
  const result = await runMockAnalysis(h.i, h.deps); assert.equal(result.reason, 'settlement_uncertain');
  assert.equal(result.retainedChargeMicros, 100); assert.equal(result.actualChargeMicros, 60); assert.equal(JSON.stringify(result).includes('SECRET'), false);
});
test('D34 malformed/coercible confidence, unknown unsupported fields and unusable evidence fail validation', () => {
  for (const confidence of [['HIGH'], { toString: () => { throw Error('Must not coerce'); } }, 1]) {
    assert.equal(validateAnalysisCandidate({ ...candidate(), confidence }, evidence()).ok, false);
  }
  const facts = evidence(); facts.facts.find(fact => fact.id === 'weight.yesterday.mean')!.quality.status = 'stale';
  assert.equal(validateAnalysisCandidate(candidate(), facts).ok, false);
});
test('D35 expiry during the final asynchronous consent read still prevents generation', async () => {
  const h = harness(), original = h.deps.readConsent;
  h.deps.readConsent = async (...args) => {
    const result = await original(...args);
    if (h.calls.consent === 3) h.now = '2026-10-09T18:00:00.001Z';
    return result;
  };
  const result = await runMockAnalysis(h.i, h.deps);
  assert.equal(result.reason, 'price_or_snapshot_expired'); assert.equal(h.calls.generate, 0); assert.equal(result.retainedChargeMicros, 100);
});
test('D36 incomplete usage preserves an observed larger liability without confirming it and freezes further dispatch', async () => {
  for (const incomplete of [{ billableUnitsComplete: false }, { inputTokens: undefined }]) {
    const h = harness(); Object.assign(h.response.usage, incomplete, { actualChargeMicros: 150 });
    const result = await runMockAnalysis(h.i, h.deps);
    assert.equal(result.reason, 'usage_unknown'); assert.equal(result.actualChargeMicros, null);
    assert.equal(result.retainedChargeMicros, 150); assert.equal(result.blockFurtherDispatch, true);
    assert.equal(h.calls.settle, 0); assert.equal(h.calls.hold, 1);
    assert.equal(h.reservations.get(h.i.requestId)!.retainedChargeMicros, 150);
    h.i.requestId = 'after-incomplete-overrun'; h.consent!.requestId = h.i.requestId;
    assert.equal((await runMockAnalysis(h.i, h.deps)).reason, 'reservation_denied');
    assert.equal(h.calls.generate, 1);
  }
});
test('D37 incomplete usage still blocks after output-bound violation and does not coerce an unknown charge', async () => {
  const h = harness(); Object.assign(h.response.usage, { outputTokens: h.i.price.maxOutputTokens + 1, actualChargeMicros: '999' });
  const result = await runMockAnalysis(h.i, h.deps);
  assert.equal(result.reason, 'usage_unknown'); assert.equal(result.actualChargeMicros, null);
  assert.equal(result.retainedChargeMicros, 100); assert.equal(result.blockFurtherDispatch, true);
  assert.equal(h.calls.hold, 1); assert.equal(h.calls.settle, 0);
});
test('D38 unknown-hold persistence failure keeps the larger liability, exposes no candidate and requests dispatch shutdown', async () => {
  for (const failure of ['uncertain', 'throw']) {
    const h = harness(); Object.assign(h.response.usage, { billableUnitsComplete: false, actualChargeMicros: 150 });
    h.deps.budget.holdUnknown = async () => { if (failure === 'throw') throw Error('SECRET_HOLD'); return 'uncertain'; };
    const result = await runMockAnalysis(h.i, h.deps);
    assert.equal(result.accounting, 'uncertain'); assert.equal(result.retainedChargeMicros, 150);
    assert.equal(result.actualChargeMicros, null); assert.equal(result.candidate, undefined);
    assert.equal(result.blockFurtherDispatch, true); assert.equal(JSON.stringify(result).includes('SECRET'), false);
  }
});
test('D39 settlement uncertainty writes the full observed overrun into the fixture ledger', async () => {
  const h = harness(); h.response.usage.actualChargeMicros = 150; h.deps.budget.settle = async () => 'uncertain';
  const result = await runMockAnalysis(h.i, h.deps);
  assert.equal(result.reason, 'settlement_uncertain'); assert.equal(result.actualChargeMicros, 150);
  assert.equal(h.reservations.get(h.i.requestId)!.retainedChargeMicros, 150); assert.equal(h.calls.hold, 1);
  h.i.requestId = 'after-uncertain-settlement'; h.consent!.requestId = h.i.requestId;
  assert.equal((await runMockAnalysis(h.i, h.deps)).reason, 'reservation_denied'); assert.equal(h.calls.generate, 1);
});
test('D40 usage reconciliation is required before generation and an unrecorded unknown hold blocks continuation', async () => {
  const missing = harness(); Object.assign(missing.deps.budget, { holdUnknown: undefined });
  assert.equal((await runMockAnalysis(missing.i, missing.deps)).reason, 'mock_dependencies_required');
  assert.equal(missing.calls.reserve, 0); assert.equal(missing.calls.generate, 0);
  const h = harness(); Object.assign(h.response, { usage: undefined }); h.deps.budget.holdUnknown = async () => 'uncertain';
  const result = await runMockAnalysis(h.i, h.deps);
  assert.equal(result.reason, 'usage_unknown'); assert.equal(result.accounting, 'uncertain');
  assert.equal(result.blockFurtherDispatch, true); assert.equal(result.actualChargeMicros, null);
});
test('D41 settlement acknowledgement loss preserves confirmed spending as well as an unresolved hold', async () => {
  const h = harness(), settle = h.deps.budget.settle;
  h.deps.budget.settle = async (...args) => { await settle(...args); throw Error('Lost acknowledgement'); };
  const result = await runMockAnalysis(h.i, h.deps);
  assert.equal(result.actualChargeMicros, 60); assert.equal(result.retainedChargeMicros, 100); assert.equal(result.accounting, 'retained');
  h.i.requestId = 'after-lost-ack'; h.consent!.requestId = h.i.requestId;
  h.i.budget.overallLimitMicros = 250; h.i.budget.analysisLimit = { enabled: false };
  // Confirmed 60 + retained 100 + requested 100 is above the new 250 envelope.
  assert.equal((await runMockAnalysis(h.i, h.deps)).reason, 'reservation_denied'); assert.equal(h.calls.generate, 1);
});
test('D42 workout projection includes plan evidence but excludes all unconsented weight and spending metrics', async () => {
  const i = input(); i.domains = ['workout']; i.snapshot.sources.workout = source('PRIVATE_WORKOUT_SOURCE', [
    { id: 'PRIVATE_WORKOUT_ROW', ownerId: OWNER, revision: 1, date: '2026-10-09', status: 'completed', pain: 'yes' },
  ]);
  i.snapshot.sources.plans = source('PRIVATE_PLAN_SOURCE', [
    { id: 'PRIVATE_PLAN_ROW', ownerId: OWNER, revision: 1, date: '2026-10-09', state: 'planned' },
  ]);
  const h = harness(i); await runMockAnalysis(h.i, h.deps);
  assert.equal(h.calls.generate, 1);
  assert.deepEqual(h.requests[0].evidence.domains.map(domain => domain.domain).sort(), ['plans', 'workout']);
  assert.ok(h.requests[0].evidence.facts.every(fact => fact.id.startsWith('workout.')));
  const rate = h.requests[0].evidence.facts.find(fact => fact.id === 'workout.yesterday.recordedPlannedDayCompletionRate')!;
  assert.equal(rate.denominator, 1); assert.equal(rate.value, 100);
  assert.equal(JSON.stringify(h.requests[0]).includes('PRIVATE_'), false);
});
test('D43 freshly revoked consent during accounting still suppresses a paid candidate', async () => {
  const h = harness(), settle = h.deps.budget.settle;
  h.deps.budget.settle = async (...args) => { const result = await settle(...args); h.consent!.status = 'revoked'; return result; };
  const result = await runMockAnalysis(h.i, h.deps);
  assert.equal(result.reason, 'consent_changed'); assert.equal(result.accounting, 'settled');
  assert.equal(result.actualChargeMicros, 60); assert.equal(result.candidate, undefined);
});
