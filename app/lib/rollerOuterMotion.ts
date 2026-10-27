import { routineJoint as joint, type RoutinePoint as Point } from './routineMotion.ts';
import { rollerStages } from './rollerMotion.ts';

export type RollerOuterStageId = 'outer-quad-left' | 'outer-quad-right';

// New informational interpretation, not a claim about the old guide's intended tissue.
export const rollerOuterStages = [
  { id: 'outer-quad-left', name: '왼쪽 바깥 허벅지 · 외측 대퇴사두근' },
  { id: 'outer-quad-right', name: '오른쪽 바깥 허벅지 · 외측 대퇴사두근' },
].map(stage => ({
  ...stage,
  id: stage.id as RollerOuterStageId,
  peak: 0.5,
  guide: '새로 정의한 일반 정보용 장면입니다. 아래쪽 전완과 반대 손·발이 바닥을 지지한 준비 자세에서, 허벅지 중간의 전외측 근육 부위가 롤러와 만나는 모습을 보여 줍니다. 몸을 길이 방향으로 옮겼다가 돌아오며, 다리를 겹쳐 압력을 더하지 않습니다. IT밴드 자체·골반의 돌출 뼈·무릎은 대상이 아닙니다. 지지 자세나 그림의 이동량이 개인에게 적합하다는 뜻은 아닙니다.',
}));

// Preserve every existing scene by reference, in its original relative order.
// The legacy recovery composition, its held IDs, and its routing stay untouched.
export const rollerInformationalRecoveryStages = [
  ...rollerStages.slice(0, 4), ...rollerOuterStages, ...rollerStages.slice(4),
];

export function isRollerOuterStage(id: string): id is RollerOuterStageId {
  return id === 'outer-quad-left' || id === 'outer-quad-right';
}

/** Drawing units only: neither these bounds nor the body orientation prescribe a clinical range. */
export function rollerOuterPose(id: RollerOuterStageId, progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const shift = p === 0 || p === 1 ? 0 : 3 * (1 - Math.cos(2 * Math.PI * p));
  const travel = 2 * shift;
  const side = id === 'outer-quad-left' ? -1 : 1;
  const radius = 14, skin = 6, limbLength = 55, armLength = 50;
  const hip: Point = { x: 150 + travel, y: 0, z: 48.4 };
  const offset = (width: number, s: number): Point => ({ x: 0, y: s * width * 0.6, z: -side * s * width * 0.8 });
  const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const lowerElbow: Point = { x: 70, y: side * 13.2, z: 3.5 };
  const lowerHand: Point = { x: 20, y: side * 13.2, z: 3.5 };
  // Offset the fixed elbow into the trunk's centre plane before solving the shoulder.
  const shoulder = joint({ x: 70, y: 0, z: 21.1 }, hip, armLength, 60, { x: 0, y: 0, z: 1 });
  const head: Point = {
    x: shoulder.x + (shoulder.x - hip.x) * 27 / 60,
    y: 0,
    z: shoulder.z + (shoulder.z - hip.z) * 27 / 60,
  };
  const supportFoot: Point = { x: 205, y: -side * 45, z: skin };
  const leg = (s: number) => {
    const h = add(hip, offset(18, s));
    if (s === side) return {
      hip: h, knee: { ...h, x: h.x + limbLength }, foot: { ...h, x: h.x + 2 * limbLength }, grounded: false,
    };
    return {
      hip: h, knee: joint(h, supportFoot, limbLength, limbLength, { x: 0, y: 0, z: 1 }),
      foot: supportFoot, grounded: true,
    };
  };
  const arm = (s: number) => {
    const a = add(shoulder, offset(22, s));
    if (s === side) return { shoulder: a, elbow: lowerElbow, hand: lowerHand, forearmSupported: true };
    const hand: Point = { x: 65, y: -side * 45, z: 3.5 };
    return { shoulder: a, elbow: joint(a, hand, armLength, armLength, { x: 0, y: -side, z: 1 }), hand, forearmSupported: false };
  };
  const leftLeg = leg(-1), rightLeg = leg(1), working = side === -1 ? leftLeg : rightLeg;
  const roller = { x: 177.5 + shift, y: working.hip.y, z: radius, radius, halfWidth: 26, angle: -shift / radius };
  const contact: Point = { x: roller.x, y: working.hip.y, z: 2 * radius };
  const target = {
    start: { ...working.hip, x: working.hip.x + 18 },
    end: { ...working.hip, x: working.hip.x + 37 },
    surface: 'anterolateral-quadriceps' as const,
  };
  return {
    side, hip, shoulder, head, left: arm(-1), right: arm(1), leftLeg, rightLeg,
    roller, contact, target, skin, shift, travel, limbLength, armLength,
    contactFraction: (contact.x - working.hip.x) / limbLength,
  };
}
