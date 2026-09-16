import { expect, login, original, synced, test, today, saveMeal, mealSaved, type State } from './fixture';
import type { Page } from '@playwright/test';
const key='ai-fitness-diet-completed-days',mealKey='ai-fitness-diet-meal-log',dinnerKey='ai-fitness-diet-dinner-completed-time',fastingKey='ai-fitness-fasting-start-time';
const openCommand=(page:Page,command='오늘 마지막 식사 00:00 기록해줘')=>page.goto(`/assistant/quick?command=${encodeURIComponent(command)}`,{waitUntil:'domcontentloaded'});
const reviewFor=(page:Page)=>page.getByRole('region',{name:'식단 기록 확인'});
const receiptFor=(page:Page)=>page.getByRole('article',{name:'식단 실행 이력'});
const day=(state:State,field=key)=>(state[field] as State)[today()] as State;
const seed=()=>({...original,
  [key]:{...(original[key] as State),[today()]:{dietMemo:'CI 기존 식사 시각',proteinTotal:70,meals:{lunch:true},waterMl:300,fastingRecordStatus:'12h',fastingHours:12,fastingSuccess:false,lastMealTime:'19:10',dinnerBefore1830:false}},
  [mealKey]:{[today()]:{lastMealTime:'19:10',lunchProteinChoice:'30',dinnerCarb:'80',customField:'keep'}},
  [dinnerKey]:{'2001-01-01':'20:00',[today()]:'19:10'},[fastingKey]:{'2001-01-01':'20:00',[today()]:'19:10'},
  'ai-fitness-water-intake':{...(original['ai-fitness-water-intake'] as State),[today()]:300},
});
async function undo(page:Page){const receipt=receiptFor(page);await receipt.getByRole('button',{name:'이 변경 되돌리기'}).click();await receipt.getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(receipt).toContainText('되돌리기 완료');}

test('last-meal clock review cancels, recovers lost reply, persists fasting preview and undoes at 320px',async({page,qa})=>{
  expect((await qa.account.client.from('user_app_state').update({state:seed()}).eq('user_id',qa.account.id)).error).toBeNull();
  await page.setViewportSize({width:320,height:844});await login(page,qa.account);await synced(page);const before=await qa.read();
  await openCommand(page);const review=reviewFor(page);await expect(review).toContainText('마지막 식사 19:10');await expect(review).toContainText('마지막 식사 00:00');expect(await qa.read()).toEqual(before);
  await review.getByRole('button',{name:'취소',exact:true}).click();await page.reload();await expect(review).toHaveCount(0);expect(await qa.read()).toEqual(before);
  await page.goto('/assistant');const input=page.getByLabel('연이에게 보낼 명령');await expect(input).toBeEnabled();await input.fill('오늘 마지막 식사 00:00 기록해줘');await input.press('Enter');await expect(review).toBeVisible();
  await page.goto('/assistant/quick');await expect(review).toBeVisible();const draft=await page.evaluate(()=>sessionStorage.getItem('yeoni:task-command-drafts:v1'));await page.reload();await expect(review).toBeVisible();expect(await page.evaluate(()=>sessionStorage.getItem('yeoni:task-command-drafts:v1'))).toBe(draft);
  let lose=true;await page.context().route('**/api/assistant/diet-commands',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().decision==='apply'&&lose){lose=false;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');}else await route.fallback();});
  await review.getByRole('button',{name:'확인하고 저장'}).click();await expect(review.getByRole('alert')).toBeVisible();expect(day(await qa.read()).lastMealTime).toBe('00:00');
  await page.reload();await expect(review).toBeVisible();await review.getByRole('button',{name:'같은 요청으로 다시 확인'}).click();await expect(receiptFor(page)).toContainText('식단 기록 저장');expect((await qa.account.client.from('assistant_diet_command_history').select('id')).data).toHaveLength(1);
  expect(day(await qa.read())).toEqual({...day(before),lastMealTime:'00:00',dinnerBefore1830:true});expect((await qa.read())[fastingKey]).toEqual({'2001-01-01':'20:00',[today()]:'00:00'});
  await page.getByRole('link',{name:'식단 기록 보기 →',exact:true}).click();await expect(page.getByLabel('마지막 음식·프로틴 섭취시간')).toHaveValue('00:00');await expect(page.getByText('당일 12:00',{exact:true})).toBeVisible();await expect(page.getByText('당일 14:00',{exact:true})).toBeVisible();await page.reload();await expect(page.getByLabel('마지막 음식·프로틴 섭취시간')).toHaveValue('00:00');await synced(page);
  await page.goto('/assistant/history?area=diet');await expect(receiptFor(page)).toContainText('마지막 식사 00:00');await page.reload();await expect(receiptFor(page)).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await undo(page);expect(await qa.read()).toEqual(before);await page.goto('/diet');await expect(page.getByLabel('마지막 음식·프로틴 섭취시간')).toHaveValue('19:10');await synced(page);expect(await qa.read()).toEqual(before);
});

test('time and water commands share history, protect ordering and restore the original raw clock',async({page,qa})=>{
  const initial={...seed(),[fastingKey]:'19:10'};expect((await qa.account.client.from('user_app_state').update({state:initial}).eq('user_id',qa.account.id)).error).toBeNull();await login(page,qa.account);await synced(page);const before=await qa.read();
  await openCommand(page);await expect(reviewFor(page)).toBeVisible();await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('식단 기록 저장');const clockOnly=await qa.read();
  await openCommand(page,'오늘 물 총 500ml 기록해줘');await expect(reviewFor(page)).toBeVisible();await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('식단 기록 저장');await page.goto('/assistant/history?area=diet');
  const clock=receiptFor(page).filter({has:page.getByText(`${today()} · 마지막 식사 시각`,{exact:true})}),water=receiptFor(page).filter({has:page.getByText(`${today()} · 수분 총량`,{exact:true})});
  await clock.getByRole('button',{name:'이 변경 되돌리기'}).click();await clock.getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(clock.getByRole('alert')).toContainText('새 기록을 보호');
  await water.getByRole('button',{name:'이 변경 되돌리기'}).click();await water.getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(water).toContainText('되돌리기 완료');expect(await qa.read()).toEqual(clockOnly);
  await page.reload();await expect(clock).toBeVisible();await clock.getByRole('button',{name:'이 변경 되돌리기'}).click();await clock.getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(clock).toContainText('되돌리기 완료');expect(await qa.read()).toEqual(before);
});

test('stale clock confirmations and later manual meal edits cannot overwrite current records',async({page,qa,browser})=>{
  expect((await qa.account.client.from('user_app_state').update({state:seed()}).eq('user_id',qa.account.id)).error).toBeNull();await login(page,qa.account);await synced(page);await openCommand(page);await expect(reviewFor(page)).toBeVisible();
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Seoul'});await qa.traffic.install(context);
  try{const second=await context.newPage();await login(second,qa.account);await synced(second);await openCommand(second);await expect(reviewFor(second)).toBeVisible();
    await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('식단 기록 저장');await reviewFor(second).getByRole('button',{name:'확인하고 저장'}).click();await expect(reviewFor(second).getByRole('alert')).toContainText('다른 곳에서 오늘 식단 기록이 변경');await reviewFor(second).getByRole('button',{name:'확인 화면 닫기',exact:true}).click();
    await second.goto('/diet');await expect(second.getByLabel('마지막 음식·프로틴 섭취시간')).toHaveValue('00:00');await second.getByLabel('마지막 음식·프로틴 섭취시간').fill('00:01');await saveMeal(second,'CI 이후 직접 시각 수정');await mealSaved(second,qa,'CI 이후 직접 시각 수정');const modified=await qa.read();
    await receiptFor(page).getByRole('button',{name:'이 변경 되돌리기'}).click();await receiptFor(page).getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(receiptFor(page).getByRole('alert')).toContainText('새 기록을 보호');expect(await qa.read()).toEqual(modified);
  }finally{await context.unrouteAll({behavior:'wait'});await context.close();}
});

test('invalid clocks, expired requests and other owners cannot write; first-record undo removes only its clock',async({page,qa})=>{
  await login(page,qa.account);await synced(page);const before=await qa.read();
  for(const command of ['어제 마지막 식사 18:30 기록해줘','오늘 마지막 식사 지금 기록해줘','오늘 마지막 식사 24:00 기록해줘']){await openCommand(page,command);await expect(page.getByRole('status').filter({hasText:/오늘 기록만 지원|24시간제/})).toBeVisible();await expect(reviewFor(page)).toHaveCount(0);expect(await qa.read()).toEqual(before);}
  await openCommand(page);await expect(reviewFor(page)).toBeVisible();const proposal=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('yeoni:task-command-drafts:v1')!).drafts[0].proposal);
  const ownToken=(await qa.account.client.auth.getSession()).data.session!.access_token,other=await qa.createAccount(),otherToken=(await other.client.auth.getSession()).data.session!.access_token;
  expect((await page.request.post('/api/assistant/diet-commands',{headers:{Authorization:`Bearer ${otherToken}`},data:{decision:'apply',proposal}})).status()).toBe(400);
  expect((await page.request.post('/api/assistant/diet-commands',{headers:{Authorization:`Bearer ${ownToken}`},data:{decision:'apply',proposal:{...proposal,expiresAt:'2001-01-01T00:00:00Z'}}})).status()).toBe(409);expect(await qa.read()).toEqual(before);
  await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('식단 기록 저장');expect(day(await qa.read(),mealKey)).toEqual({lastMealTime:'00:00'});expect(day(await qa.read())).toEqual({lastMealTime:'00:00',dinnerBefore1830:true});
  const hidden=await page.request.get('/api/assistant/diet-commands',{headers:{Authorization:`Bearer ${otherToken}`}});expect((await hidden.json()).history).toEqual([]);expect((await page.request.post('/api/assistant/diet-commands',{headers:{Authorization:`Bearer ${otherToken}`},data:{decision:'undo',requestId:proposal.requestId}})).status()).toBe(409);
  await page.getByRole('link',{name:'식단 기록 보기 →',exact:true}).click();await expect(page.getByLabel('마지막 음식·프로틴 섭취시간')).toHaveValue('00:00');await synced(page);await page.goto('/assistant/history?area=diet');await expect(receiptFor(page)).toBeVisible();await undo(page);expect(await qa.read()).toEqual(before);
});
