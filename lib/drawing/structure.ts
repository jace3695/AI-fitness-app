import type { Attempt, DrawingDocument } from './model.ts';
export function structureState(doc: DrawingDocument): NonNullable<DrawingDocument['structure']> {
  return doc.structure ?? { analysis: [], surface: 'analysis', choice: '', identified: false, compared: false, note: '' };
}
export function structureEligible(doc: DrawingDocument) {
  if (!doc.lesson.structurePractice) return true;
  const s = structureState(doc);
  return doc.step === doc.lesson.steps.length - 1 && s.identified && s.compared;
}
export function useAnalysis(doc: DrawingDocument, source: Attempt): Partial<DrawingDocument> {
  if (doc.lesson.id !== 'D46' || source.document.lesson.id !== 'D45' || source.revision < 1 || source.document.tool !== 'app' || !source.document.strokes.length || !doc.lesson.examples.some(e => e.id === source.document.example.id)) throw Error('저장한 D45 앱 그림을 선택해 주세요.');
  const example = doc.lesson.examples.find(e => e.id === source.document.example.id)!;
  return { example, step: 0, check: 'unconfirmed', references: [...new Set([...doc.references,source.id])],
    structure: { ...structureState(doc), analysis: structuredClone(source.document.strokes), surface: 'analysis', identified: false, compared: false, note: '', choice: '',
      source: { attemptId: source.id, revision: source.revision, lessonId: 'D45', exampleId: example.id } } };
}
