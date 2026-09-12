import { test, expect, login, originalLanguage, canonical } from './fixture';

const goal = (state: Record<string, unknown>) => {
  const raw = state.learningSettings;
  return typeof raw === 'string' ? (JSON.parse(raw) as { dailyGoalCount?: number }).dailyGoalCount : undefined;
};

test('language settings save immediately, preserve an edit during PATCH, and survive relogin', async ({ page, qa }) => {
  await login(page, qa.account, '/language/settings');
  await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^5\s*개$/ })).toHaveAttribute('aria-pressed', 'true');

  const hold = qa.traffic.holdNext('PATCH', 'response', 'language_user_state');
  await page.getByRole('button', { name: /^4\s*개$/ }).click();
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByText('학습 목표와 통합 과정 설정이 저장됐어요.', { exact: true }).first()).toBeVisible();
  await hold.arrived;
  await expect(page.getByText('학습 기록 · 서버 반영 중…', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^3\s*개$/ }).click();
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByText('학습 기록 · 기기 저장, 서버 반영 대기', { exact: true })).toBeVisible();
  hold.release();

  await expect.poll(async () => goal(await qa.readLanguage()), { message: 'The newest language setting reached the actual database' }).toBe(3);
  await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
  const saved = await qa.readLanguage();
  expect(saved.integratedLearningSettingsV1).toBe(originalLanguage.integratedLearningSettingsV1);
  expect(goal(saved)).toBe(3);
  qa.traffic.assertLanguageConfirmed(saved);

  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(qa.account.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(qa.account.password);
  await page.getByRole('button', { name: 'AI 연이 시작', exact: true }).click();
  await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^3\s*개$/ })).toHaveAttribute('aria-pressed', 'true');
  expect(canonical(await qa.readLanguage())).toBe(canonical(saved));
});
