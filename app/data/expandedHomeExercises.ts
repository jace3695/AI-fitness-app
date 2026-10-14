import type { ExerciseGuide } from './workouts.ts';

const nhs = { title: 'NHS · Strength exercises', url: 'https://www.nhs.uk/live-well/exercise/strength-exercises/' };
const knee = { title: 'AAOS · Knee conditioning: Leg extensions', url: 'https://www.orthoinfo.org/recovery/knee-conditioning-program/' };
const shoulder = { title: 'AAOS · Shoulder conditioning: External rotation', url: 'https://www.orthoinfo.org/recovery/rotator-cuff-and-shoulder-conditioning-program/' };
const stop = ['통증이 생기면 중단하세요. 허리 통증이나 다리 저림이 심해지면 계속하지 마세요.', '새로운 저림·힘 빠짐·감각 저하가 있으면 운동을 재개하지 말고 진료를 받으세요.'];
const common = { category: 'strength' as const, catalogOnly: true as const, breathing: '힘쓸 때 내쉬고 돌아올 때 들이마시며 숨을 참지 않습니다.', stopCriteria: stop };

// Independent summaries of public primary guidance. No copied images or prescribed loading.
export const expandedHomeExercises: Record<string, ExerciseGuide & { name: string; summary: string; purpose: string; equipment: string; difficulty: string; catalogOnly: true }> = {
  'supported-calf-raise': {
    ...common, id: 'supported-calf-raise', name: '지지형 양발 종아리 들기', equipment: '맨몸 · 흔들리지 않는 의자나 지지대', difficulty: '입문 · 지지대 필요', target: '종아리',
    summary: '두 발의 뒤꿈치를 함께 들어 종아리를 사용합니다.', purpose: '종아리 근력과 발목 움직임 연습',
    setup: ['미끄러지지 않는 바닥에서 고정된 지지대를 잡고 양발을 나란히 둡니다.'],
    movement: ['발 앞부분을 바닥에 둔 채 두 뒤꿈치를 편안한 높이까지 올립니다.', '반동 없이 뒤꿈치를 내려 바닥에 놓습니다.'],
    commonMistakes: ['발목이 바깥으로 꺾임', '몸을 흔들어 높이 올림'],
    alternatives: ['서기가 불안하면 앉아서 무릎 펴기 등 앉은 동작을 검토하세요. 종아리 운동의 동일한 대체는 아닙니다.'], sources: [nhs],
  },
  'supported-side-leg-raise': {
    ...common, id: 'supported-side-leg-raise', name: '지지형 옆 다리 들기', equipment: '맨몸 · 흔들리지 않는 의자나 지지대', difficulty: '입문 · 한발 지지 주의', target: '엉덩이 옆쪽',
    summary: '밴드 없이 한 다리를 옆으로 들어 올립니다.', purpose: '옆 방향 고관절 움직임 연습',
    setup: ['고정된 지지대를 잡고 몸통과 골반을 정면으로 둡니다.'],
    movement: ['몸을 기울이지 않는 범위에서 한 다리를 옆으로 듭니다.', '천천히 발을 내려놓고 반대쪽도 수행합니다.'],
    commonMistakes: ['골반을 들어 올리거나 몸통을 옆으로 기울임', '높이를 늘리려고 허리를 꺾음'],
    alternatives: ['한발 지지가 불안하면 이 동작을 건너뛰고 앉아서 무릎 펴기를 검토하세요. 자극 부위는 다릅니다.'], sources: [nhs],
  },
  'light-dumbbell-curl': {
    ...common, id: 'light-dumbbell-curl', name: '가벼운 덤벨 컬', equipment: '덤벨 · 1kg 아령도 사용 가능', difficulty: '입문 · 무게 적합성 확인', target: '위팔 앞쪽',
    summary: '팔꿈치를 몸 옆에 두고 아령을 올렸다 내립니다.', purpose: '팔꿈치 굽힘 근력 연습',
    setup: ['편안히 설 수 있는 자세에서 가벼운 아령을 잡습니다. 1kg도 무거우면 사용하지 않습니다.'],
    movement: ['팔꿈치를 옆구리 가까이 두고 아령을 어깨 쪽으로 올립니다.', '몸을 흔들지 않으며 천천히 내립니다.'],
    commonMistakes: ['허리를 젖혀 무게를 올림', '손목을 꺾거나 어깨를 으쓱함'],
    alternatives: ['서 있기 어렵다면 안정된 의자에 앉아 같은 동작을 하거나 무게 없이 연습하세요.'], sources: [nhs],
  },
  'seated-knee-extension': {
    ...common, id: 'seated-knee-extension', name: '앉아서 무릎 펴기', equipment: '맨몸 · 바퀴 없는 안정된 의자', difficulty: '입문 · 무릎 통증 확인', target: '허벅지 앞쪽',
    summary: '앉은 상태에서 한쪽 무릎을 천천히 폅니다.', purpose: '허벅지 앞쪽 근육 사용 연습',
    setup: ['발이 바닥에 닿는 안정된 의자에 상체를 세워 앉습니다. 발목에 덤벨을 묶지 않습니다.'],
    movement: ['허벅지에 힘을 주며 한쪽 무릎을 편안한 범위까지 폅니다.', '짧게 멈췄다가 발을 천천히 바닥으로 내리고 반대쪽도 시행합니다.'],
    commonMistakes: ['다리를 차듯이 뻗음', '끝 범위에서 무릎을 강제로 잠금', '상체를 뒤로 젖힘'],
    alternatives: ['무릎 펴기가 아프면 범위를 억지로 늘리지 말고 중단하세요. 다른 부위 운동이나 휴식을 선택하세요.'],
    stopCriteria: [...stop, '무릎의 통증·붓기가 있거나 수술 후라면 담당 전문가와 적용 여부를 먼저 확인하세요.'], sources: [knee],
  },
  'band-external-rotation-at-side': {
    ...common, id: 'band-external-rotation-at-side', name: '팔 붙인 밴드 외회전', equipment: '풀업밴드 · 검증된 고정점 필요', difficulty: '조건부 · 약한 저항과 고정점 확인', target: '어깨 뒤쪽 회전근',
    summary: '팔꿈치를 몸 옆에 둔 채 아래팔을 바깥으로 돌립니다.', purpose: '어깨 외회전 조절 연습',
    setup: ['제조사 지침에 맞는 고정 장치가 없으면 선택하지 않습니다. 문손잡이에 임의로 걸지 않습니다.', '손상 없는 밴드를 팔꿈치 높이에 고정하고 고정점이 운동하는 팔의 반대쪽에 오도록 섭니다. 팔꿈치를 직각으로 굽혀 몸 옆에 둡니다.', '밴드 단계별 저항은 확인되지 않았습니다. 가장 약한 밴드도 과하면 사용하지 않습니다.'],
    movement: ['팔꿈치를 옆구리에 유지하며 손을 몸 바깥으로 천천히 움직입니다.', '몸통은 돌리지 않고 편안한 범위에서 천천히 돌아옵니다.'],
    commonMistakes: ['팔꿈치가 몸에서 벌어짐', '허리를 비틀어 밴드를 당김', '밴드가 튕겨 돌아오게 놓음'],
    alternatives: ['고정점이 없거나 저항이 크면 밴드 없이 같은 범위를 연습하세요. 통증이 있으면 중단하세요.'],
    stopCriteria: [...stop, '밴드나 고정점이 움직이면 즉시 멈추세요.', '어깨 통증·불안정성이나 수술 이력이 있으면 담당 전문가에게 먼저 확인하세요.'], sources: [shoulder],
  },
};

export const expandedEquipmentIds: Record<string, string[]> = {
  '맨몸': ['supported-calf-raise', 'supported-side-leg-raise', 'seated-knee-extension'],
  '덤벨 · 1kg 아령': ['light-dumbbell-curl'],
  'BELLE 풀업밴드': ['band-external-rotation-at-side'],
};
