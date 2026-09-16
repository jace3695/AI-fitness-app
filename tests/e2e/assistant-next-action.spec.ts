import { expect, login, original, originalLanguage, synced, test, today } from './fixture';

test('AI Yeoni links the briefing and primary action to the exact next language step', async ({ page, qa }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const date = today();
  const fitnessDays = {
    ...(original['ai-fitness-workout-completed-days'] as Record<string, unknown>),
    [date]: { workoutDone: true, workoutStatus: 'completed' },
  };
  const dietDays = {
    ...(original['ai-fitness-diet-completed-days'] as Record<string, unknown>),
    [date]: { dietStatus: 'normal', dietMemo: 'P1 합성 식단 완료' },
  };
  const appUpdate = await qa.account.client.from('user_app_state').update({ state: {
    ...original,
    'ai-fitness-workout-completed-days': fitnessDays,
    'ai-fitness-diet-completed-days': dietDays,
  } }).eq('user_id', qa.account.id);
  expect(appUpdate.error).toBeNull();
  const languageUpdate = await qa.account.client.from('language_user_state').update({ state: {
    ...originalLanguage,
    dailyRoutineProgress: { date, completedIds: ['kana', 'words'] },
  } }).eq('user_id', qa.account.id);
  expect(languageUpdate.error).toBeNull();

  await login(page, qa.account);
  await synced(page);
  await page.goto('/assistant');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), {
    message: 'the 390px AI Yeoni view has no horizontal page overflow',
  }).toBe(true);

  const action = page.getByRole('region', { name: '연이가 고른 다음 한 걸음' });
  await expect(action.getByText('다음 학습: 문장', { exact: true })).toBeVisible();
  await expect(action.getByRole('link', { name: /문장 학습 시작/ })).toHaveAttribute('href', '/language/sentences');
  await expect(page.getByRole('link', { name: /오늘 언어 학습.*2\/5 완료.*다음 학습: 문장/ })).toHaveAttribute('href', '/language/sentences');
  await expect(page.getByText('오늘 식단 기록 완료', { exact: true })).toBeVisible();
});
