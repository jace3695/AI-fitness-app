import type { Page } from '@playwright/test';
import { canonical, expect, login, test, today, Traffic } from './fixture';

const menu = (page: Page) => page.getByRole('navigation', { name: '가계부 주요 메뉴' });
async function openEditor(page: Page) {
  await menu(page).getByRole('button', { name: '상세 내역', exact: true }).click();
  await page.getByText('지출 수정·분류 기억·변경 이력', { exact: true }).click();
  const panel = page.getByRole('region', { name: '지출 수정과 변경 이력' });
  await expect(panel.getByLabel('변경할 분류')).toBeEnabled();
  return panel;
}
const expense = (userId: string, date: string, place: string, amount = 5000, category = '기타') => ({ user_id: userId, date, place, amount, category, payment: '체크카드', transaction_type: '일반 지출', memo: '보존할 합성 메모' });

test('amount and payment filters drive exact CSV and reviewed bulk amounts; hidden selections clear and undo preserves all fields', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const date = today();
  expect((await qa.account.client.from('budget_profiles').insert({ user_id: qa.account.id, nickname: '금액 수정 합성' })).error).toBeNull();
  const seed = await qa.account.client.from('budget_transactions').insert([
    expense(qa.account.id,date,'작은 지출',3000), expense(qa.account.id,date,'수정 A',4000),
    {...expense(qa.account.id,date,'수정 B',5000,'교통'),payment:'현금'},expense(qa.account.id,date,'큰 지출',12000),
  ]).select('*').order('id'); expect(seed.error).toBeNull(); const originals=seed.data!;
  const income = await qa.account.client.from('budget_income').insert({user_id:qa.account.id,date,name:'합성 수입',amount:4500}).select('*'); expect(income.error).toBeNull();
  const saving = await qa.account.client.from('budget_savings').insert({user_id:qa.account.id,date,goal_name:'합성 저축',amount:5000}).select('*'); expect(saving.error).toBeNull();
  await login(page,qa.account,'/budget'); let panel=await openEditor(page);
  const filters=page.getByRole('region',{name:'상세 내역 필터'});
  await filters.getByLabel('최소 금액').fill('4,000'); await filters.getByLabel('최대 금액').fill('5000');
  await expect(filters.getByText('총 4건',{exact:true})).toBeVisible();
  await filters.getByLabel('지출 결제수단').selectOption('현금');
  await expect(filters.getByText('총 3건',{exact:true})).toBeVisible();
  await filters.getByLabel('지출 결제수단').selectOption('all');
  const downloadPromise=page.waitForEvent('download');
  await filters.getByRole('button',{name:'현재 결과 CSV 저장'}).click();
  const download=await downloadPromise, stream=await download.createReadStream(); expect(stream).not.toBeNull();
  const chunks: Buffer[]=[]; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const csv=Buffer.concat(chunks).toString('utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff); expect(csv.split('\r\n')).toHaveLength(5);
  for (const name of ['수정 A','수정 B','합성 수입','합성 저축']) expect(csv).toContain(name);
  expect(csv).not.toContain('작은 지출'); expect(csv).not.toContain('큰 지출'); expect(csv).not.toContain('\\r\\n');
  await filters.getByLabel('내역 유형',{exact:true}).selectOption('expense');
  await panel.getByRole('checkbox',{name:`수정 A ${date} 내역 선택`}).check();
  await filters.getByLabel('최소 금액').fill('5000');
  await expect(panel.getByRole('button',{name:'선택 0건 분류 변경'})).toBeDisabled();
  await expect(panel.getByRole('checkbox',{name:/수정 A/})).toHaveCount(0);
  await filters.getByLabel('최소 금액').fill('4000');
  await panel.getByRole('checkbox',{name:`수정 A ${date} 내역 선택`}).check();
  await panel.getByRole('checkbox',{name:`수정 B ${date} 내역 선택`}).check();
  await panel.getByLabel('수정할 항목').selectOption('amount'); await panel.getByLabel('변경할 금액').fill('6000');
  await panel.getByRole('button',{name:'선택 2건 금액 변경'}).click();
  const dialog=page.getByRole('dialog',{name:'선택한 금액 변경'});
  await expect(dialog.getByText(/4,000.*6,000/)).toBeVisible(); await expect(dialog.getByText(/5,000.*6,000/)).toBeVisible();
  await dialog.getByRole('button',{name:'취소',exact:true}).click();
  expect(canonical((await qa.account.client.from('budget_transactions').select('*').order('id')).data)).toBe(canonical(originals));
  // Commit the real mutation, then fail only the follow-up transaction read.
  let failRead=true;
  await page.route('**/rest/v1/budget_transactions?**',async route=>{
    if(failRead && route.request().method()==='GET'){failRead=false;await route.abort('failed');}else await route.continue();
  });
  await panel.getByRole('button',{name:'선택 2건 금액 변경'}).click(); await dialog.getByRole('button',{name:'금액 변경',exact:true}).click();
  await expect(panel.getByText(/내역 재조회에 실패했어요/)).toBeVisible();
  await expect(panel.getByText('2건의 금액 변경을 확인했어요.',{exact:true})).toHaveCount(0);
  await expect(panel.getByLabel('수정할 항목')).toBeDisabled();
  expect(canonical((await qa.account.client.from('budget_transactions').select('*').order('id')).data)).toBe(canonical(originals.map(row=>['수정 A','수정 B'].includes(row.place)?{...row,amount:6000}:row)));
  await panel.getByRole('button',{name:'변경 이력 다시 불러오기'}).click();
  await expect(panel.getByText('변경 이력을 다시 불러왔어요.',{exact:true})).toBeVisible();
  await expect(panel.getByLabel('수정할 항목')).toBeEnabled();
  expect((await qa.account.client.from('budget_category_changes').select('id')).data).toHaveLength(1);
  await page.reload(); panel=await openEditor(page);
  await panel.getByText('변경 이력 · 최근 20건',{exact:true}).click();
  await panel.getByRole('button',{name:'금액 2건 변경 전후 보기'}).click();
  await expect(panel.getByText(/수정 A.*4,000.*6,000/)).toBeVisible();
  await panel.getByRole('button',{name:'금액 2건 수정 되돌리기'}).click();
  await page.getByRole('dialog',{name:'지출 수정 되돌리기'}).getByRole('button',{name:'되돌리기',exact:true}).click();
  await expect(panel.getByText('선택한 항목을 변경 전으로 되돌렸어요.',{exact:true})).toBeVisible();
  expect(canonical((await qa.account.client.from('budget_transactions').select('*').order('id')).data)).toBe(canonical(originals));
  expect(canonical((await qa.account.client.from('budget_income').select('*')).data)).toBe(canonical(income.data));
  expect(canonical((await qa.account.client.from('budget_savings').select('*')).data)).toBe(canonical(saving.data));
  await filters.getByLabel('최소 금액').fill('7000'); await filters.getByLabel('최대 금액').fill('6000');
  await expect(filters.getByRole('alert')).toContainText('최소 금액이 최대 금액보다');
  await expect(filters.getByRole('button',{name:'현재 결과 CSV 저장'})).toBeDisabled();
  await expect(panel.getByRole('checkbox')).toHaveCount(1); // Only the category-memory option remains; no rows.
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('date payment place and blank memo edits each restore exact records and original nulls after reload', async ({ page, qa }) => {
  await page.setViewportSize({width:320,height:800});
  const date=today();
  expect((await qa.account.client.from('budget_profiles').insert({user_id:qa.account.id,nickname:'항목 수정 합성'})).error).toBeNull();
  const seed=await qa.account.client.from('budget_transactions').insert([
    expense(qa.account.id,date,'항목 A'),{...expense(qa.account.id,date,'항목 B'),memo:null,payment:null},
  ]).select('*').order('id'); expect(seed.error).toBeNull(); const originals=seed.data!;
  await login(page,qa.account,'/budget'); let panel=await openEditor(page);
  for (const [field,label,value] of [['date','날짜','2024-02-29'],['payment','결제수단','현금'],['place','장소','수정된 장소'],['memo','메모','']]) {
    for (const place of ['항목 A','항목 B']) await panel.getByRole('checkbox',{name:`${place} ${date} 내역 선택`}).check();
    await panel.getByLabel('수정할 항목').selectOption(field);
    if(field==='payment') await panel.getByLabel(`변경할 ${label}`).selectOption(value); else await panel.getByLabel(`변경할 ${label}`).fill(value);
    await panel.getByRole('button',{name:`선택 2건 ${label} 변경`}).click();
    await page.getByRole('dialog',{name:`선택한 ${label} 변경`}).getByRole('button',{name:`${label} 변경`,exact:true}).click();
    await expect(panel.getByText(`2건의 ${label} 변경을 확인했어요.`,{exact:true})).toBeVisible();
    expect(canonical((await qa.account.client.from('budget_transactions').select('*').order('id')).data)).toBe(canonical(originals.map(row=>({...row,[field]:value}))));
    await page.reload(); panel=await openEditor(page);
    await panel.getByText('변경 이력 · 최근 20건',{exact:true}).click();
    await panel.getByRole('button',{name:`${label} 2건 변경 전후 보기`}).click();
    if(field==='memo') await expect(panel.getByText(/미입력 → 빈 값/)).toBeVisible();
    await panel.getByRole('button',{name:`${label} 2건 수정 되돌리기`}).click();
    await page.getByRole('dialog',{name:'지출 수정 되돌리기'}).getByRole('button',{name:'되돌리기',exact:true}).click();
    await expect(panel.getByText('선택한 항목을 변경 전으로 되돌렸어요.',{exact:true})).toBeVisible();
    expect(canonical((await qa.account.client.from('budget_transactions').select('*').order('id')).data)).toBe(canonical(originals));
  }
  expect((await qa.account.client.from('budget_category_rules').select('*')).data).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('lost field response reuses one request across reload and a second browser prevents stale bulk overwrite and undo', async ({page,browser,qa})=>{
  const date=today();
  expect((await qa.account.client.from('budget_profiles').insert({user_id:qa.account.id,nickname:'항목 충돌 합성'})).error).toBeNull();
  expect((await qa.account.client.from('budget_transactions').insert([expense(qa.account.id,date,'충돌 A'),expense(qa.account.id,date,'충돌 B')])).error).toBeNull();
  await login(page,qa.account,'/budget'); let panel=await openEditor(page);
  for(const place of ['충돌 A','충돌 B']) await panel.getByRole('checkbox',{name:`${place} ${date} 내역 선택`}).check();
  await panel.getByLabel('수정할 항목').selectOption('memo'); await panel.getByLabel('변경할 메모').fill('응답 유실 합성');
  let lose=true;
  await page.route('**/rest/v1/rpc/change_budget_expense_fields',async route=>{
    if(lose){lose=false;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');}else await route.continue();
  });
  await panel.getByRole('button',{name:'선택 2건 메모 변경'}).click();
  await page.getByRole('dialog',{name:'선택한 메모 변경'}).getByRole('button',{name:'메모 변경',exact:true}).click();
  await expect(panel.getByText(/변경 응답을 확인하지 못했어요/)).toBeVisible();
  page.once('dialog',dialog=>dialog.accept()); await page.reload();
  await menu(page).getByRole('button',{name:'상세 내역',exact:true}).click(); await page.getByText('지출 수정·분류 기억·변경 이력',{exact:true}).click();
  panel=page.getByRole('region',{name:'지출 수정과 변경 이력'});
  await panel.getByRole('button',{name:'같은 변경 결과 확인'}).click();
  await expect(panel.getByText('2건의 메모 변경을 확인했어요.',{exact:true})).toBeVisible();
  expect((await qa.account.client.from('budget_category_changes').select('id')).data).toHaveLength(1);
  for(const place of ['충돌 A','충돌 B']) await panel.getByRole('checkbox',{name:`${place} ${date} 내역 선택`}).check();
  await panel.getByLabel('수정할 항목').selectOption('amount'); await panel.getByLabel('변경할 금액').fill('9999');
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3000',timezoneId:'Asia/Seoul',locale:'ko-KR',serviceWorkers:'block'});
  try{
    const traffic=new Traffic('field-B');await traffic.install(context);
    const secondPage=await context.newPage();await login(secondPage,qa.account,'/budget');const second=await openEditor(secondPage);
    await second.getByRole('checkbox',{name:`충돌 B ${date} 내역 선택`}).check();
    await second.getByLabel('수정할 항목').selectOption('payment');await second.getByLabel('변경할 결제수단').selectOption('현금');
    await second.getByRole('button',{name:'선택 1건 결제수단 변경'}).click();
    await secondPage.getByRole('dialog',{name:'선택한 결제수단 변경'}).getByRole('button',{name:'결제수단 변경',exact:true}).click();
    await expect(second.getByText('1건의 결제수단 변경을 확인했어요.',{exact:true})).toBeVisible();
    const newer=(await qa.account.client.from('budget_transactions').select('*').order('id')).data;
    await panel.getByRole('button',{name:'선택 2건 금액 변경'}).click();
    await page.getByRole('dialog',{name:'선택한 금액 변경'}).getByRole('button',{name:'금액 변경',exact:true}).click();
    await expect(panel.getByText(/기록이 다른 곳에서 변경되었거나 삭제/)).toBeVisible();
    expect(canonical((await qa.account.client.from('budget_transactions').select('*').order('id')).data)).toBe(canonical(newer));
    expect((await qa.account.client.from('budget_category_changes').select('id')).data).toHaveLength(2);
    await panel.getByRole('button',{name:'변경 이력 다시 불러오기'}).click();
    await expect(panel.getByText('변경 이력을 다시 불러왔어요.',{exact:true})).toBeVisible();
    await panel.getByText('변경 이력 · 최근 20건',{exact:true}).click();
    await panel.getByRole('button',{name:'메모 2건 수정 되돌리기'}).click();
    await page.getByRole('dialog',{name:'지출 수정 되돌리기'}).getByRole('button',{name:'되돌리기',exact:true}).click();
    await expect(panel.getByText(/이후에 바뀐 기록이 있어 되돌리지/)).toBeVisible();
    expect(canonical((await qa.account.client.from('budget_transactions').select('*').order('id')).data)).toBe(canonical(newer));
    expect(traffic.blockedOrigins.size).toBe(0);
  }finally{await context.close();}
});

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
  await panel.getByRole('checkbox', { name: `스타벅스 ${date} 내역 선택`, exact: true }).check();
  await panel.getByRole('checkbox', { name: `스타벅스 ${oldDate} 내역 선택`, exact: true }).check();
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
  await panel.getByText('변경 이력 · 최근 20건', { exact: true }).click();
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
  await panel.getByText('변경 이력 · 최근 20건', { exact: true }).click();
  await panel.getByRole('button', { name: '교통 2건 분류 되돌리기' }).click();
  await page.getByRole('dialog', { name: '분류 변경 되돌리기' }).getByRole('button', { name: '되돌리기', exact: true }).click();
  await expect(panel.getByText('분류와 함께 기억한 설정을 변경 전으로 되돌렸어요.', { exact: true })).toBeVisible();
  const final = await qa.account.client.from('budget_transactions').select('*').in('id', originals.map(row => row.id)).order('id');
  expect(canonical(final.data)).toBe(canonical(originals));
  expect((await qa.account.client.from('budget_category_rules').select('*')).data).toEqual([]);
  expect((await qa.account.client.from('budget_transactions').select('*')).data).toHaveLength(3);
  expect((await other.client.from('budget_category_changes').select('*')).data).toEqual([]);
  await page.reload(); panel = await openEditor(page);
  await panel.getByText('변경 이력 · 최근 20건', { exact: true }).click();
  await expect(panel.getByText('되돌림 완료', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('lost category response persists across reload and independent sessions reject stale bulk changes', async ({ page, browser, qa }) => {
  expect((await qa.account.client.from('budget_profiles').insert({ user_id: qa.account.id, nickname: '재시도 합성 계정' })).error).toBeNull();
  const date = today();
  const seed = await qa.account.client.from('budget_transactions').insert([expense(qa.account.id,date,'합성 A'),expense(qa.account.id,date,'합성 B')]).select('*');
  expect(seed.error).toBeNull();
  await login(page, qa.account, '/budget'); let panel = await openEditor(page);
  await panel.getByRole('checkbox', { name: `합성 A ${date} 내역 선택` }).check();
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
  await page.getByText('지출 수정·분류 기억·변경 이력', { exact: true }).click();
  panel = page.getByRole('region', { name: '지출 수정과 변경 이력' });
  await expect(panel.getByRole('button', { name: '같은 변경 결과 확인' })).toBeEnabled();
  // Hold the real post-save history response. A committed change must keep
  // inputs locked until the current records AND history have been re-read.
  let releaseHistory!: () => void;
  let historyArrived!: () => void;
  const historyWait = new Promise<void>(resolve => { releaseHistory = resolve; });
  const historyReady = new Promise<void>(resolve => { historyArrived = resolve; });
  let holdHistory = true;
  await page.route('**/rest/v1/budget_category_changes?**', async route => {
    if (!holdHistory) { await route.continue(); return; }
    holdHistory = false;
    const response = await route.fetch();
    historyArrived();
    await historyWait;
    await route.fulfill({ response });
  });
  await panel.getByRole('button', { name: '같은 변경 결과 확인' }).click();
  try {
    await historyReady;
    await expect(panel.getByRole('checkbox', { name: `합성 A ${date} 내역 선택` })).toBeDisabled();
    await expect(panel.getByText('1건의 분류 변경을 확인했어요.', { exact: true })).toHaveCount(0);
  } finally { releaseHistory(); }
  await expect(panel.getByText('1건의 분류 변경을 확인했어요.', { exact: true })).toBeVisible();
  expect((await qa.account.client.from('budget_category_changes').select('id')).data).toHaveLength(1);
  await panel.getByRole('checkbox', { name: `합성 A ${date} 내역 선택` }).check();
  await panel.getByRole('checkbox', { name: `합성 B ${date} 내역 선택` }).check();
  await panel.getByLabel('변경할 분류').selectOption('교통');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', timezoneId: 'Asia/Seoul', locale: 'ko-KR', serviceWorkers: 'block' });
  try {
    const traffic = new Traffic('category-B'); await traffic.install(context);
    const other = await context.newPage(); await login(other, qa.account, '/budget'); const second = await openEditor(other);
    await second.getByRole('checkbox', { name: `합성 B ${date} 내역 선택` }).check();
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
