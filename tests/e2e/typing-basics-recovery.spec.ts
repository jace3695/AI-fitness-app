import { randomUUID } from 'node:crypto';
import type { Frame, Locator, Page, Request, Response } from '@playwright/test';
import { test, expect, login, synced } from './fixture';
import { RouteDrain } from './route-drain';
import { TYPING_LESSONS } from '../../app/data/typingBasics';
import { typingBasicsDraftKey, type TypingBasicsDraft } from '../../lib/typing-basics-draft';

const pad = (page: Page) => page.getByRole('button', { name: '키보드 자리 연습 입력', exact: true });
const retry = (page: Page) => page.getByRole('button', { name: '같은 기록 다시 확인', exact: true });
const save = (page: Page) => page.getByRole('button', { name: '자리 연습 저장', exact: true });
const checkOne = (page: Page) => page.getByLabel('안내된 손가락으로 누르고 기본 자리로 돌아왔어요.', { exact: true });
const checkTwo = (page: Page) => page.getByLabel('키를 세게 내리치지 않고 손의 힘을 빼 보았어요.', { exact: true });
const pattern = /\/rest\/v1\/(?:growth_sessions(?:\?|$)|rpc\/save_sentence_typing_session(?:\?|$))/;
const checkpoint = (page: Page, owner: string) => page.evaluate(key => localStorage.getItem(key), typingBasicsDraftKey(owner));
const recovered = async (page: Page, owner: string) => JSON.parse((await checkpoint(page, owner))!) as TypingBasicsDraft;
async function type(page: Page, keys: string) { await pad(page).click(); for (const char of keys) await page.keyboard.press(char === ' ' ? 'Space' : char); }
async function finish(page: Page) { await type(page, TYPING_LESSONS[0].keys); await checkOne(page).check(); await checkTwo(page).check(); }
async function choose(page: Page, button: Locator, accept: boolean) {
  const dialog = page.waitForEvent('dialog'), clicked = button.click(), prompt = await dialog;
  expect(prompt.type()).toBe('confirm'); expect(prompt.message()).toContain('저장하지 않은 이번 연습');
  if (accept) await prompt.accept(); else await prompt.dismiss(); await clicked;
}
async function seed(account: Parameters<typeof login>[1]) {
  const routine = { id: randomUUID(), user_id: account.id, category: 'typing', title: '자리 복구 검증', target_minutes: 5, enabled: true };
  expect((await account.client.from('growth_routines').insert(routine)).error).toBeNull();
  const original = await account.client.from('growth_sessions').insert({ id: randomUUID(), user_id: account.id, routine_id: routine.id,
    session_date: '2001-01-02', status: 'partial', planned_minutes: 5, actual_minutes: 1, source: 'typing', memo: '기존 부분 연습 원본', metrics: { marker: 'preserve-original' } }).select('*').single();
  expect(original.error).toBeNull(); return original.data;
}
async function open(page: Page, account: Parameters<typeof login>[1]) { await login(page, account); await synced(page); await page.goto('/growth/typing/basics'); await expect(pad(page)).toBeEnabled(); }
async function relogin(page: Page, account: Parameters<typeof login>[1]) {
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(account.email); await page.getByLabel('비밀번호', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'AI 연이 시작', exact: true }).click();
  await expect(page.getByRole('heading', { name: '빠르게 치기 전에, 편한 자리부터', exact: true })).toBeVisible();
}
for (const width of [320, 390]) test(`basics lesson, mistakes, timer and self-checks survive reload; discard cancellation preserves all at ${width}px`, async ({ page, qa }) => {
  const original = await seed(qa.account); await page.setViewportSize({ width, height: 844 }); await open(page, qa.account); const before = await qa.read();
  await page.getByText('전체 단계 보기', { exact: true }).click(); await page.getByRole('button', { name: '2. 중지 자리', exact: true }).click();
  await type(page, 'ad'); const partial = await checkpoint(page, qa.account.id);
  await expect(page.getByText('다시 익힐 자리: D 1회', { exact: true })).toBeVisible();
  await choose(page, page.getByRole('button', { name: '같은 자리 다시 연습', exact: true }), false);
  await choose(page, page.getByRole('button', { name: '1. 검지의 집 찾기', exact: true }), false);
  expect(await checkpoint(page, qa.account.id)).toBe(partial);
  await page.reload(); await expect(pad(page)).toBeEnabled(); await expect(page.getByRole('heading', { name: '2강 · 중지 자리', exact: true })).toBeVisible();
  expect(await checkpoint(page, qa.account.id)).toBe(partial);
  await type(page, TYPING_LESSONS[1].keys.slice(1)); await checkOne(page).check(); const finished = await recovered(page, qa.account.id);
  await page.reload(); await expect(checkOne(page)).toBeChecked(); await expect(checkTwo(page)).not.toBeChecked(); await expect(save(page)).toBeDisabled();
  expect(await recovered(page, qa.account.id)).toEqual(finished); await checkTwo(page).check(); await save(page).click();
  await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled(); await expect.poll(() => checkpoint(page, qa.account.id)).toBeNull();
  const rows = (await qa.account.client.from('growth_sessions').select('*')).data!;
  expect(rows).toHaveLength(2); expect(rows.find(row => row.id === original.id)).toEqual(original);
  const saved = rows.find(row => row.id !== original.id)!;
  expect(saved.metrics).toMatchObject({ lessonId: 'middle', keyPresses: 13, correctKeyPresses: 12, mistakeKeys: { d: 1 }, selfChecks: [true, true] });
  expect(Date.parse(saved.started_at)).toBe(finished.startedAt); expect(Date.parse(saved.ended_at)).toBe(finished.endedAt);
  await page.getByRole('button', { name: '같은 자리 다시 연습', exact: true }).click(); await type(page, 'd');
  await choose(page, page.getByRole('button', { name: '같은 자리 다시 연습', exact: true }), true);
  expect((await recovered(page, qa.account.id)).attempt.attempts).toBe(0);
  expect((await recovered(page, qa.account.id)).startedAt).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await qa.read()).toEqual(before);
});
for (const committed of [true, false]) test(`unresolved basics reload reads first and ${committed ? 'recovers one row' : 'retries identical frozen payload after absence'}`, async ({ page, qa }) => {
  const original = await seed(qa.account); await open(page, qa.account); const before = await qa.read(); await finish(page);
  const drain = new RouteDrain(), requests: Record<string, unknown>[] = [], calls: string[] = []; let failReads = true, failPost = true;
  await page.route(pattern, route => drain.run(async () => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST') {
      expect(url.pathname).toBe('/rest/v1/rpc/save_sentence_typing_session'); const payload = request.postDataJSON(); requests.push(payload); calls.push(`POST:${payload.p_payload.id}`);
      if (committed || !failPost) await route.fetch({ maxRetries: 0 });
      await route.fulfill({ status: failPost ? 503 : 201, contentType: 'application/json', body: failPost ? '{"message":"synthetic lost response"}' : '' });
    } else if (url.searchParams.has('id')) {
      expect(request.method()).toBe('GET');
      expect(url.pathname).toBe('/rest/v1/growth_sessions');
      expect(url.searchParams.get('user_id')).toBe(`eq.${qa.account.id}`);
      expect(url.searchParams.get('id')).toBe(`eq.${(requests[0].p_payload as { id: string }).id}`);
      const retryCount = request.headers()['x-retry-count'];
      calls.push(retryCount === undefined ? 'GET' : `GET:retry:${retryCount}`);
      if (failReads) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic read failure"}' }); else await route.fallback();
    } else await route.fallback();
  }));
  try {
    await save(page).click(); await expect(retry(page)).toBeEnabled(); const raw = await checkpoint(page, qa.account.id), pending = (await recovered(page, qa.account.id)).pending!;
    await expect(pad(page)).toBeDisabled(); await expect(checkOne(page)).toBeDisabled(); await expect(page.getByRole('button', { name: '같은 자리 다시 연습', exact: true })).toBeDisabled();
    await page.reload(); await expect(retry(page)).toBeEnabled(); expect(await checkpoint(page, qa.account.id)).toBe(raw);
    const mark = calls.length; await retry(page).click(); await expect(retry(page)).toBeEnabled();
    // One logical read retains the SDK's default three 503 retries. Require
    // every same-ID attempt and its retry header; another read or POST fails.
    console.log('QA_BASICS_RECOVERY_TRANSPORT', JSON.stringify({ committed, phase: 'unconfirmed-read',
      attempts: calls.slice(mark).map(call => call.startsWith('POST:') ? 'POST' : call), posts: requests.length }));
    expect(calls.slice(mark)).toEqual(['GET', 'GET:retry:1', 'GET:retry:2', 'GET:retry:3']); expect(requests).toHaveLength(1);
    failReads = false; failPost = false; const recoveryMark = calls.length; await retry(page).click(); await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled();
    expect(calls.slice(recoveryMark)).toEqual(committed ? ['GET'] : ['GET', `POST:${pending.id}`, 'GET']);
    expect(requests).toHaveLength(committed ? 1 : 2); if (!committed) expect(requests[1]).toEqual(requests[0]);
    const rows = (await qa.account.client.from('growth_sessions').select('*')).data!; expect(rows).toHaveLength(2); expect(rows.find(row => row.id === original.id)).toEqual(original);
    expect(rows.find(row => row.id === pending.id)?.metrics).toEqual(pending.metrics);
    await expect.poll(() => checkpoint(page, qa.account.id)).toBeNull(); await page.reload(); await expect(pad(page)).toBeEnabled();
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toHaveLength(2); expect(await qa.read()).toEqual(before);
  } finally { await drain.wait(); await page.unroute(pattern); }
});
test('delayed A basics save leaves its checkpoint when account B opens and A recovers without duplicate', async ({ page, qa }) => {
  const original = await seed(qa.account), other = await qa.createAccount(), otherOriginal = await seed(other); await open(page, qa.account); await finish(page);
  const drain = new RouteDrain(); let posts = 0, release!: () => void, arrived!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(pattern, route => drain.run(async () => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    posts++; const response = await route.fetch({ maxRetries: 0 }); expect(response.ok()).toBe(true); arrived(); await released; await route.fulfill({ response });
  }));
  try {
    await save(page).click(); await seen; const raw = await checkpoint(page, qa.account.id);
    await relogin(page, other); release(); await drain.wait(); await expect(pad(page)).toBeEnabled();
    await expect(page.getByLabel('다음 키 안내')).toContainText('1 / 12'); expect(await checkpoint(page, qa.account.id)).toBe(raw);
    expect((await other.client.from('growth_sessions').select('*')).data).toEqual([otherOriginal]);
    await relogin(page, qa.account); await expect(retry(page)).toBeEnabled(); await retry(page).click(); await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled();
    expect(posts).toBe(1); const rows = (await qa.account.client.from('growth_sessions').select('*')).data!; expect(rows).toHaveLength(2); expect(rows.find(row => row.id === original.id)).toEqual(original);
  } finally { release(); await drain.wait(); await page.unroute(pattern); }
});
type BasicsResetPhase = 'armed' | 'before-save' | 'save-clicked' | 'marker-get-confirmed' | 'reset-confirmed' | 'rpc-rejected'
  | 'rejection-visible' | 'pending-preserved' | 'records-empty' | 'before-reload' | 'after-reload' | 'ready-after-reload' | 'complete' | 'failure';
/** Passive Node-side milestones survive a stalled renderer without evaluating it.
 * No URLs, request bodies, auth headers, owner IDs, markers or DOM text are logged. */
function observeBasicsResetBoundary(page: Page) {
  let phase: BasicsResetPhase = 'armed', emittedEvents = 0;
  const counts = { documentRequests: 0, documentResponses: 0, frameNavigations: 0, domContentLoads: 0, pageLoads: 0,
    authRequests: 0, markerRequests: 0, progressRequests: 0, authResponses: 0, markerResponses: 0, progressResponses: 0, droppedEvents: 0 };
  const emit = (event: string) => console.log('QA_BASICS_RESET_BOUNDARY ' + JSON.stringify({ phase, event, ...counts }));
  const event = (name: string, key: keyof typeof counts) => {
    counts[key] = Math.min(10000, counts[key] + 1);
    if (emittedEvents++ < 64) emit(name);
    else counts.droppedEvents = Math.min(10000, counts.droppedEvents + 1);
  };
  const isBasicsDocument = (request: Request) => {
    try { const url = new URL(request.url()); return request.isNavigationRequest() && request.resourceType() === 'document'
      && url.origin === 'http://127.0.0.1:3000' && url.pathname === '/growth/typing/basics'; } catch { return false; }
  };
  const request = (request: Request) => {
    if (isBasicsDocument(request)) { event('document-request', 'documentRequests'); return; }
    try {
      const url = new URL(request.url());
      if (url.origin !== 'http://127.0.0.1:54321' || request.method() !== 'GET') return;
      if (url.pathname === '/auth/v1/user') event('auth-request', 'authRequests');
      if (url.pathname === '/rest/v1/user_app_state') event('marker-request', 'markerRequests');
      if (url.pathname === '/rest/v1/growth_sessions') event('progress-request', 'progressRequests');
    } catch { /* Malformed/unrelated URLs have no diagnostic content. */ }
  };
  const response = (response: Response) => {
    const request = response.request();
    if (isBasicsDocument(request)) { event('document-response', 'documentResponses'); return; }
    try {
      const url = new URL(request.url());
      if (url.origin !== 'http://127.0.0.1:54321' || request.method() !== 'GET') return;
      if (url.pathname === '/auth/v1/user') event('auth-response', 'authResponses');
      if (url.pathname === '/rest/v1/user_app_state') event('marker-response', 'markerResponses');
      if (url.pathname === '/rest/v1/growth_sessions') event('progress-response', 'progressResponses');
    } catch { /* Malformed/unrelated URLs have no diagnostic content. */ }
  };
  const frame = (frame: Frame) => { if (frame === page.mainFrame()) event('frame-navigated', 'frameNavigations'); };
  const dom = () => event('dom-content-loaded', 'domContentLoads');
  const load = () => event('load', 'pageLoads');
  page.on('request', request); page.on('response', response); page.on('framenavigated', frame); page.on('domcontentloaded', dom); page.on('load', load);
  return {
    mark(next: BasicsResetPhase) { phase = next; emit('milestone'); },
    stop() { page.off('request', request); page.off('response', response); page.off('framenavigated', frame); page.off('domcontentloaded', dom); page.off('load', load); },
  };
}

test('different-device reset between marker GET and basics RPC cannot resurrect an old lesson', async ({ page, qa }) => {
  await seed(qa.account); const other = await qa.createAccount(), otherOriginal = await seed(other); await open(page, qa.account); await finish(page);
  const before = await qa.read(), otherBefore = await qa.read(other), initial = await recovered(page, qa.account.id);
  const markerKey = 'ai-fitness-record-reset-growth', trafficStart = qa.traffic.entries.length;
  const boundary = observeBasicsResetBoundary(page), rpc = '**/rest/v1/rpc/save_sentence_typing_session', drain = new RouteDrain();
  let posts = 0, resetMarker: string | undefined;
  await page.route(rpc, route => drain.run(async () => {
    const request = route.request(), payload = request.postDataJSON();
    expect(request.method()).toBe('POST'); expect(payload.p_expected_owner).toBe(qa.account.id); expect(payload.p_payload.user_id).toBe(qa.account.id);
    posts++;
    // This is the browser's real authenticated, delivered GET after Save, not a
    // fixture read or a synthetic marker response. Reset only after proving it.
    const markerRead = qa.traffic.entries.slice(trafficStart).filter(entry => entry.table === 'user_app_state' && entry.method === 'GET'
      && entry.owner === qa.account.id && entry.status === 200 && entry.delivered && !entry.synthetic).at(-1);
    expect(markerRead).toBeDefined();
    expect(payload.p_expected_reset_marker).toBe(initial.resetMarker);
    expect(payload.p_expected_reset_marker).toBe(markerRead?.receivedState?.[markerKey] ?? null);
    boundary.mark('marker-get-confirmed');
    const requestId = randomUUID();
    const reset = await qa.account.client.rpc('reset_my_app_records', { p_app: 'growth', p_request_id: requestId, p_confirmation: '초기화' });
    expect(reset.error).toBeNull(); expect(reset.data).toMatchObject({ app: 'growth', user_id: qa.account.id, marker: expect.any(String) });
    resetMarker = reset.data.marker; expect(resetMarker).not.toBe(payload.p_expected_reset_marker); expect(resetMarker!.split('|')[1]).toBe(requestId);
    boundary.mark('reset-confirmed');
    const response = await route.fetch({ maxRetries: 0 }); expect(response.ok()).toBe(false);
    expect(await response.json()).toMatchObject({ code: '40001', message: 'typing_reset_changed' });
    boundary.mark('rpc-rejected'); await route.fulfill({ response });
  }));
  try {
    boundary.mark('before-save'); await save(page).click(); boundary.mark('save-clicked');
    await expect(page.getByRole('status').filter({ hasText: '기록 초기화 이후' })).toBeVisible(); await expect(retry(page)).toBeDisabled(); boundary.mark('rejection-visible');
    expect((await recovered(page, qa.account.id)).pending).not.toBeNull(); boundary.mark('pending-preserved');
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([]); boundary.mark('records-empty');
    boundary.mark('before-reload'); await page.reload(); boundary.mark('after-reload');
    await expect(pad(page)).toBeEnabled(); boundary.mark('ready-after-reload'); await expect(page.getByLabel('다음 키 안내')).toContainText('1 / 12');
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([]); expect(posts).toBe(1);
    expect((await other.client.from('growth_sessions').select('*')).data).toEqual([otherOriginal]);
    expect(await qa.read()).toEqual({ ...before, [markerKey]: resetMarker }); expect(await qa.read(other)).toEqual(otherBefore);
    boundary.mark('complete');
  } catch (error) { boundary.mark('failure'); throw error; }
  finally { boundary.stop(); await drain.wait(); await page.unroute(rpc); }
});
test('missing basics RPC preserves immutable pending request until an exact read-first retry', async ({ page, qa }) => {
  const original = await seed(qa.account); await open(page, qa.account); await finish(page);
  const drain = new RouteDrain(), requests: Record<string, unknown>[] = [], calls: string[] = []; let missing = true;
  await page.route(pattern, route => drain.run(async () => {
    const request = route.request();
    if (request.method() === 'POST') {
      requests.push(request.postDataJSON()); calls.push('POST');
      if (missing) await route.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"PGRST202","message":"missing function"}' }); else await route.fallback();
    } else { if (new URL(request.url()).searchParams.has('id')) calls.push('GET'); await route.fallback(); }
  }));
  try {
    await save(page).click(); await expect(page.getByRole('status').filter({ hasText: '서버에 반영되지' })).toBeVisible(); const raw = await checkpoint(page, qa.account.id);
    await page.reload(); await expect(retry(page)).toBeEnabled(); expect(await checkpoint(page, qa.account.id)).toBe(raw);
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([original]); missing = false; const mark = calls.length;
    await retry(page).click(); await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled();
    expect(calls.slice(mark)).toEqual(['GET', 'POST', 'GET']); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
    expect((await qa.account.client.from('growth_sessions').select('*')).data).toHaveLength(2);
  } finally { await drain.wait(); await page.unroute(pattern); }
});
test('two basics tabs retain the newer owner checkpoint rather than overwriting it from the stale tab', async ({ page, qa }) => {
  await seed(qa.account); await open(page, qa.account); await type(page, 'f');
  const other = await page.context().newPage();
  try {
    await other.goto('/growth/typing/basics'); await expect(pad(other)).toBeEnabled(); await type(other, 'j'); const raw = await checkpoint(other, qa.account.id);
    await expect(page.getByRole('status').filter({ hasText: '다른 창에서' })).toBeVisible(); await expect(pad(page)).toBeDisabled();
    await page.getByRole('button', { name: '기기 임시 저장 다시 시도', exact: true }).click(); expect(await checkpoint(page, qa.account.id)).toBe(raw);
    expect((await recovered(other, qa.account.id)).attempt.position).toBe(2);
  } finally { await other.close(); }
});
test('basics quota failure keeps the visible key attempt and blocks cloud save until checkpoint recovery', async ({ page, qa }) => {
  const original = await seed(qa.account); await open(page, qa.account);
  await page.evaluate(key => {
    const originalSetItem = Storage.prototype.setItem;
    (window as unknown as { restoreTypingStorage: () => void }).restoreTypingStorage = () => { Storage.prototype.setItem = originalSetItem; };
    Storage.prototype.setItem = function(name: string, value: string) {
      if (name === key) throw new DOMException('synthetic quota', 'QuotaExceededError');
      originalSetItem.call(this, name, value);
    };
  }, typingBasicsDraftKey(qa.account.id));
  await type(page, 'a'); await expect(page.getByText('다시 익힐 자리: F 1회', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '이 기기에 입력을 보관하지 못했어요' })).toBeVisible(); await expect(pad(page)).toBeDisabled();
  expect(await checkpoint(page, qa.account.id)).toBeNull(); expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([original]);
  await page.evaluate(() => (window as unknown as { restoreTypingStorage: () => void }).restoreTypingStorage());
  await page.getByRole('button', { name: '기기 임시 저장 다시 시도', exact: true }).click(); await expect(pad(page)).toBeEnabled();
  expect((await recovered(page, qa.account.id)).attempt).toEqual({ attempts: 1, position: 0, mistakes: { f: 1 } });
  await finish(page); await save(page).click(); await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled();
  expect((await qa.account.client.from('growth_sessions').select('*')).data).toHaveLength(2);
});
