import { createHash, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, login, synced } from './fixture';
import { RouteDrain } from './route-drain';
import { drawVisibleCanvasStroke } from './handwriting-canvas';
import { reauthenticateFixtureAccount } from './fixture-account-auth';
import type { FreeDraft, FreeRecord } from '../../lib/free-handwriting-draft';
// Authored real-browser acceptance. Run only in the authorized disposable stack.
// No private worksheets, real artwork, hosted accounts or paid providers.
const rpc = '**/rest/v1/rpc/save_free_handwriting_attempt';
const canvas = (page: Page) => page.getByLabel('손글씨 연습장', { exact: true });
const retry = (page: Page) => page.getByRole('button', { name: '같은 기록 다시 확인', exact: true });
const save = (page: Page) => page.getByRole('button', { name: '손글씨와 완료 기록 저장', exact: true });
async function local(page: Page, owner: string) {
  return page.evaluate(id => new Promise<FreeRecord | null>((resolve, reject) => {
    const open = indexedDB.open('yeoni-free-handwriting', 1);
    open.onsuccess = () => { const db = open.result; if (!db.objectStoreNames.contains('slots')) { db.close(); resolve(null); return; } const tx = db.transaction('slots'), read = tx.objectStore('slots').get(`${id}:free-handwriting-v1`); tx.oncomplete = () => { db.close(); resolve(read.result ?? null); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
    open.onerror = () => reject(open.error);
  }), owner);
}
async function seed(account: Parameters<typeof login>[1]) {
  expect((await account.client.from('growth_routines').insert({ id: randomUUID(), user_id: account.id, category: 'handwriting', title: '자유 손글씨 합성 검증', target_minutes: 15 })).error).toBeNull();
}
async function open(page: Page, account: Parameters<typeof login>[1]) {
  await login(page, account); await synced(page); await page.goto('/growth/handwriting/free');
  await expect(page.getByRole('button', { name: '다른 문장', exact: true })).toBeEnabled();
  await expect.poll(async () => (await local(page, account.id) as FreeDraft)?.frames?.length).toBe(1);
}
async function stroke(page: Page, owner: string, offset = 0) {
  const before = await strokes(page, owner), raster = await pixels(page);
  expect(before).toEqual(expect.any(Number));
  await drawVisibleCanvasStroke(page, canvas(page), offset);
  // Reach a real, persisted pointer stroke before installing any fault injection.
  await expect.poll(() => strokes(page, owner), { message: 'The real pointer stroke must reach its IndexedDB checkpoint.' }).toBe(before! + 1);
  expect(await pixels(page)).not.toBe(raster);
}
// Draft metadata can render before the reset-marker lookup and canvas paint effect.
// Keep exact PNG equality, but wait for the pixels rather than a heading or color field.
const pixels = (page: Page) => canvas(page).evaluate(node => (node as HTMLCanvasElement).toDataURL('image/png'));
const strokes = async (page: Page, owner: string) => { const d = await local(page, owner) as FreeDraft; return d?.frames?.[d.historyIndex]?.evidence.strokes; };
for (const width of [320, 390]) test(`free handwriting exact raster/history/guide/ink reload and navigation at ${width}px`, async ({ page, qa }) => {
  await seed(qa.account); await page.setViewportSize({ width, height: 844 }); await open(page, qa.account); const baseline = await qa.read();
  await page.getByRole('button', { name: '다른 문장', exact: true }).click(); await page.getByLabel('펜 색').fill('#abcdef');
  await stroke(page, qa.account.id); const first = await pixels(page); await stroke(page, qa.account.id, 30); const second = await pixels(page);
  await expect.poll(() => strokes(page, qa.account.id)).toBe(2); const before = await local(page, qa.account.id) as FreeDraft;
  await page.reload(); await expect(page.getByRole('heading', { name: before.guideText, exact: true })).toBeVisible(); await expect(page.getByLabel('펜 색')).toHaveValue('#abcdef'); await expect.poll(() => pixels(page)).toBe(second);
  await page.getByRole('button', { name: '되돌리기', exact: true }).click(); await expect.poll(() => pixels(page)).toBe(first); await expect.poll(() => strokes(page, qa.account.id)).toBe(1);
  await page.reload(); await expect(page.getByRole('button', { name: '다시 실행', exact: true })).toBeEnabled(); await page.getByRole('button', { name: '다시 실행', exact: true }).click(); await expect.poll(() => pixels(page)).toBe(second);
  await page.getByRole('link', { name: '단계별 수업', exact: true }).click(); await expect(page).toHaveURL(/\/growth\/handwriting$/); await page.goBack(); await expect(page.getByRole('heading', { name: before.guideText, exact: true })).toBeVisible(); await expect.poll(() => pixels(page)).toBe(second);
  expect((await local(page, qa.account.id))?.attemptId).toBe(before.attemptId); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await qa.read()).toEqual(baseline);
});
test('free handwriting lost RPC response confirms exactly one atomic image/session save', async ({ page, qa }) => {
  await seed(qa.account); await open(page, qa.account); await stroke(page, qa.account.id); await expect.poll(() => strokes(page, qa.account.id)).toBe(1);
  const drain = new RouteDrain(); let posts = 0;
  await page.route(rpc, route => drain.run(async () => { posts++; await route.fetch(); await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"lost response"}' }); }));
  try { await save(page).click(); await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled(); expect(posts).toBe(1); } finally { await drain.wait(); await page.unroute(rpc); }
  const session = (await qa.account.client.from('growth_sessions').select('*').single()).data!, resource = (await qa.account.client.from('growth_resources').select('*').single()).data!;
  expect(session.metrics.practiceKind).toBe('free-handwriting-v1'); expect(session.metrics.courseId).toBeUndefined(); expect(session.metrics.resourceId).toBe(resource.id); expect((await local(page, qa.account.id))?.state).toBe('confirmed');
  const object = await qa.account.client.storage.from('growth-resources').download(resource.storage_path); expect(object.error).toBeNull(); expect(createHash('sha256').update(Buffer.from(await object.data!.arrayBuffer())).digest('hex')).toBe(session.metrics.pngSha256);
});
test('free pending exact retry survives reload and unavailable routine listing', async ({ page, qa }) => {
  await seed(qa.account); await open(page, qa.account); await stroke(page, qa.account.id);
  const drain = new RouteDrain(), payloads: unknown[] = [];
  await page.route(rpc, route => drain.run(async () => { payloads.push(route.request().postDataJSON()); await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"before commit"}' }); }));
  await save(page).click(); await expect(retry(page)).toBeEnabled(); const pending = (await local(page, qa.account.id) as FreeDraft).pending!; const original = await pixels(page); await drain.wait(); await page.unroute(rpc);
  const routines = '**/rest/v1/growth_routines*'; await page.route(routines, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"offline listing"}' }));
  await page.route(rpc, route => drain.run(async () => { payloads.push(route.request().postDataJSON()); await route.fallback(); }));
  try { await page.reload(); await expect(retry(page)).toBeEnabled(); await expect.poll(() => pixels(page)).toBe(original); await retry(page).click(); await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled(); expect(payloads).toHaveLength(2); expect(payloads[1]).toEqual(payloads[0]); } finally { await drain.wait(); await page.unroute(rpc); await page.unroute(routines); }
  const rows = (await qa.account.client.from('growth_sessions').select('*')).data!; expect(rows).toHaveLength(1); expect(rows[0].id).toBe(pending.session.id);
});
test('two real IDB tabs preserve the winner and stale visible ink preference', async ({ page, qa }) => {
  await seed(qa.account); await open(page, qa.account); const other = await page.context().newPage();
  try { await other.goto('/growth/handwriting/free'); await expect(other.getByRole('button', { name: '다른 문장', exact: true })).toBeEnabled(); await page.getByLabel('펜 색').fill('#111111'); await expect.poll(async () => (await local(page, qa.account.id) as FreeDraft).inkColor).toBe('#111111'); await other.getByLabel('펜 색').fill('#222222'); await expect(other.getByRole('status').filter({ hasText: '다른 창에서 이 연습이 바뀌었어요.' })).toBeVisible(); await expect(other.getByLabel('펜 색')).toHaveValue('#222222'); expect((await local(page, qa.account.id) as FreeDraft).inkColor).toBe('#111111'); await expect(save(other)).toBeDisabled(); } finally { await other.close(); }
});
test('reset after free upload preserves orphan and pending source until explicit replacement', async ({ page, qa }) => {
  await seed(qa.account); await open(page, qa.account); await stroke(page, qa.account.id);
  const pattern = '**/storage/v1/object/growth-resources/**/free-handwriting-*.png', drain = new RouteDrain(); let path = '';
  await page.route(pattern, route => drain.run(async () => { if (route.request().method() !== 'POST') { await route.fallback(); return; } const response = await route.fetch(); expect(response.ok()).toBe(true); path = decodeURIComponent(new URL(route.request().url()).pathname.split('/growth-resources/')[1]); expect((await qa.account.client.rpc('reset_my_app_records', { p_app: 'growth', p_request_id: randomUUID(), p_confirmation: '초기화' })).error).toBeNull(); await route.fulfill({ response }); }));
  try { await save(page).click(); await expect(page.getByRole('status').filter({ hasText: '기록 초기화 이후에는 이전 연습을 다시 저장하지 않아요.' })).toBeVisible(); } finally { await drain.wait(); await page.unroute(pattern); }
  const before = await local(page, qa.account.id) as FreeDraft; expect(before.state).toBe('active'); expect(before.pending).toBeTruthy(); expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([]); expect((await qa.account.client.from('growth_resources').select('*')).data).toEqual([]); expect((await qa.account.client.storage.from('growth-resources').download(path)).error).toBeNull();
  await page.reload(); await expect(page.getByRole('button', { name: '새 연습 시작', exact: true })).toBeVisible(); expect((await local(page, qa.account.id))?.attemptId).toBe(before.attemptId);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '새 연습 시작', exact: true }).click(); await expect.poll(async () => (await local(page, qa.account.id) as FreeDraft)?.pending).toBeNull(); expect((await qa.account.client.storage.from('growth-resources').download(path)).error).toBeNull();
});
test('free browser quota failure preserves current screen and previous checkpoint', async ({ page, qa }) => {
  await seed(qa.account); await open(page, qa.account); await stroke(page, qa.account.id); await expect.poll(() => strokes(page, qa.account.id)).toBe(1); const before = await local(page, qa.account.id) as FreeDraft;
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.transaction.db.name === 'yeoni-free-handwriting') throw new DOMException('Synthetic quota', 'QuotaExceededError'); return original.apply(this, args); }; });
  await page.getByLabel('펜 색').fill('#123456'); await expect(page.getByRole('status').filter({ hasText: '기기 임시 저장을 확인하지 못했어요.' })).toBeVisible(); await expect(page.getByLabel('펜 색')).toHaveValue('#123456'); expect((await local(page, qa.account.id))?.revision).toBe(before.revision); await expect(save(page)).toBeDisabled(); expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([]);
});
test('free offline reset-state lookup restores local edits and blocks unverified server writes', async ({ page, qa }) => {
  await seed(qa.account); await open(page, qa.account); await stroke(page, qa.account.id); await expect.poll(() => strokes(page, qa.account.id)).toBe(1); const image = await pixels(page);
  const state = '**/rest/v1/user_app_state*'; await page.route(state, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"offline state"}' }));
  try { await page.reload(); await expect(page.getByRole('button', { name: '다른 문장', exact: true })).toBeEnabled(); await expect.poll(() => pixels(page)).toBe(image); await page.getByLabel('펜 색').fill('#987654'); await expect.poll(async () => (await local(page, qa.account.id) as FreeDraft).inkColor).toBe('#987654'); await expect(save(page)).toBeDisabled(); expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([]); } finally { await page.unroute(state); }
  await page.reload(); await expect(page.getByLabel('펜 색')).toHaveValue('#987654'); await expect(save(page)).toBeEnabled(); await save(page).click(); await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled();
});
test('delayed free save cannot clean account A draft or appear in account B after owner switch', async ({ page, qa }) => {
  await seed(qa.account); const other = await qa.createAccount(); await seed(other); await open(page, qa.account); await stroke(page, qa.account.id);
  const drain = new RouteDrain(); let release!: () => void, arrived!: () => void, posts = 0; const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(rpc, route => drain.run(async () => { posts++; const response = await route.fetch(); expect(response.ok()).toBe(true); arrived(); await released; await route.fulfill({ response }); }));
  const relogin = async (account: Parameters<typeof login>[1]) => { await page.getByRole('button', { name: '로그아웃', exact: true }).click(); await page.getByLabel('이메일', { exact: true }).fill(account.email); await page.getByLabel('비밀번호', { exact: true }).fill(account.password); await page.getByRole('button', { name: 'AI 연이 시작', exact: true }).click(); await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible(); await reauthenticateFixtureAccount(account); };
  try {
    await save(page).click(); await seen; const pending = await local(page, qa.account.id) as FreeDraft;
    await relogin(other); release(); await drain.wait(); await expect(page.getByRole('button', { name: '다른 문장', exact: true })).toBeEnabled(); expect((await local(page, qa.account.id))?.revision).toBe(pending.revision); expect((await other.client.from('growth_sessions').select('*')).data).toEqual([]);
    await relogin(qa.account); await expect(retry(page)).toBeEnabled(); await retry(page).click(); await expect(page.getByRole('button', { name: '저장 완료', exact: true })).toBeDisabled(); expect(posts).toBe(1); expect((await qa.account.client.from('growth_sessions').select('*')).data).toHaveLength(1);
  } finally { release(); await drain.wait(); await page.unroute(rpc); }
});
