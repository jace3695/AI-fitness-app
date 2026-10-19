/** Original schematic geometry; movement principles: NHS Strength exercises (2026-10-19).
 * Angles and timing are illustration parameters, not prescribed ranges or cadence. */
export type SupportedMotionId = 'supported-calf-raise' | 'supported-side-leg-raise';
export type MotionPoint = { x: number; y: number };
export const supportedExerciseMotions = {
  'supported-calf-raise': {
    name: '지지형 양발 종아리 들기', view: '측면',
    outward: '양쪽 뒤꿈치를 천천히 들기', returning: '뒤꿈치를 천천히 바닥에 내려놓기',
    limitation: '두 발의 앞부분을 바닥에 둔 흐름입니다. 발목의 좌우 기울기·균형·지지대의 실제 안정성은 표현하지 않습니다.',
    steps: ['흔들리거나 미끄러지지 않는 지지대를 두 손으로 잡습니다.', '발 앞부분은 바닥에 두고 양쪽 뒤꿈치를 편안한 높이까지 천천히 듭니다.', '반동 없이 천천히 내려 두 뒤꿈치를 바닥에 놓습니다.'],
    caution: '높이 들려고 몸을 흔들지 마세요. 지지대가 움직이거나 서 있기 불안하면 시행하지 마세요.',
  },
  'supported-side-leg-raise': {
    name: '지지형 옆 다리 들기', view: '정면',
    outward: '몸통을 세운 채 한쪽 다리를 옆으로 들기', returning: '천천히 발을 내려 시작 자세로 돌아오기',
    limitation: '한쪽 다리만 시연합니다. 반대쪽도 같은 원리지만 한발 지지 능력·발끝 방향·몸통의 앞뒤 기울기는 표현하지 않습니다.',
    steps: ['흔들리지 않는 지지대를 두 손으로 잡고 몸통과 골반을 정면으로 둡니다.', '몸을 기울이거나 골반을 끌어올리지 않는 편안한 범위에서 한쪽 다리를 옆으로 듭니다.', '발을 천천히 내려놓습니다. 반대쪽은 몸을 다시 안정시킨 뒤 같은 방법으로 확인합니다.'],
    caution: '다리를 높이 들려고 허리를 꺾지 마세요. 한발로 서기가 불안하거나 통증이 있으면 시행하지 마세요.',
  },
} as const;
export function supportedMotionId(value: string | undefined): SupportedMotionId | null {
  return value === 'supported-calf-raise' || value === 'supported-side-leg-raise' ? value : null;
}
const point = (x: number, y: number): MotionPoint => ({ x, y });
/** Fixed-length two-link elbow, with the elbow consistently below the arm midpoint. */
function elbow(a: MotionPoint, b: MotionPoint, length: number) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const h = Math.sqrt(Math.max(0, length * length - distance * distance / 4));
  const side = dx >= 0 ? 1 : -1;
  return point((a.x + b.x) / 2 - side * dy / distance * h, (a.y + b.y) / 2 + side * dx / distance * h);
}
export function supportedExercisePose(id: SupportedMotionId, progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const lift = p === 0 || p === 1 ? 0 : (1 - Math.cos(2 * Math.PI * p)) / 2;
  if (id === 'supported-calf-raise') {
    const angle = lift * .55;
    const toe = point(135, 272), farToe = point(120, 272);
    const ankle = point(toe.x - 30 * Math.cos(angle), toe.y - 30 * Math.sin(angle));
    const farAnkle = point(ankle.x - 15, ankle.y);
    const hip = point(ankle.x, ankle.y - 96), farHip = point(hip.x - 15, hip.y);
    const shoulder = point(hip.x, hip.y - 78), farShoulder = point(shoulder.x - 15, shoulder.y);
    const hand = point(200, 135), farHand = point(185, 135);
    return { head: point(shoulder.x, shoulder.y - 26), shoulder, farShoulder, hip, farHip,
      knee: point(ankle.x, ankle.y - 48), farKnee: point(farAnkle.x, farAnkle.y - 48),
      ankle, farAnkle, toe, farToe, hand, farHand,
      elbow: elbow(shoulder, hand, 57), farElbow: elbow(farShoulder, farHand, 57) };
  }
  const hip = point(145, 172), farHip = point(105, 172);
  const angle = .42 * lift;
  const ankle = point(hip.x + 100 * Math.sin(angle), hip.y + 100 * Math.cos(angle));
  const farAnkle = point(105, 272);
  const shoulder = point(145, 96), farShoulder = point(105, 96);
  const hand = point(170, 145), farHand = point(80, 145);
  return { head: point(125, 64), shoulder, farShoulder, hip, farHip,
    knee: point((hip.x + ankle.x) / 2, (hip.y + ankle.y) / 2), farKnee: point(105, 222),
    ankle, farAnkle, toe: point(ankle.x + 16, ankle.y), farToe: point(89, 272),
    hand, farHand, elbow: elbow(shoulder, hand, 32), farElbow: elbow(farShoulder, farHand, 32) };
}
