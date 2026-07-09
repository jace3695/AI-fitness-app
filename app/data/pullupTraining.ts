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
  { id: 1, title: '매일 턱걸이 초기자세 3~5분', goal: ['철봉 잡는 자세 익히기', '발 보조 매달리기 적응', '견갑을 아래로 내리는 감각 만들기'], prescription: '철봉 잡고 서기 10초 × 2회 → 발 보조 매달리기 10~20초 × 2회 → 견갑 내리기 5회 × 2세트 → 밴드 랫풀다운 또는 밴드 로우 10회 × 1세트', rest: '동작 사이 20~40초, 피로하면 바로 종료', keyPoint: '매일 가능하지만 최대 버티기나 실패 지점까지 반복하는 운동이 아닙니다. 3~5분 정도 자세를 익히는 연습으로 진행하세요.', setup: ['철봉을 편하게 잡고 발은 바닥 또는 의자에 둡니다.', '체중 전부를 싣지 않고 어깨를 귀에서 멀리 둡니다.', '허리를 과하게 젖히지 않고 갈비뼈를 가볍게 내립니다.'], movement: ['철봉 잡고 서기 10초를 2회 진행합니다.', '발 보조 매달리기는 10~20초씩 2회만 진행합니다.', '견갑 내리기는 어깨를 귀에서 멀어지게 내리는 느낌으로 5회씩 2세트 진행합니다.', '마지막에 밴드 랫풀다운 또는 밴드 로우 10회를 1세트만 진행합니다.'], breathing: '짧게 참지 말고 편안하게 호흡합니다.', target: '손 grip, 전완, 어깨 안정성, 광배근 시작 감각', commonMistakes: ['오래 매달리기 최대치 도전', '매번 실패 지점까지 버티기', '반동 턱걸이', '어깨 통증을 참고 진행', '허리를 과하게 젖힌 상태로 매달리기'], stopCriteria, nextCondition: ['통증 없이 3~5분 자세 연습 완료', '다음날 어깨·팔꿈치·허리 불편감 없음'], videoQuery: '턱걸이 초보 견갑 내리기 발 보조 매달리기' },
];

export const getPullupVideoUrl = (query: string) => youtubeSearchUrl(query);

const makeDefaultStageCheck = (): PullupStageCheck => ({ todayCompleted: false, targetSetsCompleted: false, painFree: true, promotionReady: false, completedCount: 0, maxSeconds: 0, maxReps: 0 });
export const createDefaultPullupProgress = (): PullupProgress => ({ currentStage: 1, stageChecks: Object.fromEntries(PULLUP_STAGES.map((stage) => [`stage${stage.id}`, makeDefaultStageCheck()])), updatedAt: new Date().toISOString().slice(0, 10) });
