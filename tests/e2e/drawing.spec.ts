import { test, expect, login, synced } from './fixture';
import { RouteDrain } from './route-drain';

test('drawing: first dot, ink undo, lost save reply, reload, private CAS and preserved older records', async ({page,qa}) => {
  await login(page,qa.account); await synced(page); const before=await qa.read();
  await page.setViewportSize({width:390,height:844}); await page.goto('/growth');
  await page.getByRole('link',{name:/그림 연습/}).click();
  await page.getByRole('button',{name:'이어서 연습하기',exact:true}).click();
  const lesson=page.getByRole('region',{name:'한 동작씩 보기'});
  await expect(lesson).toContainText('1 / 6');
  // The actual trace overlay starts with a dot, not the completed chick.
  const canvas=page.getByLabel('내 그림 연습장',{exact:true}); await canvas.scrollIntoViewIfNeeded();
  const box=(await canvas.boundingBox())!;
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.2); await page.mouse.down();
  await page.mouse.move(box.x+box.width*.3,box.y+box.height*.6,{steps:8}); await page.mouse.up();
  await page.getByRole('button',{name:'되돌리기',exact:true}).click();
  await expect(page.getByRole('button',{name:'되돌리기',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'다시 실행',exact:true}).click();
  await page.getByRole('button',{name:'다음 행동',exact:true}).click(); await expect(lesson).toContainText('2 / 6');
  await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();
  const pattern='**/rest/v1/growth_drawing_attempts*',drain=new RouteDrain(); let writes=0;
  await page.route(pattern,route=>drain.run(async()=>{
    if(route.request().method()==='POST'){writes++;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:'{"message":"lost reply"}'});}
    else await route.fallback();
  }));
  try {
    await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();
    await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible(); expect(writes).toBe(1);
  } finally {await drain.wait();await page.unroute(pattern);}
  const result=await qa.account.client.from('growth_drawing_attempts').select('*');expect(result.error).toBeNull();expect(result.data).toHaveLength(1);
  const saved=result.data![0];expect(saved.document.strokes).toHaveLength(1);expect(saved.document.check).toBe('assisted');expect(saved.document.lesson.id).toBe('D01');
  expect(saved.document.packVersion).toBe('1.0.0-draft.2');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();await page.getByRole('button',{name:'내 그림 1장',exact:true}).click();await page.getByRole('button',{name:'열고 이어 그리기',exact:true}).click();
  await expect(page.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
  const other=await qa.createAccount();expect((await other.client.from('growth_drawing_attempts').select('*')).data).toEqual([]);
  const conflict=await qa.account.client.from('growth_drawing_attempts').update({revision:2,status:'draft'}).eq('id',saved.id).eq('revision',1).select('id');expect(conflict.data).toHaveLength(1);
  await page.getByLabel('남기고 싶은 말').fill('kept locally');await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'다른 기기에서 바뀐 기록'})).toBeVisible();
  expect((await qa.account.client.from('growth_drawing_attempts').select('document').single()).data!.document.memo).toBe('');
  expect(await qa.read()).toEqual(before);
});
