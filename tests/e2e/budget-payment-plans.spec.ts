import type { Page, Locator } from '@playwright/test';
import { canonical, expect, login, test, today, Traffic } from './fixture';

const menu = (page: Page) => page.getByRole('navigation', { name: '가계부 주요 메뉴' });
async function openPlans(page: Page) {
  await menu(page).getByRole('button', { name: '분석', exact: true }).click();
  const panel = page.getByRole('region', { name: '결제 예정일과 구독 관리' });
  await expect(panel.getByRole('button', { name: '결제 예정일 추가', exact: true })).toBeEnabled();
  return panel;
}
async function fillPlan(panel: Locator, name: string, date: string) {
  await panel.getByRole('button', { name: '결제 예정일 추가', exact: true }).click();
  await panel.getByLabel('내역의 장소 이름', { exact: true }).fill(name);
  await panel.getByLabel('월 예정 금액', { exact: true }).fill('15000');
  await panel.getByLabel('매월 결제일', { exact: true }).fill(String(Number(date.slice(8))));
  await panel.getByLabel('시작 월', { exact: true }).fill(date.slice(0, 7));
}
async function save(page: Page, panel: Locator) {
  await panel.getByRole('button', { name: '예정일 저장 전 확인', exact: true }).click();
  await page.getByRole('dialog', { name: '결제 예정일 저장' }).getByRole('button', { name: '설정 저장', exact: true }).click();
}
const saved = (panel: Locator) => panel.getByText('예정일 설정을 저장하고 다시 확인했어요.', { exact: true });

test('monthly plan preview, home reminders, reported subscription use and stop/delete preserve original expenses on small screens', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const date=today(), month=date.slice(0,7), prior=new Date(`${month}-01T00:00:00Z`); prior.setUTCMonth(prior.getUTCMonth()-1);
  const lastUsed=new Date(`${date}T00:00:00Z`); lastUsed.setUTCDate(lastUsed.getUTCDate()-35);
  expect((await qa.account.client.from('budget_profiles').insert({user_id:qa.account.id,nickname:'결제 예정 합성'})).error).toBeNull();
  expect((await qa.account.client.from('budget_monthly_budgets').insert({user_id:qa.account.id,budget_month:`${month}-01`,total_amount:300000})).error).toBeNull();
  const seed=await qa.account.client.from('budget_transactions').insert({user_id:qa.account.id,date:prior.toISOString().slice(0,10),amount:10000,place:'합성 구독 1',category:'구독',memo:'보존할 원본'}).select('*'); expect(seed.error).toBeNull();
  await login(page,qa.account,'/budget'); let panel=await openPlans(page);
  await fillPlan(panel,'합성 구독 1',date); await panel.getByRole('checkbox',{name:'구독 서비스',exact:true}).check();
  await panel.getByLabel('마지막 사용일',{exact:true}).fill(lastUsed.toISOString().slice(0,10));
  await panel.getByRole('button',{name:'예정일 저장 전 확인'}).click();
  const dialog=page.getByRole('dialog',{name:'결제 예정일 저장'});
  await expect(dialog.getByText(/변경 전: 새 설정/)).toBeVisible(); await expect(dialog.getByText(/변경 후:.*15,000.*구독/)).toBeVisible();
  await dialog.getByRole('button',{name:'취소',exact:true}).click();
  expect((await qa.account.client.from('budget_payment_plans').select('id')).data).toHaveLength(0);
  await save(page,panel); await expect(saved(panel)).toBeVisible();
  await expect(panel.getByText('오늘 예정 · 기록 미확인',{exact:true})).toBeVisible();
  await expect(panel.getByText(/마지막 사용 .*35일 경과/)).toBeVisible();
  const monthly=page.getByRole('region',{name:'월별 지출 점검'});
  await expect(monthly.getByText(/미기록 고정 항목 예상 ₩15,000/)).toBeVisible();
  await expect(monthly.getByText(/같은 이름의 지난달 추정액을 다시 더하지/)).toBeVisible();
  await page.reload(); panel=await openPlans(page);
  await expect(panel.getByText(/마지막 사용 .*35일 경과/)).toBeVisible();
  await menu(page).getByRole('button',{name:'홈',exact:true}).click();
  const home=page.getByRole('region',{name:'오늘의 결제 점검'});
  await expect(home.getByText(/합성 구독 1.*오늘 예정.*35일 경과/)).toBeVisible();
  await home.getByRole('button',{name:'결제 예정일 관리',exact:true}).click(); panel=page.getByRole('region',{name:'결제 예정일과 구독 관리'});
  await expect(panel.getByRole('button',{name:'결제 예정일 추가',exact:true})).toBeEnabled();
  await panel.getByText('저장한 예정일 · 1개',{exact:true}).click();
  await panel.getByRole('button',{name:'합성 구독 1 예정일 수정',exact:true}).click();
  await panel.getByLabel('마지막 사용일',{exact:true}).fill('');
  await save(page,panel); await expect(saved(panel)).toBeVisible();
  await expect(panel.getByText('마지막 사용일 미입력 · 사용 여부를 판단하지 않았어요.',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'합성 구독 1 예정일 수정',exact:true}).click();
  await panel.getByRole('checkbox',{name:'예정일 안내와 예상액 반영',exact:true}).uncheck();
  await save(page,panel); await expect(saved(panel)).toBeVisible();
  await expect(monthly.getByText(/미기록 고정 항목 예상 ₩0/)).toBeVisible();
  await panel.getByRole('button',{name:'합성 구독 1 예정일 삭제',exact:true}).click();
  await page.getByRole('dialog',{name:'결제 예정일 삭제'}).getByRole('button',{name:'설정 삭제',exact:true}).click();
  await expect(panel.getByText('예정일 설정을 삭제했어요. 지출 내역은 유지돼요.',{exact:true})).toBeVisible();
  expect((await qa.account.client.from('budget_payment_plans').select('id')).data).toHaveLength(0);
  expect(canonical((await qa.account.client.from('budget_transactions').select('*')).data)).toBe(canonical(seed.data));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('lost save response survives reload, failed confirmation GET stays pending, retry confirms one plan and another account sees none', async ({ page, qa }) => {
  expect((await qa.account.client.from('budget_profiles').insert({user_id:qa.account.id,nickname:'예정일 복구 합성'})).error).toBeNull();
  await login(page,qa.account,'/budget'); let panel=await openPlans(page);
  await fillPlan(panel,'응답 유실 합성',today());
  let lose=true;
  await page.route('**/rest/v1/rpc/save_budget_payment_plan',async route=>{
    if(!lose){await route.continue();return;} lose=false;
    const result=await route.fetch(); expect(result.ok()).toBe(true); await route.abort('failed');
  });
  await save(page,panel); await expect(panel.getByText(/저장 응답을 확인하지 못했어요/)).toBeVisible();
  const original=(await qa.account.client.from('budget_payment_plans').select('*')).data; expect(original).toHaveLength(1);
  await page.reload();
  const home=page.getByRole('region',{name:'오늘의 결제 점검'});
  await expect(home.getByRole('button',{name:'같은 예정일 결과 확인',exact:true})).toBeVisible();
  let failRead=true, blocked=0;
  await page.route('**/rest/v1/budget_payment_plans?**',async route=>{
    if(failRead && route.request().method()==='GET'){blocked++;await route.abort('failed');}else await route.continue();
  });
  await home.getByRole('button',{name:'같은 예정일 결과 확인',exact:true}).click();
  await expect(home.getByText(/설정을 모두 불러오지 못했어요/)).toBeVisible();
  await expect(saved(home)).toHaveCount(0); expect(blocked).toBeGreaterThan(1);
  failRead=false;
  await home.getByRole('button',{name:'같은 예정일 결과 확인',exact:true}).click(); await expect(saved(home)).toBeVisible();
  expect(canonical((await qa.account.client.from('budget_payment_plans').select('*')).data)).toBe(canonical(original));
  expect((await qa.account.client.from('budget_payment_plan_requests').select('*')).data).toHaveLength(1);
  const outsider=await qa.createAccount(); const hidden=await outsider.client.from('budget_payment_plans').select('*'); expect(hidden.error).toBeNull(); expect(hidden.data).toEqual([]);
  const hiddenReceipts=await outsider.client.from('budget_payment_plan_requests').select('*'); expect(hiddenReceipts.error).toBeNull(); expect(hiddenReceipts.data).toEqual([]);
  panel=await openPlans(page); await expect(panel.getByText('저장한 예정일 · 1개',{exact:true})).toBeVisible();
});

test('independent sessions reject stale plan updates and deletions while preserving the newer value', async ({ page, browser, qa }) => {
  expect((await qa.account.client.from('budget_profiles').insert({user_id:qa.account.id,nickname:'예정일 충돌 합성'})).error).toBeNull();
  await login(page,qa.account,'/budget'); const panel=await openPlans(page);
  await fillPlan(panel,'두 창 합성',today()); await save(page,panel); await expect(saved(panel)).toBeVisible();
  await panel.getByText('저장한 예정일 · 1개',{exact:true}).click();
  await panel.getByRole('button',{name:'두 창 합성 예정일 수정',exact:true}).click();
  await panel.getByLabel('월 예정 금액',{exact:true}).fill('17000');
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3000',timezoneId:'Asia/Seoul',locale:'ko-KR',serviceWorkers:'block'});
  try {
    const traffic=new Traffic('plan-B'); await traffic.install(context);
    const secondPage=await context.newPage(); await login(secondPage,qa.account,'/budget'); const second=await openPlans(secondPage);
    await second.getByText('저장한 예정일 · 1개',{exact:true}).click();
    await second.getByRole('button',{name:'두 창 합성 예정일 수정',exact:true}).click();
    await second.getByLabel('월 예정 금액',{exact:true}).fill('19000'); await save(secondPage,second); await expect(saved(second)).toBeVisible();
    const newer=(await qa.account.client.from('budget_payment_plans').select('*')).data;
    await save(page,panel); await expect(panel.getByText(/설정이 다른 곳에서 바뀌었거나 삭제됐어요/)).toBeVisible();
    expect(canonical((await qa.account.client.from('budget_payment_plans').select('*')).data)).toBe(canonical(newer));
    await panel.getByRole('button',{name:'두 창 합성 예정일 삭제',exact:true}).click();
    await second.getByRole('button',{name:'두 창 합성 예정일 수정',exact:true}).click();
    await second.getByLabel('월 예정 금액',{exact:true}).fill('21000'); await save(secondPage,second); await expect(saved(second)).toBeVisible();
    const latest=(await qa.account.client.from('budget_payment_plans').select('*')).data;
    await page.getByRole('dialog',{name:'결제 예정일 삭제'}).getByRole('button',{name:'설정 삭제',exact:true}).click();
    await expect(panel.getByText(/설정이 다른 곳에서 바뀌었거나 삭제됐어요/)).toBeVisible();
    expect(canonical((await qa.account.client.from('budget_payment_plans').select('*')).data)).toBe(canonical(latest));
    expect((await qa.account.client.from('budget_payment_plan_requests').select('*')).data).toHaveLength(3);
    expect(traffic.blockedOrigins.size).toBe(0);
  } finally { await context.close(); }
});
