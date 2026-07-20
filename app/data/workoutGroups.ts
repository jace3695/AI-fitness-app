import { DayWorkout, Detail, Exercise, FlowItem, Phase, SAFETY_STOP_MESSAGE } from './workouts';
import { getExerciseGuide } from './exerciseGuides';

export type WorkoutGroupCategory = 'cardio' | 'core' | 'strength' | 'recovery' | 'rest';
export type WorkoutIntensity = 'low' | 'medium' | 'high';
export type WorkoutGroupExercise = { exerciseId: string; name?: string; sets?: string; duration?: string; description?: string; cautions?: string[]; optional?: boolean };
export type CardioOption = { id: string; name: string; duration: string; description: string; exerciseIds: string[] };
export type BaseWorkoutGroup = { id: string; name: string; category: WorkoutGroupCategory; goal: string; duration: string; intensity: WorkoutIntensity; exercises: WorkoutGroupExercise[]; type?: 'routine' };
export type OptionalCardioGroup = { id: 'optional-cardio'; name: '선택 유산소'; category: 'cardio'; goal: string; duration: string; intensity: 'low'; type: 'choice'; warmupExerciseIds: string[]; options: CardioOption[]; cooldownExerciseIds: string[] };
export type WorkoutGroup = BaseWorkoutGroup | OptionalCardioGroup;

const COMMON_STOP_CAUTIONS = ['허리 통증', '다리 저림', '무릎 통증', '어지럼', '손떨림', '식은땀', '메스꺼움', '가슴 답답함'];

export const WORKOUT_GROUPS: WorkoutGroup[] = [
  { id: 'cardio-back-basic-week1', name: '유산소 + 허리 안정화 1주차', category: 'cardio', goal: '1주차는 허리 안정화와 유산소 적응을 우선하는 주간입니다. AB 슬라이더와 사이드 플랭크는 허리 부담이 생길 수 있으므로 1주차 기본 루틴에서는 제외합니다.', duration: '약 50~60분', intensity: 'low', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 묵주기도 슬라이딩보드', duration: '15분', description: '기도와 저강도 유산소를 함께하는 운동 전 준비 시간입니다. 묵주기도를 이어갈 수 있을 정도의 가벼운 속도로 진행하세요.' }, { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회 × 2세트' }, { exerciseId: 'hip-bridge', name: '힙브릿지', sets: '12회 × 2세트' }, { exerciseId: 'dead-bug', name: '데드버그', sets: '좌우 6회 × 2세트' }, { exerciseId: 'cat-cow', name: '캣카우', sets: '6~8회' }, { exerciseId: 'pelvic-tilt', name: '골반 기울이기', sets: '8~10회' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '5분 또는 생략 가능', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 1주차에는 5분만 진행하고 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'cardio-back-basic', name: '유산소 + 허리 안정화', category: 'cardio', goal: '운동 재시작, 허리 부담 최소화, 체지방 감량 보조', duration: '약 50~60분', intensity: 'low', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 묵주기도 슬라이딩보드', duration: '15~20분', description: '기도와 저강도 유산소를 함께하는 운동 전 준비 시간입니다. 묵주기도를 이어갈 수 있을 정도의 가벼운 속도로 진행하세요.' }, { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회 × 2세트' }, { exerciseId: 'hip-bridge', name: '힙브릿지', sets: '12회 × 2세트' }, { exerciseId: 'dead-bug', name: '데드버그', sets: '좌우 6회 × 2세트' }, { exerciseId: 'cat-cow', name: '캣카우', sets: '6~8회' }, { exerciseId: 'pelvic-tilt', name: '골반 기울이기', sets: '8~10회' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'cardio-foam-recovery', name: '유산소 + 폼롤러 회복', category: 'recovery', goal: '피로 누적 방지, 회복, 가벼운 감량 보조', duration: '약 25~35분', intensity: 'low', exercises: [
    { exerciseId: 'rosary-sliding-board', name: '묵주기도 슬라이딩보드', duration: '15~20분', description: '아주 가볍게 · 컨디션이 좋으면 슬라이딩보드 5분을 추가할 수 있습니다.' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5~10분', description: '종아리 · 허벅지 앞 · 허벅지 바깥쪽 · 엉덩이 · 등 위쪽' }, { exerciseId: 'light-breathing', name: '가벼운 호흡', duration: '1~2분' }, { exerciseId: 'pullup-posture-only', name: '턱걸이 자세만', duration: '1~2분' },
  ] },
  { id: 'cardio-core-basic', name: '유산소 + 코어 안정화', category: 'core', goal: '허리 안정성, 복부 힘 회복, AB 슬라이더 준비', duration: '약 45~55분', intensity: 'low', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 묵주기도 슬라이딩보드', duration: '1주차 15분 · 2주차 15~20분 · 3주차 이후 20분', description: '기도와 저강도 유산소를 함께하는 운동 전 준비 시간입니다. 묵주기도를 이어갈 수 있을 정도의 가벼운 속도로 진행하세요.' }, { exerciseId: 'dead-bug', name: '데드버그', sets: '좌우 6회 × 2세트' }, { exerciseId: 'knee-side-plank', name: '무릎 사이드 플랭크', sets: '좌우 10~15초 × 2세트' }, { exerciseId: 'pelvic-tilt', name: '골반 기울이기', sets: '8~10회' }, { exerciseId: 'ab-slider-ready-position', name: 'AB 슬라이더 준비 자세', sets: '5초 버티기 × 3회', description: '무릎 대고 잡기 · 복부 힘 주기 · 1~2주차에는 표시된 준비 자세만 확인하고 앞으로 밀지 않음', cautions: ['1주차에는 AB 슬라이더를 밀지 않습니다.', '허리 통증이나 다리 저림이 있으면 AB 슬라이더와 사이드 플랭크는 제외하세요.'] }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3~5분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'lower-dumbbell-loopband', name: '하체 + 덤벨 + 루프밴드', category: 'strength', goal: '하체 근력, 엉덩이, 골반 안정화', duration: '약 50~60분', intensity: 'medium', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 묵주기도 슬라이딩보드', duration: '1주차 15분 · 2주차 15~20분 · 3주차 이후 20분', description: '기도와 저강도 유산소를 함께하는 운동 전 준비 시간입니다. 묵주기도를 이어갈 수 있을 정도의 가벼운 속도로 진행하세요.' }, { exerciseId: 'hip-bridge', name: '힙브릿지', sets: '12회 × 2세트' }, { exerciseId: 'dumbbell-goblet-squat', name: '덤벨 고블릿 스쿼트', sets: '8~10회 × 2세트', description: '5~7kg부터 시작' }, { exerciseId: 'loopband-sidewalk', name: '루프밴드 사이드워크', sets: '좌우 10걸음 × 2세트' }, { exerciseId: 'loopband-monster-walk', name: '루프밴드 몬스터워크', sets: '앞/뒤 8~10걸음 × 2세트' }, { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회 × 2세트' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3~5분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'back-band-dumbbell-row', name: '등 + 롱밴드 + 덤벨 로우', category: 'strength', goal: '등 근육, 자세 안정성, 턱걸이 준비', duration: '약 50~60분', intensity: 'medium', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 묵주기도 슬라이딩보드', duration: '1주차 15분 · 2주차 15~20분 · 3주차 이후 20분', description: '기도와 저강도 유산소를 함께하는 운동 전 준비 시간입니다. 묵주기도를 이어갈 수 있을 정도의 가벼운 속도로 진행하세요.' }, { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회 × 2세트' }, { exerciseId: 'longband-lat-pulldown', name: '롱밴드 랫풀다운', sets: '12회 × 2세트' }, { exerciseId: 'band-row', name: '밴드 로우', sets: '12회 × 2세트' }, { exerciseId: 'one-arm-dumbbell-row-supported', name: '의자/테이블 지지 원암 덤벨 로우', sets: '좌우 10회 × 2세트', description: '5~7kg부터 · 받침대가 불안정하면 밴드 로우로 대체' }, { exerciseId: 'dead-bug', name: '데드버그', sets: '좌우 6회 × 2세트' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3~5분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'upper-dumbbell-longband', name: '상체 + 덤벨 + 롱밴드', category: 'strength', goal: '가슴, 어깨 안정성, 등 위쪽, 코어 안정화', duration: '약 50~60분', intensity: 'medium', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 묵주기도 슬라이딩보드', duration: '1주차 15분 · 2주차 15~20분 · 3주차 이후 20분', description: '기도와 저강도 유산소를 함께하는 운동 전 준비 시간입니다. 묵주기도를 이어갈 수 있을 정도의 가벼운 속도로 진행하세요.' }, { exerciseId: 'dumbbell-floor-press', name: '덤벨 플로어프레스', sets: '10회 × 2세트', description: '한 손 3~5kg부터' }, { exerciseId: 'longband-face-pull', name: '롱밴드 페이스풀', sets: '12회 × 2세트' }, { exerciseId: 'band-pull-apart', name: '밴드 풀어파트', sets: '12~15회 × 2세트' }, { exerciseId: 'knee-side-plank', name: '무릎 사이드 플랭크', sets: '좌우 10~15초 × 2세트' }, { exerciseId: 'ab-slider-ready-position', name: 'AB 슬라이더 준비 자세', sets: '5초 × 3회', description: '허리 꺾이면 즉시 중단' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3~5분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'fullbody-light-circuit', name: '전신 가벼운 서킷', category: 'strength', goal: '전신 근력 유지, 감량 보조, 운동 습관 유지', duration: '약 50~60분', intensity: 'medium', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 묵주기도 슬라이딩보드', duration: '1주차 15분 · 2주차 15~20분 · 3주차 이후 20분', description: '기도와 저강도 유산소를 함께하는 운동 전 준비 시간입니다. 묵주기도를 이어갈 수 있을 정도의 가벼운 속도로 진행하세요.' }, { exerciseId: 'dumbbell-goblet-squat', name: '덤벨 고블릿 스쿼트', sets: '8회 × 2세트' }, { exerciseId: 'band-row', name: '밴드 로우', sets: '12회 × 2세트' }, { exerciseId: 'dumbbell-floor-press', name: '덤벨 플로어프레스', sets: '10회 × 2세트' }, { exerciseId: 'loopband-sidewalk', name: '루프밴드 사이드워크', sets: '좌우 10걸음 × 2세트' }, { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회 × 2세트' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3~5분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'optional-cardio', name: '선택 유산소', category: 'cardio', goal: '무리하지 않고 활동량을 늘리는 선택 유산소 또는 휴식', duration: '하나 선택', intensity: 'low', type: 'choice', warmupExerciseIds: ['basic-warmup'], options: [
    { id: 'sliding-board-30', name: '슬라이딩보드', duration: '20~30분', description: '체지방 감량 보조와 활동량 증가를 위한 선택 유산소', exerciseIds: ['sliding-board-cardio'] },
    { id: 'rosary-sliding-board', name: '묵주기도 슬라이딩보드', duration: '15~20분', description: '묵주기도와 저강도 유산소를 함께 진행', exerciseIds: ['pre-rosary-sliding-board'] },
    { id: 'indoor-walk', name: '실내 걷기', duration: '20~30분', description: '날씨와 상관없이 가볍게 진행하는 유산소', exerciseIds: ['indoor-walk'] },
    { id: 'outdoor-walk', name: '야외 산책', duration: '30분', description: '컨디션이 괜찮을 때 가볍게 걷기', exerciseIds: ['outdoor-walk'] },
    { id: 'rest', name: '휴식', duration: '휴식', description: '피로가 있으면 쉬어도 됩니다.', exerciseIds: [] },
  ], cooldownExerciseIds: ['basic-cooldown', 'foam-roller-recovery'] },
  { id: 'rest', name: '휴식', category: 'rest', goal: '피로 회복, 허리 보호', duration: '휴식', intensity: 'low', exercises: [
    { exerciseId: 'complete-rest', name: '완전 휴식' }, { exerciseId: 'pullup-posture-only', name: '또는 턱걸이 자세만 1~2분' }, { exerciseId: 'foam-roller-recovery-if-needed', name: '필요 시 폼롤러 회복 5분' },
  ] },
];

export const getWorkoutGroupById = (id: string) => WORKOUT_GROUPS.find((group) => group.id === id) || WORKOUT_GROUPS[0];

const flow: FlowItem[] = [
  { icon: '🧘', label: '준비', time: '3~5분', bgColor: '#EEEDFE', labelColor: '#3C3489', timeColor: '#534AB7' },
  { icon: '💪', label: '운동 그룹', time: '15~30분', bgColor: '#E6F1FB', labelColor: '#0C447C', timeColor: '#185FA5' },
  { icon: '🌿', label: '회복', time: '5분', bgColor: '#EAF3DE', labelColor: '#27500A', timeColor: '#3B6D11' },
];

const DEFAULT_CAUTIONS = [
  '통증이 있으면 즉시 중단하세요.',
  '허리 통증이나 다리 저림이 있으면 회복 모드로 전환하세요.',
  '반동으로 하지 말고 천천히 진행하세요.',
];

const createDetails = (exercise: WorkoutGroupExercise): Detail[] => {
  const guide = getExerciseGuide(exercise.exerciseId, exercise.name, exercise.description);
  const steps = guide.movement.length ? guide.movement : [exercise.description || guide.summary];
  const cautions = exercise.cautions?.length ? exercise.cautions : guide.stopCriteria.length ? guide.stopCriteria : DEFAULT_CAUTIONS;

  return [
    { type: 'purple', text: [exercise.duration, exercise.sets, guide.summary].filter(Boolean).join(' · ') },
    { type: 'green', text: `**목적:** ${guide.purpose}` },
    ...guide.setup.map((text) => ({ type: 'purple' as const, text: `준비 자세: ${text}` })),
    ...steps.map((text, index) => ({ type: 'step' as const, text: `방법 ${index + 1}. ${text}` })),
    ...(guide.breathing ? [{ type: 'green' as const, text: `**호흡:** ${guide.breathing}` }] : []),
    ...cautions.map((text) => ({ type: 'warn' as const, text })),
    ...((guide.homeTips || []).map((text) => ({ type: 'good' as const, text: `집에서 하는 팁: ${text}` }))),
    ...((guide.alternatives || []).map((text) => ({ type: 'purple' as const, text: `대체 운동: ${text}` }))),
  ];
};

const toExercise = (exercise: WorkoutGroupExercise): Exercise => {
  const guide = getExerciseGuide(exercise.exerciseId, exercise.name, exercise.description);

  return {
    name: exercise.name || guide.name || exercise.exerciseId,
    meta: exercise.sets || exercise.duration,
    sets: exercise.sets ? 2 : 0,
    restSeconds: exercise.sets ? 30 : 0,
    abSlideGate: (exercise.name || guide.name || exercise.exerciseId).includes('AB 슬라이더'),
    details: createDetails(exercise),
    guide,
  };
};

export function workoutGroupToDayWorkout(group: WorkoutGroup, dayId: string, tabLabel: string): DayWorkout {
  const color = group.category === 'rest' ? '#6B7280' : group.category === 'recovery' ? '#378ADD' : group.category === 'strength' ? '#534AB7' : '#639922';
  if (group.type === 'choice') {
    const lookup = (exerciseId: string): WorkoutGroupExercise => ({ exerciseId, name: getExerciseGuide(exerciseId).name });
    const warmup = group.warmupExerciseIds.map(lookup).map(toExercise);
    const cooldown = group.cooldownExerciseIds.map(lookup).map(toExercise);
    const phase: Phase = { id: 'main', icon: '🚶', title: '유산소 선택', subtitle: '오늘은 아래 중 하나만 선택하세요.', alert: { variant: 'blue', text: '무리하지 않고 활동량을 늘리는 날입니다. 선택 전에는 모든 운동을 수행하지 마세요.' }, exercises: [] };
    return { id: dayId, tabLabel, emoji: '🚶', title: '토요일 선택 유산소', subtitle: group.goal, totalTime: group.duration, badgeBg: color, dayColor: color, flow, phases: [phase], optionalCardio: { warmup, options: group.options.map((option) => ({ ...option, exercises: option.exerciseIds.map(lookup).map(toExercise) })), cooldown } };
  }
  const phase: Phase = { id: 'main', icon: '🏋️', title: '운동 그룹', subtitle: group.goal, alert: { variant: 'yellow', text: `${SAFETY_STOP_MESSAGE} 중단은 실패가 아니라 회복일 전환입니다.` }, exercises: group.exercises.map(toExercise) };
  return { id: dayId, tabLabel, emoji: group.category === 'rest' ? '😴' : group.category === 'recovery' ? '🌿' : '🏋️', title: group.name, subtitle: group.goal, totalTime: group.duration, badgeBg: color, dayColor: color, flow, phases: [phase] };
}

export const COMMON_STOP_CAUTION_TEXT = COMMON_STOP_CAUTIONS.join(' · ');
