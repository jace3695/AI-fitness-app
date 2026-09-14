import type { Page } from '@playwright/test';
import { canonical, expect, login, test, today, Traffic } from './fixture';

const menu = (page: Page) => page.getByRole('navigation', { name: '가계부 주요 메뉴' });
async function openEditor(page: Page) {
  await menu(page).getByRole('button', { name: '상세 내역', exact: true }).click();
  await page.getByText('지출 분류 수정·기억·변경 이력', { exact: true }).click();
  const panel = page.getByRole('region', { name: '분류 수정과 변경 이력' });
  await expect(panel.getByLabel('변경할 분류')).toBeEnabled();
  return panel;
}
const expense = (userId: string, date: string, place: string, amount = 5000, category = '기타') => ({ user_id: userId, date, place, amount, category, payment: '체크카드', transaction_type: '일반 지출', memo: '보존할 합성 메모' });

test('bulk category memory, full history, preview, save and undo survive reload without altering other fields', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const date = today();
  const previous = new Date(`${date.slice(0,7)}-01T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth() - 1);
  const oldDate = previous.toISOString().slice(0,10);
  expect((await qa.account.client.from('budget_profiles').insert({ user_id: qa.account.id, nickname: '분류 합성 계정' })).error).toBeNull();
  const seed = await qa.account.client.from('budget_transactions').insert([expense(qa.account.id,date,'스타벅스'),expense(qa.account.id,oldDate,'스타벅스',6000)]).select('*').order('id');
  expect(seed.error).toBeNull(); const originals = seed.data!;
  const other = await qa.createAccount();
  expect((await other.client.from('budget_transactions').insert(expense(other.id,date,'다른 계정 상점',99999))).error).toBeNull();
  await login(page, qa.account, '/budget');
  let panel = await openEditor(page);
  await expect(panel.getByText(/다른 계정 상점/)).toHaveCount(0);
  await panel.getByRole('checkbox', { name: `스타벅스 ${date} 분류 선택`, exact: true }).check();
  await panel.getByRole('checkbox', { name: `스타벅스 ${oldDate} 분류 선택`, exact: true }).check();
  await panel.getByLabel('변경할 분류').selectOption('교통');
  await panel.getByLabel('이 장소의 분류 기억').check();
  await panel.getByRole('button', { name: '선택 2건 분류 변경', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '선택한 분류 변경' });
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  expect(canonical((await qa.account.client.from('budget_transactions').select('*').order('id')).data)).toBe(canonical(originals));
  await panel.getByRole('button', { name: '선택 2건 분류 변경', exact: true }).click();
  await dialog.getByRole('button', { name: '분류 변경', exact: true }).click();
  await expect(panel.getByText('2건의 분류 변경을 확인했어요.', { exact: true })).toBeVisible();
  await expect.poll(async () => canonical((await qa.account.client.from('budget_transactions').select('*').order('id')).data)).toBe(canonical(originals.map(row => ({ ...row, category: '교통' }))));
  await page.reload(); panel = await openEditor(page);
  await panel.getByText('분류 변경 이력 · 최근 20건', { exact: true }).click();
  await panel.getByRole('button', { name: '교통 2건 변경 전후 보기' }).click();
  await expect(panel.getByText('스타벅스 · 기타 → 교통', { exact: true })).toHaveCount(2);
  await menu(page).getByRole('button', { name: '기록', exact: true }).click();
  await page.getByLabel('기록할 내용').fill('오늘 스타벅스 7000원 체크카드');
  await page.getByRole('button', { name: 'AI로 내용 채우기', exact: true }).click();
  await expect(page.getByLabel('카테고리', { exact: false })).toHaveValue('교통');
  await expect(page.getByText('· 기억한 분류', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '1건 확인 후 저장', exact: true }).click();
  await expect(page.getByText('1건의 저장을 확인했어요.', { exact: true })).toBeVisible();
  panel = await openEditor(page);
  await panel.getByText('분류 변경 이력 · 최근 20건', { exact: true }).click();
  await panel.getByRole('button', { name: '교통 2건 분류 되돌리기' }).click();
  await page.getByRole('dialog', { name: '분류 변경 되돌리기' }).getByRole('button', { name: '되돌리기', exact: true }).click();
  await expect(panel.getByText('분류와 함께 기억한 설정을 변경 전으로 되돌렸어요.', { exact: true })).toBeVisible();
  const final = await qa.account.client.from('budget_transactions').select('*').in('id', originals.map(row => row.id)).order('id');
  expect(canonical(final.data)).toBe(canonical(originals));
  expect((await qa.account.client.from('budget_category_rules').select('*')).data).toEqual([]);
  expect((await qa.account.client.from('budget_transactions').select('*')).data).toHaveLength(3);
  expect((await other.client.from('budget_category_changes').select('*')).data).toEqual([]);
  await page.reload(); panel = await openEditor(page);
  await panel.getByText('분류 변경 이력 · 최근 20건', { exact: true }).click();
  await expect(panel.getByText('되돌림 완료', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('lost category response persists across reload and independent sessions reject stale bulk changes', async ({ page, browser, qa }) => {
  expect((await qa.account.client.from('budget_profiles').insert({ user_id: qa.account.id, nickname: '재시도 합성 계정' })).error).toBeNull();
  const date = today();
  const seed = await qa.account.client.from('budget_transactions').insert([expense(qa.account.id,date,'합성 A'),expense(qa.account.id,date,'합성 B')]).select('*');
  expect(seed.error).toBeNull();
  await login(page, qa.account, '/budget'); let panel = await openEditor(page);
  await panel.getByRole('checkbox', { name: `합성 A ${date} 분류 선택` }).check();
  await panel.getByLabel('변경할 분류').selectOption('카페');
  let lose = true;
  await page.route('**/rest/v1/rpc/change_budget_categories', async route => {
    if (lose) { lose = false; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); }
    else await route.continue();
  });
  await panel.getByRole('button', { name: '선택 1건 분류 변경' }).click();
  await page.getByRole('dialog', { name: '선택한 분류 변경' }).getByRole('button', { name: '분류 변경', exact: true }).click();
  await expect(panel.getByText(/변경 응답을 확인하지 못했어요/)).toBeVisible();
  // A pending request is intentionally durable; accept this test's reload warning.
  page.once('dialog', dialog => dialog.accept()); await page.reload();
  await menu(page).getByRole('button', { name: '상세 내역', exact: true }).click();
  await page.getByText('지출 분류 수정·기억·변경 이력', { exact: true }).click();
  panel = page.getByRole('region', { name: '분류 수정과 변경 이력' });
  await panel.getByRole('button', { name: '같은 변경 결과 확인' }).click();
  await expect(panel.getByText('1건의 분류 변경을 확인했어요.', { exact: true })).toBeVisible();
  expect((await qa.account.client.from('budget_category_changes').select('id')).data).toHaveLength(1);
  await panel.getByRole('checkbox', { name: `합성 A ${date} 분류 선택` }).check();
  await panel.getByRole('checkbox', { name: `합성 B ${date} 분류 선택` }).check();
  await panel.getByLabel('변경할 분류').selectOption('교통');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', timezoneId: 'Asia/Seoul', locale: 'ko-KR', serviceWorkers: 'block' });
  try {
    const traffic = new Traffic('category-B'); await traffic.install(context);
    const other = await context.newPage(); await login(other, qa.account, '/budget'); const second = await openEditor(other);
    await second.getByRole('checkbox', { name: `합성 B ${date} 분류 선택` }).check();
    await second.getByLabel('변경할 분류').selectOption('문화');
    await second.getByRole('button', { name: '선택 1건 분류 변경' }).click();
    await other.getByRole('dialog', { name: '선택한 분류 변경' }).getByRole('button', { name: '분류 변경', exact: true }).click();
    await expect(second.getByText('1건의 분류 변경을 확인했어요.', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '선택 2건 분류 변경' }).click();
    await page.getByRole('dialog', { name: '선택한 분류 변경' }).getByRole('button', { name: '분류 변경', exact: true }).click();
    await expect(panel.getByText(/기록이 다른 곳에서 변경되었거나 삭제/)).toBeVisible();
    const records = (await qa.account.client.from('budget_transactions').select('place,category').order('place')).data;
    expect(records).toEqual([{place:'합성 A',category:'카페'},{place:'합성 B',category:'문화'}]);
    expect((await qa.account.client.from('budget_category_changes').select('id')).data).toHaveLength(2);
    expect(traffic.blockedOrigins.size).toBe(0);
  } finally { await context.close(); }
});

test('monthly checks show real previous-month data, duplicate candidates and fixed differences without writes', async ({ page, qa }) => {
  const date = today(), month = date.slice(0,7);
  const prior = new Date(`${month}-01T00:00:00Z`); prior.setUTCMonth(prior.getUTCMonth()-1);
  const beforeDate = prior.toISOString().slice(0,10);
  expect((await qa.account.client.from('budget_profiles').insert({ user_id: qa.account.id, nickname: '월별 합성 계정' })).error).toBeNull();
  expect((await qa.account.client.from('budget_monthly_budgets').insert({user_id:qa.account.id,budget_month:`${month}-01`,total_amount:300000})).error).toBeNull();
  const seed = await qa.account.client.from('budget_transactions').insert([
    expense(qa.account.id,beforeDate,'합성 구독',10000,'구독'), expense(qa.account.id,date,'합성 구독',12000,'구독'),
    expense(qa.account.id,beforeDate,'합성 통신',20000,'통신비'),
    expense(qa.account.id,date,'중복 합성 식당',5000,'식비'),expense(qa.account.id,date,'중복 합성 식당',5000,'식비'),
  ]).select('*').order('id'); expect(seed.error).toBeNull();
  await login(page, qa.account, '/budget');
  await menu(page).getByRole('button', { name:'분석',exact:true }).click();
  const panel = page.getByRole('region',{name:'월별 지출 점검'});
  await expect(panel.getByText(/오늘을 포함해 하루/)).toBeVisible();
  await panel.getByText('중복 후보 · 1묶음',{exact:true}).click();
  await expect(panel.getByText(/중복 합성 식당.*같은 기록 2건/)).toBeVisible();
  await panel.getByText('고정 항목·구독 점검 · 2개',{exact:true}).click();
  await expect(panel.getByText(/각 달 1건 기준.*2,000.*증가/)).toBeVisible();
  await expect(panel.getByText(/지난달 1건을 바탕으로.*20,000/)).toBeVisible();
  expect(canonical((await qa.account.client.from('budget_transactions').select('*').order('id')).data)).toBe(canonical(seed.data));
  expect((await qa.account.client.from('budget_category_changes').select('*')).data).toEqual([]);
  await page.setViewportSize({width:320,height:800});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
