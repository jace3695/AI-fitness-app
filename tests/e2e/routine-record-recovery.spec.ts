import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, login, today } from './fixture';
import { RouteDrain } from './route-drain';
import { reauthenticateFixtureAccount } from './fixture-account-auth';
import { routineDraftKey, routineRowMatches, type RoutineDraft } from '../../lib/routine-record-recovery';

const rpcPath = '/rest/v1/rpc/save_routine_session';
const pattern = /\/rest\/v1\/(?:growth_sessions(?:\?|$)|rpc\/save_routine_session(?:\?|$))/;
const retry = (page: Page) => page.getByRole('button', { name: '같은 기록 다시 확인', exact: true });
const recovery = (page: Page) => page.getByRole('region', { name: '루틴 기록 복구' });
const checkpoint = (page: Page, owner: string) => page.evaluate(key => localStorage.getItem(key), routineDraftKey(owner));
const draft = async (page: Page, owner: string) => JSON.parse((await checkpoint(page, owner))!) as RoutineDraft;
const manualForm = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: '날짜를 골라 기록하기', exact: true }) });
const noOverflow = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
async function seed(account: Parameters<typeof login>[1]) {
  const routine = { id: randomUUID(), user_id: account.id, category: 'custom', title: '일반 루틴 합성 복구', target_minutes: 15, enabled: true, preferred_days: [1,2,3,4,5,6,7], target_sessions_per_week: 7 };
  expect((await account.client.from('growth_routines').insert(routine)).error).toBeNull();
  const old = await account.client.from('growth_sessions').insert({ id: randomUUID(), user_id: account.id, routine_id: routine.id, session_date: '2001-01-02', status: 'partial', actual_minutes: 4, memo: 'unchanged original', metrics: { opaque: true } }).select('*').single();
  expect(old.error).toBeNull(); return { routine, original: old.data };
}
async function open(page: Page, account: Parameters<typeof login>[1]) {
  await login(page, account); await page.goto('/growth'); await expect(page.getByRole('button', { name: '지난 기록 추가', exact: true })).toBeEnabled();
}
async function enterManual(page: Page, id: string) {
  await page.getByRole('button', { name: '지난 기록 추가', exact: true }).click();
  await manualForm(page).getByRole('combobox').first().selectOption(id);
  await page.getByLabel('실행 시간', { exact: true }).fill('17');
  await page.getByLabel('지난 기록 완료 후 난이도', { exact: true }).selectOption('too_easy');
  await manualForm(page).getByPlaceholder('메모(선택)').fill('합성 메모');
}
async function start(page: Page, title: string) {
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await card.getByRole('button', { name: '시작', exact: true }).click();
  await page.getByPlaceholder('지금 느낀 점이나 다음에 할 일을 적어두세요').fill('합성 실행');
  await page.getByLabel('완료 후 난이도 (선택)', { exact: true }).selectOption('appropriate');
}
for (const width of [320, 390]) test(`routine raw forms and active timer survive reload at ${width}px`, async ({ page, qa }) => {
  const { routine, original } = await seed(qa.account); await page.setViewportSize({ width, height: 844 }); await open(page, qa.account);
  await enterManual(page, routine.id); await page.getByLabel('실행 시간', { exact: true }).fill('');
  await page.getByLabel('실행 상태', { exact: true }).selectOption('stopped'); await page.getByLabel('지난 기록 중단 이유', { exact: true }).selectOption('interrupted');
  await start(page, routine.title); await expect.poll(async () => (await draft(page, qa.account.id)).active.memo).toBe('합성 실행');
  const before = await draft(page, qa.account.id); await page.reload();
  await expect(page.getByLabel('실행 시간', { exact: true })).toHaveValue(''); await expect(page.getByLabel('지난 기록 중단 이유', { exact: true })).toHaveValue('interrupted');
  await expect(page.getByPlaceholder('지금 느낀 점이나 다음에 할 일을 적어두세요')).toHaveValue('합성 실행');
  expect((await draft(page, qa.account.id)).active.startedAt).toBe(before.active.startedAt);
  expect((await qa.account.client.from('growth_sessions').select('*').eq('id', original.id).single()).data).toEqual(original); await noOverflow(page);
});
for (const mode of ['active','manual','quick'] as const) for (const committed of [true, false]) test(`${mode} response loss and reload ${committed ? 'confirm one row' : 'retry exact absent request'}`, async ({ page, qa }) => {
  const { routine, original } = await seed(qa.account); await open(page, qa.account);
  if (mode === 'manual') await enterManual(page, routine.id); if (mode === 'active') await start(page, routine.title);
  const drain = new RouteDrain(), requests: Record<string, unknown>[] = [], calls: string[] = [];
  let phase: 'lost-response' | 'reload' | 'unknown-retry' | 'confirm-retry' | 'verify-row' | 'complete' = 'lost-response';
  let failPost = true, failRead = true;
  await page.route(pattern, route => drain.run(async () => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST') {
      expect(url.pathname).toBe(rpcPath); const payload = request.postDataJSON(); requests.push(payload); calls.push('POST');
      if (committed || !failPost) { const response = await route.fetch({ maxRetries: 0 }); expect(response.ok()).toBe(true); }
      await route.fulfill({ status: failPost ? 503 : 204, contentType: 'application/json', body: failPost ? '{"message":"synthetic lost response"}' : '' });
    } else if (url.searchParams.has('id')) {
      expect(url.searchParams.get('user_id')).toBe(`eq.${qa.account.id}`);
      if (requests.length) expect(url.searchParams.get('id')).toBe(`eq.${(requests[0].p_payload as { id: string }).id}`);
      const retryCount = request.headers()['x-retry-count'];
      calls.push(retryCount === undefined ? 'GET' : `GET:retry:${retryCount}`);
      if (requests.length && failRead) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic unknown read"}' }); else await route.fallback();
    } else await route.fallback();
  }));
  try {
    await page.getByRole('button', { name: mode === 'active' ? '완료 저장' : mode === 'manual' ? '기록 저장' : `${routine.title} 빠른 완료`, exact: true }).click();
    await expect(recovery(page)).toContainText('저장 결과를 확인하지 못했어요'); await expect(retry(page)).toBeEnabled(); expect(requests).toHaveLength(1);
    const frozen = (await draft(page, qa.account.id)).pending!; phase = 'reload'; await page.reload(); await expect(retry(page)).toBeEnabled();
    phase = 'unknown-retry'; const mark = calls.length; await retry(page).click(); await expect(recovery(page)).toContainText('저장 결과를 확인하지 못했어요'); await expect(retry(page)).toBeEnabled();
    expect(requests).toHaveLength(1); expect(calls.slice(mark)).toEqual(['GET', 'GET:retry:1', 'GET:retry:2', 'GET:retry:3']);
    phase = 'confirm-retry'; failRead = false; failPost = false; const confirmedMark = calls.length; await retry(page).click(); await expect(recovery(page)).toContainText('기록을 클라우드에서 확인했어요');
    expect(calls.slice(confirmedMark)).toEqual(committed ? ['GET'] : ['GET', 'POST', 'GET']);
    expect(requests).toHaveLength(committed ? 1 : 2); if (!committed) expect(requests[1]).toEqual(requests[0]);
    phase = 'verify-row'; const rows = (await qa.account.client.from('growth_sessions').select('*').eq('routine_id', routine.id)).data!;
    expect(rows).toHaveLength(2); expect(rows.find(row => row.id === original.id)).toEqual(original);
    const row = rows.find(row => row.id === frozen.payload.id)!;
    expect(routineRowMatches(row, frozen.payload)).toBe(true);
    const terminal = await draft(page, qa.account.id); expect(terminal.pending).toBeNull(); expect(terminal.lastConfirmed).toBe(frozen.payload.id);
    if (mode === 'quick') { await expect(page.getByText('시간 미기록 포함 · 비교 보류', { exact: true })).toHaveCount(2); expect(row.actual_minutes).toBe(0); expect(row.metrics.actualMinutesRecorded).toBe(false); }
    phase = 'complete';
  } finally {
    // Fixed enums and counts only. Preserve route/assertion failures while
    // showing whether a transport rejection preceded or followed row checks.
    console.log('QA_ROUTINE_RECOVERY_PHASE', JSON.stringify({ mode, committed, phase, posts: requests.length, calls: calls.length }));
    await drain.wait(); await page.unroute(pattern);
  }
});
test('newer manual edits survive a delayed save while pending delete and quick cancel remain blocked', async ({ page, qa }) => {
  const { routine } = await seed(qa.account); await open(page, qa.account); await enterManual(page, routine.id);
  const drain = new RouteDrain(); let release!: () => void, arrived!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(`**${rpcPath}`, route => drain.run(async () => { const response = await route.fetch({ maxRetries: 0 }); expect(response.ok()).toBe(true); arrived(); await held; await route.fulfill({ response }); }));
  try {
    await page.getByRole('button', { name: '기록 저장', exact: true }).click(); await seen;
    await manualForm(page).getByPlaceholder('메모(선택)').fill('더 새로운 입력'); await page.getByLabel('실행 시간', { exact: true }).fill('23');
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await expect(page.getByRole('button', { name: '기록 삭제', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '기록 삭제', exact: true }).first()).toBeDisabled();
    // Refresh moves the committed routine out of the priority list into this
    // closed disclosure, even while its save response remains held.
    await page.locator('summary').filter({ hasText: /^나머지 예정·완료 루틴 1개$/ }).click();
    await expect(page.getByRole('button', { name: `${routine.title} 완료 취소`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `${routine.title} 완료 취소`, exact: true })).toBeDisabled();
    release(); await expect(recovery(page)).toContainText('기록을 클라우드에서 확인했어요'); await page.reload();
    await expect(manualForm(page).getByPlaceholder('메모(선택)')).toHaveValue('더 새로운 입력'); await expect(page.getByLabel('실행 시간', { exact: true })).toHaveValue('23');
    const rows = (await qa.account.client.from('growth_sessions').select('*').eq('routine_id', routine.id).eq('session_date', today())).data!;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ memo: '합성 메모', actual_minutes: 17 });
  } finally { release(); await drain.wait(); await page.unroute(`**${rpcPath}`); }
});
test('two tabs preserve newer raw input and a stale tab cannot create a second row', async ({ page, qa, context }) => {
  const { routine } = await seed(qa.account); await open(page, qa.account); await enterManual(page, routine.id);
  await expect.poll(async () => (await draft(page, qa.account.id)).manual.memo).toBe('합성 메모');
  const second = await context.newPage(); await second.goto('/growth'); await expect(manualForm(second)).toBeVisible();
  await manualForm(page).getByPlaceholder('메모(선택)').fill('새 탭보다 최신 입력');
  await expect(recovery(second)).toContainText('다른 창의 입력'); await expect(second.getByRole('button', { name: '기록 저장', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '기록 저장', exact: true }).click(); await expect(recovery(page)).toContainText('기록을 클라우드에서 확인했어요');
  await second.getByRole('button', { name: '기기 임시 저장 다시 시도', exact: true }).click();
  expect((await qa.account.client.from('growth_sessions').select('id').eq('routine_id', routine.id).eq('session_date', today())).data).toHaveLength(1); await second.close();
});
test('different-device reset between marker check and save RPC rejects stale routine replay', async ({ page, qa }) => {
  const { routine } = await seed(qa.account); await open(page, qa.account); await enterManual(page, routine.id);
  const drain = new RouteDrain(); await page.route(`**${rpcPath}`, route => drain.run(async () => {
    expect((await qa.account.client.rpc('reset_my_app_records', { p_app: 'growth', p_request_id: randomUUID(), p_confirmation: '초기화' })).error).toBeNull();
    const response = await route.fetch({ maxRetries: 0 }); expect(response.ok()).toBe(false); await route.fulfill({ response });
  }));
  try {
    await page.getByRole('button', { name: '기록 저장', exact: true }).click(); await expect(recovery(page)).toContainText('기록 초기화 이후'); await expect(retry(page)).toBeDisabled();
    expect((await qa.account.client.from('growth_sessions').select('id')).data).toEqual([]);
    await page.reload(); await expect(page.getByRole('button', { name: '지난 기록 추가', exact: true })).toBeEnabled(); expect((await draft(page, qa.account.id)).pending).toBeNull();
    expect((await qa.account.client.from('growth_sessions').select('id')).data).toEqual([]);
  } finally { await drain.wait(); await page.unroute(`**${rpcPath}`); }
});
test('quota failure keeps visible raw input and blocks cloud save until checkpoint succeeds', async ({ page, qa }) => {
  const { routine } = await seed(qa.account); await open(page, qa.account); await enterManual(page, routine.id);
  await expect.poll(async () => (await draft(page, qa.account.id)).manual.memo).toBe('합성 메모');
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('Synthetic quota', 'QuotaExceededError'); return original.call(this, name, value); };
    (window as unknown as { restoreRoutineStorage: () => void }).restoreRoutineStorage = () => { Storage.prototype.setItem = original; };
  }, routineDraftKey(qa.account.id));
  await manualForm(page).getByPlaceholder('메모(선택)').fill('보관할 최신 메모');
  await expect(recovery(page)).toContainText('기기에 입력을 보관하지 못했어요'); await expect(manualForm(page).getByPlaceholder('메모(선택)')).toHaveValue('보관할 최신 메모');
  await expect(page.getByRole('button', { name: '기록 저장', exact: true })).toBeDisabled();
  expect((await qa.account.client.from('growth_sessions').select('id').eq('routine_id', routine.id).eq('session_date', today())).data).toEqual([]);
  await page.evaluate(() => (window as unknown as { restoreRoutineStorage: () => void }).restoreRoutineStorage());
  await page.getByRole('button', { name: '기기 임시 저장 다시 시도', exact: true }).click(); await expect(page.getByRole('button', { name: '기록 저장', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '기록 저장', exact: true }).click(); await expect(recovery(page)).toContainText('기록을 클라우드에서 확인했어요');
  expect((await qa.account.client.from('growth_sessions').select('memo').eq('routine_id', routine.id).eq('session_date', today()).single()).data?.memo).toBe('보관할 최신 메모');
});
test('account A pending request is hidden from B and restored only when A signs in again', async ({ page, qa }) => {
  const { routine } = await seed(qa.account), other = await qa.createAccount(); await seed(other); await open(page, qa.account); await enterManual(page, routine.id);
  await page.route(`**${rpcPath}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic offline"}' }));
  await page.getByRole('button', { name: '기록 저장', exact: true }).click(); await expect(recovery(page)).toContainText('저장 결과를 확인하지 못했어요');
  const before = await checkpoint(page, qa.account.id); await page.unroute(`**${rpcPath}`);
  await page.goto('/diet/settings'); await page.getByRole('button', { name: '로그아웃', exact: true }).click(); await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
  await open(page, other); await reauthenticateFixtureAccount(other); await expect(manualForm(page)).toHaveCount(0); await expect(retry(page)).toHaveCount(0);
  expect(await checkpoint(page, qa.account.id)).toBe(before); expect((await other.client.from('growth_sessions').select('id').eq('session_date', today())).data).toEqual([]);
  await page.goto('/diet/settings'); await page.getByRole('button', { name: '로그아웃', exact: true }).click(); await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
  await open(page, qa.account); await reauthenticateFixtureAccount(qa.account); await expect(retry(page)).toBeEnabled(); await expect(manualForm(page).getByPlaceholder('메모(선택)')).toHaveValue('합성 메모');
  await retry(page).click(); await expect(recovery(page)).toContainText('기록을 클라우드에서 확인했어요');
  expect((await qa.account.client.from('growth_sessions').select('id').eq('routine_id', routine.id).eq('session_date', today())).data).toHaveLength(1);
});
