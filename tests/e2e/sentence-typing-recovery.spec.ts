import { randomUUID } from 'node:crypto';
import type { Dialog, Locator, Page } from '@playwright/test';
import { test, expect, login, synced } from './fixture';
import { RouteDrain } from './route-drain';
import { sentenceTypingDraftKey, type SentenceTypingDraft } from '../../lib/sentence-typing-draft';

const input = (page: Page) => page.getByLabel('입력 칸', { exact: true });
const retry = (page: Page) => page.getByRole('button', { name: '같은 기록 다시 확인', exact: true });
const sentenceRequestPattern = /\/rest\/v1\/(?:growth_sessions(?:\?|$)|rpc\/save_sentence_typing_session(?:\?|$))/;
const saveRpcPath = '/rest/v1/rpc/save_sentence_typing_session';
const checkpoint = (page: Page, owner: string) => page.evaluate(key => localStorage.getItem(key), sentenceTypingDraftKey(owner));
const recovered = async (page: Page, owner: string) => JSON.parse((await checkpoint(page, owner))!) as SentenceTypingDraft;
const noOverflow = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
async function choose(page: Page, button: Locator, accept: boolean) {
  const dialog = page.waitForEvent('dialog'); const clicked = button.click(); const prompt = await dialog;
  expect(prompt.type()).toBe('confirm'); expect(prompt.message()).toContain('저장하지 않은 이번 연습');
  if (accept) await prompt.accept(); else await prompt.dismiss(); await clicked;
}
async function seed(account: Parameters<typeof login>[1]) {
  const routine = { id: randomUUID(), user_id: account.id, category: 'typing', title: '문장 복구 검증 타자', target_minutes: 15, enabled: true };
  expect((await account.client.from('growth_routines').insert(routine)).error).toBeNull();
  const previous = { id: randomUUID(), user_id: account.id, routine_id: routine.id, session_date: '2001-01-02', status: 'partial', planned_minutes: 15, actual_minutes: 1, source: 'typing', memo: '기존 부분 연습 원본', metrics: { marker: 'preserve-original' } };
  const result = await account.client.from('growth_sessions').insert(previous).select('*').single(); expect(result.error).toBeNull();
  return result.data;
}
async function relogin(page: Page, account: Parameters<typeof login>[1]) {
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(account.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'AI 연이 시작', exact: true }).click();
  await expect(page.getByRole('heading', { name: '보고 그대로 입력하세요', exact: true })).toBeVisible();
}

for (const width of [320, 390]) test(`sentence reset cancellation and reload preserve input, passage and timer at ${width}px`, async ({ page, qa }) => {
  const original = await seed(qa.account);
  await page.setViewportSize({ width, height: 844 }); await login(page, qa.account); await synced(page); const before = await qa.read();
  await page.goto('/growth/typing'); await expect(input(page)).toBeEditable();
  let unexpectedPrompts = 0;
  const unexpected = (dialog: Dialog) => { unexpectedPrompts++; void dialog.dismiss(); };
  page.on('dialog', unexpected);
  await page.getByRole('button', { name: '다시 시작', exact: true }).click();
  await page.getByRole('button', { name: '다른 문장', exact: true }).click();
  await expect(page.getByText('연습 문장 2/3', { exact: true })).toBeVisible();
  page.off('dialog', unexpected); expect(unexpectedPrompts).toBe(0);
  await input(page).fill('xx'); const draft = await checkpoint(page, qa.account.id);
  for (const label of ['다시 시작', '다른 문장']) {
    await choose(page, page.getByRole('button', { name: label, exact: true }), false);
    await expect(input(page)).toHaveValue('xx'); await expect(page.getByText('연습 문장 2/3', { exact: true })).toBeVisible();
    expect(await checkpoint(page, qa.account.id)).toBe(draft);
  }
  await page.reload(); await expect(input(page)).toBeEditable(); await expect(input(page)).toHaveValue('xx');
  expect(await checkpoint(page, qa.account.id)).toBe(draft);
  await page.getByRole('button', { name: '진행 기록 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled();
  await expect.poll(() => checkpoint(page, qa.account.id)).toBeNull();
  const rows = (await qa.account.client.from('growth_sessions').select('*')).data!;
  expect(rows).toHaveLength(2); expect(rows.find(row => row.id === original.id)).toEqual(original);
  expect(rows.find(row => row.id !== original.id)).toMatchObject({ status: 'partial', metrics: { passageIndex: 1, characters: 2 } });
  expect(Date.parse(rows.find(row => row.id !== original.id)!.started_at)).toBe(JSON.parse(draft!).startedAt);
  page.on('dialog', unexpected); await page.getByRole('button', { name: '다시 시작', exact: true }).click();
  await expect(input(page)).toBeEditable(); await expect(input(page)).toHaveValue(''); page.off('dialog', unexpected); expect(unexpectedPrompts).toBe(0);
  await expect(input(page)).toBeFocused();
  await input(page).fill('확인 후 초기화'); await choose(page, page.getByRole('button', { name: '다른 문장', exact: true }), true);
  await expect(input(page)).toHaveValue(''); await expect(input(page)).toBeFocused(); await expect(page.getByText('연습 문장 3/3', { exact: true })).toBeVisible();
  expect((await recovered(page, qa.account.id)).startedAt).toBeNull();
  await input(page).fill('다시 시작 확인'); await choose(page, page.getByRole('button', { name: '다시 시작', exact: true }), true);
  await expect(input(page)).toHaveValue(''); expect((await recovered(page, qa.account.id)).startedAt).toBeNull();
  await noOverflow(page); expect(await qa.read()).toEqual(before);
  await page.reload(); await expect(input(page)).toBeEditable();
  expect((await qa.account.client.from('growth_sessions').select('*')).data).toHaveLength(2);
});

for (const committed of [true, false]) test(`unresolved sentence reload reads first and ${committed ? 'recovers committed write without another POST' : 'retries exact payload only after confirmed absence'}`, async ({ page, qa }) => {
  const original = await seed(qa.account);
  await page.setViewportSize({ width: 320, height: 844 }); await login(page, qa.account); await synced(page); const before = await qa.read();
  await page.goto('/growth/typing'); await expect(input(page)).toBeEditable(); await input(page).fill('xx');
  const pattern = sentenceRequestPattern, drain = new RouteDrain();
  const requests: Record<string, unknown>[] = []; const calls: string[] = []; let failReads = true, failPost = true;
  await page.route(pattern, route => drain.run(async () => {
    const request = route.request(), url = new URL(request.url()); const targeted = url.searchParams.has('id');
    if (request.method() === 'POST') {
      expect(new URL(request.url()).pathname).toBe(saveRpcPath);
      const payload = request.postDataJSON(); requests.push(payload); calls.push(`POST:${payload.p_payload.id}`);
      if (committed || !failPost) await route.fetch({ maxRetries: 0 });
      await route.fulfill({ status: failPost ? 503 : 201, contentType: 'application/json', body: failPost ? '{"message":"synthetic lost response"}' : '' });
    } else if (targeted) {
      expect(request.method()).toBe('GET');
      expect(url.pathname).toBe('/rest/v1/growth_sessions');
      expect(url.searchParams.get('user_id')).toBe(`eq.${qa.account.id}`);
      expect(url.searchParams.get('id')).toBe(`eq.${(requests[0].p_payload as { id: string }).id}`);
      const retryCount = request.headers()['x-retry-count'];
      calls.push(retryCount === undefined ? 'GET' : `GET:retry:${retryCount}`);
      if (failReads) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic unavailable confirmation"}' });
      else await route.fallback();
    } else await route.fallback();
  }));
  try {
    await page.getByRole('button', { name: '진행 기록 저장', exact: true }).click(); await expect(retry(page)).toBeEnabled();
    const raw = await checkpoint(page, qa.account.id), pending = (await recovered(page, qa.account.id)).pending!;
    await expect(input(page)).not.toBeEditable();
    for (const name of ['다시 시작', '다른 문장']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    expect(requests).toHaveLength(1);
    await page.reload(); await expect(retry(page)).toBeEnabled(); await expect(input(page)).toHaveValue('xx');
    expect(await checkpoint(page, qa.account.id)).toBe(raw);
    const mark = calls.length; await retry(page).click(); await expect(retry(page)).toBeEnabled();
    // The pinned PostgREST transport retries a single 503 read three times.
    // Distinguish those marked, same-ID attempts from another logical read or
    // a forbidden POST; never hide requests or disable the application's retry.
    console.log('QA_SENTENCE_RECOVERY_TRANSPORT', JSON.stringify({ committed, phase: 'unconfirmed-read',
      attempts: calls.slice(mark).map(call => call.startsWith('POST:') ? 'POST' : call), posts: requests.length }));
    expect(calls.slice(mark)).toEqual(['GET', 'GET:retry:1', 'GET:retry:2', 'GET:retry:3']); expect(requests).toHaveLength(1);
    failReads = false; failPost = false; const confirmedMark = calls.length;
    await retry(page).click(); await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled();
    expect(calls.slice(confirmedMark)).toEqual(committed ? ['GET'] : ['GET', `POST:${pending.id}`, 'GET']);
    expect(requests).toHaveLength(committed ? 1 : 2);
    if (!committed) expect(requests[1]).toEqual(requests[0]);
    const rows = (await qa.account.client.from('growth_sessions').select('*')).data!;
    expect(rows).toHaveLength(2); expect(rows.find(row => row.id === original.id)).toEqual(original);
    const savedRow = rows.find(row => row.id === pending.id)!;
    expect(savedRow).toMatchObject({ user_id: qa.account.id, metrics: pending.metrics });
    expect(Date.parse(savedRow.started_at)).toBe(Date.parse(pending.startedAt));
    expect(Date.parse(savedRow.ended_at)).toBe(Date.parse(pending.endedAt));
    await expect.poll(() => checkpoint(page, qa.account.id)).toBeNull();
    await page.reload(); await expect(input(page)).toBeEditable();
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toHaveLength(2);
    expect(await qa.read()).toEqual(before); await noOverflow(page);
  } finally { await drain.wait(); await page.unroute(pattern); }
});

test('delayed sentence save for A cannot populate B and A recovers the same request without a duplicate', async ({ page, qa }) => {
  const original = await seed(qa.account), other = await qa.createAccount(); await seed(other);
  await login(page, qa.account); await synced(page); const before = await qa.read();
  await page.goto('/growth/typing'); await expect(input(page)).toBeEditable(); await input(page).fill('A 합성 입력');
  const pattern = sentenceRequestPattern, drain = new RouteDrain(); let posts = 0;
  let release!: () => void, arrived!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(pattern, route => drain.run(async () => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    expect(new URL(route.request().url()).pathname).toBe(saveRpcPath);
    posts++; const response = await route.fetch({ maxRetries: 0 }); expect(response.ok()).toBe(true); arrived(); await released; await route.fulfill({ response });
  }));
  try {
    await page.getByRole('button', { name: '진행 기록 저장', exact: true }).click(); await seen;
    const raw = await checkpoint(page, qa.account.id);
    await expect(page.getByRole('button', { name: '다시 시작', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '다른 문장', exact: true })).toBeDisabled();
    await relogin(page, other); release(); await drain.wait();
    await expect(input(page)).toBeEditable(); await expect(input(page)).toHaveValue('');
    await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toHaveCount(0);
    expect(await checkpoint(page, qa.account.id)).toBe(raw);
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toHaveLength(2);
    expect((await other.client.from('growth_sessions').select('*')).data).toHaveLength(1);
    await relogin(page, qa.account); await expect(retry(page)).toBeEnabled(); await expect(input(page)).toHaveValue('A 합성 입력');
    await retry(page).click(); await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled(); expect(posts).toBe(1);
    const rows = (await qa.account.client.from('growth_sessions').select('*')).data!;
    expect(rows).toHaveLength(2); expect(rows.find(row => row.id === original.id)).toEqual(original);
    expect(await qa.read()).toEqual(before);
  } finally { release(); await drain.wait(); await page.unroute(pattern); }
});


test('a different-device reset between marker GET and save RPC cannot revive the old sentence', async ({ page, qa }) => {
  await seed(qa.account); const other = await qa.createAccount(); const otherOriginal = await seed(other);
  await login(page, qa.account); await synced(page); await page.goto('/growth/typing');
  await expect(input(page)).toBeEditable(); await input(page).fill('초기화 경합');
  const pattern = '**/rest/v1/rpc/save_sentence_typing_session', drain = new RouteDrain(); let posts = 0;
  await page.route(pattern, route => drain.run(async () => {
    posts++;
    const reset = await qa.account.client.rpc('reset_my_app_records', { p_app: 'growth', p_request_id: randomUUID(), p_confirmation: '초기화' });
    expect(reset.error).toBeNull();
    const response = await route.fetch({ maxRetries: 0 }); expect(response.ok()).toBe(false); await route.fulfill({ response });
  }));
  try {
    await page.getByRole('button', { name: '진행 기록 저장', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '기록 초기화 이후' })).toBeVisible();
    await expect(input(page)).toHaveValue('초기화 경합'); await expect(input(page)).not.toBeEditable();
    await expect(retry(page)).toBeDisabled(); expect(posts).toBe(1);
    expect((await recovered(page, qa.account.id)).pending).not.toBeNull();
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([]);
    expect((await other.client.from('growth_sessions').select('*')).data).toEqual([otherOriginal]);
    await page.reload(); await expect(input(page)).toBeEditable(); await expect(input(page)).toHaveValue('');
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([]); expect(posts).toBe(1);
  } finally { await drain.wait(); await page.unroute(pattern); }
});

test('missing RPC deployment preserves the pending request until a read-first exact retry is available', async ({ page, qa }) => {
  const original = await seed(qa.account); await login(page, qa.account); await synced(page); const before = await qa.read();
  await page.goto('/growth/typing'); await expect(input(page)).toBeEditable(); await input(page).fill('업데이트 대기');
  const pattern = sentenceRequestPattern, drain = new RouteDrain(); let missing = true;
  const requests: Record<string, unknown>[] = [], calls: string[] = [];
  await page.route(pattern, route => drain.run(async () => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST') {
      expect(url.pathname).toBe(saveRpcPath); requests.push(request.postDataJSON()); calls.push('POST');
      if (missing) await route.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"PGRST202","message":"Could not find the function in the schema cache"}' });
      else await route.fallback();
    } else {
      if (url.searchParams.has('id')) calls.push('GET');
      await route.fallback();
    }
  }));
  try {
    await page.getByRole('button', { name: '진행 기록 저장', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '서버에 반영되지' })).toBeVisible();
    const raw = await checkpoint(page, qa.account.id);
    await expect(input(page)).toHaveValue('업데이트 대기'); await expect(input(page)).not.toBeEditable();
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([original]);
    await page.reload(); await expect(retry(page)).toBeEnabled(); expect(await checkpoint(page, qa.account.id)).toBe(raw);
    missing = false; const mark = calls.length; await retry(page).click();
    await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled();
    expect(calls.slice(mark)).toEqual(['GET', 'POST', 'GET']); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toHaveLength(2); expect(await qa.read()).toEqual(before);
  } finally { await drain.wait(); await page.unroute(pattern); }
});
