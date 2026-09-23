import type { DrawingDocument, Example } from './model.ts';

export function variationState(doc: DrawingDocument): NonNullable<DrawingDocument['variation']> {
  return doc.variation ?? { choice: doc.example.variations?.[0]?.id ?? '', changedChecked: false, keptChecked: false, note: '' };
}
export function variationChoice(doc: DrawingDocument) {
  return doc.example.variations?.find(v => v.id === variationState(doc).choice);
}
export function variationTarget(doc: DrawingDocument): Example {
  const choice = variationChoice(doc);
  if (!choice) return doc.example;
  return { ...doc.example, id: `${doc.example.id}-${choice.id}`, name: `${doc.example.name} · ${choice.label}`,
    lines: [...doc.example.lines.filter(l => !choice.remove.includes(l.id)), ...choice.lines] };
}
export function chooseVariation(doc: DrawingDocument, choice: string): Partial<DrawingDocument> {
  if (!doc.example.variations?.some(v => v.id === choice)) throw Error('이 캐릭터에서 바꿀 한 가지를 골라 주세요.');
  // A new choice never erases the learner's ink or changes the saved original.
  return { step: 0, check: 'unconfirmed', variation: { choice, changedChecked: false, keptChecked: false, note: '' } };
}
export function variationEligible(doc: DrawingDocument) {
  if (!doc.lesson.variationPractice) return true;
  const state = variationState(doc);
  return !!variationChoice(doc) && doc.step === doc.lesson.steps.length - 1 && state.changedChecked && state.keptChecked;
}
