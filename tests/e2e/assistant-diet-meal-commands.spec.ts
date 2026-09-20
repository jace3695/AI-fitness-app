import { expect, login, original, synced, test, today, saveMeal, mealSaved, type State } from './fixture';
import type { Page } from '@playwright/test';
const key='ai-fitness-diet-completed-days', mealKey='ai-fitness-diet-meal-log', totalKey='ai-fitness-protein-total', riceKey='ai-fitness-dinner-carb-choice';
const openCommand=(page:Page,command='오늘 점심 단백질 32g 기록해줘')=>page.goto(`/assistant/quick?command=${encodeURIComponent(command)}`,{waitUntil:'domcontentloaded'});
const reviewFor=(page:Page)=>page.getByRole('region',{name:'식단 기록 확인'});
const receiptFor=(page:Page)=>page.getByRole('article',{name:'식단 실행 이력'});
const day=(state:State,field=key)=>(state[field] as State)[today()] as State;
const seed=()=>({...original,
  [key]:{...(original[key] as State),[today()]:{dietMemo:'CI 기존 식사',proteinTotal:72,meals:{breakfast:true,lunch:true},waterMl:300,fastingRecordStatus:'12h',lastMealTime:'19:10'}},
  [mealKey]:{...(original[mealKey] as State),[today()]:{breakfastShake:true,lunchRice:true,lunchProteinChoice:'25',lunchProteinCustom:0,afternoonShake:'none',dinnerProteinChoice:'none',dinnerProteinCustom:0,dinnerCarb:'none',afterDinnerShake:'none',lastMealTime:'19:10',customField:'keep'}},
  [totalKey]:{...(original[totalKey] as State),[today()]:72},
  'ai-fitness-lunch-protein-choice':{[today()]:{type:'half',protein:16,customProtein:0,assessment:'uncertain'}},
  'ai-fitness-water-intake':{...(original['ai-fitness-water-intake'] as State),[today()]:300},
  'ai-fitness-social-meal-mode':{[today()]:'none'},
});
async function undo(page:Page){const receipt=receiptFor(page);await receipt.getByRole('button',{name:'이 변경 되돌리기'}).click();await receipt.getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(receipt).toContainText('되돌리기 완료');}

test('meal protein confirmation cancels, recovers a lost reply, persists exact grams and undoes at 320px',async({page,qa})=>{
  expect((await qa.account.client.from('user_app_state').update({state:seed()}).eq('user_id',qa.account.id)).error).toBeNull();
  await page.setViewportSize({width:320,height:844});await login(page,qa.account);await synced(page);const before=await qa.read();
  await openCommand(page);const review=reviewFor(page);await expect(review).toContainText('점심 식품 단백질 25g');await expect(review).toContainText('점심 식품 단백질 32g');await expect(review).toContainText('하루 합계 79g');expect(await qa.read()).toEqual(before);
  await review.getByRole('button',{name:'취소',exact:true}).click();await page.reload();await expect(review).toHaveCount(0);expect(await qa.read()).toEqual(before);
  await page.goto('/assistant');const input=page.getByLabel('연이에게 보낼 명령');await expect(input).toBeEnabled();await input.fill('오늘 점심 단백질 32g 기록해줘');await input.press('Enter');await expect(review).toBeVisible();
  await page.goto('/assistant/quick');await expect(review).toBeVisible();const draft=await page.evaluate(()=>sessionStorage.getItem('yeoni:task-command-drafts:v1'));
  await page.reload();await expect(review).toBeVisible();expect(await page.evaluate(()=>sessionStorage.getItem('yeoni:task-command-drafts:v1'))).toBe(draft);
  let lose=true;await page.context().route('**/api/assistant/diet-commands',async route=>{
    if(route.request().method()==='POST'&&route.request().postDataJSON().decision==='apply'&&lose){lose=false;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');}else await route.fallback();
  });
  await review.getByRole('button',{name:'확인하고 저장'}).click();await expect(review.getByRole('alert')).toBeVisible();expect(day(await qa.read()).proteinTotal).toBe(79);
  await page.reload();await expect(review).toBeVisible();await review.getByRole('button',{name:'같은 요청으로 다시 확인'}).click();await expect(receiptFor(page)).toContainText('식단 기록 저장');
  expect((await qa.account.client.from('assistant_diet_command_history').select('id')).data).toHaveLength(1);
  expect(day(await qa.read(),mealKey)).toEqual({...day(before,mealKey),lunchProteinChoice:'custom',lunchProteinCustom:32});expect(day(await qa.read()).meals).toEqual(day(before).meals);
  await page.getByRole('link',{name:'식단 기록 보기 →',exact:true}).click();await expect(page.getByLabel('점심 식품 단백질 직접 입력')).toHaveValue('32');await expect(page.getByLabel('메모',{exact:true})).toHaveValue('CI 기존 식사');await page.reload();await expect(page.getByLabel('점심 식품 단백질 직접 입력')).toHaveValue('32');
  await page.goto('/assistant/history?area=diet');await expect(receiptFor(page)).toContainText('하루 합계 79g');await page.reload();await expect(receiptFor(page)).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await undo(page);expect(await qa.read()).toEqual(before);await page.goto('/diet');await expect(page.getByLabel('식품 단백질',{exact:true}).first()).toHaveValue('25');await synced(page);expect(await qa.read()).toEqual(before);
});

test('cooked rice grams preserve nutrients and two sequential commands undo in reverse order',async({page,qa})=>{
  expect((await qa.account.client.from('user_app_state').update({state:seed()}).eq('user_id',qa.account.id)).error).toBeNull();await login(page,qa.account);await synced(page);const before=await qa.read();
  await openCommand(page,'오늘 저녁 밥 130g 기록해줘');await expect(reviewFor(page)).toContainText('저녁 조리된 밥 130g');await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('식단 기록 저장');
  expect(day(await qa.read(),riceKey)).toMatchObject({grams:130,riceType:'기타',customRiceType:'종류 미기록'});expect(day(await qa.read()).proteinTotal).toBe(72);const riceOnly=await qa.read();
  await page.getByRole('link',{name:'식단 기록 보기 →',exact:true}).click();await expect(page.getByLabel('저녁 밥량')).toHaveValue('130');await page.reload();await expect(page.getByLabel('저녁 밥량')).toHaveValue('130');
  await openCommand(page,'오늘 저녁 단백질 27g 기록해줘');await expect(reviewFor(page)).toContainText('하루 합계 99g');await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('식단 기록 저장');
  await page.getByRole('link',{name:'식단 기록 보기 →',exact:true}).click();await expect(page.getByLabel('저녁 식품 단백질 직접 입력')).toHaveValue('27');await expect(page.getByLabel('저녁 밥량')).toHaveValue('130');
  await page.goto('/assistant/history?area=diet');const riceReceipt=receiptFor(page).filter({has:page.getByText(`${today()} · 저녁 밥량`,{exact:true})});const proteinReceipt=receiptFor(page).filter({has:page.getByText(`${today()} · 저녁 식품 단백질`,{exact:true})});
  await riceReceipt.getByRole('button',{name:'이 변경 되돌리기'}).click();await riceReceipt.getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(riceReceipt.getByRole('alert')).toContainText('새 기록을 보호');
  await proteinReceipt.getByRole('button',{name:'이 변경 되돌리기'}).click();await proteinReceipt.getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(proteinReceipt).toContainText('되돌리기 완료');expect(await qa.read()).toEqual(riceOnly);
  await page.reload();await expect(riceReceipt).toBeVisible();await riceReceipt.getByRole('button',{name:'이 변경 되돌리기'}).click();await riceReceipt.getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(riceReceipt).toContainText('되돌리기 완료');expect(await qa.read()).toEqual(before);
});

test('stale meal confirmations and later manual edits protect records and outside meals show recorded grams',async({page,qa,browser})=>{
  const initial={...seed(),'ai-fitness-social-meal-mode':{[today()]:'lunch'}};expect((await qa.account.client.from('user_app_state').update({state:initial}).eq('user_id',qa.account.id)).error).toBeNull();await login(page,qa.account);await synced(page);await openCommand(page);await expect(reviewFor(page)).toBeVisible();
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Seoul'});await qa.traffic.install(context);
  try{
    const second=await context.newPage();await login(second,qa.account);await synced(second);await openCommand(second,'오늘 저녁 밥 130g 기록해줘');await expect(reviewFor(second)).toBeVisible();
    await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('식단 기록 저장');
    await reviewFor(second).getByRole('button',{name:'확인하고 저장'}).click();await expect(reviewFor(second).getByRole('alert')).toContainText('다른 곳에서 오늘 식단 기록이 변경');await reviewFor(second).getByRole('button',{name:'확인 화면 닫기',exact:true}).click();
    await second.goto('/diet');await expect(second.getByText('식품 단백질 기록: 32g',{exact:true})).toBeVisible();await saveMeal(second,'CI 이후 직접 수정');await mealSaved(second,qa,'CI 이후 직접 수정');const beforeUndo=await qa.read();
    await receiptFor(page).getByRole('button',{name:'이 변경 되돌리기'}).click();await receiptFor(page).getByRole('button',{name:'확인하고 되돌리기'}).click();await expect(receiptFor(page).getByRole('alert')).toContainText('새 기록을 보호');expect(await qa.read()).toEqual(beforeUndo);
  }finally{await context.unrouteAll({behavior:'wait'});await context.close();}
});

test('meal input errors, owner isolation, expiry and first-record undo never invent extra meal facts',async({page,qa})=>{
  await login(page,qa.account);await synced(page);const before=await qa.read();
  for(const command of ['어제 점심 단백질 30g 기록해줘','오늘 점심 단백질 30g 추가해줘','오늘 저녁 밥 1공기 기록해줘']){await openCommand(page,command);await expect(page.getByRole('status').filter({hasText:'오늘 기록만 지원'})).toBeVisible();await expect(reviewFor(page)).toHaveCount(0);expect(await qa.read()).toEqual(before);}
  await openCommand(page);await expect(reviewFor(page)).toBeVisible();const proposal=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('yeoni:task-command-drafts:v1')!).drafts[0].proposal);
  const ownToken=(await qa.account.client.auth.getSession()).data.session!.access_token;const other=await qa.createAccount(),otherToken=(await other.client.auth.getSession()).data.session!.access_token;
  expect((await page.request.post('/api/assistant/diet-commands',{headers:{Authorization:`Bearer ${otherToken}`},data:{decision:'apply',proposal}})).status()).toBe(400);
  expect((await page.request.post('/api/assistant/diet-commands',{headers:{Authorization:`Bearer ${ownToken}`},data:{decision:'apply',proposal:{...proposal,expiresAt:'2001-01-01T00:00:00Z'}}})).status()).toBe(409);expect(await qa.read()).toEqual(before);
  await reviewFor(page).getByRole('button',{name:'확인하고 저장'}).click();await expect(receiptFor(page)).toContainText('식단 기록 저장');expect(day(await qa.read(),mealKey)).toEqual({lunchProteinChoice:'custom',lunchProteinCustom:32});expect(day(await qa.read()).lastMealTime).toBeUndefined();expect(day(await qa.read()).meals).toBeUndefined();
  const hidden=await page.request.get('/api/assistant/diet-commands',{headers:{Authorization:`Bearer ${otherToken}`}});expect((await hidden.json()).history).toEqual([]);
  expect((await page.request.post('/api/assistant/diet-commands',{headers:{Authorization:`Bearer ${otherToken}`},data:{decision:'undo',requestId:proposal.requestId}})).status()).toBe(409);
  await page.getByRole('link',{name:'식단 기록 보기 →',exact:true}).click();await expect(page.getByLabel('점심 식품 단백질 직접 입력')).toHaveValue('32');await synced(page);
  await page.goto('/assistant/history?area=diet');await expect(receiptFor(page)).toBeVisible();await undo(page);expect(await qa.read()).toEqual(before);
});
