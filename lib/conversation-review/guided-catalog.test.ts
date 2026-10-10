import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GUIDED_CONVERSATION_CATALOG_VERSION,
  GUIDED_CONVERSATION_PILOT,
  GUIDED_CONVERSATION_SOURCE_VERSION,
  GUIDED_RESPONSE_POLICY,
  GUIDED_SAMPLE_MATCH_POLICY,
  GUIDED_SUMMARY_POLICY_VERSION,
  GUIDED_TURN_POLICY,
  findGuidedConversationScript,
} from '../../data/guidedConversationPilot.ts';
import {
  FREE_CONVERSATION_CATALOG_VERSION,
  FREE_CONVERSATION_COVERAGE,
  FREE_CONVERSATION_LEVELS,
  LEGACY_FREE_CONVERSATION_REVISION,
  LEGACY_FREE_CONVERSATION_SCRIPTS,
  findFreeConversationCoverage,
  findLegacyFreeConversationScript,
} from '../../data/freeConversationCatalog.ts';

// Independently pinned from the accepted authoring artifact, not today's catalog.
const expected = [
  {
    scriptId: 'guided-convenience-store-beginner', levelId: 'beginner', levelLabelKo: '왕초보',
    revision: 'sha256:4d72bba976fc0aa52a7f4913b4f08d9e8a9be1022c057e19bfeb1a90f5e4989a',
    canonicalBodyLength: 1609, canonicalScriptLength: 1700,
    steps: ['buy-item', 'hand-over-payment'],
    examples: ['これをください。', 'はい、どうぞ。'],
  },
  {
    scriptId: 'guided-convenience-store-elementary', levelId: 'elementary', levelLabelKo: '초급',
    revision: 'sha256:fb7841b7c9311d429ac7dddfc0b7cf1b3d2b97d4ff237cff5d5718cae213e99c',
    canonicalBodyLength: 2445, canonicalScriptLength: 2536,
    steps: ['request-heating', 'decline-bag', 'choose-card'],
    examples: ['はい、温めてください。', '袋は要りません。バッグがあります。', 'カードでお願いします。'],
  },
  {
    scriptId: 'guided-convenience-store-intermediate', levelId: 'intermediate', levelLabelKo: '중급',
    revision: 'sha256:9f45d6a111675b171beceb596f56fad136321478657d8797d1155c5fcb2f329c',
    canonicalBodyLength: 2904, canonicalScriptLength: 2995,
    steps: ['ask-slower-repeat', 'change-before-heating', 'request-separate-bags'],
    examples: ['すみません、もう少しゆっくり言っていただけますか。', '温める前に、こちらのサンドイッチに替えてもいいですか。', 'はい。それと、飲み物は別の袋に入れていただけますか。'],
  },
] as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function authoredRevision(script: object): string {
  const body = Object.fromEntries(Object.entries(script).filter(([key]) => key !== 'scriptRevision'));
  return `sha256:${createHash('sha256').update(canonical(body), 'utf8').digest('hex')}`;
}

function assertRecursivelyFrozen(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) assertRecursivelyFrozen(child);
  }
}

test('guided catalog uses independent, explicit policy versions without replacing legacy v1', () => {
  assert.equal(GUIDED_CONVERSATION_SOURCE_VERSION, 1);
  assert.equal(GUIDED_CONVERSATION_CATALOG_VERSION, 'free-conversation-catalog-v2');
  assert.equal(GUIDED_RESPONSE_POLICY, 'guided-fixed-exchange-v1');
  assert.equal(GUIDED_SAMPLE_MATCH_POLICY, 'guided-nfkc-example-or-reading-v1');
  assert.equal(GUIDED_SUMMARY_POLICY_VERSION, 'guided-conversation-recap-v1');
  assert.equal(GUIDED_TURN_POLICY, 'guided-explicit-submit-advances-v1');
  assert.equal(FREE_CONVERSATION_CATALOG_VERSION, 'free-conversation-catalog-v1');
});

test('all three complete script bodies match their independently pinned authored revisions', () => {
  assert.equal(GUIDED_CONVERSATION_PILOT.length, expected.length);
  for (const [index, script] of GUIDED_CONVERSATION_PILOT.entries()) {
    const pin = expected[index];
    assert.equal(script.scriptId, pin.scriptId);
    assert.equal(script.scriptRevision, pin.revision);
    assert.equal(authoredRevision(script), pin.revision);
    const body = Object.fromEntries(Object.entries(script).filter(([key]) => key !== 'scriptRevision'));
    assert.equal(canonical(body).length, pin.canonicalBodyLength);
    assert.equal(canonical(script).length, pin.canonicalScriptLength);
    assert.equal(script.contextId, 'convenience-store');
    assert.equal(script.levelId, pin.levelId);
    assert.equal(script.levelLabelKo, pin.levelLabelKo);
    assert.equal(script.levelLabelKo, FREE_CONVERSATION_LEVELS.find(level => level.id === script.levelId)?.label);
    assert.deepEqual(script.steps.map(step => step.id), pin.steps);
    assert.deepEqual(script.steps.map(step => step.learnerExample.japanese), pin.examples);
  }
});

test('digest pins every phrase, policy, label, review flag and ordered step rather than partial content', () => {
  for (const script of GUIDED_CONVERSATION_PILOT) {
    const changes: object[] = [
      { ...script, scriptId: `${script.scriptId}-changed` },
      { ...script, contextId: 'changed' },
      { ...script, levelId: 'changed' },
      { ...script, labelKo: `${script.labelKo} changed` },
      { ...script, levelLabelKo: 'changed' },
      { ...script, situationKo: `${script.situationKo} changed` },
      { ...script, goalsKo: [...script.goalsKo].reverse() },
      { ...script, completionNoteKo: `${script.completionNoteKo} changed` },
      { ...script, pronunciationNoteKo: `${script.pronunciationNoteKo} changed` },
      { ...script, steps: [...script.steps].reverse() },
      { ...script, stepCount: script.stepCount + 1 },
      { ...script, turnPolicy: 'changed' },
      { ...script, authorship: { ...script.authorship, status: 'reviewed' } },
      { ...script, authorship: { ...script.authorship, nativeSpeakerReview: 'performed' } },
      { ...script, authorship: { ...script.authorship, professionalReview: 'performed' } },
    ];
    for (const [index, step] of script.steps.entries()) {
      for (const phrase of ['prompt', 'learnerExample', 'fixedReply'] as const) {
        for (const field of ['japanese', 'reading', 'koreanPronunciation', 'meaningKo'] as const) {
          changes.push({ ...script, steps: script.steps.map((item, ordinal) => ordinal === index
            ? { ...item, [phrase]: { ...step[phrase], [field]: `${step[phrase][field]} changed` } } : item) });
        }
      }
      for (const field of ['id', 'titleKo', 'goalKo', 'hintKo'] as const) {
        changes.push({ ...script, steps: script.steps.map((item, ordinal) => ordinal === index
          ? { ...item, [field]: `${step[field]} changed` } : item) });
      }
    }
    for (const changed of changes) assert.notEqual(authoredRevision(changed), script.scriptRevision);
    // Only the digest property itself is excluded by the documented authoring recipe.
    assert.equal(authoredRevision({ ...script, scriptRevision: 'unrecognized' }), script.scriptRevision);
  }
});

test('2/3/3 authored steps have unique references and complete language/help fields', () => {
  assert.deepEqual(GUIDED_CONVERSATION_PILOT.map(script => script.stepCount), [2, 3, 3]);
  const stepReferences: string[] = [];
  const allSteps = GUIDED_CONVERSATION_PILOT.flatMap(script => [...script.steps]);
  assert.equal(allSteps.length, 8);
  assert.equal(new Set(allSteps.map(step => step.id)).size, 8);
  assert.equal(new Set(allSteps.map(step => step.learnerExample.japanese)).size, 8);
  assert.equal(new Set(allSteps.map(step => step.goalKo)).size, 8);
  for (const script of GUIDED_CONVERSATION_PILOT) {
    assert.equal(script.steps.length, script.stepCount);
    assert.equal(script.goalsKo.length, script.stepCount);
    for (const text of [script.labelKo, script.situationKo, script.completionNoteKo, script.pronunciationNoteKo, ...script.goalsKo]) {
      assert.ok(text.trim().length > 0);
    }
    for (const [index, step] of script.steps.entries()) {
      stepReferences.push(`${script.scriptId}:${script.scriptRevision}:${step.id}`);
      for (const text of [step.id, step.titleKo, step.goalKo, step.hintKo]) assert.ok(text.trim().length > 0);
      for (const phrase of [step.prompt, step.learnerExample, step.fixedReply]) {
        assert.deepEqual(Object.keys(phrase).sort(), ['japanese', 'koreanPronunciation', 'meaningKo', 'reading']);
        for (const text of Object.values(phrase)) assert.ok(text.trim().length > 0);
      }
      if (index > 0) {
        assert.ok(script.steps[index - 1].fixedReply.japanese.includes(step.prompt.japanese));
        assert.ok(script.steps[index - 1].fixedReply.reading.includes(step.prompt.reading));
      }
    }
  }
  assert.equal(new Set(stepReferences).size, 8);
});

test('all content stays explicitly locally authored, unreviewed and unassessed with approximate reading aids', () => {
  for (const script of GUIDED_CONVERSATION_PILOT) {
    assert.deepEqual(script.authorship, {
      status: 'locally-authored-unreviewed', nativeSpeakerReview: 'not-performed', professionalReview: 'not-performed',
    });
    assert.equal(script.turnPolicy, GUIDED_TURN_POLICY);
    assert.equal(script.pronunciationNoteKo, '한글 발음은 읽기 참고용 근사 표기예요. 실제 음성이나 발음 채점 결과가 아니에요.');
    assert.match(script.completionNoteKo, /평가/);
    assert.equal('currentStepId' in script, false);
    assert.equal('stepId' in script, false);
    assert.equal('assessment' in script, false);
    assert.equal('audio' in script, false);
    assert.equal('tts' in script, false);
  }
});

test('revision lookup returns exact frozen retained content and never falls back across identities', () => {
  for (const script of GUIDED_CONVERSATION_PILOT) {
    assert.equal(findGuidedConversationScript(script.scriptId, script.scriptRevision), script);
    for (const revision of ['', 'latest', 'unknown-revision', script.scriptRevision.slice(0, -1), LEGACY_FREE_CONVERSATION_REVISION]) {
      assert.equal(findGuidedConversationScript(script.scriptId, revision), undefined);
    }
    for (const other of GUIDED_CONVERSATION_PILOT) {
      if (other !== script) assert.equal(findGuidedConversationScript(script.scriptId, other.scriptRevision), undefined);
    }
    for (const id of ['', '__proto__', 'constructor', 'convenience-store', script.levelId, script.labelKo, 'legacy-cafe']) {
      assert.equal(findGuidedConversationScript(id, script.scriptRevision), undefined);
    }
    assert.equal(findLegacyFreeConversationScript(script.scriptId, script.scriptRevision), undefined);
  }
});

test('exactly three of 24 cells bind authored revisions; 21 references remain unwritten and legacy stays separate', () => {
  assert.equal(FREE_CONVERSATION_COVERAGE.length, 24);
  assert.equal(LEGACY_FREE_CONVERSATION_SCRIPTS.length, 5);
  const available = FREE_CONVERSATION_COVERAGE.filter(cell => cell.availability === 'available');
  assert.equal(available.length, 3);
  assert.deepEqual(available.map(cell => cell.id), ['convenience-store:beginner', 'convenience-store:elementary', 'convenience-store:intermediate']);
  for (const cell of FREE_CONVERSATION_COVERAGE) {
    if (cell.availability === 'available') {
      const script = findGuidedConversationScript(cell.scriptId, cell.scriptRevision);
      assert.ok(script);
      assert.equal(cell.contextId, script.contextId);
      assert.equal(cell.levelId, script.levelId);
      assert.equal(cell.contentReviewStatus, script.authorship.status);
      assert.deepEqual(cell.references, []);
    } else {
      assert.equal(cell.availability, 'reference-only');
      assert.equal(cell.contentReviewStatus, 'not-authored');
      assert.equal(cell.scriptId, null);
      assert.equal(cell.scriptRevision, null);
      assert.ok(cell.references.length > 0);
    }
  }
  for (const [context, level] of [['convenience-store', 'advanced'], ['missing', 'beginner'], ['legacy-cafe', 'beginner'], ['convenience-store', '왕초보']]) {
    assert.equal(findFreeConversationCoverage(context, level), undefined);
  }
});

test('guided content and every nested array, phrase and lookup result are recursively immutable', () => {
  assertRecursivelyFrozen(GUIDED_CONVERSATION_PILOT);
  for (const script of GUIDED_CONVERSATION_PILOT) {
    assertRecursivelyFrozen(findGuidedConversationScript(script.scriptId, script.scriptRevision));
    assert.throws(() => Object.assign(script, { scriptRevision: 'changed' }), TypeError);
    assert.throws(() => Object.assign(script.steps, { 0: script.steps[1] }), TypeError);
    assert.throws(() => Object.assign(script.steps[0].learnerExample, { japanese: 'changed' }), TypeError);
    assert.throws(() => Object.assign(script.authorship, { status: 'reviewed' }), TypeError);
  }
});

test('guided catalog has no runtime imports, crypto, audio or external runtime dependency', () => {
  const source = readFileSync(new URL('../../data/guidedConversationPilot.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\b(?:require|import|fetch|playTTS|speak)\s*\(/);
  assert.doesNotMatch(source, /crypto\.(?:subtle|createHash)/);
});
