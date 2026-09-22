import { test, expect, login, synced } from './fixture';
import { RouteDrain } from './route-drain';
import { readFileSync } from 'node:fs';
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
  await page.getByLabel('남기고 싶은 말',{exact:true}).fill('kept locally');await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();
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
      await page.getByLabel('남기고 싶은 말',{exact:true}).fill(memo);
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
      await expect(page.getByLabel('남기고 싶은 말',{exact:true})).toHaveValue(memo);
      await expect(page.getByLabel('그리는 곳')).toHaveValue('paper');
      await expect(lesson).toContainText(`${authored.steps.length} / ${authored.steps.length}`);
      await page.getByLabel('그리는 곳').selectOption('app');
      await expect(page.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
    }
    expect(await qa.read()).toEqual(before);
  });
}

for (const authored of pack.lessons.slice(8,16)) {
  test(`drawing ${authored.id}: construction overlay, easier guides, both variants and saved part evidence`, async ({page,qa}) => {
    await login(page,qa.account);await synced(page);const before=await qa.read();
    await page.setViewportSize({width:390,height:844});await page.goto('/growth/drawing');
    await page.locator('#drawing-map summary').nth(1).click();
    await page.getByRole('button',{name:`${authored.id} · ${authored.title}`,exact:true}).click();
    const lesson=page.getByRole('region',{name:'한 동작씩 보기'});
    const canvas=page.getByLabel('내 그림 연습장',{exact:true});
    const guide=canvas.locator('..').locator('svg[role="img"]');
    for(const [variant,ex] of authored.examples.entries()) {
      if(variant)await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();
      await expect(guide.locator('g > path')).toHaveCount(0);
      if(['D10','D13'].includes(authored.id)) {
        const received=page.waitForEvent('download');
        await page.getByRole('button',{name:'도형 밑그림 내려받기',exact:true}).click();
        const file=await received;expect(file.suggestedFilename()).toContain('-construction.svg');
        const svg=readFileSync((await file.path())!,'utf8');
        const taught=new Set(authored.steps.filter(s=>s.action==='draw').flatMap(s=>s.lines));
        for(const line of ex.lines.filter(l=>l.group==='guide'))expect(svg.includes(line.d)).toBe(taught.has(line.id));
        expect(svg).not.toContain('fill="#161616"');
      }
      await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();
      if(authored.easyLines?.length)await expect(guide.locator('g > path')).toHaveCount(authored.easyLines.length);
      await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();
      await page.getByLabel('연습 시간',{exact:true}).selectOption('10');
      // Hiding the completed reference also hides all reference overlays, but not the learner's ink.
      await page.getByRole('button',{name:'원본 숨기기',exact:true}).click();
      await expect(page.getByRole('button',{name:'완성 외곽 겹치기',exact:true})).toBeDisabled();
      for(const [i,step] of authored.steps.entries()) {
        if(i)await page.getByRole('button',{name:'다음 행동',exact:true}).click();
        await expect(lesson.getByRole('heading',{level:3}).first()).toHaveText(step.text);
      }
      await page.getByRole('button',{name:'원본 다시 보기',exact:true}).click();
      await page.getByRole('button',{name:'완성 외곽 겹치기',exact:true}).click();
      await expect(guide.getByTestId('construction-reference')).toBeVisible();
      await page.getByRole('button',{name:'원본 숨기기',exact:true}).click();
      await expect(guide.getByTestId('construction-reference')).toHaveCount(0);
      await page.getByRole('button',{name:'원본 다시 보기',exact:true}).click();
      await page.getByRole('button',{name:'완성 외곽 겹치기 끄기',exact:true}).click();
      await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;
      await page.mouse.move(b.x+b.width*.5,b.y+b.height*.2);await page.mouse.down();await page.mouse.move(b.x+b.width*.3,b.y+b.height*.4,{steps:4});await page.mouse.up();
      if(authored.id==='D16') {
        const finder=page.getByRole('region',{name:'부위 찾아보기'});
        const ref=finder.getByRole('group',{name:'부위 확인 예제'});await ref.scrollIntoViewIfNeeded();const r=(await ref.boundingBox())!;
        await page.mouse.click(r.x+r.width*.04,r.y+r.height*.96);
        await expect(finder.getByRole('status')).toContainText('실패로 기록하지 않아요');
        await page.mouse.click(r.x+r.width*.5,r.y+r.height*.375);
        await expect(finder.getByRole('button',{name:'머리 · 위치 확인',exact:true})).toBeVisible();
        await finder.getByRole('button',{name:'위치 도움 보기',exact:true}).click();
        for(const name of ['몸','왼쪽 귀가 붙는 곳']) {
          await finder.getByRole('button',{name,exact:true}).click();
          await finder.getByRole('button',{name:`${name} 표시 짚기`,exact:true}).click();
          await expect(finder.getByRole('status')).toContainText('교재의 표시 위치와 비교한 결과');
        }
        await expect(page.getByRole('button',{name:'아직 확인 전',exact:true})).toHaveAttribute('aria-pressed','true');
      }
      await page.getByLabel('남기고 싶은 말',{exact:true}).fill(`${authored.id}-${variant} shape practice`);
      await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();
      await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();
      await expect(page.getByRole('region',{name:'연이의 연습 정리'})).toContainText('그림 분석은 받지 않았어요');
      const saved=await qa.account.client.from('growth_drawing_attempts').select('*');expect(saved.error).toBeNull();
      const row=saved.data!.find(a=>a.document.example.id===ex.id)!;
      expect(row.document.strokes).toHaveLength(1);expect(row.document.example).toEqual(ex);
      if(authored.id==='D16')expect(row.document.partChecks).toEqual(['head','body','ear']);
      await page.getByLabel('그리는 곳',{exact:true}).selectOption('paper');
      await page.getByRole('button',{name:'완성 외곽 겹치기',exact:true}).click();
      await expect(lesson.getByTestId('construction-reference')).toBeVisible();
      await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();
      await expect.poll(async()=>{const q=await qa.account.client.from('growth_drawing_attempts').select('status,document').eq('id',row.id).single();return [q.data?.status,q.data?.document.tool];}).toEqual(['draft','paper']);
      await page.reload();await page.getByRole('button',{name:`내 그림 ${variant+1}장`,exact:true}).click();
      await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').first().getByRole('button',{name:'열고 이어 그리기',exact:true}).click();
      await expect(page.getByLabel('남기고 싶은 말',{exact:true})).toHaveValue(`${authored.id}-${variant} shape practice`);
      if(authored.id==='D16')await expect(page.getByRole('region',{name:'부위 찾아보기'}).getByRole('button',{name:'몸 · 위치 확인',exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    expect(await qa.read()).toEqual(before);
  });
}
