import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsedSecondsSince, remainingSecondsUntil } from './timerClock.ts';

test('a background gap is counted without waiting for missed interval callbacks', () => {
  assert.equal(elapsedSecondsSince(1000,15,121000),135);
  assert.equal(remainingSecondsUntil(61000,121000),0);
  assert.equal(remainingSecondsUntil(61000,2000),59);
});
