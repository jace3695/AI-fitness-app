export type PreparationPoseId = 'ab-slider-ready-position' | 'pullup-basic-posture';
export function preparationPoseId(id: string | undefined): PreparationPoseId | null {
  return id === 'ab-slider-ready-position' || id === 'pullup-basic-posture' ? id : null;
}
export type PosePoint = { x: number; y: number };
export const preparationPoses = {
  'ab-slider-ready-position': {
    name: 'AB 슬라이더 준비 자세',
    scope: '정지 준비 자세만 표시합니다. 앞으로 미는 롤아웃 동작은 포함하지 않습니다.',
    steps: [
      '무릎을 바닥에 대고 양손으로 슬라이더 손잡이를 잡습니다.',
      '등과 목을 길게 잇고, 갈비뼈를 과하게 들거나 허리를 꺾지 않습니다.',
      '바퀴를 앞으로 밀지 않고 시작 자세만 확인합니다.',
    ],
    caution: '허리 통증이나 저림이 있으면 중단하세요. 이 도해는 롤아웃으로 진행하라는 안내가 아닙니다.',
  },
  'pullup-basic-posture': {
    name: '턱걸이 기본 자세',
    scope: '발을 바닥에 둔 보조 준비 자세입니다. 완전히 매달리거나 몸을 끌어올리는 동작은 포함하지 않습니다.',
    steps: [
      '설치 상태가 확인된 바를 양손으로 잡고 양발을 바닥에 둡니다.',
      '발로 체중을 지지하면서 어깨가 귀 쪽으로 들리지 않게 자세를 확인합니다.',
      '허리를 젖히거나 반동을 주지 않고 바닥 지지를 유지합니다.',
    ],
    caution: '어깨 통증·저림·손잡이 불안정이 있으면 중단하세요. 도해의 바 높이나 체형 비율을 실제 설치 기준으로 사용하지 마세요.',
  },
} as const;
export const sliderReadyGeometry = {
  shoulder: { x: 179, y: 136 }, hip: { x: 109, y: 136 },
  head: { x: 204, y: 136 }, elbow: { x: 179, y: 163 },
  hand: { x: 179, y: 193.5 }, knee: { x: 109, y: 202 },
  ankle: { x: 65, y: 202 }, toe: { x: 48, y: 202 },
  wheel: { x: 179, y: 193.5 }, wheelRadius: 12, floor: 207,
} as const;
export const assistedBarGeometry = {
  leftHand: { x: 94, y: 34 }, rightHand: { x: 206, y: 34 },
  leftElbow: { x: 111, y: 77 }, rightElbow: { x: 189, y: 77 },
  leftShoulder: { x: 128, y: 120 }, rightShoulder: { x: 172, y: 120 },
  head: { x: 150, y: 91 }, hip: { x: 150, y: 184 },
  leftKnee: { x: 134, y: 220 }, rightKnee: { x: 166, y: 220 },
  leftAnkle: { x: 131, y: 258 }, rightAnkle: { x: 169, y: 258 },
  leftToe: { x: 117, y: 258 }, rightToe: { x: 183, y: 258 }, floor: 263,
} as const;
