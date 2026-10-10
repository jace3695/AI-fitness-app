import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CURRICULUM } from '../../data/curriculum.ts';
import { MANUFACTURING_CURRICULUM } from '../../data/curriculumManufacturing.ts';
import { buildFreeConversation, FREE_CONVERSATIONS } from '../../data/freeConversation.ts';
import {
  FREE_CONVERSATION_CATALOG_VERSION,
  FREE_CONVERSATION_CONTEXTS,
  FREE_CONVERSATION_COVERAGE,
  FREE_CONVERSATION_LEVELS,
  FREE_CONVERSATION_SAMPLE_MATCH_POLICY,
  LEGACY_FREE_CONVERSATION_REVISION,
  LEGACY_FREE_CONVERSATION_SCRIPTS,
  findFreeConversationCoverage,
  findLegacyFreeConversationScript,
  getFreeConversationSampleMatch,
  matchFreeConversationSample,
} from '../../data/freeConversationCatalog.ts';

const sha256 = (value: string | Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

test('catalog declares precisely the requested eight stable contexts and three levels', () => {
  assert.equal(FREE_CONVERSATION_CATALOG_VERSION, 'free-conversation-catalog-v1');
  assert.deepEqual(FREE_CONVERSATION_CONTEXTS.map(context => context.id), [
    'convenience-store', 'restaurant', 'hotel', 'train', 'company-general',
    'company-mechanical-design', 'company-development', 'company-quality',
  ]);
  assert.deepEqual(FREE_CONVERSATION_LEVELS, [
    { id: 'beginner', label: '왕초보' }, { id: 'elementary', label: '초급' }, { id: 'intermediate', label: '중급' },
  ]);
  assert.deepEqual(FREE_CONVERSATION_CONTEXTS.filter(context => context.situationId === 'company').map(context => context.subtopicId), [
    'general', 'mechanical-design', 'development', 'quality',
  ]);
});

test('24 cells expose only three convenience-store pilot scripts, with no implicit fallback', () => {
  assert.equal(FREE_CONVERSATION_COVERAGE.length, 24);
  assert.equal(new Set(FREE_CONVERSATION_COVERAGE.map(cell => cell.id)).size, 24);
  assert.equal(FREE_CONVERSATION_COVERAGE.filter(cell => cell.availability === 'available').length, 3);
  assert.equal(FREE_CONVERSATION_COVERAGE.filter(cell => cell.availability === 'reference-only').length, 21);
  for (const context of FREE_CONVERSATION_CONTEXTS) {
    for (const level of FREE_CONVERSATION_LEVELS) {
      const cell = findFreeConversationCoverage(context.id, level.id);
      assert.ok(cell);
      assert.equal(cell.id, `${context.id}:${level.id}`);
      if (context.id === 'convenience-store') {
        assert.equal(cell.availability, 'available');
        assert.equal(cell.scriptId, `guided-convenience-store-${level.id}`);
        assert.ok(cell.scriptRevision);
        assert.match(cell.scriptRevision, /^sha256:[a-f0-9]{64}$/);
        assert.equal(cell.contentReviewStatus, 'locally-authored-unreviewed');
      } else {
        assert.equal(cell.scriptId, null);
        assert.equal(cell.scriptRevision, null);
        assert.equal(cell.contentReviewStatus, 'not-authored');
        assert.equal(cell.availability, 'reference-only');
      }
      assert.equal(findLegacyFreeConversationScript(context.id, LEGACY_FREE_CONVERSATION_REVISION), undefined);
    }
  }
  for (const [context, level] of [['카페', '왕초보'], ['legacy-cafe', 'beginner'], ['hotel', 'unlevelled'], ['hotel', 'advanced'], ['unknown', 'beginner'], ['__proto__', 'beginner']]) {
    assert.equal(findFreeConversationCoverage(context, level), undefined);
  }
});

test('curriculum references resolve exact verified source content, without claiming level mapping', () => {
  const expectedLessonIds: Record<string, string[]> = {
    'convenience-store': [], restaurant: ['t04'], hotel: ['t03'], train: ['t02'],
    'company-general': ['w01'], 'company-mechanical-design': ['w21'],
    'company-development': ['w01'], 'company-quality': ['w22'],
  };
  for (const cell of FREE_CONVERSATION_COVERAGE) {
    assert.deepEqual(cell.references.map(reference => reference.lessonId), expectedLessonIds[cell.contextId]);
    for (const reference of cell.references) {
      const source = reference.module === 'data/curriculumManufacturing.ts' ? MANUFACTURING_CURRICULUM : CURRICULUM;
      const matches = source.filter(lesson => lesson.id === reference.lessonId);
      assert.equal(matches.length, 1);
      const { title, goal, pattern, dialogue } = matches[0];
      assert.equal(reference.title, title);
      assert.deepEqual(reference.fields, ['title', 'goal', 'pattern', 'dialogue']);
      assert.equal(reference.revision, sha256(JSON.stringify({ title, goal, pattern, dialogue })));
      assert.equal(reference.levelMapping, 'none');
      assert.equal(reference.contentReviewStatus, 'not-reviewed-for-conversation');
    }
  }
});

test('legacy source stays byte-for-byte pinned and all five original meanings stay unlevelled', () => {
  const source = readFileSync(new URL('../../data/freeConversation.ts', import.meta.url));
  assert.equal(sha256(source), LEGACY_FREE_CONVERSATION_REVISION);
  assert.deepEqual(LEGACY_FREE_CONVERSATION_SCRIPTS.map(script => [script.scriptId, script.legacySituation]), [
    ['legacy-cafe', '카페'], ['legacy-travel', '여행'], ['legacy-daily', '일상'], ['legacy-work', '업무'], ['legacy-friends', '친구'],
  ]);
  assert.equal(Object.isFrozen(FREE_CONVERSATIONS), false, 'catalog import must not freeze the old API');
  for (const script of LEGACY_FREE_CONVERSATION_SCRIPTS) {
    assert.equal(script.contextId, script.scriptId);
    assert.equal(script.levelId, 'unlevelled');
    assert.equal(script.availability, 'available');
    assert.equal(script.contentReviewStatus, 'legacy-unreviewed');
    assert.equal(script.contentSource.entryKey, script.legacySituation);
    assert.equal(script.contentSource.revision, script.scriptRevision);
    assert.deepEqual(script.content, FREE_CONVERSATIONS[script.legacySituation]);
    assert.notEqual(script.content, FREE_CONVERSATIONS[script.legacySituation]);
    assert.equal(Object.isFrozen(FREE_CONVERSATIONS[script.legacySituation]), false);
    assert.equal(script.steps.length, 1);
    const step = script.steps[0];
    assert.equal(step.prompt, null);
    assert.equal(step.reply.meaning, null);
    assert.equal(step.example.role, 'learner-example');
    assert.equal(step.reply.role, 'script-response');
    for (const field of [step.example.japanese, step.example.reading, step.example.meaning, step.reply.japanese, step.reply.reading, step.hint]) {
      assert.ok(script.content[field].length > 0);
    }
    assert.equal(findLegacyFreeConversationScript(script.scriptId, script.scriptRevision), script);
    assert.equal(findLegacyFreeConversationScript(script.scriptId, 'unknown-revision'), undefined);
    assert.equal(findLegacyFreeConversationScript(script.legacySituation, script.scriptRevision), undefined);
  }
});

test('catalog descriptors and snapshots are recursively immutable', () => {
  function assertFrozen(value: unknown): void {
    if (value !== null && typeof value === 'object') {
      assert.equal(Object.isFrozen(value), true);
      for (const child of Object.values(value)) assertFrozen(child);
    }
  }
  for (const value of [FREE_CONVERSATION_CONTEXTS, FREE_CONVERSATION_LEVELS, FREE_CONVERSATION_COVERAGE, LEGACY_FREE_CONVERSATION_SCRIPTS]) assertFrozen(value);
  assert.throws(() => Object.assign(LEGACY_FREE_CONVERSATION_SCRIPTS[0].content, { japanese: 'changed' }), TypeError);
  assert.throws(() => Object.assign(FREE_CONVERSATION_COVERAGE[0], { availability: 'available' }), TypeError);
});

test('sample matches use the exact versioned legacy normalization and remain unassessed', () => {
  for (const script of LEGACY_FREE_CONVERSATION_SCRIPTS) {
    for (const [input, matchedAgainst] of [[script.content.japanese, 'example'], [script.content.reading, 'reading'], [` \n${script.content.japanese.replace(/[。！？?!]/g, '')} !?\t`, 'example']] as const) {
      const fact = getFreeConversationSampleMatch(script.scriptId, script.scriptRevision, input);
      assert.deepEqual(fact, {
        policyVersion: FREE_CONVERSATION_SAMPLE_MATCH_POLICY,
        scriptId: script.scriptId, scriptRevision: script.scriptRevision, stepId: script.steps[0].id,
        matched: true, matchedAgainst, assessment: 'unavailable',
      });
      assert.equal(Object.isFrozen(fact), true);
      assert.equal(buildFreeConversation(script.legacySituation, input).reply, script.content.reply);
      assert.equal(buildFreeConversation(script.legacySituation, input).correction, '');
    }
  }
  const cafe = LEGACY_FREE_CONVERSATION_SCRIPTS[0];
  assert.equal(getFreeConversationSampleMatch(cafe.scriptId, cafe.scriptRevision, 'ｺｰﾋｰを一つください｡')?.matched, true);
  assert.equal(getFreeConversationSampleMatch('missing', cafe.scriptRevision, cafe.content.japanese), undefined);
  assert.equal(getFreeConversationSampleMatch(cafe.scriptId, 'stale-revision', cafe.content.japanese), undefined);
});

test('different, empty, valid-alternative, typo and style inputs never become language errors or praise', () => {
  const cafe = LEGACY_FREE_CONVERSATION_SCRIPTS[0];
  // Existing authored examples from other situations also exercise valid alternative input.
  const inputs = ['', '  。!?', 'synthetic input', cafe.content.japanese + 'synthetic typo',
    FREE_CONVERSATIONS.여행.japanese, FREE_CONVERSATIONS.여행.reading,
    FREE_CONVERSATIONS.업무.japanese, FREE_CONVERSATIONS.친구.japanese, `${cafe.content.japanese}.`,
  ];
  for (const input of inputs) {
    const fact = getFreeConversationSampleMatch(cafe.scriptId, cafe.scriptRevision, input);
    assert.ok(fact);
    assert.equal(fact.matched, false);
    assert.equal(fact.matchedAgainst, null);
    assert.equal(fact.assessment, 'unavailable');
    assert.equal('correct' in fact, false);
    assert.equal('correction' in fact, false);
    assert.equal('natural' in fact, false);
    const originalResponse = buildFreeConversation('카페', input);
    assert.equal(originalResponse.reply, cafe.content.japanese);
    assert.equal(originalResponse.correction, '');
    assert.equal(originalResponse.correctionReading, '');
    assert.equal(originalResponse.correctionKoreanPronunciation, '');
    assert.equal(originalResponse.source, 'local');
  }
});

test('recap sample matching reads only the exact supplied snapshot', () => {
  const snapshot = Object.freeze({ japanese: 'synthetic saved example', reading: 'synthetic saved reading' });
  const exact = matchFreeConversationSample(snapshot.japanese, snapshot);
  assert.equal(exact.matched, true);
  assert.equal(exact.matchedAgainst, 'example');
  assert.equal(exact.assessment, 'unavailable');
  assert.equal(matchFreeConversationSample(snapshot.reading, snapshot).matchedAgainst, 'reading');
  assert.equal(matchFreeConversationSample(FREE_CONVERSATIONS.카페.japanese, snapshot).matched, false);
  assert.deepEqual(matchFreeConversationSample(snapshot.japanese, snapshot), exact);
  assert.equal(Object.isFrozen(exact), true);
});

test('empty or punctuation-only snapshots cannot establish a sample match', () => {
  for (const input of ['', ' 。！？ ', 'synthetic input']) {
    for (const sample of [{ japanese: '', reading: '' }, { japanese: '。', reading: '?!' }]) {
      const fact = matchFreeConversationSample(input, sample);
      assert.equal(fact.matched, false);
      assert.equal(fact.matchedAgainst, null);
      assert.equal(fact.assessment, 'unavailable');
    }
  }
});
