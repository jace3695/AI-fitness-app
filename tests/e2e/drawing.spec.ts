import { test, expect, login, synced } from './fixture';
import { RouteDrain } from './route-drain';
import pack from '../../content/drawing/foundations-v1.json';

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
  expect(saved.document.packVersion).toBe(pack.version);
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

for (const authored of pack.lessons.slice(1,8)) {
  test(`drawing ${authored.id}: both examples, every action, paper reference and saved continuation`, async ({page,qa}) => {
    await login(page,qa.account); await synced(page); const before=await qa.read();
    await page.setViewportSize({width:390,height:844}); await page.goto('/growth/drawing');
    await page.locator('#drawing-map summary').first().click();
    await page.getByRole('button',{name:`${authored.id} · ${authored.title}`,exact:true}).click();
    const task=page.getByRole('region',{name:'현재 과제'}), lesson=page.getByRole('region',{name:'한 동작씩 보기'});
    const guide=lesson.locator('svg[role="img"]').last();
    for (const [variant,example] of authored.examples.entries()) {
      if(variant) await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();
      await expect(task).toContainText(authored.title);
      await expect(lesson).toContainText(example.name);
      // First look frame must have dots and no character outlines. The marker definition is not an outline.
      await expect(guide.locator('g > path')).toHaveCount(0);
      for (const [i,step] of authored.steps.entries()) {
        if(i) await page.getByRole('button',{name:'다음 행동',exact:true}).click();
        await expect(lesson.getByRole('heading',{level:3})).toHaveText(step.text);
        if(authored.id==='D06' && i===3) {
          await expect(guide.locator('g > path')).toHaveCount(2);
          await expect(guide.locator('circle')).toHaveCount(1);
        }
      }
      await expect(page.getByRole('button',{name:'다음 행동',exact:true})).toBeDisabled();
      await page.getByRole('button',{name:'원본 숨기기',exact:true}).click();
      await expect(lesson.locator('details')).toHaveCount(0);
      await page.getByRole('button',{name:'밑그림 숨기기',exact:true}).click();
      await expect(lesson.locator('svg[role="img"]')).toHaveCount(0);
      const canvas=page.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();
      const box=(await canvas.boundingBox())!;
      await page.mouse.move(box.x+box.width*.75,box.y+box.height*.4);await page.mouse.down();
      await page.mouse.move(box.x+box.width*.6,box.y+box.height*.6,{steps:3});await page.mouse.up();
      const memo=`${authored.id} ${variant}: 오른쪽에서 시작, 아래쪽 긴 선은 나누어 그리기`;
      await page.getByLabel('남기고 싶은 말').fill(memo);
      await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();
      await expect(task).toContainText(authored.easier);
      await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();
      await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();
      await expect(page.getByRole('region',{name:'연이의 연습 정리'})).toContainText('그림 분석은 받지 않았어요');
      const saved=await qa.account.client.from('growth_drawing_attempts').select('*').order('created_at');
      expect(saved.error).toBeNull();expect(saved.data).toHaveLength(variant+1);
      const current=saved.data!.find(a=>a.document.example.id===example.id)!;
      expect(current.document.memo).toBe(memo);expect(current.document.short).toBe(true);
      expect(current.document.strokes).toHaveLength(1);expect(current.document.lesson.steps).toEqual(authored.steps);
      // Paper mode uses the same lesson diagrams and can hide its separate completed reference.
      await page.getByLabel('그리는 곳').selectOption('paper');
      await page.getByRole('button',{name:'원본 다시 보기',exact:true}).click();
      await expect(lesson.locator('details')).toBeVisible();
      await expect(lesson.getByRole('button',{name:'예제 내려받기',exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();
      await expect.poll(async()=>{ const row=await qa.account.client.from('growth_drawing_attempts').select('status,document').eq('id',current.id).single(); return [row.data?.status,row.data?.document.tool]; }).toEqual(['draft','paper']);
      await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
      await page.reload();
      await page.getByRole('button',{name:`내 그림 ${variant+1}장`,exact:true}).click();
      const card=page.getByRole('region',{name:'내 그림 앨범'}).locator('article').filter({hasText:authored.title}).first();
      // Records are ordered by updated_at descending; newest variant is first.
      await card.getByRole('button',{name:'열고 이어 그리기',exact:true}).click();
      await expect(page.getByLabel('남기고 싶은 말')).toHaveValue(memo);
      await expect(page.getByLabel('그리는 곳')).toHaveValue('paper');
      await expect(lesson).toContainText(`${authored.steps.length} / ${authored.steps.length}`);
      await page.getByLabel('그리는 곳').selectOption('app');
      await expect(page.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
    }
    expect(await qa.read()).toEqual(before);
  });
}
