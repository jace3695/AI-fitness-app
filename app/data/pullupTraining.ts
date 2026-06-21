export const PULLUP_PROGRESS_KEY = 'ai-fitness-pullup-progress';

export interface PullupStageCheck {
  todayCompleted: boolean;
  targetSetsCompleted: boolean;
  painFree: boolean;
  promotionReady: boolean;
  completedCount: number;
  maxSeconds?: number;
  maxReps?: number;
}

export interface PullupProgress {
  currentStage: number;
  stageChecks: Record<string, PullupStageCheck>;
  updatedAt: string;
}

export interface PullupStage {
  id: number;
  title: string;
  goal: string[];
  prescription: string;
  rest: string;
  keyPoint: string;
  setup: string[];
  movement: string[];
  breathing: string;
  target: string;
  commonMistakes: string[];
  stopCriteria: string[];
  nextCondition: string[];
  videoQuery: string;
}

const stopCriteria = ['어깨 통증', '팔꿈치 통증', '팔 저림', '목 통증', '허리 통증', '어지러움'];
const youtubeSearchUrl = (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

export const PULLUP_STAGES: PullupStage[] = [
  { id: 1, title: '발 보조 매달리기', goal: ['손 grip 적응', '어깨 안정화', '철봉 매달리기 적응'], prescription: '15~30초 × 3세트', rest: '세트 간 휴식 40초', keyPoint: '발로 체중 일부를 지지하고 어깨를 귀에서 멀리 내린 채 매달립니다.', setup: ['철봉을 어깨너비보다 살짝 넓게 잡습니다.', '발끝을 바닥 또는 의자에 두어 체중 일부를 지지합니다.', '체중 전부를 철봉에 싣지 않고 팔·어깨 부담을 낮춥니다.'], movement: ['가슴을 가볍게 열고 몸이 흔들리지 않게 합니다.', '어깨를 귀에서 멀리 내리는 느낌을 유지합니다.', '15초부터 시작해 통증 없이 30초까지 늘립니다.'], breathing: '짧게 참지 말고 코로 들이쉬고 입으로 길게 내쉽니다.', target: '손 grip, 전완, 어깨 안정성, 광배근 시작 감각', commonMistakes: ['체중 전부를 갑자기 철봉에 싣기', '어깨가 귀 쪽으로 올라간 채 버티기', '발 보조 없이 오래 버티려 하기'], stopCriteria, nextCondition: ['발 보조 매달리기 30초 × 3세트 가능', '어깨 통증, 팔 저림, 허리 불편감 없음'], videoQuery: '철봉 발 보조 매달리기 자세' },
  { id: 2, title: '발 보조 견갑 풀업', goal: ['팔꿈치를 굽히지 않고 견갑을 아래로 끌어내리는 감각 익히기', '등으로 턱걸이 시작하는 패턴 만들기'], prescription: '5~8회 × 2~3세트', rest: '세트 간 휴식 45초', keyPoint: '팔꿈치를 편 상태로 어깨만 아래로 끌어내려 몸을 몇 cm만 올립니다.', setup: ['철봉을 잡고 발은 바닥 또는 의자에 둡니다.', '팔꿈치를 최대한 편 상태로 시작합니다.', '처음에는 어깨가 자연스럽게 올라간 위치를 확인합니다.'], movement: ['팔꿈치를 굽히지 않고 어깨를 아래로 천천히 끌어내립니다.', '몸이 몇 cm만 올라가도 정상입니다.', '천천히 어깨를 시작 위치로 되돌립니다.'], breathing: '어깨를 내릴 때 내쉬고 돌아올 때 들이쉽니다.', target: '하부 승모근, 광배근, 견갑 안정성', commonMistakes: ['팔꿈치를 굽혀 작은 턱걸이처럼 하기', '목에 힘을 주고 어깨를 으쓱하기', '반동으로 몸을 흔들기'], stopCriteria, nextCondition: ['8회 × 3세트 가능', '어깨 통증, 목 통증, 팔 저림 없음'], videoQuery: '견갑 풀업 초보 자세' },
  { id: 3, title: '밴드 보조 턱걸이', goal: ['실제 턱걸이 동작 패턴 익히기', '등과 팔 협응 만들기'], prescription: '3~5회 × 3세트', rest: '세트 간 휴식 60~90초', keyPoint: '밴드 보조를 받되 반동 없이 가슴을 철봉 쪽으로 가져갑니다.', setup: ['밴드를 철봉 중앙에 단단히 걸고 고정 상태를 확인합니다.', '밴드에 무릎 또는 발을 넣습니다.', '시작 전 어깨를 먼저 아래로 내립니다.'], movement: ['가슴을 철봉 쪽으로 가져간다는 느낌으로 당깁니다.', '가능한 범위까지만 올라간 뒤 천천히 내려옵니다.', '마지막 반복까지 반동 없이 자세를 유지합니다.'], breathing: '당길 때 내쉬고 내려올 때 들이쉽니다.', target: '광배근, 등 중앙, 이두근, 견갑 안정성', commonMistakes: ['밴드 고정 확인 없이 시작하기', '하체 반동으로 튀어 오르기', '팔로만 당기고 어깨가 올라가기'], stopCriteria, nextCondition: ['밴드 보조 턱걸이 5회 × 3세트 가능', '마지막 반복도 자세 유지 가능', '어깨, 팔꿈치, 허리 통증 없음'], videoQuery: '밴드 보조 턱걸이 초보 자세' },
  { id: 4, title: '네거티브 턱걸이', goal: ['턱걸이 하강 제어력 만들기', '맨몸 턱걸이를 위한 힘 준비'], prescription: '3~5초 하강 × 2~4회 · 총 2~3세트', rest: '세트 간 휴식 60~90초', keyPoint: '턱이 철봉 위인 위치에서 시작해 3~5초 동안 천천히 내려옵니다.', setup: ['의자나 발판으로 턱이 철봉 위에 있는 위치를 만듭니다.', '어깨가 귀 쪽으로 올라가지 않게 준비합니다.', '복부에 가볍게 힘을 줘 허리 꺾임을 막습니다.'], movement: ['발판에서 체중을 조심히 철봉으로 옮깁니다.', '3~5초 동안 일정한 속도로 내려옵니다.', '완전히 내려온 뒤 다시 발판을 사용해 시작 위치로 이동합니다.'], breathing: '내려오는 동안 길게 내쉬고 다시 올라갈 때 호흡을 정리합니다.', target: '광배근, 등 중앙, 팔, 하강 제어력', commonMistakes: ['점프 후 빠르게 떨어지기', '허리를 꺾고 갈비뼈를 들기', '어깨가 귀로 올라간 채 버티기'], stopCriteria, nextCondition: ['5초 하강 × 3회 이상 가능', '2~3세트 동안 자세 유지', '통증 없음'], videoQuery: '네거티브 턱걸이 초보 자세' },
  { id: 5, title: '맨몸 턱걸이 도전', goal: ['맨몸 턱걸이 1회 성공부터 시작'], prescription: '1회 시도 × 3~5번', rest: '시도 사이 휴식 90초', keyPoint: '1회 성공이 목표이며 성공 후에도 무리하게 반복 수를 늘리지 않습니다.', setup: ['철봉을 안정적으로 잡고 몸 흔들림을 멈춥니다.', '시작 전에 어깨를 아래로 세팅합니다.', '복부에 가볍게 힘을 줘 허리 꺾임을 막습니다.'], movement: ['반동 없이 가슴을 철봉 쪽으로 당깁니다.', '턱만 억지로 넘기지 말고 몸 전체를 안정적으로 올립니다.', '실패 후에는 밴드 보조 턱걸이 또는 네거티브로 보조 훈련합니다.'], breathing: '당길 때 내쉬고 내려올 때 들이쉽니다.', target: '광배근, 등 전체, 팔, 코어 안정성', commonMistakes: ['반동으로 시작하기', '목만 빼서 턱을 넘기기', '1회 성공 후 바로 많은 반복에 도전하기'], stopCriteria, nextCondition: ['맨몸 턱걸이 1회 이상 성공', '시도 사이 90초 휴식 유지', '어깨, 팔꿈치, 목, 허리 통증 없음'], videoQuery: '턱걸이 초보 자세' },
];

export const getPullupVideoUrl = (query: string) => youtubeSearchUrl(query);

const makeDefaultStageCheck = (): PullupStageCheck => ({ todayCompleted: false, targetSetsCompleted: false, painFree: true, promotionReady: false, completedCount: 0, maxSeconds: 0, maxReps: 0 });
export const createDefaultPullupProgress = (): PullupProgress => ({ currentStage: 1, stageChecks: Object.fromEntries(PULLUP_STAGES.map((stage) => [`stage${stage.id}`, makeDefaultStageCheck()])), updatedAt: new Date().toISOString().slice(0, 10) });
