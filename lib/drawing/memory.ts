import type { Attempt, DrawingDocument, Example, Lesson } from './model.ts';

export function memoryState(doc: DrawingDocument): NonNullable<DrawingDocument['memory']> {
  return doc.memory ?? { selected: [], peeking: false, peeks: 0, copyMode: false, recalled: '', compared: '' };
}
export function memoryPhase(doc: DrawingDocument) {
  return doc.lesson.steps[doc.step]?.memoryPhase ?? 'observe';
}
export function memoryVisible(doc: DrawingDocument) {
  const state = memoryState(doc);
  return memoryPhase(doc) !== 'recall' || state.peeking || state.copyMode;
}
export function memoryHintLines(lesson: Lesson, example: Example, easy: boolean) {
  return easy ? example.lines.filter(l => lesson.memoryPractice?.hintLines.includes(l.id)) : [];
}
export function memoryStep(doc: DrawingDocument, step: number): Partial<DrawingDocument> {
  return { step: Math.max(0, Math.min(doc.lesson.steps.length - 1, step)), memory: { ...memoryState(doc), peeking: false } };
}
export function recallEligible(doc: DrawingDocument) {
  if (!doc.lesson.memoryPractice) return true;
  const state = memoryState(doc);
  return memoryPhase(doc) === 'compare' && state.selected.length >= 2 && !!state.compared.trim() && !state.copyMode && (doc.lesson.id !== 'D33' || !!state.source);
}
export function memorySource(attempt: Attempt, source: Attempt): Partial<DrawingDocument> {
  if (!['D33','D34'].includes(attempt.document.lesson.id) || source.user_id !== attempt.user_id || !/^D(29|3[0-2])$/.test(source.document.lesson.id) || source.revision < 1 || !source.document.lesson.memoryPractice) throw Error('기억 연습에서 저장한 본인 그림을 골라 주세요.');
  const lesson = structuredClone(attempt.document.lesson);
  lesson.examples = [structuredClone(source.document.example)];
  lesson.memoryPractice = { ...structuredClone(source.document.lesson.memoryPractice), hint: lesson.id === 'D33' ? 'preview' : 'masses', hintLines: source.document.example.lines.filter(l => l.group === 'shape' && !/ear|leg|wing/i.test(l.id)).map(l => l.id) };
  return { lesson, example: structuredClone(source.document.example), step: 0, strokes: [], photo: null, references: [source.id], check: 'unconfirmed',
    memory: { selected: [], peeking: false, peeks: 0, copyMode: false, recalled: '', compared: '', source: { attemptId: source.id, revision: source.revision, lessonId: source.document.lesson.id } } };
}
