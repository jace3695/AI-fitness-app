import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { test, expect, login } from './fixture';

test('disabled Zephyr status stays private; real Postgres serializes a shared allowance across simultaneous users', async ({ page, qa }) => {
  const settings=JSON.parse(readFileSync('.e2e/stack-status.json','utf8'));
  if(settings.API_URL!=='http://127.0.0.1:54321'||process.env.YEONI_E2E!=='1') throw new Error('Only disposable Postgres allowed');
  const admin=createClient(settings.API_URL,settings.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  expect((await page.request.get('/api/tts')).status()).toBe(401);
  const session=await qa.account.client.auth.getSession();
  const headers={Authorization:`Bearer ${session.data.session!.access_token}`};
  const status=await page.request.get('/api/tts',{headers}); expect(status.status()).toBe(200);
  expect(status.headers()['cache-control']).toBe('no-store');
  const policy=await status.json(); expect(policy).toMatchObject({enabled:false,voice:'ko-KR-Chirp3-HD-Zephyr',useDeviceVoice:false});
  expect(policy.reservedCharacters).toBeUndefined(); // Unknown usage is not zero.
  const now=new Date();
  const month=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit'}).format(now)+'-01';
  const fingerprint=createHash('sha256').update('isolated-ci-key').digest('hex');
  const configured=await admin.from('zephyr_free_months').upsert({month,enabled:true,key_fingerprint:fingerprint,billing_project_id:'isolated',billing_account_id:'isolated',verified_at:now.toISOString(),valid_until:new Date(now.getTime()+300_000).toISOString(),external_used_chars:61,external_reserved_chars:100000,app_limit_chars:2000,reserved_chars:0});
  expect(configured.error).toBeNull();
  const other=await qa.createAccount();
  const args=[qa.account,other].map(account=>({p_user_id:account.id,p_request_id:randomUUID(),p_text:'가'.repeat(1200),p_key_fingerprint:fingerprint}));
  // Two distinct HTTP requests run in separate Postgres transactions.
  const results=await Promise.all(args.map(params=>admin.rpc('reserve_zephyr_characters',params)));
  expect(results.every(result=>!result.error)).toBe(true);
  expect(results.filter(result=>result.data.allowed)).toHaveLength(1);
  expect(results.filter(result=>result.data.code==='MONTH_LIMIT')).toHaveLength(1);
  const granted=results.findIndex(result=>result.data.allowed);
  const retries=await Promise.all(Array.from({length:12},()=>admin.rpc('reserve_zephyr_characters',args[granted])));
  expect(retries.every(result=>!result.error&&result.data.code==='DUPLICATE_REQUEST')).toBe(true);
  const count=await admin.from('zephyr_free_months').select('reserved_chars').eq('month',month).single();
  expect(count.error).toBeNull();expect(count.data?.reserved_chars).toBe(1200);
  expect((await qa.account.client.rpc('reserve_zephyr_characters',args[0])).error).not.toBeNull();
  expect((await qa.account.client.from('zephyr_free_months').select('*')).error).not.toBeNull();
  const readonly=await admin.rpc('zephyr_free_status',{p_key_fingerprint:fingerprint});
  expect(readonly.data).toMatchObject({reservedCharacters:1200,remainingCharacters:800,limitCharacters:2000});
  // DB approval alone cannot enable the Next route or an external provider.
  const blocked=await page.request.post('/api/tts',{headers,data:{text:'합성 검증',requestId:randomUUID()}});
  expect(blocked.status()).toBe(503); expect((await blocked.json()).code).toBe('PAID_AI_DISABLED');
  expect((await admin.from('zephyr_free_months').update({enabled:false}).eq('month',month)).error).toBeNull();
  await page.setViewportSize({width:320,height:844}); await login(page,qa.account);
  await page.goto('/assistant/quick?autorun=0&command='+encodeURIComponent('오늘 운동 계획 보여줘'));
  await page.getByRole('button',{name:'명령 실행',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('운동');
  await page.reload(); await expect(page.getByText('Zephyr 음성 · 확인 대기',{exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  // Reservation receipts intentionally survive account deletion; the disposable
  // stack's final stop removes these synthetic receipts and counters together.
});
