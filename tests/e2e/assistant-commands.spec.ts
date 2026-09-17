import { expect, login, synced, test, canonical, type State } from './fixture';

test('shortcut auto-parses without saving; cancel and reload stay unchanged, confirmed retry saves once with history and undo', async ({ page, qa }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, qa.account); await synced(page);
  const command = '오늘 할 일에 합성 장보기 추가해줘';
  await page.goto(`/assistant/quick?command=${encodeURIComponent(command)}`);
  const review = page.getByRole('region', { name: '할 일 변경 확인' });
  await expect(review).toBeVisible();
  const rows = async () => {
    const result = await qa.account.client.from('assistant_items').select('*');
    expect(result.error).toBeNull(); return result.data!;
  };
  expect(await rows()).toHaveLength(0);
  await review.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByText('취소했습니다. 할 일은 변경하지 않았습니다.')).toBeVisible();
  await page.reload(); await expect(review).toHaveCount(0);
  await page.getByLabel('실행할 명령').fill(command);
  await page.getByRole('button', { name: '명령 실행', exact: true }).click();
  await expect(review).toBeVisible();
  expect(await rows()).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Commit really reaches isolated Postgres, then deliberately lose the response.
  let lose = true;
  await page.route('**/api/assistant/commands', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().decision === 'apply' && lose) {
      lose = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  await review.getByRole('button', { name: '확인하고 저장', exact: true }).click();
  await expect(review.getByRole('alert')).toBeVisible();
  expect(await rows()).toHaveLength(1);
  await page.reload();
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: '같은 요청으로 다시 확인' }).click();
  await expect(page.getByText(/할 일 추가 완료/)).toBeVisible();
  expect(await rows()).toHaveLength(1);
  await page.getByRole('link', { name: '실행 이력 보기 →' }).first().click();
  await expect(page.getByRole('heading', { name: '연이 실행 이력' })).toBeVisible();
  await page.reload();
  const receipt = page.getByRole('article', { name: '합성 장보기 실행 이력' });
  await expect(receipt).toBeVisible();
  await receipt.getByRole('button', { name: '이 변경 되돌리기' }).click();
  expect(await rows()).toHaveLength(1);
  await receipt.getByRole('button', { name: '확인하고 되돌리기' }).click();
  await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible();
  expect(await rows()).toHaveLength(0);
  await page.reload(); await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible();
});

test('chat creates a reviewed task; two browser sessions cannot confirm stale changes, and update undo restores reviewed fields', async ({ page, qa, browser }) => {
  await login(page, qa.account); await synced(page);
  await page.goto('/assistant');
  const input = page.getByLabel('연이에게 보낼 명령');
  await expect(input).toBeEnabled();
  await input.fill('오늘 할 일에 합성 보고서 추가해줘');
  await input.press('Enter');
  const review = page.getByRole('region', { name: '할 일 변경 확인' });
  await expect(review).toBeVisible();
  await page.goto('/assistant/quick');
  await expect(review).toBeVisible();
  await page.goto('/assistant');
  await page.reload();
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: '확인하고 저장' }).click();
  await expect(page.getByText(/할 일 추가 완료/)).toBeVisible();
  const before = (await qa.account.client.from('assistant_items').select('*').single()).data!;

  const second = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await qa.traffic.install(second);
  const otherPage = await second.newPage();
  try {
    await login(otherPage, qa.account); await synced(otherPage);
    const command = '할 일 합성 보고서 내일로 변경해줘';
    await page.goto(`/assistant/quick?command=${encodeURIComponent(command)}`);
    await expect(review).toBeVisible();
    await otherPage.goto(`/assistant/quick?command=${encodeURIComponent(command)}`);
    const secondReview = otherPage.getByRole('region', { name: '할 일 변경 확인' });
    await expect(secondReview).toBeVisible();
    expect(canonical((await qa.account.client.from('assistant_items').select('*').single()).data as State)).toBe(canonical(before));
    await review.getByRole('button', { name: '확인하고 저장' }).click();
    await expect(page.getByText(/할 일 수정 완료/)).toBeVisible();
    await secondReview.getByRole('button', { name: '확인하고 저장' }).click();
    await expect(secondReview.getByRole('alert')).toContainText('다른 곳에서 변경');
    expect((await qa.account.client.from('assistant_task_command_history').select('id')).data).toHaveLength(2);
    await page.getByRole('button', { name: '이 변경 되돌리기' }).click();
    await page.getByRole('button', { name: '확인하고 되돌리기' }).click();
    await expect(page.getByText(/되돌리기 완료/)).toBeVisible();
    const after = (await qa.account.client.from('assistant_items').select('*').single()).data!;
    expect(after.due_at).toBe(before.due_at);
    expect(after.priority).toBe(before.priority);
    expect(after.recurrence_rule).toBe(before.recurrence_rule);
    await page.goto('/assistant');
    await expect(page.locator('#assistant-list').getByText('합성 보고서', { exact: true })).toBeVisible();
  } finally { await second.close(); }
});

test('invalid dates and compound mutations do not save; history read failure is not shown as empty and another account sees none', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page);
  await page.goto(`/assistant/quick?command=${encodeURIComponent('2월 30일 할 일에 합성 검증 추가해줘')}`);
  await expect(page.getByText(/존재하는 날짜/)).toBeVisible();
  await page.goto(`/assistant/quick?command=${encodeURIComponent('오늘 할 일에 합성 검증 추가해줘 그리고 운동 완료했어')}`);
  await expect(page.getByText(/기록을 바꾸는 명령은 한 번에 하나씩/)).toBeVisible();
  expect((await qa.account.client.from('assistant_items').select('id')).data).toHaveLength(0);
  await page.goto(`/assistant/quick?command=${encodeURIComponent('오늘 할 일에 합성 비공개 추가해줘')}`);
  await page.getByRole('button', { name: '확인하고 저장' }).click();
  await expect(page.getByText(/할 일 추가 완료/)).toBeVisible();

  const other = await qa.createAccount();
  const privateRows = await other.client.from('assistant_task_command_history').select('*');
  expect(privateRows.error).toBeNull(); expect(privateRows.data).toHaveLength(0);
  await page.route('**/api/assistant/commands?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '합성 조회 실패' }) }));
  await page.goto('/assistant/history');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('합성 조회 실패');
  await expect(page.getByText('아직 확인하고 실행한 명령이 없습니다.')).toHaveCount(0);
  await page.unroute('**/api/assistant/commands?*');
  await page.getByRole('button', { name: '이력 새로고침' }).click();
  await expect(page.getByRole('article', { name: '합성 비공개 실행 이력' })).toBeVisible();
});

test('pending draft keeps its request across reload, expires without saving, and is not restored for another owner', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page);
  await page.goto(`/assistant/quick?command=${encodeURIComponent('오늘 할 일에 합성 복구검증 추가해줘')}`);
  const review = page.getByRole('region', { name: '할 일 변경 확인' });
  await expect(review).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem('yeoni:task-command-drafts:v1'));
  expect(stored).toBeTruthy();
  await page.reload(); await expect(review).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('yeoni:task-command-drafts:v1'))).toBe(stored);
  expect((await qa.account.client.from('assistant_items').select('id')).data).toHaveLength(0);
  await page.clock.setFixedTime(new Date(Date.now() + 16 * 60_000));
  await expect(review.getByRole('button', { name: '확인하고 저장' })).toBeDisabled();
  await expect(review).toContainText('확인 시간이 지났습니다.');
  await review.getByRole('button', { name: '취소', exact: true }).click();
  await page.reload(); await expect(review).toHaveCount(0);
  // Synthetic other-owner envelope must never be rendered in the active account.
  await page.evaluate(raw => {
    const envelope = JSON.parse(raw!); envelope.ownerId = 'another-synthetic-owner';
    sessionStorage.setItem('yeoni:task-command-drafts:v1', JSON.stringify(envelope));
  }, stored);
  await page.reload(); await expect(review).toHaveCount(0);
  expect((await qa.account.client.from('assistant_items').select('id')).data).toHaveLength(0);
  await page.evaluate(() => sessionStorage.setItem('yeoni:task-command-drafts:v1', '{invalid'));
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: '확인 대기 내용을 복구하지 못했습니다' })).toBeVisible();
});

test('completion is reviewed, survives reload, creates one recurrence and undo restores the exact task', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const seed = await qa.account.client.from('assistant_items').insert({ user_id: qa.account.id, title: '합성 반복 완료', kind: 'task', status: 'open', priority: 2, recurrence_rule: 'monthly', due_at: '2026-01-31T14:59:00Z' }).select('*').single();
  expect(seed.error).toBeNull();
  const before = seed.data!;
  const rows = async () => (await qa.account.client.from('assistant_items').select('*').order('created_at')).data!;
  await login(page, qa.account); await synced(page);
  const command = '합성 반복 완료 할 일 완료해줘';
  await page.goto(`/assistant/quick?command=${encodeURIComponent(command)}`);
  const review = page.getByRole('region', { name: '할 일 변경 확인' });
  await expect(review.getByRole('heading', { name: '할 일 완료 확인' })).toBeVisible();
  expect(canonical((await rows())[0])).toBe(canonical(before));
  await review.getByRole('button', { name: '취소', exact: true }).click();
  await page.reload(); await expect(review).toHaveCount(0);
  await page.getByLabel('실행할 명령').fill(command);
  await page.getByRole('button', { name: '명령 실행', exact: true }).click();
  await expect(review).toBeVisible();
  await page.reload(); await expect(review).toBeVisible();
  expect(canonical((await rows())[0])).toBe(canonical(before));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await review.getByRole('button', { name: '확인하고 저장' }).click();
  await expect(page.getByText(/할 일 완료 저장/)).toBeVisible();
  const saved = await rows(); expect(saved).toHaveLength(2);
  expect(saved.find(row => row.id === before.id).status).toBe('completed');
  expect(new Date(saved.find(row => row.recurrence_parent_id === before.id).due_at).toISOString()).toBe('2026-02-28T14:59:00.000Z');
  await page.goto('/assistant/history'); await page.reload();
  const receipt = page.getByRole('article', { name: '합성 반복 완료 실행 이력' });
  await expect(receipt.getByText(/다음 반복 일정/)).toBeVisible();
  await receipt.getByRole('button', { name: '이 변경 되돌리기' }).click();
  expect(await rows()).toHaveLength(2);
  await receipt.getByRole('button', { name: '확인하고 되돌리기' }).click();
  await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible();
  expect(canonical(await rows())).toBe(canonical([before]));
});

test('completion refuses ambiguous titles and undo protects a subsequently edited recurrence', async ({ page, qa }) => {
  const seed = await qa.account.client.from('assistant_items').insert([
    { user_id: qa.account.id, title: '합성 중복', kind: 'task', status: 'open', priority: 2, recurrence_rule: 'none' },
    { user_id: qa.account.id, title: '합성 중복', kind: 'task', status: 'open', priority: 2, recurrence_rule: 'none' },
    { user_id: qa.account.id, title: '합성 보호', kind: 'task', status: 'open', priority: 2, recurrence_rule: 'daily' },
  ]);
  expect(seed.error).toBeNull();
  await login(page, qa.account); await synced(page);
  await page.goto(`/assistant/quick?command=${encodeURIComponent('합성 중복 할 일 완료해줘')}`);
  await expect(page.getByText(/제목의 미완료 할 일이 여러 개/)).toBeVisible();
  await expect(page.getByRole('region', { name: '할 일 변경 확인' })).toHaveCount(0);
  expect((await qa.account.client.from('assistant_task_command_history').select('*')).data).toHaveLength(0);
  await page.goto(`/assistant/quick?command=${encodeURIComponent('합성 보호 할 일 완료해줘')}`);
  await page.getByRole('button', { name: '확인하고 저장' }).click();
  await expect(page.getByText(/할 일 완료 저장/)).toBeVisible();
  const child = (await qa.account.client.from('assistant_items').select('*').not('recurrence_parent_id', 'is', null).single()).data!;
  expect((await qa.account.client.from('assistant_items').update({ title: '나중에 수정한 반복 일정' }).eq('id', child.id)).error).toBeNull();
  const beforeUndo = (await qa.account.client.from('assistant_items').select('*').order('id')).data!;
  await page.getByRole('button', { name: '이 변경 되돌리기' }).click();
  await page.getByRole('button', { name: '확인하고 되돌리기' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(canonical((await qa.account.client.from('assistant_items').select('*').order('id')).data!)).toBe(canonical(beforeUndo));
});
