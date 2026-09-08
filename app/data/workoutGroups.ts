import { SAFETY_STOP_MESSAGE } from './workouts.ts';
import type { DayWorkout, Detail, Exercise, FlowItem, Phase, PhaseType } from './workouts.ts';
import { getExerciseGuide } from './exerciseGuides.ts';

export type WorkoutGroupCategory = 'cardio' | 'core' | 'strength' | 'recovery' | 'rest';
export type WorkoutIntensity = 'low' | 'medium' | 'high';
export type WorkoutGroupExercise = { exerciseId: string; name?: string; sets?: string; duration?: string; description?: string; cautions?: string[]; optional?: boolean; phase?: PhaseType; restSeconds?: number };
export type CardioOption = { id: string; name: string; duration: string; description: string; exerciseIds: string[] };
export type BaseWorkoutGroup = { id: string; name: string; category: WorkoutGroupCategory; goal: string; duration: string; intensity: WorkoutIntensity; exercises: WorkoutGroupExercise[]; type?: 'routine' };
export type OptionalCardioGroup = { id: string; name: string; category: 'cardio' | 'recovery'; goal: string; duration: string; intensity: 'low'; type: 'choice'; warmupExerciseIds: string[]; options: CardioOption[]; cooldownExerciseIds: string[] };
export type WorkoutGroup = BaseWorkoutGroup | OptionalCardioGroup;

const COMMON_STOP_CAUTIONS = ['허리 통증', '다리 저림', '무릎 통증', '어지럼', '손떨림', '식은땀', '메스꺼움', '가슴 답답함'];
export const EXCLUDED_EXERCISE_IDS = new Set(['hip-bridge']);

export const WORKOUT_GROUPS: WorkoutGroup[] = [
  { id: 'current-fullbody-strength-circuit', name: '전신 근력 서킷', category: 'strength', goal: '정확한 자세로 전신 근력과 근육 자극을 확보하고 몸통 안정성을 기릅니다. 속도 경쟁 없이 필요하면 동작 사이 20~40초 쉽니다.', duration: '약 25~35분', intensity: 'medium', exercises: [
    { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분', phase: 'warmup' },
    { exerciseId: 'dumbbell-goblet-squat', name: '덤벨 고블릿 스쿼트', sets: '8~10회', restSeconds: 30, phase: 'main', description: '허리 중립과 무릎 방향을 유지할 수 있는 가벼운 중량부터 시작합니다.' },
    { exerciseId: 'band-row', name: '밴드 로우', sets: '10~12회', restSeconds: 30, phase: 'main' },
    { exerciseId: 'dumbbell-floor-press', name: '덤벨 플로어프레스', sets: '8~10회', restSeconds: 30, phase: 'main' },
    { exerciseId: 'loopband-sidewalk', name: '루프밴드 사이드워크', sets: '좌우 8~10회', restSeconds: 30, phase: 'main' },
    { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6~8회', restSeconds: 30, phase: 'main', description: '허리를 많이 움직이기보다 몸통을 흔들림 없이 유지합니다.' },
    { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분', phase: 'cooldown' },
  ] },
  { id: 'current-fullbody-recovery-circuit', name: '회복형 전신 서킷', category: 'recovery', goal: '1라운드부터 시작해 여유가 있어도 1~2라운드만 진행합니다. 다음 근력일을 방해하지 않는 낮은 강도로 움직이고 피로가 남으면 쉽니다.', duration: '약 10~20분', intensity: 'low', exercises: [
    { exerciseId: 'basic-warmup', name: '가벼운 몸풀기', duration: '2~3분', phase: 'warmup' },
    { exerciseId: 'bodyweight-squat', name: '맨몸 스쿼트', sets: '8회', restSeconds: 30, phase: 'main' },
    { exerciseId: 'band-row', name: '가벼운 밴드 로우', sets: '10회', restSeconds: 30, phase: 'main', description: '밴드 장력을 낮춰 동작이 여유롭게 끝나도록 합니다.' },
    { exerciseId: 'wall-pushup', name: '벽 푸시업', sets: '8회', restSeconds: 30, phase: 'main', description: '바닥 프레스보다 부담이 적은 각도에서 가볍게 진행합니다.' },
    { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회', restSeconds: 30, phase: 'main' },
    { exerciseId: 'loopband-sidewalk', name: '가벼운 루프밴드 사이드워크', sets: '좌우 6회', restSeconds: 30, phase: 'main', description: '가벼운 밴드로 골반이 흔들리지 않는 범위만 진행합니다.' },
    { exerciseId: 'basic-cooldown', name: '호흡 정리와 가벼운 스트레칭', duration: '2~3분', phase: 'cooldown' },
  ] },
  { id: 'current-weekend-recovery', name: '토요일 가벼운 회복 선택', category: 'recovery', goal: '휴식을 우선하고, 몸이 가벼울 때만 걷기·스트레칭·가동성 운동 중 하나를 선택합니다.', duration: '휴식 또는 10~30분', intensity: 'low', type: 'choice', warmupExerciseIds: ['basic-warmup'], options: [
    { id: 'indoor-walk', name: '실내 걷기', duration: '15~25분', description: '대화 가능한 편한 속도로 걷습니다.', exerciseIds: ['indoor-walk'] },
    { id: 'outdoor-walk', name: '가벼운 산책', duration: '20~30분', description: '평지에서 회복을 방해하지 않는 속도로 걷습니다.', exerciseIds: ['outdoor-walk'] },
    { id: 'mobility-recovery', name: '스트레칭·가동성', duration: '10~15분', description: '통증 없는 범위에서 몸을 부드럽게 움직입니다.', exerciseIds: ['cat-cow', 'pelvic-tilt'] },
    { id: 'rest', name: '휴식', duration: '휴식', description: '피로가 있으면 운동을 추가하지 않고 쉽니다.', exerciseIds: [] },
  ], cooldownExerciseIds: ['basic-cooldown'] },
  { id: 'cardio-back-basic-week1', name: '유산소 + 허리 안정화 1주차', category: 'cardio', goal: '1주차는 허리 안정화와 유산소 적응을 우선하는 주간입니다. AB 슬라이더와 사이드 플랭크는 허리 부담이 생길 수 있으므로 1주차 기본 루틴에서는 제외합니다.', duration: '약 50~60분', intensity: 'low', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 슬라이딩보드', duration: '15분', description: '체온을 올리는 저강도 유산소입니다. 대화가 가능한 가벼운 속도로 진행하세요.' }, { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회 × 2세트' }, { exerciseId: 'hip-bridge', name: '힙브릿지', sets: '12회 × 2세트' }, { exerciseId: 'dead-bug', name: '데드버그', sets: '좌우 6회 × 2세트' }, { exerciseId: 'cat-cow', name: '캣카우', sets: '6~8회' }, { exerciseId: 'pelvic-tilt', name: '골반 기울이기', sets: '8~10회' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '5분 또는 생략 가능', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 1주차에는 5분만 진행하고 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'cardio-back-basic', name: '유산소 + 허리 안정화', category: 'cardio', goal: '운동 재시작, 허리 부담 최소화, 체지방 감량 보조', duration: '약 50~60분', intensity: 'low', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 슬라이딩보드', duration: '15~20분', description: '체온을 올리는 저강도 유산소입니다. 대화가 가능한 가벼운 속도로 진행하세요.' }, { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회 × 2세트' }, { exerciseId: 'hip-bridge', name: '힙브릿지', sets: '12회 × 2세트' }, { exerciseId: 'dead-bug', name: '데드버그', sets: '좌우 6회 × 2세트' }, { exerciseId: 'cat-cow', name: '캣카우', sets: '6~8회' }, { exerciseId: 'pelvic-tilt', name: '골반 기울이기', sets: '8~10회' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'cardio-foam-recovery', name: '유산소 + 폼롤러 회복', category: 'recovery', goal: '피로 누적 방지, 회복, 가벼운 감량 보조', duration: '약 25~35분', intensity: 'low', exercises: [
    { exerciseId: 'rosary-sliding-board', name: '회복 슬라이딩보드', duration: '15~20분', description: '아주 가볍게 진행하고 피곤하면 시간을 줄입니다.' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5~10분', description: '종아리 · 허벅지 앞 · 허벅지 바깥쪽 · 엉덩이 · 등 위쪽' }, { exerciseId: 'light-breathing', name: '가벼운 호흡', duration: '1~2분' }, { exerciseId: 'pullup-posture-only', name: '턱걸이 자세만', duration: '1~2분' },
  ] },
  { id: 'cardio-core-basic', name: '유산소 + 코어 안정화', category: 'core', goal: '허리 안정성, 복부 힘 회복, AB 슬라이더 준비', duration: '약 45~55분', intensity: 'low', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 슬라이딩보드', duration: '1주차 15분 · 2주차 15~20분 · 3주차 이후 20분', description: '체온을 올리는 저강도 유산소입니다. 대화가 가능한 가벼운 속도로 진행하세요.' }, { exerciseId: 'dead-bug', name: '데드버그', sets: '좌우 6회 × 2세트' }, { exerciseId: 'knee-side-plank', name: '무릎 사이드 플랭크', sets: '좌우 10~15초 × 2세트' }, { exerciseId: 'pelvic-tilt', name: '골반 기울이기', sets: '8~10회' }, { exerciseId: 'ab-slider-ready-position', name: 'AB 슬라이더 준비 자세', sets: '5초 버티기 × 3회', description: '무릎 대고 잡기 · 복부 힘 주기 · 1~2주차에는 표시된 준비 자세만 확인하고 앞으로 밀지 않음', cautions: ['1주차에는 AB 슬라이더를 밀지 않습니다.', '허리 통증이나 다리 저림이 있으면 AB 슬라이더와 사이드 플랭크는 제외하세요.'] }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3~5분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'lower-dumbbell-loopband', name: '하체 + 덤벨 + 루프밴드', category: 'strength', goal: '하체 근력, 엉덩이, 골반 안정화', duration: '약 50~60분', intensity: 'medium', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 슬라이딩보드', duration: '1주차 15분 · 2주차 15~20분 · 3주차 이후 20분', description: '체온을 올리는 저강도 유산소입니다. 대화가 가능한 가벼운 속도로 진행하세요.' }, { exerciseId: 'hip-bridge', name: '힙브릿지', sets: '12회 × 2세트' }, { exerciseId: 'dumbbell-goblet-squat', name: '덤벨 고블릿 스쿼트', sets: '8~10회 × 2세트', description: '5~7kg부터 시작' }, { exerciseId: 'loopband-sidewalk', name: '루프밴드 사이드워크', sets: '좌우 10걸음 × 2세트' }, { exerciseId: 'loopband-monster-walk', name: '루프밴드 몬스터워크', sets: '앞/뒤 8~10걸음 × 2세트' }, { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회 × 2세트' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3~5분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'back-band-dumbbell-row', name: '등 + 롱밴드 + 덤벨 로우', category: 'strength', goal: '등 근육, 자세 안정성, 턱걸이 준비', duration: '약 50~60분', intensity: 'medium', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 슬라이딩보드', duration: '1주차 15분 · 2주차 15~20분 · 3주차 이후 20분', description: '체온을 올리는 저강도 유산소입니다. 대화가 가능한 가벼운 속도로 진행하세요.' }, { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회 × 2세트' }, { exerciseId: 'longband-lat-pulldown', name: '롱밴드 랫풀다운', sets: '12회 × 2세트' }, { exerciseId: 'band-row', name: '밴드 로우', sets: '12회 × 2세트' }, { exerciseId: 'one-arm-dumbbell-row-supported', name: '의자/테이블 지지 원암 덤벨 로우', sets: '좌우 10회 × 2세트', description: '5~7kg부터 · 받침대가 불안정하면 밴드 로우로 대체' }, { exerciseId: 'dead-bug', name: '데드버그', sets: '좌우 6회 × 2세트' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3~5분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'upper-dumbbell-longband', name: '상체 + 덤벨 + 롱밴드', category: 'strength', goal: '가슴, 어깨 안정성, 등 위쪽, 코어 안정화', duration: '약 50~60분', intensity: 'medium', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 슬라이딩보드', duration: '1주차 15분 · 2주차 15~20분 · 3주차 이후 20분', description: '체온을 올리는 저강도 유산소입니다. 대화가 가능한 가벼운 속도로 진행하세요.' }, { exerciseId: 'dumbbell-floor-press', name: '덤벨 플로어프레스', sets: '10회 × 2세트', description: '한 손 3~5kg부터' }, { exerciseId: 'longband-face-pull', name: '롱밴드 페이스풀', sets: '12회 × 2세트' }, { exerciseId: 'band-pull-apart', name: '밴드 풀어파트', sets: '12~15회 × 2세트' }, { exerciseId: 'knee-side-plank', name: '무릎 사이드 플랭크', sets: '좌우 10~15초 × 2세트' }, { exerciseId: 'ab-slider-ready-position', name: 'AB 슬라이더 준비 자세', sets: '5초 × 3회', description: '허리 꺾이면 즉시 중단' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3~5분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'fullbody-light-circuit', name: '전신 가벼운 서킷', category: 'strength', goal: '전신 근력 유지, 감량 보조, 운동 습관 유지', duration: '약 50~60분', intensity: 'medium', exercises: [
    { exerciseId: 'foam-roller-prep', name: '폼롤러 준비', duration: '3분' }, { exerciseId: 'basic-warmup', name: '기본 몸풀기', duration: '3~5분' }, { exerciseId: 'pre-rosary-sliding-board', name: '운동 전 슬라이딩보드', duration: '1주차 15분 · 2주차 15~20분 · 3주차 이후 20분', description: '체온을 올리는 저강도 유산소입니다. 대화가 가능한 가벼운 속도로 진행하세요.' }, { exerciseId: 'dumbbell-goblet-squat', name: '덤벨 고블릿 스쿼트', sets: '8회 × 2세트' }, { exerciseId: 'band-row', name: '밴드 로우', sets: '12회 × 2세트' }, { exerciseId: 'dumbbell-floor-press', name: '덤벨 플로어프레스', sets: '10회 × 2세트' }, { exerciseId: 'loopband-sidewalk', name: '루프밴드 사이드워크', sets: '좌우 10걸음 × 2세트' }, { exerciseId: 'bird-dog', name: '버드독', sets: '좌우 6회 × 2세트' }, { exerciseId: 'pullup-basic-posture', name: '턱걸이 초기자세', duration: '3~5분' }, { exerciseId: 'post-sliding-board', name: '운동 후 슬라이딩보드 마무리', duration: '1~2주차 5분 또는 생략 가능 · 3~4주차 10분 · 5주차 이후 컨디션 좋으면 15~20분', description: '운동 후 슬라이딩보드는 감량 보조용입니다. 처음 1~2주차에는 5분만 진행하고, 허리/무릎 통증이 없을 때 10분 이상으로 늘립니다. 피곤하거나 허리/무릎 부담이 있으면 생략해도 됩니다.' }, { exerciseId: 'basic-cooldown', name: '기본 정리운동', duration: '3~5분' }, { exerciseId: 'foam-roller-recovery', name: '폼롤러 회복', duration: '5분' },
  ] },
  { id: 'optional-cardio', name: '선택 유산소', category: 'cardio', goal: '무리하지 않고 활동량을 늘리는 선택 유산소 또는 휴식', duration: '하나 선택', intensity: 'low', type: 'choice', warmupExerciseIds: ['basic-warmup'], options: [
    { id: 'sliding-board-30', name: '슬라이딩보드', duration: '20~30분', description: '체지방 감량 보조와 활동량 증가를 위한 선택 유산소', exerciseIds: ['sliding-board-cardio'] },
    { id: 'indoor-walk', name: '실내 걷기', duration: '20~30분', description: '날씨와 상관없이 가볍게 진행하는 유산소', exerciseIds: ['indoor-walk'] },
    { id: 'outdoor-walk', name: '야외 산책', duration: '30분', description: '컨디션이 괜찮을 때 가볍게 걷기', exerciseIds: ['outdoor-walk'] },
    { id: 'rest', name: '휴식', duration: '휴식', description: '피로가 있으면 쉬어도 됩니다.', exerciseIds: [] },
  ], cooldownExerciseIds: ['basic-cooldown', 'foam-roller-recovery'] },
  { id: 'rest', name: '휴식', category: 'rest', goal: '피로 회복, 허리 보호', duration: '휴식', intensity: 'low', exercises: [
    { exerciseId: 'complete-rest', name: '완전 휴식' }, { exerciseId: 'pullup-posture-only', name: '또는 턱걸이 자세만 1~2분' }, { exerciseId: 'foam-roller-recovery-if-needed', name: '필요 시 폼롤러 회복 5분' },
  ] },
];

const strengthCircuitBase = WORKOUT_GROUPS[0] as BaseWorkoutGroup;
WORKOUT_GROUPS.push(
  {
    ...strengthCircuitBase,
    id: 'current-fullbody-hamstring-circuit',
    name: '전신 근력 서킷 · 허벅지 뒤쪽 보완',
    goal: '기존 5개 동작 중 사이드워크 하나를 지지형 햄스트링 컬로 교체합니다. 첫 도입은 2라운드 이하로 자세와 다음 날 반응을 확인합니다.',
    exercises: strengthCircuitBase.exercises.map((exercise) => exercise.exerciseId === 'loopband-sidewalk'
      ? { exerciseId: 'supported-hamstring-curl', name: '지지형 햄스트링 컬', sets: '좌우 8회', phase: 'main', restSeconds: 30, description: '고정된 지지대를 잡고 맨몸부터 시작합니다. 허리를 젖히지 않고 무릎만 천천히 굽힙니다.' }
      : { ...exercise }),
  },
  {
    ...strengthCircuitBase,
    id: 'current-fullbody-antirotation-circuit',
    name: '전신 근력 서킷 · 회전 저항 코어',
    goal: '기존 5개 동작 중 버드독 하나를 가벼운 밴드 팔로프 프레스로 교체합니다. 첫 도입은 2라운드 이하로 몸통 안정성과 증상을 확인합니다.',
    exercises: strengthCircuitBase.exercises.map((exercise) => exercise.exerciseId === 'bird-dog'
      ? { exerciseId: 'band-pallof-press', name: '밴드 팔로프 프레스', sets: '좌우 6회', phase: 'main', restSeconds: 30, description: '안전하게 고정한 약한 밴드를 사용합니다. 몸통이 돌아가지 않는 짧은 범위로 시작합니다.' }
      : { ...exercise }),
  },
);

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
  const plannedSetCount = exercise.sets?.match(/(\d+)\s*세트/);

  return {
    exerciseId: exercise.exerciseId,
    name: exercise.name || guide.name || exercise.exerciseId,
    meta: exercise.sets || exercise.duration,
    sets: exercise.sets ? (plannedSetCount ? Number(plannedSetCount[1]) : 1) : 0,
    restSeconds: exercise.restSeconds ?? (exercise.sets ? 30 : 0),
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
  const phaseOrder: PhaseType[] = ['warmup', 'main', 'sliding', 'cooldown'];
  const phaseCopy: Record<PhaseType, Pick<Phase, 'icon' | 'title' | 'subtitle'>> = {
    warmup: { icon: '🧘', title: '준비운동', subtitle: '통증 없는 범위에서 천천히 몸을 깨웁니다.' },
    main: { icon: '🏋️', title: '본운동', subtitle: group.goal },
    sliding: { icon: '🚶', title: '유산소', subtitle: '대화가 가능한 편한 강도로 진행합니다.' },
    cooldown: { icon: '🌿', title: '정리운동', subtitle: '호흡을 낮추며 회복으로 전환합니다.' },
  };
  const allowedExercises = group.exercises.filter((exercise) => !EXCLUDED_EXERCISE_IDS.has(exercise.exerciseId));
  const phases = phaseOrder.flatMap((phaseId) => {
    const phaseExercises = allowedExercises.filter((exercise) => (exercise.phase || 'main') === phaseId).map(toExercise);
    if (!phaseExercises.length) return [];
    return [{
      id: phaseId,
      ...phaseCopy[phaseId],
      alert: phaseId === 'main' ? { variant: 'yellow' as const, text: `${SAFETY_STOP_MESSAGE} 중단은 실패가 아니라 회복일 전환입니다.` } : undefined,
      exercises: phaseExercises,
    }];
  });
  return { id: dayId, tabLabel, emoji: group.category === 'rest' ? '😴' : group.category === 'recovery' ? '🌿' : '🏋️', title: group.name, subtitle: group.goal, totalTime: group.duration, badgeBg: color, dayColor: color, flow, phases };
}

export const COMMON_STOP_CAUTION_TEXT = COMMON_STOP_CAUTIONS.join(' · ');
