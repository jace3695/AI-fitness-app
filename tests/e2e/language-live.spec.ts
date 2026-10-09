import { randomUUID } from 'node:crypto';
import type { Page, Route, TestInfo } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { test, expect, login, originalLanguage, Traffic } from './fixture';
import { RouteDrain } from './route-drain';
import { parseLiveReport } from '../../lib/language-live/report-parser';
import { LIVE_REPORT_FIELDS, type LiveLesson } from '../../lib/language-live/types';
import { createLanguageLiveRepository } from '../../app/data/languageLiveRepository';

const rpcUrl = '**/rest/v1/rpc/save_language_live_lesson';
const recordsUrl = '**/rest/v1/language_live_lessons?*';
const currentUrl = '**/rest/v1/language_live_current_lessons?*';
const workspace = (page: Page) => page.locator('.live-workspace');
// Capture only the authenticated Live workspace with this test's synthetic report.
// Stable filenames make each state/viewport/browser easy to inspect in CI artifacts.
const captureLive = (page: Page, state: 'preview' | 'saved-detail' | 'history', width: number, info: TestInfo) => workspace(page).screenshot({
  path: `.e2e/evidence/language-live-${state}-${width}-${info.project.name}.png`,
  animations: 'disabled', caret: 'hide',
});
const reviewed = (page: Page) => workspace(page).getByRole('checkbox', { name: '분석한 내용과 미확인 항목을 확인했어요. 이 내용으로 저장할게요.' });
const reportText = (topic = '합성 첫 히라가나 수업', date = '2026-10-09', version = 'v1.1') => [
  `[연이 AI 일본어 학습 기록 ${version}]`,
  ...LIVE_REPORT_FIELDS.map(({ key, label }, index) => `${index + 1}. ${label}: ${key === 'lessonDate' ? date : key === 'topic' ? topic : key === 'stage' ? '완전 왕초보' : key === 'kana' ? 'あ・い・う・え・お' : key === 'evidenceAndUncertainty' ? '음성 인식 불확실. 말하기 실력 하락으로 확정하지 않음.' : key === 'writing' ? '미학습' : key === 'errors' ? '해당 없음' : '미확인'}`),
].join('\n');

async function historyRows(client: SupabaseClient): Promise<LiveLesson[]> {
  const { data, error } = await client.from('language_live_lessons').select('user_id,lesson_id,revision,previous_revision,operation,report,created_at,request_id,payload_hash,restored_from_revision,duplicate_reason').order('created_at').order('revision');
  expect(error, 'Authenticated read of disposable Live history').toBeNull();
  return data as LiveLesson[];
}
async function ready(page: Page) {
  await expect(workspace(page).getByRole('heading', { name: 'AI Live 학습 기록', exact: true })).toBeVisible();
  await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
}
async function preview(page: Page, raw: string) {
  await workspace(page).getByRole('button', { name: '보고서 가져오기', exact: true }).click();
  await workspace(page).getByLabel('수업 보고서 원문', { exact: true }).fill(raw);
  await workspace(page).getByRole('button', { name: '25개 항목 분석하기', exact: true }).click();
  await expect(workspace(page).getByRole('heading', { name: '2. 내용 확인하고 수정하기', exact: true })).toBeVisible();
}
async function save(page: Page, operation = '처음 등록', revision = 1) {
  await reviewed(page).check();
  await workspace(page).getByRole('button', { name: revision === 1 ? '확인하고 서버에 저장' : '확인하고 수정 이력 저장', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: `서버 저장 확인 · ${operation} · 버전 ${revision}.` })).toBeVisible();
  await expect(workspace(page).getByRole('heading', { name: '수정·삭제·복원 이력', exact: true })).toBeVisible();
}
async function openHistory(page: Page, topic?: string) {
  await workspace(page).getByRole('button', { name: '학습 이력', exact: true }).click();
  await expect(workspace(page).getByRole('heading', { name: '학습 이력', exact: true })).toBeVisible();
  if (topic) {
    await workspace(page).getByRole('button', { name: `${topic} 기록 보기`, exact: true }).click();
    await expect(workspace(page).getByRole('heading', { name: '수정·삭제·복원 이력', exact: true })).toBeVisible();
  }
}
async function seed(client: SupabaseClient, raw: string) {
  return createLanguageLiveRepository(client).saveLesson({ requestId: randomUUID(), lessonId: randomUUID(), expectedRevision: 0, report: parseLiveReport(raw) });
}
async function relogin(page: Page, account: { email: string; password: string }) {
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(account.email);
  await page.getByLabel('비밀번호', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'AI 연이 시작', exact: true }).click();
  await ready(page);
}

// All writes use the fixture's real, authenticated disposable Auth/PostgREST DB.
// Browser requests to hosted origins are blocked by Traffic; no AI calls are mocked as success.
test('Live import confirms all 25 fields, preserves immutable raw and legacy progress across refresh and relogin', async ({ page, qa }, testInfo) => {
  const legacy = {
    ...originalLanguage,
    japaneseCurriculumProgressV1: JSON.stringify({ completedLessonIds: ['f01'], selectedTrack: 'foundation', quizScores: { f01: 75 }, activityDates: ['2001-01-02'], lessonAttempts: { f01: [{ score: 75, completedAt: '2001-01-02T09:00:00Z' }] } }),
    japaneseCurriculumReviewV1: JSON.stringify([{ id: 'f01-q1', lessonId: 'f01', lessonTitle: '합성 기존 수업', prompt: 'あ', explanation: '기존 오답 보존', createdAt: '2001-01-02T09:00:00Z', wrongCount: 2, nextReviewAt: '2001-01-03' }]),
    wrongKanaChars: JSON.stringify(['え']),
    dailyLearningHistory: JSON.stringify([{ date: '2001-01-02', completedIds: ['kana'] }]),
  };
  expect((await qa.account.client.from('language_user_state').update({ state: legacy }).eq('user_id', qa.account.id)).error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account, '/language/live'); await ready(page);
  const raw = reportText();
  await preview(page, raw);
  expect(await historyRows(qa.account.client)).toHaveLength(0);
  expect(await qa.readLanguage()).toEqual(legacy);
  await workspace(page).getByLabel('2. 수업 주제', { exact: true }).fill('합성 확인 후 수정한 주제');
  await expect(workspace(page).getByRole('button', { name: '확인하고 서버에 저장', exact: true })).toBeDisabled();
  for (const group of await workspace(page).locator('.live-field-group').all()) {
    if (await group.getAttribute('open') === null) await group.locator('summary').click();
  }
  await expect(workspace(page).getByLabel('듣기 학습 결과 기록 상태')).toHaveValue('unknown');
  await expect(workspace(page).getByLabel('쓰기 학습 결과 기록 상태')).toHaveValue('not_learned');
  await expect(workspace(page).getByLabel('틀린 부분 기록 상태')).toHaveValue('none');
  await expect(workspace(page).locator('.live-field')).toHaveCount(25);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await captureLive(page, 'preview', width, testInfo);
  }
  // Preserve the original save flow's viewport after the additive preview captures.
  await page.setViewportSize({ width: 320, height: 844 });
  await save(page);
  const rows = await historyRows(qa.account.client);
  expect(rows).toHaveLength(1); expect(rows[0].report.rawText).toBe(raw);
  expect(rows[0].report.topic).toBe('합성 확인 후 수정한 주제');
  expect(Object.keys(rows[0].report.fields)).toHaveLength(25);
  expect(rows[0].report.fields.evidenceAndUncertainty.text).toContain('확정하지 않음');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await captureLive(page, 'saved-detail', width, testInfo);
  }
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
  await openHistory(page, rows[0].report.topic);
  await relogin(page, qa.account); await openHistory(page, rows[0].report.topic);
  expect(await historyRows(qa.account.client)).toEqual(rows);
  expect(await qa.readLanguage()).toEqual(legacy);
  await openHistory(page);
  // Wait for the real saved row instead of capturing an in-flight loading state.
  await expect(workspace(page).getByRole('button', { name: `${rows[0].report.topic} 기록 보기`, exact: true })).toBeVisible();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await captureLive(page, 'history', width, testInfo);
  }
});

test('Live uncertain RPC response survives reload and retries the same request exactly once', async ({ page, qa }) => {
  await login(page, qa.account, '/language/live'); await ready(page);
  const raw = reportText('합성 응답 유실 수업'); await preview(page, raw); await reviewed(page).check();
  const requests: string[] = []; let lose = true;
  await page.route(rpcUrl, async route => {
    requests.push(route.request().postDataJSON().p_request_id);
    const response = await route.fetch({ maxRetries: 0 }); expect(response.status()).toBe(200);
    if (lose) { lose = false; await route.abort('failed'); } else await route.fulfill({ response });
  });
  await workspace(page).getByRole('button', { name: '확인하고 서버에 저장', exact: true }).click();
  await expect(workspace(page).getByRole('button', { name: '같은 요청으로 저장 다시 확인', exact: true })).toBeEnabled();
  await expect(workspace(page).getByLabel('수업 보고서 원문', { exact: true })).toBeDisabled();
  expect(await historyRows(qa.account.client)).toHaveLength(1);
  page.on('dialog', dialog => dialog.accept());
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
  await workspace(page).getByText(/^이 계정의 기기 초안 \d+개$/).click();
  await workspace(page).getByRole('button', { name: /새 수업 초안.*저장 결과 확인 필요/ }).first().click();
  await expect(workspace(page).getByLabel('수업 보고서 원문', { exact: true })).toHaveValue(raw);
  await workspace(page).getByRole('button', { name: '같은 요청으로 저장 다시 확인', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: '서버 저장 확인 · 처음 등록 · 버전 1.' })).toBeVisible();
  expect(requests).toHaveLength(2); expect(new Set(requests).size).toBe(1);
  expect(await historyRows(qa.account.client)).toHaveLength(1);
  expect(await page.evaluate(owner => Object.keys(localStorage).filter(key => key.startsWith(`yeoni-language-live:${owner}:draft:v1:`)).length, qa.account.id)).toBe(1); // The read-only recovery source remains; only this tab's copy is removed.
  expect(await qa.readLanguage()).toEqual(originalLanguage);
});

test('Live verification GET failure keeps a submitted draft locked through reload and needs a real readback', async ({ page, qa }) => {
  await login(page, qa.account, '/language/live'); await ready(page);
  await preview(page, reportText('합성 저장 확인 조회 실패')); await reviewed(page).check();
  const requests: string[] = [];
  await page.route(rpcUrl, async route => { requests.push(route.request().postDataJSON().p_request_id); await route.continue(); });
  await page.route(recordsUrl, route => route.fulfill({ status: 503, json: { message: 'synthetic verification failure' } }));
  await workspace(page).getByRole('button', { name: '확인하고 서버에 저장', exact: true }).click();
  await expect(workspace(page).getByRole('button', { name: '같은 요청으로 저장 다시 확인', exact: true })).toBeEnabled();
  await expect(workspace(page).getByRole('status').filter({ hasText: '서버 저장 확인 ·' })).toHaveCount(0);
  expect(await historyRows(qa.account.client)).toHaveLength(1);
  page.on('dialog', dialog => dialog.accept());
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
  await workspace(page).getByText(/^이 계정의 기기 초안 \d+개$/).click();
  await workspace(page).getByRole('button', { name: /새 수업 초안.*저장 결과 확인 필요/ }).first().click();
  await expect(workspace(page).getByLabel('2. 수업 주제', { exact: true })).toBeDisabled();
  await page.unroute(recordsUrl);
  await workspace(page).getByRole('button', { name: '같은 요청으로 저장 다시 확인', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: '서버 저장 확인 · 처음 등록 · 버전 1.' })).toBeVisible();
  expect(requests).toHaveLength(2); expect(new Set(requests).size).toBe(1);
  expect(await historyRows(qa.account.client)).toHaveLength(1);
});

test('Live duplicate requires a reason and explicit opt-in, locks it after uncertainty, and accepts a separate date', async ({ page, qa }) => {
  const raw = reportText('합성 중복 수업'); await seed(qa.account.client, raw);
  await login(page, qa.account, '/language/live'); await ready(page); await preview(page, raw); await reviewed(page).check();
  await workspace(page).getByRole('button', { name: '확인하고 서버에 저장', exact: true }).click();
  await expect(workspace(page).getByText('같은 보고서가 이미 있어요.', { exact: true })).toBeVisible();
  expect(await historyRows(qa.account.client)).toHaveLength(1);
  await expect(workspace(page).getByRole('checkbox', { name: '중복 입력이 아니라 실제로 다른 수업임을 확인했어요.' })).not.toBeChecked();
  await workspace(page).getByLabel('별도 수업인 이유', { exact: true }).fill('동일한 내용을 다시 진행한 별도 합성 수업');
  await workspace(page).getByRole('checkbox', { name: '중복 입력이 아니라 실제로 다른 수업임을 확인했어요.' }).check();
  await workspace(page).getByRole('checkbox', { name: '중복 입력이 아니라 실제로 다른 수업임을 확인했어요.' }).uncheck();
  await workspace(page).getByRole('button', { name: '확인하고 서버에 저장', exact: true }).click();
  await expect(workspace(page).getByRole('alert').filter({ hasText: '같은 원문과 날짜의 수업이 이미 있어요.' })).toBeVisible();
  expect(await historyRows(qa.account.client)).toHaveLength(1);
  await workspace(page).getByRole('checkbox', { name: '중복 입력이 아니라 실제로 다른 수업임을 확인했어요.' }).check();
  let lose = true;
  await page.route(rpcUrl, async route => {
    const response = await route.fetch({ maxRetries: 0 }); expect(response.status()).toBe(200);
    if (lose) { lose = false; await route.abort('failed'); } else await route.fulfill({ response });
  });
  await workspace(page).getByRole('button', { name: '확인하고 서버에 저장', exact: true }).click();
  await expect(workspace(page).getByRole('button', { name: '같은 요청으로 저장 다시 확인', exact: true })).toBeEnabled();
  await expect(workspace(page).getByLabel('별도 수업인 이유', { exact: true })).toBeDisabled();
  await expect(workspace(page).getByRole('checkbox', { name: '중복 입력이 아니라 실제로 다른 수업임을 확인했어요.' })).toBeDisabled();
  await workspace(page).getByRole('button', { name: '같은 요청으로 저장 다시 확인', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: '서버 저장 확인 · 처음 등록 · 버전 1.' })).toBeVisible();
  expect(await historyRows(qa.account.client)).toHaveLength(2);
  await page.unroute(rpcUrl);
  await preview(page, reportText('합성 중복 수업', '2026-10-10')); await save(page);
  expect(await historyRows(qa.account.client)).toHaveLength(3);
  expect(await qa.readLanguage()).toEqual(originalLanguage);
});

test('Live edits, delete cancellation, tombstone, and historical restoration preserve every original revision', async ({ page, qa }) => {
  const raw = reportText('합성 이력 보존 수업'); const original = await seed(qa.account.client, raw);
  await login(page, qa.account, '/language/live'); await ready(page); await openHistory(page, original.report.topic);
  await workspace(page).getByRole('button', { name: '이 수업 수정하기', exact: true }).click();
  await expect(workspace(page).getByLabel('수업 보고서 원문', { exact: true })).toBeDisabled();
  await workspace(page).getByLabel('2. 수업 주제', { exact: true }).fill('합성 수정한 수업'); await save(page, '내용 수정', 2);
  await workspace(page).getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
  const removal = workspace(page).getByRole('region', { name: '휴지통 이동 확인' });
  await removal.getByRole('button', { name: '닫기', exact: true }).click(); expect(await historyRows(qa.account.client)).toHaveLength(2);
  await workspace(page).getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
  await removal.getByRole('button', { name: '확인하고 휴지통으로 이동', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: '서버 저장 확인 · 휴지통 이동 · 버전 3.' })).toBeVisible();
  await openHistory(page); await expect(workspace(page).getByText('아직 서버에 저장한 AI Live 수업이 없어요.', { exact: true })).toBeVisible();
  await workspace(page).getByRole('checkbox', { name: '휴지통 기록도 보기' }).check();
  await workspace(page).getByRole('button', { name: '합성 수정한 수업 기록 보기', exact: true }).click();
  const firstRevision = workspace(page).getByRole('region', { name: '수정·삭제·복원 이력' }).locator('li').filter({ hasText: '버전 1 · 처음 등록' });
  await firstRevision.getByRole('button', { name: '이 버전으로 복원', exact: true }).click();
  await workspace(page).getByRole('region', { name: '복원 확인' }).getByRole('button', { name: '확인하고 복원', exact: true }).click();
  await expect(workspace(page).getByRole('status').filter({ hasText: '서버 저장 확인 · 이전 내용 복원 · 버전 4.' })).toBeVisible();
  const rows = await historyRows(qa.account.client);
  expect(rows.map(row => row.operation)).toEqual(['create', 'edit', 'delete', 'restore']);
  expect(rows[0]).toEqual(original); expect(rows[3].report).toEqual(original.report);
  expect(rows.every(row => row.report.rawText === raw)).toBe(true); expect(rows[3].restored_from_revision).toBe(1);
  expect(await qa.readLanguage()).toEqual(originalLanguage);
});

test('Live v1 missing fields and unknown dates stay explicit and draft close, cancel, back, forward and account isolation preserve input', async ({ page, qa }) => {
  await login(page, qa.account, '/language/live'); await ready(page);
  const raw = '[연이 AI 일본어 학습 기록 v1]\n수업 주제: 합성 구형 보고서\n읽기 학습 결과: あ를 읽음';
  await preview(page, raw);
  await expect(workspace(page).getByText('학습 날짜가 미확인이에요. 오늘 날짜를 임의로 넣지 않아요.', { exact: true })).toBeVisible();
  await workspace(page).getByRole('button', { name: '이 기기 초안 지우기', exact: true }).click();
  await workspace(page).getByRole('button', { name: '취소', exact: true }).click();
  await expect(workspace(page).getByLabel('수업 보고서 원문', { exact: true })).toHaveValue(raw);
  page.once('dialog', dialog => dialog.dismiss());
  await workspace(page).getByRole('link', { name: '← 일본어 학습', exact: true }).click();
  await expect(page).toHaveURL(/\/language\/live$/);
  page.on('dialog', dialog => dialog.accept());
  await workspace(page).getByRole('link', { name: '← 일본어 학습', exact: true }).click();
  await expect(page).toHaveURL(/\/language$/);
  await page.goBack({ waitUntil: 'domcontentloaded' }); await ready(page);
  await page.goForward({ waitUntil: 'domcontentloaded' }); await expect(page).toHaveURL(/\/language$/);
  await page.goto('/language/live', { waitUntil: 'domcontentloaded' }); await ready(page);
  await workspace(page).getByText(/^이 계정의 기기 초안 \d+개$/).click();
  await workspace(page).getByRole('button', { name: /새 수업 초안/ }).first().click();
  await expect(workspace(page).getByLabel('수업 보고서 원문', { exact: true })).toHaveValue(raw);
  const other = await qa.createAccount(); await relogin(page, other);
  await expect(workspace(page).getByText(/이 계정의 기기 초안/)).toHaveCount(0);
  await expect(workspace(page).getByLabel('수업 보고서 원문', { exact: true })).toHaveValue('');
  await relogin(page, qa.account);
  await workspace(page).getByText(/^이 계정의 기기 초안 \d+개$/).click();
  await workspace(page).getByRole('button', { name: /새 수업 초안/ }).first().click();
  await save(page);
  const rows = await historyRows(qa.account.client); expect(rows[0].report.reportVersion).toBe('v1'); expect(rows[0].report.lessonDate).toBeNull();
  expect(rows[0].report.fields.speaking.presence).toBe('unknown');
  expect(await historyRows(other.client)).toEqual([]);
  const forbidden = await other.client.from('language_live_lessons').select('*').eq('user_id', qa.account.id); expect(forbidden.error).toBeNull(); expect(forbidden.data).toEqual([]);
});

test('Live independent sessions reject stale edits and retain both the current server revision and losing draft', async ({ page, qa, browser }) => {
  const original = await seed(qa.account.client, reportText('합성 동시 수정 수업'));
  await login(page, qa.account, '/language/live'); await ready(page); await openHistory(page, original.report.topic);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const traffic = new Traffic('Live-B'); await traffic.install(context);
  try {
    const second = await context.newPage(); await login(second, qa.account, '/language/live'); await ready(second); await openHistory(second, original.report.topic);
    await workspace(page).getByRole('button', { name: '이 수업 수정하기', exact: true }).click();
    await workspace(second).getByRole('button', { name: '이 수업 수정하기', exact: true }).click();
    await workspace(page).getByLabel('2. 수업 주제', { exact: true }).fill('합성 먼저 저장한 수정');
    await workspace(second).getByLabel('2. 수업 주제', { exact: true }).fill('합성 늦은 수정 초안');
    await save(page, '내용 수정', 2); await reviewed(second).check();
    await workspace(second).getByRole('button', { name: '확인하고 수정 이력 저장', exact: true }).click();
    await expect(workspace(second).getByRole('alert').filter({ hasText: '다른 곳에서 수업 기록이 바뀌었거나' })).toBeVisible();
    await expect(workspace(second).getByLabel('2. 수업 주제', { exact: true })).toHaveValue('합성 늦은 수정 초안');
    const rows = await historyRows(qa.account.client); expect(rows).toHaveLength(2); expect(rows[1].report.topic).toBe('합성 먼저 저장한 수정');
    await workspace(second).getByRole('button', { name: '서버의 최신 기록 보기', exact: true }).click();
    await expect(workspace(second).getByRole('heading', { name: '합성 먼저 저장한 수정', exact: true })).toBeVisible();
    expect(await qa.readLanguage()).toEqual(originalLanguage);
  } finally {
    traffic.releaseAll(); await traffic.drain(); await context.unrouteAll({ behavior: 'wait' }); await context.close(); expect(traffic.blockedOrigins.size).toBe(0);
  }
});

test('Live two tabs recovering the same local draft keep separate edits and shared lesson identity', async ({ page, context, qa }) => {
  await login(page, qa.account, '/language/live'); await ready(page);
  const raw = reportText('합성 탭별 초안'); await preview(page, raw);
  const originalDraft = await page.evaluate(owner => {
    const key = Object.keys(localStorage).find(value => value.startsWith(`yeoni-language-live:${owner}:draft:v1:`))!;
    return { key, encoded: localStorage.getItem(key) };
  }, qa.account.id);
  const second = await context.newPage();
  try {
    await second.goto('/language/live', { waitUntil: 'domcontentloaded' }); await ready(second);
    await workspace(second).getByText(/^이 계정의 기기 초안 \d+개$/).click();
    await workspace(second).getByRole('button', { name: /새 수업 초안/ }).first().click();
    await workspace(page).getByLabel('2. 수업 주제', { exact: true }).fill('합성 원래 탭 수정');
    await workspace(second).getByLabel('2. 수업 주제', { exact: true }).fill('합성 복구 탭 수정');
    await expect(workspace(page).getByLabel('2. 수업 주제', { exact: true })).toHaveValue('합성 원래 탭 수정');
    await expect(workspace(second).getByLabel('2. 수업 주제', { exact: true })).toHaveValue('합성 복구 탭 수정');
    const drafts = await page.evaluate(owner => Object.keys(localStorage).filter(key => key.startsWith(`yeoni-language-live:${owner}:draft:v1:`)).map(key => JSON.parse(localStorage.getItem(key)!)), qa.account.id);
    expect(drafts).toHaveLength(2);
    expect(new Set(drafts.map(draft => draft.draftId)).size).toBe(2);
    expect(new Set(drafts.map(draft => draft.lessonId)).size).toBe(1);
    expect(drafts.map(draft => draft.report.topic).sort()).toEqual(['합성 복구 탭 수정', '합성 원래 탭 수정']);
    expect(await page.evaluate(key => localStorage.getItem(key), originalDraft.key)).not.toBe(originalDraft.encoded);
    await save(second);
    await expect(workspace(page).getByLabel('2. 수업 주제', { exact: true })).toHaveValue('합성 원래 탭 수정');
    await reviewed(page).check();
    await workspace(page).getByRole('button', { name: '확인하고 서버에 저장', exact: true }).click();
    await expect(workspace(page).getByRole('alert').filter({ hasText: '다른 곳에서 수업 기록이 바뀌었거나' })).toBeVisible();
    expect(await historyRows(qa.account.client)).toHaveLength(1);
    const preserved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), originalDraft.key);
    expect(preserved.report.topic).toBe('합성 원래 탭 수정');
  } finally { await second.close(); }
});

test('Live in-flight account A response cannot populate account B and A can recover the exact pending request', async ({ page, qa }) => {
  const other = await qa.createAccount();
  await login(page, qa.account, '/language/live'); await ready(page);
  const raw = reportText('합성 계정 전환 중 저장'); await preview(page, raw); await reviewed(page).check();
  const drain = new RouteDrain(); let release!: () => void; let arrived!: () => void; let hold = true;
  const released = new Promise<void>(resolve => { release = resolve; }); const seen = new Promise<void>(resolve => { arrived = resolve; });
  const requests: string[] = [];
  const delayed = (route: Route) => drain.run(async () => {
    requests.push(route.request().postDataJSON().p_request_id);
    const response = await route.fetch({ maxRetries: 0 }); expect(response.status()).toBe(200);
    if (hold) { hold = false; arrived(); await released; }
    await route.fulfill({ response });
  });
  await page.route(rpcUrl, delayed);
  try {
    await workspace(page).getByRole('button', { name: '확인하고 서버에 저장', exact: true }).click(); await seen;
    await relogin(page, other);
    release(); await drain.wait();
    await expect(workspace(page).getByLabel('수업 보고서 원문', { exact: true })).toHaveValue('');
    await expect(workspace(page).getByRole('status').filter({ hasText: '서버 저장 확인 ·' })).toHaveCount(0);
    await expect(workspace(page).getByText(/이 계정의 기기 초안/)).toHaveCount(0);
    expect(await historyRows(other.client)).toEqual([]); expect(await historyRows(qa.account.client)).toHaveLength(1);
    await relogin(page, qa.account);
    await workspace(page).getByText(/^이 계정의 기기 초안 \d+개$/).click();
    await workspace(page).getByRole('button', { name: /새 수업 초안.*저장 결과 확인 필요/ }).first().click();
    await expect(workspace(page).getByLabel('수업 보고서 원문', { exact: true })).toHaveValue(raw);
    await workspace(page).getByRole('button', { name: '같은 요청으로 저장 다시 확인', exact: true }).click();
    await expect(workspace(page).getByRole('status').filter({ hasText: '서버 저장 확인 · 처음 등록 · 버전 1.' })).toBeVisible();
    expect(requests).toHaveLength(2); expect(new Set(requests).size).toBe(1);
    expect(await historyRows(qa.account.client)).toHaveLength(1); expect(await historyRows(other.client)).toEqual([]);
    expect(await qa.readLanguage()).toEqual(originalLanguage); expect(await qa.readLanguage(other)).toEqual(originalLanguage);
  } finally { release(); await drain.wait(); await page.unroute(rpcUrl, delayed); }
});

test('Live schema and read errors are not empty history, and late detail reads cannot reopen a dismissed record', async ({ page, qa }) => {
  const original = await seed(qa.account.client, reportText('합성 늦은 상세 조회'));
  await page.route(currentUrl, route => route.fulfill({ status: 404, json: { code: 'PGRST205', message: 'Synthetic missing table' } }));
  await login(page, qa.account, '/language/live'); await ready(page);
  await expect(workspace(page).getByText('서버 기록 저장을 아직 사용할 수 없어요.', { exact: true })).toBeVisible();
  await preview(page, reportText('합성 오프라인 초안')); await reviewed(page).check();
  await expect(workspace(page).getByRole('button', { name: '확인하고 서버에 저장', exact: true })).toBeDisabled();
  await openHistory(page);
  await expect(workspace(page).getByText('아직 서버에 저장한 AI Live 수업이 없어요.', { exact: true })).toHaveCount(0);
  await page.unroute(currentUrl); await workspace(page).getByRole('button', { name: '이력 새로고침', exact: true }).click();
  await expect(workspace(page).getByRole('button', { name: `${original.report.topic} 기록 보기`, exact: true })).toBeVisible();
  const drain = new RouteDrain(); let release!: () => void; let arrived!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; }); const seen = new Promise<void>(resolve => { arrived = resolve; });
  const delayed = (route: Route) => drain.run(async () => { const response = await route.fetch({ maxRetries: 0 }); arrived(); await released; await route.fulfill({ response }); });
  await page.route(recordsUrl, delayed);
  try {
    await workspace(page).getByRole('button', { name: `${original.report.topic} 기록 보기`, exact: true }).click(); await seen;
    await workspace(page).getByRole('button', { name: '목록으로', exact: true }).click(); release(); await drain.wait();
    await expect(workspace(page).getByRole('heading', { name: '학습 이력', exact: true })).toBeVisible();
    await expect(workspace(page).getByRole('heading', { name: '수업 기록', exact: true })).toHaveCount(0);
    expect(await historyRows(qa.account.client)).toHaveLength(1);
  } finally { release(); await drain.wait(); await page.unroute(recordsUrl, delayed); }
});
