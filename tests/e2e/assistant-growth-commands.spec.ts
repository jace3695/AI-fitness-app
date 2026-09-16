import { randomUUID } from 'node:crypto';
import { expect, login, synced, test, today } from './fixture';
import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
const openCommand = (page: Page, command = '오늘 타자 연습 완료했어') => page.goto(`/assistant/quick?command=${encodeURIComponent(command)}`);
const reviewFor = (page: Page) => page.getByRole('region', { name: '자기계발 완료 확인' });
const receiptFor = (page: Page) => page.getByRole('article', { name: '자기계발 실행 이력' });
async function seed(client: SupabaseClient, owner: string) {
  const typing = randomUUID(), handwriting = randomUUID();
  expect((await client.from('growth_routines').insert([
    { id: typing,user_id:owner,title:'정확도 중심 타자 연습',category:'typing',target_minutes:10 },
    { id: handwriting,user_id:owner,title:'손글씨 교정 연습',category:'handwriting',target_minutes:15 },
  ])).error).toBeNull();
  expect((await client.from('growth_sessions').insert({user_id:owner,routine_id:typing,session_date:'2001-01-01',status:'partial',actual_minutes:3,memo:'CI original',metrics:{accuracy:77}})).error).toBeNull();
  return {typing,handwriting};
}
async function sessions(client: SupabaseClient) {
  const result=await client.from('growth_sessions').select('*').order('id');expect(result.error).toBeNull();return result.data!;
}

test('growth confirmation cancels, recovers lost responses, displays unknown time and restores original sessions at 320px',async({page,qa})=>{
  await seed(qa.account.client,qa.account.id); await page.setViewportSize({width:320,height:844});await login(page,qa.account);await synced(page);
  const before=await sessions(qa.account.client); const state=await qa.read();
  await openCommand(page);const review=reviewFor(page);await expect(review).toBeVisible();await expect(review).toContainText('시간 미기록');await expect(review).toContainText('정확도 중심 타자 연습');
  expect(await sessions(qa.account.client)).toEqual(before);expect((await qa.account.client.from('assistant_growth_command_history').select('id')).data).toEqual([]);
  await review.getByRole('button',{name:'취소',exact:true}).click();await expect(page.getByText('취소했습니다. 자기계발 기록은 변경하지 않았습니다.')).toBeVisible();
  await page.reload();await expect(review).toHaveCount(0);expect(await sessions(qa.account.client)).toEqual(before);
  await page.goto('/assistant');const input=page.getByLabel('연이에게 보낼 명령');await expect(input).toBeEnabled();await input.fill('오늘 타자 연습 완료했어');await input.press('Enter');await expect(review).toBeVisible();
  await page.goto('/assistant/quick');await expect(review).toBeVisible();const draft=await page.evaluate(()=>sessionStorage.getItem('yeoni:task-command-drafts:v1'));
  await page.reload();await expect(review).toBeVisible();expect(await page.evaluate(()=>sessionStorage.getItem('yeoni:task-command-drafts:v1'))).toBe(draft);
  // Keep fault injection in the fixture's context routing chain. A separate
  // page interceptor can be removed while a forwarded DB response is in flight.
  let lose=true;await page.context().route('**/api/assistant/growth-commands',async route=>{
    if(route.request().method()==='POST'&&route.request().postDataJSON().decision==='apply'&&lose){lose=false;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');}else await route.fallback();
  });
  await review.getByRole('button',{name:'확인하고 저장'}).click();await expect(review.getByRole('alert')).toBeVisible();
  const committed=(await sessions(qa.account.client)).find(row=>row.session_date===today())!;
  expect(committed).toMatchObject({status:'completed',actual_minutes:0,planned_minutes:10,metrics:{actualMinutesRecorded:false},memo:'',started_at:null,ended_at:null});
  await page.reload();await expect(review).toBeVisible();await review.getByRole('button',{name:'같은 요청으로 다시 확인'}).click();await expect(receiptFor(page)).toContainText('자기계발 완료 저장');
  expect((await qa.account.client.from('assistant_growth_command_history').select('id')).data).toHaveLength(1);
  await page.getByRole('link',{name:'자기계발 기록 보기 →',exact:true}).click();await expect(page).toHaveURL(/\/growth$/);await expect(page.getByText(`${today()} · 시간 미기록`,{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText(`${today()} · 시간 미기록`,{exact:true})).toBeVisible();
  await page.goto('/calendar');const day=page.getByRole('button',{name:`${today()} 기록 상세 보기`,exact:true});await expect(day).toContainText('성1');await day.click();await expect(page.getByRole('dialog')).toContainText('정확도 중심 타자 연습 · 시간 미기록 · 완료');
  await page.getByRole('button',{name:'기록 상세 닫기',exact:true}).click();
  await page.goto('/assistant/history?area=growth');const receipt=receiptFor(page);await expect(receipt).toContainText('시간 미기록');await page.reload();await expect(receipt).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await receipt.getByRole('button',{name:'이 변경 되돌리기'}).click();expect((await sessions(qa.account.client)).length).toBe(2);
  await receipt.getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(receipt).toContainText('되돌리기 완료');expect(await sessions(qa.account.client)).toEqual(before);
  await page.reload();await expect(receipt).toContainText('되돌리기 완료');await page.goto('/growth');await expect(page.getByRole('heading',{name:'최근 기록',exact:true})).toBeVisible();
  await synced(page);
  await expect(page.getByText(`${today()} · 시간 미기록`,{exact:true})).toHaveCount(0);expect(await sessions(qa.account.client)).toEqual(before);
  const after=await qa.read();for(const key of Object.keys(state)) expect(after[key]).toEqual(state[key]);
});

test('two growth sessions reject stale confirmation and later manual records block undo',async({page,qa,browser})=>{
  const ids=await seed(qa.account.client,qa.account.id);await login(page,qa.account);await synced(page);await openCommand(page,'오늘 타자 7분 완료했어');await expect(reviewFor(page)).toContainText('완료 · 7분');
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Seoul'});await qa.traffic.install(context);
  try {
    const second=await context.newPage();await login(second,qa.account);await synced(second);await openCommand(second,'오늘 타자 7분 완료했어');await expect(reviewFor(second)).toBeVisible();
    await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('완료 · 7분');
    await reviewFor(second).getByRole('button',{name:'확인하고 저장'}).click();await expect(reviewFor(second).getByRole('alert')).toContainText('기록이 이미 있습니다');
    expect((await sessions(qa.account.client)).find(row=>row.session_date===today())).toMatchObject({actual_minutes:7,planned_minutes:10,metrics:{actualMinutesRecorded:true}});
    await reviewFor(second).getByRole('button',{name:'확인 화면 닫기',exact:true}).click();await second.goto('/growth');
    await second.getByRole('button',{name:'지난 기록 추가',exact:true}).click();const form=second.locator('section').filter({has:second.getByRole('heading',{name:'날짜를 골라 기록하기',exact:true})});
    await form.getByRole('combobox').first().selectOption(ids.typing);await form.getByLabel('실행 상태',{exact:true}).selectOption('partial');await form.getByLabel('실행 시간',{exact:true}).fill('3');await form.getByPlaceholder('메모(선택)').fill('CI later manual');await form.getByRole('button',{name:'기록 저장',exact:true}).click();
    await expect.poll(async()=> (await sessions(qa.account.client)).filter(row=>row.session_date===today()).length).toBe(2);
    const beforeUndo=await sessions(qa.account.client);await receiptFor(page).getByRole('button',{name:'이 변경 되돌리기'}).click();await receiptFor(page).getByRole('button',{name:'확인하고 되돌리기'}).click();
    await expect(receiptFor(page).getByRole('alert')).toContainText('이후에 자기계발 기록');expect(await sessions(qa.account.client)).toEqual(beforeUndo);
    await openCommand(second);await expect(second.getByRole('status').filter({hasText:'기록이 이미 있습니다'})).toBeVisible();await expect(reviewFor(second)).toHaveCount(0);
  }finally{await context.unrouteAll({behavior:'wait'});await context.close();}
});

test('growth routine resolution is exact and ambiguous, negative, past and future requests never change records',async({page,qa})=>{
  await seed(qa.account.client,qa.account.id);expect((await qa.account.client.from('growth_routines').insert({user_id:qa.account.id,title:'속도 중심 타자 연습',category:'typing',target_minutes:20})).error).toBeNull();
  await login(page,qa.account);await synced(page);const before=await sessions(qa.account.client);
  for(const command of ['오늘 타자 완료했어','어제 손글씨 완료했어','내일 개발 완료했어','오늘 손글씨 완료 안했어','오늘 손글씨 완료했어?','오늘 손글씨 일부 완료','오늘 자기계발 없는루틴 완료했어']) {
    await openCommand(page,command);await expect(page.getByRole('status').filter({hasText:/여러 개|오늘 기록만|루틴 하나|찾지 못/})).toBeVisible();await expect(reviewFor(page)).toHaveCount(0);expect(await sessions(qa.account.client)).toEqual(before);
  }
  await openCommand(page,'오늘 정확도 중심 타자 연습 12분 완료했어');await expect(reviewFor(page)).toContainText('정확도 중심 타자 연습');await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('완료 · 12분');
  await receiptFor(page).getByRole('button',{name:'이 변경 되돌리기'}).click();await receiptFor(page).getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(receiptFor(page)).toContainText('되돌리기 완료');expect(await sessions(qa.account.client)).toEqual(before);
});

test('growth owner isolation, expiry and history error recovery are visible without losing records',async({page,qa})=>{
  await seed(qa.account.client,qa.account.id);await login(page,qa.account);await synced(page);const before=await sessions(qa.account.client);await openCommand(page);await expect(reviewFor(page)).toBeVisible();
  const proposal=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('yeoni:task-command-drafts:v1')!).drafts[0].proposal);
  const ownToken=(await qa.account.client.auth.getSession()).data.session!.access_token;const other=await qa.createAccount(),otherToken=(await other.client.auth.getSession()).data.session!.access_token;
  expect((await page.request.post('/api/assistant/growth-commands',{headers:{Authorization:`Bearer ${otherToken}`},data:{decision:'apply',proposal}})).status()).toBe(400);
  expect((await page.request.post('/api/assistant/growth-commands',{headers:{Authorization:`Bearer ${ownToken}`},data:{decision:'apply',proposal:{...proposal,expiresAt:'2001-01-01T00:00:00Z'}}})).status()).toBe(409);
  expect(await sessions(qa.account.client)).toEqual(before);await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('자기계발 완료 저장');
  const hidden=await page.request.get('/api/assistant/growth-commands',{headers:{Authorization:`Bearer ${otherToken}`}});expect(hidden.status()).toBe(200);expect((await hidden.json()).history).toEqual([]);expect(hidden.headers()['cache-control']).toBe('no-store');
  expect((await page.request.post('/api/assistant/growth-commands',{headers:{Authorization:`Bearer ${otherToken}`},data:{decision:'undo',requestId:proposal.requestId}})).status()).toBe(409);
  expect((await page.request.get('/api/assistant/growth-commands')).status()).toBe(401);
  await page.context().route('**/api/assistant/growth-commands?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'자기계발 실행 이력을 불러오지 못했습니다. 다시 시도해 주세요.'})}));
  await page.goto('/assistant/history?area=growth');await expect(page.getByRole('region',{name:'자기계발 실행 이력 목록'}).getByRole('alert')).toContainText('이력을 불러오지 못했습니다');await expect(page.getByText('아직 확인하고 저장한 자기계발 명령이 없습니다.')).toHaveCount(0);
  await page.context().unroute('**/api/assistant/growth-commands?*');await page.getByRole('button',{name:'이력 새로고침'}).click();await expect(receiptFor(page)).toBeVisible();
});
