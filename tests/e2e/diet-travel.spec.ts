import type { Page } from '@playwright/test';
import { test, expect, login, synced, original, assertOriginalPreserved, localState, type State } from './fixture';
import { reauthenticateFixtureAccount } from './fixture-account-auth';

// Authored acceptance for real Auth/PostgREST in the disposable local stack.
// Discovery is not execution. Never run this spec against hosted/personal data.
const key = 'ai-fitness-social-meal-mode';
const calendarKey = 'yeoni-qa-travel-calendar-day';
const travelGuide = '여행은 감량보다 유지와 복귀가 목표입니다. 매 끼니를 완벽하게 맞출 필요는 없습니다.';
const normalGuide = '평소 식사 리듬과 하루 단백질·수분 목표를 관리합니다.';
const originalSchedules = { '2001-01-02': 'dinner', '2029-01-20': 'lunch' };
const section = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: '일정에 맞춰 식단 기준을 바꾸세요', exact: true }) });
const scheduleDate = (date: string) => { const [, month, day] = date.split('-'); return `${Number(month)}월 ${Number(day)}일`; };
const datesBetween = (start: string, count: number) => Array.from({ length: count }, (_, index) => new Date(Date.parse(`${start}T12:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));
const travelDates = (dates: string[]) => Object.fromEntries(dates.map(date => [date, 'travel']));
const noOverflow = async (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

async function installCalendarDate(page: Page, initial: string) {
  // Shift only no-argument Date construction, used by the app's local calendar.
  // Date.now(), timers, explicit server dates and Auth expiration remain real;
  // distant month/year/leap fixtures must not fabricate an expired JWT clock.
  await page.addInitScript(({ key, initial }) => {
    if (location.origin !== 'http://127.0.0.1:3000') return;
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, initial);
    const NativeDate = Date;
    window.Date = new Proxy(NativeDate, {
      construct(target, args, newTarget) {
        return Reflect.construct(target, args.length ? args : [`${sessionStorage.getItem(key) ?? initial}T12:00:00+09:00`], newTarget);
      },
    });
  }, { key: calendarKey, initial });
  // Applying a schedule can leave the separate today editor dirty. The test
  // explicitly chooses reload; it does not save or discard any personal data.
  page.on('dialog', async dialog => { expect(dialog.type()).toBe('beforeunload'); await dialog.accept(); });
}
async function reloadOn(page: Page, date: string) {
  await page.evaluate(({ key, date }) => sessionStorage.setItem(key, date), { key: calendarKey, date });
  await page.reload(); await synced(page);
}
async function applyTravel(page: Page, start: string, end: string) {
  const panel = section(page);
  await panel.getByRole('button', { name: '여행', exact: true }).click();
  await panel.getByLabel('시작일', { exact: true }).fill(start);
  await panel.getByLabel('종료일', { exact: true }).fill(end);
  await panel.getByRole('button', { name: '여행 기간 적용', exact: true }).click();
}
async function removeDate(page: Page, date: string) {
  const panel = section(page), details = panel.locator('details');
  if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator('summary').click();
  const row = details.locator('div').filter({ has: page.getByText(scheduleDate(date), { exact: true }) }).filter({ has: page.getByRole('button', { name: '삭제', exact: true }) }).last();
  await row.getByRole('button', { name: '삭제', exact: true }).click();
}
async function failNextScheduleWrite(page: Page) {
  await page.evaluate(key => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (candidate: string, value: string) {
      if (this === localStorage && candidate === key) {
        Storage.prototype.setItem = originalSetItem;
        throw new DOMException('Synthetic travel storage failure', 'QuotaExceededError');
      }
      return originalSetItem.call(this, candidate, value);
    };
  }, key);
}
function assertOnlyScheduleChanged(saved: State, before: State, schedules: Record<string, string>) {
  expect(saved).toEqual({ ...before, [key]: schedules });
  assertOriginalPreserved(saved);
}

for (const scenario of [
  { label: 'month', start: '2026-10-31', end: '2026-11-02', after: '2026-11-03', count: 3, width: 320 },
  { label: 'year', start: '2026-12-31', end: '2027-01-01', after: '2027-01-02', count: 2, width: 390 },
  { label: 'leap February', start: '2028-02-28', end: '2028-03-01', after: '2028-03-02', count: 3, width: 390 },
]) test(`travel includes both endpoints across ${scenario.label}, reloads and returns to normal at ${scenario.width}px`, async ({ page, qa }) => {
  const seeded = { ...original, [key]: originalSchedules };
  expect((await qa.account.client.from('user_app_state').update({ state: seeded }).eq('user_id', qa.account.id)).error).toBeNull();
  await installCalendarDate(page, scenario.start); await page.setViewportSize({ width: scenario.width, height: 844 });
  await login(page, qa.account); await synced(page); await page.goto('/diet');
  await expect(section(page).getByText(normalGuide, { exact: true })).toBeVisible();
  await applyTravel(page, scenario.start, scenario.end);
  const expected = { ...originalSchedules, ...travelDates(datesBetween(scenario.start, scenario.count)) };
  await expect.poll(async () => (await qa.read())[key]).toEqual(expected); await synced(page);
  const saved = await qa.read(); assertOnlyScheduleChanged(saved, seeded, expected); qa.traffic.assertConfirmed(saved);
  await expect(section(page).getByText(travelGuide, { exact: true })).toBeVisible();
  for (const date of datesBetween(scenario.start, scenario.count)) {
    await reloadOn(page, date); await expect(section(page).getByText(travelGuide, { exact: true })).toBeVisible(); await noOverflow(page);
  }
  await reloadOn(page, scenario.after);
  await expect(section(page).getByText(normalGuide, { exact: true })).toBeVisible();
  await expect(section(page).getByText(travelGuide, { exact: true })).toHaveCount(0);
  expect((await localState(page))[key]).toEqual(expected);
  expect(await qa.read()).toEqual(saved); // Return requires no new row or global phase rewrite.
  await page.reload(); await synced(page); await expect(section(page).getByText(normalGuide, { exact: true })).toBeVisible();
  expect(await qa.read()).toEqual(saved); await noOverflow(page);
});

test('one-day travel ends the next day and preserves an explicit next-day dining schedule', async ({ page, qa }) => {
  const nextDay = '2026-11-01', seeded = { ...original, [key]: { ...originalSchedules, [nextDay]: 'lunch' } };
  expect((await qa.account.client.from('user_app_state').update({ state: seeded }).eq('user_id', qa.account.id)).error).toBeNull();
  await installCalendarDate(page, '2026-10-31'); await login(page, qa.account); await synced(page); await page.goto('/diet');
  await applyTravel(page, '2026-10-31', '2026-10-31');
  const expected = { ...seeded[key], '2026-10-31': 'travel' };
  await expect.poll(async () => (await qa.read())[key]).toEqual(expected); await synced(page);
  await page.reload(); await synced(page); await expect(section(page).getByText(travelGuide, { exact: true })).toBeVisible();
  await reloadOn(page, nextDay);
  await expect(section(page).getByText('식당 메뉴의 단백질을 계산하지 않아도 됩니다. 식사 구성을 고르면 필요한 프로틴이 자동으로 정해집니다.', { exact: true })).toBeVisible();
  await expect(section(page).getByText(travelGuide, { exact: true })).toHaveCount(0);
  assertOnlyScheduleChanged(await qa.read(), seeded, expected);
});

test('travel range editing and day deletion survive reload, preserve other dates and retain a failed-delete retry', async ({ page, qa }) => {
  const seeded = { ...original, [key]: originalSchedules };
  expect((await qa.account.client.from('user_app_state').update({ state: seeded }).eq('user_id', qa.account.id)).error).toBeNull();
  await installCalendarDate(page, '2026-10-31'); await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page); await page.goto('/diet');
  await applyTravel(page, '2026-10-31', '2026-11-02');
  let expected: Record<string, string> = { ...originalSchedules, ...travelDates(datesBetween('2026-10-31', 3)) };
  await expect.poll(async () => (await qa.read())[key]).toEqual(expected); await synced(page);
  // The existing model applies dates additively. Shortening means deleting the
  // unwanted day explicitly; this does not assert a nonexistent trip editor.
  await applyTravel(page, '2026-11-02', '2026-11-03'); expected = { ...expected, '2026-11-03': 'travel' };
  await expect.poll(async () => (await qa.read())[key]).toEqual(expected); await synced(page);
  await failNextScheduleWrite(page); await removeDate(page, '2026-11-03');
  await expect(page.getByText('일정을 삭제하지 못했어요. 기존 일정을 유지합니다.', { exact: true })).toBeVisible();
  expect((await localState(page))[key]).toEqual(expected); expect((await qa.read())[key]).toEqual(expected);
  await removeDate(page, '2026-11-03'); delete expected['2026-11-03'];
  await expect.poll(async () => (await qa.read())[key]).toEqual(expected); await synced(page);
  await removeDate(page, '2026-10-31'); delete expected['2026-10-31'];
  await expect.poll(async () => (await qa.read())[key]).toEqual(expected); await synced(page);
  await expect(section(page).getByText(normalGuide, { exact: true })).toBeVisible();
  await page.reload(); await synced(page); await expect(section(page).getByText(normalGuide, { exact: true })).toBeVisible();
  await reloadOn(page, '2026-11-01'); await expect(section(page).getByText(travelGuide, { exact: true })).toBeVisible();
  await reloadOn(page, '2026-11-03'); await expect(section(page).getByText(normalGuide, { exact: true })).toBeVisible();
  assertOnlyScheduleChanged(await qa.read(), seeded, expected); await noOverflow(page);
});

test('empty/reversed travel dates and a failed apply preserve persisted state and entered dates', async ({ page, qa }) => {
  await installCalendarDate(page, '2026-10-31'); await login(page, qa.account); await synced(page); await page.goto('/diet');
  const before = await qa.read(), localBefore = await localState(page);
  for (const [start, end] of [['2026-11-02', '2026-10-31'], ['', '2026-11-02'], ['2026-10-31', ''], ['', '']]) {
    await applyTravel(page, start, end);
    await expect(page.getByText('여행 종료일을 시작일 이후로 선택해주세요.', { exact: true })).toBeVisible();
    expect(await localState(page)).toEqual(localBefore); expect(await qa.read()).toEqual(before);
  }
  await failNextScheduleWrite(page); await applyTravel(page, '2026-10-31', '2026-11-01');
  await expect(page.getByText('여행 일정을 저장하지 못했어요. 선택한 날짜를 유지합니다. 저장 공간을 확인해 주세요.', { exact: true })).toBeVisible();
  await expect(section(page).getByLabel('시작일', { exact: true })).toHaveValue('2026-10-31');
  await expect(section(page).getByLabel('종료일', { exact: true })).toHaveValue('2026-11-01');
  expect(await localState(page)).toEqual(localBefore); expect(await qa.read()).toEqual(before);
  await section(page).getByRole('button', { name: '여행 기간 적용', exact: true }).click();
  const expected = travelDates(['2026-10-31', '2026-11-01']);
  await expect.poll(async () => (await qa.read())[key]).toEqual(expected); await synced(page);
  await page.reload(); await synced(page); await expect(section(page).getByText(travelGuide, { exact: true })).toBeVisible();
  assertOnlyScheduleChanged(await qa.read(), before, expected);
});

test('travel registration caps at 31 inclusive dates and restores normal criteria on the first excluded day', async ({ page, qa }) => {
  await installCalendarDate(page, '2026-10-31'); await page.setViewportSize({ width: 390, height: 844 });
  await login(page, qa.account); await synced(page); await page.goto('/diet'); const before = await qa.read();
  await applyTravel(page, '2026-10-31', '2026-12-15');
  await expect(page.getByText('여행 일정은 한 번에 최대 31일까지 등록할 수 있습니다.', { exact: true })).toBeVisible();
  const expected = travelDates(datesBetween('2026-10-31', 31));
  await expect.poll(async () => (await qa.read())[key]).toEqual(expected); await synced(page);
  expect(Object.keys(expected)).toHaveLength(31); expect(Object.keys(expected).at(-1)).toBe('2026-11-30');
  await reloadOn(page, '2026-11-30'); await expect(section(page).getByText(travelGuide, { exact: true })).toBeVisible();
  await reloadOn(page, '2026-12-01'); await expect(section(page).getByText(normalGuide, { exact: true })).toBeVisible();
  assertOnlyScheduleChanged(await qa.read(), before, expected); await noOverflow(page);
});

test('travel schedules remain owner-only across real logout/login and cannot be read or changed by another owner', async ({ page, qa }) => {
  await installCalendarDate(page, '2026-10-31'); await login(page, qa.account); await synced(page); await page.goto('/diet');
  await applyTravel(page, '2026-10-31', '2026-11-02');
  const expected = travelDates(datesBetween('2026-10-31', 3));
  await expect.poll(async () => (await qa.read())[key]).toEqual(expected); await synced(page); const ownerSaved = await qa.read();
  const other = await qa.createAccount(), otherBefore = await qa.read(other);
  expect((await other.client.from('user_app_state').select('user_id').eq('user_id', qa.account.id)).data).toEqual([]);
  const denied = await other.client.from('user_app_state').update({ state: { [key]: {} } }).eq('user_id', qa.account.id).select('user_id');
  expect(denied.error).toBeNull(); expect(denied.data).toEqual([]); expect(await qa.read()).toEqual(ownerSaved);
  await page.goto('/diet/settings'); await synced(page); await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
  await login(page, other); await synced(page); await page.goto('/diet');
  await expect(section(page).getByText(normalGuide, { exact: true })).toBeVisible();
  expect((await localState(page))[key]).toBeUndefined(); expect(await qa.read(other)).toEqual(otherBefore);
  await applyTravel(page, '2026-10-31', '2026-10-31');
  await expect.poll(async () => (await qa.read(other))[key]).toEqual({ '2026-10-31': 'travel' }); await synced(page);
  await reloadOn(page, '2026-11-01'); await expect(section(page).getByText(normalGuide, { exact: true })).toBeVisible();
  const otherSaved = await qa.read(other); assertOriginalPreserved(otherSaved);
  await page.goto('/diet/settings'); await synced(page); await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
  await login(page, qa.account); await reauthenticateFixtureAccount(qa.account); await synced(page); await page.goto('/diet');
  await expect(section(page).getByText(travelGuide, { exact: true })).toBeVisible();
  expect((await localState(page))[key]).toEqual(expected); expect(await qa.read()).toEqual(ownerSaved);
  await reauthenticateFixtureAccount(other); expect(await qa.read(other)).toEqual(otherSaved); assertOriginalPreserved(ownerSaved);
});
