import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpeechParticipant } from './speech-participant.ts';
import { SPEECH_STOP_EVENT } from './speech-focus.ts';

test('a new voice invalidates earlier async playback, all-stop and disposal revoke leases', () => {
  const bus = new EventTarget(); let stoppedA = 0, stoppedB = 0;
  const a = createSpeechParticipant('A', () => stoppedA++, bus);
  const b = createSpeechParticipant('B', () => stoppedB++, bus);
  const first = a.claim(); assert.equal(first(), true); assert.equal(stoppedB, 1);
  const second = b.claim(); assert.equal(first(), false); assert.equal(second(), true); assert.equal(stoppedA, 1);
  bus.dispatchEvent(new Event(SPEECH_STOP_EVENT)); assert.equal(second(), false);
  const third = a.claim(); a.dispose(); assert.equal(third(), false); assert.equal(a.claim()(), false);
  const count = stoppedA; b.claim(); assert.equal(stoppedA, count); b.dispose();
});
