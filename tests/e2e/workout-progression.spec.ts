import { buildCurrentWorkoutSettings, CURRENT_WEEKLY_METHODS } from '../../app/data/currentWorkoutDirection';
import { expect, login, original, synced, test, today, type State } from './fixture';

const MAIN_EXERCISES = ['덤벨 고블릿 스쿼트', '밴드 로우', '덤벨 플로어프레스', '루프밴드 사이드워크', '버드독'];

function dateMinus(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function completedStrengthSession() {
  return {
    workoutDone: true,
    workoutGroupId: 'current-fullbody-strength-circuit',
    workoutStatus: 'completed',
    workoutDifficulty: 'easy',
    workoutFatigue: 2,
    workoutBackStatus: 'none',
    workoutNeurologicalSymptoms: [],
    workoutMethod: { ...CURRENT_WEEKLY_METHODS.mon },
    workoutExerciseRecords: MAIN_EXERCISES.map((exerciseName, exerciseIndex) => ({
      exerciseName,
      status: 'completed',
      sets: Array.from({ length: 3 }, (_, setIndex) => ({
        setNumber: setIndex + 1,
        completed: true,
        plannedReps: exerciseIndex === 0 ? 12 : exerciseIndex === 1 ? 10 : exerciseIndex === 4 ? 6 : 8,
        reps: exerciseIndex === 0 ? 12 : exerciseIndex === 1 ? 10 : exerciseIndex === 4 ? 6 : 8,
        weightKg: exerciseIndex === 0 || exerciseIndex === 2 ? 5 : undefined,
        bandLevel: exerciseIndex === 1 || exerciseIndex === 3 ? '약' : undefined,
      })),
    })),
  };
}

test('authenticated workout review requires confirmation before applying one load step', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const date = today();
  const settings = buildCurrentWorkoutSettings({ weeklyGroups: {}, weeklyMethods: {}, weeklyEdits: {}, exerciseTargets: {}, dateOverrides: {} });
  settings.weeklyExerciseTargets = Object.fromEntries(['mon', 'wed', 'fri'].map((day) => [day, { [MAIN_EXERCISES[0]]: { reps: 12 } }]));
  const workouts = {
    ...(original['ai-fitness-workout-completed-days'] as Record<string, unknown>),
    [dateMinus(date, 1)]: completedStrengthSession(),
    [dateMinus(date, 2)]: completedStrengthSession(),
    [dateMinus(date, 3)]: completedStrengthSession(),
  };
  const seeded: State = {
    ...original,
    'ai-fitness-workout-completed-days': workouts,
    'ai-fitness-user-workout-settings': settings,
    'ai-fitness-selected-weekly-workout-plan': 'five-day-fullbody-circuit',
    'ai-fitness-workout-direction-version': 'five-day-circuit-v1',
  };
  const update = await qa.account.client.from('user_app_state').update({ state: seeded }).eq('user_id', qa.account.id);
  expect(update.error).toBeNull();

  await login(page, qa.account);
  await synced(page);
  await page.goto('/fitness');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), {
    message: 'the 320px workout view has no horizontal page overflow',
  }).toBe(true);
  await expect(page.getByText('근력일 한 운동의 중량 0.5kg 증가 검토', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '변경 내용 확인', exact: true }).click();

  const apply = page.getByRole('button', { name: '확인한 변경 적용', exact: true });
  await expect(apply).toBeDisabled();
  await page.getByLabel(/5\.5kg 덤벨을 안전하게 준비/).check();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByText(/확인한 변경을 적용했습니다/)).toBeVisible();

  await expect.poll(async () => {
    const state = await qa.read();
    const saved = state['ai-fitness-user-workout-settings'] as typeof settings | undefined;
    return ['mon', 'wed', 'fri'].map((day) => saved?.weeklyExerciseTargets?.[day as 'mon' | 'wed' | 'fri']?.[MAIN_EXERCISES[0]]?.weightKg).filter(Boolean);
  }, { message: 'the confirmed 5.5kg target reached the actual database' }).toEqual([5.5]);
  await synced(page);
});
