import { randomUUID } from 'node:crypto';
import { test, expect, login, synced } from './fixture';
import { RouteDrain } from './route-drain';
import { TYPING_LESSONS } from '../../app/data/typingBasics';

async function typeLesson(page:import('@playwright/test').Page,keys:string){
 await page.getByRole('button',{name:'키보드 자리 연습 입력'}).click();
 for(const char of keys) await page.keyboard.press(char===' '?'Space':char);
}
test('typing basics tracks mistakes, saves once and resumes with owner isolation at 320px',async({page,qa})=>{
 await qa.account.client.from('growth_routines').insert({id:randomUUID(),user_id:qa.account.id,category:'typing',title:'검증 타자',target_minutes:5,enabled:true});
 await login(page,qa.account);await synced(page);const before=await qa.read();await page.setViewportSize({width:320,height:844});await page.goto('/growth/typing');await page.getByRole('link',{name:/손가락 자리부터 다시 배우기/}).click();
 await expect(page.getByRole('heading',{name:'1강 · 검지의 집 찾기'})).toBeVisible();const pad=page.getByRole('button',{name:'키보드 자리 연습 입력'});await expect(pad).toBeEnabled();await pad.click();await page.keyboard.press('a');await expect(page.getByText('다시 익힐 자리: F 1회')).toBeVisible();
 await page.keyboard.press('Shift+f');await page.keyboard.press('Backspace');await pad.dispatchEvent('keydown',{code:'KeyF',key:'f',repeat:true});await expect(page.getByLabel('다음 키 안내')).toContainText('1 / 12');
 await page.keyboard.press('Tab');await expect(pad).not.toBeFocused();
 await typeLesson(page,TYPING_LESSONS[0].keys);await expect(pad).toBeDisabled();await expect(page.getByText('첫 시도 포함 정확도')).toContainText('92%');await expect(page.getByRole('button',{name:'자리 연습 저장'})).toBeDisabled();
 await page.getByLabel('안내된 손가락으로 누르고 기본 자리로 돌아왔어요.').check();await page.getByLabel('키를 세게 내리치지 않고 손의 힘을 빼 보았어요.').check();
 const pattern='**/rest/v1/growth_sessions*',drain=new RouteDrain();let posts=0;
 await page.route(pattern,route=>drain.run(async()=>{if(route.request().method()==='POST'){posts++;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:'{"message":"lost"}'});}else await route.fallback();}));
 try{await page.getByRole('button',{name:'자리 연습 저장',exact:true}).click();await expect(page.getByRole('button',{name:'저장 완료',exact:true})).toBeDisabled();expect(posts).toBe(1);}finally{await drain.wait();await page.unroute(pattern);}
 const rows=(await qa.account.client.from('growth_sessions').select('*')).data!;expect(rows).toHaveLength(1);expect(rows[0].metrics).toMatchObject({courseId:'typing-position-v1',lessonId:'anchors',keyPresses:13,correctKeyPresses:12,keyAccuracy:92,mistakeKeys:{f:1}});expect(rows[0].metrics.passageIndex).toBeUndefined();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.reload();await expect(page.getByRole('heading',{name:'2강 · 중지 자리'})).toBeVisible();await expect(page.getByRole('region',{name:'자리 연습 진도'})).toContainText('1 / 14');
 const other=await qa.createAccount();expect((await other.client.from('growth_sessions').select('*')).data).toEqual([]);expect(await qa.read()).toEqual(before);
});
test('typing basics recovers failed progress and uses physical key codes in Korean mode',async({page,qa})=>{
 await login(page,qa.account);await synced(page);const pattern='**/rest/v1/growth_sessions*';await page.route(pattern,async route=>{if(route.request().url().includes('metrics=cs.'))await route.fulfill({status:503,contentType:'application/json',body:'{"message":"unavailable"}'});else await route.fallback();});await page.goto('/growth/typing/basics');await expect(page.getByRole('region',{name:'자리 연습 진도'}).getByRole('alert')).toContainText('진도를 불러오지 못했어요.');await expect(page.getByRole('button',{name:'키보드 자리 연습 입력'})).toBeDisabled();await page.unroute(pattern);await page.getByRole('button',{name:'진도 다시 불러오기'}).click();const pad=page.getByRole('button',{name:'키보드 자리 연습 입력'});await expect(pad).toBeEnabled();await pad.click();await pad.dispatchEvent('keydown',{key:'Process',code:'KeyF',keyCode:229,isComposing:true});await expect(page.getByLabel('다음 키 안내')).toContainText('2 / 12');await expect(page.getByLabel('다음 키 안내')).toContainText('오른손 검지');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'같은 자리 다시 연습'}).click();await expect(page.getByLabel('다음 키 안내')).toContainText('1 / 12');await page.getByRole('link',{name:'자리가 편해졌다면 문장 연습으로'}).click();await expect(page.getByLabel('입력 칸')).toBeVisible();expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([]);
});
