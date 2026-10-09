import { createHash, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, login, synced } from './fixture';
import { RouteDrain } from './route-drain';
import type { HandwritingDraft, HandwritingTombstone } from '../../lib/handwriting-draft';
const rpc = '**/rest/v1/rpc/save_handwriting_attempt';
const canvas = (page: Page) => page.getByLabel('수업 손글씨 연습장');
const minutes = (page: Page) => page.getByLabel('실제로 연습한 시간 (분)');
const reflection = (page: Page) => page.getByLabel('다음에 신경 쓸 점 (선택)');
const retry = (page: Page) => page.getByRole('button', { name: '같은 기록 다시 확인', exact: true });
async function local(page: Page, owner: string) {
  return page.evaluate(id => new Promise<HandwritingDraft | HandwritingTombstone | null>((resolve, reject) => {
    const open = indexedDB.open('yeoni-handwriting', 1);
    open.onsuccess = () => { const db = open.result; if (!db.objectStoreNames.contains('slots')) { db.close(); resolve(null); return; } const tx = db.transaction('slots'), read = tx.objectStore('slots').get(`${id}:film-handwriting-v1`); tx.oncomplete = () => { db.close(); resolve(read.result ?? null); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
    open.onerror = () => reject(open.error);
  }), owner);
}
async function seed(page: Page, account: Parameters<typeof login>[1]) {
  expect((await account.client.from('growth_routines').insert({ id: randomUUID(), user_id: account.id, category: 'handwriting', title: '손글씨 복구 합성 검증', target_minutes: 15 })).error).toBeNull();
  // Entirely synthetic white worksheet, generated in the disposable browser.
  const webp = await page.evaluate(() => { const sheet = document.createElement('canvas'); sheet.width = 200; sheet.height = 280; const ctx = sheet.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 200, 280); ctx.fillStyle = '#aaa'; ctx.fillText('SYNTHETIC QA ONLY', 15, 40); return sheet.toDataURL('image/webp').split(',')[1]; });
  const root = `${account.id}/learning/film-v1`;
  for (const [name, bytes, contentType] of [['ready.txt', Buffer.from('yeoni-private-handwriting-v1'), 'text/plain'], ['page-02.webp', Buffer.from(webp, 'base64'), 'image/webp'], ['page-03.webp', Buffer.from(webp, 'base64'), 'image/webp']] as const) {
    expect((await account.client.storage.from('growth-resources').upload(`${root}/${name}`, bytes, { contentType, upsert: false })).error).toBeNull();
  }
}
async function open(page: Page, account: Parameters<typeof login>[1]) {
  await login(page, account); await synced(page); await page.goto('/growth/handwriting');
  await expect(page.getByRole('region', { name: '손글씨 학습 진도' })).toContainText('0 / 53 수업 완료');
  await expect(page.getByRole('img', { name: /필림 유인물/ })).toBeVisible();
}
async function check(page: Page) {
  await page.getByLabel('어깨와 손에 힘을 빼고 그렸어요.').check(); await page.getByLabel('선 사이의 간격을 비교했어요.').check();
}
async function stroke(page: Page, offset = 0) {
  await canvas(page).scrollIntoViewIfNeeded(); const box = (await canvas(page).boundingBox())!;
  const y = Math.max(box.y, 50) + 40 + offset;
  await page.mouse.move(box.x + 20, y); await page.mouse.down(); await page.mouse.move(box.x + 100, y + 20, { steps: 5 }); await page.mouse.up();
}
const pixels = (page: Page) => canvas(page).evaluate(node => (node as HTMLCanvasElement).toDataURL('image/png'));
for (const width of [320, 390]) test(`handwriting paper reload/back-forward retains exact draft and lost RPC response saves once at ${width}px`, async ({ page, qa }) => {
  await seed(page, qa.account); await page.setViewportSize({ width, height: 844 }); await open(page, qa.account); const baseline = await qa.read();
  await minutes(page).fill('12'); await reflection(page).fill('다음에는 간격 확인'); await check(page);
  await expect.poll(async () => (await local(page, qa.account.id) as HandwritingDraft)?.reflection).toBe('다음에는 간격 확인');
  const before = await local(page, qa.account.id) as HandwritingDraft;
  await page.reload(); await expect(minutes(page)).toHaveValue('12'); await expect(reflection(page)).toHaveValue('다음에는 간격 확인');
  await expect(page.getByLabel('어깨와 손에 힘을 빼고 그렸어요.')).toBeChecked();
  await page.getByRole('link', { name: '자기계발 홈', exact: true }).click(); await expect(page).toHaveURL(/\/growth$/); await page.goBack();
  await expect(reflection(page)).toHaveValue('다음에는 간격 확인'); await page.goForward(); await expect(page).toHaveURL(/\/growth$/); await page.goBack(); await expect(minutes(page)).toHaveValue('12');
  expect((await local(page, qa.account.id))?.attemptId).toBe(before.attemptId);
  const drain = new RouteDrain(); let posts = 0;
  await page.route(rpc, route => drain.run(async () => { posts++; await route.fetch(); await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"lost response"}' }); }));
  try { await page.getByRole('button', { name: '이 수업 완료하고 저장', exact: true }).click(); await expect(page.getByRole('button', { name: '수업 저장 완료', exact: true })).toBeDisabled(); expect(posts).toBe(1); }
  finally { await drain.wait(); await page.unroute(rpc); }
  expect((await local(page, qa.account.id))?.state).toBe('confirmed');
  const rows = (await qa.account.client.from('growth_sessions').select('*')).data!; expect(rows).toHaveLength(1); expect(rows[0].metrics.lessonSnapshot).toEqual(before.lesson); expect(rows[0].started_at).toBeNull(); expect(rows[0].ended_at).toBeNull();
  await page.reload(); await expect(page.getByRole('heading', { name: '2강 · 기본 모음', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await qa.read()).toEqual(baseline);
});
test('handwriting screen restores pixels/evidence/undo and frozen pending retry works with unavailable current materials/progress', async ({ page, qa }) => {
  await seed(page, qa.account); await page.setViewportSize({ width: 390, height: 844 }); await open(page, qa.account);
  await page.getByRole('button', { name: '이 화면에 직접 쓰기', exact: true }).click(); await expect(page.getByText('연습지 준비 중…', { exact: true })).toHaveCount(0);
  await stroke(page); const first = await pixels(page); await stroke(page, 30); const second = await pixels(page);
  await check(page); await reflection(page).fill('정확한 화면 복구');
  await expect.poll(async () => (await local(page, qa.account.id) as HandwritingDraft)?.strokes).toBe(2);
  const savedDraft = await local(page, qa.account.id) as HandwritingDraft;
  await page.reload(); await expect(page.getByText(/직접 쓴 획 2개/)).toBeVisible(); expect(await pixels(page)).toBe(second);
  expect((await local(page, qa.account.id) as HandwritingDraft).activeMs).toBe(savedDraft.activeMs);
  await page.getByRole('button', { name: '되돌리기', exact: true }).click(); await expect(page.getByText(/직접 쓴 획 1개/)).toBeVisible(); expect(await pixels(page)).toBe(first);
  const drain = new RouteDrain(); const requests: unknown[] = [];
  await page.route(rpc, route => drain.run(async () => { requests.push(route.request().postDataJSON()); await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"interrupted before RPC"}' }); }));
  await page.getByRole('button', { name: '이 수업 완료하고 저장', exact: true }).click(); await expect(retry(page)).toBeEnabled();
  const frozen = (await local(page, qa.account.id) as HandwritingDraft).pending!; expect(frozen.png).toBeTruthy();
  await drain.wait(); await page.unroute(rpc);
  const materials = '**/storage/v1/object/growth-resources/**/learning/**', progress = '**/rest/v1/growth_sessions*';
  await page.route(materials, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"materials offline"}' }));
  await page.route(progress, route => new URL(route.request().url()).searchParams.has('id') ? route.fallback() : route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"progress offline"}' }));
  await page.route(rpc, route => drain.run(async () => { requests.push(route.request().postDataJSON()); await route.fallback(); }));
  try {
    await page.reload(); await expect(retry(page)).toBeEnabled(); expect(await pixels(page)).toBe(first); await retry(page).click();
    await expect(page.getByRole('button', { name: '수업 저장 완료', exact: true })).toBeDisabled(); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  } finally { await drain.wait(); await page.unroute(rpc); await page.unroute(materials); await page.unroute(progress); }
  const row = (await qa.account.client.from('growth_sessions').select('*').single()).data!; expect(row.id).toBe(frozen.session.id);
  const resource = (await qa.account.client.from('growth_resources').select('*').single()).data!; expect(resource.id).toBe(frozen.resource!.id);
  const object = await qa.account.client.storage.from('growth-resources').download(resource.storage_path); expect(object.error).toBeNull();
  expect(createHash('sha256').update(Buffer.from(await object.data!.arrayBuffer())).digest('hex')).toBe(frozen.pngSha256); expect(row.metrics.pngSha256).toBe(frozen.pngSha256);
  const other = await qa.createAccount(); expect((await other.client.storage.from('growth-resources').download(resource.storage_path)).error).not.toBeNull();
});
test('handwriting two real IDB tabs retain stale visible input without overwriting the winner', async ({ page, qa }) => {
  await seed(page, qa.account); await open(page, qa.account); const second = await page.context().newPage();
  try {
    await second.goto('/growth/handwriting'); await expect(minutes(second)).toBeEditable();
    await reflection(page).fill('첫 번째 창'); await expect.poll(async () => (await local(page, qa.account.id) as HandwritingDraft)?.reflection).toBe('첫 번째 창');
    await reflection(second).fill('두 번째 창 보존'); await expect(second.getByRole('status').filter({ hasText: '다른 창에서 이 연습이 바뀌었어요.' })).toBeVisible();
    await expect(reflection(second)).toHaveValue('두 번째 창 보존'); expect((await local(page, qa.account.id) as HandwritingDraft).reflection).toBe('첫 번째 창');
    await expect(second.getByRole('button', { name: '이 수업 완료하고 저장', exact: true })).toBeDisabled(); expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([]);
  } finally { await second.close(); }
});
test('handwriting reset after upload fences metadata save while preserving the unlinked private image', async ({ page, qa }) => {
  await seed(page, qa.account); await open(page, qa.account); await page.getByRole('button', { name: '이 화면에 직접 쓰기', exact: true }).click(); await expect(page.getByText('연습지 준비 중…', { exact: true })).toHaveCount(0); await stroke(page); await check(page);
  const pattern = '**/storage/v1/object/growth-resources/**/handwriting-*.png', drain = new RouteDrain(); let uploadedPath = '';
  await page.route(pattern, route => drain.run(async () => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    const response = await route.fetch(); expect(response.ok()).toBe(true); uploadedPath = decodeURIComponent(new URL(route.request().url()).pathname.split('/growth-resources/')[1]);
    const reset = await qa.account.client.rpc('reset_my_app_records', { p_app: 'growth', p_request_id: randomUUID(), p_confirmation: '초기화' }); expect(reset.error).toBeNull();
    await route.fulfill({ response });
  }));
  try { await page.getByRole('button', { name: '이 수업 완료하고 저장', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: '기록 초기화 이후에는 이전 연습을 다시 저장하지 않아요.' })).toBeVisible(); }
  finally { await drain.wait(); await page.unroute(pattern); }
  expect(uploadedPath).toContain('/handwriting-'); expect((await qa.account.client.from('growth_sessions').select('*')).data).toEqual([]); expect((await qa.account.client.from('growth_resources').select('*')).data).toEqual([]);
  expect((await qa.account.client.storage.from('growth-resources').download(uploadedPath)).error).toBeNull();
  await page.reload(); await expect(page.getByRole('button', { name: '새 연습 시작', exact: true })).toBeVisible(); expect((await local(page, qa.account.id))?.state).toBe('invalidated');
});
