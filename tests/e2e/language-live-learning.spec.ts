import { randomUUID } from 'node:crypto';
import type { Page, Request, Route } from '@playwright/test';
import { isAuthSessionMissingError, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect, login, synced, originalLanguage, Traffic, foregroundLivePage } from './fixture';
import { RouteDrain } from './route-drain';
import { reauthenticateFixtureAccount, type FixtureAccount } from './fixture-account-auth';
import { createLanguageLiveRepository } from '../../app/data/languageLiveRepository';
import { createLanguageLiveLearningRepository } from '../../app/data/languageLiveLearningRepository';
import { parseLiveReport } from '../../lib/language-live/report-parser';
import { projectLiveLearning } from '../../lib/language-live/state-reducer';
import type { LiveLearningEvent } from '../../lib/language-live/learning-types';
import type { LiveLesson } from '../../lib/language-live/types';

const workspace = (page: Page) => page.locator('.live-learning-workspace');
const saveRpc = '**/rest/v1/rpc/save_language_live_learning';
const readRpc = '**/rest/v1/rpc/read_language_live_learning';
const batchesUrl = '**/rest/v1/language_live_learning_batches?*';
const raw = (topic: string, date = '2026-10-09') => `[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: ${date}\n수업 주제: ${topic}\n현재 학습 단계: 완전 왕초보\n읽기 학습 결과: え를 새로 배웠다.\n쓰기 학습 결과: 미학습\n이전 학습 복습 결과: え를 힌트 없이 정확하게 읽었다.\n학습 중 발견한 망각 항목: え를 기억하지 못해 망각을 다시 확인했다.\n재학습 수행 내역: え를 다시 설명하고 세 번 연습했다.\n재평가 결과: え를 힌트 없이 정확하게 읽었다.\n평가 근거 및 불확실성: 음성 인식 오류 가능성으로 말하기 평가는 불확실하다.`;
const learningRepo = (client: SupabaseClient, owner: string) => createLanguageLiveLearningRepository(client, owner);
const reportRepo = (client: SupabaseClient, owner: string) => createLanguageLiveRepository(client, owner);
async function seed(client: SupabaseClient, owner: string, topic: string, date?: string) {
  return reportRepo(client, owner).saveLesson({ requestId: randomUUID(), lessonId: randomUUID(), expectedRevision: 0, report: parseLiveReport(raw(topic, date)) });
}
function event(itemId = randomUUID(), patch: Partial<LiveLearningEvent> = {}): LiveLearningEvent {
  return { eventId: randomUUID(), item: { itemId, kind: 'kana', text: 'え', meaning: '' }, skill: 'reading', kind: 'learn', result: 'not_assessed', occurredDate: '2026-10-09', certainty: 'confirmed', independent: null, hintUsed: null, forgettingConfirmed: false, evidenceText: 'え를 새로 배웠다.', sourceField: 'reading', reason: '합성 수업의 실제 관찰 확인', relearningText: '', linkedRelearningEventId: null, teacherRecommendedDue: null, teacherRecommendationConfirmed: false, ...patch };
}
async function seedEvidence(client: SupabaseClient, owner: string, lesson: LiveLesson, events: LiveLearningEvent[]) {
  return learningRepo(client, owner).saveLearning({ requestId: randomUUID(), lessonId: lesson.lesson_id, lessonRevision: lesson.revision, expectedVersion: 0, confirmed: true, policyVersion: 'live-review-v1', events, changeReason: '합성 학습 관찰 확인' });
}
async function ready(page: Page) {
  await expect(page.locator('.live-workspace').getByRole('heading', { name: 'AI Live 학습 기록', exact: true })).toBeVisible();
  await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
}
async function openLearning(page: Page) {
  await ready(page); await page.getByRole('button', { name: '복습·학습 상태', exact: true }).click();
  await expect(workspace(page).getByRole('heading', { name: '복습·학습 상태', exact: true })).toBeVisible();
  await expect(workspace(page).getByRole('button', { name: '복습 기록 새로고침', exact: true })).toBeEnabled();
}
async function begin(page: Page, lesson: LiveLesson) {
  await workspace(page).getByLabel('근거를 확인할 수업', { exact: true }).selectOption(lesson.lesson_id);
  await workspace(page).getByRole('button', { name: '이 수업의 근거 확인 시작', exact: true }).click();
}
async function addLearning(page: Page) {
  await workspace(page).getByRole('button', { name: '관찰 한 건 추가', exact: true }).click();
  await workspace(page).getByLabel('일본어 항목 원문', { exact: true }).fill('え');
  await workspace(page).getByLabel('그대로 옮긴 평가 근거', { exact: true }).fill('え를 새로 배웠다.');
  await workspace(page).getByLabel('평가의 확실성', { exact: true }).selectOption('confirmed');
  await workspace(page).getByLabel('관찰을 기록하는 이유', { exact: true }).fill('수업에서 배운 사실을 확인했어요.');
  const confirm = workspace(page).getByRole('button', { name: '확인한 관찰을 목록에 반영', exact: true });
  await expect(confirm).toBeDisabled();
  await workspace(page).getByRole('checkbox', { name: '항목·영역·관찰일·근거와 불확실성을 직접 확인했어요.' }).check(); await confirm.click();
}
async function review(page: Page) {
  await workspace(page).getByLabel('전체 근거 목록의 저장·변경 이유', { exact: true }).fill('합성 보고서의 학습 근거를 직접 확인');
  await workspace(page).getByRole('checkbox', { name: '이 수업의 전체 관찰 목록과 원문 근거를 확인했고 이 내용으로 저장할게요.' }).check();
}
async function save(page: Page, revision = 1, version = 1) {
  await review(page); await workspace(page).getByRole('button', { name: '확인한 복습 근거 서버에 저장', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: `복습 서버 저장 확인 · 보고서 버전 ${revision} · 근거 버전 ${version}` })).toBeVisible();
  await expect(workspace(page).getByRole('button', { name: '복습 기록 새로고침', exact: true })).toBeEnabled();
}
async function relogin(page: Page, account: FixtureAccount) {
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(account.email); await page.getByLabel('비밀번호', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'AI 연이 시작', exact: true }).click(); await ready(page);
  await test.step('Reauthenticate the independent fixture verifier after global logout', () => reauthenticateFixtureAccount(account));
}

// Authenticated disposable local Auth/PostgREST only. Authored coverage; execution is a separate gate.
test('Live P2 global logout revokes the independent fixture verifier until explicit owner-verified reauthentication', async ({ page, qa }) => {
  let phase = 'starting', logoutStatus: number | null = null;
  const authRequests = { user: 0, token: 0, logout: 0 };
  let logoutRequestFailed = false;
  const authPath = (request: Request) => {
    const url = new URL(request.url());
    return url.origin === 'http://127.0.0.1:54321' ? url.pathname : '';
  };
  const requested = (request: Request) => {
    const path = authPath(request);
    if (path === '/auth/v1/user') authRequests.user++;
    if (path === '/auth/v1/token') authRequests.token++;
    if (path === '/auth/v1/logout') authRequests.logout++;
  };
  const failed = (request: Request) => { if (authPath(request) === '/auth/v1/logout') logoutRequestFailed = true; };
  page.on('request', requested); page.on('requestfailed', failed);
  try {
    await login(page, qa.account, '/language/live'); await openLearning(page); await synced(page);
    // This diagnostic starts from a confirmed Live snapshot, not the heading
    // shared with the initial auth placeholder. It does not test startup races.
    phase = 'learning-ready';
    const [logout] = await Promise.all([page.waitForResponse(value => {
      const url = new URL(value.url());
      return url.origin === 'http://127.0.0.1:54321' && url.pathname === '/auth/v1/logout' && value.request().method() === 'POST';
    }), page.getByRole('button', { name: '로그아웃', exact: true }).click()]);
    logoutStatus = logout.status(); phase = 'logout-response';
    expect(new URL(logout.url()).searchParams.get('scope')).toBe('global');
    expect(logoutStatus).toBe(204);
    await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
    await expect(workspace(page)).toHaveCount(0);
    phase = 'browser-signed-out';
    await test.step('Verify the old independent Auth session is revoked by browser global logout', async () => {
      const revoked = await qa.account.client.auth.getUser();
      expect(revoked.data.user).toBeNull();
      // auth-js converts the server's session_not_found code to this class,
      // intentionally dropping its raw code. Assert the public SDK contract.
      expect(isAuthSessionMissingError(revoked.error)).toBe(true);
      await expect(learningRepo(qa.account.client, qa.account.id).readLearning()).rejects.toMatchObject({ code: 'unauthenticated' });
    });
    phase = 'verifier-revoked';
    await test.step('Fresh fixture sign-in verifies the exact owner before reading the learning repository', async () => {
      await reauthenticateFixtureAccount(qa.account);
      const snapshot = await learningRepo(qa.account.client, qa.account.id).readLearning();
      expect(snapshot.ownerId).toBe(qa.account.id);
      expect(snapshot.lessons).toEqual([]); expect(snapshot.batches).toEqual([]);
    });
    await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
    await expect(workspace(page)).toHaveCount(0);
    phase = 'verified';
  } finally {
    // Fixed state labels only; never log session data, provider errors or DOM text.
    page.off('request', requested); page.off('requestfailed', failed);
    console.log('QA_LIVE_LOGOUT ' + JSON.stringify({ phase, authRequests, logoutStatus, logoutRequestFailed,
      loginVisible: await page.getByLabel('이메일', { exact: true }).isVisible().catch(() => false),
      protectedWorkspaceVisible: await workspace(page).isVisible().catch(() => false),
      gateLoadingVisible: await page.getByText('AI 연이를 불러오는 중…', { exact: true }).isVisible().catch(() => false),
      gateErrorVisible: await page.getByRole('heading', { name: '로그인 확인을 완료하지 못했어요', exact: true }).isVisible().catch(() => false),
    }));
  }
});

test('Live P2 confirms source excerpts, preserves four independent skills and survives reload/relogin at small widths', async ({ page, qa }, info) => {
  const lesson = await seed(qa.account.client, qa.account.id, '합성 P2 첫 학습');
  await page.setViewportSize({ width: 320, height: 844 }); await login(page, qa.account, '/language/live'); await openLearning(page);
  await expect(workspace(page).getByText('아직 확인해 저장한 학습 항목이 없어요. 아래에서 수업의 평가 근거를 직접 확인해 주세요.', { exact: true })).toBeVisible();
  expect((await learningRepo(qa.account.client, qa.account.id).readLearning()).batches).toHaveLength(0);
  await begin(page, lesson); await addLearning(page);
  await expect(workspace(page).getByRole('button', { name: '확인한 복습 근거 서버에 저장', exact: true })).toBeDisabled();
  await save(page);
  const reading = workspace(page).getByRole('region', { name: 'え 읽기 상태', exact: true });
  await expect(reading.getByText('학습 중', { exact: true })).toBeVisible(); await expect(reading.getByText('다음 복습 2026-10-10', { exact: true })).toBeVisible();
  for (const skill of ['듣기', '말하기', '쓰기']) await expect(workspace(page).getByRole('region', { name: `え ${skill} 상태`, exact: true }).getByText('미확인', { exact: true })).toBeVisible();
  await workspace(page).screenshot({ path: `.e2e/evidence/language-live-learning-dashboard-320-${info.project.name}.png`, animations: 'disabled', caret: 'hide' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' }); await openLearning(page);
  await expect(workspace(page).getByRole('region', { name: 'え 읽기 상태', exact: true }).getByText('학습 중', { exact: true })).toBeVisible();
  await relogin(page, qa.account); await openLearning(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await workspace(page).screenshot({ path: `.e2e/evidence/language-live-learning-dashboard-768-${info.project.name}.png`, animations: 'disabled', caret: 'hide' });
  const snapshot = await learningRepo(qa.account.client, qa.account.id).readLearning(); expect(snapshot.batches).toHaveLength(1); expect(snapshot.batches[0].payload.events[0].occurredDate).toBe('2026-10-09');
  expect(await qa.readLanguage()).toEqual(originalLanguage);
});

test('Live P2 rejects invented excerpts and confirmed observations from unknown or not-learned fields', async ({ page, qa }) => {
  const lesson = await seed(qa.account.client, qa.account.id, '합성 P2 근거 확인');
  await login(page, qa.account, '/language/live'); await openLearning(page); await begin(page, lesson);
  await workspace(page).getByRole('button', { name: '관찰 한 건 추가', exact: true }).click();
  await workspace(page).getByLabel('일본어 항목 원문', { exact: true }).fill('え'); await workspace(page).getByLabel('평가의 확실성', { exact: true }).selectOption('confirmed');
  await workspace(page).getByLabel('관찰을 기록하는 이유', { exact: true }).fill('합성 확인');
  await workspace(page).getByLabel('그대로 옮긴 평가 근거', { exact: true }).fill('보고서에 없는 독립 성공');
  await workspace(page).getByRole('checkbox', { name: '항목·영역·관찰일·근거와 불확실성을 직접 확인했어요.' }).check();
  await expect(workspace(page).getByRole('button', { name: '확인한 관찰을 목록에 반영', exact: true })).toBeDisabled();
  await workspace(page).getByLabel('근거가 있는 보고서 항목', { exact: true }).selectOption('listening');
  await expect(workspace(page).getByText('미확인·해당 없음인 보고서 항목은 확정 평가로 바꿀 수 없어요.', { exact: true })).toBeVisible();
  await expect(workspace(page).getByRole('button', { name: '확인한 관찰을 목록에 반영', exact: true })).toBeDisabled();
  await workspace(page).getByLabel('근거가 있는 보고서 항목', { exact: true }).selectOption('writing'); await workspace(page).getByLabel('그대로 옮긴 평가 근거', { exact: true }).fill('미학습');
  await expect(workspace(page).getByText('미학습으로 보고된 항목은 학습·성공 평가로 확정할 수 없어요.', { exact: true })).toBeVisible();
  await workspace(page).getByLabel('관찰 종류', { exact: true }).selectOption('not_learned'); await workspace(page).getByLabel('학습 영역', { exact: true }).selectOption('writing');
  await workspace(page).getByRole('checkbox', { name: '항목·영역·관찰일·근거와 불확실성을 직접 확인했어요.' }).check(); await workspace(page).getByRole('button', { name: '확인한 관찰을 목록에 반영', exact: true }).click();
  await save(page); await expect(workspace(page).getByRole('region', { name: 'え 쓰기 상태', exact: true }).getByText('미학습', { exact: true })).toBeVisible();
});

test('Live P2 lost readback keeps immutable request through recovery and never claims early success', async ({ page, qa }) => {
  const lesson = await seed(qa.account.client, qa.account.id, '합성 P2 응답 유실');
  await login(page, qa.account, '/language/live'); await openLearning(page); await begin(page, lesson); await addLearning(page); await review(page);
  const requests: string[] = []; page.on('request', request => { if (request.url().endsWith('/rpc/save_language_live_learning')) requests.push(request.postDataJSON().p_payload.requestId); });
  await page.route(batchesUrl, route => route.fulfill({ status: 404, json: { code: '42P01', message: 'synthetic post-commit readback schema failure' } }));
  await workspace(page).getByRole('button', { name: '확인한 복습 근거 서버에 저장', exact: true }).click();
  await expect(workspace(page).getByRole('button', { name: '같은 요청으로 복습 저장 다시 확인', exact: true })).toBeEnabled();
  await expect(workspace(page).getByRole('status').filter({ hasText: '복습 서버 저장 확인' })).toHaveCount(0);
  await expect(workspace(page).getByLabel('전체 근거 목록의 저장·변경 이유', { exact: true })).toBeDisabled();
  expect((await learningRepo(qa.account.client, qa.account.id).readLearning()).batches).toHaveLength(1);
  page.on('dialog', dialog => dialog.accept()); await page.reload({ waitUntil: 'domcontentloaded' }); await openLearning(page);
  await workspace(page).getByText(/^이 계정의 복습 기기 초안 \d+개$/).click(); await workspace(page).getByRole('button', { name: /복습 초안.*저장 결과 확인 필요/ }).first().click();
  await page.unroute(batchesUrl); await workspace(page).getByRole('button', { name: '같은 요청으로 복습 저장 다시 확인', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: '복습 서버 저장 확인 · 보고서 버전 1 · 근거 버전 1' })).toBeVisible();
  expect(requests).toHaveLength(2); expect(new Set(requests).size).toBe(1); expect((await learningRepo(qa.account.client, qa.account.id).readLearning()).batches).toHaveLength(1);
});

test('Live P2 deletion and report restoration keep evidence inactive until explicit copy/reconfirmation with original observation dates', async ({ page, qa }) => {
  const client = qa.account.client, owner = qa.account.id, lesson = await seed(client, owner, '합성 P2 복원');
  await seedEvidence(client, owner, lesson, [event()]);
  const reports = reportRepo(client, owner); await reports.deleteLesson({ requestId: randomUUID(), lessonId: lesson.lesson_id, expectedRevision: 1 });
  await login(page, qa.account, '/language/live'); await openLearning(page);
  await expect(workspace(page).getByRole('region', { name: 'え 읽기 상태', exact: true })).toHaveCount(0);
  await reports.restoreLesson({ requestId: randomUUID(), lessonId: lesson.lesson_id, expectedRevision: 2, restoreRevision: 1 });
  await workspace(page).getByRole('button', { name: '복습 기록 새로고침', exact: true }).click();
  await expect(workspace(page).getByRole('region', { name: 'え 읽기 상태', exact: true })).toHaveCount(0);
  await workspace(page).getByText('합성 P2 복원 · 보고서 버전 1 · 근거 버전 1 · 현재 계산 제외', { exact: true }).click();
  await workspace(page).getByRole('button', { name: '이 근거를 현재 버전에 복사해 확인', exact: true }).click();
  await expect(workspace(page).getByRole('checkbox', { name: '이 수업의 전체 관찰 목록과 원문 근거를 확인했고 이 내용으로 저장할게요.' })).not.toBeChecked();
  await save(page, 3, 1);
  await expect(workspace(page).getByRole('region', { name: 'え 읽기 상태', exact: true }).getByText('다음 복습 2026-10-10', { exact: true })).toBeVisible();
  const snapshot = await learningRepo(client, owner).readLearning(); expect(snapshot.batches).toHaveLength(2); expect(snapshot.batches.every(batch => batch.payload.events[0].occurredDate === '2026-10-09')).toBe(true);
  expect(projectLiveLearning(snapshot).inactiveBatches).toHaveLength(1); expect(await qa.readLanguage()).toEqual(originalLanguage);
});

test('Live P2 mastery, forgetting, relearning and uncertain other-skill observations remain separately visible', async ({ page, qa }) => {
  const client = qa.account.client, owner = qa.account.id, item = randomUUID();
  for (const date of ['2026-09-01', '2026-09-04', '2026-09-08']) {
    const lesson = await seed(client, owner, `합성 독립 성공 ${date}`, date);
    await seedEvidence(client, owner, lesson, [event(item, { kind: 'review', result: 'independent_correct', occurredDate: date, independent: true, hintUsed: false, sourceField: 'previousReviewResults', evidenceText: 'え를 힌트 없이 정확하게 읽었다.' })]);
  }
  const lesson = await seed(client, owner, '합성 망각과 재학습', '2026-09-20');
  const forgotten = event(item, { kind: 'forgetting', result: 'cannot_recall', occurredDate: '2026-09-20', forgettingConfirmed: true, evidenceText: 'え를 기억하지 못해 망각을 다시 확인했다.', sourceField: 'forgettingObservations' });
  await seedEvidence(client, owner, lesson, [forgotten]);
  await login(page, qa.account, '/language/live'); await openLearning(page);
  const reading = workspace(page).getByRole('region', { name: 'え 읽기 상태', exact: true });
  await expect(reading.getByText('재학습 필요', { exact: true })).toBeVisible(); await reading.getByText(/상태·평가 이력/).click();
  await expect(reading.getByText('과거 숙달 확인 1건을 보존하고 있어요.', { exact: true })).toBeVisible();
  const relearn = event(item, { kind: 'relearn', occurredDate: '2026-09-20', evidenceText: 'え를 다시 설명하고 세 번 연습했다.', sourceField: 'relearningActivities', relearningText: 'え를 다시 설명하고 세 번 연습' });
  await learningRepo(client, owner).saveLearning({ requestId: randomUUID(), lessonId: lesson.lesson_id, lessonRevision: 1, expectedVersion: 1, confirmed: true, policyVersion: 'live-review-v1', changeReason: '합성 재학습과 재평가 추가', events: [forgotten, relearn, event(item, { kind: 'reassessment', result: 'independent_correct', occurredDate: '2026-09-20', independent: true, hintUsed: false, linkedRelearningEventId: relearn.eventId, evidenceText: 'え를 힌트 없이 정확하게 읽었다.', sourceField: 'reassessments' }), event(item, { skill: 'speaking', kind: 'review', result: 'uncertain', certainty: 'uncertain', occurredDate: '2026-09-20', evidenceText: '음성 인식 오류 가능성으로 말하기 평가는 불확실하다.', sourceField: 'evidenceAndUncertainty' })] });
  await workspace(page).getByRole('button', { name: '복습 기록 새로고침', exact: true }).click();
  await expect(reading.getByText('학습 중', { exact: true })).toBeVisible(); await expect(reading.getByText('숙달 확인', { exact: true })).toHaveCount(0);
  const speaking = workspace(page).getByRole('region', { name: 'え 말하기 상태', exact: true }); await expect(speaking.getByText('미확인', { exact: true })).toBeVisible(); await expect(speaking.getByText('추가 평가 필요', { exact: true })).toBeVisible();
  expect(await qa.readLanguage()).toEqual(originalLanguage);
});

test('Live P2 stale independent-session edits retain losing draft and do not silently overwrite confirmed evidence', async ({ page, qa, browser }) => {
  const lesson = await seed(qa.account.client, qa.account.id, '합성 P2 동시 수정'); await seedEvidence(qa.account.client, qa.account.id, lesson, [event()]);
  await login(page, qa.account, '/language/live'); await openLearning(page); await begin(page, lesson);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), traffic = new Traffic('Live-learning-B'); await traffic.install(context);
  try {
    const second = await context.newPage(); await login(second, qa.account, '/language/live'); await openLearning(second); await begin(second, lesson);
    await foregroundLivePage(page); await save(page, 1, 2);
    await foregroundLivePage(second); await review(second);
    await workspace(second).getByRole('button', { name: '확인한 복습 근거 서버에 저장', exact: true }).click();
    await expect(workspace(second).getByRole('alert').filter({ hasText: '다른 곳에서 수업 기록이 바뀌었거나' })).toBeVisible();
    await expect(workspace(second).getByLabel('전체 근거 목록의 저장·변경 이유', { exact: true })).toHaveValue('합성 보고서의 학습 근거를 직접 확인');
    const snapshot = await learningRepo(qa.account.client, qa.account.id).readLearning(); expect(snapshot.batches).toHaveLength(2);
    await workspace(second).getByRole('button', { name: '복습 기록 새로고침', exact: true }).click();
    await expect(workspace(second).getByRole('button', { name: '현재 버전에 이 초안 복사', exact: true })).toBeVisible();
    expect(await qa.readLanguage()).toEqual(originalLanguage);
  } finally { traffic.releaseAll(); await traffic.drain(); await context.unrouteAll({ behavior: 'wait' }); await context.close(); expect(traffic.blockedOrigins.size).toBe(0); }
});

test('Live P2 unavailable snapshots hide current projections and late reads cannot reopen a dismissed tab', async ({ page, qa }) => {
  const lesson = await seed(qa.account.client, qa.account.id, '합성 P2 조회 실패'); await seedEvidence(qa.account.client, qa.account.id, lesson, [event()]);
  await login(page, qa.account, '/language/live'); await openLearning(page);
  await page.route(readRpc, route => route.fulfill({ status: 404, json: { code: 'PGRST202', message: 'synthetic missing function' } }));
  await workspace(page).getByRole('button', { name: '복습 기록 새로고침', exact: true }).click();
  await expect(workspace(page).getByText('복습 전용 서버 저장소가 아직 준비되지 않았어요.', { exact: true })).toBeVisible();
  await expect(workspace(page).getByRole('region', { name: 'え 읽기 상태', exact: true })).toHaveCount(0);
  await expect(workspace(page).getByText('아직 확인해 저장한 학습 항목이 없어요.', { exact: true })).toHaveCount(0);
  await page.unroute(readRpc);
  const drain = new RouteDrain(); let release!: () => void; let arrived!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; });
  const delayed = (route: Route) => drain.run(async () => { const response = await route.fetch({ maxRetries: 0 }); arrived(); await released; await route.fulfill({ response }); });
  await page.route(readRpc, delayed);
  try {
    await workspace(page).getByRole('button', { name: '복습 기록 새로고침', exact: true }).click(); await seen;
    await page.getByRole('button', { name: '학습 이력', exact: true }).click(); release(); await drain.wait();
    await expect(workspace(page)).toBeHidden(); await expect(page.locator('.live-workspace').getByRole('heading', { name: '학습 이력', exact: true })).toBeVisible();
  } finally { release(); await drain.wait(); await page.unroute(readRpc, delayed); }
});

test('Live P2 two tabs recover private drafts and cancel/leave/back preserve unfinished inputs', async ({ page, context, qa }) => {
  const lesson = await seed(qa.account.client, qa.account.id, '합성 P2 탭별 초안');
  await login(page, qa.account, '/language/live'); await openLearning(page); await begin(page, lesson); await addLearning(page);
  await workspace(page).getByLabel('전체 근거 목록의 저장·변경 이유', { exact: true }).fill('원래 탭의 확인 중인 근거');
  await workspace(page).getByRole('button', { name: '이 복습 초안 지우기', exact: true }).click();
  await workspace(page).getByRole('button', { name: '초안 지우기 취소', exact: true }).click();
  await expect(workspace(page).getByLabel('전체 근거 목록의 저장·변경 이유', { exact: true })).toHaveValue('원래 탭의 확인 중인 근거');
  const second = await context.newPage();
  try {
    await second.goto('/language/live', { waitUntil: 'domcontentloaded' }); await openLearning(second);
    await workspace(second).getByText(/^이 계정의 복습 기기 초안 \d+개$/).click(); await workspace(second).getByRole('button', { name: /복습 초안 ·/ }).first().click();
    await workspace(second).getByLabel('전체 근거 목록의 저장·변경 이유', { exact: true }).fill('복구한 탭의 별도 근거');
    await foregroundLivePage(page);
    await expect(workspace(page).getByLabel('전체 근거 목록의 저장·변경 이유', { exact: true })).toHaveValue('원래 탭의 확인 중인 근거');
    const drafts = await page.evaluate(owner => Object.keys(localStorage).filter(key => key.startsWith(`yeoni-language-live:${owner}:learning-draft:v1:`)).map(key => JSON.parse(localStorage.getItem(key)!)), qa.account.id);
    expect(drafts).toHaveLength(2); expect(new Set(drafts.map(draft => draft.draftId)).size).toBe(2); expect(new Set(drafts.map(draft => draft.input.lessonId)).size).toBe(1);
    page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('link', { name: '← 일본어 학습', exact: true }).click(); await expect(page).toHaveURL(/\/language\/live$/);
    page.on('dialog', dialog => dialog.accept()); await page.getByRole('link', { name: '← 일본어 학습', exact: true }).click(); await expect(page).toHaveURL(/\/language$/);
    await page.goBack({ waitUntil: 'domcontentloaded' }); await openLearning(page);
    await workspace(page).getByText(/^이 계정의 복습 기기 초안 \d+개$/).click(); await workspace(page).getByRole('button', { name: /복습 초안 ·/ }).first().click();
    await expect(workspace(page).getByLabel('전체 근거 목록의 저장·변경 이유', { exact: true })).not.toHaveValue('');
    await page.goForward({ waitUntil: 'domcontentloaded' }); await expect(page).toHaveURL(/\/language$/);
    expect((await learningRepo(qa.account.client, qa.account.id).readLearning()).batches).toHaveLength(0);
  } finally { await second.close(); }
});

test('Live P2 in-flight account A receipt cannot appear in B and same-request A recovery remains idempotent', async ({ page, qa }) => {
  const lesson = await seed(qa.account.client, qa.account.id, '합성 P2 계정 전환'), other = await qa.createAccount();
  await login(page, qa.account, '/language/live'); await openLearning(page); await begin(page, lesson); await addLearning(page); await review(page);
  const drain = new RouteDrain(); let release!: () => void; let arrived!: () => void; let hold = true;
  const released = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { arrived = resolve; }); const requests: string[] = [];
  const delayed = (route: Route) => drain.run(async () => {
    requests.push(route.request().postDataJSON().p_payload.requestId); const response = await route.fetch({ maxRetries: 0 }); expect(response.status()).toBe(200);
    if (hold) { hold = false; arrived(); await released; } await route.fulfill({ response });
  });
  await page.route(saveRpc, delayed);
  try {
    await workspace(page).getByRole('button', { name: '확인한 복습 근거 서버에 저장', exact: true }).click(); await seen;
    await relogin(page, other); await openLearning(page); release(); await drain.wait();
    await expect(workspace(page).getByRole('status').filter({ hasText: '복습 서버 저장 확인' })).toHaveCount(0);
    await expect(workspace(page).getByText(/이 계정의 복습 기기 초안/)).toHaveCount(0);
    await expect(workspace(page).getByRole('region', { name: 'え 읽기 상태', exact: true })).toHaveCount(0);
    expect((await learningRepo(other.client, other.id).readLearning()).batches).toHaveLength(0);
    await relogin(page, qa.account); await openLearning(page);
    await workspace(page).getByText(/^이 계정의 복습 기기 초안 \d+개$/).click(); await workspace(page).getByRole('button', { name: /복습 초안.*저장 결과 확인 필요/ }).first().click();
    await workspace(page).getByRole('button', { name: '같은 요청으로 복습 저장 다시 확인', exact: true }).click();
    await expect(workspace(page).getByRole('status').filter({ hasText: '복습 서버 저장 확인 · 보고서 버전 1 · 근거 버전 1' })).toBeVisible();
    expect(requests).toHaveLength(2); expect(new Set(requests).size).toBe(1); expect((await learningRepo(qa.account.client, qa.account.id).readLearning()).batches).toHaveLength(1);
    const forbidden = await other.client.from('language_live_learning_batches').select('*').eq('user_id', qa.account.id); expect(forbidden.error).toBeNull(); expect(forbidden.data).toEqual([]);
    expect(await qa.readLanguage()).toEqual(originalLanguage); expect(await qa.readLanguage(other)).toEqual(originalLanguage);
  } finally { release(); await drain.wait(); await page.unroute(saveRpc, delayed); }
});
