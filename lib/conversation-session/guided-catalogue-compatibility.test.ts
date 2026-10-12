import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as v1 from './legacy-v1-contracts.test-support.ts';
import * as pilot from './pilot-v2-contracts.test-support.ts';
import * as current from './contracts.ts';
import { FREE_CONVERSATION_CATALOG_VERSION, FREE_CONVERSATION_SAMPLE_MATCH_POLICY, LEGACY_FREE_CONVERSATION_REVISION, LEGACY_FREE_CONVERSATION_SCRIPTS } from '../../data/freeConversationCatalog.ts';
import { GUIDED_CONVERSATION_PILOT } from '../../data/guidedConversationPilot.ts';
import { GUIDED_CONVERSATION_REMAINING } from '../../data/guidedConversationCatalog.ts';
import { base, emptySession, draft, close, resolution, TIME, ok } from './fixtures.test-support.ts';
import { planCreateSession, planSaveDraft, planStage, planApply, planResolve, sessionSource } from './reducer.ts';
import { languageFixture } from '../../tests/helpers/languageFixture.ts';
import { conversationLocalKey } from '../../app/data/languageLocalParticipants.ts';

// Captured before editing the shared catalogue dependency. Neither comparator
// imports these literals from current production data or regenerates them.
const legacyPins = [
  {
    "id": "legacy-cafe",
    "canonical": "{\"builderPolicy\":\"legacy-fixed-response-v1\",\"catalogVersion\":\"free-conversation-catalog-v1\",\"content\":{\"hint\":\"따뜻한 커피는 ホット、차가운 커피는 アイス라고 말해요.\",\"japanese\":\"コーヒーを一つください。\",\"meaning\":\"커피 한 잔 주세요.\",\"pronunciation\":\"코오히이오 히토츠 쿠다사이\",\"reading\":\"こーひーをひとつください。\",\"reply\":\"ホットとアイス、どちらになさいますか？\",\"replyPronunciation\":\"홋토토 아이스, 도치라니 나사이마스카?\",\"replyReading\":\"ほっととあいす、どちらになさいますか？\"},\"contentSource\":{\"entryKey\":\"카페\",\"exportName\":\"FREE_CONVERSATIONS\",\"kind\":\"legacy-example\",\"module\":\"data/freeConversation.ts\",\"revision\":\"sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be\"},\"contextId\":\"legacy-cafe\",\"label\":\"카페\",\"levelId\":\"unlevelled\",\"matchPolicy\":\"nfkc-strip-whitespace-japanese-punctuation-v1\",\"scriptId\":\"legacy-cafe\",\"scriptRevision\":\"sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be\",\"stepId\":\"legacy-cafe:exchange-1\"}"
  },
  {
    "id": "legacy-travel",
    "canonical": "{\"builderPolicy\":\"legacy-fixed-response-v1\",\"catalogVersion\":\"free-conversation-catalog-v1\",\"content\":{\"hint\":\"장소를 물을 때는 「장소 + はどこですか」를 써요. 실제 길 안내가 아닌 연습 문장이에요.\",\"japanese\":\"駅はどこですか？\",\"meaning\":\"역은 어디인가요?\",\"pronunciation\":\"에키와 도코데스카?\",\"reading\":\"えきはどこですか？\",\"reply\":\"駅まで一緒に行きましょう。\",\"replyPronunciation\":\"에키마데 잇쇼니 이키마쇼오\",\"replyReading\":\"えきまでいっしょにいきましょう。\"},\"contentSource\":{\"entryKey\":\"여행\",\"exportName\":\"FREE_CONVERSATIONS\",\"kind\":\"legacy-example\",\"module\":\"data/freeConversation.ts\",\"revision\":\"sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be\"},\"contextId\":\"legacy-travel\",\"label\":\"여행\",\"levelId\":\"unlevelled\",\"matchPolicy\":\"nfkc-strip-whitespace-japanese-punctuation-v1\",\"scriptId\":\"legacy-travel\",\"scriptRevision\":\"sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be\",\"stepId\":\"legacy-travel:exchange-1\"}"
  },
  {
    "id": "legacy-daily",
    "canonical": "{\"builderPolicy\":\"legacy-fixed-response-v1\",\"catalogVersion\":\"free-conversation-catalog-v1\",\"content\":{\"hint\":\"「〜ませんか」는 상대방에게 함께 하자고 권하는 표현이에요.\",\"japanese\":\"今日はいい天気ですね。\",\"meaning\":\"오늘은 날씨가 좋네요.\",\"pronunciation\":\"쿄오와 이이 텐키데스네\",\"reading\":\"きょうはいいてんきですね。\",\"reply\":\"そうですね。散歩に行きませんか？\",\"replyPronunciation\":\"소오데스네. 산포니 이키마센카?\",\"replyReading\":\"そうですね。さんぽにいきませんか？\"},\"contentSource\":{\"entryKey\":\"일상\",\"exportName\":\"FREE_CONVERSATIONS\",\"kind\":\"legacy-example\",\"module\":\"data/freeConversation.ts\",\"revision\":\"sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be\"},\"contextId\":\"legacy-daily\",\"label\":\"일상\",\"levelId\":\"unlevelled\",\"matchPolicy\":\"nfkc-strip-whitespace-japanese-punctuation-v1\",\"scriptId\":\"legacy-daily\",\"scriptRevision\":\"sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be\",\"stepId\":\"legacy-daily:exchange-1\"}"
  },
  {
    "id": "legacy-work",
    "canonical": "{\"builderPolicy\":\"legacy-fixed-response-v1\",\"catalogVersion\":\"free-conversation-catalog-v1\",\"content\":{\"hint\":\"図面은 도면, 確認은 확인이에요. 「〜をお願いします」로 정중하게 부탁할 수 있어요.\",\"japanese\":\"図面の確認をお願いします。\",\"meaning\":\"도면 확인을 부탁드립니다.\",\"pronunciation\":\"즈멘노 카쿠닌오 오네가이시마스\",\"reading\":\"ずめんのかくにんをおねがいします。\",\"reply\":\"承知しました。確認してご連絡します。\",\"replyPronunciation\":\"쇼오치시마시타. 카쿠닌시테 고렌라쿠시마스\",\"replyReading\":\"しょうちしました。かくにんしてごれんらくします。\"},\"contentSource\":{\"entryKey\":\"업무\",\"exportName\":\"FREE_CONVERSATIONS\",\"kind\":\"legacy-example\",\"module\":\"data/freeConversation.ts\",\"revision\":\"sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be\"},\"contextId\":\"legacy-work\",\"label\":\"업무\",\"levelId\":\"unlevelled\",\"matchPolicy\":\"nfkc-strip-whitespace-japanese-punctuation-v1\",\"scriptId\":\"legacy-work\",\"scriptRevision\":\"sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be\",\"stepId\":\"legacy-work:exchange-1\"}"
  },
  {
    "id": "legacy-friends",
    "canonical": "{\"builderPolicy\":\"legacy-fixed-response-v1\",\"catalogVersion\":\"free-conversation-catalog-v1\",\"content\":{\"hint\":\"친구 사이에서는 「〜よう」로 같이 하자고 말해요.\",\"japanese\":\"一緒にご飯を食べよう。\",\"meaning\":\"같이 밥 먹자.\",\"pronunciation\":\"잇쇼니 고항오 타베요오\",\"reading\":\"いっしょにごはんをたべよう。\",\"reply\":\"いいね！何を食べたい？\",\"replyPronunciation\":\"이이네! 나니오 타베타이?\",\"replyReading\":\"いいね！なにをたべたい？\"},\"contentSource\":{\"entryKey\":\"친구\",\"exportName\":\"FREE_CONVERSATIONS\",\"kind\":\"legacy-example\",\"module\":\"data/freeConversation.ts\",\"revision\":\"sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be\"},\"contextId\":\"legacy-friends\",\"label\":\"친구\",\"levelId\":\"unlevelled\",\"matchPolicy\":\"nfkc-strip-whitespace-japanese-punctuation-v1\",\"scriptId\":\"legacy-friends\",\"scriptRevision\":\"sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be\",\"stepId\":\"legacy-friends:exchange-1\"}"
  }
] as const;
function create(source: current.ConversationSource, previous = base(), sessionId = 'session-a') {
  return ok(planCreateSession(previous, previous, { ...emptySession(sessionId), source }));
}
function save(e: current.ConversationEnvelope, input = 'unassessed input', draftId = `draft-${e.sessions[0].turns.length}`) {
  const s = e.sessions[0], stepId = current.getConversationProgress(s)!.activeStepId!;
  return ok(planSaveDraft(e, sessionSource(e, s.sessionId)!, { ...draft(draftId, input), source: current.sourceRef(s.source, stepId) }));
}
function append(e: current.ConversationEnvelope, operationId = `append-${e.sessions[0].operations.length}`): current.ConversationCommand {
  const s = e.sessions[0], d = s.drafts.at(-1)!;
  const fields = { turnId: `turn-${operationId}`, sequence: s.turns.length + 1, predecessorTurnId: s.turns.at(-1)?.turnId ?? null, recordedAt: TIME };
  const turn = current.isGuidedSource(s.source) ? current.buildGuidedTurn(s, d, fields) : current.buildFrozenTurn(s.source, d, fields);
  assert.ok(turn); return { kind: 'append', operationId, receiptId: `receipt-${operationId}`, ownerId: e.ownerId, generationId: e.generationId, sessionId: s.sessionId, expectedHeadRevision: s.headRevision, turn };
}
function closing(e: current.ConversationEnvelope, id = `close-${e.sessions[0].operations.length}`) {
  const c = close(e, id); assert.ok(c.kind === 'close');
  if (current.isGuidedSource(e.sessions[0].source)) c.boundary.summaryPolicyVersion = current.GUIDED_SUMMARY_POLICY_VERSION;
  return c;
}
function stage(e: current.ConversationEnvelope, c: current.ConversationCommand) { return ok(planStage(e, sessionSource(e, c.sessionId)!, c)); }
function apply(e: current.ConversationEnvelope, c: current.ConversationCommand) { return ok(planApply(e, c)); }
function commit(e: current.ConversationEnvelope, c: current.ConversationCommand) { return apply(stage(e, c), c); }
function cancel(e: current.ConversationEnvelope, c: current.ConversationCommand) { return ok(planResolve(e, sessionSource(e, c.sessionId)!, c, resolution(e, c, `resolution-${c.operationId}`))); }
function compareOld(e: current.ConversationEnvelope) {
  const raw = current.canonicalJson(e); assert.deepEqual(current.parseEnvelope(raw), pilot.parseEnvelope(raw));
  assert.equal(pilot.parseEnvelope(raw).status, 'valid'); assert.deepEqual(current.encodeEnvelope(e), pilot.encodeEnvelope(e));
  assert.deepEqual(current.capacityUsage(e), pilot.capacityUsage(e as pilot.ConversationEnvelope));
  if (e.schemaVersion === 1) { assert.deepEqual(current.parseEnvelope(raw), v1.parseEnvelope(raw)); assert.deepEqual(current.encodeEnvelope(e), v1.encodeEnvelope(e)); }
  assert.equal(current.canonicalJson(e), raw);
}

test('both frozen predecessor files, legacy constants and all five independent wrapper bytes stay pinned', () => {
  for (const [path, digest] of [
    ['./legacy-v1-contracts.test-support.ts', '7b6da2573ae21037409d3e110eeddaf954f8606eab22bb3ed2cbd4bbf56709db'],
    ['./pilot-v2-contracts.test-support.ts', '00eeee45d0386458870e0d12e23af91739dbeeaa80306e4d274368933dc59619'],
  ]) assert.equal(createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex'), digest);
  assert.equal(FREE_CONVERSATION_CATALOG_VERSION, 'free-conversation-catalog-v1');
  assert.equal(FREE_CONVERSATION_SAMPLE_MATCH_POLICY, 'nfkc-strip-whitespace-japanese-punctuation-v1');
  assert.equal(LEGACY_FREE_CONVERSATION_REVISION, 'sha256:b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be');
  for (const pin of legacyPins) for (const api of [v1, pilot, current]) assert.equal(api.canonicalJson(api.freezeLegacySource(pin.id)), pin.canonical);
});

for (const script of LEGACY_FREE_CONVERSATION_SCRIPTS) test(`${script.scriptId}: both old builders and current retain exact emission and lifecycle bytes`, () => {
  const now = current.freezeLegacySource(script.scriptId)!;
  for (const input of [script.content.japanese, script.content.reading, ` \n${script.content.japanese}?! `, '한국어 alternative', '！？', ' Ａ\u0301 ']) {
    const d = { ...draft(), input, source: current.sourceRef(now) }, fields = { turnId: 'turn-compat', sequence: 1, predecessorTurnId: null, recordedAt: TIME };
    const bytes = current.canonicalJson(current.buildFrozenTurn(now, d, fields));
    for (const old of [v1, pilot]) assert.equal(old.canonicalJson(old.buildFrozenTurn(old.freezeLegacySource(script.scriptId)!, d, fields)), bytes);
  }
  let e = create(now); compareOld(e); compareOld({ ...e, schemaVersion: 2 }); e = save(e); compareOld(e);
  const a = append(e), pending = stage(e, a); compareOld(pending); compareOld(cancel(pending, a)); e = apply(pending, a); compareOld(e);
  const c = closing(e); compareOld(stage(e, c)); compareOld(cancel(stage(e, c), c)); compareOld(commit(e, c));
});

for (const script of GUIDED_CONVERSATION_PILOT) test(`${script.scriptId}: all pilot steps, policies, replay prefixes, lanes and close states preserve old bytes`, () => {
  const now = current.freezeGuidedSource(script.scriptId, script.scriptRevision)!;
  assert.equal(current.canonicalJson(now), pilot.canonicalJson(pilot.freezeGuidedSource(script.scriptId, script.scriptRevision)));
  assert.equal(now.catalogVersion, 'free-conversation-catalog-v2'); assert.equal(now.builderPolicy, 'guided-fixed-exchange-v1');
  let prefix = create(now); compareOld(prefix); compareOld(commit(prefix, closing(prefix)));
  const retained = { ...draft('retained-pilot', 'old source unsent'), source: current.sourceRef(now, script.steps[0].id) };
  for (const step of script.steps) {
    for (const input of [step.learnerExample.japanese, step.learnerExample.reading, `　${step.learnerExample.japanese}?!　`, '한국어 alternative', '。！？', 'Ａe\u0301']) {
      const e = save(prefix, input), s = e.sessions[0], d = s.drafts.at(-1)!, c = append(e); assert.ok(c.kind === 'append');
      const old = pilot.buildGuidedTurn(s as pilot.ConversationSession, d, c.turn);
      assert.equal(current.canonicalJson(c.turn), pilot.canonicalJson(old)); assert.match(c.turn.emission.explanation, /점원 응답/);
      const pending = stage(e, c); compareOld(e); compareOld(pending); compareOld(cancel(pending, c)); compareOld(apply(pending, c));
    }
    prefix = save(prefix); prefix = commit(prefix, append(prefix)); compareOld(prefix);
    const closeCommand = closing(prefix); compareOld(stage(prefix, closeCommand)); compareOld(cancel(stage(prefix, closeCommand), closeCommand)); compareOld(commit(prefix, closeCommand));
  }
  assert.equal(prefix.sessions[0].closed, null);
  prefix = ok(planSaveDraft(prefix, sessionSource(prefix, 'session-a')!, retained)); compareOld(prefix);
  prefix = commit(prefix, closing(prefix)); compareOld(prefix);
  assert.equal(prefix.sessions[0].drafts[0].input, retained.input);
  const mixed = create(current.freezeLegacySource('legacy-work')!, prefix, 'legacy-after-pilot'); compareOld(mixed);
  assert.equal(current.canonicalJson(mixed.sessions[0]), current.canonicalJson(prefix.sessions[0]));
});

test('empty, legacy-only v1/v2 and mixed historical sources keep identical admissions', () => {
  compareOld(base()); compareOld({ ...base(), schemaVersion: 2 });
  let e = create(current.freezeLegacySource('legacy-cafe')!);
  for (const script of GUIDED_CONVERSATION_PILOT) e = create(current.freezeGuidedSource(script.scriptId, script.scriptRevision)!, e, script.scriptId);
  compareOld(e); const raw = current.canonicalJson(e);
  assert.deepEqual(v1.parseEnvelope(raw), { status: 'blocked', code: 'unsupported-schema' });
});

for (const script of GUIDED_CONVERSATION_REMAINING) test(`${script.scriptId}: old opaque revision collision stays canonical read-only with no namespace promotion`, () => {
  const oldScript = GUIDED_CONVERSATION_PILOT[1], e = structuredClone(create(current.freezeGuidedSource(oldScript.scriptId, oldScript.scriptRevision)!));
  const s = e.sessions[0].source; assert.ok(current.isGuidedSource(s));
  s.scriptRevision = s.content.scriptRevision = s.contentSource.revision = script.scriptRevision;
  compareOld(e); assert.equal(pilot.supportedSource(s as pilot.GuidedConversationSource), false); assert.equal(current.supportedSource(s), false);
  assert.equal(current.getConversationProgress(e.sessions[0]), undefined);
  const d = { ...draft(), source: current.sourceRef(s, s.content.steps[0].id) };
  assert.equal(planSaveDraft(e, sessionSource(e, 'session-a')!, d).status, 'blocked');
  assert.equal(current.buildGuidedTurn(e.sessions[0], d, { turnId: 'no-promotion', sequence: 1, predecessorTurnId: null, recordedAt: TIME }), undefined);
  const unknown = structuredClone(e); unknown.sessions[0].source.builderPolicy = 'unknown-policy'; unknown.sessions[0].source.matchPolicy = 'unknown-match'; compareOld(unknown);
  const renamed = structuredClone(e), renamedSource = renamed.sessions[0].source; assert.ok(current.isGuidedSource(renamedSource));
  renamedSource.scriptId = renamedSource.content.scriptId = renamedSource.contentSource.entryKey = script.scriptId;
  compareOld(renamed); assert.equal(current.supportedSource(renamedSource), false);
});

test('recognized new unknown revisions stay read-only; unknown layouts and cross-namespace laundering stay blocked', () => {
  const script = GUIDED_CONVERSATION_REMAINING[0], original = create(current.freezeGuidedSource(script.scriptId, script.scriptRevision)!);
  const unknown = structuredClone(original), s = unknown.sessions[0].source; assert.ok(current.isGuidedSource(s));
  s.scriptRevision = s.content.scriptRevision = s.contentSource.revision = 'unknown-new-revision';
  s.builderPolicy = 'unknown-new-policy'; assert.equal(current.validateEnvelope(unknown).status, 'valid'); assert.equal(current.supportedSource(s), false);
  assert.equal(planSaveDraft(unknown, sessionSource(unknown, 'session-a')!, { ...draft(), source: current.sourceRef(s, s.content.steps[0].id) }).status, 'blocked');
  for (const mutate of [
    (value: typeof s) => { value.contentSource.module = 'data/guidedConversationPilot.ts'; },
    (value: typeof s) => { value.contentSource.exportName = 'GUIDED_CONVERSATION_PILOT'; },
    (value: typeof s) => { Object.assign(value, { extra: true }); },
    (value: typeof s) => { Object.assign(value.contentSource, { module: 'unknown-module' }); },
    (value: typeof s) => { value.scriptRevision = value.content.scriptRevision = value.contentSource.revision = GUIDED_CONVERSATION_PILOT[0].scriptRevision; },
  ]) { const changed = structuredClone(original), source = changed.sessions[0].source; assert.ok(current.isGuidedSource(source)); mutate(source); assert.equal(current.validateEnvelope(changed).status, 'blocked'); }
});

for (const opaque of ['guided-fixed-exchange-v2', 'free-conversation-catalog-v3', 'guided-conversation-recap-v1']) test(`legacy opaque summary ${opaque} is not retroactively reinterpreted`, () => {
  let e = create(current.freezeLegacySource('legacy-cafe')!); const c = closing(e); c.boundary.summaryPolicyVersion = opaque; e = commit(e, c); compareOld(e);
  const script = GUIDED_CONVERSATION_REMAINING[0], migrated = create(current.freezeGuidedSource(script.scriptId, script.scriptRevision)!, e, 'new-guided');
  assert.equal(current.canonicalJson(migrated.sessions[0]), current.canonicalJson(e.sessions[0]));
});

for (const [name, predecessor, parserCode, participantCode] of [
  ['strict-v1', v1, 'unsupported-schema', 'unsupported-partition'],
  ['pilot-v2', pilot, 'invalid-envelope', 'invalid-partition'],
] as const) test(`${name}: new-source parser code ${parserCode} blocks shipping sync and reset as ${participantCode}, preserving raw bytes`, async t => {
  const overrides = new Map<string, unknown>([['../../lib/conversation-session/contracts.ts', predecessor]]);
  const load = async <T>(path: string): Promise<T> => {
    const url = new URL(path, import.meta.url), source = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const deps = new Map<string, unknown>();
    for (const match of source.matchAll(/require\("([^"]+)"\)/g)) { const name = match[1]; deps.set(name, overrides.has(name) ? overrides.get(name) : await import(new URL(name, url).href)); }
    const exports = {}; runInThisContext(`(function(exports, require) {${source}\n})`)(exports, (name: string) => { assert.ok(deps.has(name)); return deps.get(name); }); return exports as T;
  };
  const participant = await load<typeof import('../../app/data/languageLocalParticipants.ts')>('../../app/data/languageLocalParticipants.ts'); overrides.set('./languageLocalParticipants.ts', participant);
  const sync = await load<typeof import('../../app/data/languageCloudSync.ts')>('../../app/data/languageCloudSync.ts');
  const f = languageFixture(); t.after(f.restore); const lease = await f.owner();
  const script = GUIDED_CONVERSATION_REMAINING[0];
  const e = { ...create(current.freezeGuidedSource(script.scriptId, script.scriptRevision)!), ownerId: 'a', enrollment: { kind: 'explicit-enrollment' as const, enrollmentId: 'causal-enrollment', createdAt: TIME,
    observation: { kind: 'authenticated-remote-observation-received' as const, requestId: 'request', ownerId: 'a', ownerEpochId: 'epoch', lifecycleId: 'life', marker: null, receivedAt: TIME } } };
  const raw = current.canonicalJson(e), key = conversationLocalKey('a'); f.values.set(key, raw); const before = new Map(f.values);
  assert.equal(current.parseEnvelope(raw).status, 'valid'); assert.deepEqual(predecessor.parseEnvelope(raw), { status: 'blocked', code: parserCode });
  assert.throws(() => sync.readLanguageSyncRequest(lease, sync.createLanguageSyncLifecycle(), f.storage), error => error instanceof participant.ConversationLocalError && error.code === participantCode);
  assert.throws(() => participant.planLanguageLocalParticipants(f.storage, { ownerId: 'a', marker: '2026-10-11T00:00:00Z|11111111-1111-4111-8111-111111111111', reason: 'explicit-reset', replacement: { generationId: 'next', enrollmentId: 'next-enrollment', createdAt: TIME } }), error => error instanceof participant.ConversationLocalError && error.code === participantCode);
  assert.deepEqual(f.values, before); assert.equal(f.values.get(key), raw);
});
