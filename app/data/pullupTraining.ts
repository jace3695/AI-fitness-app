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
  exercises: string[];
}

const stopCriteria = ['어깨 통증', '팔꿈치 통증', '팔 저림', '목 통증', '허리 통증', '어지러움'];
const youtubeSearchUrl = (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

export const PULLUP_STAGES: PullupStage[] = [
  { id: 1, title: '매일 턱걸이 초기자세 3~5분', exercises: ['철봉 잡고 서기', '견갑 내리기 연습', '발 보조 매달리기'], goal: ['철봉 잡는 자세 익히기', '발 보조 매달리기 적응', '견갑을 아래로 내리는 감각 만들기'], prescription: '철봉 잡고 서기 10초 × 2회 → 발 보조 매달리기 10~20초 × 2회 → 견갑 내리기 5회 × 2세트', rest: '동작 사이 20~40초, 피로하면 바로 종료', keyPoint: '매일 가능하지만 최대 버티기나 실패 지점까지 반복하는 운동이 아닙니다. 3~5분 정도 자세를 익히는 연습으로 진행하세요.', setup: ['철봉을 편하게 잡고 발은 바닥 또는 의자에 둡니다.', '체중 전부를 싣지 않고 어깨를 귀에서 멀리 둡니다.', '허리를 과하게 젖히지 않고 갈비뼈를 가볍게 내립니다.'], movement: ['철봉 잡고 서기 10초를 2회 진행합니다.', '발 보조 매달리기는 10~20초씩 2회만 진행합니다.', '견갑 내리기는 어깨를 귀에서 멀어지게 내리는 느낌으로 5회씩 2세트 진행합니다.'], breathing: '짧게 참지 말고 편안하게 호흡합니다.', target: '손 grip, 전완, 어깨 안정성, 광배근 시작 감각', commonMistakes: ['오래 매달리기 최대치 도전', '매번 실패 지점까지 버티기', '반동 턱걸이', '어깨 통증을 참고 진행', '허리를 과하게 젖힌 상태로 매달리기'], stopCriteria, nextCondition: ['통증 없이 3~5분 자세 연습 완료', '다음날 어깨·팔꿈치·허리 불편감 없음'], videoQuery: '턱걸이 초보 견갑 내리기 발 보조 매달리기' },
  { id: 2, title: '발 보조 매달리기 강화', exercises: ['발 보조 매달리기', '견갑 내리기', '밴드 로우'], goal: ['발 보조로 안정적으로 버티기', '견갑 하강 반복 익히기'], prescription: '발 보조 매달리기 15~25초 × 2회 → 견갑 내리기 6회 × 2세트 → 밴드 로우 10회 × 2세트', rest: '세트 사이 40~60초', keyPoint: '발 보조를 유지한 채 어깨가 귀로 올라가지 않는 느낌을 우선합니다.', setup: ['철봉을 잡고 발은 바닥 또는 의자에 둡니다.', '어깨를 귀에서 멀리 둡니다.'], movement: ['발로 체중 일부를 지지하며 매달립니다.', '견갑을 아래로 당긴 뒤 천천히 돌아옵니다.', '밴드 로우는 팔보다 등을 먼저 조입니다.'], breathing: '당길 때 내쉬고 돌아올 때 들이쉽니다.', target: '광배근, 등 위쪽, 전완', commonMistakes: ['발 보조를 너무 빨리 줄임', '어깨를 으쓱함'], stopCriteria, nextCondition: ['통증 없이 목표 세트 완료', '다음날 어깨·팔꿈치 불편감 없음'], videoQuery: '턱걸이 초보 밴드 로우 견갑 내리기' },
  { id: 3, title: '발 보조 액티브 행', exercises: ['발 보조 액티브 행', '짧은 매달리기', '밴드 랫풀다운'], goal: ['등으로 몸을 살짝 끌어올리는 감각 만들기'], prescription: '발 보조 액티브 행 5회 × 2세트 → 짧은 매달리기 10초 × 2회 → 밴드 랫풀다운 10회 × 2세트', rest: '세트 사이 60초', keyPoint: '팔로 억지로 당기지 말고 발 보조와 등 수축으로 작은 범위만 진행합니다.', setup: ['발 보조를 안정적으로 둡니다.', '갈비뼈를 내리고 허리를 꺾지 않습니다.'], movement: ['견갑을 내린 뒤 몸을 아주 작게 당깁니다.', '통제된 범위에서 천천히 내려옵니다.'], breathing: '당길 때 내쉽니다.', target: '광배근, 견갑 안정성', commonMistakes: ['반동 사용', '허리 과신전'], stopCriteria, nextCondition: ['작은 범위 액티브 행을 통증 없이 수행'], videoQuery: '발 보조 턱걸이 액티브 행' },
  { id: 4, title: '상단 버티기와 천천히 내려오기', exercises: ['발 보조 턱걸이 상단 버티기', '천천히 내려오기', '밴드 랫풀다운'], goal: ['상단 자세와 네거티브를 안전하게 경험'], prescription: '주 2~3회 권장 · 상단 버티기 5초 × 2회 → 천천히 내려오기 2~3초 × 2회 → 밴드 랫풀다운 10회 × 2세트', rest: '세트 사이 60~90초', keyPoint: '4단계부터는 매일 하지 말고 주 2~3회만 진행합니다.', setup: ['의자나 발 보조로 상단 위치에 안전하게 올라갑니다.'], movement: ['상단에서 어깨를 귀에서 멀리 둡니다.', '통증 없는 범위에서 천천히 내려옵니다.'], breathing: '버티는 동안 짧게 참지 말고 내쉽니다.', target: '등, 이두, 견갑 안정성', commonMistakes: ['점프해서 올라감', '매일 네거티브 수행'], stopCriteria, nextCondition: ['주 2~3회 빈도로 통증 없이 수행'], videoQuery: '턱걸이 네거티브 초보 발 보조' },
  { id: 5, title: '밴드 보조 턱걸이', exercises: ['밴드 보조 턱걸이', '발 보조 턱걸이', '상단 자세 유지'], goal: ['첫 턱걸이에 가까운 패턴 연습'], prescription: '주 2~3회 권장 · 밴드 보조 턱걸이 2~4회 × 2세트 → 발 보조 턱걸이 3회 × 2세트 → 상단 자세 유지 5초 × 2회', rest: '세트 사이 90초 이상', keyPoint: '5단계도 매일 진행하지 말고 주 2~3회만, 실패 지점 전 종료합니다.', setup: ['밴드와 철봉 고정 상태를 확인합니다.', '발판을 가까이 둡니다.'], movement: ['밴드 보조로 통제 가능한 반복만 수행합니다.', '상단에서 어깨가 올라가지 않게 유지합니다.'], breathing: '당길 때 내쉬고 내려갈 때 들이쉽니다.', target: '광배근, 이두, 전완, 코어 안정성', commonMistakes: ['실패 지점까지 반복', '밴드 고정 확인 생략'], stopCriteria, nextCondition: ['보조 반복을 통증 없이 안정적으로 수행'], videoQuery: '밴드 보조 턱걸이 초보' },
];

export const getPullupVideoUrl = (query: string) => youtubeSearchUrl(query);

const makeDefaultStageCheck = (): PullupStageCheck => ({ todayCompleted: false, targetSetsCompleted: false, painFree: true, promotionReady: false, completedCount: 0, maxSeconds: 0, maxReps: 0 });
export const createDefaultPullupProgress = (): PullupProgress => ({ currentStage: 1, stageChecks: Object.fromEntries(PULLUP_STAGES.map((stage) => [`stage${stage.id}`, makeDefaultStageCheck()])), updatedAt: new Date().toISOString().slice(0, 10) });
