import type { Page } from '@playwright/test';
import { exerciseGuides } from '../../app/data/exerciseGuides';
import { buildCurrentWorkoutSettings } from '../../app/data/currentWorkoutDirection';
import { expect, isSharedSyncWrite, login, original, synced, test, today, type State } from './fixture';

const key = 'ai-fitness-workout-completed-days';
const title = '부위·운동명 반복 입력';
const offset = (days: number) => new Date(Date.parse(`${today()}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
const card = (page: Page) => page.getByRole('region', { name: title, exact: true });
const source = (page: Page, date = offset(1)) => card(page).getByRole('region', { name: `${date} 저장 기록 근거`, exact: true });
function seededState(): State {
  const pair = {
    workoutPainArea: '무릎', workoutPainExercise: '버드독', workoutPainSet: 1, workoutPain: false,
    workoutExerciseRecords: [1, 2].map(roundNumber => ({ exerciseName: '버드독', status: 'partial', painScore: 0,
      executionContext: { method: 'circuit', sourceExerciseIndex: 4, sequenceIndex: roundNumber - 1, roundNumber },
      sets: [{ setNumber: 1, completed: true, reps: 6 }] })),
  };
  return { ...original,
    'ai-fitness-user-workout-settings': buildCurrentWorkoutSettings({ weeklyGroups: {}, weeklyMethods: {}, weeklyEdits: {}, exerciseTargets: {}, dateOverrides: {} }),
    'ai-fitness-selected-weekly-workout-plan': 'five-day-fullbody-circuit',
    'ai-fitness-workout-direction-version': 'five-day-circuit-v1',
    [key]: { [offset(1)]: pair, [offset(20)]: pair, [offset(2)]: true, [offset(3)]: { workoutPain: false },
      [offset(4)]: { workoutPainArea: ['invalid'], workoutPainExercise: '버드독' },
      [today()]: { workoutStatus: 'stopped', workoutPain: true, workoutBackStatus: 'pain', workoutPainArea: '허리', workoutPainExercise: '오늘 전용' },
      [offset(29)]: pair },
  };
}
async function openBoth(page: Page) {
  await card(page).getByRole('link', { name: `${offset(1)} 기록 보기`, exact: true }).click();
  await expect(source(page)).toBeVisible();
  await card(page).getByRole('button', { name: '기존 자세·중단 기준 보기', exact: true }).click();
  await expect(card(page).getByRole('region', { name: '버드독 기존 일반 가이드', exact: true })).toBeVisible();
}
async function changeLocal(page: Page, raw: string | null, event = true) {
  await page.evaluate(({ key, raw, event }) => {
    if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw);
    if (event) window.dispatchEvent(new Event('yeoni-records-changed'));
  }, { key, raw, event });
}

test('stored-date pain input evidence opens exact sources and existing guides read-only at 320px while today hold remains', async ({ page, qa }) => {
  const seeded = seededState();
  expect((await qa.account.client.from('user_app_state').update({ state: seeded }).eq('user_id', qa.account.id)).error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page); await page.goto('/fitness');
  const panel = card(page);
  await expect(panel.getByRole('region', { name: '전체 28일 입력 범위', exact: true })).toContainText('일반 운동 기록이 있는 저장 날짜 5개');
  await expect(panel).toContainText('부위 선택 2 · 미응답 2 · 값 확인불가 1');
  await expect(panel).toContainText('부위·운동명이 함께 입력된 저장 날짜 2개 중 2개');
  await expect(panel).toContainText('최근 14일 1개 / 이전 14일 1개');
  await expect(panel).toContainText('과거 기록의 실제 발생일은 확인할 수 없어요');
  await expect(panel).not.toContainText('오늘 전용');
  const adaptive = page.getByRole('region', { name: '기록에 따른 운동 조정', exact: true });
  await expect(adaptive).toContainText('운동 변경 보류 · 증상 확인 우선');
  await expect(adaptive.getByRole('button', { name: '변경 내용 확인', exact: true })).toHaveCount(0);
  await synced(page);
  const beforeServer = await qa.read();
  const beforeLocal = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('ai-fitness-'))));
  const baselineWrites = qa.traffic.entries.filter(isSharedSyncWrite).length;
  await page.evaluate(() => {
    const scope = window as Window & { painEvidenceWrites?: string[]; painEvidenceOriginalSet?: Storage['setItem']; painEvidenceOriginalRemove?: Storage['removeItem'] };
    scope.painEvidenceWrites = []; scope.painEvidenceOriginalSet = Storage.prototype.setItem; scope.painEvidenceOriginalRemove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('ai-fitness-')) scope.painEvidenceWrites!.push(key); return scope.painEvidenceOriginalSet!.call(this, key, value); };
    Storage.prototype.removeItem = function (key) { if (key.startsWith('ai-fitness-')) scope.painEvidenceWrites!.push(key); return scope.painEvidenceOriginalRemove!.call(this, key); };
  });
  const link = panel.getByRole('link', { name: `${offset(1)} 기록 보기`, exact: true });
  await expect(link).toHaveAttribute('href', `#workout-pain-source-${offset(1)}`);
  await link.focus(); await page.keyboard.press('Enter');
  await expect(source(page)).toBeFocused();
  await link.focus(); await page.keyboard.press('Enter'); await expect(source(page)).toBeFocused();
  await expect(source(page)).toContainText('같은 세트 번호의 후보 2개');
  await expect(source(page)).toContainText('false나 점수 0을 전신 무통증 응답으로 세지 않아요');
  await source(page).getByRole('button', { name: '날짜 기록 닫기', exact: true }).click();
  await expect(link).toBeFocused();
  await openBoth(page);
  const guide = panel.getByRole('region', { name: '버드독 기존 일반 가이드', exact: true });
  await expect(guide).toContainText('일반 가이드예요');
  const storedGuide = exerciseGuides['버드독'];
  const expectedHref = storedGuide.videoUrl ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(storedGuide.videoSearchQuery!)}`;
  await expect(guide.getByRole('link')).toHaveAttribute('href', expectedHref);
  await panel.getByRole('button', { name: '기존 가이드 닫기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => (window as Window & { painEvidenceWrites?: string[] }).painEvidenceWrites)).toEqual([]);
  expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('ai-fitness-'))))).toEqual(beforeLocal);
  expect(await qa.read()).toEqual(beforeServer);
  expect(qa.traffic.entries.filter(isSharedSyncWrite)).toHaveLength(baselineWrites);
  await page.reload(); await synced(page); await expect(panel).toContainText('부위·운동명이 함께 입력된 저장 날짜 2개 중 2개');
  await page.goto('/diet'); await page.goBack(); await expect(panel).toBeVisible(); await expect(source(page)).toHaveCount(0);
  await page.goForward(); await expect(panel).toHaveCount(0);
});

test('pain evidence source activation rejects a silently changed or deleted source and never substitutes today', async ({ page, qa }) => {
  expect((await qa.account.client.from('user_app_state').update({ state: seededState() }).eq('user_id', qa.account.id)).error).toBeNull();
  await login(page, qa.account); await synced(page); await page.goto('/fitness');
  const staleLink = card(page).getByRole('link', { name: `${offset(1)} 기록 보기`, exact: true });
  await expect(staleLink).toBeVisible();
  // Keep the already-rendered anchor and silently invalidate its source in the
  // same browser task as activation. No watcher event or React rerender can
  // replace its original handler first. Real keyboard activation is covered above.
  const originalRaw = await staleLink.evaluate((link, { key, date }) => {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('pain-source-fixture-missing');
    const changed = JSON.parse(raw) as Record<string, unknown>;
    if (!Object.hasOwn(changed, date)) throw new Error('pain-source-fixture-date-missing');
    delete changed[date];
    localStorage.setItem(key, JSON.stringify(changed));
    (link as HTMLAnchorElement).click();
    return raw;
  }, { key, date: offset(1) });
  await expect(card(page)).toContainText('기록이 바뀌었어요. 최신 근거를 다시 확인해 주세요.');
  await expect(source(page)).toHaveCount(0); await expect(card(page)).not.toContainText('오늘 전용');
  await card(page).getByRole('button', { name: '날짜별 전체 입력 근거 보기', exact: true }).click();
  await expect(card(page).getByRole('link', { name: `${offset(1)} 기록 보기`, exact: true })).toHaveCount(0);
  await changeLocal(page, originalRaw);
  await expect(card(page).getByRole('link', { name: `${offset(1)} 기록 보기`, exact: true })).toBeVisible();
});

test('pain evidence clears private panels on corrupt reads, pending saves, reset and resume and recovers only from verified bytes', async ({ page, qa }) => {
  expect((await qa.account.client.from('user_app_state').update({ state: seededState() }).eq('user_id', qa.account.id)).error).toBeNull();
  await login(page, qa.account); await synced(page); await page.goto('/fitness');
  const originalRaw = await page.evaluate(key => localStorage.getItem(key)!, key);
  await openBoth(page); await changeLocal(page, '{');
  await expect(card(page)).toContainText('기록을 읽을 수 없어요');
  await expect(source(page)).toHaveCount(0); await expect(card(page)).not.toContainText('이 기간에 확인할 일반 운동 기록이 없어요');
  await changeLocal(page, originalRaw); await openBoth(page);
  await page.evaluate(() => { localStorage.setItem('yeoni-storage-transaction-v1', '{}'); window.dispatchEvent(new Event('yeoni-records-changed')); });
  await expect(card(page)).toContainText('저장·복구 상태를 확인 중이에요'); await expect(source(page)).toHaveCount(0);
  await page.evaluate(() => { localStorage.removeItem('yeoni-storage-transaction-v1'); window.dispatchEvent(new Event('yeoni-records-changed')); });
  await openBoth(page);
  await page.evaluate(() => { document.documentElement.dataset.recordReset = 'running'; window.dispatchEvent(new Event('ai-yeoni-record-reset')); });
  await expect(card(page)).toContainText('기록 초기화를 확인 중이에요'); await expect(source(page)).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.dataset.recordReset = ''; window.dispatchEvent(new Event('ai-yeoni-record-reset')); });
  await openBoth(page); await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(source(page)).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(card(page)).toContainText('부위·운동명이 함께 입력된 저장 날짜 2개 중 2개');
  await expect(source(page)).toHaveCount(0);
  // Synthetic event dispatch exercises handlers; it is not proof of a browser placing the page in BFCache.
});

test('pain evidence observes another tab source removal and reset generation without exposing old private panels', async ({ page, context, qa }) => {
  expect((await qa.account.client.from('user_app_state').update({ state: seededState() }).eq('user_id', qa.account.id)).error).toBeNull();
  await login(page, qa.account); await synced(page); await page.goto('/fitness');
  const peer = await context.newPage();
  try {
    await peer.goto('/fitness'); await synced(peer); await page.bringToFront(); await openBoth(page);
    await peer.evaluate(({ key, date }) => { const rows = JSON.parse(localStorage.getItem(key)!); delete rows[date]; localStorage.setItem(key, JSON.stringify(rows)); }, { key, date: offset(1) });
    await expect(source(page)).toHaveCount(0);
    await expect(card(page)).not.toContainText('부위·운동명이 함께 입력된 저장 날짜 2개 중 2개');
    await peer.evaluate(key => {
      localStorage.removeItem(key);
      localStorage.setItem('ai-fitness-record-reset-fitness', `${new Date().toISOString()}|synthetic-pain-reset`);
      localStorage.setItem('ai-yeoni-record-reset-event', 'synthetic-pain-reset');
    }, key);
    await expect(source(page)).toHaveCount(0);
    await expect(card(page)).not.toContainText('무릎 · 버드독');
  } finally { await peer.close(); }
});
