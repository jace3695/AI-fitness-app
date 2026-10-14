import { exerciseGuides } from './exerciseGuides.ts';
import { WORKOUT_GROUPS, type WorkoutGroupExercise } from './workoutGroups.ts';

export const HOME_EQUIPMENT = ['맨몸', '요가매트', '덤벨 · 1kg 아령', 'BELLE 풀업밴드', '코멧 루프밴드', 'AB 슬라이드', '철봉', '폼롤러', '케틀벨 · 바벨'] as const;
export type HomeEquipment = typeof HOME_EQUIPMENT[number];
const ids: Partial<Record<HomeEquipment, string[]>> = {
  '맨몸': ['bodyweight-squat', 'wall-pushup', 'supported-hamstring-curl', 'indoor-walk', 'basic-warmup', 'basic-cooldown'],
  '요가매트': ['bird-dog', 'dead-bug', 'pelvic-tilt', 'cat-cow', 'knee-side-plank'],
  '덤벨 · 1kg 아령': ['dumbbell-goblet-squat', 'dumbbell-floor-press', 'one-arm-dumbbell-row-supported'],
  'BELLE 풀업밴드': ['band-row', 'longband-lat-pulldown', 'longband-face-pull', 'band-pull-apart', 'band-pallof-press'],
  '코멧 루프밴드': ['loopband-sidewalk', 'loopband-monster-walk'],
  'AB 슬라이드': ['ab-slider-ready-position'],
  '철봉': ['pullup-basic-posture'],
  '폼롤러': ['foam-roller-prep', 'foam-roller-recovery'],
};
export function isHomeSelectable(id: string, name = '') {
  return !/sliding[\s-]*board|hip[\s-]*bridge|슬라이딩\s*보드|힙\s*브[릿리]지/i.test(`${id} ${name}`);
}
export function homeExerciseCandidates(equipment: HomeEquipment): WorkoutGroupExercise[] {
  return (ids[equipment] || []).filter(id => isHomeSelectable(id) && exerciseGuides[id]).map(exerciseId => {
    const existing = WORKOUT_GROUPS.flatMap(group => group.type === 'choice' ? [] : group.exercises).find(exercise => exercise.exerciseId === exerciseId);
    return { ...existing, exerciseId, name: exerciseGuides[exerciseId].name || exerciseId };
  });
}
