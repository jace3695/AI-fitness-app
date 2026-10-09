import { randomUUID } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { test, expect, login, originalLanguage, Traffic } from './fixture';
import { RouteDrain } from './route-drain';
import { reauthenticateFixtureAccount, type FixtureAccount } from './fixture-account-auth';
import { createLanguageLiveRepository } from '../../app/data/languageLiveRepository';
import { createLanguageLiveLearningRepository } from '../../app/data/languageLiveLearningRepository';
import { createLanguageLivePreparationRepository } from '../../app/data/languageLivePreparationRepository';
import { parseLiveReport } from '../../lib/language-live/report-parser';
import { LIVE_REPORT_FIELDS } from '../../lib/language-live/types';

const workspace = (page: Page) => page.locator('.live-preparation-workspace');
const readRpc = '**/rest/v1/rpc/read_language_live_learning';
const saveRpc = '**/rest/v1/rpc/save_language_live_preparation';
const readbackUrl = '**/rest/v1/language_live_preparations?*';
async function ready(page: Page) { await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible(); }
async function open(page: Page) {
  await ready(page); await page.getByRole('button', { name: '다음 AI 수업 준비', exact: true }).click();
  await expect(workspace(page).getByRole('button', { name: '최신 자료로 새 지시문 생성', exact: true })).toBeEnabled();
  await expect(workspace(page).getByRole('button', { name: '준비 자료 새로고침', exact: true })).toBeEnabled();
}
async function generate(page: Page) {
  await workspace(page).getByLabel('준비할 수업 날짜 (한국 시간)', { exact: true }).fill('2026-10-10');
  await workspace(page).getByRole('button', { name: '최신 자료로 새 지시문 생성', exact: true }).click();
}
async function save(page: Page, revision = 1) {
  await workspace(page).getByRole('checkbox', { name: '내용·출처·불확실성과 개인 정보 포함 여부를 검토했어요.' }).check();
  await workspace(page).getByRole('button', { name: '확인본 서버에 저장', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: `수업 준비 서버 저장 확인 · 버전 ${revision}` })).toBeVisible();
  await expect(workspace(page).getByRole('button', { name: '준비 자료 새로고침', exact: true })).toBeEnabled();
}
async function relogin(page: Page, account: FixtureAccount) {
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(account.email); await page.getByLabel('비밀번호', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'AI 연이 시작', exact: true }).click(); await ready(page);
  await test.step('Reauthenticate the independent fixture verifier after global logout', () => reauthenticateFixtureAccount(account));
}
// Clipboard interception only proves app success/failure handling, not a physical OS clipboard.
async function clipboard(page: Page, denied = false) {
  await page.evaluate(deny => {
    const writes: string[] = []; Object.defineProperty(window, '__liveCopyWrites', { configurable: true, value: writes });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { if (deny) throw new DOMException('Synthetic denied clipboard', 'NotAllowedError'); writes.push(text); } } });
  }, denied);
}
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __liveCopyWrites: string[] }).__liveCopyWrites);

// Authored for disposable authenticated local Auth/PostgREST. Actual execution is a separate gate.
test('Live P3 first lesson preserves exact 25 labels and generated/edited revisions through reload and independent session', async ({ page, qa, browser }) => {
  const repository = createLanguageLivePreparationRepository(qa.account.client, qa.account.id);
  await login(page, qa.account, '/language/live'); await open(page); await generate(page);
  const editor = workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true });
  const original = await editor.inputValue(); expect(original).toContain('첫 수업용');
  expect(original.split('[연이 AI 일본어 학습 기록 v1.1]\n')[1]).toBe(LIVE_REPORT_FIELDS.map(field => `${field.label}:`).join('\n'));
  await expect(workspace(page).getByRole('button', { name: '확인본 서버에 저장', exact: true })).toBeDisabled();
  const edited = `${original}\n직접 확인한 추가 요청: 천천히 설명해 줘.`; await editor.fill(edited); await save(page);
  let rows = await repository.listPreparations(); expect(rows).toHaveLength(1); expect(rows[0].payload.preparation.generatedText).toBe(original); expect(rows[0].payload.editedText).toBe(edited);
  await clipboard(page); await workspace(page).getByRole('button', { name: '수업 지시문 복사', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: '클립보드에 복사했어요.' })).toBeVisible(); expect(await copied(page)).toEqual([edited]);
  await page.reload({ waitUntil: 'domcontentloaded' }); await open(page); await workspace(page).getByRole('button', { name: '준비 버전 1 보기', exact: true }).click();
  await expect(workspace(page).getByLabel('저장한 전달용 지시문', { exact: true })).toHaveValue(edited);
  await workspace(page).getByRole('button', { name: '이 버전으로 수정 시작', exact: true }).click(); await editor.fill(`${edited}\n두 번째 확인본`); await save(page, 2);
  rows = await repository.listPreparations(); expect(rows).toHaveLength(2); expect(rows.map(row => row.revision).sort()).toEqual([1, 2]); expect(rows.every(row => row.payload.preparation.generatedText === original)).toBe(true);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), traffic = new Traffic('Live-preparation-independent'); await traffic.install(context);
  try { const second = await context.newPage(); await login(second, qa.account, '/language/live'); await open(second); await workspace(second).getByRole('button', { name: '준비 버전 2 보기', exact: true }).click(); await expect(workspace(second).getByLabel('저장한 전달용 지시문', { exact: true })).toHaveValue(`${edited}\n두 번째 확인본`); }
  finally { traffic.releaseAll(); await traffic.drain(); await context.unrouteAll({ behavior: 'wait' }); await context.close(); expect(traffic.blockedOrigins.size).toBe(0); }
  expect(await qa.readLanguage()).toEqual(originalLanguage);
});

test('Live P3 confirmed relearning, yesterday and unknown other skills appear at narrow and tablet widths', async ({ page, qa }, info) => {
  const report = parseLiveReport('[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: 2026-10-09\n수업 주제: 합성 え 복습\n현재 학습 단계: 히라가나 기초\n쓰기 학습 결과: 미학습\n학습 중 발견한 망각 항목: え를 기억하지 못해 망각을 재확인했다.\n이전 학습 복습 결과: え를 다시 확인해야 한다.\n다음 수업 권장 내용: 복습 후 か행을 확인한다.');
  const lesson = await createLanguageLiveRepository(qa.account.client, qa.account.id).saveLesson({ requestId: randomUUID(), lessonId: randomUUID(), expectedRevision: 0, report });
  const item = { itemId: randomUUID(), kind: 'kana' as const, text: 'え', meaning: '' };
  await createLanguageLiveLearningRepository(qa.account.client, qa.account.id).saveLearning({ requestId: randomUUID(), lessonId: lesson.lesson_id, lessonRevision: 1, expectedVersion: 0, confirmed: true, policyVersion: 'live-review-v1', changeReason: '합성 재학습 필요 확인', events: [
    { eventId: randomUUID(), item, skill: 'reading', kind: 'forgetting', result: 'cannot_recall', occurredDate: '2026-10-09', certainty: 'confirmed', independent: false, hintUsed: false, forgettingConfirmed: true, evidenceText: 'え를 기억하지 못해 망각을 재확인했다.', sourceField: 'forgettingObservations', reason: '보고서의 명시적 망각 재확인', relearningText: '', linkedRelearningEventId: null, teacherRecommendedDue: null, teacherRecommendationConfirmed: false },
    { eventId: randomUUID(), item, skill: 'writing', kind: 'not_learned', result: 'not_assessed', occurredDate: '2026-10-09', certainty: 'confirmed', independent: null, hintUsed: null, forgettingConfirmed: false, evidenceText: '미학습', sourceField: 'writing', reason: '쓰기 미학습 확인', relearningText: '', linkedRelearningEventId: null, teacherRecommendedDue: null, teacherRecommendationConfirmed: false },
  ] });
  await page.setViewportSize({ width: 320, height: 844 }); await login(page, qa.account, '/language/live'); await open(page); await generate(page);
  const text = await workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true }).inputValue();
  expect(text).toContain('전날 (2026-10-09)'); expect(text).toContain('현재 재학습 필요'); expect(text).toContain('듣기 미확인 / 말하기 미확인 / 읽기 재학습 필요 / 쓰기 미학습'); expect(text).toContain('복습 후 か행'); expect(text).toContain(lesson.lesson_id);
  await save(page); await workspace(page).screenshot({ path: `.e2e/evidence/language-live-preparation-320-${info.project.name}.png`, animations: 'disabled', caret: 'hide' }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 768, height: 1024 }); await workspace(page).screenshot({ path: `.e2e/evidence/language-live-preparation-768-${info.project.name}.png`, animations: 'disabled', caret: 'hide' }); expect(await qa.readLanguage()).toEqual(originalLanguage);
});

test('Live P3 changed or deleted sources block stale copy while saved history remains intact', async ({ page, qa }) => {
  const reports = createLanguageLiveRepository(qa.account.client, qa.account.id);
  const lesson = await reports.saveLesson({ requestId: randomUUID(), lessonId: randomUUID(), expectedRevision: 0, report: parseLiveReport('학습 날짜: 2026-10-09\n수업 주제: 나중에 휴지통으로 옮길 합성 내용') });
  await login(page, qa.account, '/language/live'); await open(page); await generate(page); await save(page); await clipboard(page);
  const before = await workspace(page).getByLabel('저장한 전달용 지시문', { exact: true }).inputValue();
  await reports.deleteLesson({ requestId: randomUUID(), lessonId: lesson.lesson_id, expectedRevision: 1 });
  await workspace(page).getByRole('button', { name: '수업 지시문 복사', exact: true }).click();
  await expect(workspace(page).getByRole('alert').filter({ hasText: '생성 뒤 학습 기록이 바뀌었어요.' })).toBeVisible(); expect(await copied(page)).toEqual([]);
  await expect(workspace(page).getByLabel('저장한 전달용 지시문', { exact: true })).toHaveValue(before); await expect(workspace(page).getByRole('button', { name: '수업 지시문 복사', exact: true })).toBeDisabled();
  await generate(page); const next = await workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true }).inputValue(); expect(next).not.toContain('나중에 휴지통으로 옮길 합성 내용'); expect(next).toContain('첫 수업용');
  expect((await createLanguageLivePreparationRepository(qa.account.client, qa.account.id).listPreparations())[0].payload.editedText).toBe(before);
});

test('Live P3 clipboard denial has a manual-selection fallback without a false copied status', async ({ page, qa }) => {
  await login(page, qa.account, '/language/live'); await open(page); await generate(page); await save(page); await clipboard(page, true);
  await workspace(page).getByRole('button', { name: '수업 지시문 복사', exact: true }).click();
  await expect(workspace(page).getByRole('alert').filter({ hasText: '자동 복사를 허용하지 않았거나 지원하지 않아요.' })).toBeVisible();
  await expect(workspace(page).getByRole('status').filter({ hasText: '클립보드에 복사했어요.' })).toHaveCount(0);
  await workspace(page).getByRole('button', { name: '지시문 전체 선택', exact: true }).click();
  expect(await workspace(page).getByLabel('저장한 전달용 지시문', { exact: true }).evaluate(element => { const area = element as HTMLTextAreaElement; return area.selectionStart === 0 && area.selectionEnd === area.value.length; })).toBe(true);
});

test('Live P3 pending readback recovery retries exact request after reload and preserves original generation', async ({ page, qa }) => {
  await login(page, qa.account, '/language/live'); await open(page); await generate(page);
  await workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true }).fill('읽기와 쓰기는 따로 확인해 줘.');
  const requests: unknown[] = []; page.on('request', request => { if (request.url().endsWith('/rpc/save_language_live_preparation')) requests.push(request.postDataJSON().p_payload); });
  await page.route(readbackUrl, route => route.fulfill({ status: 500, json: { message: 'synthetic post-commit verification loss' } }));
  await workspace(page).getByRole('checkbox', { name: '내용·출처·불확실성과 개인 정보 포함 여부를 검토했어요.' }).check(); await workspace(page).getByRole('button', { name: '확인본 서버에 저장', exact: true }).click();
  await expect(workspace(page).getByRole('button', { name: '같은 요청으로 준비 저장 다시 확인', exact: true })).toBeEnabled(); await expect(workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true })).toBeDisabled();
  page.on('dialog', dialog => dialog.accept()); await page.reload({ waitUntil: 'domcontentloaded' }); await open(page);
  await workspace(page).getByText(/^이 계정의 수업 준비 기기 초안 \d+개$/).click(); await workspace(page).getByRole('button', { name: /준비 초안.*저장 결과 확인 필요/ }).first().click();
  await page.unroute(readbackUrl); await workspace(page).getByRole('button', { name: '같은 요청으로 준비 저장 다시 확인', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: '수업 준비 서버 저장 확인 · 버전 1' })).toBeVisible(); expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
  const rows = await createLanguageLivePreparationRepository(qa.account.client, qa.account.id).listPreparations(); expect(rows).toHaveLength(1); expect(rows[0].payload.editedText).toBe('읽기와 쓰기는 따로 확인해 줘.');
});

test('Live P3 copy cancellation ignores delayed source response and keeps the dismissed preview closed', async ({ page, qa }) => {
  await login(page, qa.account, '/language/live'); await open(page); await generate(page); await save(page); await clipboard(page);
  const drain = new RouteDrain(); let release!: () => void, arrived!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; });
  const delayed = (route: Route) => drain.run(async () => { const response = await route.fetch({ maxRetries: 0 }); arrived(); await released; await route.fulfill({ response }); });
  await page.route(readRpc, delayed);
  try {
    await workspace(page).getByRole('button', { name: '수업 지시문 복사', exact: true }).click(); await seen;
    await workspace(page).getByRole('button', { name: '복사 확인 취소', exact: true }).click(); await workspace(page).getByRole('button', { name: '지시문 닫기', exact: true }).click();
    release(); await drain.wait(); await expect(workspace(page).getByRole('heading', { name: '지시문 확인', exact: true })).toHaveCount(0); expect(await copied(page)).toEqual([]);
  } finally { release(); await drain.wait(); await page.unroute(readRpc, delayed); }
});

test('Live P3 two tabs preserve independent recovery and cancel/back/forward do not save or erase drafts', async ({ page, context, qa }) => {
  await login(page, qa.account, '/language/live'); await open(page); await generate(page); await workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true }).fill('A 탭 초안');
  await workspace(page).getByRole('button', { name: '이 준비 초안 지우기', exact: true }).click(); await workspace(page).getByRole('button', { name: '초안 지우기 취소', exact: true }).click();
  const second = await context.newPage();
  try {
    await second.goto('/language/live', { waitUntil: 'domcontentloaded' }); await open(second); await workspace(second).getByText(/^이 계정의 수업 준비 기기 초안 \d+개$/).click(); await workspace(second).getByRole('button', { name: /준비 초안 ·/ }).first().click();
    await workspace(second).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true }).fill('B 탭 초안'); await expect(workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true })).toHaveValue('A 탭 초안');
    const drafts = await page.evaluate(owner => Object.keys(localStorage).filter(key => key.startsWith(`yeoni-language-live:${owner}:preparation-draft:v1:`)).map(key => JSON.parse(localStorage.getItem(key)!)), qa.account.id); expect(drafts).toHaveLength(2); expect(new Set(drafts.map(draft => draft.draftId)).size).toBe(2);
    page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('link', { name: '← 일본어 학습', exact: true }).click(); await expect(page).toHaveURL(/\/language\/live$/);
    page.on('dialog', dialog => dialog.accept()); await page.getByRole('link', { name: '← 일본어 학습', exact: true }).click(); await expect(page).toHaveURL(/\/language$/);
    await page.goBack({ waitUntil: 'domcontentloaded' }); await open(page); await workspace(page).getByText(/^이 계정의 수업 준비 기기 초안 \d+개$/).click(); await workspace(page).getByRole('button', { name: /준비 초안 ·/ }).first().click(); await expect(workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true })).not.toHaveValue('');
    await page.goForward({ waitUntil: 'domcontentloaded' }); await expect(page).toHaveURL(/\/language$/); expect((await createLanguageLivePreparationRepository(qa.account.client, qa.account.id).listPreparations())).toHaveLength(0);
  } finally { await second.close(); }
});

test('Live P3 missing source storage never becomes a fake first lesson', async ({ page, qa }) => {
  await login(page, qa.account, '/language/live'); await open(page);
  await page.route(readRpc, route => route.fulfill({ status: 404, json: { code: 'PGRST202', message: 'synthetic missing function' } }));
  await workspace(page).getByRole('button', { name: '준비 자료 새로고침', exact: true }).click(); await expect(workspace(page).getByRole('alert').filter({ hasText: '기록이 없는 상태로 처리하지 않았어요.' })).toBeVisible();
  await expect(workspace(page).getByRole('button', { name: '최신 자료로 새 지시문 생성', exact: true })).toBeDisabled(); await expect(workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true })).toHaveCount(0);
});

test('Live P3 in-flight owner A save cannot appear in B and original A request recovers once', async ({ page, qa }) => {
  const other = await qa.createAccount(); await login(page, qa.account, '/language/live'); await open(page); await generate(page);
  await workspace(page).getByRole('checkbox', { name: '내용·출처·불확실성과 개인 정보 포함 여부를 검토했어요.' }).check();
  const drain = new RouteDrain(); let release!: () => void, arrived!: () => void, hold = true;
  const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; }); const requests: string[] = [];
  const delayed = (route: Route) => drain.run(async () => { requests.push(route.request().postDataJSON().p_payload.requestId); const response = await route.fetch({ maxRetries: 0 }); expect(response.status()).toBe(200); if (hold) { hold = false; arrived(); await released; } await route.fulfill({ response }); });
  await page.route(saveRpc, delayed);
  try {
    await workspace(page).getByRole('button', { name: '확인본 서버에 저장', exact: true }).click(); await seen; await relogin(page, other); await open(page); release(); await drain.wait();
    await expect(workspace(page).getByRole('status').filter({ hasText: '수업 준비 서버 저장 확인' })).toHaveCount(0); await expect(workspace(page).getByText(/이 계정의 수업 준비 기기 초안/)).toHaveCount(0);
    expect(await createLanguageLivePreparationRepository(other.client, other.id).listPreparations()).toHaveLength(0);
    await relogin(page, qa.account); await open(page); await workspace(page).getByText(/^이 계정의 수업 준비 기기 초안 \d+개$/).click(); await workspace(page).getByRole('button', { name: /준비 초안.*저장 결과 확인 필요/ }).first().click();
    await workspace(page).getByRole('button', { name: '같은 요청으로 준비 저장 다시 확인', exact: true }).click(); await expect(workspace(page).getByRole('status').filter({ hasText: '수업 준비 서버 저장 확인 · 버전 1' })).toBeVisible();
    expect(requests).toHaveLength(2); expect(new Set(requests).size).toBe(1); expect(await createLanguageLivePreparationRepository(qa.account.client, qa.account.id).listPreparations()).toHaveLength(1);
    const denied = await other.client.from('language_live_preparations').select('*').eq('user_id', qa.account.id); expect(denied.error).toBeNull(); expect(denied.data).toEqual([]); expect(await qa.readLanguage()).toEqual(originalLanguage);
  } finally { release(); await drain.wait(); await page.unroute(saveRpc, delayed); }
});

test('Live P3 saved preview remains closable after local cleanup failure', async ({ page, qa }) => {
  await login(page, qa.account, '/language/live'); await open(page); await generate(page);
  await page.evaluate(owner => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (this === localStorage && key.startsWith(`yeoni-language-live:${owner}:preparation-draft:v1:`)) throw new DOMException('Synthetic cleanup failure', 'QuotaExceededError');
      original.call(this, key);
    };
  }, qa.account.id);
  await save(page);
  await expect(workspace(page).getByRole('alert').filter({ hasText: '서버 저장은 확인했지만 기기 초안 보관본은 남아' })).toBeVisible();
  await workspace(page).getByRole('button', { name: '지시문 닫기', exact: true }).click();
  await expect(workspace(page).getByLabel('저장한 전달용 지시문', { exact: true })).toHaveCount(0);
  expect(await createLanguageLivePreparationRepository(qa.account.client, qa.account.id).listPreparations()).toHaveLength(1);
});

test('Live P3 latest history must settle before editing and older versions create clearly separate copies', async ({ page, qa }) => {
  await login(page, qa.account, '/language/live'); await open(page); await generate(page);
  const historyRpc = '**/rest/v1/rpc/read_language_live_preparations', drain = new RouteDrain();
  let release!: () => void, arrived!: () => void, hold = true;
  const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; });
  const delayed = (route: Route) => drain.run(async () => { const response = await route.fetch({ maxRetries: 0 }); if (hold) { hold = false; arrived(); await released; } await route.fulfill({ response }); });
  await page.route(historyRpc, delayed);
  try {
    await workspace(page).getByRole('checkbox', { name: '내용·출처·불확실성과 개인 정보 포함 여부를 검토했어요.' }).check();
    await workspace(page).getByRole('button', { name: '확인본 서버에 저장', exact: true }).click(); await seen;
    await expect(workspace(page).getByRole('button', { name: '이 버전으로 수정 시작', exact: true })).toBeDisabled();
    release(); await drain.wait(); await expect(workspace(page).getByRole('button', { name: '이 버전으로 수정 시작', exact: true })).toBeEnabled();
    await workspace(page).getByRole('button', { name: '이 버전으로 수정 시작', exact: true }).click();
    await workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true }).fill('최신 확인본'); await save(page, 2);
    const repository = createLanguageLivePreparationRepository(qa.account.client, qa.account.id), before = await repository.listPreparations();
    expect(new Set(before.map(record => record.preparation_id)).size).toBe(1);
    await workspace(page).getByRole('button', { name: '준비 버전 1 보기', exact: true }).click();
    await expect(workspace(page).getByText('과거 버전의 수정은 별도 준비문으로 저장해요. 기존 준비문의 최신 버전과 이력은 그대로 남아요.', { exact: true })).toBeVisible();
    await workspace(page).getByRole('button', { name: '이 버전으로 수정 시작', exact: true }).click(); await save(page);
    const after = await repository.listPreparations(); expect(after).toHaveLength(3); expect(new Set(after.map(record => record.preparation_id)).size).toBe(2);
    expect(after.filter(record => record.preparation_id === before[0].preparation_id)).toEqual(before);
  } finally { release(); await drain.wait(); await page.unroute(historyRpc, delayed); }
});

test('Live P3 manual fallback is disabled when fresh source verification later fails', async ({ page, qa }) => {
  await login(page, qa.account, '/language/live'); await open(page); await generate(page); await save(page); await clipboard(page, true);
  await workspace(page).getByRole('button', { name: '수업 지시문 복사', exact: true }).click();
  await expect(workspace(page).getByRole('button', { name: '지시문 전체 선택', exact: true })).toBeEnabled();
  await page.route(readRpc, route => route.fulfill({ status: 503, json: { message: 'synthetic freshness unavailable' } }));
  await workspace(page).getByRole('button', { name: '준비 자료 새로고침', exact: true }).click();
  await expect(workspace(page).getByRole('alert').filter({ hasText: '기록이 없는 상태로 처리하지 않았어요.' })).toBeVisible();
  await expect(workspace(page).getByRole('button', { name: '지시문 전체 선택', exact: true })).toBeDisabled();
  await expect(workspace(page).getByRole('button', { name: '수업 지시문 복사', exact: true })).toBeDisabled(); expect(await copied(page)).toEqual([]);
});

test('Live P3 browser clipboard completion after an account switch cannot report success to the next owner', async ({ page, qa }) => {
  const other = await qa.createAccount(); await login(page, qa.account, '/language/live'); await open(page); await generate(page);
  await workspace(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true }).fill('A 계정의 확인본'); await save(page);
  await page.evaluate(() => {
    const writes: string[] = []; Object.defineProperty(window, '__liveCopyWrites', { configurable: true, value: writes });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => new Promise<void>(resolve => {
      Object.defineProperty(window, '__finishLiveCopy', { configurable: true, value: () => { writes.push(text); resolve(); } });
    }) } });
  });
  await workspace(page).getByRole('button', { name: '수업 지시문 복사', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: '클립보드 복사 결과를 확인하는 중' })).toBeVisible();
  await expect(workspace(page).getByText(/클립보드 쓰기 요청 후에는 앱에서 취소할 수 없어요/)).toBeVisible();
  await expect(workspace(page).getByRole('button', { name: '복사 확인 취소', exact: true })).toHaveCount(0);
  await relogin(page, other); await open(page);
  await page.evaluate(() => (window as unknown as { __finishLiveCopy: () => void }).__finishLiveCopy());
  expect(await copied(page)).toEqual(['A 계정의 확인본']);
  await expect(workspace(page).getByRole('status').filter({ hasText: '클립보드에 복사했어요' })).toHaveCount(0);
  await expect(workspace(page).getByLabel('저장한 전달용 지시문', { exact: true })).toHaveCount(0);
  expect(await createLanguageLivePreparationRepository(other.client, other.id).listPreparations()).toHaveLength(0);
});
