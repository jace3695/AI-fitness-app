import { test, expect, login, synced } from './fixture';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import pack from '../../content/drawing/foundations-v1.json';
import { delayDrawingCheckpointUntilConfirmation, localDrawingConfirmation } from './drawing-checkpoint-race';
import { RouteDrain } from './route-drain';

async function draw(page:Page) {
  const canvas=page.getByLabel('내 그림 연습장',{exact:true});
  await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;
  await page.mouse.move(b.x+b.width*.3,b.y+b.height*.3);await page.mouse.down();
  await page.mouse.move(b.x+b.width*.6,b.y+b.height*.6,{steps:5});await page.mouse.up();
  await expect(page.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
}
async function chooseProject(page:Page,id:string) {
  await expect(page.getByRole('button',{name:'다른 수업 고르기',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'다른 수업 고르기',exact:true}).click();
  const project=pack.projects.find(p=>p.id===id)!;
  await page.locator('summary').filter({hasText:`${id} · ${project.title}`}).click();
  await page.getByRole('button',{name:`${id} 시작·이어하기`,exact:true}).click();
}

test('drawing simple: menus wait for loaded records and open with one click after reload', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); const original = await qa.read();
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/growth/drawing');
  await page.getByRole('button', { name: '처음 그림 그리기', exact: true }).click();
  await draw(page);
  await page.getByRole('button', { name: '여기까지 저장', exact: true }).click();
  await expect(page.getByText('저장했어요. 화면을 닫아도 나중에 이어 할 수 있어요.', { exact: true })).toBeVisible();
  const saved = await qa.account.client.from('growth_drawing_attempts').select('*').single();
  expect(saved.error).toBeNull(); expect(saved.data.document.strokes).toHaveLength(1);

  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void; const received = new Promise<void>(resolve => { arrived = resolve; });
  const pattern = '**/rest/v1/growth_drawing_attempts*', drain = new RouteDrain();
  await page.route(pattern, route => drain.run(async () => {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    // Keep the real authenticated database response; delay delivery only.
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(200); arrived(); await held;
    await route.fulfill({ response });
  }));
  try {
    await page.reload(); await received;
    await expect(page.getByText('저장한 그림을 확인하고 있어요…', { exact: true })).toBeVisible();
    const menu = page.getByRole('navigation', { name: '그림 연습 메뉴' });
    await expect(menu.getByRole('button')).toHaveCount(3);
    for (const button of await menu.getByRole('button').all()) await expect(button).toBeDisabled();
    release();
    const toggle = menu.getByRole('button', { name: '전체 도구 보기', exact: true });
    await expect(toggle).toBeEnabled();
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#drawing-map')).toBeVisible();
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await menu.getByRole('button', { name: '다른 수업 고르기', exact: true }).click();
    await expect(page.locator('#drawing-map')).toBeVisible();
    await menu.getByRole('button', { name: '내 그림 1장', exact: true }).click();
    await page.getByRole('button', { name: '열고 이어 그리기', exact: true }).click();
    await expect(page.getByRole('button', { name: '되돌리기', exact: true })).toBeEnabled();
    expect((await qa.account.client.from('growth_drawing_attempts').select('*').single()).data).toEqual(saved.data);
    expect(await qa.read()).toEqual(original);
  } finally { release(); await drain.wait(); await page.unroute(pattern); }
});

for(const width of [320,390]) test(`drawing simple: first start, partial save, resume and finish at ${width}px`,async({page,qa},info)=>{
  await login(page,qa.account);await synced(page);const original=await qa.read();
  await page.setViewportSize({width,height:844});await page.goto('/growth/drawing');
  await expect(page.getByRole('button',{name:'처음 그림 그리기',exact:true})).toBeEnabled();
  await expect(page.locator('#drawing-map')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'만능 템플릿 원본 자료'})).toHaveCount(0);
  await page.getByRole('region',{name:'그림 연습 시작'}).screenshot({path:`.e2e/evidence/drawing-simple-start-${width}-${info.project.name}.png`});
  await page.getByRole('button',{name:'처음 그림 그리기',exact:true}).click();
  const work=page.getByRole('region',{name:'한 동작씩 보기'});
  await expect(page.getByRole('navigation',{name:'AI 연이 공통 메뉴'})).toBeHidden();
  await expect(page.getByRole('button',{name:'홈 화면 추가',exact:true})).toBeHidden();
  await expect(work).toContainText('1 / 6');await draw(page);
  await page.getByRole('button',{name:'다음 행동',exact:true}).click();await expect(work).toContainText('2 / 6');
  // Optional UI mode switches preserve the actual drawing.
  await page.getByRole('button',{name:'전체 도구 보기',exact:true}).click();
  await expect(page.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'전체 도구 보기',exact:true}).click();
  await page.getByRole('button',{name:'여기까지 저장',exact:true}).click();
  await expect(page.getByText('저장했어요. 화면을 닫아도 나중에 이어 할 수 있어요.',{exact:true})).toBeVisible();
  const first=(await qa.account.client.from('growth_drawing_attempts').select('*').single()).data!;
  expect(first.document.strokes).toHaveLength(1);expect(first.document.step).toBe(1);expect(first.status).toBe('draft');
  await page.reload();await page.getByRole('button',{name:'하던 그림 이어 그리기',exact:true}).click();
  await expect(work).toContainText('2 / 6');await expect(page.getByRole('button',{name:'되돌리기',exact:true})).toBeEnabled();
  const surface=page.getByLabel('내 그림 연습장',{exact:true});
  await surface.scrollIntoViewIfNeeded();
  // Verify an actual visible drawing point receives input, not a floating menu.
  expect(await surface.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.right-15,Math.min(r.bottom-15,innerHeight-20))===el;})).toBe(true);
  await work.screenshot({path:`.e2e/evidence/drawing-simple-work-${width}-${info.project.name}.png`});
  for(let i=2;i<6;i++)await page.getByRole('button',{name:'다음 행동',exact:true}).click();
  await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();
  await page.getByRole('button',{name:'오늘 연습 마치고 저장',exact:true}).click();
  await expect(page.getByRole('region',{name:'연이의 연습 정리'})).toBeVisible();
  const saved=(await qa.account.client.from('growth_drawing_attempts').select('*').single()).data!;
  expect(saved.id).toBe(first.id);expect(saved.status).toBe('completed');expect(saved.document.strokes).toEqual(first.document.strokes);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await qa.read()).toEqual(original);
  await page.getByRole('button',{name:'처음 화면',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'AI 연이 공통 메뉴'})).toBeVisible();
});

test('drawing simple: delayed local checkpoint cannot replace a confirmed save before resume', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); const original = await qa.read();
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/growth/drawing');
  await expect(page.getByRole('button', { name: '처음 그림 그리기', exact: true })).toBeEnabled();
  await delayDrawingCheckpointUntilConfirmation(page);
  await page.getByRole('button', { name: '처음 그림 그리기', exact: true }).click();
  await draw(page);
  await page.getByRole('button', { name: '다음 행동', exact: true }).click();
  await page.getByRole('button', { name: '여기까지 저장', exact: true }).click();
  await expect(page.getByText('저장했어요. 화면을 닫아도 나중에 이어 할 수 있어요.', { exact: true })).toBeVisible();
  const first = (await qa.account.client.from('growth_drawing_attempts').select('*').single()).data!;
  expect(first.revision).toBe(1); expect(first.status).toBe('draft'); expect(first.document.strokes).toHaveLength(1);
  expect(await localDrawingConfirmation(page, qa.account.id, first.id)).toEqual({ pending: false, revision: first.revision, baseRevision: first.revision });
  await page.reload(); await page.getByRole('button', { name: '하던 그림 이어 그리기', exact: true }).click();
  await expect(page.getByRole('region', { name: '한 동작씩 보기' })).toContainText('2 / 6');
  for (let i = 2; i < 6; i++) await page.getByRole('button', { name: '다음 행동', exact: true }).click();
  await page.getByRole('button', { name: '도움을 받았어요', exact: true }).click();
  await page.getByRole('button', { name: '오늘 연습 마치고 저장', exact: true }).click();
  await expect(page.getByRole('region', { name: '연이의 연습 정리' })).toBeVisible();
  const saved = (await qa.account.client.from('growth_drawing_attempts').select('*').single()).data!;
  expect(saved.id).toBe(first.id); expect(saved.revision).toBe(2); expect(saved.status).toBe('completed');
  expect(saved.document.strokes).toEqual(first.document.strokes); expect(saved.document.check).toBe('assisted');
  expect(await localDrawingConfirmation(page, qa.account.id, saved.id)).toEqual({ pending: false, revision: saved.revision, baseRevision: saved.revision });
  expect(await qa.read()).toEqual(original);
});

test('drawing simple: no saved project source gives an actionable route to first lesson',async({page,qa})=>{
  await login(page,qa.account);await synced(page);const original=await qa.read();await page.goto('/growth/drawing');
  await expect(page.getByRole('button',{name:'처음 그림 그리기',exact:true})).toBeEnabled();await chooseProject(page,'C01');
  await expect(page.getByRole('button',{name:'이 단계 저장하기',exact:true})).toBeDisabled();
  await expect(page.getByText('아직 고를 그림이 없어요.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'쉬운 그림부터 그리기',exact:true}).click();
  await expect(page.getByRole('region',{name:'현재 과제'})).toContainText('D01');await draw(page);
  await page.getByRole('button',{name:'여기까지 저장',exact:true}).click();
  await expect(page.getByText('저장했어요. 화면을 닫아도 나중에 이어 할 수 있어요.',{exact:true})).toBeVisible();
  expect(await qa.read()).toEqual(original);
});
for(const id of ['C01','C04'])test(`drawing simple ${id}: four guided steps, saved next button, original preservation and PNG`,async({page,qa},info)=>{
  test.setTimeout(150_000);await login(page,qa.account);await synced(page);const original=await qa.read();
  await page.setViewportSize({width:390,height:844});await page.goto('/growth/drawing');
  await page.getByRole('button',{name:'처음 그림 그리기',exact:true}).click();await draw(page);
  await page.getByRole('button',{name:'여기까지 저장',exact:true}).click();
  await expect(page.getByText('저장했어요. 화면을 닫아도 나중에 이어 할 수 있어요.',{exact:true})).toBeVisible();
  const source=(await qa.account.client.from('growth_drawing_attempts').select('*').single()).data!;
  await chooseProject(page,id);const practice=page.getByRole('group',{name:'지속 프로젝트 연습'});
  await practice.getByLabel('어떤 내 그림을 바꿔 볼까요?').selectOption(source.id);
  for(let i=0;i<4;i++){
    if(i)await practice.getByRole('button',{name:'다음 단계로',exact:true}).click();
    await expect(practice).toContainText(`지금은 ${i+1}번째 단계예요`);
    await expect(practice.getByRole('button',{name:'이 단계 저장하기',exact:true})).toBeDisabled();
    if(i>0)await draw(page);
    await practice.getByLabel('이번 회차 메모',{exact:true}).fill(`표정과 귀를 비교했어요 ${i}`);
    if(i===3){if(id==='C04')await practice.getByLabel('그림 이름',{exact:true}).fill('동그란 친구');await practice.getByRole('checkbox',{name:/직접 비교했어요/}).check();}
    await practice.getByRole('button',{name:'이 단계 저장하기',exact:true}).click();
    await expect(practice.getByRole('status').filter({hasText:i===3?'네 단계를 모두 저장했어요':'저장했어요!'})).toBeVisible();
    if(i===1){await page.reload();await chooseProject(page,id);await expect(practice.getByLabel('이번 회차 메모')).toHaveValue('표정과 귀를 비교했어요 1');}
  }
  await practice.screenshot({path:`.e2e/evidence/drawing-simple-${id}-${info.project.name}.png`});
  const download=page.waitForEvent('download');await practice.getByRole('button',{name:'그림 카드 내려받기 (PNG)',exact:true}).click();
  const bytes=readFileSync((await(await download).path())!);expect(bytes.subarray(1,4).toString()).toBe('PNG');
  await page.getByRole('button',{name:'도움을 받았어요',exact:true}).click();await page.getByRole('button',{name:'오늘 연습 마치고 저장',exact:true}).click();
  await expect(page.getByRole('region',{name:'연이의 연습 정리'})).toBeVisible();
  const saved=(await qa.account.client.from('growth_drawing_attempts').select('*').eq('document->lesson->>id',id).single()).data!;
  expect(saved.status).toBe('completed');expect(saved.document.project.saved).toEqual([true,true,true,true]);
  expect((await qa.account.client.from('growth_drawing_attempts').select('*').eq('id',source.id).single()).data).toEqual(source);
  expect(await qa.read()).toEqual(original);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
