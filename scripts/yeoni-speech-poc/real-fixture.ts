// The one already authorized/generated clip; embedded only in this offline lab.
import base64 from '../../docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3';
import manifest from '../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';
export function realFixture() {
  return { bytes: Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer, manifest };
}
