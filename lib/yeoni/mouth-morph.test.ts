import assert from 'node:assert/strict';
import test from 'node:test';
import { CAT_MOUTH_GEOMETRY, HUMAN_MOUTH_GEOMETRY, morphMouthPixels } from './mouth-morph.ts';

test('mouth mesh covers every pixel and is independent of the previous output frame', () => {
  for (const [width, height, geometry] of [[200, 112, HUMAN_MOUTH_GEOMETRY], [51, 36, CAT_MOUTH_GEOMETRY]] as const) {
    const a = new Uint8ClampedArray(width * height * 4).fill(47);
    const b = new Uint8ClampedArray(width * height * 4).fill(193);
    for (let i = 3; i < a.length; i += 4) { a[i] = 255; b[i] = 255; }
    // Ratios captured from failing real-playback frames, plus exact endpoints.
    for (const mix of [0, .2776178368200754, .06399989582400017, .14859900306754986, 1]) {
      const fresh = new Uint8ClampedArray(a.length), reused = new Uint8ClampedArray(a.length).fill(231);
      for (const output of [fresh, reused]) {
        morphMouthPixels(a, b, output, width, height, geometry.a, geometry.small, mix);
        for (let i = 3; i < output.length; i += 4) assert.equal(output[i], 255, `${width}x${height} mix=${mix} pixel=${(i - 3) / 4}`);
      }
      assert.deepEqual(fresh, reused, `previous frame leaked at ${width}x${height} mix=${mix}`);
      if (mix === 0) assert.deepEqual(fresh, a);
      if (mix === 1) assert.deepEqual(fresh, b);
    }
  }
});
