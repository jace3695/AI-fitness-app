import { randomUUID } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect, login, originalLanguage } from './fixture';
import { RouteDrain } from './route-drain';
import { reauthenticateFixtureAccount, type FixtureAccount } from './fixture-account-auth';
import { createLanguageLiveRepository } from '../../app/data/languageLiveRepository';
import { createLanguageLiveLearningRepository } from '../../app/data/languageLiveLearningRepository';
import { createLanguageLivePreparationRepository } from '../../app/data/languageLivePreparationRepository';
import { parseLiveReport } from '../../lib/language-live/report-parser';
import { liveOverviewDate } from '../../lib/language-live/overview';
import { addLiveCalendarDays } from '../../lib/language-live/review-policy';
import type { LiveLearningEvent } from '../../lib/language-live/learning-types';

const main = (page: Page) => page.getByRole('region', { name: '나의 AI Live 학습', exact: true });
const calendar = (page: Page) => page.getByRole('region', { name: '달력의 AI Live 기록', exact: true });
const preparation = (page: Page) => page.locator('.live-preparation-workspace');
const readRpc = '**/rest/v1/rpc/read_language_live_learning';
type DataAccount = FixtureAccount & { client: SupabaseClient };
const raw = (date: string, topic = '합성 메인 수업', stage = '기초') => `학습 날짜: ${date}\n수업 주제: ${topic}\n현재 학습 단계: ${stage}\n읽기 학습 결과: え를 배웠다.\n이전 학습 복습 결과: え를 정확하게 읽었다.\n학습 중 발견한 망각 항목: え를 기억하지 못해 망각을 다시 확인했다.\n재학습 수행 내역: え를 다시 써 보았다.\n평가 근거 및 불확실성: 듣기 평가는 불확실하다.`;
async function seed(account: DataAccount, date = liveOverviewDate(), topic?: string, stage?: string) {
  return createLanguageLiveRepository(account.client, account.id).saveLesson({ requestId: randomUUID(), lessonId: randomUUID(), expectedRevision: 0, report: parseLiveReport(raw(date, topic, stage)) });
}
function event(patch: Partial<LiveLearningEvent> = {}): LiveLearningEvent {
  return { eventId: randomUUID(), item: { itemId: randomUUID(), kind: 'kana', text: 'え', meaning: '' }, skill: 'reading', kind: 'review', result: 'independent_correct',
    occurredDate: addLiveCalendarDays(liveOverviewDate(), -1), certainty: 'confirmed', independent: true, hintUsed: false, forgettingConfirmed: false,
    evidenceText: 'え를 정확하게 읽었다.', sourceField: 'previousReviewResults', reason: '합성 실제 관찰 확인', relearningText: '', linkedRelearningEventId: null,
    teacherRecommendedDue: null, teacherRecommendationConfirmed: false, ...patch };
}
async function seedActivity(account: DataAccount) {
  const lesson = await seed(account), item = event().item;
  await createLanguageLiveLearningRepository(account.client, account.id).saveLearning({ requestId: randomUUID(), lessonId: lesson.lesson_id, lessonRevision: lesson.revision,
    expectedVersion: 0, confirmed: true, policyVersion: 'live-review-v1', changeReason: '합성 영역별 상태 확인', events: [
      event({ item }),
      event({ item, skill: 'speaking', kind: 'forgetting', result: 'cannot_recall', independent: null, hintUsed: null, forgettingConfirmed: true,
        evidenceText: 'え를 기억하지 못해 망각을 다시 확인했다.', sourceField: 'forgettingObservations' }),
      event({ item, skill: 'writing', kind: 'relearn', result: 'not_assessed', independent: null, hintUsed: null,
        evidenceText: 'え를 다시 써 보았다.', sourceField: 'relearningActivities', relearningText: '다시 쓰기' }),
      event({ item, skill: 'listening', result: 'uncertain', certainty: 'uncertain', independent: null, hintUsed: null,
        evidenceText: '듣기 평가는 불확실하다.', sourceField: 'evidenceAndUncertainty' }),
    ] });
  return lesson;
}
async function ready(page: Page) { await expect(main(page).getByRole('button', { name: 'Live 현황 새로고침', exact: true })).toBeEnabled(); }
async function refresh(page: Page) { await main(page).getByRole('button', { name: 'Live 현황 새로고침', exact: true }).click(); await ready(page); }
async function relogin(page: Page, account: FixtureAccount) {
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(account.email); await page.getByLabel('비밀번호', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'AI 연이 시작', exact: true }).click(); await ready(page);
  await reauthenticateFixtureAccount(account);
}

// Authored for the disposable Auth/PostgREST/browser fixture. Execution is a
// separate gate; no hosted accounts, data, provider calls or deployment are used.
test('Live overview exposes current results and safe direct actions at 320 390 and 768 pixels', async ({ page, qa }) => {
  await seedActivity(qa.account); await login(page, qa.account, '/language'); await ready(page);
  await expect(main(page).getByRole('heading', { name: '최근 학습 결과', exact: true })).toBeVisible();
  await expect(main(page).getByRole('region', { name: '현재 학습 단계', exact: true }).getByText('기초', { exact: true })).toBeVisible();
  await expect(main(page).getByRole('region', { name: '재학습 필요 항목', exact: true }).getByText('1개 영역', { exact: true })).toBeVisible();
  await expect(main(page).getByText('쓰기: 미확인', { exact: true })).toBeVisible();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(main(page).getByRole('link', { name: '다음 AI 수업 준비', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await main(page).getByRole('link', { name: '다음 AI 수업 준비', exact: true }).click();
  await expect(page).toHaveURL(/\/language\/live\?view=prepare$/);
  await expect(preparation(page).getByRole('heading', { name: '다음 AI 수업 준비', exact: true })).toBeVisible();
  await expect(preparation(page).getByRole('button', { name: '최신 자료로 새 지시문 생성', exact: true })).toBeEnabled();
  await expect(preparation(page).getByRole('heading', { name: '지시문 확인', exact: true })).toHaveCount(0);
  expect(await createLanguageLivePreparationRepository(qa.account.client, qa.account.id).listPreparations()).toEqual([]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(preparation(page).getByRole('heading', { name: '다음 AI 수업 준비', exact: true })).toBeVisible();
  await page.goBack({ waitUntil: 'domcontentloaded' }); await ready(page);
  await main(page).getByRole('link', { name: 'AI Live 기록 가져오기', exact: true }).click();
  await expect(page.getByRole('button', { name: '보고서 가져오기', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goto('/language/live?view=invalid');
  await expect(page.getByRole('button', { name: '보고서 가져오기', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(await qa.readLanguage()).toEqual(originalLanguage);
});

test('Live overview excludes edited deleted restored stale evidence future lessons and ambiguous same-day stages', async ({ page, qa }) => {
  const lesson = await seedActivity(qa.account), repository = createLanguageLiveRepository(qa.account.client, qa.account.id), today = liveOverviewDate();
  await login(page, qa.account, '/language'); await ready(page);
  await repository.saveLesson({ requestId: randomUUID(), lessonId: lesson.lesson_id, expectedRevision: 1, report: parseLiveReport(raw(today, '수정된 근거', '미확인')) });
  await refresh(page); await expect(main(page).getByRole('region', { name: '현재 학습 단계', exact: true }).getByText('미확인', { exact: true })).toBeVisible();
  await expect(main(page).getByRole('region', { name: '재학습 필요 항목', exact: true }).getByText('0개 영역', { exact: true })).toBeVisible();
  await repository.deleteLesson({ requestId: randomUUID(), lessonId: lesson.lesson_id, expectedRevision: 2 }); await refresh(page);
  await expect(main(page).getByText('아직 저장한 AI Live 수업이 없어요. 수업 보고서를 가져오거나 첫 수업을 준비해 보세요.', { exact: true })).toBeVisible();
  await repository.restoreLesson({ requestId: randomUUID(), lessonId: lesson.lesson_id, expectedRevision: 3, restoreRevision: 1 }); await refresh(page);
  await expect(main(page).getByRole('region', { name: '재학습 필요 항목', exact: true }).getByText('0개 영역', { exact: true })).toBeVisible();
  await seed(qa.account, today, '같은 날 다른 단계', '초급'); await seed(qa.account, addLiveCalendarDays(today, 1)!, '미래 수업', '미래 상급'); await refresh(page);
  await expect(main(page).getByRole('region', { name: '현재 학습 단계', exact: true }).getByText('미확인', { exact: true })).toBeVisible();
  await expect(main(page).getByText('같은 최근 날짜의 단계가 서로 달라요. 원본 수업을 확인해 주세요.', { exact: true })).toBeVisible();
  await expect(main(page).getByText('미래 수업', { exact: true })).toHaveCount(0);
  await main(page).getByRole('link', { name: '복습·학습 상태 보기', exact: true }).click();
  await expect(page.locator('.live-learning-workspace').getByText('최근 확인한 학습 단계: 미확인', { exact: true })).toBeVisible();
  expect(await qa.readLanguage()).toEqual(originalLanguage);
});

test('Live calendar overlays source-specific badges without changing legacy day or streak records', async ({ page, qa }) => {
  await seedActivity(qa.account); const today = liveOverviewDate(), yesterday = addLiveCalendarDays(today, -1)!;
  await login(page, qa.account, '/language/calendar');
  await expect(calendar(page).getByRole('button', { name: 'Live 달력 새로고침', exact: true })).toBeEnabled();
  const todayButton = page.getByRole('button', { name: `${today} 학습 기록`, exact: true });
  await expect(todayButton.getByLabel('Live 수업 1회', { exact: true })).toBeVisible();
  await expect(calendar(page).getByText('Live 수업 1회', { exact: true })).toBeVisible();
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
  if (yesterday.slice(0, 7) !== today.slice(0, 7)) await page.getByRole('button', { name: '이전 달', exact: true }).click();
  await page.getByRole('button', { name: `${yesterday} 학습 기록`, exact: true }).click();
  await expect(calendar(page).getByText(`${yesterday} Live 상세`, { exact: true })).toBeVisible();
  await expect(calendar(page).getByText('이 날짜에 확인된 Live 수업 기록이 없어요. 실제로 수업을 하지 않았다는 뜻은 아니에요.', { exact: true })).toBeVisible();
  await expect(calendar(page).getByText(/Live 복습 관찰 1건 · 재학습 관찰 1건/)).toBeVisible();
  const drain = new RouteDrain(); let release!: () => void, arrived!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; });
  const delayed = (route: Route) => drain.run(async () => { const response = await route.fetch({ maxRetries: 0 }); arrived(); await released; await route.fulfill({ response }); });
  await page.route(readRpc, delayed);
  try {
    await calendar(page).getByRole('button', { name: 'Live 달력 새로고침', exact: true }).click(); await seen;
    await page.getByRole('button', { name: '다음 달', exact: true }).click();
    const selectedHeading = await page.getByRole('heading', { name: /학습 상세$/ }).textContent();
    release(); await drain.wait(); await expect(calendar(page).getByRole('button', { name: 'Live 달력 새로고침', exact: true })).toBeEnabled();
    await expect(page.getByRole('heading', { name: /학습 상세$/ })).toHaveText(selectedHeading!);
    expect(await qa.readLanguage()).toEqual(originalLanguage);
  } finally { release(); await drain.wait(); await page.unroute(readRpc, delayed); }
});

test('Live overview distinguishes unavailable stale empty and late navigation reads', async ({ page, qa }) => {
  await seed(qa.account); await login(page, qa.account, '/language'); await ready(page);
  await page.route(readRpc, route => route.fulfill({ status: 404, json: { code: 'PGRST202', message: 'synthetic unavailable function' } }));
  await refresh(page); await expect(main(page).getByText('최신 Live 기록을 다시 확인해야 해요.', { exact: true })).toBeVisible();
  await expect(main(page).getByRole('region', { name: '현재 학습 단계', exact: true })).toHaveCount(0);
  await expect(main(page).getByText(/아직 저장한 AI Live 수업/)).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
  await expect(main(page).getByText('Live 기록을 불러오지 못했어요.', { exact: true })).toBeVisible(); await page.unroute(readRpc);
  const drain = new RouteDrain(); let release!: () => void, arrived!: () => void, hold = true;
  const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; });
  const delayed = (route: Route) => drain.run(async () => { const response = await route.fetch({ maxRetries: 0 }); if (hold) { hold = false; arrived(); await released; } await route.fulfill({ response }); });
  await page.route(readRpc, delayed);
  try {
    await main(page).getByRole('button', { name: 'Live 현황 새로고침', exact: true }).click(); await seen;
    await main(page).getByRole('link', { name: '다음 AI 수업 준비', exact: true }).click();
    await expect(preparation(page).getByRole('heading', { name: '다음 AI 수업 준비', exact: true })).toBeVisible();
    release(); await drain.wait(); await expect(main(page)).toHaveCount(0);
    await page.goBack({ waitUntil: 'domcontentloaded' }); await ready(page); await expect(main(page).getByText('합성 메인 수업', { exact: true })).toBeVisible();
    await page.goForward({ waitUntil: 'domcontentloaded' }); await expect(preparation(page).getByRole('heading', { name: '다음 AI 수업 준비', exact: true })).toBeVisible();
  } finally { release(); await drain.wait(); await page.unroute(readRpc, delayed); }
});

test('Live overview account A in-flight source cannot leak into B after signout', async ({ page, qa }) => {
  await seed(qa.account, liveOverviewDate(), 'A 계정 전용 수업'); const other = await qa.createAccount();
  await login(page, qa.account, '/language'); await ready(page);
  const drain = new RouteDrain(); let release!: () => void, arrived!: () => void, hold = true;
  const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; });
  const delayed = (route: Route) => drain.run(async () => { const response = await route.fetch({ maxRetries: 0 }); if (hold) { hold = false; arrived(); await released; } await route.fulfill({ response }); });
  await page.route(readRpc, delayed);
  try {
    await main(page).getByRole('button', { name: 'Live 현황 새로고침', exact: true }).click(); await seen;
    await relogin(page, other); release(); await drain.wait(); await ready(page);
    await expect(main(page).getByText('A 계정 전용 수업', { exact: true })).toHaveCount(0);
    await expect(main(page).getByText('아직 저장한 AI Live 수업이 없어요. 수업 보고서를 가져오거나 첫 수업을 준비해 보세요.', { exact: true })).toBeVisible();
    await reauthenticateFixtureAccount(qa.account);
    expect(await qa.readLanguage()).toEqual(originalLanguage); expect(await qa.readLanguage(other)).toEqual(originalLanguage);
  } finally { release(); await drain.wait(); await page.unroute(readRpc, delayed); }
});

test('main direct preparation reopens private pending drafts without automatically generating saving or copying', async ({ page, qa }) => {
  await login(page, qa.account, '/language'); await ready(page);
  await main(page).getByRole('link', { name: '다음 AI 수업 준비', exact: true }).click();
  await preparation(page).getByRole('button', { name: '최신 자료로 새 지시문 생성', exact: true }).click();
  await preparation(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true }).fill('직접 보관한 준비 초안');
  const drafts = await page.evaluate(owner => Object.entries(localStorage).filter(([key]) => key.startsWith(`yeoni-language-live:${owner}:preparation-draft:v1:`)), qa.account.id);
  expect(drafts).toHaveLength(1);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('link', { name: '← 일본어 학습', exact: true }).click(); await ready(page);
  await main(page).getByRole('link', { name: '다음 AI 수업 준비', exact: true }).click();
  await expect(preparation(page).getByRole('heading', { name: '지시문 확인', exact: true })).toHaveCount(0);
  await expect(preparation(page).getByText('이 계정의 수업 준비 기기 초안 1개', { exact: true })).toBeVisible();
  expect(await page.evaluate(keys => keys.map(([key]) => [key, localStorage.getItem(key)]), drafts)).toEqual(drafts);
  await preparation(page).getByText('이 계정의 수업 준비 기기 초안 1개', { exact: true }).click();
  await preparation(page).getByRole('button', { name: /^준비 초안 ·/ }).click();
  await expect(preparation(page).getByLabel('전달할 지시문 (직접 수정 가능)', { exact: true })).toHaveValue('직접 보관한 준비 초안');
  expect(await createLanguageLivePreparationRepository(qa.account.client, qa.account.id).listPreparations()).toEqual([]);
  expect(await qa.readLanguage()).toEqual(originalLanguage);
});
