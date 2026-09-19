// One user-requested billing verification, independent of monthly free approval.
export const ZEPHYR_PROBE_TEXT = '안녕하세요. 저는 연이예요. 지금은 구글 제퍼 목소리로 음성 테스트를 하고 있어요. 오늘도 차근차근 함께해요.';
export const ZEPHYR_PROBE_CHARACTERS = Array.from(ZEPHYR_PROBE_TEXT).length;

export function isZephyrProbePreview() {
  return process.env.VERCEL_ENV === 'preview'
    && process.env.VERCEL_GIT_COMMIT_REF === 'fix/app-wide-reliability';
}

export type ZephyrProbeSlot = { requestId: string; slot: number; reservedAt: string | null; available: boolean };
