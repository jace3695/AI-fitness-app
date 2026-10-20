/** Original vector geometry. Source principles are linked below; angles are display parameters. */
export type LowerBodyMotionId = 'supported-hamstring-curl' | 'bodyweight-squat';
export const lowerBodyExerciseMotions = {
  'supported-hamstring-curl': {
    name: '지지형 햄스트링 컬', view: '측면', outward: '무릎을 나란히 두고 뒤꿈치를 뒤로 올리기', returning: '천천히 발을 내려 시작 자세로 돌아오기',
    limitation: '한쪽 무릎을 굽히는 흐름만 시연합니다. 발목 무게는 사용하지 않습니다. 실제 균형·골반 회전·개인의 가동 범위는 판단하지 못합니다.',
    steps: ['흔들리지 않는 지지대를 잡고 두 무릎을 나란히 둡니다.', '몸통과 허벅지를 유지하면서 한쪽 무릎을 천천히 굽혀 뒤꿈치를 뒤로 올립니다.', '반동 없이 발을 내려놓습니다. 반대쪽은 다시 안정된 뒤 같은 원리로 확인합니다.'],
    caution: '허리를 젖히거나 무릎을 앞으로 보내 높이를 늘리지 마세요. 통증·저림 또는 한발 지지의 불안정이 있으면 중단하세요.',
    sourceTitle: 'AAOS · Knee Conditioning Program / Hamstring Curls', sourceUrl: 'https://www.orthoinfo.org/recovery/knee-conditioning-program/',
  },
  'bodyweight-squat': {
    name: '맨몸 스쿼트', view: '측면', outward: '발바닥을 둔 채 엉덩이·무릎·발목을 함께 굽히기', returning: '천천히 펴서 시작 자세로 돌아오기',
    limitation: '중량 없는 측면 시연입니다. 발 간격·무릎의 안팎 정렬은 이 시점에서 확인할 수 없습니다. 그림의 깊이나 몸 기울기를 따라 강제하지 마세요.',
    steps: ['발을 어깨보다 약간 넓게 두고 발끝을 앞쪽으로 둡니다. 발바닥 전체로 바닥을 지지합니다.', '등의 자연스러운 곡선을 유지하고 엉덩이·무릎·발목을 함께 굽혀 편안한 범위까지 천천히 내려갑니다.', '무릎이 발 방향을 따라가도록 확인하며 천천히 일어납니다.'],
    caution: '무릎이 안팎으로 무너지거나 자세가 흐트러지면 중단하세요. 허리를 둥글게 말거나 과하게 꺾지 마세요. 통증·저림이 있으면 계속하지 마세요.',
    sourceTitle: 'Mayo Clinic · Squat exercise', sourceUrl: 'https://www.mayoclinic.org/healthy-lifestyle/fitness/multimedia/squat/vid-20084663',
  },
} as const;
export function lowerBodyMotionId(value: string | undefined): LowerBodyMotionId | null {
  return value === 'supported-hamstring-curl' || value === 'bodyweight-squat' ? value : null;
}
type Point = { x: number; y: number };
const point = (x: number, y: number): Point => ({ x, y });
const shift = (p: Point, x: number, y = 0) => point(p.x + x, p.y + y);
export function lowerBodyExercisePose(id: LowerBodyMotionId, progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const lift = p === 0 || p === 1 ? 0 : (1 - Math.cos(2 * Math.PI * p)) / 2;
  if (id === 'supported-hamstring-curl') {
    const shoulder = point(125, 98), hip = point(125, 176), knee = point(125, 224);
    const angle = 1.25 * lift;
    const ankle = point(knee.x - 48 * Math.sin(angle), knee.y + 48 * Math.cos(angle));
    // Articulate the ankle during toe-off so the foot never passes through the floor.
    const footAngle = Math.min(angle, Math.asin(Math.min(1, Math.max(0, (272 - ankle.y) / 22))));
    const toe = shift(ankle, 22 * Math.cos(footAngle), 22 * Math.sin(footAngle));
    const farAnkle = point(110, 272);
    // These hands and elbows never move: only the working lower leg rotates.
    return { head: point(125, 72), shoulder, hip, knee, ankle, toe,
      farShoulder: shift(shoulder, -15), farHip: shift(hip, -15), farKnee: point(110, 224), farAnkle, farToe: shift(farAnkle, 22),
      elbow: point(162, 128), hand: point(205, 135), farElbow: point(147, 128), farHand: point(190, 135) };
  }
  const ankle = point(145, 272);
  const knee = point(ankle.x + 58 * Math.sin(.35 * lift), ankle.y - 58 * Math.cos(.35 * lift));
  const hip = point(knee.x - 58 * Math.sin(1.2 * lift), knee.y - 58 * Math.cos(1.2 * lift));
  const lean = .4 * lift;
  const shoulder = point(hip.x + 77 * Math.sin(lean), hip.y - 77 * Math.cos(lean));
  const head = point(shoulder.x + 26 * Math.sin(lean), shoulder.y - 26 * Math.cos(lean));
  const arm = .8 - lift * .85;
  const elbow = point(shoulder.x + 34 * Math.cos(arm), shoulder.y + 34 * Math.sin(arm));
  const hand = point(elbow.x + 32, elbow.y);
  return { head, shoulder, hip, knee, ankle, toe: shift(ankle, 25),
    farShoulder: shift(shoulder, -15), farHip: shift(hip, -15), farKnee: shift(knee, -15), farAnkle: shift(ankle, -15), farToe: shift(ankle, 10),
    elbow, hand, farElbow: shift(elbow, -15), farHand: shift(hand, -15) };
}
