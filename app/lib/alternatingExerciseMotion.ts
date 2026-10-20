/** Original alternating-limb diagrams; timing and angles illustrate sequence, not dosage. */
export type AlternatingMotionId = 'indoor-walk' | 'bird-dog';
export const alternatingExerciseMotions = {
  'indoor-walk': {
    name: '실내 걷기', view: '측면 · 제자리 걷기 예시',
    outward: '오른발 들기', returning: '왼발 들기',
    limitation: '실내 걷기 중 제자리 걷기만 보여 줍니다. 전진 보행·보폭·몸의 좌우 체중 이동과 실제 균형은 표현하지 않습니다.',
    steps: ['미끄럽지 않고 장애물이 없는 공간에서 몸을 세웁니다.', '한쪽 발을 작게 들었다 내려놓은 뒤 반대쪽 발을 듭니다. 팔꿈치를 굽힌 팔은 걸음에 맞춰 가볍게 움직입니다.', '높이나 속도를 따라 무리하지 말고 발을 천천히 내려놓습니다.'],
    caution: '통증·저림·어지럼 또는 균형 흔들림이 있으면 중단하세요. 그림의 들기 높이와 재생 속도는 목표값이 아닙니다.',
    sourceTitle: 'NHS · How to warm up / March on the spot', sourceUrl: 'https://www.nhs.uk/live-well/exercise/how-to-warm-up-before-exercising/',
  },
  'bird-dog': {
    name: '버드독', view: '측면 · 반대 팔다리 교대',
    outward: '오른팔과 왼다리 뻗기', returning: '왼팔과 오른다리 뻗기',
    limitation: '보라색은 오른쪽, 연보라색은 왼쪽 팔다리입니다. 몸통의 좌우 회전·개인의 중립 척추 형태와 균형은 판단하지 못합니다.',
    steps: ['손은 어깨 아래, 무릎은 골반 아래에 둡니다. 복부에 힘을 주고 몸통을 안정시킵니다.', '한 팔을 몸통 높이까지 앞으로 뻗고 안정된 뒤 반대쪽 다리를 뒤로 뻗습니다. 허리를 젖히거나 다리를 몸통보다 높이 들지 않습니다.', '천천히 네발기기 자세로 돌아온 뒤 반대 팔과 다리로 바꿉니다.'],
    caution: '통증·저림이나 균형 상실이 있으면 중단하세요. 이 시연은 허리 질환에 대한 처방이나 적합성 평가가 아닙니다.',
    sourceTitle: 'AAOS · Spine Conditioning Program / Bird Dog', sourceUrl: 'https://www.orthoinfo.org/recovery/spine-conditioning-program/',
  },
} as const;
export function alternatingMotionId(value: string | undefined): AlternatingMotionId | null {
  return value === 'indoor-walk' || value === 'bird-dog' ? value : null;
}
type Point = { x: number; y: number };
const point = (x: number, y: number): Point => ({ x, y });
const shift = (p: Point, x: number, y = 0) => point(p.x + x, p.y + y);
const smooth = (v: number) => { const x = Math.max(0, Math.min(1, v)); return x * x * (3 - 2 * x); };
export function alternatingPhase(id: AlternatingMotionId, progress: number) {
  const q = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (q === 0 || q === .5 || q === 1) return id === 'bird-dog' ? '네발기기 시작 자세' : '두 발을 바닥에 둔 시작 자세';
  const rightFirst = q < .5;
  const returning = (q % .5) > .25;
  const pair = id === 'bird-dog' ? (rightFirst ? '오른팔·왼다리' : '왼팔·오른다리') : (rightFirst ? '오른발' : '왼발');
  return `${pair} ${returning ? '천천히 돌아오기' : id === 'bird-dog' ? '차례로 뻗기' : '작게 들기'}`;
}
export function alternatingExercisePose(id: AlternatingMotionId, progress: number) {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const local = p < .5 ? p * 2 : (p - .5) * 2;
  const lift = local === 0 || local === 1 ? 0 : Math.sin(Math.PI * local) ** 2;
  const first = p < .5;
  if (id === 'indoor-walk') {
    const hip = point(135, 168), farHip = point(120, 168), shoulder = point(135, 88), farShoulder = point(120, 88);
    const leg = (origin: Point, amount: number) => {
      const a = .5 * amount;
      const knee = shift(origin, 52 * Math.sin(a), 52 * Math.cos(a));
      const ankle = shift(knee, -52 * Math.sin(a), 52 * Math.cos(a));
      return { knee, ankle, toe: shift(ankle, 22) };
    };
    const right = leg(hip, first ? lift : 0), left = leg(farHip, first ? 0 : lift);
    const arm = (origin: Point, angle: number) => {
      const elbow = shift(origin, 34 * Math.sin(angle), 34 * Math.cos(angle));
      return { elbow, hand: shift(elbow, 28 * Math.cos(angle), -28 * Math.sin(angle)) };
    };
    const a = (first ? -1 : 1) * .35 * lift;
    const rightArm = arm(shoulder, a), leftArm = arm(farShoulder, -a);
    return { head: point(135, 62), shoulder, farShoulder, hip, farHip, ...right, ...rightArm,
      farKnee: left.knee, farAnkle: left.ankle, farToe: left.toe, farElbow: leftArm.elbow, farHand: leftArm.hand };
  }
  const shoulder = point(180, 145), farShoulder = point(174, 145), hip = point(110, 145), farHip = point(104, 145);
  const armAmount = smooth(lift / .7), legAmount = smooth((lift - .25) / .75);
  const arm = (origin: Point, amount: number) => {
    const a = Math.PI / 2 * (1 - amount);
    const elbow = shift(origin, 26 * Math.cos(a), 26 * Math.sin(a));
    return { elbow, hand: shift(elbow, 26 * Math.cos(a), 26 * Math.sin(a)) };
  };
  const leg = (origin: Point, amount: number) => {
    const a = Math.PI / 2 + Math.PI / 2 * amount;
    const knee = shift(origin, 52 * Math.cos(a), 52 * Math.sin(a));
    const ankle = shift(knee, -38);
    return { knee, ankle, toe: shift(ankle, -5, -8) };
  };
  const rightArm = arm(shoulder, first ? armAmount : 0), leftArm = arm(farShoulder, first ? 0 : armAmount);
  const right = leg(hip, first ? 0 : legAmount), left = leg(farHip, first ? legAmount : 0);
  return { head: point(204, 133), shoulder, farShoulder, hip, farHip, ...right, ...rightArm,
    farKnee: left.knee, farAnkle: left.ankle, farToe: left.toe, farElbow: leftArm.elbow, farHand: leftArm.hand };
}
