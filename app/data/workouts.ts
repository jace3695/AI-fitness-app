export type BadgeVariant = 'yellow' | 'green' | 'blue' | 'purple' | 'red';
export type PhaseType = 'warmup' | 'main' | 'sliding' | 'cooldown';
export type AlertType = 'yellow' | 'green' | 'blue' | 'purple';
export type BulletType = 'purple' | 'red' | 'green';
export type SwitchOnSelection = 'adapt1' | 'adapt2' | 'adapt3' | 'base';

export interface Detail { type: BulletType | 'step' | 'warn' | 'good' | 'text'; text: string; stepNum?: number }
export interface IntervalRow { weeks: string; pattern: string; total: string }
export interface IntervalSegment { label: string; seconds: number; intensity: string }
export interface IntervalPlan { rounds?: number; segments: IntervalSegment[] }
export interface Exercise {
  name: string; meta?: string; badge?: { label: string; variant: BadgeVariant }; details: Detail[];
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
  '가볍게: 대화 가능', '중간: 짧은 문장은 가능하지만 숨이 참', '강하게: 긴 대화가 어려울 정도로 숨이 참. 단, 자세는 무너지지 않아야 함',
];
export const SAFETY_STOP_MESSAGE = '허리 통증, 다리 저림, 날카로운 무릎 통증 또는 어지러움이 있으면 즉시 중단하세요.';

const flow: FlowItem[] = [
  { icon:'🧘', label:'워밍업', time:'5~8분', bgColor:'#EEEDFE', labelColor:'#3C3489', timeColor:'#534AB7' },
  { icon:'💪', label:'본운동', time:'30분', bgColor:'#E6F1FB', labelColor:'#0C447C', timeColor:'#185FA5' },
  { icon:'🌿', label:'정리운동', time:'5분', bgColor:'#EAF3DE', labelColor:'#27500A', timeColor:'#3B6D11' },
];
const tip = (text:string): Detail => ({ type:'purple', text });
const mk = (name:string, meta:string, guide:string, sets=3, restSeconds=45, intervalPlan?:IntervalPlan, abSlideGate=false): Exercise => ({ name, meta, sets, restSeconds, intervalPlan, abSlideGate, details:[tip(guide)] });
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
