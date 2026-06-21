export type BadgeVariant = 'yellow' | 'green' | 'blue' | 'purple' | 'red';
export type PhaseType = 'warmup' | 'main' | 'sliding' | 'cooldown';
export type AlertType = 'yellow' | 'green' | 'blue' | 'purple';
export type BulletType = 'purple' | 'red' | 'green';
export type SwitchOnSelection = 'adapt1' | 'adapt2' | 'adapt3' | 'base';

export interface Detail { type: BulletType | 'step' | 'warn' | 'good' | 'text'; text: string; stepNum?: number }
export interface IntervalRow { weeks: string; pattern: string; total: string }
export interface IntervalSegment { label: string; seconds: number; intensity: string }
export interface IntervalPlan { rounds?: number; segments: IntervalSegment[] }
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
  name: string; meta?: string; badge?: { label: string; variant: BadgeVariant }; details: Detail[];
  guide?: ExerciseGuide;
  intervals?: IntervalRow[]; intervalNote?: string; sets?: number; restSeconds?: number; intervalPlan?: IntervalPlan; abSlideGate?: boolean;
}
export interface Phase { id: PhaseType; icon: string; title: string; subtitle: string; alert?: { variant: AlertType; text: string }; todaySliding?: { time: string; note: string }; exercises: Exercise[] }
export interface FlowItem { icon: string; label: string; time: string; bgColor: string; labelColor: string; timeColor: string }
export interface DayWorkout { id: string; tabLabel: string; emoji: string; title: string; subtitle: string; totalTime: string; badgeBg: string; dayColor: string; flow: FlowItem[]; phases: Phase[] }

export const SWITCHON_DEFAULT_START_DATE = '2026-06-22';
export const SWITCHON_START_DATE_KEY = 'ai-fitness-switchon-start-date';
export const SWITCHON_MODE_KEY = 'ai-fitness-switchon-mode';
export const SET_COMPLETION_KEY = 'ai-fitness-switchon-set-completions';
export const AB_SLIDE_KEY = 'ai-fitness-switchon-ab-slide-checks';
export const COMMON_INTENSITY = [
  '가볍게: 대화 가능', '중간: 짧은 문장은 가능하지만 숨이 참', '강하게: 긴 대화가 어려울 정도로 숨이 참. 단, 자세는 유지',
];

const youtubeSearchUrl = (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

const GUIDE_LIBRARY: Record<string, ExerciseGuide> = {
  '관절 가동성 + 가벼운 제자리 걷기': { setup: ['편하게 서서 발은 골반 너비로 둔다.', '허리를 과하게 젖히지 않고 배에 가볍게 힘을 준다.'], movement: ['목 좌우 천천히 돌리기', '어깨 앞뒤 돌리기', '팔 크게 원 그리기', '골반 가볍게 돌리기', '발목 돌리기', '제자리 걷기'], breathing: '숨을 참지 않고 편하게 유지한다.', target: '목·어깨·골반·발목 가동성, 가벼운 심박 상승', commonMistakes: ['목을 빠르게 돌림', '허리를 크게 젖힘', '통증이 있는 관절을 억지로 끝 범위까지 움직임'], stopCriteria: ['어지러움', '목 통증', '허리 통증', '무릎 통증'], keyPoint: '관절을 끝까지 밀어붙이지 말고 통증 없는 범위에서 천천히 몸을 깨운다.', videoUrl: 'https://www.youtube.com/results?search_query=5%EB%B6%84+%EC%A0%84%EC%8B%A0+%EA%B4%80%EC%A0%88+%EA%B0%80%EB%8F%99%EC%84%B1+%EC%9B%8C%EB%B0%8D%EC%97%85' },
  '호흡 정리 + 하체/등 스트레칭': { setup: ['천천히 걷거나 제자리에서 호흡 정리 1분으로 시작한다.', '반동 없이 통증이 아닌 당김 범위까지만 늘릴 준비를 한다.', '각 자세는 15~30초 정도 유지한다.'], movement: ['종아리 스트레칭', '허벅지 뒤쪽 스트레칭', '엉덩이 스트레칭', '광배근 / 등 옆 스트레칭', '가슴 열기 스트레칭', '숨을 길게 내쉬며 긴장을 낮춘다.'], breathing: '숨을 길게 내쉬고, 자세를 바꿀 때도 숨을 참지 않는다.', target: '종아리, 햄스트링, 엉덩이, 등 옆, 가슴, 호흡 안정', commonMistakes: ['반동을 주며 늘림', '통증을 참으며 깊게 누름', '허리를 꺾은 채 스트레칭함', '숨을 참고 버팀'], stopCriteria: ['저림', '날카로운 통증', '허리 통증 증가', '어지러움'], keyPoint: '마무리는 강한 운동이 아니라 호흡을 낮추고 당김 범위만 유지하는 시간이다.', videoUrl: 'https://www.youtube.com/results?search_query=5%EB%B6%84+%EC%A0%84%EC%8B%A0+%EC%BF%A8%EB%8B%A4%EC%9A%B4+%EC%8A%A4%ED%8A%B8%EB%A0%88%EC%B9%AD' },
  '슬라이딩보드': { setup: ['발을 양쪽 패드에 올린다.', '무릎을 살짝 굽히고 엉덩이를 약간 뒤로 보낸다.', '상체는 너무 숙이지 않고 허리 중립을 유지한다.'], movement: ['한쪽 다리로 옆 방향으로 밀고 반대쪽 다리가 따라오게 한다.', '점프하지 말고 스케이트 타듯 미끄러진다.', '속도보다 엉덩이와 다리로 밀어내는 자세를 우선한다.'], breathing: '자연스럽게 유지하고 강도 구간에서도 숨을 참지 않는다.', target: '엉덩이 옆, 허벅지 안쪽·바깥쪽, 심폐 지구력', commonMistakes: ['허리를 과하게 숙임', '무릎이 안쪽으로 모임', '발이 패드에서 들림', '상체 반동으로 속도를 냄'], stopCriteria: ['허리 통증', '무릎의 날카로운 통증', '다리 저림', '어지러움'], keyPoint: '속도보다 허리 중립과 하체로 밀어내는 느낌을 우선한다.', videoUrl: 'https://www.youtube.com/watch?v=YHEJeqRnmzc', videoSearchQuery: '슬라이딩보드 초보 자세' },
  '롱밴드 랫풀다운': { setup: ['롱밴드를 문틀 철봉 중앙에 단단히 고정한다.', '무릎을 꿇거나 앉아서 양손으로 밴드를 잡고 팔을 위로 뻗는다.'], movement: ['팔꿈치를 아래·뒤 방향으로 끌어내린다.', '밴드는 쇄골 또는 윗가슴 높이까지 당긴다.', '천천히 시작 자세로 돌아간다.'], breathing: '당길 때 내쉬고, 돌아갈 때 들이쉰다.', target: '겨드랑이 아래쪽과 등 옆쪽', commonMistakes: ['어깨가 귀 쪽으로 올라감', '허리를 과하게 젖혀 반동 사용', '팔 힘만으로 당김'], stopCriteria: ['어깨 통증', '팔 저림', '허리 통증'], keyPoint: '팔보다 팔꿈치를 아래로 내리며 등을 먼저 쓴다.', videoUrl: 'https://www.youtube.com/watch?v=84D8bVJWB3s', videoSearchQuery: '롱밴드 랫풀다운 자세' },
  '롱밴드 로우': { setup: ['밴드를 배꼽 또는 가슴 아래 높이의 단단한 고정점에 연결한다.', '팔을 편 상태에서 시작한다.', '가슴을 가볍게 열고 허리 중립을 유지한다.'], movement: ['팔꿈치를 뒤로 끌어당긴다.', '마지막에 날개뼈를 가볍게 모은다.', '천천히 원위치한다.'], breathing: '당길 때 내쉬고 돌아갈 때 들이쉰다.', target: '등 중앙과 날개뼈 주변', commonMistakes: ['허리를 뒤로 젖혀 반동 사용', '어깨가 올라감', '팔만 사용하고 등이 움직이지 않음'], stopCriteria: ['허리 통증', '어깨 앞쪽 통증', '팔 저림'], keyPoint: '허리는 고정하고 팔꿈치가 몸 뒤로 간다는 느낌으로 당긴다.', videoSearchQuery: '롱밴드 로우 자세' },
  '덤벨 플로어 프레스': { setup: ['바닥에 누워 무릎을 세운다.', '덤벨을 가슴 옆에 둔다.', '팔꿈치는 몸통에서 약 45도 정도 벌린다.'], movement: ['덤벨을 가슴 위로 밀어 올린다.', '천천히 내린다.', '팔꿈치가 바닥에 닿으면 멈춘다.'], breathing: '밀 때 내쉬고 내릴 때 들이쉰다.', target: '가슴, 삼두, 어깨 앞쪽', commonMistakes: ['허리가 과하게 뜸', '팔꿈치를 90도로 너무 벌림', '덤벨을 급하게 내림'], stopCriteria: ['어깨 통증', '팔꿈치 통증', '허리 불편감'], keyPoint: '팔꿈치를 45도로 두고 바닥에서 멈춰 어깨 부담을 줄인다.', videoUrl: 'https://www.youtube.com/watch?v=uUGDRwge4F8', videoSearchQuery: '덤벨 플로어 프레스 자세' },
  '루프밴드 풀어파트': { setup: ['가슴 높이에서 밴드를 양손으로 잡는다.', '팔꿈치는 거의 펴되 완전히 잠그지 않는다.', '어깨를 귀에서 멀리 내린다.'], movement: ['양손을 좌우로 벌려 밴드를 당긴다.', '등 위쪽과 어깨 뒤쪽이 조여지는 지점에서 멈춘다.', '천천히 돌아온다.'], breathing: '벌릴 때 내쉬고 돌아올 때 들이쉰다.', target: '등 위쪽과 어깨 뒤쪽', commonMistakes: ['허리를 젖힘', '어깨를 으쓱함', '팔을 너무 뒤로 과하게 보냄'], stopCriteria: ['어깨 통증', '목 통증', '팔 저림'], keyPoint: '어깨를 내리고 등 위쪽으로 밴드를 벌린다.', videoSearchQuery: '밴드 풀어파트 자세' },
  '발 보조 매달리기': { setup: ['철봉을 잡고 발끝은 바닥 또는 의자에 둔다.', '체중 전부를 철봉에 싣지 않는다.', '어깨를 귀에서 멀리 둔다.'], movement: ['발로 일부 체중을 지지한 상태에서 가볍게 매달린다.', '어깨를 귀에서 멀리 내리는 느낌으로 버틴다.', '시간이 끝나면 발로 먼저 체중을 받아 천천히 내려온다.'], breathing: '짧고 편안하게 호흡한다.', target: '등, 전완, 어깨 안정성', commonMistakes: ['갑자기 전 체중을 매달기', '어깨를 으쓱한 채 버티기', '통증을 참고 지속하기'], stopCriteria: ['어깨 통증', '팔 저림', '목 통증', '허리 불편감'], keyPoint: '발 보조를 유지해 어깨가 편한 범위에서만 버틴다.', videoSearchQuery: '철봉 보조 매달리기 자세' },
  '고블릿 스쿼트': { setup: ['덤벨을 가슴 앞에 세로로 잡는다.', '발바닥 전체가 바닥에 닿게 선다.', '배에 가볍게 힘을 준다.'], movement: ['엉덩이를 뒤로 보내며 앉는다.', '무릎은 발끝 방향을 따라간다.', '허리 중립을 유지한다.', '일어날 때 발바닥 전체로 바닥을 민다.'], breathing: '내려갈 때 들이쉬고 일어날 때 내쉰다.', target: '허벅지 앞쪽, 엉덩이', commonMistakes: ['허리가 말림', '무릎이 안쪽으로 무너짐', '뒤꿈치가 들림'], stopCriteria: ['허리 통증', '날카로운 무릎 통증', '어지러움'], keyPoint: '무릎은 발끝 방향, 허리는 중립을 유지한다.', videoSearchQuery: '고블릿 스쿼트 자세' },
  '힙 브릿지': { setup: ['무릎을 세우고 눕는다.', '발은 골반 너비로 둔다.', '갈비뼈가 들리지 않게 배에 힘을 준다.'], movement: ['엉덩이에 힘을 주며 들어올린다.', '갈비뼈를 과하게 들지 않는다.', '허리로 밀지 않는다.', '엉덩이 수축을 먼저 느낀다.'], breathing: '올릴 때 내쉬고 내릴 때 들이쉰다.', target: '엉덩이와 햄스트링', commonMistakes: ['허리로 밀어 올림', '갈비뼈가 들림', '무릎이 안쪽으로 모임'], stopCriteria: ['허리 통증', '다리 저림', '햄스트링 경련'], keyPoint: '허리가 아니라 엉덩이를 조여 골반을 들어올린다.', videoSearchQuery: '힙 브릿지 자세' },
  '루프밴드 사이드 워크': { setup: ['루프밴드를 무릎 위 또는 발목 위에 건다.', '발은 골반 너비, 무릎은 살짝 굽힌다.', '엉덩이를 조금 뒤로 보내고 허리 중립을 유지한다.'], movement: ['밴드 장력을 유지하며 옆으로 한 걸음 이동한다.', '반대발은 끌지 말고 천천히 따라온다.', '정해진 걸음 수 후 반대 방향으로 반복한다.'], breathing: '걸을 때마다 편하게 내쉬고 숨을 참지 않는다.', target: '중둔근, 엉덩이 옆, 무릎 안정성', commonMistakes: ['무릎이 안쪽으로 모임', '상체가 좌우로 흔들림', '보폭을 너무 크게 가져감'], stopCriteria: ['무릎 통증', '허리 통증', '고관절 찝힘', '어지러움'], keyPoint: '작은 보폭으로 밴드 장력을 유지하고 골반 높이를 일정하게 둔다.', videoSearchQuery: '밴드 사이드 워크 자세' },
  '루프밴드 몬스터 워크': { setup: ['루프밴드를 무릎 위 또는 발목 위에 건다.', '무릎을 살짝 굽히고 발끝은 정면 또는 약간 바깥을 향한다.', '배에 힘을 주고 허리 중립을 유지한다.'], movement: ['대각선 앞쪽으로 작게 걸으며 밴드 장력을 유지한다.', '뒤로 돌아올 때도 무릎이 안쪽으로 모이지 않게 한다.', '속도보다 균형과 엉덩이 자극을 우선한다.'], breathing: '이동할 때 편하게 내쉬고 돌아올 때 들이쉰다.', target: '엉덩이 옆, 둔근, 하체 안정성', commonMistakes: ['상체를 크게 흔듦', '무릎이 안쪽으로 무너짐', '발을 끌어서 밴드 장력이 풀림'], stopCriteria: ['무릎 통증', '허리 통증', '고관절 통증', '균형 상실'], keyPoint: '작은 대각선 걸음으로 엉덩이 옆 힘을 계속 유지한다.', videoSearchQuery: '밴드 몬스터 워크 자세' },
  '롱밴드 페이스풀': { setup: ['밴드를 얼굴 또는 눈높이의 단단한 고정점에 연결한다.', '양손으로 밴드를 잡고 한두 걸음 물러선다.', '갈비뼈를 내리고 어깨를 편하게 둔다.'], movement: ['손을 얼굴 옆으로 당기며 팔꿈치를 바깥으로 벌린다.', '어깨 뒤쪽과 등 위쪽을 조인 뒤 잠깐 멈춘다.', '밴드 장력을 유지하며 천천히 돌아간다.'], breathing: '당길 때 내쉬고 돌아갈 때 들이쉰다.', target: '어깨 뒤쪽, 등 위쪽, 견갑 안정성', commonMistakes: ['허리를 젖혀 당김', '어깨를 으쓱함', '목에 힘이 과하게 들어감'], stopCriteria: ['어깨 통증', '목 통증', '팔 저림', '허리 통증'], keyPoint: '얼굴 쪽으로 당기되 목이 아니라 어깨 뒤쪽과 등 위쪽을 쓴다.', videoSearchQuery: '밴드 페이스풀 자세' },
  '팔로프 프레스': { setup: ['밴드는 옆 방향으로 당겨도 풀리지 않는 단단한 고정점에 연결한다.', '밴드가 몸 옆에서 당기는 위치에 선다.', '무릎을 살짝 굽히고 배에 힘을 준다.'], movement: ['손을 가슴 앞에 모은다.', '몸통이 밴드 쪽으로 돌아가지 않도록 앞으로 밀어낸다.', '잠깐 멈춘 뒤 천천히 가슴 앞으로 돌아온다.'], breathing: '밀 때 내쉬고 돌아올 때 들이쉰다.', target: '복부 옆면과 몸통 안정성', commonMistakes: ['약한 고정점에 밴드를 연결함', '몸통이 밴드 쪽으로 돌아감', '허리가 꺾임'], stopCriteria: ['허리 통증', '어깨 통증', '어지러움'], keyPoint: '절대 풀리지 않는 옆 방향 고정점을 먼저 확인한다.', videoSearchQuery: '팔로프 프레스 밴드 자세' },
  '버드독': { setup: ['네발기기 자세를 만든다.', '손은 어깨 아래, 무릎은 골반 아래에 둔다.', '허리는 중립을 유지한다.'], movement: ['반대쪽 팔과 다리를 천천히 뻗는다.', '골반이 돌아가지 않게 유지한다.', '천천히 돌아온 뒤 반대쪽 진행한다.'], breathing: '뻗을 때 내쉬고 돌아올 때 들이쉰다.', target: '코어 안정성, 엉덩이, 등', commonMistakes: ['허리가 꺼짐', '다리를 너무 높이 듦', '골반이 옆으로 돌아감', '속도를 너무 빠르게 냄'], stopCriteria: ['허리 통증', '다리 저림', '균형이 무너져 반복 유지 불가'], keyPoint: '높이보다 골반과 허리가 흔들리지 않는 것이 우선이다.', videoUrl: 'https://www.youtube.com/watch?v=xEDnlOxeJH4', videoSearchQuery: '버드독 자세' },
  '보조 리버스 런지': { setup: ['벽, 의자 또는 단단한 지지대를 잡는다.', '발은 골반 너비로 선다.', '몸통을 세우고 배에 힘을 준다.'], movement: ['한쪽 다리를 뒤로 짧게 보낸다.', '앞쪽 무릎이 안쪽으로 무너지지 않게 한다.', '통증 없는 범위까지만 내려간다.', '앞발로 바닥을 밀어 시작 자세로 돌아온다.'], breathing: '내려갈 때 들이쉬고 올라올 때 내쉰다.', target: '엉덩이, 허벅지 앞쪽, 균형감각', commonMistakes: ['뒤로 너무 멀리 보냄', '앞 무릎이 안쪽으로 무너짐', '통증을 참고 깊게 내려감'], stopCriteria: ['날카로운 무릎 통증', '허리 통증', '어지러움'], keyPoint: '지지대를 잡고 짧은 범위부터 안정적으로 반복한다.', videoSearchQuery: '리버스 런지 초보 자세' },
  'AB 슬라이드': { setup: ['무릎을 바닥에 댄다.', '배와 엉덩이에 힘을 준다.', '어깨 아래에 손잡이 또는 롤러를 둔다.'], movement: ['짧은 범위만 앞으로 민다.', '허리가 꺼지지 않게 한다.', '통증 또는 허리 꺼짐이 생기면 즉시 버드독으로 복귀한다.'], breathing: '앞으로 밀 때 들이쉬고 돌아올 때 내쉰다.', target: '복부와 몸통 안정성', commonMistakes: ['처음부터 멀리 밀기', '허리가 아래로 꺼짐', '통증을 참고 반복'], stopCriteria: ['허리 통증', '다리 저림', '허리 꺼짐 유지'], keyPoint: '조건 충족 시에만 짧은 범위로 진행하고 이상하면 버드독으로 복귀한다.', videoSearchQuery: '무릎 AB 슬라이드 자세' },
  '2단계 전신 서킷': { setup: ['고블릿 스쿼트, 랫풀다운, 플로어 프레스, 힙 브릿지, 풀어파트 도구를 순서대로 준비한다.', '운동 사이 이동 동선을 정리한다.', '각 동작은 통증 없는 범위와 기존 자세 기준을 따른다.'], movement: ['고블릿 스쿼트 10회', '랫풀다운 12회', '플로어 프레스 10회', '힙 브릿지 15회', '풀어파트 15회', '운동 사이 15초, 라운드 간 60초 쉰다.'], breathing: '각 동작의 힘쓰는 구간에서 내쉬고, 이동 중에는 호흡을 정리한다.', target: '하체, 등, 가슴, 엉덩이, 어깨 뒤쪽, 전신 지구력', commonMistakes: ['라운드 속도에 쫓겨 자세가 무너짐', '도구 고정을 확인하지 않음', '휴식 없이 무리하게 이어감'], stopCriteria: ['허리 통증', '어깨 통증', '날카로운 무릎 통증', '어지러움'], keyPoint: '서킷은 빠르게 끝내는 것이 아니라 각 동작 자세를 지키며 이어가는 것이 목표다.', videoSearchQuery: '초보 전신 서킷 운동 자세' }
};

const getGuide = (name: string): ExerciseGuide => {
  const guide = Object.entries(GUIDE_LIBRARY).find(([key]) => name.includes(key))?.[1];
  if (guide) return { ...guide, videoUrl: guide.videoUrl ?? youtubeSearchUrl(guide.videoSearchQuery ?? `${name} 자세 초보`) };
  const query = `${name} 자세 초보`;
  return {
    setup: ['주변을 정리하고 필요한 도구를 안전하게 준비한다.', '발은 안정적으로 두고 배에 가볍게 힘을 준다.', '통증 없는 범위에서 시작할 준비를 한다.'],
    movement: ['첫 반복은 작은 범위로 천천히 확인한다.', '목표 부위에 힘이 들어오는지 확인하며 반복한다.', '자세가 무너지면 속도와 범위를 줄인다.'],
    breathing: '힘을 쓰는 구간에서 내쉬고 돌아오는 구간에서 들이쉰다.',
    target: '해당 운동의 주요 근육과 몸통 안정성',
    commonMistakes: ['처음부터 너무 빠르게 진행함', '통증을 참고 반복함', '호흡을 참음'],
    stopCriteria: ['허리 통증', '날카로운 관절 통증', '저림', '어지러움'],
    keyPoint: '통증 없는 범위와 안정적인 자세를 우선한다.',
    videoSearchQuery: query,
    videoUrl: youtubeSearchUrl(query),
  };
};

export const SAFETY_STOP_MESSAGE = '허리 통증, 다리 저림, 날카로운 무릎 통증 또는 어지러움이 있으면 즉시 중단하세요.';

const flow: FlowItem[] = [
  { icon:'🧘', label:'워밍업', time:'5~8분', bgColor:'#EEEDFE', labelColor:'#3C3489', timeColor:'#534AB7' },
  { icon:'💪', label:'본운동', time:'30분', bgColor:'#E6F1FB', labelColor:'#0C447C', timeColor:'#185FA5' },
  { icon:'🌿', label:'정리운동', time:'5분', bgColor:'#EAF3DE', labelColor:'#27500A', timeColor:'#3B6D11' },
];
const tip = (text:string): Detail => ({ type:'purple', text });
const mk = (name:string, meta:string, guide:string, sets=3, restSeconds=45, intervalPlan?:IntervalPlan, abSlideGate=false): Exercise => ({ name, meta, sets, restSeconds, intervalPlan, abSlideGate, guide: getGuide(name), details:[tip(guide)] });
const sliding = (name:string, meta:string, guide:string, intervalPlan:IntervalPlan): Exercise => mk(name, meta, guide, 0, 0, intervalPlan);
const phases = (exercises:Exercise[], alert?:string): Phase[] => [
  { id:'warmup', icon:'🧘', title:'워밍업', subtitle:'5~8분 · 본운동 시간 제외', exercises:[mk('관절 가동성 + 가벼운 제자리 걷기','5~8분','어깨·고관절·발목을 부드럽게 풀고 숨이 살짝 오를 정도로만 진행합니다.',0,0)] },
  { id:'main', icon:'💪', title:'본운동', subtitle:'30분 기준 · 세트 30~60초 / 라운드 60~90초', alert: alert ? {variant:'yellow', text:alert} : undefined, exercises },
  { id:'cooldown', icon:'🌿', title:'정리운동', subtitle:'5분 · 본운동 시간 제외', exercises:[mk('호흡 정리 + 하체/등 스트레칭','5분','호흡을 낮추고 햄스트링·둔근·등을 통증 없는 범위에서 천천히 늘립니다.',0,0)] },
];
const day = (id:string, tabLabel:string, emoji:string, title:string, subtitle:string, exercises:Exercise[], color:string, alert?:string): DayWorkout => ({ id, tabLabel, emoji, title, subtitle, totalTime:'본운동 30분', badgeBg:color, dayColor:color, flow, phases:phases(exercises, alert) });

export const ADAPTATION_WORKOUTS: Record<Exclude<SwitchOnSelection,'base'>, DayWorkout> = {
  adapt1: day('adapt1','적응 1일차','🌱','적응 1일차 — 상체 활성화 + 슬라이딩보드','강도는 중간 이하. 강하게 구간도 컨디션에 따라 중간으로 낮추세요.',[
    sliding('슬라이딩보드 가볍게','40초 가볍게 + 20초 천천히 × 8회 · 총 8분','허리를 숙이지 말고 다리와 엉덩이로 밀기',{rounds:8,segments:[{label:'가볍게',seconds:40,intensity:'가볍게~중간'},{label:'천천히',seconds:20,intensity:'회복'}]}),
    mk('롱밴드 랫풀다운','12회 × 3세트 · 휴식 45초','밴드를 철봉에 고정하고 팔꿈치를 아래·뒤로 당깁니다.'), mk('롱밴드 로우','12회 × 3세트 · 휴식 45초','팔보다 등을 먼저 조인다는 느낌으로 당깁니다.'), mk('덤벨 플로어 프레스','10회 × 3세트 · 휴식 45초','바닥에 누워 팔꿈치가 바닥에 닿을 때까지만 내립니다.'), mk('루프밴드 풀어파트','15회 × 3세트 · 휴식 30초','가슴 높이에서 밴드를 양옆으로 벌립니다.',3,30), mk('발 보조 매달리기','20초 × 3세트 · 휴식 40초','발끝을 바닥이나 의자에 두고 체중 일부만 싣습니다.',3,40)
  ], '#639922'),
  adapt2: day('adapt2','적응 2일차','🌿','적응 2일차 — 하체·엉덩이 + 슬라이딩보드','강도는 중간 이하로 유지하세요.',[
    sliding('슬라이딩보드 중간','1분 중간 + 30초 느리게 × 6회 · 총 9분','속도보다 하체로 밀어내는 자세를 우선합니다.',{rounds:6,segments:[{label:'중간',seconds:60,intensity:'중간'},{label:'느리게',seconds:30,intensity:'회복'}]}),
    mk('고블릿 스쿼트','10회 × 3세트 · 휴식 60초','엉덩이를 뒤로 보내고 허리 중립을 유지합니다.',3,60), mk('힙 브릿지','15회 × 3세트 · 휴식 45초','엉덩이를 들어 올리고 허리 과신전은 피합니다.'), mk('루프밴드 사이드 워크','좌우 10걸음 × 3세트 · 휴식 30초','무릎이 안쪽으로 모이지 않게 걷습니다.',3,30), mk('루프밴드 몬스터 워크','앞뒤 10걸음 × 2세트 · 휴식 30초','작은 보폭으로 천천히 이동합니다.',2,30), mk('힙 브릿지 홀드','20초 × 3회 · 휴식 20초','엉덩이 힘을 유지하고 허리를 꺾지 않습니다.',3,20)
  ], '#639922'),
  adapt3: day('adapt3','적응 3일차','🏂','적응 3일차 — 슬라이딩보드 중심 유산소','강하게 구간도 컨디션에 따라 중간으로 낮출 수 있습니다.',[
    sliding('슬라이딩보드 30분 구간 타이머','5분 가볍게 → 10분 중간 반복 → 10분 강하게 반복 → 5분 마무리','자세가 무너지면 즉시 강도를 낮춥니다.',{segments:[{label:'가볍게 적응',seconds:300,intensity:'가볍게'},{label:'중간',seconds:60,intensity:'중간'},{label:'느리게',seconds:30,intensity:'회복'},{label:'중간',seconds:60,intensity:'중간'},{label:'느리게',seconds:30,intensity:'회복'},{label:'중간 반복',seconds:420,intensity:'중간'},{label:'강하게',seconds:40,intensity:'강하게 또는 중간'},{label:'천천히',seconds:20,intensity:'회복'},{label:'강하게 반복',seconds:540,intensity:'강하게 또는 중간'},{label:'가볍게 마무리',seconds:300,intensity:'가볍게'}]})
  ], '#EF9F27')
};

export const WORKOUTS: DayWorkout[] = [
  day('mon','월요일','💪','월요일 — 상체 + 슬라이딩보드','상체 당기기·밀기와 8분 슬라이딩보드', [sliding('슬라이딩보드 중간','40초 운동 + 20초 회복 × 8회 · 총 8분','다리와 엉덩이로 밀고 상체는 과하게 숙이지 않습니다.',{rounds:8,segments:[{label:'운동',seconds:40,intensity:'중간'},{label:'회복',seconds:20,intensity:'느리게'}]}), mk('롱밴드 랫풀다운','12회 × 3세트 · 휴식 45초','팔꿈치를 아래·뒤로 당겨 광배를 조입니다.'), mk('롱밴드 로우','12회 × 3세트 · 휴식 45초','가슴을 열고 등을 먼저 조입니다.'), mk('덤벨 플로어 프레스','10~12회 × 3세트 · 휴식 45초','마지막 2~3회가 힘들지만 자세 유지되는 중량을 씁니다.'), mk('루프밴드 풀어파트','15회 × 3세트 · 휴식 30초','승모근 힘을 빼고 가슴 높이에서 벌립니다.',3,30), mk('발 보조 매달리기','20~30초 × 3세트 · 휴식 40초','발로 체중을 보조해 어깨에 무리가 없게 버팁니다.',3,40)], '#534AB7'),
  day('tue','화요일','🦵','화요일 — 하체·중둔근 + 슬라이딩보드','하체와 엉덩이 안정화', [sliding('슬라이딩보드 중간','1분 중간 + 30초 느리게 × 6회 · 총 9분','좌우 균형을 맞춰 밀어냅니다.',{rounds:6,segments:[{label:'중간',seconds:60,intensity:'중간'},{label:'느리게',seconds:30,intensity:'회복'}]}), mk('고블릿 스쿼트','10~12회 × 3세트 · 휴식 60초','허리 중립을 유지하고 무릎이 안쪽으로 모이지 않게 합니다.',3,60), mk('힙 브릿지','15회 × 3세트 · 휴식 45초','정점에서 엉덩이를 조이고 허리 과신전은 피합니다.'), mk('루프밴드 사이드 워크','좌우 12걸음 × 3세트 · 휴식 30초','골반 높이를 유지하고 천천히 걷습니다.',3,30), mk('루프밴드 몬스터 워크','앞뒤 10걸음 × 2세트 · 휴식 30초','작은 보폭으로 밴드 장력을 유지합니다.',2,30), mk('루프밴드 힙 브릿지','15회 × 2세트 · 휴식 30초','무릎을 살짝 바깥으로 밀며 엉덩이를 씁니다.',2,30)], '#639922'),
  day('thu','목요일','🔁','목요일 — 전신 서킷 + 슬라이딩보드','3라운드 전신 서킷', [sliding('1단계 슬라이딩보드','40초 중간 강도 + 20초 회복 × 8회 · 총 8분','중간 강도로 몸을 올립니다.',{rounds:8,segments:[{label:'중간 강도',seconds:40,intensity:'중간'},{label:'회복',seconds:20,intensity:'느리게'}]}), mk('2단계 전신 서킷','3라운드 · 운동 사이 15초 / 라운드 간 60초','고블릿 스쿼트 10회 → 랫풀다운 12회 → 플로어 프레스 10회 → 힙 브릿지 15회 → 풀어파트 15회.',3,60), mk('버드독','좌우 8회 × 2세트 · 휴식 30초','골반이 흔들리지 않게 반대 팔·다리를 뻗습니다.',2,30)], '#378ADD'),
  day('fri','금요일','⚡','금요일 — 슬라이딩보드 집중 + 코어 안정화','유산소와 코어 안정화', [sliding('슬라이딩보드 인터벌','1분 중간 + 30초 느리게 × 8회 · 총 12분','호흡을 유지하고 자세가 무너지면 속도를 낮춥니다.',{rounds:8,segments:[{label:'중간',seconds:60,intensity:'중간'},{label:'느리게',seconds:30,intensity:'회복'}]}), mk('롱밴드 페이스풀','15회 × 3세트 · 휴식 45초','눈높이로 당겨 어깨 뒤쪽을 조입니다.'), mk('팔로프 프레스','좌우 10회 × 3세트 · 휴식 30초','밴드는 옆 방향으로 당겨도 풀리지 않는 안전한 고정점에 설치합니다.',3,30), mk('버드독','좌우 8회 × 3세트 · 휴식 30초','허리 비틀림 없이 천천히 반복합니다.',3,30), mk('루프밴드 힙 브릿지','15회 × 2세트 · 휴식 30초','엉덩이 힘으로 들어 올립니다.',2,30)], '#EF9F27'),
  day('sat','토요일','🔥','토요일 — 등·하체·코어 진행 + 슬라이딩보드','AB 슬라이드는 조건 충족 시에만 선택', [sliding('슬라이딩보드 중간','40초 운동 + 20초 회복 × 8회 · 총 8분','무릎을 살짝 굽히고 균일한 힘으로 미끄러집니다.',{rounds:8,segments:[{label:'운동',seconds:40,intensity:'중간'},{label:'회복',seconds:20,intensity:'느리게'}]}), mk('발 보조 매달리기','25~30초 × 3세트 · 휴식 45초','발 보조로 어깨 부담을 줄입니다.'), mk('롱밴드 랫풀다운','12회 × 3세트 · 휴식 45초','팔꿈치를 아래·뒤로 당깁니다.'), mk('보조 리버스 런지','좌우 8회 × 3세트 · 휴식 45초','의자나 벽을 잡고 무릎 통증 없는 범위만 내려갑니다.'), mk('루프밴드 사이드 워크','좌우 10걸음 × 3세트 · 휴식 30초','무릎이 안쪽으로 무너지지 않게 합니다.',3,30), mk('버드독','좌우 8회 × 2세트 · 휴식 30초','기본 코어 운동입니다. AB 슬라이드 조건 충족 시 대체 가능합니다.',2,30), mk('AB 슬라이드 진행 조건 확인','모든 조건 체크 시에만 활성화','무릎 AB 슬라이드 짧은 범위 5~8회 × 2세트. 허리가 꺼지거나 통증이 나면 즉시 버드독으로 복귀.',2,60, undefined, true)], '#E24B4A'),
];

export const WEEK_OVERVIEW = {
  stats:[{label:'운동일',value:'5',unit:'일',sub:'월·화·목·금·토'},{label:'본운동',value:'30',unit:'분',sub:'매 운동일'},{label:'휴식',value:'2',unit:'일',sub:'수·일'},{label:'유산소',value:'매일',unit:'',sub:'슬라이딩보드'}],
  days:[{day:'월',emoji:'💪',label:'상체',sub:'보드',time:'30분',active:true,tabId:'mon',color:'#534AB7',bg:'#EEEDFE',border:'#AFA9EC'},{day:'화',emoji:'🦵',label:'하체',sub:'보드',time:'30분',active:true,tabId:'tue',color:'#639922',bg:'#EAF3DE',border:'#B7D88B'},{day:'수',emoji:'🌿',label:'휴식',sub:'회복',time:'휴식',active:false},{day:'목',emoji:'🔁',label:'전신',sub:'서킷',time:'30분',active:true,tabId:'thu',color:'#378ADD',bg:'#E6F1FB',border:'#9CCAF0'},{day:'금',emoji:'⚡',label:'코어',sub:'보드',time:'30분',active:true,tabId:'fri',color:'#EF9F27',bg:'#FAEEDA',border:'#F3C276'},{day:'토',emoji:'🔥',label:'진행',sub:'선택',time:'30분',active:true,tabId:'sat',color:'#E24B4A',bg:'#FCEBEB',border:'#F1A6A6'},{day:'일',emoji:'😴',label:'휴식',sub:'회복',time:'휴식',active:false}],
  dayTimes:[{days:'월',total:'30분',detail:'상체+보드',color:'#534AB7',border:'#AFA9EC'},{days:'화',total:'30분',detail:'하체+보드',color:'#639922',border:'#B7D88B'},{days:'목',total:'30분',detail:'전신서킷',color:'#378ADD',border:'#9CCAF0'},{days:'금',total:'30분',detail:'보드+코어',color:'#EF9F27',border:'#F3C276'},{days:'토',total:'30분',detail:'진행+선택',color:'#E24B4A',border:'#F1A6A6'}]
};
export const SAFETY = { forbidden:'통증을 참고 진행하지 않기. 세트 간 휴식 30~60초, 라운드 간 휴식 60~90초를 지키고 중량은 마지막 2~3회가 힘들지만 자세는 유지되는 수준으로 선택하세요.', signals:[{label:'가볍게',action:'대화 가능',bg:'#EAF3DE',labelColor:'#3B6D11',textColor:'#27500A'},{label:'중간',action:'짧은 문장은 가능하지만 숨이 참',bg:'#E6F1FB',labelColor:'#185FA5',textColor:'#0C447C'},{label:'강하게',action:'긴 대화가 어려울 정도. 자세는 유지',bg:'#FAEEDA',labelColor:'#854F0B',textColor:'#633806'}], cpap: SAFETY_STOP_MESSAGE };
export const DIET = { meals:[
  { label:'아침', bg:'#EAF3DE', color:'#27500A', items:[{icon:'🥚', text:'단백질 반찬과 채소를 먼저 먹고 탄수화물은 활동량에 맞춰 조절합니다.'}] },
  { label:'점심', bg:'#E6F1FB', color:'#0C447C', items:[{icon:'🍚', text:'밥 반~2/3공기 + 닭가슴살 150~200g 또는 생선/두부 등 단백질.'}] },
  { label:'저녁', bg:'#FAEEDA', color:'#633806', items:[{icon:'🥗', text:'채소와 단백질 중심으로 가볍게, 운동 후 과식은 피합니다.'}] },
] };
