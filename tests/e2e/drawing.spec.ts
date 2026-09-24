import { test, expect, login, synced } from './fixture';
import { RouteDrain } from './route-drain';
import { readFileSync } from 'node:fs';
import pack from '../../content/drawing/foundations-v1.json';
import { parsePack, newDocument } from '../../lib/drawing/model';

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
    // Wait for account data and React readiness before toggling native details.
    await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();
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
    // Wait for account data and React readiness before toggling native details.
    await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();
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
      await page.getByRole('combobox',{name:/^연습 시간/}).selectOption('10');
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
      await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('paper');
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

for (const authored of pack.lessons.slice(16,28)) {
  test(`drawing ${authored.id}: copy scaffolds, both examples, print, save and continuation`, async ({page,qa},testInfo) => {
    await login(page,qa.account);await synced(page);const before=await qa.read();
    await page.setViewportSize({width:390,height:844});await page.goto('/growth/drawing');
    // Wait for account data and React readiness before toggling native details.
    await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();
    await page.locator('#drawing-map summary').nth(2).click();
    await page.getByRole('button',{name:`${authored.id} · ${authored.title}`,exact:true}).click();
    const practice=page.getByRole('region',{name:'원본 보며 모작하기'});
    const lesson=page.getByRole('region',{name:'한 동작씩 보기'});
    for(const [variant,ex] of authored.examples.entries()) {
      if(variant)await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();
      await expect(practice.getByLabel('옆에 두는 원본')).toContainText(ex.name);
      await expect(practice.getByTestId('copy-provided').locator('path')).toHaveCount(authored.practice!.baseLines.length);
      await expect(practice.getByTestId('copy-anchors').locator('circle')).toHaveCount(authored.help?authored.practice!.anchors.length:0);
      await expect(page.getByRole('button',{name:'완성 외곽 겹치기',exact:true})).toHaveCount(0);
      await page.getByRole('button',{name:'원본 숨기기',exact:true}).click();
      await expect(practice.getByLabel('옆에 두는 원본')).toHaveCount(0);
      await page.getByRole('button',{name:'원본 다시 보기',exact:true}).click();
      await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();
      await expect(practice.getByTestId('copy-provided').locator('path')).toHaveCount(new Set([...authored.practice!.baseLines,...authored.practice!.easyLines]).size);
      if(authored.id==='D26')await expect(practice.getByLabel('작게 줄인 원본')).toBeVisible();
      await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();
      await page.getByRole('combobox',{name:/^연습 시간/}).selectOption('10');
      await practice.locator('details').filter({hasText:'선생님 시범 보기'}).locator('summary').click();
      for(const [i,step] of authored.steps.entries()) {
        if(i)await page.getByRole('button',{name:'다음 행동',exact:true}).click();
        await expect(lesson.getByRole('heading',{level:3}).first()).toHaveText(step.text);
      }
      const canvas=practice.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();
      const b=(await canvas.boundingBox())!;await page.mouse.move(b.x+b.width*.45,b.y+b.height*.25);await page.mouse.down();await page.mouse.move(b.x+b.width*.3,b.y+b.height*.5,{steps:5});await page.mouse.up();
      if(Number(authored.id.slice(1))>=20){await practice.getByRole('group',{name:'비교할 한 곳',exact:true}).getByRole('button').first().click();await practice.getByLabel('이곳을 고른 이유').fill('원본과 한 부분의 크기나 위치가 달라 보여요.');}
      const received=page.waitForEvent('download');await practice.getByRole('button',{name:'모작 연습장 내려받기',exact:true}).click();const file=await received;
      const svg=readFileSync((await file.path())!,'utf8');expect(svg).toContain('내가 그릴 자리');expect(svg.split('translate(430 45)')[1]).not.toContain(ex.lines.find(l=>l.id==='eyeR')!.d);
      await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();
      await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();
      await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
      const q=await qa.account.client.from('growth_drawing_attempts').select('*');expect(q.error).toBeNull();expect(q.data).toHaveLength(variant+1);
      const row=q.data!.find(a=>a.document.example.id===ex.id)!;expect(row.document.strokes).toHaveLength(1);expect(row.document.usedHelp).toBe(3);expect(row.document.lesson.practice).toEqual(authored.practice);
      if(Number(authored.id.slice(1))>=20)expect(row.document.comparison.focus).toBe(['D21','D22','D25'].includes(authored.id)?'ears':['D23','D24'].includes(authored.id)?'space':'width');
      await page.reload();await page.getByRole('button',{name:`내 그림 ${variant+1}장`,exact:true}).click();
      await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').first().getByRole('button',{name:'열고 이어 그리기',exact:true}).click();
      await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
      if(Number(authored.id.slice(1))>=20)await expect(practice.getByLabel('이곳을 고른 이유')).toHaveValue('원본과 한 부분의 크기나 위치가 달라 보여요.');
      await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('paper');await expect(practice).toContainText('원본을 종이 옆에 두고');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(!variant&&['D17','D26'].includes(authored.id))await lesson.screenshot({path:`.e2e/evidence/drawing-stage3-${authored.id}-${testInfo.project.name}.png`});
      await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('app');
    }
    expect(await qa.read()).toEqual(before);
  });
}

test('drawing D27: revise a copy of a saved drawing, restore the original reference and preserve the original',async({page,qa})=>{
  await login(page,qa.account);await synced(page);await page.goto('/growth/drawing');
  await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();
  await page.locator('#drawing-map summary').nth(2).click();
  const l=pack.lessons[19];await page.getByRole('button',{name:`D20 · ${l.title}`,exact:true}).click();
  let canvas=page.getByRole('region',{name:'원본 보며 모작하기'}).getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();let b=(await canvas.boundingBox())!;
  await page.mouse.move(b.x+b.width*.4,b.y+b.height*.2);await page.mouse.down();await page.mouse.move(b.x+b.width*.3,b.y+b.height*.6,{steps:5});await page.mouse.up();
  await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
  const original=(await qa.account.client.from('growth_drawing_attempts').select('*').single()).data!;
  await page.getByRole('button',{name:`D27 · ${pack.lessons[26].title}`,exact:true}).click();
  await page.getByRole('combobox',{name:'수정할 이전 그림',exact:true}).selectOption(original.id);await page.getByRole('button',{name:'복사본 가져오기',exact:true}).click();
  const practice=page.getByRole('region',{name:'원본 보며 모작하기'});
  await expect(practice.getByLabel('옆에 두는 원본')).toContainText(original.document.example.name);
  await expect(practice.getByTestId('copy-guide')).toHaveCount(0);
  await practice.getByRole('button',{name:'눈 높이',exact:true}).click();await practice.getByLabel('이곳을 고른 이유').fill('오른쪽 눈이 더 낮아 보여요.');
  canvas=practice.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();b=(await canvas.boundingBox())!;
  await page.mouse.click(b.x+b.width*.6,b.y+b.height*.4);
  await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();
  await expect.poll(async()=>{const q=await qa.account.client.from('growth_drawing_attempts').select('id');return q.data?.length;}).toBe(2);
  await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
  expect((await qa.account.client.from('growth_drawing_attempts').select('*').eq('id',original.id).single()).data).toEqual(original);
  await page.reload();await page.getByRole('button',{name:'내 그림 2장',exact:true}).click();
  await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').filter({hasText:'D27'}).getByRole('button',{name:'열고 이어 그리기',exact:true}).click();
  await expect(practice.getByLabel('옆에 두는 원본')).toContainText(original.document.example.name);
  await expect(practice.getByLabel('이곳을 고른 이유')).toHaveValue('오른쪽 눈이 더 낮아 보여요.');
  const saved=(await qa.account.client.from('growth_drawing_attempts').select('*').neq('id',original.id).single()).data!;
  expect(saved.document.strokes).toHaveLength(2);expect(saved.document.correctionSource.attemptId).toBe(original.id);
});

for (const authored of pack.lessons.slice(28,34)) {
  test(`drawing ${authored.id}: memory hides answers, peek, both examples, saved phase and comparison`, async ({page,qa},testInfo) => {
    await login(page,qa.account);await synced(page);const before=await qa.read();
    await page.setViewportSize({width:390,height:844});await page.goto('/growth/drawing');
    await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();
    await page.locator('#drawing-map summary').nth(3).click();
    await page.getByRole('button',{name:`${authored.id} · ${authored.title}`,exact:true}).click();
    const practice=page.getByRole('region',{name:'기억해서 다시 그리기'});
    const next=page.getByRole('button',{name:'다음 행동',exact:true});
    for(const [variant,ex] of authored.examples.entries()) {
      if(variant)await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();
      if(authored.id==='D33')await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toHaveCount(0);
      else await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toBeVisible();
      const features=practice.getByRole('group',{name:'기억할 특징 두 개',exact:true}).getByRole('button');
      await features.nth(0).click();await features.nth(1).click();
      await next.click();await next.click();
      await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toHaveCount(0);
      await expect(practice.locator('svg')).toHaveCount(0);
      await expect(page.getByRole('button',{name:'원본 다시 보기',exact:true})).toHaveCount(0);
      await practice.getByRole('button',{name:'잠깐 원본 확인',exact:true}).click();
      await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toBeVisible();
      await practice.getByRole('button',{name:'다시 가리고 이어 그리기',exact:true}).click();
      await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toHaveCount(0);
      await practice.getByLabel('기억나는 특징 · 말해도 괜찮아요',{exact:true}).fill('큰 모양과 점 눈을 기억했어요.');
      const canvas=practice.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;
      await page.mouse.move(b.x+b.width*.5,b.y+b.height*.2);await page.mouse.down();await page.mouse.move(b.x+b.width*.3,b.y+b.height*.6,{steps:5});await page.mouse.up();
      await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();
      await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
      await expect.poll(async()=>{const q=await qa.account.client.from('growth_drawing_attempts').select('*');return q.data?.some(r=>r.document.example.id===ex.id && r.document.step===2 && r.document.memory?.recalled==='큰 모양과 점 눈을 기억했어요.');}).toBe(true);
      const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!;
      const saved=rows.find(r=>r.document.example.id===ex.id)!;expect(saved.document.step).toBe(2);expect(saved.document.memory.peeking).toBe(false);expect(saved.document.memory.peeks).toBe(1);expect(saved.document.strokes).toHaveLength(1);
      await page.reload();await page.getByRole('button',{name:`내 그림 ${variant+1}장`,exact:true}).click();
      await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').first().getByRole('button',{name:'열고 이어 그리기',exact:true}).click();
      await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toHaveCount(0);
      await expect(practice).toBeVisible();
      await expect(practice.getByLabel('기억나는 특징 · 말해도 괜찮아요',{exact:true})).toHaveValue('큰 모양과 점 눈을 기억했어요.');
      await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();
      await expect(practice.getByTestId('memory-hint').locator('path')).toHaveCount(authored.memoryPractice!.hintLines.length);
      if(authored.id==='D32') {
        await practice.getByRole('button',{name:'원본 보며 모작으로 마치기',exact:true}).click();
        await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toBeVisible();
        await practice.getByRole('button',{name:'다시 기억 연습하기',exact:true}).click();
        await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toHaveCount(0);
      }
      await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('paper');
      await expect(practice).toContainText('원본을 다른 종이로 덮고');
      await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('app');
      if(!variant&&['D29','D30','D33'].includes(authored.id))await practice.screenshot({path:`.e2e/evidence/drawing-stage4-${authored.id}-recall-${testInfo.project.name}.png`});
      await next.click();await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toBeVisible();
      await practice.getByLabel('다시 보고 보완할 한 곳',{exact:true}).fill('한 부분의 위치를 다시 보고 보완했어요.');await next.click();
      const downloaded=page.waitForEvent('download');await practice.getByRole('button',{name:'관찰용 원본 내려받기',exact:true}).click();
      expect(readFileSync((await (await downloaded).path())!,'utf8')).toContain(ex.lines[0].d);
      await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();
      await expect.poll(async()=>{const q=await qa.account.client.from('growth_drawing_attempts').select('*').eq('id',saved.id).single();return q.data?.status;}).toBe('completed');
      const final=(await qa.account.client.from('growth_drawing_attempts').select('*').eq('id',saved.id).single()).data!;
      expect(final.document.memory.compared).toBe('한 부분의 위치를 다시 보고 보완했어요.');expect(final.document.memory.selected).toHaveLength(2);expect(final.document.strokes).toHaveLength(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    expect(await qa.read()).toEqual(before);
  });
}

test('drawing D33 D34: previous memory source remains untouched and reference snapshot survives deletion',async({page,qa})=>{
  await login(page,qa.account);await synced(page);const before=await qa.read();await page.goto('/growth/drawing');
  await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();
  await page.locator('#drawing-map summary').nth(3).click();
  await page.getByRole('button',{name:`D31 · ${pack.lessons[30].title}`,exact:true}).click();
  await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
  const original=(await qa.account.client.from('growth_drawing_attempts').select('*').single()).data!;
  for(const n of [33,34]) {
    await page.getByRole('button',{name:`D${n} · ${pack.lessons[n-1].title}`,exact:true}).click();
    const practice=page.getByRole('region',{name:'기억해서 다시 그리기'});
    await practice.getByLabel('이전 기억 그림',{exact:true}).selectOption(original.id);await practice.getByRole('button',{name:'이 캐릭터로 기억 연습',exact:true}).click();
    if(n===33)await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toHaveCount(0);
    else await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toContainText(original.document.example.name);
    await expect(practice.getByRole('button',{name:'위로 긴 귀',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();
    await expect.poll(async()=>{const q=await qa.account.client.from('growth_drawing_attempts').select('*');return q.data?.length;}).toBe(n===33?2:3);
    const source=(await qa.account.client.from('growth_drawing_attempts').select('*').eq('id',original.id).single()).data;
    expect(source).toEqual(original);
  }
  await qa.account.client.from('growth_drawing_attempts').delete().eq('id',original.id);
  await page.reload();await page.getByRole('button',{name:'내 그림 2장',exact:true}).click();
  await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').filter({hasText:'D33'}).getByRole('button',{name:'열고 이어 그리기',exact:true}).click();
  const practice=page.getByRole('region',{name:'기억해서 다시 그리기'});
  await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toHaveCount(0);
  await practice.getByRole('button',{name:'잠깐 원본 확인',exact:true}).click();
  await expect(practice.getByLabel('기억 연습 원본',{exact:true})).toContainText(original.document.example.name);
  expect(await qa.read()).toEqual(before);
});

for (const authored of parsePack(pack).lessons.slice(34,42)) {
  test(`drawing ${authored.id}: one change preserves baseline, choices, ink, comparison and reload`,async({page,qa},testInfo)=>{
    if(authored.id==='D42')test.setTimeout(150_000);
    await login(page,qa.account);await synced(page);const before=await qa.read();await page.setViewportSize({width:390,height:844});
    await page.goto('/growth/drawing');await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();
    await page.locator('#drawing-map summary').nth(4).click();await page.getByRole('button',{name:`${authored.id} · ${authored.title}`,exact:true}).click();
    const practice=page.getByRole('region',{name:'한 부분만 바꾸기'});const next=page.getByRole('button',{name:'다음 행동',exact:true});
    for(const [i,ex] of authored.examples.entries()) {
      if(i) {
        if(authored.id==='D42')await page.getByLabel('익숙한 캐릭터 선택',{exact:true}).selectOption(ex.id);
        else await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();
      }
      await expect(practice.getByLabel('기본과 변형 비교',{exact:true})).toContainText(ex.name);
      await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeDisabled();
      for(const choice of ex.variations!) {
        await practice.getByRole('button',{name:choice.label,exact:true}).click();
        await expect(practice.getByRole('button',{name:choice.label,exact:true})).toHaveAttribute('aria-pressed','true');
        const pair=practice.getByLabel('기본과 변형 비교',{exact:true});const original=pair.locator('svg').nth(0),changed=pair.locator('svg').nth(1);
        const beforePaths=await original.locator('g > path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));
        const afterPaths=await changed.locator('g > path').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')));
        expect(beforePaths).toEqual(ex.lines.filter(l=>!['guide','gesture'].includes(l.group)).map(l=>l.d));
        expect(afterPaths).toEqual([...ex.lines.filter(l=>!choice.remove.includes(l.id)),...choice.lines].map(l=>l.d));
      }
      const choice=ex.variations!.at(-1)!;
      await practice.getByText('한 부분 바꾸는 시범 보기',{exact:true}).click();
      for(let s=1;s<authored.steps.length;s++){await next.click();if(s===1)await expect(practice.getByTestId('variation-demo').locator('path')).toHaveCount(ex.lines.length-choice.remove.length);}
      await practice.getByLabel('바꾼 부분 확인',{exact:true}).check();await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeDisabled();
      await practice.getByLabel('유지한 부분 확인',{exact:true}).check();await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeEnabled();
      const canvas=practice.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();const box=(await canvas.boundingBox())!;
      await page.mouse.move(box.x+box.width*.5,box.y+box.height*.25);await page.mouse.down();await page.mouse.move(box.x+box.width*.35,box.y+box.height*.55,{steps:5});await page.mouse.up();
      await practice.getByLabel('내가 바꾼 한 가지',{exact:true}).fill(`${ex.id}: ${choice.changed}`);
      await page.getByRole('button',{name:'원본 숨기기',exact:true}).click();await expect(practice.getByLabel('기본과 변형 비교',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'원본 다시 보기',exact:true}).click();
      const download=page.waitForEvent('download');await practice.getByRole('button',{name:'변형 예제 내려받기',exact:true}).click();const svg=readFileSync((await (await download).path())!,'utf8');expect(svg).toContain(choice.lines[0].d);
      await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();await expect(practice.getByTestId('variation-easy')).toBeVisible();
      if(!i&&['D35','D40','D42'].includes(authored.id))await practice.screenshot({path:`.e2e/evidence/drawing-stage5-${authored.id}-${testInfo.project.name}.png`});
      await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('paper');await expect(practice).toContainText('빈자리에 나머지를 유지하며');await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('external');await expect(practice).toContainText('새 레이어');await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('app');
      await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();
      await expect.poll(async()=>{const q=await qa.account.client.from('growth_drawing_attempts').select('*');return q.data?.some(r=>r.document.example.id===ex.id&&r.status==='completed'&&r.document.variation?.keptChecked);}).toBe(true);
      await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
      const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!;expect(rows).toHaveLength(i+1);const saved=rows.find(r=>r.document.example.id===ex.id)!;
      expect(saved.document.example).toEqual(ex);expect(saved.document.strokes).toHaveLength(1);expect(saved.document.variation.choice).toBe(choice.id);expect(saved.document.short).toBe(true);
      await page.reload();await page.getByRole('button',{name:`내 그림 ${i+1}장`,exact:true}).click();await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').first().getByRole('button',{name:'열고 이어 그리기',exact:true}).click();
      await expect(practice.getByLabel('내가 바꾼 한 가지',{exact:true})).toHaveValue(`${ex.id}: ${choice.changed}`);await expect(practice.getByLabel('바꾼 부분 확인',{exact:true})).toBeChecked();await expect(practice.getByLabel('유지한 부분 확인',{exact:true})).toBeChecked();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
      if(ex.variations!.length>1){page.once('dialog',d=>d.accept());await practice.getByRole('button',{name:ex.variations![0].label,exact:true}).click();await expect(practice.getByLabel('바꾼 부분 확인',{exact:true})).not.toBeChecked();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();expect((await qa.account.client.from('growth_drawing_attempts').select('*').eq('id',saved.id).single()).data).toEqual(saved);}
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    expect(await qa.read()).toEqual(before);
  });
}

for (const authored of parsePack(pack).lessons.slice(42,52)) {
  test(`drawing ${authored.id}: analyze, assemble, hints, exact saved bodies and restored ink`,async({page,qa},testInfo)=>{
    test.setTimeout(150_000);
    await login(page,qa.account);await synced(page);const before=await qa.read();await page.setViewportSize({width:390,height:844});
    await page.goto('/growth/drawing');await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();await page.locator('#drawing-map summary').nth(5).click();await page.getByRole('button',{name:`${authored.id} · ${authored.title}`,exact:true}).click();
    const practice=page.getByRole('region',{name:'스스로 도형화 연습'}),next=page.getByRole('button',{name:'다음 행동',exact:true});
    const draw=async()=>{const canvas=practice.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;await page.mouse.move(b.x+b.width*.5,b.y+b.height*.25);await page.mouse.down();await page.mouse.move(b.x+b.width*.35,b.y+b.height*.55,{steps:5});await page.mouse.up();};
    for(const [i,ex] of authored.examples.entries()){
      if(i)await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();
      await expect(practice).toContainText(ex.name);await expect(practice.getByTestId('structure-easy')).toHaveCount(0);
      await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeDisabled();
      await draw();await practice.getByRole('button',{name:'내 분석선 잠깐 숨기기',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeDisabled();await practice.getByRole('button',{name:'내 분석선 다시 보기',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
      if(authored.structurePractice==='assemble'){
        await practice.getByRole('button',{name:'빈 공간에 다시 조립',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeDisabled();await draw();
        await practice.getByRole('button',{name:'원본 위에서 나누기',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();await practice.getByRole('button',{name:'빈 공간에 다시 조립',exact:true}).click();
      }
      await practice.getByText('덩어리 나누는 시범 보기',{exact:true}).click();await expect(practice.getByTestId('structure-demo').locator('path')).toHaveCount(0);
      for(let s=1;s<5;s++){await next.click();expect(await practice.getByTestId('structure-demo').locator('path').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-line')))).toEqual(ex.structure!.lines.filter(l=>ex.structure!.frames[s].includes(l.id)).map(l=>l.id));}
      if(ex.structure!.hidden.length){await practice.getByRole('button',{name:'가려진 선까지 밑그림 보기',exact:true}).click();await expect(practice.getByTestId('structure-full').locator('[stroke-dasharray]')).toHaveCount(ex.structure!.hidden.length);await practice.getByRole('button',{name:'가려진 선 뺀 완성 보기',exact:true}).click();await expect(practice.getByTestId('structure-full')).toHaveCount(0);}
      await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();await expect(practice.getByTestId('structure-easy')).toBeVisible();
      for(const c of ex.structure!.choices){await practice.getByRole('button',{name:c.label,exact:true}).click();await expect(practice.getByRole('button',{name:c.label,exact:true})).toHaveAttribute('aria-pressed','true');expect(await practice.getByTestId('structure-easy').locator('path').evaluateAll(ns=>ns.map(n=>n.getAttribute('d')))).toEqual(c.lines.map(l=>l.d));}
      await practice.getByLabel('고른 덩어리 확인',{exact:true}).check();await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeDisabled();await practice.getByLabel('위치와 관계 확인',{exact:true}).check();await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeEnabled();
      await practice.getByLabel('덩어리 설명',{exact:true}).fill(`${ex.id}: 큰 덩어리와 붙는 위치`);
      if(!i&&['D43','D46','D47','D48','D50','D52'].includes(authored.id))await practice.screenshot({path:`.e2e/evidence/drawing-stage6-${authored.id}-${testInfo.project.name}.png`});
      const download=page.waitForEvent('download');await practice.getByRole('button',{name:'분석할 원본 내려받기',exact:true}).click();expect(readFileSync((await(await download).path())!,'utf8')).toContain(ex.lines[0].d);
      await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('paper');await expect(practice).toContainText('종이를 두 칸');await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('external');await expect(practice).toContainText('분석 레이어');await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('app');
      await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
      const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!;expect(rows).toHaveLength(i+1);const saved=rows.find(r=>r.document.example.id===ex.id)!;
      expect(saved.document.example).toEqual(ex);expect(saved.document.strokes).toHaveLength(1);expect(saved.document.structure.identified).toBe(true);expect(saved.document.structure.compared).toBe(true);expect(saved.document.structure.analysis).toHaveLength(authored.structurePractice==='assemble'?1:0);
      await page.reload();await page.getByRole('button',{name:`내 그림 ${i+1}장`,exact:true}).click();await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').first().getByRole('button',{name:'열고 이어 그리기',exact:true}).click();
      await expect(practice.getByLabel('덩어리 설명',{exact:true})).toHaveValue(`${ex.id}: 큰 덩어리와 붙는 위치`);await expect(practice.getByLabel('고른 덩어리 확인',{exact:true})).toBeChecked();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
      if(authored.structurePractice==='assemble'){await practice.getByRole('button',{name:'원본 위에서 나누기',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();}
      await draw();await expect(practice.getByLabel('고른 덩어리 확인',{exact:true})).not.toBeChecked();expect((await qa.account.client.from('growth_drawing_attempts').select('*').eq('id',saved.id).single()).data).toEqual(saved);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    expect(await qa.read()).toEqual(before);
  });
}

test('drawing D46: reuse owned D45 analysis, preserve saved source and restore both surfaces',async({page,qa})=>{
  const before=await qa.read();const parsed=parsePack(pack),l=parsed.lessons[44],document=newDocument(l,l.examples[1],parsed.version);
  document.strokes=[{points:[[120,100,.5],[150,140,.6]],color:'#34314b',width:2,erase:false}];
  const source={id:crypto.randomUUID(),user_id:qa.account.id,revision:1,status:'completed',document};
  expect((await qa.account.client.from('growth_drawing_attempts').insert(source)).error).toBeNull();
  const original=(await qa.account.client.from('growth_drawing_attempts').select('*').eq('id',source.id).single()).data;
  await login(page,qa.account);await synced(page);await page.goto('/growth/drawing');await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();await page.locator('#drawing-map summary').nth(5).click();await page.getByRole('button',{name:/^D46 ·/}).click();
  const practice=page.getByRole('region',{name:'스스로 도형화 연습'});await practice.getByLabel('저장한 D45 분석',{exact:true}).selectOption(source.id);await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
  await practice.getByRole('button',{name:'빈 공간에 다시 조립',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeDisabled();
  const canvas=practice.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;await page.mouse.click(b.x+b.width*.4,b.y+b.height*.4);
  await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
  const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!,saved=rows.find(r=>r.id!==source.id)!;expect(saved.document.structure.analysis).toEqual(document.strokes);expect(saved.document.strokes).toHaveLength(1);expect(saved.document.structure.source.attemptId).toBe(source.id);expect(rows.find(r=>r.id===source.id)).toEqual(original);
  await page.reload();await page.getByRole('button',{name:'내 그림 2장',exact:true}).click();await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').filter({hasText:'D46'}).getByRole('button',{name:'열고 이어 그리기',exact:true}).click();await expect(practice.getByLabel('저장한 D45 분석',{exact:true})).toHaveValue(source.id);await expect(practice.getByRole('button',{name:'빈 공간에 다시 조립',exact:true})).toHaveAttribute('aria-pressed','true');await practice.getByRole('button',{name:'원본 위에서 나누기',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();expect(await qa.read()).toEqual(before);
});
