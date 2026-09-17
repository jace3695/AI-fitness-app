import { expect, login, synced, test, today, canonical } from './fixture';
import type { Page } from '@playwright/test';
const command = (amount = 4500, place = '합성 명령카페') => `가계부 오늘 ${place} 지출 금액을 ${amount}원으로 수정해줘`;
// The review/error assertions below establish readiness; unrelated resource
// loading must not gate command navigation (WebKit can fail at the load event).
const openCommand = (page: Page, text: string) => page.goto(`/assistant/quick?command=${encodeURIComponent(text)}`, { waitUntil: 'domcontentloaded' });
const reviewFor = (page: Page) => page.getByRole('region', { name: '가계부 변경 확인' });
const expense = (userId: string, place = '합성 명령카페') => ({ user_id: userId, date: today(), place, amount: 5000, category: '카페', payment: '체크카드', transaction_type: '일반 지출', memo: '그대로 보존할 메모' });

test('budget command reviews one original, survives lost response and reload, then common history undoes exactly that amount', async ({ page, qa }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seeded = await qa.account.client.from('budget_transactions').insert(expense(qa.account.id)).select('*').single();
  expect(seeded.error).toBeNull(); const original = seeded.data!;
  expect((await qa.account.client.from('budget_profiles').insert({ user_id: qa.account.id, nickname: '명령 검증' })).error).toBeNull();
  const read = async () => (await qa.account.client.from('budget_transactions').select('*').eq('id', original.id).single()).data!;
  await login(page, qa.account); await synced(page);
  await openCommand(page, command());
  const review = reviewFor(page); await expect(review).toBeVisible();
  await expect(review).toContainText('₩5,000'); await expect(review).toContainText('₩4,500');
  expect(canonical(await read())).toBe(canonical(original));
  await review.getByRole('button', { name: '취소', exact: true }).click();
  await page.reload(); await expect(review).toHaveCount(0);
  expect(canonical(await read())).toBe(canonical(original));
  await page.goto('/assistant');
  const input = page.getByLabel('연이에게 보낼 명령'); await expect(input).toBeEnabled();
  await input.fill(command()); await input.press('Enter'); await expect(review).toBeVisible();
  await page.getByRole('link', { name: 'Siri 빠른 명령 설정 →' }).click();
  await expect(review).toBeVisible();
  let lose = true;
  await page.route('**/api/assistant/budget-commands', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().decision === 'apply' && lose) {
      lose = false; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
    } else await route.continue();
  });
  await review.getByRole('button', { name: '확인하고 저장', exact: true }).click();
  await expect(review.getByRole('alert')).toBeVisible();
  expect(canonical(await read())).toBe(canonical({ ...original, amount: 4500 }));
  await page.reload(); await expect(review).toBeVisible();
  await review.getByRole('button', { name: '같은 요청으로 다시 확인' }).click();
  await expect(page.getByText(/가계부 변경 완료/)).toBeVisible();
  expect((await qa.account.client.from('budget_category_changes').select('id')).data).toHaveLength(1);
  await page.getByRole('link', { name: '가계부 실행 이력 보기 →' }).click();
  // The receipt is also visible on the quick-command page. Wait for navigation
  // before reloading, so a still-visible source receipt cannot satisfy the check.
  await expect(page).toHaveURL(/\/assistant\/history\?area=budget$/);
  const receipt = page.getByRole('region', { name: '가계부 실행 이력 목록' }).getByRole('article', { name: '가계부 금액 1건 실행 이력' });
  await expect(receipt).toBeVisible(); await page.reload(); await expect(receipt).toBeVisible();
  await receipt.getByRole('button', { name: '변경 전후 보기' }).click();
  await expect(receipt).toContainText('₩5,000 → ₩4,500'); await expect(receipt).toContainText('합성 명령카페');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/budget');
  await page.getByRole('navigation', { name: '가계부 주요 메뉴' }).getByRole('button', { name: '상세 내역', exact: true }).click();
  await page.getByText('지출 수정·분류 기억·변경 이력', { exact: true }).click();
  const editor = page.getByRole('region', { name: '지출 수정과 변경 이력' });
  await expect(editor.getByLabel(`합성 명령카페 ${today()} 내역 선택`).locator('..')).toContainText('₩4,500');
  await page.goto('/assistant/history?area=budget'); await expect(receipt).toBeVisible();
  await receipt.getByRole('button', { name: '이 변경 되돌리기' }).click();
  expect((await read()).amount).toBe(4500);
  await receipt.getByRole('button', { name: '확인하고 되돌리기' }).click();
  await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible();
  expect(canonical(await read())).toBe(canonical(original));
  await page.reload(); await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible();
  await page.getByRole('navigation', { name: '실행 이력 영역' }).getByRole('link', { name: '할 일', exact: true }).click();
  await expect(page.getByText('아직 확인하고 실행한 명령이 없습니다.')).toBeVisible();
});

test('independent sessions reject stale budget confirmation and common undo refuses later memo edits', async ({ page, qa, browser }) => {
  const seeded = await qa.account.client.from('budget_transactions').insert(expense(qa.account.id)).select('*').single();
  expect(seeded.error).toBeNull(); const original = seeded.data!;
  await login(page, qa.account); await synced(page); await openCommand(page, command()); await expect(reviewFor(page)).toBeVisible();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); await qa.traffic.install(context);
  try {
    const second = await context.newPage(); await login(second, qa.account); await synced(second);
    await openCommand(second, command(6000)); await expect(reviewFor(second)).toBeVisible();
    await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(page.getByText(/가계부 변경 완료/)).toBeVisible();
    await reviewFor(second).getByRole('button', { name: '확인하고 저장' }).click();
    await expect(reviewFor(second).getByRole('alert')).toContainText('다른 곳에서 변경');
    expect((await qa.account.client.from('budget_category_changes').select('id')).data).toHaveLength(1);
    expect((await qa.account.client.from('budget_transactions').update({ memo: '다른 화면에서 수정한 메모' }).eq('id', original.id)).error).toBeNull();
    await page.getByRole('button', { name: '이 변경 되돌리기' }).click(); await page.getByRole('button', { name: '확인하고 되돌리기' }).click();
    await expect(page.getByRole('article').getByRole('alert')).toContainText('이후에 바뀐 기록');
    const after = (await qa.account.client.from('budget_transactions').select('*').eq('id', original.id).single()).data!;
    expect(canonical(after)).toBe(canonical({ ...original, amount: 4500, memo: '다른 화면에서 수정한 메모' }));
  } finally { await context.close(); }
});

test('ambiguous records and expired drafts do not change expenses; owner-only history distinguishes failures from empty', async ({ page, qa }) => {
  const seeded = await qa.account.client.from('budget_transactions').insert([expense(qa.account.id), expense(qa.account.id), expense(qa.account.id, '합성 단일카페')]).select('*');
  expect(seeded.error).toBeNull();
  await login(page, qa.account); await synced(page);
  await openCommand(page, command()); await expect(page.getByText(/같은 날짜·사용처의 지출이 여러 건/)).toBeVisible(); await expect(reviewFor(page)).toHaveCount(0);
  await openCommand(page, command(4500, '합성 단일카페')); await expect(reviewFor(page)).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('yeoni:task-command-drafts:v1')!).drafts[0].proposal);
  const ownToken = (await qa.account.client.auth.getSession()).data.session!.access_token;
  const other = await qa.createAccount(), otherToken = (await other.client.auth.getSession()).data.session!.access_token;
  const foreign = await page.request.post('/api/assistant/budget-commands', { headers: { Authorization: `Bearer ${otherToken}` }, data: { decision: 'apply', proposal: stored } }); expect(foreign.status()).toBe(409);
  const expired = await page.request.post('/api/assistant/budget-commands', { headers: { Authorization: `Bearer ${ownToken}` }, data: { decision: 'apply', proposal: { ...stored, expiresAt: '2001-01-01T00:00:00Z' } } }); expect(expired.status()).toBe(409);
  expect((await qa.account.client.from('budget_category_changes').select('id')).data).toHaveLength(0);
  expect((await qa.account.client.from('budget_transactions').select('amount')).data?.every(row => row.amount === 5000)).toBe(true);
  await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(page.getByText(/가계부 변경 완료/)).toBeVisible();
  const hidden = await page.request.get(`/api/assistant/budget-commands?requestId=${stored.requestId}`, { headers: { Authorization: `Bearer ${otherToken}` } }); expect(hidden.status()).toBe(404); expect(hidden.headers()['cache-control']).toBe('no-store');
  expect((await page.request.get('/api/assistant/budget-commands')).status()).toBe(401);
  await page.route('**/api/assistant/budget-commands?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '합성 가계부 이력 조회 실패' }) }));
  await page.goto('/assistant/history?area=budget'); await expect(page.getByRole('main').getByRole('alert')).toContainText('합성 가계부 이력 조회 실패');
  await expect(page.getByText('아직 가계부 변경 이력이 없습니다.')).toHaveCount(0);
  await page.unroute('**/api/assistant/budget-commands?*'); await page.getByRole('button', { name: '가계부 이력 새로고침' }).click();
  await expect(page.getByRole('article', { name: '가계부 금액 1건 실행 이력' })).toBeVisible();
});

test('common history lists native budget edits, loads older pages once and preserves category undo', async ({ page, qa }) => {
  let row = (await qa.account.client.from('budget_transactions').insert(expense(qa.account.id)).select('*').single()).data!;
  for (let i = 0; i < 21; i++) {
    const changed = await qa.account.client.rpc('change_budget_categories', { p_request_id: crypto.randomUUID(), p_rows: [{ id: row.id, expected: row }], p_category: i % 2 ? '카페' : '식비', p_remember: false });
    expect(changed.error).toBeNull(); row = (await qa.account.client.from('budget_transactions').select('*').eq('id', row.id).single()).data!;
  }
  await login(page, qa.account); await synced(page); await page.goto('/assistant/history?area=budget');
  const history = page.getByRole('region', { name: '가계부 실행 이력 목록' });
  await expect(history.getByRole('article')).toHaveCount(20);
  await history.getByRole('button', { name: '이전 가계부 이력 더 보기' }).click(); await expect(history.getByRole('article')).toHaveCount(21);
  await expect(history.getByRole('button', { name: '이전 가계부 이력 더 보기' })).toHaveCount(0);
  const latest = history.getByRole('article').first(); await latest.getByRole('button', { name: '변경 전후 보기' }).click(); await expect(latest).toContainText('카페 → 식비');
  await latest.getByRole('button', { name: '이 변경 되돌리기' }).click(); await latest.getByRole('button', { name: '확인하고 되돌리기' }).click();
  await expect(history.getByRole('article').first().getByText(/되돌리기 완료/)).toBeVisible();
  expect((await qa.account.client.from('budget_transactions').select('category').eq('id', row.id).single()).data?.category).toBe('카페');
});
