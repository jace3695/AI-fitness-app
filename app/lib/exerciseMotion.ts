/** Original procedural assets: no imported imagery, models, or motion data. */
export type MotionId = 'seated-knee-extension' | 'light-dumbbell-curl';
export type Point = { x: number; y: number };
export const exerciseMotions = {
  'seated-knee-extension': { name: '앉아서 무릎 펴기', outward: '한쪽 무릎을 편안한 범위로 펴기', returning: '천천히 발을 내려 시작 자세로 돌아오기', limitation: '한쪽 다리의 측면 흐름만 표현합니다. 끝까지 강제로 펴거나 무릎을 잠그지 마세요. 의자의 안정성·개인별 가동 범위는 표현하지 않습니다.' },
  'light-dumbbell-curl': { name: '가벼운 덤벨 컬', outward: '팔꿈치를 고정하고 아래팔 올리기', returning: '몸을 흔들지 않고 아래팔 내리기', limitation: '한쪽 팔의 측면 흐름만 표현합니다. 그림의 무게와 각도는 권장값이 아닙니다. 손목 회전·양팔 간격·개인별 가동 범위는 표현하지 않습니다.' },
} as const;
export function motionId(value: string | undefined): MotionId | null {
  return value === 'seated-knee-extension' || value === 'light-dumbbell-curl' ? value : null;
}
export function clampProgress(value: number) { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
export function exerciseMotionPose(id: MotionId, progress: number) {
  const p = clampProgress(progress);
  const lift = p === 0 || p === 1 ? 0 : (1 - Math.cos(2 * Math.PI * p)) / 2;
  const seated = id === 'seated-knee-extension';
  const hip = { x: 110, y: seated ? 183 : 175 };
  const shoulder = { x: 110, y: seated ? 104 : 92 };
  const knee = { x: seated ? 166 : 110, y: seated ? 183 : 219 };
  const angle = Math.PI / 2 - (seated ? lift * 1.22 : 0);
  const ankle = { x: knee.x + 55 * Math.cos(angle), y: knee.y + 55 * Math.sin(angle) };
  const elbow = { x: shoulder.x + 5, y: shoulder.y + 49 };
  const armAngle = Math.PI / 2 - (seated ? .85 : .18 + lift * 1.95);
  const hand = { x: elbow.x + 46 * Math.cos(armAngle), y: elbow.y + 46 * Math.sin(armAngle) };
  return { head: { x: shoulder.x, y: shoulder.y - 29 }, shoulder, hip, knee, ankle, elbow, hand };
}
export function advanceMotion(progress: number, deltaMs: number, slow: boolean, loop: boolean) {
  const next = clampProgress(progress) + Math.max(0, Math.min(Number.isFinite(deltaMs) ? deltaMs : 0, 100)) / (slow ? 12000 : 6000);
  return { progress: next >= 1 ? (loop ? next % 1 : 1) : next, ended: next >= 1 && !loop };
}
