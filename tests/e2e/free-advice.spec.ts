import { test, expect, login, original, originalLanguage, today } from './fixture';
import type { Page } from '@playwright/test';
import { ADVICE_QUESTIONS } from '../../lib/assistant-advice-intent';
import { buildCurrentWorkoutSettings } from '../../app/data/currentWorkoutDirection';

async function askAdvice(page: Page, scope: keyof typeof ADVICE_QUESTIONS) {
  await page.getByRole('textbox', { name: '연이에게 보낼 명령', exact: true }).fill(ADVICE_QUESTIONS[scope]);
  await page.getByRole('button', { name: '전송', exact: true }).click();
  await expect(page.getByRole('region', { name: /무료 AI 조언$/ })).toBeVisible();
}
async function enterAdvice(page: Page, scope: keyof typeof ADVICE_QUESTIONS) {
  if (scope !== 'assistant') await page.getByRole('link', { name: '연이에게 물어보기', exact: true }).click();
  await askAdvice(page, scope);
}

test('free advice previews real owner records across four areas without modifying records', async ({ page, qa }) => {
  const day = today();
  // Start after the existing one-time workout-settings migration. We compare
  // the entire state, so unrelated first-visit migration must not hide writes.
  const fitness = { ...original,
    'ai-fitness-user-workout-settings': buildCurrentWorkoutSettings({ weeklyGroups: {}, weeklyMethods: {}, weeklyEdits: {}, exerciseTargets: {}, dateOverrides: {} }),
    'ai-fitness-selected-weekly-workout-plan': 'five-day-fullbody-circuit',
    'ai-fitness-workout-direction-version': 'five-day-circuit-v1',
    'ai-fitness-workout-completed-days': { ...original['ai-fitness-workout-completed-days'] as object, [day]: { workoutStatus: 'partial', workoutBackStatus: 'pain', workoutMemo: 'PRIVATE-SYNTHETIC-MEMO' } },
  };
  const language = { ...originalLanguage, japaneseCurriculumProgressV1: JSON.stringify({ activityDates: [day], completedLessonIds: [], quizScores: {}, selectedTrack: 'foundation', lessonAttempts: {} }) };
  expect((await qa.account.client.from('user_app_state').update({ state: fitness }).eq('user_id', qa.account.id)).error).toBeNull();
  expect((await qa.account.client.from('language_user_state').update({ state: language }).eq('user_id', qa.account.id)).error).toBeNull();
  expect((await qa.account.client.from('budget_profiles').insert({ user_id: qa.account.id, nickname: '합성 검증' })).error).toBeNull();
  expect((await qa.account.client.from('budget_transactions').insert({ user_id: qa.account.id, date: day, amount: 12000, place: 'PRIVATE-SYNTHETIC-MERCHANT', memo: 'PRIVATE-SYNTHETIC-MEMO', category: '식비', payment: '체크카드' })).error).toBeNull();
  const other = await qa.createAccount();
  expect((await other.client.from('budget_transactions').insert({ user_id: other.id, date: day, amount: 999999, place: 'OTHER-OWNER', category: '식비', payment: '현금' })).error).toBeNull();
  const { data } = await qa.account.client.auth.getSession();
  const headers = { Authorization: `Bearer ${data.session!.access_token}` };
  expect((await page.request.post('/api/ai/free-advice', { data: { scope: 'budget', action: 'preview' } })).status()).toBe(401);
  for (const scope of ['assistant', 'fitness', 'language', 'budget']) {
    const response = await page.request.post('/api/ai/free-advice', { headers, data: { scope, action: 'preview' } });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.configured).toBe(false); // Isolated CI has no provider credentials.
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE-SYNTHETIC|OTHER-OWNER|999999/);
    expect(body.context.recordCount).toBeGreaterThan(0);
    const values = Object.fromEntries(body.context.metrics.map((metric: { id: string; value: number }) => [metric.id, metric.value]));
    if (scope === 'budget' || scope === 'assistant') expect(values['budget.expense']).toBe(12000);
    if (scope === 'language' || scope === 'assistant') expect(values['language.days']).toBe(1);
    if (scope === 'fitness' || scope === 'assistant') expect(values['workout.discomfort']).toBe(1);
    const disabled = await page.request.post('/api/ai/free-advice', { headers, data: { scope, action: 'analyze', fingerprint: body.fingerprint, freeDataUseAcknowledged: true } });
    expect(disabled.status()).toBe(503); expect((await disabled.json()).code).toBe('FREE_ADVICE_NOT_CONFIGURED');
  }
  expect((await page.request.post('/api/ai/free-advice', { headers, data: { action: 'preview', scope: 'budget', userId: other.id } })).status()).toBe(400);
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account);
  for (const [path, region, scope] of [['/assistant', '일상', 'assistant'], ['/fitness', '운동', 'fitness'], ['/language', '일본어 학습', 'language']] as const) {
    await page.goto(path);
    await enterAdvice(page, scope);
    const panel = page.getByRole('region', { name: `${region} 무료 AI 조언`, exact: true });
    await panel.getByRole('button', { name: '조언받을 기록 확인', exact: true }).click();
    await expect(panel.getByText('보낼 기록 요약', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '무료 AI 조언받기', exact: true })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    await expect(page.getByRole('region', { name: '연이에게 말하기', exact: true })).toBeVisible();
    await expect(panel).toHaveCount(0);
    await page.getByRole('textbox', { name: '연이에게 보낼 명령', exact: true }).fill('');
    await page.getByRole('link', { name: '연이와 조언 이어가기 →', exact: true }).last().click();
    await expect(page.getByRole('textbox', { name: '연이에게 보낼 명령', exact: true })).toHaveValue(ADVICE_QUESTIONS[scope]);
    await page.getByRole('textbox', { name: '연이에게 보낼 명령', exact: true }).fill('');
  }
  await page.goto('/budget');
  await page.getByRole('navigation', { name: '가계부 주요 메뉴' }).getByRole('button', { name: '분석', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 상담', exact: true }).click();
  await enterAdvice(page, 'budget');
  const budget = page.getByRole('region', { name: '가계부 무료 AI 조언', exact: true });
  await budget.getByRole('button', { name: '조언받을 기록 확인', exact: true }).click();
  await expect(budget).toContainText('12,000원');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await qa.read()).toEqual(fitness);
  expect(await qa.readLanguage()).toEqual(language);
  expect((await qa.account.client.from('budget_transactions').select('amount').eq('user_id', qa.account.id)).data).toEqual([{ amount: 12000 }]);
  // Explicit completion still persists, and a reload no longer rewrites the
  // learning history timestamp merely because the home page mounted.
  await page.goto('/language');
  await page.locator('.routine-details > summary').click();
  await page.getByRole('button', { name: '직접 완료', exact: true }).first().click();
  await expect.poll(async () => JSON.parse((await qa.readLanguage()).dailyLearningHistory as string || '{}')?.[day]?.completedIds).toEqual(['kana']);
  await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
  const savedLanguage = await qa.readLanguage();
  await page.reload(); await page.locator('.routine-details > summary').click();
  await expect(page.getByRole('button', { name: '완료 취소', exact: true })).toBeVisible();
  await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
  expect(await qa.readLanguage()).toEqual(savedLanguage);
});

test('advice UI requires consent and handles success, quota and changed-record responses (synthetic provider)', async ({ page, qa }) => {
  expect((await qa.account.client.from('user_app_state').update({ state: { ...original, 'ai-fitness-water-intake': { [today()]: 300 } } }).eq('user_id', qa.account.id)).error).toBeNull();
  await login(page, qa.account);
  await page.goto('/fitness', { waitUntil: 'domcontentloaded' });
  await enterAdvice(page, 'fitness');
  let mode: 'success' | 'quota' | 'changed' = 'success'; let analyzeCalls = 0;
  await page.route('**/api/ai/free-advice', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'preview') {
      // Retain real authenticated server + database reads. Only provider
      // availability and generation responses are synthetic in this UI test.
      const response = await route.fetch(); expect(response.status()).toBe(200);
      await route.fulfill({ response, json: { ...await response.json(), configured: true } }); return;
    }
    analyzeCalls++;
    expect(body.freeDataUseAcknowledged).toBe(true); expect(body.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    if (mode === 'quota') { await route.fulfill({ status: 429, json: { code: 'FREE_ADVICE_QUOTA', error: '무료 AI 이용 한도에 도달했어요.' } }); return; }
    if (mode === 'changed') { await route.fulfill({ status: 409, json: { code: 'FREE_ADVICE_RECORDS_CHANGED', error: '기록이 바뀌었어요. 최신 기록을 다시 확인해 주세요.' } }); return; }
    await route.fulfill({ status: 200, json: { advice: { summary: '합성 검증용 조언이에요.', nextSteps: ['오늘 물 섭취 기록을 확인하세요.'], basis: '합성 물 기록 1일', limitations: '기록 외의 상태는 알 수 없어요.' } } });
  });
  const panel = page.getByRole('region', { name: '운동 무료 AI 조언', exact: true });
  await panel.getByRole('button', { name: '조언받을 기록 확인', exact: true }).click();
  const submit = panel.getByRole('button', { name: '무료 AI 조언받기', exact: true });
  await expect(submit).toBeDisabled(); expect(analyzeCalls).toBe(0);
  await panel.getByRole('checkbox').check(); await submit.click();
  await expect(page.getByRole('region', { name: '연이에게 말하기', exact: true })).toContainText('합성 검증용 조언이에요.'); expect(analyzeCalls).toBe(1);
  await page.reload();
  await expect(page.getByRole('region', { name: '연이에게 말하기', exact: true })).toContainText('합성 검증용 조언이에요.');
  expect((await qa.account.client.from('assistant_chat_messages').select('id').eq('user_id', qa.account.id).like('content', '%합성 검증용 조언이에요.%')).data).toHaveLength(1);
  await askAdvice(page, 'fitness');
  await panel.getByRole('button', { name: '조언받을 기록 확인', exact: true }).click();
  await panel.getByRole('checkbox').check();
  mode = 'quota'; await submit.click();
  await expect(panel).toContainText('무료 AI 이용 한도에 도달했어요.'); expect(analyzeCalls).toBe(2);
  await expect(panel.getByText('합성 검증용 조언이에요.', { exact: true })).toHaveCount(0);
  mode = 'changed'; await submit.click();
  await expect(panel).toContainText('기록이 바뀌었어요.'); expect(analyzeCalls).toBe(3);
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
  await panel.getByRole('button', { name: '조언받을 기록 확인', exact: true }).click();
  await expect(panel.getByRole('checkbox')).not.toBeChecked(); await expect(submit).toBeDisabled();
});

test('empty records stay explicit and quick commands preserve Zephyr without device speech', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await page.goto('/fitness');
  await enterAdvice(page, 'fitness');
  const panel = page.getByRole('region', { name: '운동 무료 AI 조언', exact: true });
  await panel.getByRole('button', { name: '조언받을 기록 확인', exact: true }).click();
  await expect(panel).toContainText('아직 분석할 기록이 없어요.');
  await expect(panel.getByRole('button', { name: '무료 AI 조언받기', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '예시 기록으로 먼저 보기', exact: true }).click();
  await expect(panel.getByText('가상의 예시 기록', { exact: true })).toBeVisible();
  await expect(panel).toContainText('실제 내 기록을 사용하지 않는 예시');
  await expect(panel).toContainText('600mL');
  await expect(panel.getByRole('button', { name: '무료 AI 조언받기', exact: true })).toBeDisabled();
  let ttsCalls = 0;
  page.on('request', request => { if (request.url().includes('/api/tts')) ttsCalls++; });
  await page.addInitScript(() => {
    (window as unknown as { deviceSpeechCalls: number }).deviceSpeechCalls = 0;
    if (window.speechSynthesis) window.speechSynthesis.speak = () => { (window as unknown as { deviceSpeechCalls: number }).deviceSpeechCalls++; };
  });
  await page.goto('/assistant/quick?autorun=0&speak=1&command=' + encodeURIComponent('오늘 운동 계획 보여줘'));
  await expect(page.getByText('Zephyr 음성', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '명령 실행', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/운동|회복/);
  await expect(page.getByRole('status').getByRole('link')).toHaveAttribute('href', '/fitness');
  expect(ttsCalls).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { deviceSpeechCalls: number }).deviceSpeechCalls)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('unified chat keeps ordinary queries and writes on their original review paths', async ({ page, qa }) => {
  await login(page, qa.account);
  await page.goto('/assistant');
  const chat = page.getByRole('region', { name: '연이에게 말하기', exact: true });
  const input = chat.getByRole('textbox', { name: '연이에게 보낼 명령', exact: true });
  await input.fill('요즘 운동 잘하고 있어?'); await chat.getByRole('button', { name: '전송', exact: true }).click();
  await expect(chat.getByRole('region', { name: '운동 무료 AI 조언', exact: true })).toBeVisible();
  await chat.getByRole('button', { name: '조언 취소', exact: true }).click();
  await chat.getByRole('button', { name: '오늘 운동 계획 보여줘', exact: true }).click();
  await expect(chat.getByRole('link', { name: /회복 계획 보기|운동 세부 화면 열기|운동 앱 열기/ }).last()).toBeVisible();
  await expect(chat.getByRole('region', { name: /무료 AI 조언$/ })).toHaveCount(0);
  await input.fill('할 일에 운동 조언받기 추가해줘');
  await chat.getByRole('button', { name: '전송', exact: true }).click();
  await expect(chat).toContainText('운동 조언받기');
  await expect(chat.getByRole('region', { name: /무료 AI 조언$/ })).toHaveCount(0);
  expect((await qa.account.client.from('assistant_items').select('id').eq('user_id', qa.account.id)).data).toHaveLength(0);
  await expect(chat.getByRole('button', { name: /확인.*저장|저장.*확인/ })).toBeVisible();
});
