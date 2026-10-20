/** Original 3D landmarks projected into two synchronized SVG views. No model assets. */
export type Vector3 = { x: number; y: number; z: number };
export const floorPressGuide = {
  name: '덤벨 플로어프레스', view: '사선 + 옆면 동시',
  outward: '덤벨을 위로 밀되 팔꿈치를 완전히 잠그지 않기',
  returning: '상완이 바닥에 가볍게 닿는 위치까지 천천히 내리기',
  limitation: '이미 누운 준비 자세에서 시작하는 반복 동작입니다. 덤벨을 들고 눕거나 일어나는 과정, 손가락 그립, 개인별 허리 곡선은 표시하지 않습니다.',
  steps: ['누운 상태에서 무릎을 세우고 발을 바닥에 둡니다. 상완을 바닥 가까이에 두고 덤벨을 잡습니다.',
    '손목이 꺾이지 않게 유지하며 덤벨을 위로 밀고 팔꿈치를 완전히 잠그기 전에 멈춥니다.',
    '머리·몸통·발의 지지를 유지하며 상완을 천천히 내립니다. 바닥에서 반동을 주지 않습니다.'],
  caution: '덤벨을 다루며 눕고 일어나는 방법이 불확실하면 먼저 전문가에게 확인하세요. 통증·저림, 허리 과신전이나 덤벨 제어 어려움이 생기면 중단하세요. 그림은 중량 권장이 아닙니다.',
  sourceTitle: 'Sweat — Dumbbell Floor Press (동작 설명)',
  sourceUrl: 'https://sweat.com/exercises/dumbbell-floor-press',
} as const;
export function floorPressMotionId(value: string | undefined): 'dumbbell-floor-press' | null {
  return value === 'dumbbell-floor-press' ? value : null;
}
const v = (x: number, y: number, z: number): Vector3 => ({ x, y, z });
export function floorPressPose(progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const lift = p === 0 || p === 1 ? 0 : (1 - Math.cos(2 * Math.PI * p)) / 2;
  const angle = 1.43 * lift;
  const arm = (side: number) => {
    const shoulder = v(side * 20, 0, 6);
    const elbow = v(shoulder.x + side * 38 * Math.cos(angle) / Math.SQRT2, 38 * Math.cos(angle) / Math.SQRT2, 6 + 38 * Math.sin(angle));
    const hand = v(elbow.x, elbow.y, elbow.z + 35);
    return { shoulder, elbow, hand };
  };
  return { head: v(0, -30, 12), neck: v(0, -10, 6), hip: v(0, 65, 6),
    left: arm(-1), right: arm(1),
    leftHip: v(-14, 65, 6), rightHip: v(14, 65, 6),
    leftKnee: v(-14, 100, 45), rightKnee: v(14, 100, 45),
    leftAnkle: v(-14, 135, 6), rightAnkle: v(14, 135, 6),
    leftToe: v(-14, 149, 6), rightToe: v(14, 149, 6) };
}
export function projectFloorPoint(p: Vector3, view: 'oblique' | 'side') {
  return view === 'oblique' ? { x: 145 + p.x * .85 + p.y * .5, y: 170 + p.y * .45 - p.z * 1.6 }
    : { x: 52 + p.y * 1.25, y: 110 - p.z * .95 };
}
