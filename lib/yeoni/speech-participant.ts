import { SPEECH_FOCUS_EVENT, SPEECH_STOP_EVENT } from './speech-focus.ts';

/** Opt-in adapter for app-owned speech. Check the returned lease after every
 * asynchronous prepare step and before starting playback. No media interception. */
export function createSpeechParticipant(owner: string, stop: () => void, target: EventTarget = window) {
  let generation = 0;
  let disposed = false;
  const invalidate = () => { ++generation; stop(); };
  const other = (event: Event) => { if ((event as CustomEvent<string>).detail !== owner) invalidate(); };
  target.addEventListener(SPEECH_FOCUS_EVENT, other);
  target.addEventListener(SPEECH_STOP_EVENT, invalidate);
  return {
    claim() {
      if (disposed) return () => false;
      const token = ++generation;
      target.dispatchEvent(new CustomEvent(SPEECH_FOCUS_EVENT, { detail: owner }));
      return () => !disposed && generation === token;
    },
    stop: invalidate,
    dispose() {
      if (disposed) return;
      disposed = true; invalidate();
      target.removeEventListener(SPEECH_FOCUS_EVENT, other);
      target.removeEventListener(SPEECH_STOP_EVENT, invalidate);
    },
  };
}
