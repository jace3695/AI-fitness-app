/** Original geometry: z is height, y is forwards, x is lateral. */
export type RotationPoint = {x:number; y:number; z:number};
export const bandRotationGuide = {
  name: '팔 붙인 밴드 외회전', view: '정면 + 윗면 동시',
  outward: '팔꿈치를 몸 옆에 유지하고 아래팔을 바깥으로 회전하기',
  returning: '몸통을 돌리지 않고 천천히 시작 위치로 돌아오기',
  limitation: '한쪽 팔 예시입니다. 정면에서 겹치는 앞뒤 길이는 윗면에서 확인합니다. 그림의 회전 각도·밴드 길이는 처방값이 아니며 손가락 그립과 견갑골 움직임은 생략합니다.',
  steps: ['제조사 지침에 맞는 고정 장치와 손상 없는 밴드를 확인합니다. 고정점이 운동하는 팔의 반대쪽, 팔꿈치 높이에 오도록 준비합니다.',
    '팔꿈치를 직각으로 굽혀 몸 옆에 둡니다. 어깨와 몸통을 돌리지 않고 손을 바깥으로 천천히 이동합니다.',
    '팔꿈치를 옆구리에서 떼거나 밴드를 튕기지 않고 천천히 돌아옵니다. 반대쪽은 고정점 방향부터 다시 준비합니다.'],
  caution: '검증된 고정 장치가 없으면 선택하지 마세요. 임의의 문손잡이·가구 설치는 시범 범위가 아닙니다. 통증·저림·불안정성 또는 고정점 움직임이 있으면 중단하세요.',
  sourceTitle: 'AAOS — Shoulder Conditioning / External Rotation',
  sourceUrl: 'https://www.orthoinfo.org/recovery/rotator-cuff-and-shoulder-conditioning-program/',
} as const;
export function bandRotationMotionId(value:string|undefined): 'band-external-rotation-at-side'|null {
  return value==='band-external-rotation-at-side'?value:null;
}
export function bandRotationPose(progress:number) {
  const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
  const lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2;
  const angle=.9*lift;
  return {shoulder:{x:24,y:0,z:170}, elbow:{x:24,y:0,z:128},
    hand:{x:24+40*Math.sin(angle),y:40*Math.cos(angle),z:128},
    anchor:{x:-110,y:40,z:128}, head:{x:0,y:0,z:198},
    hip:{x:0,y:0,z:95}, leftFoot:{x:-18,y:0,z:6}, rightFoot:{x:18,y:0,z:6}};
}
export function projectRotationPoint(p:RotationPoint,view:'front'|'top') {
  return {x:150+p.x*.9,y:view==='front'?230-p.z*.95:50+p.y*1.2};
}
