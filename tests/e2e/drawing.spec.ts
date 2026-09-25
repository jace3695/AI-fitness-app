import { test, expect, login, synced } from './fixture';
import { RouteDrain } from './route-drain';
import { readFileSync } from 'node:fs';
import pack from '../../content/drawing/foundations-v1.json';
import { parsePack } from '../../lib/drawing/model';

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
  await login(page,qa.account);await synced(page);const before=await qa.read();await page.goto('/growth/drawing');await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();await page.locator('#drawing-map summary').nth(5).click();await page.getByRole('button',{name:/^D45 ·/}).click();await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();
  await expect(page.getByRole('region',{name:'스스로 도형화 연습'})).toContainText(parsePack(pack).lessons[44].examples[1].name);
  const sourceCanvas=page.getByRole('region',{name:'스스로 도형화 연습'}).getByLabel('내 그림 연습장',{exact:true});await sourceCanvas.scrollIntoViewIfNeeded();const sourceBox=(await sourceCanvas.boundingBox())!;await page.mouse.click(sourceBox.x+sourceBox.width*.4,sourceBox.y+sourceBox.height*.3);await expect(page.getByRole('region',{name:'스스로 도형화 연습'}).getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
  const source=(await qa.account.client.from('growth_drawing_attempts').select('*').single()).data!;const original=structuredClone(source),document=source.document;
  await page.getByRole('button',{name:/^D46 ·/}).click();await expect(page.getByRole('region',{name:'현재 과제'})).toContainText('큰 도형을 옆에 다시 조립하기');
  const practice=page.getByRole('region',{name:'스스로 도형화 연습'});await practice.getByLabel('저장한 D45 분석',{exact:true}).selectOption(source.id);await expect(practice.getByLabel('저장한 D45 분석',{exact:true})).toHaveValue(source.id);await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
  await practice.getByRole('button',{name:'빈 공간에 다시 조립',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeDisabled();
  await expect(practice.getByRole('button',{name:'빈 공간에 다시 조립',exact:true})).toHaveAttribute('aria-pressed','true');
  const canvas=practice.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;await page.mouse.click(b.x+b.width*.4,b.y+b.height*.4);await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
  await expect.poll(async()=>{const q=await qa.account.client.from('growth_drawing_attempts').select('*');return q.data?.some(r=>r.id!==source.id&&r.document.lesson.id==='D46'&&r.document.strokes.length===1&&r.document.structure?.source?.attemptId===source.id);}).toBe(true);
  const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!,saved=rows.find(r=>r.id!==source.id)!;expect(saved.document.structure.analysis).toEqual(document.strokes);expect(saved.document.strokes).toHaveLength(1);expect(saved.document.structure.source.attemptId).toBe(source.id);expect(rows.find(r=>r.id===source.id)).toEqual(original);
  await page.reload();await page.getByRole('button',{name:'내 그림 2장',exact:true}).click();await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').filter({hasText:'D46'}).getByRole('button',{name:'열고 이어 그리기',exact:true}).click();await expect(practice.getByLabel('저장한 D45 분석',{exact:true})).toHaveValue(source.id);await expect(practice.getByRole('button',{name:'빈 공간에 다시 조립',exact:true})).toHaveAttribute('aria-pressed','true');await practice.getByRole('button',{name:'원본 위에서 나누기',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();expect(await qa.read()).toEqual(before);
});

for (const authored of parsePack(pack).lessons.slice(52,60)) {
  test(`drawing ${authored.id}: gesture directions, separate ink, every pose and restored checks`,async({page,qa},testInfo)=>{
    test.setTimeout(authored.id==='D60'?240_000:150_000);
    await login(page,qa.account);await synced(page);const before=await qa.read();await page.setViewportSize({width:390,height:844});
    await page.goto('/growth/drawing');await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();await page.locator('#drawing-map summary').nth(6).click();await page.getByRole('button',{name:`${authored.id} · ${authored.title}`,exact:true}).click();
    const practice=page.getByRole('region',{name:'쉬운 크로키 연습'}),next=page.getByRole('button',{name:'다음 행동',exact:true});
    const draw=async(x:number)=>{const canvas=practice.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;await page.mouse.move(b.x+b.width*x,b.y+b.height*.25);await page.mouse.down();await page.mouse.move(b.x+b.width*(x+.1),b.y+b.height*.55,{steps:5});await page.mouse.up();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();};
    for(const [i,ex] of authored.examples.entries()){
      if(i){if(authored.id==='D60')await page.getByLabel('연습할 자세 선택',{exact:true}).selectOption(ex.id);else await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();}
      await expect(practice).toContainText(ex.name);await expect(practice).toContainText('제한 시간 없이');await expect(practice.getByTestId('gesture-easy')).toHaveCount(0);
      await expect(practice.getByRole('button',{name:'빈 공간에 자세 그리기',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeDisabled();
      await draw(.35);await practice.getByRole('button',{name:'원본 위에서 방향 찾기',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeDisabled();await draw(.55);
      await practice.getByRole('button',{name:'빈 공간에 자세 그리기',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
      await practice.getByText('큰 방향 시범 보기',{exact:true}).click();
      for(let s=0;s<5;s++){if(s)await next.click();expect(await practice.getByTestId('gesture-demo').locator('path').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-line')))).toEqual(ex.gesture!.lines.filter(l=>ex.gesture!.frames[s].includes(l.id)).map(l=>l.id));}
      await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();await expect(practice.getByTestId('gesture-easy')).toBeVisible();
      for(const c of ex.gesture!.choices){await practice.getByRole('button',{name:c.label,exact:true}).click();await expect(practice.getByRole('button',{name:c.label,exact:true})).toHaveAttribute('aria-pressed','true');expect(await practice.getByTestId('gesture-easy').locator('path').evaluateAll(ns=>ns.map(n=>n.getAttribute('d')))).toEqual(c.lines.map(l=>l.d));}
      await practice.getByLabel('큰 방향 확인',{exact:true}).check();await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeDisabled();await practice.getByLabel('원본 자세 비교',{exact:true}).check();await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeEnabled();await practice.getByLabel('자세 방향 메모',{exact:true}).fill(`${ex.id}: 머리와 팔 다리의 큰 방향`);
      if(!i&&['D53','D54','D56','D58','D59','D60'].includes(authored.id))await practice.screenshot({path:`.e2e/evidence/drawing-stage7-${authored.id}-${testInfo.project.name}.png`});
      const download=page.waitForEvent('download');await practice.getByRole('button',{name:'자세 원본 내려받기',exact:true}).click();expect(readFileSync((await(await download).path())!,'utf8')).toContain(ex.lines[0].d);
      await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('paper');await expect(practice).toContainText('종이 왼쪽');await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('external');await expect(practice).toContainText('별도 레이어');await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('app');
      await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();
      await expect.poll(async()=>{const q=await qa.account.client.from('growth_drawing_attempts').select('*');return q.data?.some(r=>r.document.example.id===ex.id&&r.status==='completed'&&r.document.gesture?.compared);}).toBe(true);
      const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!;expect(rows).toHaveLength(i+1);const saved=rows.find(r=>r.document.example.id===ex.id)!;
      expect(saved.document.example).toEqual(ex);expect(saved.document.strokes).toHaveLength(1);expect(saved.document.gesture.trace).toHaveLength(1);expect(saved.document.gesture.trace).not.toEqual(saved.document.strokes);expect(saved.document.gesture.directionChecked).toBe(true);expect(saved.document.gesture.choice).toBe(ex.gesture!.choices.at(-1)?.id??'');
      await page.reload();await page.getByRole('button',{name:`내 그림 ${i+1}장`,exact:true}).click();await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').first().getByRole('button',{name:'열고 이어 그리기',exact:true}).click();
      await expect(practice.getByLabel('자세 방향 메모',{exact:true})).toHaveValue(`${ex.id}: 머리와 팔 다리의 큰 방향`);await expect(practice.getByLabel('큰 방향 확인',{exact:true})).toBeChecked();await expect(practice.getByLabel('원본 자세 비교',{exact:true})).toBeChecked();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
      await practice.getByRole('button',{name:'원본 위에서 방향 찾기',exact:true}).click();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();await draw(.45);await expect(practice.getByLabel('큰 방향 확인',{exact:true})).not.toBeChecked();expect((await qa.account.client.from('growth_drawing_attempts').select('*').eq('id',saved.id).single()).data).toEqual(saved);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    expect(await qa.read()).toEqual(before);
  });
}

for (const authored of parsePack(pack).lessons.slice(60,70)) {
 test(`drawing ${authored.id}: character features, variants, ink and restored comparison`,async({page,qa},testInfo)=>{
  test.setTimeout(180_000);await login(page,qa.account);await synced(page);const before=await qa.read();await page.setViewportSize({width:390,height:844});await page.goto('/growth/drawing');await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();await page.locator('#drawing-map summary').nth(7).click();await page.getByRole('button',{name:`${authored.id} · ${authored.title}`,exact:true}).click();
  const practice=page.getByRole('region',{name:'같은 캐릭터 연습'});
  for(const [i,ex] of authored.examples.entries()) {
   if(i)await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();await expect(practice).toContainText(ex.name);
   await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeDisabled();
   for(const f of ex.identity!.features.slice(0,2))await practice.getByLabel(f.label,{exact:true}).check();await expect(practice.getByLabel(ex.identity!.features[2].label,{exact:true})).toBeDisabled();
   if(ex.identity!.options.length>1)for(const o of ex.identity!.options){await practice.getByRole('button',{name:o.label,exact:true}).click();await expect(practice.getByRole('button',{name:o.label,exact:true})).toHaveAttribute('aria-pressed','true');expect(await practice.getByTestId('identity-target').first().locator('path').evaluateAll(ns=>ns.map(n=>n.getAttribute('d')))).toEqual(o.lines.map(l=>l.d));}
   await page.getByRole('button',{name:'원본 숨기기',exact:true}).click();await expect(practice.getByTestId('identity-target')).toHaveCount(0);await expect(practice.getByTestId('identity-baseline')).toHaveCount(0);await page.getByRole('button',{name:'원본 다시 보기',exact:true}).click();
   if(authored.identityPractice==='draw')await practice.getByText('특징을 유지하며 그리는 시범',{exact:true}).click();
   for(let s=0;s<5;s++){if(s)await page.getByRole('button',{name:'다음 행동',exact:true}).click();if(authored.identityPractice==='draw'){const o=ex.identity!.options.at(-1)!;expect(await practice.getByTestId('identity-demo').locator('path').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-line')))).toEqual(o.lines.filter(l=>o.frames[s].includes(l.id)).map(l=>l.id));}}
   await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();await expect(practice.getByTestId('identity-easy')).toBeVisible();
   const canvas=practice.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;await page.mouse.move(b.x+b.width*.4,b.y+b.height*.2);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.6,{steps:5});await page.mouse.up();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
   await practice.getByLabel('캐릭터 비교 메모',{exact:true}).fill(`${ex.id}: 귀 모양과 눈 간격`);await practice.getByLabel('캐릭터 특징 비교 완료',{exact:true}).check();
   const download=page.waitForEvent('download');await practice.getByRole('button',{name:'선택한 캐릭터 예제 내려받기',exact:true}).click();expect(readFileSync((await(await download).path())!,'utf8')).toContain(ex.identity!.options.at(-1)!.lines[0].d);
   await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('paper');await expect(practice).toContainText('종이');await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('external');await expect(practice).toContainText('다른 앱');await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('app');
   if(!i)await practice.screenshot({path:`.e2e/evidence/drawing-stage8-${authored.id}-${testInfo.project.name}.png`});
   await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();await expect.poll(async()=>{const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data;return rows?.some(r=>r.document.example.id===ex.id&&r.status==='completed'&&r.document.identity?.compared);}).toBe(true);
   const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!,saved=rows.find(r=>r.document.example.id===ex.id)!;expect(rows).toHaveLength(i+1);expect(saved.document.strokes).toHaveLength(1);expect(saved.document.example).toEqual(ex);expect(saved.document.identity.features).toEqual(['ears','spacing']);
   await page.reload();await page.getByRole('button',{name:`내 그림 ${i+1}장`,exact:true}).click();await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').first().getByRole('button',{name:'열고 이어 그리기',exact:true}).click();await expect(practice.getByLabel('캐릭터 비교 메모',{exact:true})).toHaveValue(`${ex.id}: 귀 모양과 눈 간격`);await expect(practice.getByLabel('캐릭터 특징 비교 완료',{exact:true})).toBeChecked();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(await qa.read()).toEqual(before);
 });
}

for(const capstone of ['D65','D70'])test(`drawing ${capstone}: own collection copy preserves originals and restores snapshots`,async({page,qa})=>{
 test.setTimeout(240_000);await login(page,qa.account);await synced(page);const before=await qa.read();await page.setViewportSize({width:390,height:844});
 const practice=page.getByRole('region',{name:'같은 캐릭터 연습'});
 const start=async(id:string)=>{await page.goto('/growth/drawing');await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();await page.locator('#drawing-map summary').nth(7).click();const lesson=pack.lessons.find(l=>l.id===id)!;await page.getByRole('button',{name:`${id} · ${lesson.title}`,exact:true}).click();await expect(practice).toBeVisible();};
 const draw=async()=>{const c=practice.getByLabel('내 그림 연습장',{exact:true});await c.scrollIntoViewIfNeeded();const b=(await c.boundingBox())!;await page.mouse.move(b.x+b.width*.3,b.y+b.height*.3);await page.mouse.down();await page.mouse.move(b.x+b.width*.5,b.y+b.height*.6,{steps:4});await page.mouse.up();await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();};
 const ids=capstone==='D65'?['D61','D62','D63','D64']:['D61','D66','D67'];
 for(const id of ids){await start(id);await practice.getByLabel('귀의 모양과 붙는 자리',{exact:true}).check();await practice.getByLabel('눈 사이 간격',{exact:true}).check();await draw();await page.getByRole('button',{name:'잠깐 쉬기 · 저장',exact:true}).click();await expect.poll(async()=>{const r=(await qa.account.client.from('growth_drawing_attempts').select('*')).data;return r?.some(a=>a.document.lesson.id===id&&a.document.strokes.length===1);}).toBe(true);}
 const originals=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!,base=originals.find(a=>a.document.lesson.id==='D61')!,sources=originals.filter(a=>a.id!==base.id);
 await start(capstone);await practice.getByLabel('저장한 D61 기준 그림',{exact:true}).selectOption(base.id);await expect(practice.getByLabel('귀의 모양과 붙는 자리',{exact:true})).toBeChecked();
 for(const source of sources)await practice.getByLabel(`모음 ${source.document.lesson.id} ${source.id}`,{exact:true}).check();
 await practice.getByRole('button',{name:'이 그림을 복사해 보완',exact:true}).first().click();await draw();for(let i=0;i<4;i++)await page.getByRole('button',{name:'다음 행동',exact:true}).click();await practice.getByLabel('캐릭터 비교 메모',{exact:true}).fill('귀와 눈 간격을 유지하고 한 곳을 보완했어요.');await practice.getByLabel('캐릭터 특징 비교 완료',{exact:true}).check();await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeEnabled();await page.getByRole('button',{name:'스스로 해봤어요',exact:true}).click();await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();
 await expect.poll(async()=>{const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data;return rows?.some(a=>a.document.lesson.id===capstone&&a.status==='completed');}).toBe(true);
 const after=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!,saved=after.find(a=>a.document.lesson.id===capstone)!;for(const source of originals)expect(after.find(a=>a.id===source.id)).toEqual(source);expect(saved.document.strokes).toHaveLength(2);expect(saved.document.identity.collection).toHaveLength(sources.length);expect(saved.document.identity.baseline.attemptId).toBe(base.id);
 await page.reload();await page.getByRole('button',{name:`내 그림 ${after.length}장`,exact:true}).click();await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').filter({hasText:capstone}).getByRole('button',{name:'열고 이어 그리기',exact:true}).click();await expect(practice.getByLabel('캐릭터 특징 비교 완료',{exact:true})).toBeChecked();await expect(practice.getByRole('button',{name:'이 그림을 복사해 보완',exact:true})).toHaveCount(sources.length);expect(await qa.read()).toEqual(before);
});

for(const authored of parsePack(pack).lessons.slice(70,80))test(`drawing ${authored.id}: original creator variants, paper notes and exact restored state`,async({page,qa},testInfo)=>{
 test.setTimeout(180_000);await login(page,qa.account);await synced(page);const before=await qa.read();await page.setViewportSize({width:390,height:844});await page.goto('/growth/drawing');await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();await page.locator('#drawing-map summary').nth(8).click();await page.getByRole('button',{name:`${authored.id} · ${authored.title}`,exact:true}).click();
 const area=page.getByRole('region',{name:'나만의 캐릭터 제작'});
 const draw=async()=>{const c=area.getByLabel('내 그림 연습장',{exact:true});await c.scrollIntoViewIfNeeded();const b=(await c.boundingBox())!;await page.mouse.move(b.x+b.width*.25,b.y+b.height*.2);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.6,{steps:5});await page.mouse.up();await expect(area.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();};
 for(const [i,ex] of authored.examples.entries()){
  if(i)await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();await expect(area).toContainText(ex.original!.motif==='sprout'?'새싹':'작은 새');await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeDisabled();
  await area.getByLabel('캐릭터 역할',{exact:true}).fill('앱에서 반겨주는 친구');await area.getByLabel('캐릭터 성격',{exact:true}).fill('다정함');
  if(authored.id==='D72'){await draw();await area.getByRole('button',{name:'길쭉한 후보',exact:true}).click();await draw();await area.getByLabel('이어 만들 몸',{exact:true}).selectOption('tall');await area.getByRole('button',{name:'선택 이유 예시 넣기',exact:true}).click();}
  else if(authored.id==='D79'){await draw();await area.getByRole('button',{name:'두 번째 자세 연습장',exact:true}).click();await area.getByLabel('두 번째 자세',{exact:true}).selectOption('walk');await draw();}
  else if(authored.id!=='D80')await draw();
  if(authored.id==='D73')await area.getByRole('button',{name:'갈라진 특징',exact:true}).click();
  if(authored.id==='D76'){await area.getByRole('button',{name:'색 조합 2',exact:true}).click();await area.getByRole('button',{name:'주색 연필',exact:true}).click();await draw();await area.getByRole('button',{name:'보조색 연필',exact:true}).click();await draw();}
  if(['D77','D78'].includes(authored.id))await area.getByRole('button',{name:'놀람',exact:true}).click();
  if(authored.id==='D80'){await area.getByLabel('캐릭터 이름',{exact:true}).fill('새봄');await area.getByLabel('다음에 바꿀 것',{exact:true}).fill('팔 방향');await area.getByLabel('카드 특징 shape',{exact:true}).check();await area.getByLabel('카드 특징 mark',{exact:true}).check();await expect(area.getByLabel('카드 특징 eyes',{exact:true})).toBeDisabled();}
  await page.getByRole('button',{name:'원본 숨기기',exact:true}).click();if(authored.id!=='D80')await expect(area.getByText('선택한 모양의 방법 예제',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'원본 다시 보기',exact:true}).click();await page.getByRole('button',{name:'더 쉽게 · 일부만',exact:true}).click();
  for(let step=1;step<5;step++)await page.getByRole('button',{name:'다음 행동',exact:true}).click();
  await area.getByLabel('창작 비교 메모',{exact:true}).fill(`${ex.id}: 종이 그림의 대표 특징을 비교했어요`);await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('paper');await expect(area).toContainText('종이');await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('external');await area.getByLabel('내 캐릭터 비교 완료',{exact:true}).check();await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeEnabled();await page.getByRole('combobox',{name:/^그리는 곳/}).selectOption('app');
  if(!i)await area.screenshot({path:`.e2e/evidence/drawing-stage9-${authored.id}-${testInfo.project.name}.png`});
  if(authored.id!=='D80'){const wait=page.waitForEvent('download');await area.getByRole('button',{name:'선택한 창작 예제 내려받기',exact:true}).click();expect(readFileSync((await(await wait).path())!,'utf8')).toContain('<svg');}
  await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();await expect.poll(async()=>{const x=(await qa.account.client.from('growth_drawing_attempts').select('*')).data;return x?.some(a=>a.document.example.id===ex.id&&a.status==='completed');}).toBe(true);
  const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!,saved=rows.find(a=>a.document.example.id===ex.id)!;expect(rows).toHaveLength(i+1);expect(saved.document.example).toEqual(ex);expect(saved.document.original.note).toContain(ex.id);if(authored.id==='D72')expect(saved.document.original.panels.tall).toHaveLength(1);if(authored.id==='D79')expect(saved.document.original.panels.second).toHaveLength(1);
  await page.reload();await page.getByRole('button',{name:`내 그림 ${i+1}장`,exact:true}).click();await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').first().getByRole('button',{name:'열고 이어 그리기',exact:true}).click();await expect(area.getByLabel('창작 비교 메모',{exact:true})).toHaveValue(saved.document.original.note);await expect(area.getByLabel('내 캐릭터 비교 완료',{exact:true})).toBeChecked();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 expect(await qa.read()).toEqual(before);
});

for(const motif of ['sprout','bird'])test(`drawing D80: ${motif} own D71 to D80 project preserves originals and exports actual card`,async({page,qa},testInfo)=>{
 test.setTimeout(300_000);await login(page,qa.account);await synced(page);const before=await qa.read();await page.setViewportSize({width:390,height:844});const area=page.getByRole('region',{name:'나만의 캐릭터 제작'});const savedById:Record<string,{id:string;[key:string]:unknown}>={};
 const refs:Record<number,number[]>={71:[],72:[71],73:[72],74:[73],75:[74],76:[74],77:[74],78:[74,77],79:[74],80:[74,78,79]};
 const draw=async()=>{const c=area.getByLabel('내 그림 연습장',{exact:true});await c.scrollIntoViewIfNeeded();const b=(await c.boundingBox())!;await page.mouse.move(b.x+b.width*.3,b.y+b.height*.3);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.65,{steps:4});await page.mouse.up();};
 for(let n=71;n<=80;n++){
  const id=`D${n}`,lesson=pack.lessons[n-1];await page.goto('/growth/drawing');await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();await page.locator('#drawing-map summary').nth(8).click();await page.getByRole('button',{name:`${id} · ${lesson.title}`,exact:true}).click();if(motif==='bird')await page.getByRole('button',{name:'같은 목표의 다른 그림',exact:true}).click();
  for(const ref of refs[n])await area.getByLabel(`D${ref} 원본`,{exact:true}).selectOption(savedById[`D${ref}`].id);
  if(n===71){await area.getByRole('button',{name:'앱에서 반겨주는 친구',exact:true}).click();await area.getByRole('button',{name:'다정함',exact:true}).click();}
  if(n===72){await draw();await area.getByRole('button',{name:'길쭉한 후보',exact:true}).click();await draw();await area.getByLabel('이어 만들 몸',{exact:true}).selectOption('tall');await area.getByRole('button',{name:'선택 이유 예시 넣기',exact:true}).click();}
  else if(n===76){await area.getByRole('button',{name:'내 선화 복사해서 색 넣기',exact:true}).click();await area.getByRole('button',{name:'주색 연필',exact:true}).click();await draw();await area.getByRole('button',{name:'보조색 연필',exact:true}).click();await draw();}
  else if(n===79){await draw();await page.getByRole('button',{name:'잠깐 쉬기 · 저장',exact:true}).click();await expect.poll(async()=>{const r=(await qa.account.client.from('growth_drawing_attempts').select('*')).data;return r?.some(a=>a.document.lesson.id===id&&a.status==='draft');}).toBe(true);await page.reload();await page.getByRole('button',{name:'내 그림 9장',exact:true}).click();await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').filter({hasText:id}).getByRole('button',{name:'열고 이어 그리기',exact:true}).click();await area.getByRole('button',{name:'두 번째 자세 연습장',exact:true}).click();await draw();}
  else if(n===80){await area.getByLabel('캐릭터 이름',{exact:true}).fill('새봄');await area.getByLabel('다음에 바꿀 것',{exact:true}).fill('팔 방향을 더 크게');await area.getByLabel('카드 특징 shape',{exact:true}).check();await area.getByLabel('카드 특징 mark',{exact:true}).check();await expect(area.getByRole('article',{name:'내 캐릭터 소개 카드'}).getByLabel('저장한 그림 미리보기')).toHaveCount(7);const wait=page.waitForEvent('download');await area.getByRole('button',{name:'소개 카드 PNG 내려받기',exact:true}).click();const bytes=readFileSync((await(await wait).path())!);expect(bytes.subarray(1,4).toString()).toBe('PNG');expect(bytes.readUInt32BE(16)).toBe(1000);expect(bytes.readUInt32BE(20)).toBe(1550);await area.getByRole('article',{name:'내 캐릭터 소개 카드'}).screenshot({path:`.e2e/evidence/drawing-stage9-card-${motif}-${testInfo.project.name}.png`});}
  else await draw();
  for(let i=1;i<5;i++)await page.getByRole('button',{name:'다음 행동',exact:true}).click();await area.getByLabel('창작 비교 메모',{exact:true}).fill(`${id} 같은 큰 몸과 대표 특징`);await area.getByLabel('내 캐릭터 비교 완료',{exact:true}).check();await expect(page.getByRole('button',{name:'스스로 해봤어요',exact:true})).toBeEnabled();await page.getByRole('button',{name:'스스로 해봤어요',exact:true}).click();await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();await expect.poll(async()=>{const r=(await qa.account.client.from('growth_drawing_attempts').select('*')).data;return r?.some(a=>a.document.lesson.id===id&&a.status==='completed');}).toBe(true);
  const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!;for(const old of Object.values(savedById))expect(rows.find(x=>x.id===old.id)).toEqual(old);savedById[id]=rows.find(a=>a.document.lesson.id===id)!;
 }
 await page.reload();await page.getByRole('button',{name:'내 그림 10장',exact:true}).click();await page.getByRole('region',{name:'내 그림 앨범'}).locator('article').filter({hasText:'D80'}).getByRole('button',{name:'열고 이어 그리기',exact:true}).click();await expect(area.getByLabel('캐릭터 이름',{exact:true})).toHaveValue('새봄');await expect(area.getByRole('article',{name:'내 캐릭터 소개 카드'}).getByLabel('저장한 그림 미리보기')).toHaveCount(7);expect(await qa.read()).toEqual(before);
});

for (const project of pack.projects) {
  test(`drawing ${project.id}: four saved sessions, reload, own source preservation and project card`, async ({page,qa},testInfo) => {
    test.setTimeout(150_000);
    await login(page,qa.account);await synced(page);const unrelated=await qa.read();
    await page.setViewportSize({width:390,height:844});await page.goto('/growth/drawing');
    await page.getByRole('button',{name:'이어서 연습하기',exact:true}).click();
    async function ink(){const canvas=page.getByLabel('내 그림 연습장',{exact:true});await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;await page.mouse.move(b.x+b.width*.3,b.y+b.height*.3);await page.mouse.down();await page.mouse.move(b.x+b.width*.65,b.y+b.height*.65,{steps:5});await page.mouse.up();}
    await ink();await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
    const originals=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!;expect(originals).toHaveLength(1);const source=originals[0];
    const entry=page.locator('details').filter({has:page.locator('summary').filter({hasText:`${project.id} · ${project.title}`})});
    await entry.locator('summary').click();await page.getByRole('button',{name:`${project.id} 시작·이어하기`,exact:true}).click();
    const practice=page.getByRole('group',{name:'지속 프로젝트 연습'});
    await expect(page.getByRole('button',{name:'시도 마치고 저장',exact:true})).toBeDisabled();
    await practice.getByLabel('기준으로 삼을 내 그림').selectOption(source.id);
    for(let i=0;i<4;i++) {
      if(i)await practice.getByRole('button',{name:`${i+1}회차`,exact:true}).click();
      await practice.getByLabel('이번 회차 메모',{exact:true}).fill(`${project.id} 회차 ${i+1}: 같은 특징을 유지하고 한 부분을 바꿨어요.`);
      if(i===1||i===2)await ink();
      if(i===3){if(project.id==='C04')await practice.getByLabel('묶음 이름').fill('작은 친구');await practice.getByRole('checkbox',{name:/직접 비교했어요/}).check();}
      await practice.getByRole('button',{name:'이번 회차 저장',exact:true}).click();
      await expect(practice.getByRole('status')).toContainText('이번 회차를 저장했어요');
      const rows=(await qa.account.client.from('growth_drawing_attempts').select('*')).data!;
      expect(rows.find(r=>r.id===source.id)).toEqual(source);
      const current=rows.find(r=>r.document.lesson.id===project.id)!;expect(current.document.project.saved).toEqual([0,1,2,3].map(n=>n<=i));
      if(i===1){await page.reload();const entry=page.locator('details').filter({has:page.locator('summary').filter({hasText:`${project.id} · ${project.title}`})});await expect(page.getByRole('button',{name:'이어서 연습하기',exact:true})).toBeEnabled();await entry.locator('summary').click();await page.getByRole('button',{name:`${project.id} 시작·이어하기`,exact:true}).click();await expect(practice.getByLabel('이번 회차 메모')).toHaveValue(current.document.project.notes[1]);await expect(practice.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();}
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await practice.screenshot({path:`.e2e/evidence/drawing-project-${project.id}-${testInfo.project.name}.png`});
    const downloaded=page.waitForEvent('download');await practice.getByRole('button',{name:'프로젝트 카드 PNG',exact:true}).click();const file=await downloaded;const bytes=readFileSync((await file.path())!);expect(bytes.subarray(1,4).toString()).toBe('PNG');expect(bytes.readUInt32BE(16)).toBe(1200);
    await page.getByRole('button',{name:'스스로 해봤어요',exact:true}).click();await page.getByRole('button',{name:'시도 마치고 저장',exact:true}).click();await expect(page.getByRole('region',{name:'연이의 연습 정리'})).toContainText('4 / 4회차');
    const saved=(await qa.account.client.from('growth_drawing_attempts').select('*').eq('document->lesson->>id',project.id).single()).data!;expect(saved.status).toBe('completed');
    await page.reload();await page.getByRole('button',{name:'내 그림 2장',exact:true}).click();await page.getByLabel('단계 필터').selectOption('10');await page.getByRole('button',{name:'열고 이어 그리기',exact:true}).click();await expect(practice.getByLabel('이번 회차 메모')).toHaveValue(saved.document.project.notes[3]);
    await practice.getByRole('button',{name:'2회차 · 저장됨',exact:true}).click();await practice.getByLabel('이번 회차 메모').fill('앞 회차를 수정하면 뒤 회차를 다시 확인');await expect(practice.getByRole('button',{name:'3회차',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'시도 마치고 저장',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'진행 중 저장',exact:true}).click();await expect(page.getByText('클라우드 저장 확인 완료',{exact:true})).toBeVisible();
    expect((await qa.account.client.from('growth_drawing_attempts').select('*').eq('id',source.id).single()).data).toEqual(source);expect(await qa.read()).toEqual(unrelated);
  });
}
