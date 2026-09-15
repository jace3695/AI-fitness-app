import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { CHATGPT_CLIENT_ID, CHATGPT_REDIRECT, CONNECT_SCOPES } from '../../lib/chatgpt-connection';
import { canonical, expect, login, synced, test } from './fixture';

const origin='http://127.0.0.1:3000'; const resource=`${origin}/mcp`;
function authorization() {
  const verifier=randomBytes(32).toString('base64url'); const state=randomUUID();
  const query=new URLSearchParams({client_id:CHATGPT_CLIENT_ID,redirect_uri:CHATGPT_REDIRECT,resource,state,
    response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),scope:CONNECT_SCOPES.join(' ')});
  return {verifier,state,query};
}
async function consent(page: Page, approve=true, onlyBudget=false) {
  const pending=authorization();
  // ChatGPT's callback is represented by a local synthetic client: capture the
  // redirect response before navigation. Never send test tokens to ChatGPT.
  await page.route(`${CHATGPT_REDIRECT}**`,route=>route.fulfill({status:200,contentType:'text/html',body:'<p>합성 OAuth 클라이언트</p>'}));
  await page.goto(`/api/chatgpt/oauth/authorize?${pending.query}`);
  const review=page.getByRole('region',{name:'ChatGPT 연결 승인'}); await expect(review).toBeVisible();
  if(onlyBudget) for(const label of ['일정·할 일','운동','식단','언어 학습']) await review.getByRole('checkbox',{name:label,exact:true}).uncheck();
  const result=page.waitForResponse(response=>response.url().endsWith('/api/chatgpt/connection') && response.request().method()==='POST');
  await review.getByRole('button',{name:approve?'선택한 권한으로 연결':'연결 취소',exact:true}).click();
  const response=await result; expect(response.status()).toBe(200);
  const target=new URL((await response.json()).redirect);
  expect(target.origin+target.pathname).toBe(CHATGPT_REDIRECT); expect(target.searchParams.get('state')).toBe(pending.state); expect(target.searchParams.get('iss')).toBe(origin);
  return {...pending,target};
}
async function tokens(request:APIRequestContext,pending:Awaited<ReturnType<typeof consent>>) {
  const response=await request.post('/api/chatgpt/oauth/token',{form:{grant_type:'authorization_code',code:pending.target.searchParams.get('code')!,code_verifier:pending.verifier,client_id:CHATGPT_CLIENT_ID,redirect_uri:CHATGPT_REDIRECT,resource}});
  expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store'); return response.json();
}
async function mcp(request:APIRequestContext,token:string,name:string,args:Record<string,unknown>={}) {
  const response=await request.post('/mcp',{headers:{authorization:`Bearer ${token}`,accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});
  expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store'); const data=await response.json();
  return data.result as {isError?:boolean;structuredContent?:any;content:{text:string}[];_meta?:Record<string,unknown>};
}

test('ChatGPT consent is explicit; real OAuth/MCP save returns advice to the app, survives reload and retries only once',async({page,qa,request})=>{
  await page.setViewportSize({width:390,height:844}); await login(page,qa.account); await synced(page);
  const original=canonical(await qa.read());
  const cancelled=await consent(page,false); expect(cancelled.target.searchParams.get('error')).toBe('access_denied');
  expect(cancelled.target.searchParams.has('code')).toBe(false);
  await page.goto('/assistant/connect'); await expect(page.getByText('현재 활성화된 연결이 없습니다.',{exact:true})).toBeVisible();
  const granted=await consent(page,true,true); const token=await tokens(request,granted);
  const forbidden=await mcp(request,token.access_token,'read_record_summary',{area:'fitness'}); expect(forbidden.isError).toBe(true);
  const summary=await mcp(request,token.access_token,'read_record_summary',{area:'budget',days:7}); expect(summary.isError).not.toBe(true);
  const args={request_id:randomUUID(),snapshot_id:summary.structuredContent.snapshot_id,title:'합성 연결 검증 조언',body:'기록을 확인한 뒤 필요한 지출을 계획해 보세요. <script>위험한 코드는 실행되지 않습니다.</script>'};
  const saved=await mcp(request,token.access_token,'save_advice',args); expect(saved.isError).not.toBe(true);
  const retry=await mcp(request,token.access_token,'save_advice',args); expect(retry.structuredContent.id).toBe(saved.structuredContent.id);
  const rows=await qa.account.client.from('chatgpt_advice').select('id'); expect(rows.error).toBeNull(); expect(rows.data).toHaveLength(1);
  await page.goto('/assistant/advice'); const card=page.getByRole('article',{name:'합성 연결 검증 조언 조언'}); await expect(card).toBeVisible();
  await page.reload(); await expect(card).toBeVisible(); await expect(card).toContainText('<script>');
  await card.getByText('분석에 사용한 기록 요약',{exact:true}).click(); await expect(card.getByText('지출 기록 건수',{exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(canonical(await qa.read())).toBe(original);
  await page.getByRole('link',{name:'ChatGPT 연결 관리',exact:true}).click(); await expect(page.getByRole('article',{name:'활성 ChatGPT 연결'})).toBeVisible();
  await page.getByRole('button',{name:'연결 해제',exact:true}).click();
  expect((await mcp(request,token.access_token,'list_saved_advice')).isError).not.toBe(true);
  await page.getByRole('button',{name:'확인하고 연결 해제',exact:true}).click(); await expect(page.getByText(/연결을 해제했습니다/)).toBeVisible();
  const denied=await mcp(request,token.access_token,'list_saved_advice'); expect(denied.isError).toBe(true); expect(denied._meta?.['mcp/www_authenticate']).toBeTruthy();
  await page.reload(); await expect(page.getByText('현재 활성화된 연결이 없습니다.',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'저장한 ChatGPT 조언 보기 →',exact:true}).click(); await expect(card).toBeVisible();
});

test('ChatGPT advice is isolated by owner; missing auth, forged origins and failed reads never look successful',async({page,qa,browser,request})=>{
  await login(page,qa.account); await synced(page);
  const pending=await consent(page); const token=await tokens(request,pending);
  const snap=await mcp(request,token.access_token,'read_record_summary',{area:'assistant'});
  expect((await mcp(request,token.access_token,'save_advice',{request_id:randomUUID(),snapshot_id:snap.structuredContent.snapshot_id,title:'본인 전용 조언',body:'합성 계정의 일정 기록입니다.'})).isError).not.toBe(true);
  const unauthorized=await request.get('/api/chatgpt/advice'); expect(unauthorized.status()).toBe(401);
  const foreignOrigin=await request.post('/api/chatgpt/connection',{headers:{origin:'https://evil.example'},data:{decision:'revoke',id:randomUUID()}}); expect(foreignOrigin.status()).toBe(403);
  const discovery=await request.get('/.well-known/oauth-authorization-server'); expect(discovery.status()).toBe(200); expect((await discovery.json()).issuer).toBe(origin);
  const missing=await mcp(request,'invalid','list_saved_advice'); expect(missing.isError).toBe(true);
  const second=await qa.createAccount(); const secondContext=await browser.newContext(); await qa.traffic.install(secondContext); const secondPage=await secondContext.newPage();
  try {
    await login(secondPage,second,'/assistant/advice'); await expect(secondPage.getByText('아직 저장한 ChatGPT 조언이 없습니다.',{exact:true})).toBeVisible();
    expect((await second.client.from('chatgpt_advice').select('*')).data).toEqual([]);
  } finally {await secondContext.close();}
  await page.goto('/assistant/advice'); await expect(page.getByRole('article',{name:'본인 전용 조언 조언'})).toBeVisible();
  await page.route('**/api/chatgpt/advice?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'합성 조회 장애입니다. 다시 시도해 주세요.'})}));
  await page.reload(); await expect(page.getByRole('main').getByRole('alert')).toContainText('합성 조회 장애');
  await expect(page.getByText('아직 저장한 ChatGPT 조언이 없습니다.',{exact:true})).toHaveCount(0);
  await page.unroute('**/api/chatgpt/advice?*'); await page.getByRole('button',{name:'조언 새로고침',exact:true}).click();
  await expect(page.getByRole('article',{name:'본인 전용 조언 조언'})).toBeVisible();
  await page.getByRole('link',{name:'← 연이',exact:true}).click(); await expect(page.getByRole('link',{name:'ChatGPT 조언 →',exact:true})).toBeVisible();
});

test('ChatGPT token refresh and original-record reset are enforced through real HTTP and the app shows the result',async({page,qa,request})=>{
  await login(page,qa.account); await synced(page); const pending=await consent(page); const token=await tokens(request,pending);
  const response=await request.post('/api/chatgpt/oauth/token',{form:{grant_type:'refresh_token',refresh_token:token.refresh_token,client_id:CHATGPT_CLIENT_ID,resource}});
  expect(response.status()).toBe(200); const next=await response.json();
  const summary=await mcp(request,next.access_token,'read_record_summary',{area:'diet'}); expect(summary.isError).not.toBe(true);
  const result=await mcp(request,next.access_token,'save_advice',{request_id:randomUUID(),snapshot_id:summary.structuredContent.snapshot_id,title:'초기화 대상 조언',body:'식단 기록을 돌아보는 합성 조언입니다.'}); expect(result.isError).not.toBe(true);
  const reset=await qa.account.client.rpc('reset_my_app_records',{p_app:'diet',p_request_id:randomUUID(),p_confirmation:'초기화'}); expect(reset.error).toBeNull();
  expect((await mcp(request,next.access_token,'list_saved_advice')).isError).toBe(true);
  await page.goto('/assistant/advice'); await expect(page.getByText('아직 저장한 ChatGPT 조언이 없습니다.',{exact:true})).toBeVisible();
});
