import type { Page } from '@playwright/test';
import { test, expect, login, synced, original, assertOriginalPreserved, localState, today } from './fixture';

// Authored for the disposable local Supabase fixture; never use hosted records.
const key = 'ai-fitness-diet-completed-days';
const questions = ['오늘 배고픔을 느꼈나요?', '오늘 폭식 충동을 느꼈나요?', '잠들기 전에 과식했다고 느꼈나요?'] as const;
const fields = ['hunger', 'bingeUrge', 'preSleepOvereating'] as const;
const daysAgo = (days: number) => { const date = new Date(`${today()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0, 10); };
const answers = async (page: Page, values: readonly string[]) => {
  for (const [index, question] of questions.entries()) await expect(page.getByLabel(question, { exact: true })).toHaveValue(values[index]);
};
// Only fixed response enums from the isolated fixture may enter CI diagnostics.
// Do not print raw records, owner IDs, memos, tokens, or authentication details.
async function responseReadback(read: () => Promise<Record<string, unknown>>, expected: Record<string, string>, phase: string) {
  let received: unknown;
  try {
    await expect.poll(async () => {
      const state = await read(); received = (state[key] as Record<string, unknown> | undefined)?.[today()];
      return received;
    }).toMatchObject(expected);
  } catch (error) {
    const row = received && typeof received === 'object' && !Array.isArray(received) ? received as Record<string, unknown> : {};
    const allowed = new Set(['unrecorded', 'yes', 'no', 'comfortable', 'heartburn', 'bloated', 'nausea', 'abdominal_pain', 'diarrhea']);
    const actual = Object.fromEntries([...fields, 'digestionStatus', 'lateSnack', 'afterWorkoutMeal'].map(field => [field,
      row[field] === undefined ? 'absent' : typeof row[field] === 'string' && allowed.has(row[field] as string) ? row[field] : 'unknown',
    ]));
    console.log('QA_DIET_RESPONSE_READBACK ' + JSON.stringify({ phase, hasDay: received !== undefined, expected, actual }));
    throw error;
  }
}
const noOverflow = async (page: Page) => { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); };
const failNextLocalSave = async (page: Page) => page.evaluate(() => {
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    if (this === localStorage && key === 'ai-fitness-diet-completed-days') {
      Storage.prototype.setItem = originalSetItem;
      throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
    }
    return originalSetItem.call(this, key, value);
  };
});

for (const width of [320, 390]) {
  test(`diet independent self-responses preserve failed-save drafts, edit, reload and reset at ${width}px`, async ({ page, qa }) => {
    const history = {
      ...(original[key] as Record<string, unknown>),
      [daysAgo(1)]: { hunger: 'yes', bingeUrge: 'no', preSleepOvereating: 'unrecorded', originalField: { keep: true } },
      [daysAgo(2)]: { hunger: 'no', bingeUrge: 'yes', preSleepOvereating: 'no' },
      [daysAgo(3)]: { hunger: 'future-answer', lateSnack: 'yes' },
      [today()]: { originalField: { keep: true }, lateSnack: 'yes', lastMealTime: '23:55' },
    };
    const seeded = { ...original, [key]: history };
    expect((await qa.account.client.from('user_app_state').update({ state: seeded }).eq('user_id', qa.account.id)).error).toBeNull();
    await page.setViewportSize({ width, height: 844 });
    await login(page, qa.account); await synced(page); await page.goto('/diet');
    await answers(page, ['unrecorded', 'unrecorded', 'unrecorded']);
    // A self-response alone must register a dirty editor and resist a record refresh.
    await page.getByLabel(questions[0], { exact: true }).selectOption('yes');
    await expect.poll(() => page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
    })).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('yeoni-records-changed')));
    await expect(page.getByText('다른 기록이 갱신됐어요. 작성 중인 내용은 그대로 보존하고 있습니다.', { exact: true })).toBeVisible();
    await answers(page, ['yes', 'unrecorded', 'unrecorded']);
    await page.getByLabel(questions[1], { exact: true }).selectOption('no');
    await page.getByLabel(questions[2], { exact: true }).selectOption('yes');
    const beforeFailure = await localState(page);
    await failNextLocalSave(page);
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await expect(page.getByText('기기에 저장하지 못했어요. 작성 내용은 남아 있습니다. 저장 공간을 확인한 뒤 다시 저장해 주세요.', { exact: true })).toBeVisible();
    await answers(page, ['yes', 'no', 'yes']);
    expect(await localState(page)).toEqual(beforeFailure); expect(await qa.read()).toEqual(seeded);
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await expect.poll(async () => (await qa.read())[key]).toMatchObject({ [today()]: { hunger: 'yes', bingeUrge: 'no', preSleepOvereating: 'yes', originalField: { keep: true }, lateSnack: 'yes', lastMealTime: '23:55' } });
    await synced(page); await page.reload(); await synced(page);
    await answers(page, ['yes', 'no', 'yes']);
    const weekly = page.getByRole('region', { name: '최근 7일 식단 요약' });
    await expect(weekly).toContainText('배고픔: 예 2일 / 응답 3일 · 67% · 기존 응답 확인 필요 1일 (계산 제외)');
    await expect(weekly).toContainText('폭식 충동: 예 1일 / 응답 3일 · 33%');
    await expect(weekly).toContainText('수면 전 과식: 예 1일 / 응답 2일 · 50%');
    const comparison = page.getByRole('region', { name: '28일 식단 기록 비교' });
    await comparison.getByText('최근 28일 날짜별 근거', { exact: true }).click();
    await expect(comparison.getByText('배고픔 예 · 폭식 충동 아니요 · 수면 전 과식 미기록', { exact: true })).toBeVisible();
    await expect(comparison).toContainText('이 비교만으로 원인이나 건강 상태를 판단할 수 없습니다.');
    await noOverflow(page);
    // Editing one answer must not rewrite either independent answer.
    await page.getByLabel(questions[1], { exact: true }).selectOption('yes');
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await expect.poll(async () => (await qa.read())[key]).toMatchObject({ [today()]: { hunger: 'yes', bingeUrge: 'yes', preSleepOvereating: 'yes' } });
    await synced(page); await page.reload(); await synced(page);
    await answers(page, ['yes', 'yes', 'yes']);
    const beforeReset = await qa.read(); assertOriginalPreserved(beforeReset);
    for (const [date, record] of Object.entries(history)) if (date !== today()) expect((beforeReset[key] as Record<string, unknown>)[date]).toEqual(record);
    await page.getByLabel(questions[0], { exact: true }).selectOption('no');
    await failNextLocalSave(page);
    await page.getByRole('button', { name: '오늘 기록 초기화', exact: true }).click();
    await expect(page.getByText('초기화하지 못했어요. 기존 기록과 작성 내용을 유지합니다.', { exact: true })).toBeVisible();
    await answers(page, ['no', 'yes', 'yes']); expect(await qa.read()).toEqual(beforeReset);
    await page.getByRole('button', { name: '오늘 기록 초기화', exact: true }).click();
    await expect.poll(async () => Object.hasOwn((await qa.read())[key] as object, today())).toBe(false);
    await synced(page); await page.reload(); await synced(page);
    await answers(page, ['unrecorded', 'unrecorded', 'unrecorded']);
    const reset = await qa.read(); assertOriginalPreserved(reset);
    for (const [date, record] of Object.entries(history)) if (date !== today()) expect((reset[key] as Record<string, unknown>)[date]).toEqual(record);
    await noOverflow(page);
  });
}

test('diet unknown and absent responses survive unrelated saves, with explicit clearing and account isolation', async ({ page, qa }) => {
  const rawToday = { hunger: 'future-answer', bingeUrge: { version: 2, answer: 'yes' }, digestionStatus: 'future-status', lateSnack: 'future-answer', afterWorkoutMeal: 'future-answer', originalField: { keep: true } };
  const seeded = { ...original, [key]: { ...(original[key] as object), [today()]: rawToday } };
  expect((await qa.account.client.from('user_app_state').update({ state: seeded }).eq('user_id', qa.account.id)).error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page); await page.goto('/diet');
  await answers(page, ['unknown', 'unknown', 'unrecorded']);
  for (const label of ['소화 상태', '야식을 먹었나요?', '운동 후 식사를 했나요?']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('unknown');
  await expect(page.getByLabel(questions[0], { exact: true }).getByRole('option', { name: '기존 응답 형식 확인 필요' })).toHaveAttribute('disabled', '');
  await expect(page.getByRole('region', { name: '최근 7일 식단 요약' })).toContainText('배고픔: 미기록 · 응답 0일 · 기존 응답 확인 필요 1일 (계산 제외)');
  await page.getByLabel('메모', { exact: true }).fill('합성 무관한 메모 변경');
  await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
  await expect.poll(async () => (await qa.read())[key]).toMatchObject({ [today()]: { ...rawToday, dietMemo: '합성 무관한 메모 변경' } });
  await synced(page);
  expect(Object.hasOwn(((await qa.read())[key] as Record<string, object>)[today()], fields[2])).toBe(false);
  await page.reload(); await synced(page); await answers(page, ['unknown', 'unknown', 'unrecorded']);
  await noOverflow(page);
  await page.getByLabel(questions[0], { exact: true }).selectOption('unrecorded');
  await page.getByLabel(questions[2], { exact: true }).selectOption('no');
  await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
  await expect.poll(async () => (await qa.read())[key]).toMatchObject({ [today()]: { ...rawToday, hunger: 'unrecorded', preSleepOvereating: 'no' } });
  await synced(page); await page.reload(); await synced(page);
  await answers(page, ['unrecorded', 'unknown', 'no']);
  const ownerSaved = await qa.read(); assertOriginalPreserved(ownerSaved);
  const other = await qa.createAccount();
  expect((await other.client.from('user_app_state').select('user_id').eq('user_id', qa.account.id)).data).toEqual([]);
  await page.goto('/diet/settings'); await synced(page);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
  await login(page, other); await synced(page); await page.goto('/diet');
  await answers(page, ['unrecorded', 'unrecorded', 'unrecorded']);
  await expect(page.getByLabel('메모', { exact: true })).toHaveValue('');
  await expect(page.getByRole('region', { name: '최근 7일 식단 요약' })).toContainText('배고픔: 미기록 · 응답 0일');
  await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
  await expect.poll(async () => Object.hasOwn((await qa.read(other))[key] as object, today())).toBe(true);
  await synced(page); await page.reload(); await synced(page);
  await answers(page, ['unrecorded', 'unrecorded', 'unrecorded']);
  const otherSaved = await qa.read(other);
  for (const field of fields) expect(Object.hasOwn((otherSaved[key] as Record<string, object>)[today()], field)).toBe(false);
  expect(await qa.read()).toEqual(ownerSaved); assertOriginalPreserved(otherSaved);
  await noOverflow(page);
});

test('diet self-responses survive reload after a failed server confirmation and recover by readback', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); await page.goto('/diet'); await synced(page);
  for (const [index, question] of questions.entries()) await page.getByLabel(question, { exact: true }).selectOption(index === 1 ? 'no' : 'yes');
  const hold = qa.traffic.holdNext('POST', 'response');
  await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click(); await hold.arrived;
  qa.traffic.failReads = true; hold.release();
  await expect(page.getByText('기록 동기화 실패', { exact: true })).toBeVisible();
  await expect(page.getByText('서버 반영 완료', { exact: true })).toHaveCount(0);
  await answers(page, ['yes', 'no', 'yes']);
  expect((await localState(page))[key]).toMatchObject({ [today()]: { hunger: 'yes', bingeUrge: 'no', preSleepOvereating: 'yes' } });
  await page.reload(); await answers(page, ['yes', 'no', 'yes']);
  await expect(page.getByText('기록 동기화 실패', { exact: true })).toBeVisible();
  qa.traffic.failReads = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click(); await synced(page);
  const saved = await qa.read(); assertOriginalPreserved(saved);
  expect(saved[key]).toMatchObject({ [today()]: { hunger: 'yes', bingeUrge: 'no', preSleepOvereating: 'yes' } });
  expect(qa.traffic.entries.filter(entry => entry.method === 'GET' && entry.table === 'user_app_state' && entry.status === 200).at(-1)?.receivedState).toEqual(saved);
  await page.reload(); await synced(page); await answers(page, ['yes', 'no', 'yes']);
});

test('diet dirty self-response saves retain another tab\'s independent answers and do not resurrect reset answers', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); await page.goto('/diet'); await synced(page);
  const otherTab = await page.context().newPage();
  try {
    await otherTab.goto('/diet'); await synced(otherTab);
    await answers(otherTab, ['unrecorded', 'unrecorded', 'unrecorded']);
    await page.getByLabel(questions[0], { exact: true }).selectOption('yes');
    await otherTab.getByLabel(questions[1], { exact: true }).selectOption('no');
    await otherTab.getByLabel(questions[2], { exact: true }).selectOption('yes');
    await otherTab.getByLabel('소화 상태', { exact: true }).selectOption('diarrhea');
    await otherTab.getByLabel('야식을 먹었나요?', { exact: true }).selectOption('yes');
    await otherTab.getByLabel('운동 후 식사를 했나요?', { exact: true }).selectOption('no');
    await otherTab.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await synced(otherTab);
    await responseReadback(qa.read, { bingeUrge: 'no', preSleepOvereating: 'yes', digestionStatus: 'diarrhea', lateSnack: 'yes', afterWorkoutMeal: 'no' }, 'peer-save');
    await expect(page.getByText('다른 기록이 갱신됐어요. 작성 중인 내용은 그대로 보존하고 있습니다.', { exact: true })).toBeVisible();
    await answers(page, ['yes', 'unrecorded', 'unrecorded']);
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await responseReadback(qa.read, { hunger: 'yes', bingeUrge: 'no', preSleepOvereating: 'yes', digestionStatus: 'diarrhea', lateSnack: 'yes', afterWorkoutMeal: 'no' }, 'merged-save');
    await synced(page); await page.reload(); await synced(page);
    await answers(page, ['yes', 'no', 'yes']);
    await expect(page.getByLabel('소화 상태', { exact: true })).toHaveValue('diarrhea');
    await expect(page.getByLabel('야식을 먹었나요?', { exact: true })).toHaveValue('yes');
    await expect(page.getByLabel('운동 후 식사를 했나요?', { exact: true })).toHaveValue('no');
    // A reset in the peer tab must not be undone by untouched stale selectors.
    await page.getByLabel(questions[0], { exact: true }).selectOption('no');
    await otherTab.getByRole('button', { name: '오늘 기록 초기화', exact: true }).click();
    await expect.poll(async () => Object.hasOwn((await qa.read())[key] as object, today())).toBe(false);
    await synced(otherTab);
    await answers(page, ['no', 'no', 'yes']);
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await responseReadback(qa.read, { hunger: 'no', digestionStatus: 'unrecorded', lateSnack: 'unrecorded', afterWorkoutMeal: 'unrecorded' }, 'save-after-peer-reset');
    await synced(page); await page.reload(); await synced(page);
    await answers(page, ['no', 'unrecorded', 'unrecorded']);
    const saved = await qa.read(); assertOriginalPreserved(saved);
    for (const field of ['bingeUrge', 'preSleepOvereating']) expect(Object.hasOwn((saved[key] as Record<string, object>)[today()], field)).toBe(false);
  } finally {
    await otherTab.close();
  }
});
