import { test, expect } from './fixture';
import type { Page } from '@playwright/test';
import { captureFullPageEvidence } from './evidence-capture';

const storage = (page: Page) => page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), sentinel: localStorage.getItem('synthetic-h3-sentinel') }));
async function initialize(page: Page) {
  const requests = { writes: 0, api: 0 };
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) requests.writes++;
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.api++;
  });
  await page.goto('/?case=home-overview');
  await page.evaluate(() => localStorage.setItem('synthetic-h3-sentinel', 'unchanged'));
  return { requests, before: await storage(page), overview: page.getByRole('region', { name: '지금 확인할 요약', exact: true }),
    scenario: page.getByLabel('Synthetic home overview scenario', { exact: true }) };
}

test('actual home summary puts current state and the primary action in the first 320/390 viewport before chat', async ({ page }, testInfo) => {
  const { requests, before, overview, scenario } = await initialize(page);
  const action = overview.getByRole('region', { name: '연이가 고른 다음 한 걸음', exact: true });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const state of ['loading', 'unavailable', 'empty', 'completed', 'partial-failure', 'due-priority', 'important-priority', 'budget-next']) {
      await scenario.selectOption(state);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(overview.getByRole('heading', { name: '지금 확인할 요약', exact: true })).toBeInViewport({ ratio: 1 });
      expect((await overview.boundingBox())!.y).toBeLessThan((await page.getByRole('region', { name: 'Synthetic chat destination', exact: true }).boundingBox())!.y);
      await expect(overview).toContainText('미기록은 미수행으로 단정하지 않습니다.');
      if (state === 'loading') {
        await expect(overview.getByRole('status')).toHaveText('현재 기록을 확인하고 있어요.');
        await expect(overview.getByRole('status')).toBeInViewport({ ratio: 1 });
        await expect(action).toHaveCount(0);
      } else if (state === 'unavailable') {
        await expect(action).toHaveCount(0);
        await expect(overview).toContainText('연결 확인 정보를 불러오지 못했어요.');
        await expect(overview.getByRole('button', { name: '다시 불러오기', exact: true })).toBeInViewport({ ratio: 1 });
      } else {
        const [title, label, href] = state === 'due-priority' ? ['합성 오늘 마감', '할 일 확인 →', '#assistant-list'] :
          state === 'important-priority' ? ['합성 중요 할 일', '할 일 확인 →', '#assistant-list'] :
            state === 'budget-next' ? ['2,500원 초과했어요', '가계부에서 확인 →', '/budget'] :
              ['달력에서 일정을 확인해요', '통합 달력 보기 →', '/calendar'];
        await expect(action.getByRole('heading')).toHaveText(title);
        await expect(action.getByRole('heading')).toBeInViewport({ ratio: 1 });
        const link = action.getByRole('link', { name: label, exact: true });
        await expect(link).toHaveAttribute('href', href);
        await expect(link).toBeInViewport({ ratio: 1 });
        if (state === 'partial-failure') {
          await expect(overview).toContainText('할 일 · 가계부 정보를 불러오지 못했어요.');
          await expect(overview).toContainText('마지막 정상 확인 합성 시각의 값을 유지합니다.');
        } else await expect(overview.getByRole('status')).toHaveCount(0);
      }
      await expect(overview).not.toContainText('모두 완료');
      await expect(overview).not.toContainText('합성 조회 실패 영역의 이전 할 일');
      await expect(overview).not.toContainText('999,999');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await captureFullPageEvidence(page, `.e2e/component-browser/evidence/home-overview-${state}-${width}-${testInfo.project.name}.png`);
      expect(await storage(page)).toEqual(before);
    }
  }
  expect(requests).toEqual({ writes: 0, api: 0 });
});

test('actual home summary preserves keyboard destinations, retry gating, reload and long-text 200percent reflow without writes', async ({ page }, testInfo) => {
  const { requests, before, overview, scenario } = await initialize(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await scenario.selectOption('partial-failure');
  await overview.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.getByLabel('Synthetic refresh attempts', { exact: true })).toHaveText('1');
  await expect(overview.getByRole('button', { name: '다시 불러오기', exact: true })).toBeDisabled();
  await expect(overview.getByRole('region', { name: '연이가 고른 다음 한 걸음', exact: true })).toHaveCount(0);
  await expect(overview).toContainText('현재 기록을 확인하고 있어요.');
  await page.getByRole('button', { name: 'Complete synthetic refresh', exact: true }).click();
  await expect(overview.getByRole('button')).toHaveCount(0);
  await expect(page.getByLabel('Synthetic refresh attempts', { exact: true })).toHaveText('1');
  for (const [label, hash, destination] of [
    ['할 일 확인 →', '#assistant-list', 'Synthetic task destination'],
    ['연이에게 말하기 ↓', '#yeoni-chat', 'Synthetic chat destination'],
    ['앱별 오늘 상태 ↓', '#today-apps', 'Synthetic status destination'],
  ]) {
    await overview.getByRole('link', { name: label, exact: true }).focus();
    await page.keyboard.press('Enter');
    expect(new URL(page.url()).hash).toBe(hash);
    await expect(page.getByRole('region', { name: destination, exact: true })).toBeInViewport();
    await page.goBack();
    expect(new URL(page.url()).hash).toBe('');
    await expect(scenario).toHaveValue('due-priority');
  }
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await scenario.selectOption('long-title');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; window.scrollTo(0, 0); });
    const fullText = '긴 합성 할 일 제목으로 줄바꿈과 전체 내용 보존을 확인합니다. '.repeat(8);
    const title = overview.getByRole('heading', { level: 3 });
    const disclosure = overview.locator('details');
    const toggle = disclosure.locator('summary');
    const completeTitle = disclosure.locator('[aria-label="전체 제목"]');
    const primary = overview.getByRole('link', { name: '할 일 확인 →', exact: true });
    await test.step(`h3-overview/${width}/primary`, async () => {
      await expect(title).toHaveText(`${Array.from(fullText).slice(0, 40).join('').trimEnd()}…`);
      await expect(completeTitle).toBeHidden();
      await expect(primary).toBeVisible();
      await expect(primary).toBeInViewport({ ratio: 1 });
      expect((await primary.boundingBox())!.y).toBeLessThan((await title.boundingBox())!.y);
      expect(await primary.evaluate(element => getComputedStyle(element).fontSize)).toBe('28px');
    });
    await test.step(`h3-overview/${width}/text-line`, async () => {
      // The complete short CTA must occupy one readable line, not a column of individual glyphs.
      expect(await primary.locator('span').evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        // Range returns text-node fragments, not line boxes (the label and arrow are separate children).
        const rects = [...range.getClientRects()];
        const box = element.getBoundingClientRect();
        const first = rects[0];
        return Boolean(first) && element.scrollWidth <= element.clientWidth + 1
          && element.scrollHeight <= element.clientHeight + 1
          && rects.every(rect => [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite)
            && rect.width > 0 && rect.height > 0
            && Math.abs(rect.top - first.top) <= 1 && Math.abs(rect.bottom - first.bottom) <= 1
            && rect.left >= box.left - 1 && rect.right <= box.right + 1
            && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1);
      })).toBe(true);
    });
    await test.step(`h3-overview/${width}/collapsed-capture`, async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await captureFullPageEvidence(page, `.e2e/component-browser/evidence/home-overview-long-title-200percent-${width}-${testInfo.project.name}.png`);
    });
    await test.step(`h3-overview/${width}/expanded`, async () => {
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(disclosure).toHaveAttribute('open', '');
      // Equivalent full-title preservation assertion: the original is now in the expanded region, not the preview heading.
      await expect(completeTitle).toHaveText(fullText.trim());
      await expect(completeTitle).toBeVisible();
      expect(await completeTitle.evaluate(element => getComputedStyle(element).fontSize)).toBe('40px');
      expect(await completeTitle.evaluate(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(primary).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await captureFullPageEvidence(page, `.e2e/component-browser/evidence/home-overview-long-title-open-200percent-${width}-${testInfo.project.name}.png`);
    });
    await test.step(`h3-overview/${width}/anchor-back`, async () => {
      await primary.focus();
      await page.keyboard.press('Enter');
      expect(new URL(page.url()).hash).toBe('#assistant-list');
      await expect(page.getByRole('region', { name: 'Synthetic task destination', exact: true })).toBeInViewport();
      await page.goBack();
      expect(new URL(page.url()).hash).toBe('');
      await expect(scenario).toHaveValue('long-title');
      await expect(disclosure).toHaveAttribute('open', '');
      await expect(completeTitle).toHaveText(fullText.trim());
    });
    await test.step(`h3-overview/${width}/closed`, async () => {
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(disclosure).not.toHaveAttribute('open', '');
      await expect(completeTitle).toBeHidden();
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(primary).toBeInViewport({ ratio: 1 });
      expect(await storage(page)).toEqual(before);
    });
    await test.step(`h3-overview/${width}/reload`, async () => {
      // Reload clears fixture state; reapply the same 200% text setting explicitly, not an OS zoom claim.
      await page.reload();
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; window.scrollTo(0, 0); });
      await expect(scenario).toHaveValue('empty');
      await expect(overview.locator('details')).toHaveCount(0);
      await expect(overview.getByRole('link', { name: '통합 달력 보기 →', exact: true })).toBeInViewport({ ratio: 1 });
      expect(await storage(page)).toEqual(before);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    });
  }
  await page.reload();
  await expect(scenario).toHaveValue('empty');
  await expect(overview).toContainText('달력에서 일정을 확인해요');
  await expect(page.getByLabel('Synthetic refresh attempts', { exact: true })).toHaveText('0');
  expect(await storage(page)).toEqual(before);
  expect(requests).toEqual({ writes: 0, api: 0 });
});
