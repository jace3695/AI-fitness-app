import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { GUIDED_CONVERSATION_REMAINING, GUIDED_CONVERSATION_REGISTRATIONS, GUIDED_CONVERSATION_CURRENT, GUIDED_CATALOGUE_VERSION, GUIDED_CATALOGUE_RESPONSE_POLICY, findGuidedConversationCatalogScript, findGuidedConversationRegistration, findCurrentGuidedConversation, findKnownGuidedConversationRevision, guidedConversationRoleLabel } from '../../data/guidedConversationCatalog.ts';
import { GUIDED_CONVERSATION_PILOT, findGuidedConversationScript } from '../../data/guidedConversationPilot.ts';
import { FREE_CONVERSATION_CONTEXTS, FREE_CONVERSATION_LEVELS, FREE_CONVERSATION_COVERAGE } from '../../data/freeConversationCatalog.ts';
import { canonicalJson, freezeGuidedSource, guidedContentSchema, guidedSourceSchema, supportedSource } from '../conversation-session/contracts.ts';

// Independently copied from the accepted external content manifest before integration.
const expected = [
  {
    "scriptId": "guided-restaurant-beginner",
    "scriptRevision": "sha256:f536c29078f567a5cc5dde12754c4e8cd406197b4daf91ff4881536fd6a0c9d3",
    "contextId": "restaurant",
    "levelId": "beginner",
    "stepCount": 2
  },
  {
    "scriptId": "guided-restaurant-elementary",
    "scriptRevision": "sha256:ad272787da4fac2df9f60d19d71c665d641dc9ec51073a137dd2ece1796c5179",
    "contextId": "restaurant",
    "levelId": "elementary",
    "stepCount": 3
  },
  {
    "scriptId": "guided-restaurant-intermediate",
    "scriptRevision": "sha256:727bd90a1981f853c2d0b2a7b4e6fc8d4a1f8cd9e2088ade9a0aa410d65d636a",
    "contextId": "restaurant",
    "levelId": "intermediate",
    "stepCount": 3
  },
  {
    "scriptId": "guided-hotel-beginner",
    "scriptRevision": "sha256:b75b4811dad73bfffdf8056a0667f95f8972a0565967eff27c4841f991ee0d02",
    "contextId": "hotel",
    "levelId": "beginner",
    "stepCount": 2
  },
  {
    "scriptId": "guided-hotel-elementary",
    "scriptRevision": "sha256:852ff666451fda9ca741a2c67753e9b72867fd3b1b1e2ca9bf9653b77e96e0cd",
    "contextId": "hotel",
    "levelId": "elementary",
    "stepCount": 3
  },
  {
    "scriptId": "guided-hotel-intermediate",
    "scriptRevision": "sha256:9ad1fdd0c5da4bb905f729d7629bacec264a4e7d4bc04946caec83eb8aaeea63",
    "contextId": "hotel",
    "levelId": "intermediate",
    "stepCount": 3
  },
  {
    "scriptId": "guided-train-beginner",
    "scriptRevision": "sha256:19f448ba6fa10f54e1f579e55a7541fc98d94505eb9fbbc3261a41fc8c50753e",
    "contextId": "train",
    "levelId": "beginner",
    "stepCount": 2
  },
  {
    "scriptId": "guided-train-elementary",
    "scriptRevision": "sha256:ab4d4a40900eb5c232d2a3090843dbe198f8113854248349940c7f791d15c085",
    "contextId": "train",
    "levelId": "elementary",
    "stepCount": 3
  },
  {
    "scriptId": "guided-train-intermediate",
    "scriptRevision": "sha256:d5178b284e4d0d1d89a56be77a34e71923916b6a2dcf866e976f115a6bce11a5",
    "contextId": "train",
    "levelId": "intermediate",
    "stepCount": 3
  },
  {
    "scriptId": "guided-company-general-beginner",
    "scriptRevision": "sha256:fe229227b1667f00beb7c603067db8239f2bb3eefa3ec28df04957096ba3eae6",
    "contextId": "company-general",
    "levelId": "beginner",
    "stepCount": 2
  },
  {
    "scriptId": "guided-company-general-elementary",
    "scriptRevision": "sha256:461090c88ad4e775fa5f99462fb3b636c0931159dfaa67ab0d3dbbe19ecf841d",
    "contextId": "company-general",
    "levelId": "elementary",
    "stepCount": 3
  },
  {
    "scriptId": "guided-company-general-intermediate",
    "scriptRevision": "sha256:93b0f940f4a1de380b6146dac0852411e886767fa9809eea2f24b6737b7d81bb",
    "contextId": "company-general",
    "levelId": "intermediate",
    "stepCount": 3
  },
  {
    "scriptId": "guided-company-mechanical-design-beginner",
    "scriptRevision": "sha256:0e291a53f3ef71f6ef77c0eb37d45dac7ca1f5e28560e3be4ef1dffe28ca184f",
    "contextId": "company-mechanical-design",
    "levelId": "beginner",
    "stepCount": 2
  },
  {
    "scriptId": "guided-company-mechanical-design-elementary",
    "scriptRevision": "sha256:124209ba5e67d5628324a3a453245a0e493e8e6a5a20d41374121416e670324c",
    "contextId": "company-mechanical-design",
    "levelId": "elementary",
    "stepCount": 3
  },
  {
    "scriptId": "guided-company-mechanical-design-intermediate",
    "scriptRevision": "sha256:e7122f518361da4322d717ce5f3873c1cd67a51a44a1b824a136a54b0ca47afa",
    "contextId": "company-mechanical-design",
    "levelId": "intermediate",
    "stepCount": 3
  },
  {
    "scriptId": "guided-company-development-beginner",
    "scriptRevision": "sha256:077fe1b205adf6527f62448bb2fcdcb09c12c006e51df4993fd585246e73e09d",
    "contextId": "company-development",
    "levelId": "beginner",
    "stepCount": 2
  },
  {
    "scriptId": "guided-company-development-elementary",
    "scriptRevision": "sha256:fe529450660ac9feb889f086ba71dabd7c5660cdd7de488d7fc2883e5f552249",
    "contextId": "company-development",
    "levelId": "elementary",
    "stepCount": 3
  },
  {
    "scriptId": "guided-company-development-intermediate",
    "scriptRevision": "sha256:6a8c204a6396d1d8f3018f213d878227590d96251910fa2b09ea38ea532c9264",
    "contextId": "company-development",
    "levelId": "intermediate",
    "stepCount": 3
  },
  {
    "scriptId": "guided-company-quality-beginner",
    "scriptRevision": "sha256:1b28ee02e6b75c2270ef92e79ec301e1f5210d3724396e9d47fc52bb0a0a3de8",
    "contextId": "company-quality",
    "levelId": "beginner",
    "stepCount": 2
  },
  {
    "scriptId": "guided-company-quality-elementary",
    "scriptRevision": "sha256:5072ae7dcd99bfec4209b8424ee58a55d76338099deec57b7e8375be6d143dad",
    "contextId": "company-quality",
    "levelId": "elementary",
    "stepCount": 3
  },
  {
    "scriptId": "guided-company-quality-intermediate",
    "scriptRevision": "sha256:525fe4c01d580121d882fb7d5414d97b0f0bad11a00f6f536b8347d80734482f",
    "contextId": "company-quality",
    "levelId": "intermediate",
    "stepCount": 3
  }
] as const;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function frozen(value: unknown): void {
  if (value !== null && typeof value === 'object') { assert.equal(Object.isFrozen(value), true); for (const child of Object.values(value)) frozen(child); }
}

test('accepted 21 complete content digests and 56 ordered steps pass actual content and source schemas', () => {
  assert.equal(GUIDED_CONVERSATION_REMAINING.length, 21);
  assert.equal(new Set(expected.map(item => item.scriptRevision)).size, 21);
  let links = 0;
  for (const [index, script] of GUIDED_CONVERSATION_REMAINING.entries()) {
    const pin = expected[index];
    for (const key of ['scriptId', 'scriptRevision', 'contextId', 'levelId', 'stepCount'] as const) assert.equal(script[key], pin[key]);
    const body = Object.fromEntries(Object.entries(script).filter(([key]) => key !== 'scriptRevision'));
    assert.equal(`sha256:${hash(canonicalJson(body))}`, pin.scriptRevision);
    assert.equal(script.stepCount, script.levelId === 'beginner' ? 2 : 3);
    assert.equal(script.steps.length, script.stepCount); assert.equal(new Set(script.steps.map(step => step.id)).size, script.stepCount);
    assert.equal(guidedContentSchema.safeParse(script).success, true);
    const source = freezeGuidedSource(script.scriptId, pin.scriptRevision)!;
    assert.equal(guidedSourceSchema.safeParse(source).success, true); assert.equal(supportedSource(source), true);
    assert.deepEqual(source.content, script); assert.equal(source.sourceVersion, 1);
    assert.equal(source.catalogVersion, 'free-conversation-catalog-v3'); assert.equal(source.builderPolicy, 'guided-fixed-exchange-v2');
    assert.equal(source.matchPolicy, 'guided-nfkc-example-or-reading-v1');
    assert.deepEqual(source.contentSource, { kind: 'authored-guided-conversation', module: 'data/guidedConversationCatalog.ts', exportName: 'GUIDED_CONVERSATION_REMAINING', entryKey: script.scriptId, revision: pin.scriptRevision });
    assert.deepEqual(script.authorship, { status: 'locally-authored-unreviewed', nativeSpeakerReview: 'not-performed', professionalReview: 'not-performed' });
    assert.equal(script.turnPolicy, 'guided-explicit-submit-advances-v1');
    assert.equal(script.pronunciationNoteKo, '한글 발음은 읽기 참고용 근사 표기예요. 실제 음성이나 발음 채점 결과가 아니에요.');
    for (const [ordinal, step] of script.steps.entries()) {
      for (const phrase of [step.prompt, step.learnerExample, step.fixedReply]) {
        assert.deepEqual(Object.keys(phrase).sort(), ['japanese', 'koreanPronunciation', 'meaningKo', 'reading']);
        for (const value of Object.values(phrase)) assert.ok(value.trim());
      }
      if (ordinal) { assert.deepEqual(step.prompt, script.steps[ordinal - 1].fixedReply); links++; }
    }
    assert.equal(findGuidedConversationScript(script.scriptId, script.scriptRevision), undefined);
    frozen(source);
  }
  assert.equal(links, 35); assert.equal(GUIDED_CONVERSATION_REMAINING.reduce((n, script) => n + script.stepCount, 0), 56);
  assert.equal(Math.max(...GUIDED_CONVERSATION_REMAINING.map(script => canonicalJson(script).length)), 3809);
});

test('24 explicit current pointers resolve exact retained identities without first/latest or level fallback', () => {
  assert.equal(GUIDED_CATALOGUE_VERSION, 'free-conversation-catalog-v3'); assert.equal(GUIDED_CATALOGUE_RESPONSE_POLICY, 'guided-fixed-exchange-v2');
  assert.equal(GUIDED_CONVERSATION_REGISTRATIONS.length, 24); assert.equal(GUIDED_CONVERSATION_CURRENT.length, 24);
  assert.equal(new Set(GUIDED_CONVERSATION_CURRENT.map(item => `${item.contextId}:${item.levelId}`)).size, 24);
  assert.equal(GUIDED_CONVERSATION_REGISTRATIONS.reduce((n, source) => n + source.content.stepCount, 0), 64);
  for (const context of FREE_CONVERSATION_CONTEXTS) for (const level of FREE_CONVERSATION_LEVELS) {
    const pointer = GUIDED_CONVERSATION_CURRENT.find(item => item.contextId === context.id && item.levelId === level.id)!;
    assert.ok(pointer); const source = findGuidedConversationRegistration(pointer.scriptId, pointer.scriptRevision)!;
    assert.equal(findCurrentGuidedConversation(context.id, level.id), source);
    assert.equal(findGuidedConversationCatalogScript(pointer.scriptId, pointer.scriptRevision), source.content);
    assert.equal(source.contextId, context.id); assert.equal(source.levelId, level.id);
    const cell = FREE_CONVERSATION_COVERAGE.find(item => item.id === `${context.id}:${level.id}`)!;
    assert.equal(cell.availability, 'available'); assert.equal(cell.scriptId, pointer.scriptId); assert.equal(cell.scriptRevision, pointer.scriptRevision);
  }
  for (const source of GUIDED_CONVERSATION_REGISTRATIONS) {
    for (const invalid of ['', '__proto__', 'constructor', 'latest', 'missing']) {
      assert.equal(findGuidedConversationRegistration(invalid, source.scriptRevision), undefined);
      assert.equal(findGuidedConversationRegistration(source.scriptId, invalid), undefined);
      assert.equal(findCurrentGuidedConversation(invalid, source.levelId), undefined);
      assert.equal(findCurrentGuidedConversation(source.contextId, invalid), undefined);
    }
    for (const other of GUIDED_CONVERSATION_REGISTRATIONS) if (other !== source) assert.equal(findGuidedConversationRegistration(source.scriptId, other.scriptRevision), undefined);
  }
  for (const value of [GUIDED_CONVERSATION_REMAINING, GUIDED_CONVERSATION_REGISTRATIONS, GUIDED_CONVERSATION_CURRENT]) frozen(value);
});

test('new known revisions pin only their namespace while pilot hashes retain predecessor meaning', () => {
  for (const script of GUIDED_CONVERSATION_REMAINING) {
    assert.equal(findKnownGuidedConversationRevision('data/guidedConversationCatalog.ts', 'GUIDED_CONVERSATION_REMAINING', script.scriptRevision)?.scriptId, script.scriptId);
    for (const [module, name] of [['data/guidedConversationPilot.ts', 'GUIDED_CONVERSATION_PILOT'], ['data/guidedConversationCatalog.ts', 'GUIDED_CONVERSATION_PILOT'], ['unknown', 'GUIDED_CONVERSATION_REMAINING']]) assert.equal(findKnownGuidedConversationRevision(module, name, script.scriptRevision), undefined);
  }
  for (const script of GUIDED_CONVERSATION_PILOT) assert.equal(findKnownGuidedConversationRevision('unknown', 'unknown', script.scriptRevision)?.scriptId, script.scriptId);
  assert.equal(guidedConversationRoleLabel('guided-fixed-exchange-v1'), '점원');
  assert.equal(guidedConversationRoleLabel('guided-fixed-exchange-v2'), '상대방');
  assert.equal(guidedConversationRoleLabel('unsupported'), '상대방');
});

test('original content remains byte-pinned and additive runtime closure is pure data with no cycle', () => {
  for (const [path, digest] of [
    ['../../data/freeConversation.ts', 'b92edd91c70d93da57f767c30405fd013460fd98216447854212b6e7bc7483be'],
    ['../../data/guidedConversationPilot.ts', 'ea2754df48ec63198f717fc4b70cd715532c16e5fb31183bb57a9f72e228a1b1'],
  ]) assert.equal(hash(readFileSync(new URL(path, import.meta.url))), digest);
  const source = readFileSync(new URL('../../data/guidedConversationCatalog.ts', import.meta.url), 'utf8');
  const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  assert.deepEqual([...emitted.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]), ['./guidedConversationPilot.ts']);
  assert.doesNotMatch(emitted, /\b(?:require|import|fetch|playTTS|speak|setTimeout)\s*\(/);
  assert.doesNotMatch(emitted, /\b(?:window|localStorage|sessionStorage|Date|crypto|process)\b/);
});
