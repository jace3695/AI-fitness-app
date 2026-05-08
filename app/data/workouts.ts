// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
export type BadgeVariant = 'yellow' | 'green' | 'blue' | 'purple' | 'red';
export type PhaseType = 'warmup' | 'main' | 'sliding' | 'cooldown';
export type AlertType = 'yellow' | 'green' | 'blue' | 'purple';
export type BulletType = 'purple' | 'red' | 'green';

export interface Detail {
  type: BulletType | 'step' | 'warn' | 'good' | 'text';
  text: string;
  stepNum?: number;
}

export interface IntervalRow {
  weeks: string;
  pattern: string;
  total: string;
}

export interface Exercise {
  name: string;
  meta?: string;
  badge?: { label: string; variant: BadgeVariant };
  details: Detail[];
  intervals?: IntervalRow[];
  intervalNote?: string;
}

export interface Phase {
  id: PhaseType;
  icon: string;
  title: string;
  subtitle: string;
  alert?: { variant: AlertType; text: string };
  todaySliding?: { time: string; note: string };
  exercises: Exercise[];
}

export interface FlowItem {
  icon: string;
  label: string;
  time: string;
  bgColor: string;
  labelColor: string;
  timeColor: string;
}

export interface DayWorkout {
  id: string;
  tabLabel: string;
  emoji: string;
  title: string;
  subtitle: string;
  totalTime: string;
  badgeBg: string;
  dayColor: string;
  flow: FlowItem[];
  phases: Phase[];
}

// ─────────────────────────────────────────
// Shared Sliding Board Data
// ─────────────────────────────────────────
const commonIntervals: IntervalRow[] = [
  { weeks: '1~2주차', pattern: '1분 운동\n30초 휴식', total: '15분' },
  { weeks: '3~4주차', pattern: '2분 운동\n1분 휴식', total: '20분' },
  { weeks: '5~8주차', pattern: '3분 운동\n1분 휴식', total: '20분' },
  { weeks: '9주차~', pattern: '중강도\n지속', total: '20분' },
];

const satIntervals: IntervalRow[] = [
  { weeks: '1~2주차', pattern: '1분 운동\n30초 휴식', total: '20~25분' },
  { weeks: '3~4주차', pattern: '2분 운동\n1분 휴식', total: '25~30분' },
  { weeks: '5~8주차', pattern: '3분 운동\n1분 휴식', total: '30~35분' },
  { weeks: '9주차~', pattern: '중강도\n지속', total: '35~40분' },
];

const commonMistakes: Exercise = {
  name: '흔한 실수 & 교정',
  badge: { label: '주의', variant: 'red' },
  details: [
    { type: 'warn', text: '❌ 무릎 완전히 펴기 → 항상 살짝 구부리기' },
    { type: 'warn', text: '❌ 허리 너무 많이 숙이기 → 10~15도 이내' },
    { type: 'warn', text: '❌ 발 들어 올리기 → 바닥에 붙인 채 미끄러지기' },
    { type: 'warn', text: '❌ 범퍼 너무 세게 치기 → 살짝 닿는 느낌으로' },
    { type: 'good', text: '✅ 올바른 상태: 무릎 구부림 · 시선 정면 · 균일한 호흡' },
  ],
};

// ─────────────────────────────────────────
// Monday — 상체 Push
// ─────────────────────────────────────────
const mondayWorkout: DayWorkout = {
  id: 'mon',
  tabLabel: '월요일',
  emoji: '💪',
  title: '월요일 — 상체 Push',
  subtitle: '가슴 · 어깨 · 삼두 + 슬라이딩보드',
  totalTime: '총 약 70분',
  badgeBg: '#534AB7',
  dayColor: '#534AB7',
  flow: [
    { icon: '🧘', label: '준비운동', time: '10분', bgColor: '#EEEDFE', labelColor: '#3C3489', timeColor: '#534AB7' },
    { icon: '💪', label: '본 운동', time: '35분', bgColor: '#E6F1FB', labelColor: '#0C447C', timeColor: '#185FA5' },
    { icon: '🏂', label: '슬라이딩보드', time: '20분', bgColor: '#FAEEDA', labelColor: '#633806', timeColor: '#854F0B' },
    { icon: '🌿', label: '마무리 스트레칭', time: '5분', bgColor: '#EAF3DE', labelColor: '#27500A', timeColor: '#3B6D11' },
  ],
  phases: [
    {
      id: 'warmup',
      icon: '🧘',
      title: '준비운동',
      subtitle: '10분 · 어깨·가슴 관절 집중 활성화',
      exercises: [
        {
          name: '① 제자리 걷기',
          meta: '2분 | 혈액순환 시작',
          details: [{ type: 'purple', text: '무릎 번갈아 들어 올리며 팔 앞뒤로 크게 흔들기. 2분 꾸준히.' }],
        },
        {
          name: '② 어깨 돌리기 (앞/뒤 각 20회)',
          meta: '오늘 Push 운동 전 가장 중요한 준비',
          badge: { label: 'Push 핵심', variant: 'purple' },
          details: [{ type: 'purple', text: '오늘 푸시업·숄더프레스를 하므로 평소보다 20회씩 더 충분히 돌립니다. 최대한 크게.' }],
        },
        {
          name: '③ 팔 크로스 스윙',
          meta: '20회 | 가슴 근육 동적 스트레칭 — 월요일 추가',
          badge: { label: 'Push 핵심', variant: 'purple' },
          details: [{ type: 'purple', text: '양팔을 옆으로 크게 벌렸다가 가슴 앞에서 교차하며 모읍니다. 20회. 푸시업 전 가슴 이완 필수.' }],
        },
        {
          name: '④ 고양이-소 자세',
          meta: '10회 | 척추 이완 — 매일 생략 불가',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '네 발 자세. 등 위로 둥글게(고양이) ↔ 배 아래로 내리기(소). 호흡 맞춰 천천히 10회.' }],
        },
        {
          name: '⑤ 골반 기울이기',
          meta: '10회 | 코어 활성화',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '누워서 무릎 세우고 허리를 바닥에 눌러 붙이기. 3초 유지 후 중립으로. 10회.' }],
        },
        {
          name: '⑥ 루프밴드 사이드 스텝',
          meta: '좌우 10회 | 둔근 활성화',
          details: [{ type: 'purple', text: '밴드를 무릎 위에 착용, 무릎 살짝 굽혀 옆으로 걷기. 좌우 10회씩.' }],
        },
        {
          name: '⑦ 가벼운 스쿼트',
          meta: '10회 | 관절 윤활 최종 점검',
          details: [{ type: 'purple', text: '맨몸으로 얕게. 관절 이상 여부 최종 확인.' }],
        },
      ],
    },
    {
      id: 'main',
      icon: '💪',
      title: '본 운동 — 상체 Push',
      subtitle: '35분 · 세트 간 휴식 60~90초',
      exercises: [
        {
          name: '무릎 푸시업 → 일반 푸시업',
          meta: '3세트 × 10~15회 | 가슴 · 어깨 · 삼두',
          badge: { label: '기본', variant: 'green' },
          details: [{ type: 'purple', text: '손은 어깨 너비보다 살짝 넓게. 배에 힘 유지. 내려갈 때 2초, 올라올 때 1초. 허리 처지면 즉시 무릎 버전으로.' }],
        },
        {
          name: '덤벨 숄더 프레스',
          meta: '3세트 × 10~12회 | 어깨 전면 · 측면',
          badge: { label: '기본', variant: 'green' },
          details: [{ type: 'purple', text: '초반에는 등받이 의자에 앉아서. 갈비뼈 들리지 않게 복부 힘 유지. 머리 바로 위로 밀어 올립니다.' }],
        },
        {
          name: '덤벨 래터럴 레이즈',
          meta: '3세트 × 12~15회 | 어깨 측면 — 역삼각 핵심',
          badge: { label: '체형', variant: 'purple' },
          details: [{ type: 'purple', text: '팔꿈치 살짝 구부린 채 어깨 높이까지만. 승모근에 힘 들어가지 않게. 가볍게 정확하게.' }],
        },
        {
          name: '덤벨 트라이셉스 킥백',
          meta: '3세트 × 12회 | 삼두근',
          badge: { label: '기본', variant: 'green' },
          details: [{ type: 'purple', text: '상체 45도 숙이고 팔꿈치 옆구리에 고정 후 팔만 뒤로. 허리 부담 시 침대에 한 손·무릎 지지.' }],
        },
        {
          name: '플랭크 + 사이드 플랭크',
          meta: '플랭크 3×20~40초 / 사이드 2×좌우 20초',
          badge: { label: '코어', variant: 'green' },
          details: [
            { type: 'purple', text: '플랭크: 팔꿈치 바닥, 복부 수축. 허리 내려가거나 엉덩이 올라가지 않게.' },
            { type: 'purple', text: '사이드 플랭크: 옆으로 누워 팔꿈치 지지. 골반이 내려가지 않게.' },
          ],
        },
        {
          name: '버드독',
          meta: '3세트 × 좌우 10회 | 코어 · 디스크 재활',
          badge: { label: '재활', variant: 'green' },
          details: [{ type: 'purple', text: '네 발 자세에서 반대쪽 팔·다리를 수평으로 뻗고 3초 유지. 허리 비틀림 없게.' }],
        },
      ],
    },
    {
      id: 'sliding',
      icon: '🏂',
      title: '슬라이딩보드',
      subtitle: '오늘 목표: 20분',
      todaySliding: { time: '20분', note: '본 운동 직후 수행 · 주차별 인터벌 방식 적용' },
      exercises: [
        {
          name: '기본 자세',
          meta: '탑승 전 매번 확인',
          badge: { label: '자세', variant: 'yellow' },
          details: [
            { type: 'purple', text: '**무릎:** 항상 살짝 구부린 상태(20~30도). 완전히 펴면 허리·무릎 부담 증가. 가장 중요한 규칙.' },
            { type: 'purple', text: '**상체:** 10~15도만 앞으로 기울이기. 너무 많이 숙이면 허리에 부담.' },
            { type: 'purple', text: '**시선:** 정면. 발 아래를 내려다보면 자세가 무너집니다.' },
          ],
        },
        {
          name: '발 동작 — 미끄러지는 법',
          meta: '스케이팅을 흉내 낸다고 생각하면 쉽습니다',
          badge: { label: '동작', variant: 'yellow' },
          details: [
            { type: 'step', text: '오른발로 오른쪽 범퍼를 옆으로 지긋이 밀어냅니다.', stepNum: 1 },
            { type: 'step', text: '밀어낸 힘으로 왼쪽으로 미끄러지며 왼발이 왼쪽 범퍼에 닿습니다.', stepNum: 2 },
            { type: 'step', text: '왼발로 밀어내 오른쪽으로 미끄러집니다. 이 반복입니다.', stepNum: 3 },
            { type: 'purple', text: '발을 들어 올리는 게 아니라 **바닥에 붙인 채 옆으로 미끄러집니다.**' },
            { type: 'red', text: '범퍼를 너무 세게 차면 들쭉날쭉. 균일한 힘이 목표.' },
          ],
        },
        {
          name: '팔 동작 + 호흡법',
          meta: '칼로리 20~30% 추가 · 무호흡 이력상 숨 참기 금지',
          badge: { label: '동작', variant: 'blue' },
          details: [
            { type: 'purple', text: '오른쪽으로 미끄러질 때 왼팔 앞으로, 오른팔 뒤로. 반대도 동일. (스케이터 자세)' },
            { type: 'purple', text: '밀어낼 때 내쉬고, 미끄러지는 동안 자연스럽게 들이마십니다.' },
            { type: 'red', text: '숨이 너무 차면 즉시 속도를 낮춥니다. 말을 할 수 있는 강도 = 지방 연소 최적 구간.' },
          ],
        },
        {
          name: '주차별 인터벌 계획',
          meta: '처음부터 20분 내내 강하게 타지 않습니다',
          badge: { label: '진행표', variant: 'green' },
          details: [{ type: 'purple', text: '쉬는 구간엔 완전히 멈추지 말고 보드 위에서 천천히 좌우로 발을 흔드는 동작으로 쉽니다.' }],
          intervals: commonIntervals,
        },
        commonMistakes,
      ],
    },
    {
      id: 'cooldown',
      icon: '🌿',
      title: '마무리 스트레칭',
      subtitle: '5분 · 가슴·어깨 앞쪽 집중',
      exercises: [
        {
          name: '① 고양이-소 (느린 버전)',
          meta: '5회 | 1회당 6~8초 · 척추 마무리 이완',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '준비운동보다 훨씬 천천히, 더 깊게. 운동 중 긴장된 척추 근육 이완.' }],
        },
        {
          name: '② 가슴·어깨 앞쪽 스트레칭',
          meta: '30~40초 | Push 운동 후 가장 중요',
          badge: { label: '오늘 중점', variant: 'purple' },
          details: [
            { type: 'purple', text: '양손을 등 뒤에서 깍지 끼고 가슴을 앞으로 내밀며 어깨뼈를 모읍니다. 30~40초 유지.' },
            { type: 'purple', text: '수축된 가슴·어깨 앞쪽을 이완하지 않으면 어깨가 앞으로 말립니다. 오늘 필수 스트레칭.' },
          ],
        },
        {
          name: '③ 목·승모근 스트레칭',
          meta: '좌우 각 20초 | 어깨 운동 후',
          badge: { label: '오늘 중점', variant: 'purple' },
          details: [
            { type: 'purple', text: '한 손을 머리 반대편에 올리고 옆으로 살짝 기울입니다. 가볍게만.' },
            { type: 'red', text: '목을 앞뒤로 크게 돌리는 동작은 디스크 이력상 피합니다. 옆으로만 기울이기.' },
          ],
        },
        {
          name: '④ 차일드 포즈',
          meta: '40~60초 | 허리 · 광배근 전체 이완',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '무릎 꿇고 앉아 양팔을 앞으로 최대한 뻗으며 상체를 바닥으로. 슬라이딩보드 후 허리 이완에도 효과적.' }],
        },
        {
          name: '⑤ 힙 플렉서 스트레칭',
          meta: '좌우 각 30초 | 슬라이딩보드 후 고관절 이완',
          details: [{ type: 'purple', text: '런지 자세에서 뒤 무릎을 바닥에 내리고 골반을 앞으로 밀어 넣습니다. 30초 유지.' }],
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────
// Tuesday — 하체 + 코어
// ─────────────────────────────────────────
const tuesdayWorkout: DayWorkout = {
  id: 'tue',
  tabLabel: '화요일',
  emoji: '🦵',
  title: '화요일 — 하체 + 코어',
  subtitle: '둔근 · 대퇴사두 · 햄스트링 + 슬라이딩보드',
  totalTime: '총 약 65분',
  badgeBg: '#1D9E75',
  dayColor: '#0F6E56',
  flow: [
    { icon: '🧘', label: '준비운동', time: '10분', bgColor: '#EEEDFE', labelColor: '#3C3489', timeColor: '#534AB7' },
    { icon: '🦵', label: '본 운동', time: '30분', bgColor: '#E1F5EE', labelColor: '#0F6E56', timeColor: '#0F6E56' },
    { icon: '🏂', label: '슬라이딩보드', time: '20분', bgColor: '#FAEEDA', labelColor: '#633806', timeColor: '#854F0B' },
    { icon: '🌿', label: '마무리 스트레칭', time: '5분', bgColor: '#EAF3DE', labelColor: '#27500A', timeColor: '#3B6D11' },
  ],
  phases: [
    {
      id: 'warmup',
      icon: '🧘',
      title: '준비운동',
      subtitle: '10분 · 고관절·둔근 집중 활성화',
      exercises: [
        {
          name: '① 제자리 걷기',
          meta: '2분',
          details: [{ type: 'purple', text: '팔 크게 흔들며 2분 꾸준히.' }],
        },
        {
          name: '② 고관절 원 그리기',
          meta: '좌우 각 10회 | 오늘 하체 준비의 핵심',
          badge: { label: '하체 핵심', variant: 'green' },
          details: [{ type: 'purple', text: '한 발로 서서 무릎을 들어 올리고 고관절을 크게 원을 그리듯 돌립니다. 안쪽 10회, 바깥쪽 10회. 오늘 스쿼트·런지 전 반드시 수행.' }],
        },
        {
          name: '③ 고양이-소 자세',
          meta: '10회 | 척추·허리 이완 — 매일 생략 불가',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '네 발 자세. 등 위로 둥글게(고양이) ↔ 배 아래로(소). 천천히 10회.' }],
        },
        {
          name: '④ 골반 기울이기',
          meta: '10회 | 코어 활성화',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '누워서 허리를 바닥에 눌러 붙이기. 3초 유지. 10회.' }],
        },
        {
          name: '⑤ 힙힌지 연습',
          meta: '10회 | 고블릿 스쿼트 자세 준비',
          badge: { label: '하체 핵심', variant: 'green' },
          details: [{ type: 'purple', text: '엉덩이를 뒤로 밀며 상체를 기울이는 동작. 허리가 아닌 고관절이 접히는 느낌. 오늘 스쿼트 자세의 기반.' }],
        },
        {
          name: '⑥ 루프밴드 사이드 스텝',
          meta: '좌우 15회 | 오늘 더 많이 — 둔근 충분히 깨우기',
          badge: { label: '하체 핵심', variant: 'green' },
          details: [{ type: 'purple', text: '오늘 하체 운동이므로 평소 10회에서 15회로 늘립니다. 둔근이 활성화되어야 글루트 브릿지 효과가 극대화됩니다.' }],
        },
        {
          name: '⑦ 가벼운 스쿼트',
          meta: '10회 | 무릎·고관절 이상 여부 점검',
          details: [{ type: 'purple', text: '맨몸으로 얕게. 오늘 무릎이나 고관절 불편함을 여기서 미리 확인합니다.' }],
        },
      ],
    },
    {
      id: 'main',
      icon: '🦵',
      title: '본 운동 — 하체 + 코어',
      subtitle: '30분 · 디스크 안전 버전',
      alert: { variant: 'yellow', text: '⚠️ 깊은 스쿼트·바벨 데드리프트·레그레이즈 제외. 허리 중립 유지 범위 내에서만.' },
      exercises: [
        {
          name: '고블릿 스쿼트',
          meta: '3세트 × 10~12회 | 대퇴사두 · 둔근',
          badge: { label: '핵심', variant: 'yellow' },
          details: [{ type: 'purple', text: '덤벨을 가슴 앞에 들고 스쿼트. 앞 무게 덕에 허리가 자연스럽게 세워집니다. 둥글어지기 전 깊이에서 멈추기.' }],
        },
        {
          name: '글루트 브릿지 (루프밴드)',
          meta: '3세트 × 15~20회 | 둔근 · 햄스트링',
          badge: { label: '핵심', variant: 'yellow' },
          details: [{ type: 'purple', text: '루프 밴드를 허벅지에 착용하면 둔근 자극 2배. 위에서 1~2초 수축 유지. 허리로 꺾지 말고 엉덩이 힘으로.' }],
        },
        {
          name: '스텝백 런지',
          meta: '2~3세트 × 좌우 8~10회 | 대퇴사두 · 둔근',
          badge: { label: '안전', variant: 'green' },
          details: [{ type: 'purple', text: '뒤로 발을 보내는 런지. 앞 런지보다 허리·무릎 부담 적음. 상체 기울어짐 금지. 통증 시 글루트 브릿지로 대체.' }],
        },
        {
          name: '루프밴드 사이드 워크',
          meta: '3세트 × 좌우 12회 | 둔근 중간',
          badge: { label: '안전', variant: 'green' },
          details: [{ type: 'purple', text: '밴드를 무릎 위에 착용. 무릎 살짝 굽혀 옆으로 걷기. 상체 세우기 유지.' }],
        },
        {
          name: '슬라이딩 레그 컬',
          meta: '3세트 × 10~12회 | 햄스트링',
          badge: { label: '기구', variant: 'blue' },
          details: [{ type: 'purple', text: '누워서 발뒤꿈치를 슬라이딩 보드에 올리고, 엉덩이 들며 무릎을 굽힙니다. 천천히.' }],
        },
        {
          name: '데드버그 + 버드독',
          meta: '각 3세트 × 10회 | 코어 안정화',
          badge: { label: '재활', variant: 'green' },
          details: [{ type: 'purple', text: '데드버그: 허리가 바닥에서 뜨지 않는 범위까지만. 버드독: 반대쪽 팔다리 수평 뻗고 3초 유지.' }],
        },
      ],
    },
    {
      id: 'sliding',
      icon: '🏂',
      title: '슬라이딩보드',
      subtitle: '오늘 목표: 20분',
      todaySliding: { time: '20분', note: '본 운동 직후 수행 · 하체 운동 후라 다리가 무거울 수 있음 — 속도 조절 필요' },
      exercises: [
        {
          name: '기본 자세',
          meta: '탑승 전 매번 확인',
          badge: { label: '자세', variant: 'yellow' },
          details: [
            { type: 'purple', text: '**무릎:** 항상 살짝 구부린 상태(20~30도). 하체 운동 후 다리가 무거우므로 특히 의식해야 합니다.' },
            { type: 'purple', text: '**상체:** 10~15도만 앞으로 기울이기. 허리 과신전 금지.' },
            { type: 'purple', text: '**시선:** 정면 유지.' },
          ],
        },
        {
          name: '발 동작 + 팔 동작 + 호흡',
          meta: '화요일 특이사항: 하체 운동 후라 속도를 천천히 시작',
          badge: { label: '동작', variant: 'yellow' },
          details: [
            { type: 'purple', text: '발: 오른발로 오른쪽 범퍼를 지긋이 밀어내며 왼쪽으로 미끄러지기. 반복. 바닥에 붙인 채 미끄러지기.' },
            { type: 'purple', text: '팔: 미끄러지는 반대쪽 팔을 앞으로 내밀기. 팔이 있어야 칼로리 소모가 20~30% 증가합니다.' },
            { type: 'red', text: '오늘은 하체 근력 운동을 이미 했으므로 처음 2~3분은 평소보다 천천히 타다가 점진적으로 속도를 올립니다.' },
            { type: 'purple', text: '호흡: 밀어낼 때 내쉬기. 숨이 너무 차면 즉시 속도 낮추기.' },
          ],
        },
        {
          name: '주차별 인터벌 계획',
          badge: { label: '진행표', variant: 'green' },
          details: [{ type: 'purple', text: '쉬는 구간엔 보드 위에서 천천히 좌우로 발을 흔드는 동작으로 쉽니다.' }],
          intervals: commonIntervals,
        },
        {
          name: '흔한 실수 & 교정',
          badge: { label: '주의', variant: 'red' },
          details: [
            { type: 'warn', text: '❌ 무릎 완전히 펴기 → 항상 살짝 구부리기' },
            { type: 'warn', text: '❌ 허리 너무 숙이기 → 10~15도 이내' },
            { type: 'warn', text: '❌ 발 들어 올리기 → 바닥에 붙인 채 미끄러지기' },
            { type: 'good', text: '✅ 올바른 상태: 무릎 구부림 · 시선 정면 · 균일한 호흡' },
          ],
        },
      ],
    },
    {
      id: 'cooldown',
      icon: '🌿',
      title: '마무리 스트레칭',
      subtitle: '5~8분 · 하체 3종 세트 집중',
      exercises: [
        {
          name: '① 고양이-소 (느린 버전)',
          meta: '5회 | 1회당 6~8초',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '아주 천천히. 운동 중 긴장된 척추 근육을 이완합니다.' }],
        },
        {
          name: '② 누워서 햄스트링 스트레칭',
          meta: '좌우 각 30~40초 | 오늘 가장 중요',
          badge: { label: '오늘 중점', variant: 'purple' },
          details: [
            { type: 'purple', text: '누워서 한 다리를 들어 허벅지 뒤를 손으로 잡고 몸 쪽으로 당깁니다. 무릎 살짝 구부려도 됩니다.' },
            { type: 'red', text: '서서 허리를 굽혀 발 잡는 자세는 디스크에 부담 — 반드시 누워서 수행합니다.' },
          ],
        },
        {
          name: '③ 누워서 둔근 스트레칭',
          meta: '좌우 각 30~40초 | 글루트 브릿지 후 필수',
          badge: { label: '오늘 중점', variant: 'purple' },
          details: [{ type: 'purple', text: '누워서 숫자 4 모양으로 발목을 허벅지 위에 올리고, 반대 허벅지를 잡아 당깁니다. 엉덩이 깊은 곳이 당기는 느낌.' }],
        },
        {
          name: '④ 힙 플렉서 스트레칭',
          meta: '좌우 각 40~50초 | 런지 후 특히 중요',
          badge: { label: '오늘 중점', variant: 'purple' },
          details: [{ type: 'purple', text: '런지 자세에서 뒤 무릎을 바닥에 내리고 골반을 앞으로 밀어 넣습니다. 오늘은 평소보다 10~20초 더 유지합니다.' }],
        },
        {
          name: '⑤ 차일드 포즈',
          meta: '40~60초 | 허리 전체 마무리 이완',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '무릎 꿇고 앉아 양팔 앞으로 뻗으며 상체를 바닥으로. 허리 전체가 이완됩니다.' }],
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────
// Thursday — 상체 Pull
// ─────────────────────────────────────────
const thursdayWorkout: DayWorkout = {
  id: 'thu',
  tabLabel: '목요일',
  emoji: '🔝',
  title: '목요일 — 상체 Pull',
  subtitle: '등 · 이두 · 후면 어깨 + 슬라이딩보드',
  totalTime: '총 약 70분',
  badgeBg: '#534AB7',
  dayColor: '#534AB7',
  flow: [
    { icon: '🧘', label: '준비운동', time: '10분', bgColor: '#EEEDFE', labelColor: '#3C3489', timeColor: '#534AB7' },
    { icon: '🔝', label: '본 운동', time: '35분', bgColor: '#E6F1FB', labelColor: '#0C447C', timeColor: '#185FA5' },
    { icon: '🏂', label: '슬라이딩보드', time: '20분', bgColor: '#FAEEDA', labelColor: '#633806', timeColor: '#854F0B' },
    { icon: '🌿', label: '마무리 스트레칭', time: '5분', bgColor: '#EAF3DE', labelColor: '#27500A', timeColor: '#3B6D11' },
  ],
  phases: [
    {
      id: 'warmup',
      icon: '🧘',
      title: '준비운동',
      subtitle: '10분 · 등·어깨 후면 집중 활성화',
      exercises: [
        { name: '① 제자리 걷기', meta: '2분', details: [{ type: 'purple', text: '팔 크게 흔들며 2분.' }] },
        {
          name: '② 어깨 돌리기 + 팔 뒤로 당기기',
          meta: '어깨 돌리기 20회 + 당기기 10회 | 오늘 Pull 운동 전 핵심',
          badge: { label: 'Pull 핵심', variant: 'blue' },
          details: [{ type: 'purple', text: '어깨 앞/뒤 각 10회 후, 양팔을 앞으로 뻗었다가 팔꿈치를 구부리며 등 쪽으로 힘껏 당기기 10회. 오늘 풀업·원암 로우 준비.' }],
        },
        {
          name: '③ 고양이-소 자세',
          meta: '10회 | 척추 이완 — 매일 생략 불가',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '천천히 10회. 원암 로우 중 허리 안정화를 위해 반드시 수행합니다.' }],
        },
        {
          name: '④ 골반 기울이기',
          meta: '10회',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '누워서 허리를 바닥에 눌러 붙이기. 3초 유지. 10회.' }],
        },
        {
          name: '⑤ 힙힌지 연습',
          meta: '10회 | 원암 로우 자세 직접 준비',
          badge: { label: 'Pull 핵심', variant: 'blue' },
          details: [{ type: 'purple', text: '엉덩이를 뒤로 밀며 상체를 45도 기울이는 동작. 오늘 원암 로우에서 이 자세를 그대로 씁니다. 충분히 익히기.' }],
        },
        {
          name: '⑥ 루프밴드 사이드 스텝',
          meta: '좌우 10회 | 둔근 활성화',
          details: [{ type: 'purple', text: '밴드 무릎 위 착용, 무릎 살짝 굽혀 옆으로. 좌우 10회씩.' }],
        },
        {
          name: '⑦ 가벼운 스쿼트',
          meta: '10회 | 전신 관절 최종 점검',
          details: [{ type: 'purple', text: '맨몸으로 얕게. 전신 관절 최종 확인.' }],
        },
      ],
    },
    {
      id: 'main',
      icon: '🔝',
      title: '본 운동 — 상체 Pull',
      subtitle: '35분 · 세트 간 휴식 60~90초',
      exercises: [
        {
          name: '밴드 랫풀다운',
          meta: '3세트 × 12~15회 | 광배근 — 풀업 전 필수 단계',
          badge: { label: '핵심', variant: 'yellow' },
          details: [{ type: 'purple', text: '턱걸이 바에 밴드 걸고 바닥에 앉아서. "팔꿈치를 겨드랑이 아래로 내린다"는 느낌으로 당깁니다. 어깨 으쓱 금지.' }],
        },
        {
          name: '밴드 보조 풀업 (턱걸이)',
          meta: '3세트 × 3~6회 | 광배근 · 이두근',
          badge: { label: '핵심', variant: 'yellow' },
          details: [{ type: 'purple', text: 'BELLE 밴드 5단계부터. 내려올 때 천천히 — 네거티브가 근력 향상의 핵심. 역삼각 체형 완성의 최고 운동.' }],
        },
        {
          name: '덤벨 원암 로우',
          meta: '3세트 × 12회 | 등 중간',
          badge: { label: '주의', variant: 'yellow' },
          details: [{ type: 'purple', text: '⚠️ 반드시 한 손·무릎을 침대에 올려 척추 지지 상태에서 수행. 몸통 비틀림·무게 욕심 금지.' }],
        },
        {
          name: '밴드 페이스 풀',
          meta: '3세트 × 15회 | 후면 어깨 · 자세 교정',
          badge: { label: '안전', variant: 'green' },
          details: [{ type: 'purple', text: '밴드를 문손잡이에 걸고 얼굴 높이로 당깁니다. 양 손이 귀 옆까지.' }],
        },
        {
          name: '덤벨 바이셉스 컬',
          meta: '2~3세트 × 12회 | 이두근',
          badge: { label: '기본', variant: 'green' },
          details: [{ type: 'purple', text: '팔꿈치 옆구리에 고정. 반동 없이 천천히.' }],
        },
        {
          name: '데드버그',
          meta: '3세트 × 좌우 10회 | 코어 안정화',
          badge: { label: '재활', variant: 'green' },
          details: [{ type: 'purple', text: '누워서 팔·다리 90도, 반대쪽 팔다리를 동시에 내립니다. 허리 뜨면 범위 줄이기.' }],
        },
      ],
    },
    {
      id: 'sliding',
      icon: '🏂',
      title: '슬라이딩보드',
      subtitle: '오늘 목표: 20분',
      todaySliding: { time: '20분', note: '상체 운동 후라 다리 상태가 좋음 — 일정한 강도 유지 가능' },
      exercises: [
        {
          name: '기본 자세 + 발·팔 동작',
          meta: '목요일: 상체 운동 후라 하체 피로가 없어 안정적으로 탈 수 있습니다',
          badge: { label: '동작', variant: 'yellow' },
          details: [
            { type: 'purple', text: '**무릎:** 살짝 구부림(20~30도) 유지. **상체:** 10~15도 기울이기. **시선:** 정면.' },
            { type: 'purple', text: '발: 범퍼를 옆으로 지긋이 밀어내며 미끄러지기. 발을 들어 올리지 않습니다.' },
            { type: 'purple', text: '팔: 미끄러지는 반대쪽 팔을 앞으로. 오늘 상체 운동을 했지만 팔 동작은 가볍게 유지.' },
            { type: 'purple', text: '호흡: 밀어낼 때 내쉬기. 말을 할 수 있는 강도 유지.' },
          ],
        },
        {
          name: '주차별 인터벌 계획',
          badge: { label: '진행표', variant: 'green' },
          details: [],
          intervals: commonIntervals,
        },
        {
          name: '흔한 실수 & 교정',
          badge: { label: '주의', variant: 'red' },
          details: [
            { type: 'warn', text: '❌ 무릎 완전히 펴기 → 항상 살짝 구부리기' },
            { type: 'warn', text: '❌ 허리 너무 숙이기 → 10~15도 이내' },
            { type: 'good', text: '✅ 올바른 상태: 무릎 구부림 · 시선 정면 · 균일한 호흡' },
          ],
        },
      ],
    },
    {
      id: 'cooldown',
      icon: '🌿',
      title: '마무리 스트레칭',
      subtitle: '5~8분 · 광배근·등 집중 이완',
      exercises: [
        {
          name: '① 고양이-소 (느린 버전)',
          meta: '5회 | 1회당 6~8초',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '아주 천천히. 원암 로우 후 긴장된 척추 주변 근육 이완.' }],
        },
        {
          name: '② 차일드 포즈',
          meta: '50~60초 | Pull 운동 후 광배근 이완 — 오늘 가장 중요',
          badge: { label: '오늘 중점', variant: 'purple' },
          details: [{ type: 'purple', text: '양팔을 앞으로 최대한 뻗으며 상체를 바닥으로. 팔을 멀리 뻗을수록 광배근까지 함께 이완됩니다. 풀업·랫풀다운 후 필수.' }],
        },
        {
          name: '③ 광배근·옆구리 스트레칭',
          meta: '좌우 각 25~30초 | 풀업 후 필수',
          badge: { label: '오늘 중점', variant: 'purple' },
          details: [{ type: 'purple', text: '팔을 위로 쭉 뻗고 반대쪽 손으로 손목을 잡아 몸통을 옆으로 기울입니다. 비틀지 않고 옆으로만.' }],
        },
        {
          name: '④ 누워서 햄스트링 스트레칭',
          meta: '좌우 각 30초 | 슬라이딩보드 후',
          details: [{ type: 'purple', text: '누워서 한 다리를 들어 허벅지 뒤를 손으로 잡고 몸 쪽으로 당깁니다. 30초.' }],
        },
        {
          name: '⑤ 힙 플렉서 스트레칭',
          meta: '좌우 각 30초 | 슬라이딩보드 후 고관절 이완',
          details: [{ type: 'purple', text: '런지 자세에서 뒤 무릎을 바닥에 내리고 골반을 앞으로 밀어 넣기. 30초 유지.' }],
        },
        {
          name: '⑥ 목·승모근 스트레칭',
          meta: '좌우 각 20초 | 페이스 풀 후',
          details: [{ type: 'purple', text: '한 손을 머리 반대편에 올리고 옆으로 살짝 기울입니다. 가볍게만. 앞뒤 회전 금지.' }],
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────
// Friday — 전신 서킷
// ─────────────────────────────────────────
const fridayWorkout: DayWorkout = {
  id: 'fri',
  tabLabel: '금요일',
  emoji: '⚡',
  title: '금요일 — 전신 서킷',
  subtitle: '전신 + 슬라이딩보드 — 주중 칼로리 소모 최대 날',
  totalTime: '총 약 70분',
  badgeBg: '#1D9E75',
  dayColor: '#0F6E56',
  flow: [
    { icon: '🧘', label: '준비운동', time: '10분', bgColor: '#EEEDFE', labelColor: '#3C3489', timeColor: '#534AB7' },
    { icon: '⚡', label: '전신 서킷', time: '30분', bgColor: '#E1F5EE', labelColor: '#0F6E56', timeColor: '#0F6E56' },
    { icon: '🏂', label: '슬라이딩보드', time: '25분', bgColor: '#FAEEDA', labelColor: '#633806', timeColor: '#854F0B' },
    { icon: '🌿', label: '마무리 스트레칭', time: '5분', bgColor: '#EAF3DE', labelColor: '#27500A', timeColor: '#3B6D11' },
  ],
  phases: [
    {
      id: 'warmup',
      icon: '🧘',
      title: '준비운동',
      subtitle: '10분 · 전신 균형 있게 활성화',
      exercises: [
        { name: '① 제자리 걷기', meta: '2분', details: [{ type: 'purple', text: '팔 크게 흔들며 2분.' }] },
        {
          name: '② 어깨 돌리기',
          meta: '앞/뒤 각 10회 | 오늘 Push·Pull 모두 포함되므로 균형 있게',
          details: [{ type: 'purple', text: '앞뒤 각 10회. 오늘 서킷에 푸시업·밴드 로우가 모두 포함됩니다.' }],
        },
        {
          name: '③ 고양이-소 자세',
          meta: '10회 | 매일 생략 불가',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '천천히 10회. 생략 불가.' }],
        },
        {
          name: '④ 골반 기울이기',
          meta: '10회',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '누워서 허리를 바닥에 눌러 붙이기. 3초 유지. 10회.' }],
        },
        {
          name: '⑤ 힙힌지 연습',
          meta: '10회',
          details: [{ type: 'purple', text: '서킷 중 밴드 시티드 로우 자세 준비.' }],
        },
        {
          name: '⑥ 루프밴드 사이드 스텝',
          meta: '좌우 10회',
          details: [{ type: 'purple', text: '둔근 활성화. 오늘 서킷에 글루트 브릿지가 포함됩니다.' }],
        },
        {
          name: '⑦ 가벼운 스쿼트',
          meta: '10회 | 서킷 첫 번째 동작 예비 점검',
          details: [{ type: 'purple', text: '오늘 서킷 첫 번째 동작도 고블릿 스쿼트입니다. 관절 상태 최종 확인.' }],
        },
      ],
    },
    {
      id: 'main',
      icon: '⚡',
      title: '전신 서킷',
      subtitle: '30분 · 6개 연속 → 2분 휴식 → 3~4라운드',
      alert: { variant: 'green', text: '🔥 6개 동작을 쉬지 않고 연속 수행 → 2분 휴식 → 반복. 총 3라운드, 익숙해지면 4라운드.' },
      exercises: [
        {
          name: '① 고블릿 스쿼트 10회 → ② 푸시업 10회 → ③ 밴드 시티드 로우 12회',
          meta: '쉬지 않고 연속',
          details: [{ type: 'purple', text: '밴드 시티드 로우: 바닥에 앉아 밴드를 발에 걸고 팔꿈치를 뒤로 당기기. 서킷 중 하체 쉬는 구간.' }],
        },
        {
          name: '④ 글루트 브릿지 15회 → ⑤ 데드버그 좌우 8회 → ⑥ 슬라이딩보드 2분',
          meta: '연속 후 2분 휴식 → 반복',
          details: [{ type: 'purple', text: '라운드 마지막 슬라이딩보드 2분으로 심박수를 끌어올립니다.' }],
        },
      ],
    },
    {
      id: 'sliding',
      icon: '🏂',
      title: '슬라이딩보드 (서킷 후 추가)',
      subtitle: '오늘 목표: 추가 15~20분 (서킷 중 포함 시 총 25분)',
      todaySliding: { time: '+15~20분', note: '서킷 중 이미 심박수가 올라온 상태 — 처음 강도를 살짝 낮게 시작' },
      exercises: [
        {
          name: '기본 자세 + 동작',
          meta: '금요일 특이사항: 서킷 후라 심박수가 이미 높음 — 처음 2~3분은 천천히',
          badge: { label: '동작', variant: 'yellow' },
          details: [
            { type: 'purple', text: '**무릎:** 살짝 구부림 유지. **상체:** 10~15도 기울이기. **시선:** 정면.' },
            { type: 'red', text: '서킷 후라 몸이 이미 지쳐 있습니다. 처음 2~3분은 천천히 타다가 호흡이 안정되면 강도를 올립니다.' },
            { type: 'purple', text: '호흡: 밀어낼 때 내쉬기. 무호흡 이력상 너무 숨이 차면 즉시 속도 낮추기.' },
          ],
        },
        {
          name: '주차별 인터벌 계획',
          badge: { label: '진행표', variant: 'green' },
          details: [{ type: 'purple', text: '금요일은 서킷 중 2분씩 이미 포함 → 추가로 15~20분 = 총 약 25분 슬라이딩보드입니다.' }],
          intervals: commonIntervals,
        },
        {
          name: '흔한 실수 & 교정',
          badge: { label: '주의', variant: 'red' },
          details: [
            { type: 'warn', text: '❌ 무릎 완전히 펴기 → 살짝 구부리기' },
            { type: 'warn', text: '❌ 서킷 후 무리해서 빠르게 타기 → 천천히 시작 후 점진적 강도 상승' },
            { type: 'good', text: '✅ 오늘 목표: 완주가 핵심. 강도보다 20~25분 채우기.' },
          ],
        },
      ],
    },
    {
      id: 'cooldown',
      icon: '🌿',
      title: '마무리 스트레칭',
      subtitle: '5~8분 · 전신 골고루',
      exercises: [
        {
          name: '① 고양이-소 (느린 버전)',
          meta: '5회 | 척추 마무리',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '1회당 6~8초. 서킷으로 긴장된 전신 척추 이완.' }],
        },
        {
          name: '② 차일드 포즈',
          meta: '40~60초 | 허리 · 광배근',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '양팔 앞으로 최대한 뻗으며 상체를 바닥으로. 허리와 광배근 동시 이완.' }],
        },
        {
          name: '③ 가슴·어깨 앞쪽 스트레칭',
          meta: '30초 | 푸시업 후',
          details: [{ type: 'purple', text: '양손 등 뒤에서 깍지 끼고 가슴 앞으로 내밀기. 30초 유지.' }],
        },
        {
          name: '④ 누워서 햄스트링 스트레칭',
          meta: '좌우 각 30초',
          details: [{ type: 'purple', text: '누워서 한 다리 들어 허벅지 뒤를 잡고 당깁니다. 30초.' }],
        },
        {
          name: '⑤ 힙 플렉서 스트레칭',
          meta: '좌우 각 30초 | 슬라이딩보드 후',
          details: [{ type: 'purple', text: '런지 자세에서 뒤 무릎 바닥에 내리고 골반 앞으로 밀어 넣기. 30초.' }],
        },
        {
          name: '⑥ 광배근·옆구리 스트레칭',
          meta: '좌우 각 20초 | 밴드 로우 후',
          details: [{ type: 'purple', text: '팔 위로 뻗고 반대쪽 손으로 손목 잡아 옆으로 기울이기. 20초.' }],
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────
// Saturday — 유산소 전용
// ─────────────────────────────────────────
const saturdayWorkout: DayWorkout = {
  id: 'sat',
  tabLabel: '토요일',
  emoji: '🔥',
  title: '토요일 — 유산소 전용',
  subtitle: '슬라이딩보드 집중 · 하체 중심 마무리',
  totalTime: '총 약 50분',
  badgeBg: '#EF9F27',
  dayColor: '#854F0B',
  flow: [
    { icon: '🧘', label: '준비운동', time: '5분', bgColor: '#EEEDFE', labelColor: '#3C3489', timeColor: '#534AB7' },
    { icon: '🔥', label: '슬라이딩보드', time: '30~40분', bgColor: '#FAEEDA', labelColor: '#633806', timeColor: '#854F0B' },
    { icon: '🌿', label: '마무리 스트레칭', time: '8~10분', bgColor: '#EAF3DE', labelColor: '#27500A', timeColor: '#3B6D11' },
  ],
  phases: [
    {
      id: 'warmup',
      icon: '🧘',
      title: '준비운동 (간단 버전)',
      subtitle: '5분 · 4가지만 수행',
      alert: { variant: 'blue', text: '💡 근력 운동이 없으므로 준비운동을 5분 간단 버전으로 진행합니다. 대신 마무리 스트레칭은 평소보다 길게.' },
      exercises: [
        {
          name: '① 제자리 걷기',
          meta: '2분',
          details: [{ type: 'purple', text: '팔을 크게 흔들며 2분. 슬라이딩보드 전 심박수를 서서히 올립니다.' }],
        },
        {
          name: '② 고양이-소 자세',
          meta: '8회 | 토요일도 생략 불가',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '천천히 8회. 슬라이딩보드 중 허리 중립을 유지하려면 척추가 이완되어 있어야 합니다.' }],
        },
        {
          name: '③ 어깨 돌리기',
          meta: '앞/뒤 각 10회',
          details: [{ type: 'purple', text: '슬라이딩보드 팔 동작 전 어깨 관절을 풀어줍니다.' }],
        },
        {
          name: '④ 루프밴드 사이드 스텝',
          meta: '좌우 각 10회 | 무릎·둔근 활성화',
          details: [{ type: 'purple', text: '슬라이딩보드의 옆으로 미끄러지는 동작과 비슷한 움직임으로 무릎과 고관절을 미리 준비시킵니다.' }],
        },
      ],
    },
    {
      id: 'sliding',
      icon: '🔥',
      title: '슬라이딩보드',
      subtitle: '오늘 목표: 30~40분 — 주중 최장 세션',
      todaySliding: { time: '30~40분', note: '근력 운동 없음 → 여력이 있어 가장 길게 탈 수 있는 날' },
      exercises: [
        {
          name: '기본 자세 + 발·팔 동작',
          meta: '토요일: 근력 운동 없어 컨디션이 가장 좋은 날',
          badge: { label: '동작', variant: 'yellow' },
          details: [
            { type: 'purple', text: '**무릎:** 살짝 구부림(20~30도) 유지. **상체:** 10~15도 기울이기. **시선:** 정면.' },
            { type: 'purple', text: '발: 범퍼를 옆으로 지긋이 밀어내며 미끄러지기. 바닥에 붙인 채 미끄러지기.' },
            { type: 'purple', text: '팔: 미끄러지는 반대쪽 팔을 앞으로. 오늘 근력 운동이 없으므로 팔을 적극적으로 사용합니다.' },
            { type: 'purple', text: '호흡: 밀어낼 때 내쉬기. 말을 할 수 있는 강도 유지.' },
            { type: 'green', text: '컨디션이 안 좋으면 야외 빠른 걷기 30~40분으로 대체 가능합니다.' },
          ],
        },
        {
          name: '주차별 인터벌 계획 (토요일 확장 버전)',
          meta: '같은 주차 기준에서 5~10분 더 길게 수행',
          badge: { label: '진행표', variant: 'green' },
          details: [{ type: 'purple', text: '토요일은 다른 요일보다 5~10분 더 길게 수행합니다. 오늘이 주간 유산소의 핵심입니다.' }],
          intervals: satIntervals,
        },
        {
          name: '흔한 실수 & 교정',
          badge: { label: '주의', variant: 'red' },
          details: [
            { type: 'warn', text: '❌ 무릎 완전히 펴기 → 항상 살짝 구부리기' },
            { type: 'warn', text: '❌ 허리 너무 숙이기 → 10~15도 이내' },
            { type: 'warn', text: '❌ 오늘 길다고 처음부터 빠르게 → 천천히 시작해서 점진적으로 강도 올리기' },
            { type: 'good', text: '✅ 오늘 목표: 30~40분 완주. 강도보다 시간 채우기 우선.' },
          ],
        },
      ],
    },
    {
      id: 'cooldown',
      icon: '🌿',
      title: '마무리 스트레칭 (확장 버전)',
      subtitle: '8~10분 · 각 동작 10~20초 더 길게',
      exercises: [
        {
          name: '① 고양이-소 (느린 버전)',
          meta: '8회 | 오늘 더 많이 · 1회당 8~10초',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '오늘 슬라이딩보드를 가장 오래 탔으므로 평소보다 더 천천히, 더 깊게.' }],
        },
        {
          name: '② 차일드 포즈',
          meta: '60초 | 오늘 더 길게',
          badge: { label: '디스크', variant: 'yellow' },
          details: [{ type: 'purple', text: '양팔 앞으로 뻗으며 상체를 바닥으로. 60초 충분히 유지.' }],
        },
        {
          name: '③ 누워서 햄스트링 스트레칭',
          meta: '좌우 각 40~50초 | 오늘 가장 중요 · 평소보다 길게',
          badge: { label: '오늘 중점', variant: 'purple' },
          details: [{ type: 'purple', text: '누워서 한 다리를 들어 허벅지 뒤를 손으로 잡고 몸 쪽으로 당깁니다. 40~50초 유지.' }],
        },
        {
          name: '④ 누워서 둔근 스트레칭',
          meta: '좌우 각 40~50초 | 오늘 더 길게',
          badge: { label: '오늘 중점', variant: 'purple' },
          details: [{ type: 'purple', text: '누워서 숫자 4 모양. 반대 허벅지를 잡아 당깁니다. 40~50초 유지.' }],
        },
        {
          name: '⑤ 힙 플렉서 스트레칭',
          meta: '좌우 각 40~50초 | 오늘 더 길게',
          badge: { label: '오늘 중점', variant: 'purple' },
          details: [{ type: 'purple', text: '런지 자세에서 뒤 무릎을 바닥에 내리고 골반을 앞으로. 슬라이딩보드 후 고관절이 많이 굳어 있습니다.' }],
        },
        {
          name: '⑥ 폼롤러 마사지 (추가 권장)',
          meta: '종아리 → 햄스트링 → 둔근 → 등 상부',
          details: [{ type: 'purple', text: '각 부위 30~60초씩. 허리(요추) 직접 굴리기는 금지. 오늘이 주중 가장 피로한 날이므로 폼롤러를 더 챙겨주세요.' }],
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────
// Export All
// ─────────────────────────────────────────
export const WORKOUTS: DayWorkout[] = [
  mondayWorkout,
  tuesdayWorkout,
  thursdayWorkout,
  fridayWorkout,
  saturdayWorkout,
];

export const WEEK_OVERVIEW = {
  stats: [
    { label: '현재 체중', value: '83', unit: 'kg', sub: '목표 65~69kg' },
    { label: '운동일', value: '5', unit: '일', sub: '월·화·목·금·토' },
    { label: '유산소', value: '4–5', unit: '일', sub: '주 115~125분' },
    { label: '쉬는 날', value: '2', unit: '일', sub: '수 · 일' },
  ],
  days: [
    { day: '월', emoji: '💪', label: '상체 Push', sub: '슬보 20분', time: '약 70분', active: true, color: '#534AB7', bg: '#EEEDFE', border: '#AFA9EC', tabId: 'mon' },
    { day: '화', emoji: '🦵', label: '하체 · 코어', sub: '슬보 20분', time: '약 65분', active: true, color: '#0F6E56', bg: '#E1F5EE', border: '#9FE1CB', tabId: 'tue' },
    { day: '수', emoji: '📅', label: '스케줄', sub: '완전 휴식', time: '휴식', active: false, color: '', bg: '', border: '', tabId: '' },
    { day: '목', emoji: '🔝', label: '상체 Pull', sub: '슬보 20분', time: '약 70분', active: true, color: '#534AB7', bg: '#EEEDFE', border: '#AFA9EC', tabId: 'thu' },
    { day: '금', emoji: '⚡', label: '전신 서킷', sub: '슬보 25분', time: '약 70분', active: true, color: '#0F6E56', bg: '#E1F5EE', border: '#9FE1CB', tabId: 'fri' },
    { day: '토', emoji: '🔥', label: '유산소 전용', sub: '슬보 35분', time: '약 50분', active: true, color: '#854F0B', bg: '#FAEEDA', border: '#FAC775', tabId: 'sat' },
    { day: '일', emoji: '😴', label: '완전 휴식', sub: '폼롤러 가능', time: '휴식', active: false, color: '', bg: '', border: '', tabId: '' },
  ],
  dayTimes: [
    { days: '월 · 목', total: '약 70분', detail: '준비 10분\n근력 35분\n슬보 20분\n스트레칭 5분', color: '#534AB7', border: '#AFA9EC' },
    { days: '화', total: '약 65분', detail: '준비 10분\n근력 30분\n슬보 20분\n스트레칭 5분', color: '#0F6E56', border: '#9FE1CB' },
    { days: '금', total: '약 70분', detail: '준비 10분\n서킷 30분\n슬보 25분\n스트레칭 5분', color: '#0F6E56', border: '#9FE1CB' },
    { days: '토', total: '약 50분', detail: '준비 5분\n슬보 35분\n스트레칭 10분', color: '#854F0B', border: '#FAC775' },
    { days: '수 · 일', total: '휴식', detail: '완전 휴식\n폼롤러 가능', color: '', border: '' },
  ],
};

export const DIET = {
  meals: [
    {
      label: '아침',
      bg: '#FAEEDA',
      color: '#854F0B',
      items: [
        { icon: '🥚', text: '달걀 2개 + 밥 반 공기 + 김치·나물. 가능하면 잡곡밥.' },
        { icon: '🚫', text: '아침 굶기 금지 — 점심·저녁 폭식 위험.' },
      ],
    },
    {
      label: '점심 (평일)',
      bg: '#E1F5EE',
      color: '#0F6E56',
      items: [{ icon: '🍗', text: '닭가슴살 150~200g + 밥 평소보다 20~30% 줄이기 + 채소. 식전 물 500ml.' }],
    },
    {
      label: '저녁 (매일)',
      bg: '#EEEDFE',
      color: '#534AB7',
      items: [
        { icon: '🍚', text: '밥 반~2/3공기 + 단백질 반찬 1가지 이상 + 채소. 단백질 먼저 먹기.' },
        { icon: '🌙', text: '취침 2시간 전 음식 금지.' },
      ],
    },
    {
      label: '주말',
      bg: '#EAF3DE',
      color: '#27500A',
      items: [{ icon: '😌', text: '배 불러서 더 못 먹겠다 직전에 멈추기. 주말 중 한 끼는 단백질 반찬 포함.' }],
    },
  ],
};

export const SAFETY = {
  forbidden: '절대 금지: 윗몸일으키기 · 레그레이즈 · 무거운 데드리프트 · 깊은 바벨 스쿼트 · 허리 비틀기 복근 운동 · 점프 스쿼트 · 버피 · 무리한 AB 슬라이더',
  signals: [
    { label: '허리 찌릿함', action: '즉시 중단 → 차일드 포즈 이완 → 다음 날 확인', bg: '#FCEBEB', labelColor: '#A32D2D', textColor: '#791F1F' },
    { label: '다리 저림·찌릿함', action: '즉시 중단 → 2~3일 지속 시 병원', bg: '#FCEBEB', labelColor: '#A32D2D', textColor: '#791F1F' },
    { label: '다음 날 허리 통증', action: '해당 운동 제외 → 안전한 대안으로 교체', bg: '#FAEEDA', labelColor: '#854F0B', textColor: '#633806' },
    { label: '근육통', action: '정상 — 마무리 스트레칭 + 폼롤러 후 계속', bg: '#EAF3DE', labelColor: '#3B6D11', textColor: '#27500A' },
  ],
  cpap: '😮‍💨 CPAP 꾸준한 사용이 체중 감량 성공의 숨겨진 핵심입니다. 수면무호흡 → 코티솔 증가 → 복부 지방 축적의 악순환을 끊어줍니다.',
};
