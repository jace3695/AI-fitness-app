export type BadgeVariant = "yellow" | "green" | "blue" | "purple" | "red";
export type PhaseType = "warmup" | "main" | "sliding" | "cooldown";
export type AlertType = "yellow" | "green" | "blue" | "purple";
export type BulletType = "purple" | "red" | "green";
export type AdaptationRoutineSelection = "adapt1" | "adapt2" | "adapt3";
export type RoutineSelection = AdaptationRoutineSelection | "base" | "recovery";
export type SwitchOnSelection = Exclude<RoutineSelection, "recovery">;

export interface Detail {
  type: BulletType | "step" | "warn" | "good" | "text";
  text: string;
  stepNum?: number;
}
export interface IntervalRow {
  weeks: string;
  pattern: string;
  total: string;
}
export interface IntervalSegment {
  label: string;
  seconds: number;
  intensity: string;
}
export interface IntervalPlan {
  rounds?: number;
  segments: IntervalSegment[];
}
export interface ExerciseGuide {
  setup: string[];
  movement: string[];
  breathing?: string;
  target?: string;
  commonMistakes: string[];
  stopCriteria: string[];
  keyPoint?: string;
  videoUrl?: string;
  videoSearchQuery?: string;
}
export interface Exercise {
  name: string;
  meta?: string;
  badge?: { label: string; variant: BadgeVariant };
  details: Detail[];
  guide?: ExerciseGuide;
  intervals?: IntervalRow[];
  intervalNote?: string;
  sets?: number;
  restSeconds?: number;
  intervalPlan?: IntervalPlan;
  abSlideGate?: boolean;
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

export const SWITCHON_DEFAULT_START_DATE = "2026-06-22";
export const SWITCHON_START_DATE_KEY = "ai-fitness-switchon-start-date";
export const SWITCHON_MODE_KEY = "ai-fitness-switchon-mode";
export const WORKOUT_ROUTINE_SELECTION_KEY =
  "ai-fitness-workout-routine-selection";
export const SET_COMPLETION_KEY = "ai-fitness-switchon-set-completions";
export const AB_SLIDE_KEY = "ai-fitness-switchon-ab-slide-checks";
export const COMMON_INTENSITY = [
  "가볍게: 대화 가능",
  "중간: 짧은 문장은 가능하지만 숨이 참",
  "강하게: 긴 대화가 어려울 정도로 숨이 참. 단, 자세는 유지",
];

const youtubeSearchUrl = (query: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

const GUIDE_LIBRARY: Record<string, ExerciseGuide> = {
  "관절 가동성 + 가벼운 제자리 걷기": {
    setup: [
      "편하게 서서 발은 골반 너비로 둔다.",
      "허리를 과하게 젖히지 않고 배에 가볍게 힘을 준다.",
    ],
    movement: [
      "목 좌우 천천히 돌리기",
      "어깨 앞뒤 돌리기",
      "팔 크게 원 그리기",
      "골반 가볍게 돌리기",
      "발목 돌리기",
      "제자리 걷기",
    ],
    breathing: "숨을 참지 않고 편하게 유지한다.",
    target: "목·어깨·골반·발목 가동성, 가벼운 심박 상승",
    commonMistakes: [
      "목을 빠르게 돌림",
      "허리를 크게 젖힘",
      "통증이 있는 관절을 억지로 끝 범위까지 움직임",
    ],
    stopCriteria: ["어지러움", "목 통증", "허리 통증", "무릎 통증"],
    keyPoint:
      "관절을 끝까지 밀어붙이지 말고 통증 없는 범위에서 천천히 몸을 깨운다.",
    videoUrl:
      "https://www.youtube.com/results?search_query=5%EB%B6%84+%EC%A0%84%EC%8B%A0+%EA%B4%80%EC%A0%88+%EA%B0%80%EB%8F%99%EC%84%B1+%EC%9B%8C%EB%B0%8D%EC%97%85",
  },
  "호흡 정리 + 하체/등 스트레칭": {
    setup: [
      "천천히 걷거나 제자리에서 호흡 정리 1분으로 시작한다.",
      "반동 없이 통증이 아닌 당김 범위까지만 늘릴 준비를 한다.",
      "각 자세는 15~30초 정도 유지한다.",
    ],
    movement: [
      "종아리 스트레칭",
      "허벅지 뒤쪽 스트레칭",
      "엉덩이 스트레칭",
      "광배근 / 등 옆 스트레칭",
      "가슴 열기 스트레칭",
      "숨을 길게 내쉬며 긴장을 낮춘다.",
    ],
    breathing: "숨을 길게 내쉬고, 자세를 바꿀 때도 숨을 참지 않는다.",
    target: "종아리, 햄스트링, 엉덩이, 등 옆, 가슴, 호흡 안정",
    commonMistakes: [
      "반동을 주며 늘림",
      "통증을 참으며 깊게 누름",
      "허리를 꺾은 채 스트레칭함",
      "숨을 참고 버팀",
    ],
    stopCriteria: ["저림", "날카로운 통증", "허리 통증 증가", "어지러움"],
    keyPoint:
      "마무리는 강한 운동이 아니라 호흡을 낮추고 당김 범위만 유지하는 시간이다.",
    videoUrl:
      "https://www.youtube.com/results?search_query=5%EB%B6%84+%EC%A0%84%EC%8B%A0+%EC%BF%A8%EB%8B%A4%EC%9A%B4+%EC%8A%A4%ED%8A%B8%EB%A0%88%EC%B9%AD",
  },
  슬라이딩보드: {
    setup: [
      "발을 양쪽 패드에 올린다.",
      "무릎을 살짝 굽히고 엉덩이를 약간 뒤로 보낸다.",
      "상체는 너무 숙이지 않고 허리 중립을 유지한다.",
    ],
    movement: [
      "한쪽 다리로 옆 방향으로 밀고 반대쪽 다리가 따라오게 한다.",
      "점프하지 말고 스케이트 타듯 미끄러진다.",
      "속도보다 엉덩이와 다리로 밀어내는 자세를 우선한다.",
    ],
    breathing:
      "묵주기도를 이어갈 수 있을 정도로 자연스럽게 유지하고 숨을 참지 않는다.",
    target:
      "묵주기도 5단, 저강도 유산소, 체온 올리기, 운동 전 몸 깨우기, 감량 보조, 식욕 조절",
    commonMistakes: [
      "허리를 과하게 숙임",
      "무릎이 안쪽으로 모임",
      "발이 패드에서 들림",
      "기도가 끊길 정도로 빠르게 진행함",
      "상체 반동으로 속도를 냄",
    ],
    stopCriteria: [
      "허리 통증",
      "무릎의 날카로운 통증",
      "다리 저림",
      "어지러움",
    ],
    keyPoint:
      "운동 전 20분은 저강도 유산소 기준입니다. 묵주기도를 이어갈 수 있고 균형이 흔들리지 않는 가벼운 속도를 우선합니다.",
    videoUrl: "https://www.youtube.com/watch?v=YHEJeqRnmzc",
    videoSearchQuery: "슬라이딩보드 초보 자세",
  },
  "롱밴드 랫풀다운": {
    setup: [
      "롱밴드를 문틀 철봉 중앙에 단단히 고정한다.",
      "무릎을 꿇거나 앉아서 양손으로 밴드를 잡고 팔을 위로 뻗는다.",
    ],
    movement: [
      "팔꿈치를 아래·뒤 방향으로 끌어내린다.",
      "밴드는 쇄골 또는 윗가슴 높이까지 당긴다.",
      "천천히 시작 자세로 돌아간다.",
    ],
    breathing: "당길 때 내쉬고, 돌아갈 때 들이쉰다.",
    target: "겨드랑이 아래쪽과 등 옆쪽",
    commonMistakes: [
      "어깨가 귀 쪽으로 올라감",
      "허리를 과하게 젖혀 반동 사용",
      "팔 힘만으로 당김",
    ],
    stopCriteria: ["어깨 통증", "팔 저림", "허리 통증"],
    keyPoint: "팔보다 팔꿈치를 아래로 내리며 등을 먼저 쓴다. 밴드는 반동으로 당기지 말고 천천히 조절하며, 어깨가 귀 쪽으로 올라가지 않게 하고, 허리를 젖히거나 꺾지 마세요. 통증이 있으면 밴드 장력을 낮춥니다.",
    videoUrl: "https://www.youtube.com/watch?v=84D8bVJWB3s",
    videoSearchQuery: "롱밴드 랫풀다운 자세",
  },
  "밴드 로우": {
    setup: [
      "밴드를 배꼽 또는 가슴 아래 높이의 단단한 고정점에 연결한다.",
      "팔을 편 상태에서 시작한다.",
      "가슴을 가볍게 열고 허리 중립을 유지한다.",
    ],
    movement: [
      "팔꿈치를 뒤로 끌어당긴다.",
      "마지막에 날개뼈를 가볍게 모은다.",
      "천천히 원위치한다.",
    ],
    breathing: "당길 때 내쉬고 돌아갈 때 들이쉰다.",
    target: "등 중앙과 날개뼈 주변",
    commonMistakes: [
      "허리를 뒤로 젖혀 반동 사용",
      "어깨가 올라감",
      "팔만 사용하고 등이 움직이지 않음",
    ],
    stopCriteria: ["허리 통증", "어깨 앞쪽 통증", "팔 저림"],
    keyPoint: "허리는 고정하고 팔꿈치가 몸 뒤로 간다는 느낌으로 당긴다. 밴드는 반동으로 당기지 말고 천천히 조절하며, 어깨가 귀 쪽으로 올라가지 않게 하고, 허리를 젖히거나 꺾지 마세요. 통증이 있으면 밴드 장력을 낮춥니다.",
    videoSearchQuery: "롱밴드 로우 자세",
  },
  "덤벨 플로어 프레스": {
    setup: [
      "바닥에 누워 무릎을 세운다.",
      "덤벨을 가슴 옆에 둔다.",
      "팔꿈치는 몸통에서 약 45도 정도 벌린다.",
    ],
    movement: [
      "덤벨을 가슴 위로 밀어 올린다.",
      "천천히 내린다.",
      "팔꿈치가 바닥에 닿으면 멈춘다.",
    ],
    breathing: "밀 때 내쉬고 내릴 때 들이쉰다.",
    target: "가슴, 삼두, 어깨 앞쪽",
    commonMistakes: [
      "허리가 과하게 뜸",
      "팔꿈치를 90도로 너무 벌림",
      "덤벨을 급하게 내림",
    ],
    stopCriteria: ["어깨 통증", "팔꿈치 통증", "허리 불편감"],
    keyPoint: "팔꿈치를 45도로 두고 바닥에서 멈춰 어깨 부담을 줄인다.",
    videoUrl: "https://www.youtube.com/watch?v=uUGDRwge4F8",
    videoSearchQuery: "덤벨 플로어 프레스 자세",
  },
  "밴드 풀어파트": {
    setup: [
      "가슴 높이에서 밴드를 양손으로 잡는다.",
      "팔꿈치는 거의 펴되 완전히 잠그지 않는다.",
      "어깨를 귀에서 멀리 내린다.",
    ],
    movement: [
      "양손을 좌우로 벌려 밴드를 당긴다.",
      "등 위쪽과 어깨 뒤쪽이 조여지는 지점에서 멈춘다.",
      "천천히 돌아온다.",
    ],
    breathing: "벌릴 때 내쉬고 돌아올 때 들이쉰다.",
    target: "등 위쪽과 어깨 뒤쪽",
    commonMistakes: [
      "허리를 젖힘",
      "어깨를 으쓱함",
      "팔을 너무 뒤로 과하게 보냄",
    ],
    stopCriteria: ["어깨 통증", "목 통증", "팔 저림"],
    keyPoint: "어깨를 내리고 등 위쪽으로 밴드를 벌린다. 밴드는 반동으로 당기지 말고 천천히 조절하며, 어깨가 귀 쪽으로 올라가지 않게 하고, 허리를 젖히거나 꺾지 마세요. 통증이 있으면 밴드 장력을 낮춥니다.",
    videoSearchQuery: "밴드 풀어파트 자세",
  },
  "발 보조 매달리기": {
    setup: [
      "철봉을 잡고 발끝은 바닥 또는 의자에 둔다.",
      "체중 전부를 철봉에 싣지 않는다.",
      "어깨를 귀에서 멀리 둔다.",
    ],
    movement: [
      "발로 일부 체중을 지지한 상태에서 가볍게 매달린다.",
      "어깨를 귀에서 멀리 내리는 느낌으로 버틴다.",
      "시간이 끝나면 발로 먼저 체중을 받아 천천히 내려온다.",
    ],
    breathing: "짧고 편안하게 호흡한다.",
    target: "등, 전완, 어깨 안정성",
    commonMistakes: [
      "갑자기 전 체중을 매달기",
      "어깨를 으쓱한 채 버티기",
      "통증을 참고 지속하기",
    ],
    stopCriteria: ["어깨 통증", "팔 저림", "목 통증", "허리 불편감"],
    keyPoint: "발 보조를 유지해 어깨가 편한 범위에서만 버틴다.",
    videoSearchQuery: "철봉 보조 매달리기 자세",
  },
  "덤벨 고블릿 스쿼트": {
    setup: [
      "덤벨 하나를 양손으로 가슴 앞에 잡습니다.",
      "발은 어깨너비 정도로 벌리고 발끝은 약간 바깥쪽을 향하게 합니다.",
      "허리는 중립을 유지하고 복부에 힘을 줍니다.",
    ],
    movement: [
      "엉덩이를 뒤로 살짝 빼며 천천히 앉습니다.",
      "무릎은 발끝 방향으로 움직입니다.",
      "허리가 말리기 전 범위까지만 내려갑니다.",
      "발바닥 전체로 바닥을 밀며 일어섭니다.",
    ],
    breathing: "내려갈 때 들이쉬고, 일어설 때 숨을 내쉽니다. 숨을 참지 마세요.",
    target: "하체 근력, 엉덩이, 허벅지, 코어 안정성 강화",
    commonMistakes: ["허리가 말릴 정도로 깊게 앉음", "무릎이 안쪽으로 모임", "뒤꿈치가 들림", "통증을 참고 반복함"],
    stopCriteria: ["허리 통증", "날카로운 무릎 통증", "다리 저림", "어지러움"],
    keyPoint: "5~7kg부터 시작하고 허리가 말리면 깊이를 줄이세요. 통증이 있으면 집 의자에 살짝 앉았다 일어나는 의자 스쿼트로 대체하세요.",
    videoSearchQuery: "덤벨 고블릿 스쿼트 자세 초보",
  },
  "고블릿 스쿼트": {
    setup: [
      "덤벨을 가슴 앞에 세로로 잡는다.",
      "발바닥 전체가 바닥에 닿게 선다.",
      "배에 가볍게 힘을 준다.",
    ],
    movement: [
      "엉덩이를 뒤로 보내며 앉는다.",
      "무릎은 발끝 방향을 따라간다.",
      "허리 중립을 유지한다.",
      "일어날 때 발바닥 전체로 바닥을 민다.",
    ],
    breathing: "내려갈 때 들이쉬고 일어날 때 내쉰다.",
    target: "허벅지 앞쪽, 엉덩이",
    commonMistakes: ["허리가 말림", "무릎이 안쪽으로 무너짐", "뒤꿈치가 들림"],
    stopCriteria: ["허리 통증", "날카로운 무릎 통증", "어지러움"],
    keyPoint: "무릎은 발끝 방향, 허리는 중립을 유지한다.",
    videoSearchQuery: "고블릿 스쿼트 자세",
  },
  "힙 브릿지": {
    setup: [
      "무릎을 세우고 눕는다.",
      "발은 골반 너비로 둔다.",
      "갈비뼈가 들리지 않게 배에 힘을 준다.",
    ],
    movement: [
      "엉덩이에 힘을 주며 들어올린다.",
      "갈비뼈를 과하게 들지 않는다.",
      "허리로 밀지 않는다.",
      "엉덩이 수축을 먼저 느낀다.",
    ],
    breathing: "올릴 때 내쉬고 내릴 때 들이쉰다.",
    target: "엉덩이와 햄스트링",
    commonMistakes: [
      "허리로 밀어 올림",
      "갈비뼈가 들림",
      "무릎이 안쪽으로 모임",
    ],
    stopCriteria: ["허리 통증", "다리 저림", "햄스트링 경련"],
    keyPoint: "허리가 아니라 엉덩이를 조여 골반을 들어올린다.",
    videoSearchQuery: "힙 브릿지 자세",
  },
  "루프밴드 사이드 워크": {
    setup: [
      "루프밴드를 무릎 위 또는 발목 위에 건다.",
      "발은 골반 너비, 무릎은 살짝 굽힌다.",
      "엉덩이를 조금 뒤로 보내고 허리 중립을 유지한다.",
    ],
    movement: [
      "밴드 장력을 유지하며 옆으로 한 걸음 이동한다.",
      "반대발은 끌지 말고 천천히 따라온다.",
      "정해진 걸음 수 후 반대 방향으로 반복한다.",
    ],
    breathing: "걸을 때마다 편하게 내쉬고 숨을 참지 않는다.",
    target: "중둔근, 엉덩이 옆, 무릎 안정성",
    commonMistakes: [
      "무릎이 안쪽으로 모임",
      "상체가 좌우로 흔들림",
      "보폭을 너무 크게 가져감",
    ],
    stopCriteria: ["무릎 통증", "허리 통증", "고관절 찝힘", "어지러움"],
    keyPoint: "작은 보폭으로 밴드 장력을 유지하고 골반 높이를 일정하게 둔다. 밴드는 반동으로 당기지 말고 천천히 조절하며, 어깨가 귀 쪽으로 올라가지 않게 하고, 허리를 젖히거나 꺾지 마세요. 통증이 있으면 밴드 장력을 낮춥니다.",
    videoSearchQuery: "밴드 사이드 워크 자세",
  },
  "루프밴드 몬스터 워크": {
    setup: [
      "루프밴드를 무릎 위 또는 발목 위에 건다.",
      "무릎을 살짝 굽히고 발끝은 정면 또는 약간 바깥을 향한다.",
      "배에 힘을 주고 허리 중립을 유지한다.",
    ],
    movement: [
      "대각선 앞쪽으로 작게 걸으며 밴드 장력을 유지한다.",
      "뒤로 돌아올 때도 무릎이 안쪽으로 모이지 않게 한다.",
      "속도보다 균형과 엉덩이 자극을 우선한다.",
    ],
    breathing: "이동할 때 편하게 내쉬고 돌아올 때 들이쉰다.",
    target: "엉덩이 옆, 둔근, 하체 안정성",
    commonMistakes: [
      "상체를 크게 흔듦",
      "무릎이 안쪽으로 무너짐",
      "발을 끌어서 밴드 장력이 풀림",
    ],
    stopCriteria: ["무릎 통증", "허리 통증", "고관절 통증", "균형 상실"],
    keyPoint: "작은 대각선 걸음으로 엉덩이 옆 힘을 계속 유지한다. 밴드는 반동으로 당기지 말고 천천히 조절하며, 어깨가 귀 쪽으로 올라가지 않게 하고, 허리를 젖히거나 꺾지 마세요. 통증이 있으면 밴드 장력을 낮춥니다.",
    videoSearchQuery: "밴드 몬스터 워크 자세",
  },
  "롱밴드 페이스풀": {
    setup: [
      "밴드를 얼굴 또는 눈높이의 단단한 고정점에 연결한다.",
      "양손으로 밴드를 잡고 한두 걸음 물러선다.",
      "갈비뼈를 내리고 어깨를 편하게 둔다.",
    ],
    movement: [
      "손을 얼굴 옆으로 당기며 팔꿈치를 바깥으로 벌린다.",
      "어깨 뒤쪽과 등 위쪽을 조인 뒤 잠깐 멈춘다.",
      "밴드 장력을 유지하며 천천히 돌아간다.",
    ],
    breathing: "당길 때 내쉬고 돌아갈 때 들이쉰다.",
    target: "어깨 뒤쪽, 등 위쪽, 견갑 안정성",
    commonMistakes: [
      "허리를 젖혀 당김",
      "어깨를 으쓱함",
      "목에 힘이 과하게 들어감",
    ],
    stopCriteria: ["어깨 통증", "목 통증", "팔 저림", "허리 통증"],
    keyPoint: "얼굴 쪽으로 당기되 목이 아니라 어깨 뒤쪽과 등 위쪽을 쓴다. 밴드는 반동으로 당기지 말고 천천히 조절하며, 어깨가 귀 쪽으로 올라가지 않게 하고, 허리를 젖히거나 꺾지 마세요. 통증이 있으면 밴드 장력을 낮춥니다.",
    videoSearchQuery: "밴드 페이스풀 자세",
  },
  "의자/테이블 지지 원암 덤벨 로우": {
    setup: [
      "튼튼한 의자 등받이, 식탁, 책상 가장자리 중 하나를 손으로 짚습니다.",
      "운동하는 쪽 손에 덤벨을 들고 양발은 앞뒤로 벌려 균형을 잡습니다.",
      "허리는 둥글게 말거나 과하게 젖히지 않고 중립을 유지합니다.",
      "상체는 살짝 숙이되, 허리가 불편하면 숙이는 각도를 줄입니다.",
    ],
    movement: [
      "덤벨을 아래로 늘어뜨립니다.",
      "팔꿈치를 몸통 옆으로 당기며 덤벨을 옆구리 쪽으로 끌어올립니다.",
      "어깨가 귀 쪽으로 올라가지 않게 합니다.",
      "날개뼈를 등 가운데로 살짝 모은다는 느낌으로 당깁니다.",
      "천천히 내려옵니다.",
    ],
    breathing: "끌어올릴 때 내쉬고, 천천히 내릴 때 들이쉽니다.",
    target: "등, 광배근, 날개뼈 주변 근육 강화",
    commonMistakes: ["상체를 너무 숙임", "반동으로 당김", "목과 어깨에 힘이 들어감", "불안정한 받침대를 사용함"],
    stopCriteria: ["허리 불편감", "다리 저림", "어깨 통증", "받침대 흔들림"],
    keyPoint: "집에서 안정적으로 짚을 곳이 없다면 원암 덤벨 로우 대신 밴드 로우를 선택하세요. 허리 부담이 있는 날은 덤벨 로우보다 밴드 로우가 더 안전합니다. 대체 1: 밴드 로우 · 대체 2: 롱밴드 랫풀다운 · 양손 덤벨 로우는 초반 비추천.",
    videoSearchQuery: "의자 지지 원암 덤벨 로우 자세 초보",
  },
  "팔로프 프레스": {
    setup: [
      "밴드는 옆 방향으로 당겨도 풀리지 않는 단단한 고정점에 연결한다.",
      "밴드가 몸 옆에서 당기는 위치에 선다.",
      "무릎을 살짝 굽히고 배에 힘을 준다.",
    ],
    movement: [
      "손을 가슴 앞에 모은다.",
      "몸통이 밴드 쪽으로 돌아가지 않도록 앞으로 밀어낸다.",
      "잠깐 멈춘 뒤 천천히 가슴 앞으로 돌아온다.",
    ],
    breathing: "밀 때 내쉬고 돌아올 때 들이쉰다.",
    target: "복부 옆면과 몸통 안정성",
    commonMistakes: [
      "약한 고정점에 밴드를 연결함",
      "몸통이 밴드 쪽으로 돌아감",
      "허리가 꺾임",
    ],
    stopCriteria: ["허리 통증", "어깨 통증", "어지러움"],
    keyPoint: "절대 풀리지 않는 옆 방향 고정점을 먼저 확인한다.",
    videoSearchQuery: "팔로프 프레스 밴드 자세",
  },
  버드독: {
    setup: [
      "네발기기 자세를 만든다.",
      "손은 어깨 아래, 무릎은 골반 아래에 둔다.",
      "허리는 중립을 유지한다.",
    ],
    movement: [
      "반대쪽 팔과 다리를 천천히 뻗는다.",
      "골반이 돌아가지 않게 유지한다.",
      "천천히 돌아온 뒤 반대쪽 진행한다.",
    ],
    breathing: "뻗을 때 내쉬고 돌아올 때 들이쉰다.",
    target: "코어 안정성, 엉덩이, 등",
    commonMistakes: [
      "허리가 꺼짐",
      "다리를 너무 높이 듦",
      "골반이 옆으로 돌아감",
      "속도를 너무 빠르게 냄",
    ],
    stopCriteria: ["허리 통증", "다리 저림", "균형이 무너져 반복 유지 불가"],
    keyPoint: "높이보다 골반과 허리가 흔들리지 않는 것이 우선이다.",
    videoUrl: "https://www.youtube.com/watch?v=xEDnlOxeJH4",
    videoSearchQuery: "버드독 자세",
  },
  "보조 리버스 런지": {
    setup: [
      "벽, 의자 또는 단단한 지지대를 잡는다.",
      "발은 골반 너비로 선다.",
      "몸통을 세우고 배에 힘을 준다.",
    ],
    movement: [
      "한쪽 다리를 뒤로 짧게 보낸다.",
      "앞쪽 무릎이 안쪽으로 무너지지 않게 한다.",
      "통증 없는 범위까지만 내려간다.",
      "앞발로 바닥을 밀어 시작 자세로 돌아온다.",
    ],
    breathing: "내려갈 때 들이쉬고 올라올 때 내쉰다.",
    target: "엉덩이, 허벅지 앞쪽, 균형감각",
    commonMistakes: [
      "뒤로 너무 멀리 보냄",
      "앞 무릎이 안쪽으로 무너짐",
      "통증을 참고 깊게 내려감",
    ],
    stopCriteria: ["날카로운 무릎 통증", "허리 통증", "어지러움"],
    keyPoint: "지지대를 잡고 짧은 범위부터 안정적으로 반복한다.",
    videoSearchQuery: "리버스 런지 초보 자세",
  },
  "AB 슬라이더 준비 자세": {
    setup: [
      "무릎을 바닥에 댄다.",
      "배와 엉덩이에 힘을 준다.",
      "어깨 아래에 손잡이 또는 롤러를 둔다.",
    ],
    movement: [
      "짧은 범위만 앞으로 민다.",
      "허리가 꺼지지 않게 한다.",
      "통증 또는 허리 꺼짐이 생기면 즉시 버드독으로 복귀한다.",
    ],
    breathing: "앞으로 밀 때 들이쉬고 돌아올 때 내쉰다.",
    target: "복부와 몸통 안정성",
    commonMistakes: [
      "처음부터 멀리 밀기",
      "허리가 아래로 꺼짐",
      "통증을 참고 반복",
    ],
    stopCriteria: ["허리 통증", "다리 저림", "허리 꺼짐 유지"],
    keyPoint:
      "조건 충족 시에만 짧은 범위로 진행하고 이상하면 버드독으로 복귀한다.",
    videoSearchQuery: "무릎 AB 슬라이드 자세",
  },
};

const getGuide = (name: string): ExerciseGuide => {
  const normalizedName = name.replace(/\s/g, "");
  const guide = Object.entries(GUIDE_LIBRARY).find(([key]) =>
    name.includes(key) || normalizedName.includes(key.replace(/\s/g, "")),
  )?.[1];
  if (guide)
    return {
      ...guide,
      videoUrl:
        guide.videoUrl ??
        youtubeSearchUrl(guide.videoSearchQuery ?? `${name} 자세 초보`),
    };
  const query = `${name} 자세 초보`;
  return {
    setup: [
      "주변을 정리하고 필요한 도구를 안전하게 준비한다.",
      "발은 안정적으로 두고 배에 가볍게 힘을 준다.",
      "통증 없는 범위에서 시작할 준비를 한다.",
    ],
    movement: [
      "첫 반복은 작은 범위로 천천히 확인한다.",
      "목표 부위에 힘이 들어오는지 확인하며 반복한다.",
      "자세가 무너지면 속도와 범위를 줄인다.",
    ],
    breathing: "힘을 쓰는 구간에서 내쉬고 돌아오는 구간에서 들이쉰다.",
    target: "해당 운동의 주요 근육과 몸통 안정성",
    commonMistakes: [
      "처음부터 너무 빠르게 진행함",
      "통증을 참고 반복함",
      "호흡을 참음",
    ],
    stopCriteria: ["허리 통증", "날카로운 관절 통증", "저림", "어지러움"],
    keyPoint: "통증 없는 범위와 안정적인 자세를 우선한다.",
    videoSearchQuery: query,
    videoUrl: youtubeSearchUrl(query),
  };
};

export const SAFETY_STOP_MESSAGE =
  "허리 통증, 다리 저림, 무릎 통증, 어지럼, 손떨림, 식은땀, 메스꺼움, 가슴 답답함이 있으면 즉시 중단하고 회복일로 전환하세요.";

const flow: FlowItem[] = [
  {
    icon: "🧘",
    label: "워밍업",
    time: "5~8분",
    bgColor: "#EEEDFE",
    labelColor: "#3C3489",
    timeColor: "#534AB7",
  },
  {
    icon: "💪",
    label: "본운동",
    time: "15~25분",
    bgColor: "#E6F1FB",
    labelColor: "#0C447C",
    timeColor: "#185FA5",
  },
  {
    icon: "🌿",
    label: "정리운동",
    time: "5분",
    bgColor: "#EAF3DE",
    labelColor: "#27500A",
    timeColor: "#3B6D11",
  },
];
const tip = (text: string): Detail => ({ type: "purple", text });
const mk = (
  name: string,
  meta: string,
  guide: string,
  sets = 3,
  restSeconds = 45,
  intervalPlan?: IntervalPlan,
  abSlideGate = false,
): Exercise => ({
  name,
  meta,
  sets,
  restSeconds,
  intervalPlan,
  abSlideGate,
  guide: getGuide(name),
  details: [tip(guide)],
});
const sliding = (
  name: string,
  meta: string,
  guide: string,
  intervalPlan: IntervalPlan,
): Exercise => mk(name, meta, guide, 0, 0, intervalPlan);


const FOAM_ROLLER_PREP = () =>
  mk(
    "폼롤러 준비",
    "3~5분",
    "운동 강도를 높이는 장비가 아니라 몸을 준비하는 도구입니다. 종아리, 허벅지 앞, 엉덩이, 등 위쪽을 짧게 풀고 시간이 부족하면 3분만 진행합니다.",
    0,
    0,
  );
const FOAM_ROLLER_RECOVERY = () =>
  mk(
    "폼롤러 회복",
    "5분",
    "운동 후 회복 목적입니다. 허리 아래쪽은 직접 굴리지 말고 종아리, 허벅지, 엉덩이, 등 위쪽 중심으로 가볍게 진행합니다.",
    0,
    0,
  );

const ROSARY_CARDIO_GUIDE =
  "운동 전 묵주기도 슬라이딩보드는 고강도 운동이 아니라, 기도와 저강도 유산소를 함께하는 시간입니다. 묵주기도를 이어갈 수 있을 정도의 가벼운 속도로 진행하세요. 목표는 묵주기도 5단이지만 컨디션 저하 시 1~3단만 진행해도 되며, 5단 완료보다 안전한 자세와 꾸준함이 중요합니다.";
const POST_WORKOUT_CARDIO_GUIDE =
  "운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주는 5분만 진행하거나 생략하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다.";
const ROSARY_CARDIO = () =>
  sliding(
    "묵주기도 슬라이딩보드",
    "1주차 15분 · 2주차 15~20분 · 3주차 이후 20분",
    ROSARY_CARDIO_GUIDE,
    {
      segments: [
        { label: "저강도 · 기도 가능", seconds: 1200, intensity: "가볍게" },
      ],
    },
  );
const POST_WORKOUT_CARDIO = () =>
  sliding(
    "슬라이딩보드 마무리",
    "1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분",
    POST_WORKOUT_CARDIO_GUIDE,
    { segments: [{ label: "가볍게", seconds: 300, intensity: "가볍게" }] },
  );
const PULLUP_START = () =>
  mk(
    "턱걸이 초기자세",
    "3~5분",
    "철봉 잡기·발 보조 매달리기·견갑 내리기 감각만 짧게 연습합니다.",
    0,
    0,
  );

const phases = (exercises: Exercise[], alert?: string): Phase[] => [
  {
    id: "warmup",
    icon: "🧘",
    title: "워밍업",
    subtitle: "5~8분 · 본운동 시간 제외",
    exercises: [
      mk(
        "관절 가동성 + 가벼운 제자리 걷기",
        "5~8분",
        "어깨·고관절·발목을 부드럽게 풀고 숨이 살짝 오를 정도로만 진행합니다.",
        0,
        0,
      ),
    ],
  },
  {
    id: "main",
    icon: "💪",
    title: "본운동",
    subtitle: "15~25분 기준 · 처음 2주는 세트 수와 무게를 늘리지 않음",
    alert: alert ? { variant: "yellow", text: alert } : undefined,
    exercises,
  },
  {
    id: "cooldown",
    icon: "🌿",
    title: "정리운동",
    subtitle: "5분 · 본운동 시간 제외",
    exercises: [
      mk(
        "호흡 정리 + 하체/등 스트레칭",
        "5분",
        "호흡을 낮추고 햄스트링·둔근·등을 통증 없는 범위에서 천천히 늘립니다.",
        0,
        0,
      ),
    ],
  },
];
const day = (
  id: string,
  tabLabel: string,
  emoji: string,
  title: string,
  subtitle: string,
  exercises: Exercise[],
  color: string,
  alert?: string,
): DayWorkout => ({
  id,
  tabLabel,
  emoji,
  title,
  subtitle,
  totalTime: "본운동 15~25분",
  badgeBg: color,
  dayColor: color,
  flow,
  phases: phases(exercises, alert),
});

export const ADAPTATION_WORKOUTS: Record<
  AdaptationRoutineSelection,
  DayWorkout
> = {
  adapt1: day(
    "adapt1",
    "운동 A",
    "🌱",
    "운동 A — 등 + 밴드 + 덤벨 로우",
    "월요일 권장 · 집 운동 기반 1개월 감량 집중 루틴",
    [
      FOAM_ROLLER_PREP(),
      ROSARY_CARDIO(),
      mk("버드독", "좌우 6회 × 2세트", "골반이 흔들리지 않게 천천히 뻗습니다.", 2, 30),
      mk("롱밴드 랫풀다운", "12회 × 2세트", "팔꿈치를 아래·뒤로 당기며 어깨를 귀에서 멀리 둡니다.", 2, 45),
      mk("밴드 로우", "12회 × 2세트", "허리는 중립으로 고정하고 팔꿈치가 몸 뒤로 간다는 느낌으로 당깁니다.", 2, 45),
      mk("의자/테이블 지지 원암 덤벨 로우", "좌우 10회 × 2세트 · 5~7kg부터", "등과 광배근을 강화합니다. 튼튼한 의자·식탁·책상 가장자리를 짚고 진행하며, 받칠 곳이 없거나 허리가 불편하면 밴드 로우로 대체합니다.", 2, 45),
      mk("데드버그", "좌우 6회 × 2세트", "허리가 뜨지 않는 범위에서 팔다리를 천천히 움직입니다.", 2, 30),
      PULLUP_START(),
      POST_WORKOUT_CARDIO(),
      FOAM_ROLLER_RECOVERY(),
    ],
    "#534AB7",
  ),
  adapt2: day(
    "adapt2",
    "운동 B",
    "🌿",
    "운동 B — 하체 + 덤벨 스쿼트 + 루프밴드",
    "화요일 권장 · 하체와 골반 안정화",
    [
      FOAM_ROLLER_PREP(),
      ROSARY_CARDIO(),
      mk("힙브릿지", "12회 × 2세트", "허리가 아니라 엉덩이에 힘을 주고 과하게 젖히지 않습니다.", 2, 30),
      mk("덤벨 고블릿 스쿼트", "8~10회 × 2세트 · 5~7kg부터 시작", "자세가 무너지면 무게를 낮추고 허리 통증 없는 범위만 진행합니다.", 2, 45),
      mk("루프밴드 사이드워크", "좌우 10걸음 × 2세트", "작은 보폭으로 골반 높이를 유지합니다.", 2, 30),
      mk("루프밴드 몬스터워크", "앞/뒤 8~10걸음 × 2세트", "무릎이 안쪽으로 무너지지 않게 엉덩이 힘을 유지합니다.", 2, 30),
      mk("버드독", "좌우 6회 × 2세트", "흔들림 없는 자세를 우선합니다.", 2, 30),
      PULLUP_START(),
      POST_WORKOUT_CARDIO(),
      FOAM_ROLLER_RECOVERY(),
    ],
    "#639922",
  ),
  adapt3: day(
    "adapt3",
    "운동 C",
    "🌿",
    "운동 C — 회복형 유산소 + 코어 + AB 슬라이더 준비",
    "수요일 권장 · 가벼운 회복형 운동일",
    [
      FOAM_ROLLER_PREP(),
      sliding("묵주기도 슬라이딩보드", "15~20분 · 아주 가볍게", ROSARY_CARDIO_GUIDE, { segments: [{ label: "저강도 · 기도 가능", seconds: 900, intensity: "아주 가볍게" }] }),
      mk("힙브릿지", "12회 × 2세트", "허리가 아니라 엉덩이에 힘을 주고 과하게 젖히지 않습니다.", 2, 30),
      mk("데드버그", "좌우 6회 × 2세트", "허리가 뜨지 않는 범위에서 팔다리를 천천히 움직입니다.", 2, 30),
      mk("AB 슬라이더 준비 자세", "무릎 대고 잡기 · 복부 힘 주기 · 5초 버티기 × 3회 · 앞으로 밀지 않음", "복부 힘과 허리 안정성 확인이 목적입니다. 1~2주차에는 앞으로 밀지 않고 시작 자세에서 5초 버티기 × 3회만 진행합니다. 3~4주차는 허리 통증이 없을 때만 10~20cm 짧게 밀고 돌아옵니다. 허리 통증, 다리 저림, 반동이 있으면 즉시 중단하세요.", 0, 0, undefined, true),
      mk("롱밴드 가벼운 로우", "12회 × 1~2세트", "회복형 강도로 가볍게 당기고 어깨를 귀에서 멀리 둡니다.", 2, 45),
      mk("턱걸이 초기자세", "3분", "현재 단계 1개만 짧게 연습하고 1~5단계를 하루에 모두 수행하지 않습니다.", 0, 0),
      POST_WORKOUT_CARDIO(),
      FOAM_ROLLER_RECOVERY(),
    ],
    "#378ADD",
  ),
};

const WORKOUT_D = day(
  "thu",
  "목요일",
  "💪",
  "운동 D — 상체 + 덤벨 + 밴드 + AB 준비",
  "목요일 권장 · 상체와 코어 안정화",
  [
    FOAM_ROLLER_PREP(),
    ROSARY_CARDIO(),
    mk("덤벨 플로어프레스", "10회 × 2세트 · 한 손 3~5kg부터", "바닥에서 팔꿈치가 닿으면 멈추고 가벼운 무게로 시작합니다.", 2, 45),
    mk("롱밴드 페이스풀", "12회 × 2세트", "얼굴 방향으로 당기며 어깨를 내리고 등 위쪽을 사용합니다.", 2, 45),
    mk("밴드 풀어파트", "12~15회 × 2세트", "어깨가 올라가지 않게 밴드를 가슴 앞에서 천천히 벌립니다.", 2, 30),
    mk("무릎 사이드 플랭크", "좌우 10~15초 × 2세트", "오래 버티지 말고 허리 통증 없는 짧은 자세만 유지합니다.", 2, 30),
    mk("AB 슬라이더 준비 자세", "5초 × 3회 · 허리 꺾이면 즉시 중단", "복부 힘과 허리 안정성 확인이 목적입니다. 1~2주차에는 앞으로 밀지 않고 시작 자세에서 5초 버티기 × 3회만 진행합니다. 3~4주차는 허리 통증이 없을 때만 10~20cm 짧게 밀고 돌아옵니다. 복부 힘이 풀리면 중단하세요.", 0, 0, undefined, true),
    PULLUP_START(),
    POST_WORKOUT_CARDIO(),
    FOAM_ROLLER_RECOVERY(),
  ],
  "#EF9F27",
);

const WORKOUT_E = day(
  "fri",
  "금요일",
  "⚡",
  "운동 E — 전신 가벼운 서킷",
  "금요일 권장 · 강한 서킷이 아닌 가벼운 전신 반복",
  [
    FOAM_ROLLER_PREP(),
    ROSARY_CARDIO(),
    mk("덤벨 고블릿 스쿼트", "8회 × 2세트 · 5~7kg부터", "속도보다 자세를 우선하고 허리 통증 없는 범위만 진행합니다.", 2, 45),
    mk("밴드 로우", "12회 × 2세트", "허리는 중립으로 고정하고 팔꿈치를 뒤로 당깁니다.", 2, 45),
    mk("덤벨 플로어프레스", "10회 × 2세트", "가벼운 무게로 바닥에서 안전하게 밀어 올립니다.", 2, 45),
    mk("루프밴드 사이드워크", "좌우 10걸음 × 2세트", "작은 보폭으로 골반 높이를 유지합니다.", 2, 30),
    mk("버드독", "좌우 6회 × 2세트", "흔들림 없는 자세를 우선합니다.", 2, 30),
    PULLUP_START(),
    POST_WORKOUT_CARDIO(),
    FOAM_ROLLER_RECOVERY(),
  ],
  "#E24B4A",
);

export const WORKOUTS: DayWorkout[] = [
  day("mon", "월요일", "💪", "운동 A — 등 + 밴드 + 덤벨 로우", "월요일 · 집 운동 기반 감량 집중", ADAPTATION_WORKOUTS.adapt1.phases[1].exercises, "#534AB7"),
  day("tue", "화요일", "🦵", "운동 B — 하체 + 덤벨 스쿼트 + 루프밴드", "화요일 · 하체와 골반 안정화", ADAPTATION_WORKOUTS.adapt2.phases[1].exercises, "#639922"),
  day("wed", "수요일", "🌿", "운동 C — 회복형 유산소 + 코어 + AB 슬라이더 준비", "수요일 · 완전 휴식이 아닌 가벼운 운동일", ADAPTATION_WORKOUTS.adapt3.phases[1].exercises, "#378ADD"),
  WORKOUT_D,
  WORKOUT_E,
  day(
    "sat",
    "토요일",
    "🌤️",
    "토요일 — 선택 유산소 또는 휴식",
    "고정 운동일 아님 · 컨디션에 따라 선택",
    [
      sliding("선택 유산소", "선택 1: 슬라이딩보드 20~30분 · 선택 2: 가벼운 산책 30분 · 선택 3: 묵주기도 슬라이딩보드 15~20분 · 선택 4: 완전 휴식", "토요일은 고정 운동일이 아닙니다. 컨디션이 좋으면 가벼운 유산소를 선택하고 피곤하면 완전 휴식합니다.", { segments: [{ label: "선택", seconds: 1200, intensity: "가볍게" }] }),
    ],
    "#F59E0B",
  ),
  day(
    "sun",
    "일요일",
    "😴",
    "일요일 — 휴식",
    "완전 휴식 또는 턱걸이 자세만 1~2분",
    [
      mk("완전 휴식", "권장", "근력운동은 추천하지 않습니다. 몸 상태를 회복하고 다음 주 운동을 준비합니다.", 0, 0),
      mk("턱걸이 자세만", "선택 1~2분", "통증이 없을 때만 철봉 잡기와 견갑 내리기 감각을 짧게 확인합니다.", 0, 0),
    ],
    "#9CA3AF",
  ),
];

export const WEEK_OVERVIEW = {
  stats: [
    { label: "1개월 감량 집중", value: "5", unit: "일", sub: "월~금 운동" },
    { label: "묵주기도 유산소", value: "15~20", unit: "분", sub: "운동 전" },
    { label: "마무리 유산소", value: "5", unit: "분", sub: "기본값" },
    { label: "턱걸이 초기자세", value: "3~5", unit: "분", sub: "현재 단계 1개" },
  ],
  days: [
    { day: "월", emoji: "💪", label: "운동 A", sub: "등·로우", time: "주 5일", active: true, tabId: "mon", color: "#534AB7", bg: "#EEEDFE", border: "#AFA9EC" },
    { day: "화", emoji: "🦵", label: "운동 B", sub: "하체·밴드", time: "주 5일", active: true, tabId: "tue", color: "#639922", bg: "#EAF3DE", border: "#B7D88B" },
    { day: "수", emoji: "🌿", label: "운동 C", sub: "회복·AB준비", time: "가볍게", active: true, tabId: "wed", color: "#378ADD", bg: "#E6F1FB", border: "#9CCAF0" },
    { day: "목", emoji: "💪", label: "운동 D", sub: "상체·AB준비", time: "주 5일", active: true, tabId: "thu", color: "#EF9F27", bg: "#FAEEDA", border: "#F3C276" },
    { day: "금", emoji: "⚡", label: "운동 E", sub: "전신 가볍게", time: "주 5일", active: true, tabId: "fri", color: "#E24B4A", bg: "#FCEBEB", border: "#F1A6A6" },
    { day: "토", emoji: "🌤️", label: "선택", sub: "유산소/휴식", time: "선택", active: true, tabId: "sat", color: "#F59E0B", bg: "#FEF3C7", border: "#FCD34D" },
    { day: "일", emoji: "😴", label: "휴식", sub: "자세 1~2분", time: "휴식", active: true, tabId: "sun", color: "#6B7280", bg: "#F3F4F6", border: "#D1D5DB" },
  ],
  dayTimes: [
    { days: "월", total: "약 40분", detail: "운동 A\n묵주기도+근력+마무리", color: "#534AB7", border: "#AFA9EC" },
    { days: "화", total: "약 40분", detail: "운동 B\n하체+루프밴드", color: "#639922", border: "#B7D88B" },
    { days: "수", total: "가볍게", detail: "운동 C\n회복+AB 준비", color: "#378ADD", border: "#9CCAF0" },
    { days: "목", total: "약 40분", detail: "운동 D\n상체+AB 준비", color: "#EF9F27", border: "#F3C276" },
    { days: "금", total: "약 40분", detail: "운동 E\n전신 가벼운 서킷", color: "#E24B4A", border: "#F1A6A6" },
    { days: "토", total: "선택", detail: "20~30분 유산소\n또는 휴식", color: "#F59E0B", border: "#FCD34D" },
    { days: "일", total: "휴식", detail: "근력 추천 안 함", color: "#6B7280", border: "#D1D5DB" },
  ],
  afterMonth: [
    "1개월 감량 집중기 이후에는 운동량을 줄여 유지/조절기로 전환합니다.",
    "근력운동 주 3회, 유산소 주 3~5회, 철봉 초기자세 주 5일 정도를 기준으로 합니다.",
    "허리 상태와 체중 변화에 따라 운동량을 조절합니다.",
  ],
};
export const SAFETY = {
  forbidden:
    "운동 전 슬라이딩보드 20분은 저강도 유산소 기준입니다. 근력운동 전에 지칠 정도로 빠르게 하면 근력운동 자세가 무너질 수 있습니다. 기도를 이어갈 수 있을 정도, 숨이 너무 차지 않을 정도, 허리/무릎 통증이 없을 정도, 균형이 흔들리지 않는 속도로 진행하세요. 처음 2주는 숨은 차지만 대화 가능한 정도로 진행합니다. 운동 후 허리 통증이 없어야 하며 다음날 피로가 심하면 강도가 과한 것입니다. 세트 수는 늘리지 않고 덤벨 무게 욕심을 내지 않습니다. AB 슬라이드, 윗몸일으키기, 레그레이즈, 러시안 트위스트, 무거운 데드리프트, 백익스텐션, 점프 운동, 빠른 버피, 무리한 플랭크 오래 버티기는 제외합니다.",
  signals: [
    {
      label: "가볍게",
      action: "대화 가능",
      bg: "#EAF3DE",
      labelColor: "#3B6D11",
      textColor: "#27500A",
    },
    {
      label: "중간",
      action: "짧은 문장은 가능하지만 숨이 참",
      bg: "#E6F1FB",
      labelColor: "#185FA5",
      textColor: "#0C447C",
    },
    {
      label: "강하게",
      action: "긴 대화가 어려울 정도. 자세는 유지",
      bg: "#FAEEDA",
      labelColor: "#854F0B",
      textColor: "#633806",
    },
  ],
  cpap: SAFETY_STOP_MESSAGE,
};
export const DIET = {
  meals: [
    {
      label: "아침",
      bg: "#EAF3DE",
      color: "#27500A",
      items: [
        {
          icon: "🥚",
          text: "단백질 반찬과 채소를 먼저 먹고 탄수화물은 활동량에 맞춰 조절합니다.",
        },
      ],
    },
    {
      label: "점심",
      bg: "#E6F1FB",
      color: "#0C447C",
      items: [
        {
          icon: "🍚",
          text: "밥 반~2/3공기 + 닭가슴살 150~200g 또는 생선/두부 등 단백질.",
        },
      ],
    },
    {
      label: "저녁",
      bg: "#FAEEDA",
      color: "#633806",
      items: [
        {
          icon: "🥗",
          text: "채소와 단백질 중심으로 가볍게, 운동 후 과식은 피합니다.",
        },
      ],
    },
  ],
};
