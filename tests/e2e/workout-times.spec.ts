import {randomUUID} from 'node:crypto';
import {expect,login,synced,test} from './fixture';
import {RouteDrain} from './route-drain';
const day='2020-01-02';
const panelName='실제 운동 시각';

test('actual workout times review, save, revise, compare and delete preserve all app records at 320px',async({page,qa})=>{
 await page.setViewportSize({width:320,height:844});
 const before=await qa.read();const state={...before,'ai-fitness-diet-completed-days':{...(before['ai-fitness-diet-completed-days'] as Record<string,unknown>),[day]:{lastMealTime:'18:30'}}};
 expect((await qa.account.client.from('user_app_state').update({state}).eq('user_id',qa.account.id)).error).toBeNull();
 await login(page,qa.account);await synced(page);await page.goto('/diet',{waitUntil:'domcontentloaded'});
 const panel=page.getByRole('region',{name:panelName,exact:true});const review=panel.getByRole('region',{name:'운동 시각 확인'});
 await expect(panel.getByLabel('운동 시각 날짜')).toBeEnabled();await panel.getByLabel('운동 시각 날짜').fill(day);await expect(panel.getByLabel('운동 시작 시각')).toBeEnabled();
 await panel.getByLabel('운동 시작 시각').fill('20:00');await panel.getByLabel('운동 종료 시각').fill('20:40');await panel.getByRole('button',{name:'시각 저장 검토',exact:true}).click();await expect(review).toContainText('20:00 ~ 20:40');
 expect((await qa.account.client.from('workout_actual_times').select('*')).data).toEqual([]);
 await review.getByRole('button',{name:'시각 검토 취소'}).click();await panel.getByRole('button',{name:'시각 저장 검토',exact:true}).click();await review.getByRole('button',{name:'확인 후 시각 반영'}).click();await expect(panel).toContainText('마지막 식사 90분 후 운동 시작');
 expect(await qa.read()).toEqual(state);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.reload({waitUntil:'domcontentloaded'});await synced(page);await expect(panel.getByLabel('운동 시각 날짜')).toBeEnabled();await panel.getByLabel('운동 시각 날짜').fill(day);await expect(panel.getByLabel('운동 종료 시각')).toHaveValue('20:40');
 await panel.getByLabel('운동 종료 시각').fill('20:50');await panel.getByRole('button',{name:'시각 저장 검토',exact:true}).click();await expect(review).toContainText('기존 20:00 ~ 20:40 → 20:00 ~ 20:50');await review.getByRole('button',{name:'확인 후 시각 반영'}).click();await expect(panel).toContainText('50분 (휴식 포함 경과 시간)');
 await panel.getByRole('button',{name:'시각 삭제 검토'}).click();await review.getByRole('button',{name:'시각 검토 취소'}).click();expect((await qa.account.client.from('workout_actual_times').select('*')).data).toHaveLength(1);
 await panel.getByRole('button',{name:'시각 삭제 검토'}).click();await review.getByRole('button',{name:'확인 후 시각 반영'}).click();await expect(panel).toContainText('저장된 운동 시각이 없습니다.');expect((await qa.account.client.from('workout_actual_times').select('*')).data).toEqual([]);expect(await qa.read()).toEqual(state);
});

test('actual workout times protect later changes and reject invalid intervals without touching app state',async({page,qa})=>{
 const before=await qa.read();const row={user_id:qa.account.id,recorded_on:day,starts_at:'20:00',ends_at:'20:40',revision:randomUUID()};expect((await qa.account.client.from('workout_actual_times').insert(row)).error).toBeNull();
 const other=await qa.createAccount();expect((await other.client.from('workout_actual_times').select('*')).data).toEqual([]);expect((await other.client.from('workout_actual_times').insert({...row,recorded_on:'2020-01-03'})).error).not.toBeNull();
 await login(page,qa.account);await synced(page);await page.goto('/diet',{waitUntil:'domcontentloaded'});const panel=page.getByRole('region',{name:panelName,exact:true});await expect(panel.getByLabel('운동 시각 날짜')).toBeEnabled();await panel.getByLabel('운동 시각 날짜').fill(day);await expect(panel.getByLabel('운동 종료 시각')).toHaveValue('20:40');
 await panel.getByLabel('운동 종료 시각').fill('19:00');await panel.getByRole('button',{name:'시각 저장 검토',exact:true}).click();await expect(panel.getByRole('status')).toContainText('종료는 시작보다 늦어야');
 await panel.getByLabel('운동 종료 시각').fill('20:45');await panel.getByRole('button',{name:'시각 저장 검토',exact:true}).click();const newer={...row,ends_at:'21:00',revision:randomUUID()};expect((await qa.account.client.from('workout_actual_times').update({ends_at:newer.ends_at,revision:newer.revision}).eq('recorded_on',day)).error).toBeNull();
 await panel.getByRole('button',{name:'확인 후 시각 반영'}).click();await expect(panel.getByRole('status')).toContainText('기록이 바뀌었거나');await expect(panel.getByLabel('운동 종료 시각')).toHaveValue('21:00');expect((await qa.account.client.from('workout_actual_times').select('*').single()).data).toEqual(newer);expect(await qa.read()).toEqual(before);
});

test('lost workout time response uses read-only recovery and load errors stay distinct from no record',async({page,qa})=>{
 await login(page,qa.account);await synced(page);await page.goto('/diet',{waitUntil:'domcontentloaded'});const before=await qa.read();const panel=page.getByRole('region',{name:panelName,exact:true});await expect(panel.getByLabel('운동 시각 날짜')).toBeEnabled();await panel.getByLabel('운동 시각 날짜').fill(day);await expect(panel.getByLabel('운동 시작 시각')).toBeEnabled();
 const pattern='**/rest/v1/workout_actual_times*';const drain=new RouteDrain();let writes=0,failReads=true;
 await page.route(pattern,route=>drain.run(async()=>{if(route.request().method()==='POST'){writes++;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:'{"message":"lost"}'});}else if(failReads){await route.fulfill({status:503,contentType:'application/json',body:'{"message":"unavailable"}'});}else await route.fallback();}));
 try{await panel.getByLabel('운동 시작 시각').fill('20:00');await panel.getByLabel('운동 종료 시각').fill('20:40');await panel.getByRole('button',{name:'시각 저장 검토',exact:true}).click();await panel.getByRole('button',{name:'확인 후 시각 반영'}).click();await expect(panel.getByRole('button',{name:'운동 시각 서버 결과 재확인'})).toBeVisible();failReads=false;await panel.getByRole('button',{name:'운동 시각 서버 결과 재확인'}).click();await expect(panel).toContainText('저장된 구간 20:00 ~ 20:40');expect(writes).toBe(1);
 failReads=true;await panel.getByRole('button',{name:'입력 취소·다시 불러오기'}).click();await expect(panel.getByRole('alert')).toContainText('불러오지 못했어요');await expect(panel).not.toContainText('저장된 운동 시각이 없습니다.');failReads=false;await panel.getByRole('button',{name:'입력 취소·다시 불러오기'}).click();await expect(panel).toContainText('저장된 구간 20:00 ~ 20:40');
 }finally{await drain.wait();await page.unroute(pattern);}
 expect(await qa.read()).toEqual(before);expect((await qa.account.client.from('workout_actual_times').select('*')).data).toHaveLength(1);await synced(page);
});
