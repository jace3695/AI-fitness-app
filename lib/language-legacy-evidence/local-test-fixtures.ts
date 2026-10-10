import { context, episode, id, at, catalogue } from './test-fixtures.ts';
import { preparePresentation, prepareAnswer } from './capture.ts';
import type { CaptureCheckpoint, LocalEvidenceContext } from './persistence-types.ts';

export const localContext = (): LocalEvidenceContext => ({ ...context(1), ownerEpoch: 1, freshness: 'fresh' });
export async function presentation() {
  const event = episode(0, { presentationOnly: true })[0];
  return preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, localContext(), catalogue);
}
export async function answer(cp: CaptureCheckpoint, correct = true, offset = 1000) {
  return prepareAnswer(cp, { transitionId: id(), eventId: id(), occurredAt: at(0, offset), recordTimezone: 'Asia/Seoul', correct,
    responseMs: 500, handoff: { draftToken: 'exact-surviving-draft-v1', answer: '合成入力だけ',
      observation: { responseMs: 123.5, neededHelp: false, modality: 'meaning' } } }, localContext(), catalogue);
}
