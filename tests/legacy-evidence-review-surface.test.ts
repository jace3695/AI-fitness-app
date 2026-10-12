import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import { CURRICULUM, type CurriculumLesson, type LessonQuiz } from '../data/curriculum.ts';
import { EXPANDED_CURRICULUM } from '../data/curriculumExpansion.ts';
import { ADVANCED_CURRICULUM } from '../data/curriculumAdvanced.ts';
import { MANUFACTURING_CURRICULUM } from '../data/curriculumManufacturing.ts';
import { buildEvidenceCatalogue, LEGACY_EVIDENCE_CATALOGUE } from '../lib/language-legacy-evidence/catalogue.ts';
import {
  LEGACY_EVIDENCE_MANIFEST_CANONICAL, LEGACY_EVIDENCE_MANIFEST_DIGEST,
  LEGACY_EVIDENCE_MANIFEST_RELEASE, LEGACY_EVIDENCE_MANIFEST_TASK_COUNT,
  LEGACY_EVIDENCE_SERVER_PROTOCOL,
} from '../lib/language-legacy-evidence/identity-manifest.ts';
import { canonicalEvidence } from '../lib/language-legacy-evidence/validation.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const questionBytes = (quiz: LessonQuiz) => ({
  prompt: quiz.prompt, choices: quiz.choices, answer: quiz.answer,
  explanation: quiz.explanation, kind: quiz.kind,
});

// Exercise the real private generator with variable core-question positions.
// Only its export visibility changes; all source and curriculum dependencies run.
function loadGenerator(): (item: CurriculumLesson) => CurriculumLesson {
  const source = readFileSync(new URL('../data/curriculum.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = new Map<string, unknown>([
    ['./curriculumExpansion.ts', { EXPANDED_CURRICULUM }],
    ['./curriculumAdvanced.ts', { ADVANCED_CURRICULUM }],
    ['./curriculumManufacturing.ts', { MANUFACTURING_CURRICULUM }],
  ]);
  const exported: { expandLessonQuiz?: (item: CurriculumLesson) => CurriculumLesson } = {};
  runInThisContext(`(function(exports, require) { ${compiled}\nexports.expandLessonQuiz = expandLessonQuiz;\n})`)(exported, (name: string) => {
    assert.ok(dependencies.has(name), 'Only the actual authored curriculum dependencies are allowed');
    return dependencies.get(name);
  });
  assert.ok(exported.expandLessonQuiz);
  return exported.expandLessonQuiz;
}

test('every actual generated meaning/input site binds its exact authored question and word', () => {
  const counts = { meaning: 0, input: 0, unsupported: 0 };
  for (const lesson of CURRICULUM) {
    for (const [index, quiz] of lesson.quiz.entries()) {
      const surface = quiz.generatedReviewSurface;
      if (!surface) { counts.unsupported += 1; continue; }
      assert.ok(Number.isSafeInteger(surface.wordIndex) && surface.wordIndex >= 0);
      const word = lesson.words[surface.wordIndex];
      assert.ok(word);
      assert.equal(surface.targetText, word.japanese);
      assert.equal(surface.reading, word.reading);
      assert.deepEqual(surface.question, questionBytes(quiz));
      assert.notEqual(surface.question.choices, quiz.choices, 'The checked choices are an independent snapshot');
      const input = surface.origin === 'generated-word-input';
      assert.equal(surface.origin, input ? 'generated-word-input' : 'generated-word-meaning');
      counts[input ? 'input' : 'meaning'] += 1;
      assert.deepEqual(quiz.evidenceRef, {
        itemId: `course:${lesson.id}:word:${surface.wordIndex}`, contentRevision: 1,
        taskId: `course:${lesson.id}:word:${surface.wordIndex}:${input ? 'input' : 'meaning'}`,
      });
      assert.equal(surface.question.kind, input ? 'input' : undefined);
      assert.equal(surface.question.prompt, input
        ? `‘${word.meaning}’를 일본어로 입력하세요.`
        : `‘${word.japanese}(${word.reading})’의 뜻은?`);
      assert.equal(surface.question.explanation, input
        ? `정답은 ${word.japanese}(${word.reading})예요.`
        : `${word.japanese}(${word.reading})는 ‘${word.meaning}’라는 뜻이에요.`);
      assert.deepEqual(surface.question.choices, input ? [word.japanese] : [word.meaning,
        lesson.words[(surface.wordIndex + 1) % lesson.words.length].meaning,
        lesson.words[(surface.wordIndex + 2) % lesson.words.length].meaning,
      ]);
      assert.equal(surface.question.answer, 0);
      const descriptor = LEGACY_EVIDENCE_CATALOGUE.find(task => task.legacyQuestionId === `${lesson.id}:${index}`);
      assert.ok(descriptor);
      assert.equal(descriptor.itemId, quiz.evidenceRef?.itemId);
      assert.equal(descriptor.taskId, quiz.evidenceRef?.taskId);
      assert.equal(descriptor.contentRevision, quiz.evidenceRef?.contentRevision);
      assert.equal(descriptor.lessonId, lesson.id);
    }
  }
  assert.deepEqual(counts, { meaning: 186, input: 186, unsupported: 124 });
  assert.ok(CURRICULUM.flatMap(lesson => lesson.quiz).some(quiz => quiz.kind === 'listening'));
  for (const quiz of CURRICULUM.flatMap(lesson => lesson.quiz).filter(quiz => quiz.kind === 'listening')) {
    assert.equal(quiz.generatedReviewSurface, undefined);
  }
});

test('source-loaded generator provenance survives changed positions and ignores lookalike core questions', () => {
  const expand = loadGenerator();
  const base = structuredClone(CURRICULUM[0]);
  const meaning = { ...CURRICULUM[0].quiz.find(quiz => quiz.generatedReviewSurface?.origin === 'generated-word-meaning')! };
  const input = { ...CURRICULUM[0].quiz.find(quiz => quiz.generatedReviewSurface?.origin === 'generated-word-input')! };
  for (const core of [[], [meaning], [meaning, input, { ...input, kind: 'listening' as const }],
    [meaning, input, meaning, input, meaning, input]]) {
    const lesson = expand({ ...base, quiz: core });
    assert.equal(lesson.quiz.length, Math.min(8, core.length + base.words.length * 2));
    for (let index = 0; index < core.length; index += 1) {
      assert.equal(lesson.quiz[index].generatedReviewSurface, undefined,
        'Even exact prompt/answer/ID/input-suffix copies in the core are not generated surfaces');
      assert.deepEqual(lesson.quiz[index], core[index]);
    }
    for (const [offset, quiz] of lesson.quiz.slice(core.length).entries()) {
      const surface = quiz.generatedReviewSurface;
      assert.ok(surface);
      assert.equal(surface.wordIndex, Math.floor(offset / 2));
      assert.equal(surface.origin, offset % 2 === 0 ? 'generated-word-meaning' : 'generated-word-input');
      assert.deepEqual(surface.question, questionBytes(quiz));
    }
  }
});

test('local generated metadata is deeply frozen, non-enumerable, and absent from ordinary copies', () => {
  for (const quiz of CURRICULUM.flatMap(lesson => lesson.quiz)) {
    const surface = quiz.generatedReviewSurface;
    if (!surface) continue;
    assert.deepEqual(Object.getOwnPropertyDescriptor(quiz, 'generatedReviewSurface'), {
      value: surface, enumerable: false, writable: false, configurable: false,
    });
    assert.ok(Object.isFrozen(surface));
    assert.ok(Object.isFrozen(surface.question));
    assert.ok(Object.isFrozen(surface.question.choices));
    assert.equal(Reflect.set(surface, 'wordIndex', -1), false);
    assert.equal(Reflect.set(surface.question, 'prompt', 'changed'), false);
    assert.equal(Reflect.set(surface.question.choices, '0', 'changed'), false);
    assert.equal(Reflect.set(quiz, 'generatedReviewSurface', undefined), false);
    assert.equal(Reflect.deleteProperty(quiz, 'generatedReviewSurface'), false);
    for (const copy of [{ ...quiz }, structuredClone(quiz), JSON.parse(JSON.stringify(quiz))]) {
      assert.equal(Object.hasOwn(copy, 'generatedReviewSurface'), false);
    }
    assert.equal(Object.keys(quiz).includes('generatedReviewSurface'), false);
    assert.doesNotMatch(JSON.stringify(quiz), /generatedReviewSurface|generated-word-meaning|generated-word-input/);
  }
});

test('checked authored bytes do not silently follow later mutations to question or source word', () => {
  const expand = loadGenerator();
  const lesson = expand({ ...structuredClone(CURRICULUM[0]), quiz: [] });
  const quiz = lesson.quiz[0], surface = quiz.generatedReviewSurface!;
  const original = structuredClone(surface);
  quiz.prompt += ' changed'; quiz.choices[0] += ' changed'; quiz.answer = 1;
  quiz.explanation += ' changed'; quiz.kind = 'input';
  lesson.words[0].japanese += ' changed'; lesson.words[0].reading += ' changed';
  assert.deepEqual(surface, original);
  assert.notDeepEqual(surface.question, questionBytes(quiz));
  assert.notEqual(surface.targetText, lesson.words[0].japanese);
  assert.notEqual(surface.reading, lesson.words[0].reading);
});

test('all legacy serialized curriculum, evidence references, catalogue bytes and ordering stay unchanged', () => {
  // Captured from unmodified 80774d24 before introducing local surface metadata.
  assert.equal(hash(CURRICULUM), '8e2b47c8d8f4bfdf047d8a82e65d42ab44edf416713cc5c32fd7c2818ebe5f79');
  assert.equal(hash(CURRICULUM.map(lesson => lesson.quiz.map(quiz => quiz.evidenceRef))),
    'd16b7b3313aaedce507b583f870be193b2b8c8bde9ee766d5fa7bd7925c20bd4');
  assert.equal(hash(LEGACY_EVIDENCE_CATALOGUE), 'e7e46185d5f19872776840783ea459e5cd3a12e529136418284ffd72899431df');
  assert.deepEqual(buildEvidenceCatalogue(structuredClone(CURRICULUM)), LEGACY_EVIDENCE_CATALOGUE);
  for (const task of LEGACY_EVIDENCE_CATALOGUE) {
    assert.deepEqual(Object.keys(task), ['itemId', 'contentRevision', 'taskId', 'lessonId', 'legacyQuestionId', 'bindings']);
    assert.equal(Object.hasOwn(task, 'generatedReviewSurface'), false);
  }
});

test('the exact published identity-only manifest and digest exclude all local surface metadata', () => {
  const tasks = LEGACY_EVIDENCE_CATALOGUE.map(task => ({ ...task,
    bindings: [...task.bindings].sort((left, right) => canonicalEvidence(left) < canonicalEvidence(right) ? -1 : 1),
  })).sort((left, right) => left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : left.contentRevision - right.contentRevision);
  const canonical = canonicalEvidence({ protocol: LEGACY_EVIDENCE_SERVER_PROTOCOL, release: LEGACY_EVIDENCE_MANIFEST_RELEASE, tasks });
  assert.equal(tasks.length, LEGACY_EVIDENCE_MANIFEST_TASK_COUNT);
  assert.equal(canonical, LEGACY_EVIDENCE_MANIFEST_CANONICAL);
  assert.equal(createHash('sha256').update(canonical, 'utf8').digest('hex'), LEGACY_EVIDENCE_MANIFEST_DIGEST);
  assert.equal(LEGACY_EVIDENCE_MANIFEST_DIGEST, '139c003cd7b99e71a62dae22bd49d63524329c292bea6f953a9d1811a4045c0c');
  assert.doesNotMatch(canonical, /generatedReviewSurface|wordIndex|targetText|reading|prompt|choices|explanation/);
});
