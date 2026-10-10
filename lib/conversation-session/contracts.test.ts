import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFreeConversation } from '../../data/freeConversation.ts';
import { LEGACY_FREE_CONVERSATION_SCRIPTS, FREE_CONVERSATION_COVERAGE } from '../../data/freeConversationCatalog.ts';
import { buildFrozenTurn, canonicalJson, capacityUsage, CONVERSATION_LIMITS, draftSchema, encodeEnvelope, envelopeSchema, freezeLegacySource, isPlainJson, parseEnvelope, sessionSchema, validateEnvelope } from './contracts.ts';
import { append, base, commit, draft, fillBudget, getSession, save, SOURCE, stage, started } from './fixtures.test-support.ts';

test('canonical encoding roundtrips exact whitespace, Unicode and lone surrogates without mutation', () => {
  const input = ' \t合成e\u0301😀\ud800\n'; const d = draft('draft-unicode', input);
  const e = save(started(), d); const encoded = encodeEnvelope(e);
  assert.equal(encoded.status, 'encoded'); if (encoded.status !== 'encoded') return;
  const parsed = parseEnvelope(encoded.raw); assert.equal(parsed.status, 'valid'); if (parsed.status !== 'valid') return;
  assert.equal(getSession(parsed.envelope).drafts[0].input, input);
  assert.equal(Object.isFrozen(getSession(parsed.envelope).drafts[0].exposure), true);
  assert.equal(encoded.raw, canonicalJson(parsed.envelope));
});

test('ambiguous, duplicated, unknown and noncanonical JSON are blocked with fixed codes only', () => {
  const good = canonicalJson(base());
  for (const raw of [good.replace('"ownerId":"owner-a"', '"ownerId":"owner-hidden","ownerId":"owner-a"'), good.replace('"ownerId":"owner-a"', '"ownerId":"owner-a","ownerId":"owner-a"'), good.replace('"ownerId":', '"\\u006fwnerId":"hidden","ownerId":'), ` ${good}`, good.replace('"schemaVersion":1', '"schemaVersion":2'), good.replace('"sessions":[]', '"sessions":[],"secret":"poison-canary"'), '{broken-poison']) {
    const original = raw, result = parseEnvelope(raw); assert.equal(result.status, 'blocked'); assert.equal(raw, original); assert.equal(JSON.stringify(result).includes('poison'), false);
  }
  assert.equal(parseEnvelope('x'.repeat(CONVERSATION_LIMITS.envelopeCodeUnits + 1)).status, 'blocked');
});

test('strict in-memory inputs reject symbols, hidden owner data, custom prototypes, getters and cycles', () => {
  const values: unknown[] = [];
  const hidden = base(); Object.defineProperty(hidden, 'hiddenOwner', { value: 'owner-b' }); values.push(hidden);
  const symbol = base(); Object.defineProperty(symbol, Symbol('owner'), { value: 'owner-b' }); values.push(symbol);
  const getter = base(); Object.defineProperty(getter, 'ownerId', { get() { throw new Error('poison'); }, enumerable: true }); values.push(getter);
  values.push(Object.assign(Object.create({ ownerId: 'owner-b' }), base()));
  const array = base(); Object.defineProperty(array.sessions, 'extra', { value: 'hidden' }); values.push(array);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; values.push(cycle);
  for (const value of values) { assert.equal(isPlainJson(value), false); assert.equal(validateEnvelope(value).status, 'blocked'); }
});

test('known source revision pins all authored fields and actual builder branches', () => {
  assert.equal(LEGACY_FREE_CONVERSATION_SCRIPTS.length, 5); assert.equal(FREE_CONVERSATION_COVERAGE.length, 24);
  assert.ok(FREE_CONVERSATION_COVERAGE.every(cell => cell.scriptId === null));
  for (const script of LEGACY_FREE_CONVERSATION_SCRIPTS) {
    const source = freezeLegacySource(script.scriptId)!; assert.equal(source.levelId, 'unlevelled');
    for (const input of [script.content.japanese, script.content.reading, 'synthetic unmatched']) {
      const d = { ...draft('d', input), source: { scriptId: source.scriptId, scriptRevision: source.scriptRevision, stepId: source.stepId } };
      const t = buildFrozenTurn(source, d, { turnId: 't', sequence: 1, predecessorTurnId: null, recordedAt: '2026-10-10T00:00:00Z' })!;
      const { branch, postAnswerHint, ...response } = t.emission;
      assert.deepEqual(response, buildFreeConversation(script.legacySituation, input)); assert.equal(postAnswerHint, true);
      assert.equal(branch, t.sampleMatch.matched ? 'script-response' : 'sample-fallback');
    }
  }
  const e = structuredClone(started()); e.sessions[0].source.content.meaning = 'fabricated'; assert.equal(validateEnvelope(e).status, 'blocked');
});

test('empty drafts survive while blank turns and oversized input reject; exact 8000-unit input remains intact', () => {
  assert.equal(draftSchema.safeParse(draft('d', 'x'.repeat(8001))).success, false);
  for (const input of ['', ' \t\n']) { const d = draft('d', input); assert.equal(draftSchema.safeParse(d).success, true); assert.equal(buildFrozenTurn(SOURCE, d, { turnId: 't', sequence: 1, predecessorTurnId: null, recordedAt: TIME_ONLY }), undefined); }
  const input = '😀'.repeat(4000); assert.equal(input.length, 8000); assert.equal(draftSchema.safeParse(draft('d', input)).success, true);
});

test('schema bounds reject 26 sessions, 201 session turns, third lane and unsafe counters', () => {
  const e = started(); assert.equal(envelopeSchema.safeParse({ ...e, sessions: Array(26).fill(e.sessions[0]) }).success, false);
  const saved = save(e); const c = append(saved); assert.equal(c.kind, 'append'); if (c.kind !== 'append') return;
  const s = getSession(e); assert.equal(sessionSchema.safeParse({ ...s, turns: Array(201).fill(c.turn) }).success, false);
  assert.equal(sessionSchema.safeParse({ ...s, drafts: [draft('a'), draft('b'), draft('c')] }).success, false);
  for (const stateRevision of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER]) assert.equal(sessionSchema.safeParse({ ...s, stateRevision }).success, false);
  assert.equal(capacityUsage({ ...e, sessions: Array(3).fill({ ...s, turns: Array(167).fill(c.turn) }) }).committedTurns, 501);
});

test('envelope source relationships, order, receipts and frozen emission are checked', () => {
  const e = save(started()); const c = append(e); const saved = commit(e, c);
  const mutations = [
    (v: typeof saved) => { v.ownerId = 'owner-b'; },
    (v: typeof saved) => { v.generationId = 'generation-b'; },
    (v: typeof saved) => { v.sessions[0].turns[0].sequence = 2; },
    (v: typeof saved) => { v.sessions[0].turns[0].emission.replyReading = 'poison'; },
    (v: typeof saved) => { v.sessions[0].operations = []; },
    (v: typeof saved) => { v.sessions[0].operations.push(v.sessions[0].operations[0]); },
  ];
  for (const mutate of mutations) { const copy = structuredClone(saved); mutate(copy); assert.equal(validateEnvelope(copy).status, 'blocked'); }
  assert.equal(validateEnvelope(saved).status, 'valid');
});

test('canonical exact ceiling includes reserved terminal and deletion metadata, never just payload', () => {
  const e = save(started()); const pending = stage(e, append(e)); const full = fillBudget(pending);
  const usage = capacityUsage(full); assert.ok(usage.reservedCodeUnits > 0); assert.ok(usage.actualCodeUnits < 262144); assert.equal(usage.admittedCodeUnits, 262144);
  assert.equal(validateEnvelope(full).status, 'valid');
  const overflow = structuredClone(full); overflow.tombstones[0].deletionId += 'x'; assert.equal(validateEnvelope(overflow).status, 'blocked');
  assert.equal(SOURCE.matchPolicy.length > 0, true);
});

test('exact timestamp-pipe-request marker is preserved, including microseconds and tied request IDs', () => {
  const marker = '2026-10-10T00:00:00.123456Z|11111111-1111-4111-8111-111111111111';
  const e = { ...base(), marker }; const encoded = encodeEnvelope(e); assert.equal(encoded.status, 'encoded'); if (encoded.status !== 'encoded') return;
  const roundtrip = parseEnvelope(encoded.raw); assert.equal(roundtrip.status, 'valid'); if (roundtrip.status === 'valid') assert.equal(roundtrip.envelope.marker, marker);
  for (const bad of [TIME_ONLY, marker.replace('10-10', '02-30'), marker.replace('.123456', '.1234567'), marker.replace('|', '/'), marker + 'x']) assert.equal(validateEnvelope({ ...e, marker: bad }).status, 'blocked');
});
const TIME_ONLY = '2026-10-10T00:00:00.000Z';

test('unedited insertion must equal the frozen example; edited origin retains explicit exposure', () => {
  const d = { ...draft('d', 'different'), origin: { kind: 'inserted-example' as const, edited: false } };
  const e = structuredClone(started()); e.sessions[0].drafts = [d]; e.sessions[0].stateRevision = 1;
  assert.equal(validateEnvelope(e).status, 'blocked');
  e.sessions[0].drafts[0].origin.edited = true; assert.equal(validateEnvelope(e).status, 'valid');
  e.sessions[0].drafts[0].exposure.example = 'unknown'; assert.equal(validateEnvelope(e).status, 'blocked');
});
