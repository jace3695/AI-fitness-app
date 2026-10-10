import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { Locator, Page, Request } from '@playwright/test';
import { test, expect, login, synced, sharedSyncRpcPath, canonical } from './fixture';
import { reauthenticateFixtureAccount } from './fixture-account-auth';
import { RouteDrain } from './route-drain';

// Authored acceptance, not execution evidence. Only the existing disposable
// fixture may run this suite; it owns account, database and Storage cleanup.
// These PNGs are tiny generated patterns, never a user's image or worksheet.
type Account = Parameters<typeof login>[1];
type Json = Record<string, unknown>;
type Saved = { id: string; resourceId: string; path: string; bytes: Buffer; hash: string; width: number; height: number; metrics: Json };
const routePath = '/growth/handwriting/compare';
const day = '2001-01-02'; // Deliberately outside useGrowthData's recent-history window.
const verified = '저장 당시 해시와 일치하는 이미지';
const legacy = '저장 당시 원본 해시 없음 · 원본 무결성 미확인';
const readFailure = '읽기를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
const first = (page: Page) => page.getByRole('region', { name: '기준 기록', exact: true });
const second = (page: Page) => page.getByRole('region', { name: '비교 기록', exact: true });
const selector = (page: Page, side: 0 | 1) => page.getByLabel(side === 0 ? '기준 기록 선택' : '비교 기록 선택', { exact: true });
const image = (pane: Locator) => pane.getByRole('img');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function png(width: number, height: number, blue = false): Buffer {
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raster = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (width * 4 + 1) + 1 + x * 4;
    const ink = Math.abs(x / width - y / height) < 0.12 || x < 3;
    raster[at] = ink ? 30 : 255; raster[at + 1] = ink ? 50 : 255; raster[at + 2] = ink ? blue ? 210 : 50 : 255; raster[at + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raster)), chunk('IEND', Buffer.alloc(0))]);
}
function courseMetrics(resourceId: string | null, hash: string, owner: string, modern: boolean, mode: 'trace' | 'copy' | 'paper' = 'trace'): Json {
  return {
    courseId: 'film-handwriting-v1', lessonId: 'film-p2', lessonCompleted: true, pdfPage: 2,
    mode: mode === 'paper' ? 'paper' : 'screen', practiceMode: mode, selfChecks: [true, true],
    ...(mode === 'paper' ? { timeSource: 'self-reported' } : { resourceId, strokes: 3, activeSeconds: 0 }),
    ...(modern ? {
      lessonSnapshot: { id: 'film-p2', number: 1, pdfPage: 2, stage: '합성 단계', title: '합성 저장 수업', goal: '합성 검증', steps: ['합성 선을 살펴봐요.'], checks: ['저장된 합성 점검 하나', '저장된 합성 점검 둘'] },
      worksheet: { path: `${owner}/learning/film-v1/page-02.webp`, version: 'synthetic-v1', sha256: 'a'.repeat(64) },
      ...(mode === 'paper' ? {} : { pngSha256: hash }),
    } : {}),
  };
}
function sessionRow(account: Account, id: string, metrics: Json) {
  return { id, user_id: account.id, routine_id: null, session_date: day, source: 'handwriting', status: 'completed', actual_minutes: 1, metrics, created_at: `${day}T12:00:00.000Z` };
}
async function seedAttempt(account: Account, options: {
  kind?: 'course' | 'free'; modern?: boolean; width?: number; height?: number; mode?: 'trace' | 'copy';
  missingResource?: boolean; missingObject?: boolean; mismatch?: boolean; corrupt?: boolean; metrics?: Json; id?: string;
} = {}): Promise<Saved> {
  const kind = options.kind ?? 'free', modern = options.modern ?? true, width = options.width ?? 64, height = options.height ?? 32;
  const resourceId = randomUUID(), id = options.id ?? randomUUID();
  const bytes = options.corrupt ? Buffer.from('synthetic invalid PNG') : png(width, height, kind === 'free');
  const hash = digest(bytes), path = `${account.id}/${day}/${kind === 'free' && modern ? 'free-handwriting' : 'handwriting'}-${resourceId}.png`;
  const metrics = options.metrics ?? (kind === 'course' ? courseMetrics(resourceId, hash, account.id, modern, options.mode) : {
    ...(modern ? { practiceKind: 'free-handwriting-v1', pngSha256: options.mismatch ? '0'.repeat(64) : hash } : {}),
    resourceId, guideText: '합성 비교 안내 문장', strokes: 2, activeSeconds: 0, occupiedWidth: 50, occupiedHeight: 25, pressureRange: null,
  });
  if (!options.missingObject) expect((await account.client.storage.from('growth-resources').upload(path, bytes, { contentType: 'image/png', upsert: false })).error).toBeNull();
  if (!options.missingResource) expect((await account.client.from('growth_resources').insert({
    id: resourceId, user_id: account.id, routine_id: null, title: '합성 비교 원본', category: 'handwriting', classification: 'reference', notes: '가변 자료 정보', storage_path: path, mime_type: 'image/png', size_bytes: bytes.length,
  })).error).toBeNull();
  expect((await account.client.from('growth_sessions').insert(sessionRow(account, id, metrics))).error).toBeNull();
  return { id, resourceId, path, bytes, hash, width, height, metrics };
}
async function readRows(account: Account, table: string) {
  const all: Json[] = []; let after: string | undefined;
  for (;;) {
    let query = account.client.from(table).select('*').eq('user_id', account.id).order('id').limit(200);
    if (after) query = query.gt('id', after);
    const result = await query; expect(result.error, `${table} owner-scoped snapshot`).toBeNull();
    const rows = result.data ?? []; all.push(...rows);
    if (rows.length < 200) return all;
    after = rows[rows.length - 1].id as string;
  }
}
async function snapshot(account: Account) {
  const ownedFiles = async (prefix: string): Promise<Json[]> => {
    const result = await account.client.storage.from('growth-resources').list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    expect(result.error).toBeNull(); const files: Json[] = [];
    for (const file of result.data ?? []) {
      const path = `${prefix}/${file.name}`;
      if (!file.id) files.push(...await ownedFiles(path));
      else {
        const object = await account.client.storage.from('growth-resources').download(path); expect(object.error).toBeNull();
        files.push({ path, id: file.id, created_at: file.created_at, updated_at: file.updated_at, metadata: file.metadata, sha256: digest(Buffer.from(await object.data!.arrayBuffer())) });
      }
    }
    return files;
  };
  const state = await account.client.from('user_app_state').select('state').eq('user_id', account.id).single(); expect(state.error).toBeNull();
  return { sessions: await readRows(account, 'growth_sessions'), resources: await readRows(account, 'growth_resources'), routines: await readRows(account, 'growth_routines'), state: state.data!.state as Json, objects: await ownedFiles(account.id) };
}
function audit(page: Page, baselineState: Json) {
  // Installed only after login + synced(). Auth token traffic is not application
  // mutation traffic. The existing CAS synchronizer is separately constrained to
  // its already-settled baseline; no handwriting/resource/RPC write is exempted.
  const mutations: string[] = [], forbiddenImages: string[] = [], downloads: string[] = [];
  const listener = (request: Request) => {
    const url = new URL(request.url()), path = url.pathname;
    if (path === '/_next/image' || /\/storage\/v1\/(?:object\/sign|render\/image)\//.test(path) || path.includes('/learning/')) forbiddenImages.push(path);
    if (path.startsWith('/storage/v1/object/') && request.method() === 'GET') downloads.push(path);
    if (!/^\/(?:rest|storage)\/v1\//.test(path) || ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return;
    if (path === sharedSyncRpcPath && request.method() === 'POST' && canonical(request.postDataJSON()?.p_state) === canonical(baselineState)) return;
    mutations.push(`${request.method()} ${path}`);
  };
  page.on('request', listener);
  return { downloads, assertReadOnly() { expect(mutations, 'No comparison-triggered application mutation or changed sync state').toEqual([]); expect(forbiddenImages, 'No optimizer, signing, transform or reference worksheet request').toEqual([]); }, stop() { page.off('request', listener); } };
}
async function watchPrivatePersistence(page: Page, needles: string[]) {
  await page.addInitScript(values => {
    const violations: string[] = [];
    Object.assign(window, { comparisonPersistenceViolations: violations });
    const inspect = (channel: string, value: unknown) => {
      const seen = new WeakSet<object>();
      const containsPrivate = (item: unknown): boolean => {
        if (typeof item === 'string') return values.some(needle => item.includes(needle)) || /(?:data:image\/|blob:http|\/storage\/v1\/object\/growth-resources\/)/.test(item);
        if (item instanceof Blob || item instanceof ArrayBuffer || ArrayBuffer.isView(item)) return true;
        if (!item || typeof item !== 'object' || seen.has(item)) return false;
        seen.add(item); return Object.values(item).some(containsPrivate);
      };
      if (containsPrivate(value)) violations.push(channel);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { inspect('web-storage', value); return setItem.call(this, key, value); };
    for (const method of ['put', 'add'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { inspect('indexeddb', args[0]); return original.apply(this, args); };
    }
    const cachePut = Cache.prototype.put;
    Cache.prototype.put = function (request, response) { inspect('cache-api', typeof request === 'string' ? request : request instanceof URL ? request.href : request.url); return cachePut.call(this, request, response); };
  }, needles);
}
async function open(page: Page, count: number) {
  await page.goto(routePath); await expect(page.getByRole('heading', { name: '저장한 손글씨 전후 비교', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: `불러온 기록 ${count}개 ·` })).toBeVisible();
  await expect(page.getByText('기록 목록 확인 중…', { exact: true })).toHaveCount(0);
}
async function selectReady(page: Page, side: 0 | 1, saved: Saved, modern = true) {
  await selector(page, side).selectOption(saved.id);
  const pane = side === 0 ? first(page) : second(page);
  await expect(pane.getByRole('status').filter({ hasText: modern ? verified : legacy })).toBeVisible();
  await expect(image(pane)).toBeVisible();
  await expect.poll(() => image(pane).evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
}
async function assertOriginalImage(pane: Locator, saved: Saved) {
  const actual = await image(pane).evaluate(async node => {
    const img = node as HTMLImageElement, bytes = new Uint8Array(await (await fetch(img.currentSrc)).arrayBuffer());
    return { src: img.currentSrc.startsWith('blob:'), width: img.naturalWidth, height: img.naturalHeight, fit: getComputedStyle(img).objectFit,
      hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('') };
  });
  expect(actual).toEqual({ src: true, width: saved.width, height: saved.height, fit: 'contain', hash: saved.hash });
  await expect(pane).toContainText(`저장 이미지 ${saved.width} × ${saved.height}픽셀`);
}

for (const width of [320, 1024]) test(`saved comparison renders original verified/legacy pair without writes at ${width}px`, async ({ page, qa }) => {
  const course = await seedAttempt(qa.account, { kind: 'course' }), free = await seedAttempt(qa.account, { modern: false, width: 32, height: 64 });
  await login(page, qa.account); await synced(page); const before = await snapshot(qa.account), traffic = audit(page, before.state);
  await watchPrivatePersistence(page, ['합성 비교 안내 문장', course.hash, free.hash]);
  await page.setViewportSize({ width, height: 844 });
  try {
    await open(page, 2); await selectReady(page, 0, course); await selectReady(page, 1, free, false);
    await assertOriginalImage(first(page), course); await assertOriginalImage(second(page), free);
    await expect(selector(page, 1).locator(`option[value="${course.id}"]`)).toBeDisabled();
    await expect(selector(page, 0).locator(`option[value="${free.id}"]`)).toBeDisabled();
    await expect(first(page)).toContainText('저장한 수업 이름: 합성 저장 수업'); await expect(first(page)).toContainText('획 접촉 구간 시간: 0초');
    await expect(first(page)).toContainText('확인함 · 저장된 합성 점검 하나'); await expect(first(page).getByRole('checkbox')).toHaveCount(0);
    await expect(first(page)).not.toContainText('좌표 범위 너비'); await expect(second(page)).toContainText('미확인 (변화 없음 포함)');
    const conditions = page.getByRole('region', { name: '연습 조건 안내' });
    await expect(conditions).toContainText('수업 연습과 자유 연습으로 종류가 달라요.'); await expect(conditions).toContainText('원본 이미지의 픽셀 크기가 달라요.');
    await expect(conditions).toContainText('같은 기록 날짜예요.'); await expect(conditions).toContainText('향상을 판정할 수 없어요.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const a = (await first(page).boundingBox())!, b = (await second(page).boundingBox())!;
    if (width === 320) expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    else { expect(Math.abs(a.width - b.width)).toBeLessThan(2); expect(Math.abs(a.y - b.y)).toBeLessThan(2); }
    const zoom = page.getByRole('button', { name: '기준 기록 크게 보기', exact: true });
    expect((await zoom.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await zoom.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '기준 기록 크게 보기' }); await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img')).toHaveJSProperty('naturalWidth', course.width);
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(zoom).toBeFocused();
    await zoom.click(); await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click(); await expect(zoom).toBeFocused();
    const check = page.getByLabel('글자 크기의 차이를 살펴봤어요', { exact: true }); await check.check(); await expect(check).toBeChecked();
    await page.getByRole('button', { name: '두 기록 자리 바꾸기', exact: true }).click();
    await expect(first(page).getByRole('status')).toHaveText(legacy); await expect(second(page).getByRole('status')).toHaveText(verified);
    await expect(check).not.toBeChecked(); await assertOriginalImage(first(page), free); await assertOriginalImage(second(page), course);
    await page.getByRole('button', { name: '두 선택 닫기', exact: true }).click();
    await expect(image(first(page))).toHaveCount(0); await expect(image(second(page))).toHaveCount(0); await expect(selector(page, 0)).toHaveValue('');
    expect(await page.evaluate(() => (window as unknown as { comparisonPersistenceViolations: string[] }).comparisonPersistenceViolations)).toEqual([]);
    await selectReady(page, 0, course); await page.reload(); await expect(selector(page, 0)).toHaveValue(''); await expect(image(first(page))).toHaveCount(0);
    await selectReady(page, 0, course); await selectReady(page, 1, free, false);
    expect(await page.evaluate(() => (window as unknown as { comparisonPersistenceViolations: string[] }).comparisonPersistenceViolations)).toEqual([]);
    expect(await snapshot(qa.account)).toEqual(before); traffic.assertReadOnly(); expect(traffic.downloads.length).toBeGreaterThanOrEqual(2);
  } finally { traffic.stop(); }
});

test('current free and legacy course retain honest guide, zero time and missing historical context', async ({ page, qa }) => {
  const free = await seedAttempt(qa.account), course = await seedAttempt(qa.account, { kind: 'course', modern: false, mode: 'copy' });
  await login(page, qa.account); await synced(page); const before = await snapshot(qa.account), traffic = audit(page, before.state);
  try {
    await open(page, 2); await selectReady(page, 0, free); await selectReady(page, 1, course, false);
    await expect(first(page)).toContainText('선택한 안내 문장: 합성 비교 안내 문장'); await expect(first(page)).toContainText('획 접촉 구간 시간: 0초');
    await expect(second(page)).toContainText('현재 수업 이름:'); await expect(second(page)).toContainText('당시 1번 항목 문구 미확인');
    await assertOriginalImage(first(page), free); await assertOriginalImage(second(page), course);
    // Focus/resume removes decoded pixels and requires explicit selection again.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(image(first(page))).toHaveCount(0); await expect(image(second(page))).toHaveCount(0);
    await expect(selector(page, 0)).toHaveValue(''); await expect(selector(page, 1)).toHaveValue('');
    await expect(selector(page, 0).locator(`option[value="${free.id}"]`)).toHaveCount(1); await selectReady(page, 0, free);
    expect(await snapshot(qa.account)).toEqual(before); traffic.assertReadOnly();
  } finally { traffic.stop(); }
});

test('empty history never adopts generic resources, workbook markers or Storage-only remnants', async ({ page, qa }) => {
  const resourceId = randomUUID(), bytes = png(8, 8), path = `${qa.account.id}/${day}/handwriting-${resourceId}.png`;
  for (const [name, content, contentType] of [[path, bytes, 'image/png'], [`${qa.account.id}/learning/film-v1/ready.txt`, Buffer.from('synthetic only'), 'text/plain'], [`${qa.account.id}/${day}/orphan.png`, bytes, 'image/png']] as const) {
    expect((await qa.account.client.storage.from('growth-resources').upload(name, content, { contentType, upsert: false })).error).toBeNull();
  }
  expect((await qa.account.client.from('growth_resources').insert({ id: resourceId, user_id: qa.account.id, title: '연결 없는 합성 PNG', category: 'handwriting', storage_path: path, mime_type: 'image/png', size_bytes: bytes.length })).error).toBeNull();
  await login(page, qa.account); await synced(page); const before = await snapshot(qa.account), traffic = audit(page, before.state);
  try {
    await open(page, 0); await expect(page.getByText('아직 불러온 손글씨 기록이 없어요.', { exact: true })).toBeVisible();
    await expect(selector(page, 0).locator('option')).toHaveCount(1); await expect(image(first(page))).toHaveCount(0);
    expect(traffic.downloads).toEqual([]); expect(await snapshot(qa.account)).toEqual(before); traffic.assertReadOnly();
  } finally { traffic.stop(); }
});

test('one candidate, paper, missing link and unsupported records stay distinct from empty filtered results', async ({ page, qa }) => {
  const saved = await seedAttempt(qa.account), paper = randomUUID(), unsupported = randomUUID(), unlinked = randomUUID(), modernWithoutHash = randomUUID();
  const missingHash = { ...saved.metrics }; delete missingHash.pngSha256;
  expect((await qa.account.client.from('growth_sessions').insert([
    sessionRow(qa.account, paper, courseMetrics(null, '', qa.account.id, true, 'paper')),
    sessionRow(qa.account, unsupported, { practiceKind: 'future-handwriting-v9', resourceId: randomUUID() }),
    sessionRow(qa.account, unlinked, { guideText: '연결 없는 이전 연습', occupiedWidth: null, occupiedHeight: null, pressureRange: null }),
    sessionRow(qa.account, modernWithoutHash, { ...missingHash, resourceId: randomUUID() }),
  ])).error).toBeNull();
  await login(page, qa.account); await synced(page); const before = await snapshot(qa.account), traffic = audit(page, before.state);
  try {
    await open(page, 5); await expect(page.getByText(/현재 조건에서 이미지 후보가 한 개예요/)).toBeVisible();
    for (const [id, reason] of [[paper, '종이·다른 앱 연습 완료 기록이에요. 저장된 손글씨 이미지는 없어요.'], [unsupported, '이 자유 연습 기록의 버전은 지원하지 않아요.'], [unlinked, '저장 이미지와 연결된 식별자가 없어요.'], [modernWithoutHash, '저장 당시 이미지 해시나 자유 연습 정보가 올바르지 않아요.']] as const) {
      await selector(page, 0).selectOption(id); await expect(first(page).getByRole('status')).toHaveText(reason); await expect(image(first(page))).toHaveCount(0);
    }
    expect(traffic.downloads).toEqual([]);
    await page.getByLabel('기록 날짜부터', { exact: true }).fill('2002-01-01');
    await expect(page.getByText('불러온 기록 중 현재 조건에 맞는 기록이 없어요.', { exact: true })).toBeVisible();
    await expect(page.getByText('아직 불러온 손글씨 기록이 없어요.', { exact: true })).toHaveCount(0);
    await page.getByLabel('기록 날짜부터', { exact: true }).fill(''); await selectReady(page, 0, saved);
    expect(await snapshot(qa.account)).toEqual(before); traffic.assertReadOnly();
  } finally { traffic.stop(); }
});

test('missing metadata, missing/corrupt bytes, hash mismatch and read failure never borrow the other image', async ({ page, qa }) => {
  const good = await seedAttempt(qa.account), missing = await seedAttempt(qa.account, { missingResource: true }), absent = await seedAttempt(qa.account, { missingObject: true }), corrupt = await seedAttempt(qa.account, { corrupt: true }), mismatch = await seedAttempt(qa.account, { mismatch: true }), retry = await seedAttempt(qa.account);
  await login(page, qa.account); await synced(page); const before = await snapshot(qa.account), traffic = audit(page, before.state);
  const resources = '**/rest/v1/growth_resources*', sessions = '**/rest/v1/growth_sessions*';
  try {
    await open(page, 6); await selectReady(page, 0, good);
    for (const [saved, reason] of [[missing, '연결된 기록 또는 이미지 정보가 더 이상 없어요.'], [absent, '이미지가 없거나 PNG 형식·크기를 확인할 수 없어요.'], [corrupt, '이미지가 없거나 PNG 형식·크기를 확인할 수 없어요.'], [mismatch, '이미지가 저장 당시 해시와 달라 표시하지 않았어요.']] as const) {
      await selector(page, 1).selectOption(saved.id); await expect(second(page).getByRole('alert')).toHaveText(reason);
      await expect(image(second(page))).toHaveCount(0); await assertOriginalImage(first(page), good); await expect(second(page)).not.toContainText(legacy);
    }
    await page.route(resources, route => new URL(route.request().url()).searchParams.get('id') === `eq.${retry.resourceId}`
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic resource read unavailable"}' }) : route.fallback());
    await selector(page, 1).selectOption(retry.id); await expect(second(page).getByRole('alert')).toHaveText(readFailure);
    await expect(image(second(page))).toHaveCount(0); await assertOriginalImage(first(page), good); await page.unroute(resources);
    await page.getByRole('button', { name: '비교 기록 다시 확인', exact: true }).click(); await expect(second(page).getByRole('status')).toHaveText(verified); await assertOriginalImage(second(page), retry);
    await page.route(sessions, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic list failure"}' }));
    await page.getByRole('button', { name: '새로 불러오기', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: readFailure })).toBeVisible();
    await expect(page.getByText('아직 불러온 손글씨 기록이 없어요.', { exact: true })).toHaveCount(0); await expect(image(first(page))).toHaveCount(0);
    await page.unroute(sessions); await page.getByRole('button', { name: '새로 불러오기', exact: true }).click();
    await expect(selector(page, 0).locator(`option[value="${good.id}"]`)).toHaveCount(1); await selectReady(page, 0, good);
    expect(await snapshot(qa.account)).toEqual(before); traffic.assertReadOnly();
  } finally { await page.unroute(resources); await page.unroute(sessions); traffic.stop(); }
});

test('different saves with identical bytes may pair but duplicate resource claims cannot', async ({ page, qa }) => {
  const a = await seedAttempt(qa.account), b = await seedAttempt(qa.account), disputed = await seedAttempt(qa.account), duplicateId = randomUUID();
  expect(a.hash).toBe(b.hash);
  expect((await qa.account.client.from('growth_sessions').insert(sessionRow(qa.account, duplicateId, disputed.metrics))).error).toBeNull();
  await login(page, qa.account); await synced(page); const before = await snapshot(qa.account), traffic = audit(page, before.state);
  try {
    await open(page, 4); await selectReady(page, 0, a); await selectReady(page, 1, b);
    await assertOriginalImage(first(page), a); await assertOriginalImage(second(page), b);
    await expect(page.getByRole('region', { name: '연습 조건 안내' })).toContainText('선택한 안내 문장이 같아요. 실제로 쓴 내용을 확인한 것은 아니에요.');
    await page.getByRole('button', { name: '두 선택 닫기', exact: true }).click();
    const count = traffic.downloads.length;
    await selector(page, 0).selectOption(disputed.id);
    await expect(first(page).getByRole('status')).toHaveText('연습 이미지의 연결 또는 기록 형식을 확인할 수 없어요.');
    await expect(image(first(page))).toHaveCount(0);
    await expect(selector(page, 1).locator(`option[value="${duplicateId}"]`)).toBeDisabled();
    expect(traffic.downloads.length).toBe(count); expect(await snapshot(qa.account)).toEqual(before); traffic.assertReadOnly();
  } finally { traffic.stop(); }
});

test('unique-id pages expose more than 1000 tied-date records and retry a failed page without skipping ids', async ({ page, qa }) => {
  test.setTimeout(180_000);
  const ids = Array.from({ length: 1001 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  const rows = ids.map(id => sessionRow(qa.account, id, courseMetrics(null, '', qa.account.id, false, 'paper')));
  for (let index = 0; index < rows.length; index += 200) expect((await qa.account.client.from('growth_sessions').insert(rows.slice(index, index + 200))).error).toBeNull();
  await login(page, qa.account); await synced(page); const before = await snapshot(qa.account), traffic = audit(page, before.state);
  const pattern = '**/rest/v1/growth_sessions*'; let fail = true;
  try {
    await open(page, 50);
    await page.route(pattern, route => fail && new URL(route.request().url()).searchParams.get('id')?.startsWith('gt.')
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic next page failure"}' }) : route.fallback());
    await page.getByRole('button', { name: '더 불러오기', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: readFailure })).toBeVisible();
    await expect(selector(page, 0).locator('option')).toHaveCount(51); fail = false;
    await page.getByRole('button', { name: '목록 다시 시도', exact: true }).click(); await expect(selector(page, 0).locator('option')).toHaveCount(101);
    for (let count = 150; count <= 1000; count += 50) {
      await page.getByRole('button', { name: '더 불러오기', exact: true }).click(); await expect(selector(page, 0).locator('option')).toHaveCount(count + 1);
    }
    await page.getByRole('button', { name: '더 불러오기', exact: true }).click(); await expect(selector(page, 0).locator('option')).toHaveCount(1002);
    await expect(page.getByRole('button', { name: '더 불러오기', exact: true })).toHaveCount(0);
    const values = await selector(page, 0).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
    expect(values).toEqual(ids); expect(new Set(values).size).toBe(1001);
    await expect(page.getByRole('status').filter({ hasText: '불러온 기록 1001개 ·' })).toContainText('현재 조회의 끝까지');
    expect(await snapshot(qa.account)).toEqual(before); traffic.assertReadOnly(); expect(traffic.downloads).toEqual([]);
  } finally { await page.unroute(pattern); traffic.stop(); }
});

test('remote growth reset clears the pair on focus and retained originals never revive on reload', async ({ page, qa }) => {
  const a = await seedAttempt(qa.account), b = await seedAttempt(qa.account, { modern: false });
  await login(page, qa.account); await synced(page); const before = await snapshot(qa.account);
  await open(page, 2); await selectReady(page, 0, a); await selectReady(page, 1, b, false);
  // Explicit fixture setup simulates another device; it is not a comparison UI write.
  expect((await qa.account.client.rpc('reset_my_app_records', { p_app: 'growth', p_request_id: randomUUID(), p_confirmation: '초기화' })).error).toBeNull();
  const reset = await snapshot(qa.account); expect(reset.sessions).toEqual([]); expect(reset.resources).toEqual(before.resources); expect(reset.objects).toEqual(before.objects);
  expect(reset.state['ai-fitness-record-reset-growth']).not.toEqual(before.state['ai-fitness-record-reset-growth']);
  const traffic = audit(page, reset.state);
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(image(first(page))).toHaveCount(0); await expect(image(second(page))).toHaveCount(0);
    // The global synchronizer may safely reload the document when it sees the
    // remote reset, racing the reader's blocked alert. Both must remove pixels;
    // require either confirmed blocked state or fresh empty discovery, not a
    // transient alert that a successful safe reload has already replaced.
    await expect.poll(async () => await page.getByText('아직 불러온 손글씨 기록이 없어요.', { exact: true }).isVisible()
      || await page.getByRole('alert').filter({ hasText: '계정 또는 초기화 상태를 다시 확인해야 해요.' }).isVisible()).toBe(true);
    await page.getByRole('button', { name: '새로 불러오기', exact: true }).click(); await expect(page.getByText('아직 불러온 손글씨 기록이 없어요.', { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByText('아직 불러온 손글씨 기록이 없어요.', { exact: true })).toBeVisible();
    await expect(selector(page, 0).locator('option')).toHaveCount(1); await expect(image(first(page))).toHaveCount(0);
    expect(await snapshot(qa.account)).toEqual(reset); traffic.assertReadOnly(); expect(traffic.downloads).toEqual([]);
  } finally { traffic.stop(); }
});

test('delayed old selection cannot publish after replacement or a real owner switch', async ({ page, qa }) => {
  const a = await seedAttempt(qa.account), b = await seedAttempt(qa.account, { width: 32, height: 64 }), other = await qa.createAccount();
  const c = await seedAttempt(other, { kind: 'course' });
  await login(page, qa.account); await synced(page); const before = await snapshot(qa.account), otherBefore = await snapshot(other);
  const pattern = `**/storage/v1/object/growth-resources/${a.path}`, drain = new RouteDrain();
  const hold = async () => {
    let release!: () => void, arrive!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; }), arrived = new Promise<void>(resolve => { arrive = resolve; });
    await page.route(pattern, route => drain.run(async () => { const response = await route.fetch(); expect(response.ok()).toBe(true); arrive(); await released; await route.fulfill({ response }); }));
    return { release, arrived };
  };
  const traffic = audit(page, before.state); let pending: Awaited<ReturnType<typeof hold>> | undefined;
  try {
    await open(page, 2); pending = await hold(); await selector(page, 0).selectOption(a.id); await pending.arrived;
    await selectReady(page, 0, b); pending.release(); await drain.wait(); await page.unroute(pattern); await assertOriginalImage(first(page), b); await expect(selector(page, 0)).toHaveValue(b.id);
    pending = await hold(); await selector(page, 0).selectOption(a.id); await pending.arrived;
    await page.getByRole('button', { name: '로그아웃', exact: true }).click(); await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
    await page.getByLabel('이메일', { exact: true }).fill(other.email); await page.getByLabel('비밀번호', { exact: true }).fill(other.password);
    await page.getByRole('button', { name: 'AI 연이 시작', exact: true }).click(); await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
    await reauthenticateFixtureAccount(qa.account); await reauthenticateFixtureAccount(other);
    pending.release(); await drain.wait(); await page.unroute(pattern);
    await expect(selector(page, 0).locator(`option[value="${c.id}"]`)).toHaveCount(1);
    await expect(selector(page, 0).locator(`option[value="${a.id}"]`)).toHaveCount(0); await expect(selector(page, 0)).toHaveValue('');
    await selectReady(page, 0, c); await assertOriginalImage(first(page), c); await expect(second(page).getByRole('img')).toHaveCount(0);
    expect(await snapshot(qa.account)).toEqual(before); expect(await snapshot(other)).toEqual(otherBefore); traffic.assertReadOnly();
  } finally { pending?.release(); await drain.wait(); await page.unroute(pattern); traffic.stop(); }
});
