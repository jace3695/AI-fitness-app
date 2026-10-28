import { test, expect } from './fixture';
import type { Locator, Page } from '@playwright/test';
import { captureFullPageEvidence } from './evidence-capture';

const labels = ['할 일', '가계부', '운동', '식단', '일본어', '자기계발'];
const hrefs = ['#assistant-list', '/budget', '/fitness', '/diet', '/language', '/growth'];
const emptyCards = ['마감 확인 0건 · 미완료 0건', '월 예산 미설정', '운동 기록 연결 필요', '식단 기록 연결 필요', '학습 기록 연결 필요', '오늘 예정 루틴 0/0개 완료'];
const completedCards = ['마감 확인 0건 · 미완료 0건', '1,000원 남음', '오늘 완료 기록 있음', '오늘 저장 기록 있음', '오늘 5/5개 완료', '오늘 예정 루틴 2/2개 완료'];
const storage = (page: Page) => page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), sentinel: localStorage.getItem('synthetic-h3-sentinel') }));
async function initialize(page: Page) {
  const requests = { writes: 0, api: 0 };
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) requests.writes++;
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.api++;
  });
  await page.goto('/?case=home-briefing');
  await page.evaluate(() => localStorage.setItem('synthetic-h3-sentinel', 'unchanged'));
  return { requests, before: await storage(page), panel: page.getByRole('region', { name: '아침·저녁 브리핑', exact: true }),
    scenario: page.getByLabel('Synthetic home briefing scenario', { exact: true }) };
}
async function cards(panel: Locator, expected: string[]) {
  const rows = panel.getByRole('listitem');
  await expect(rows).toHaveCount(6);
  await expect(rows.locator('strong')).toHaveText(labels);
  for (let index = 0; index < labels.length; index++) {
    await expect(rows.nth(index).locator('p')).toHaveText(expected[index]);
    await expect(rows.nth(index).getByRole('link', { name: `${labels[index]} 확인 →`, exact: true })).toHaveAttribute('href', hrefs[index]);
  }
}

test('actual home briefing distinguishes loading, missing, failed and completed synthetic records without claiming global completion', async ({ page }, testInfo) => {
  const { requests, before, panel, scenario } = await initialize(page);
  for (const state of ['loading', 'empty', 'partial-failure', 'completed']) {
    await scenario.selectOption(state);
    await expect(panel).toContainText('저장된 기록 기준입니다. 미기록은 미수행으로 단정하지 않습니다.');
    for (const mode of ['아침', '저녁']) {
      const button = panel.getByRole('button', { name: `${mode} 브리핑`, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.getByRole('button', { name: `${mode === '아침' ? '저녁' : '아침'} 브리핑`, exact: true })).toHaveAttribute('aria-pressed', 'false');
      await expect(panel.getByRole('heading', { level: 2 })).toHaveText(mode === '아침' ? '아침에 확인할 일' : '저녁 기록 돌아보기');
      if (state === 'loading') {
        await expect(panel.getByRole('status')).toHaveText('현재 기록을 확인하고 있어요.');
        await expect(panel.getByRole('listitem')).toHaveCount(0);
        await expect(panel.getByRole('link')).toHaveCount(0);
      } else {
        await expect(panel.getByRole('status')).toHaveCount(0);
        await cards(panel, state === 'empty' ? emptyCards : state === 'completed' ? completedCards :
          ['조회 실패 · 미기록으로 판단하지 않음', '조회 실패 · 미기록으로 판단하지 않음', ...completedCards.slice(2)]);
        await expect(panel.getByText('다음 한 걸음: 달력에서 일정을 확인해요', { exact: true })).toBeVisible();
        await expect(panel.getByRole('link', { name: '통합 달력 보기', exact: true })).toHaveAttribute('href', '/calendar');
        await expect(panel).not.toContainText('합성 조회 실패 영역의 이전 할 일');
        await expect(panel).not.toContainText('999,999');
        await expect(panel).not.toContainText('모두 완료');
      }
      expect(await storage(page)).toEqual(before);
    }
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (state !== 'loading') {
        const next = panel.getByRole('link', { name: '통합 달력 보기', exact: true });
        await expect(next).toBeInViewport({ ratio: 1 });
        expect((await next.boundingBox())!.y).toBeLessThan((await panel.getByRole('listitem').first().boundingBox())!.y);
      }
      await captureFullPageEvidence(page, `.e2e/component-browser/evidence/home-briefing-${state}-evening-${width}-${testInfo.project.name}.png`);
    }
  }
  await page.reload();
  await expect(scenario).toHaveValue('empty');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('아침에 확인할 일');
  await cards(panel, emptyCards);
  expect(await storage(page)).toEqual(before);
  expect(requests).toEqual({ writes: 0, api: 0 });
});

test('actual home briefing prioritizes due then important work before budget with exact labels and an in-page destination', async ({ page }, testInfo) => {
  const { requests, before, panel, scenario } = await initialize(page);
  const cases = [
    ['due-priority', '합성 오늘 마감', '할 일 확인', '#assistant-list', '마감 확인 1건 · 미완료 2건'],
    ['important-priority', '합성 중요 할 일', '할 일 확인', '#assistant-list', '마감 확인 0건 · 미완료 1건'],
    ['budget-next', '2,500원 초과했어요', '가계부에서 확인', '/budget', '마감 확인 0건 · 미완료 0건'],
  ] as const;
  for (const [state, title, label, href, taskSummary] of cases) {
    await scenario.selectOption(state);
    for (const mode of ['아침', '저녁']) {
      await panel.getByRole('button', { name: `${mode} 브리핑`, exact: true }).click();
      await expect(panel.getByText(`다음 한 걸음: ${title}`, { exact: true })).toBeVisible();
      await expect(panel.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
      await expect(panel.getByRole('listitem').first().locator('p')).toHaveText(taskSummary);
      await expect(panel).not.toContainText('합성 완료 항목');
      await expect(panel).not.toContainText('합성 취소 항목');
    }
    if (state === 'due-priority') {
      await panel.getByRole('link', { name: label, exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#assistant-list$/);
      await expect(page.getByRole('region', { name: 'Synthetic task destination', exact: true })).toBeInViewport();
      await page.goBack();
      await expect(page).not.toHaveURL(/#assistant-list$/);
      await expect(scenario).toHaveValue(state);
    }
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      const next = panel.getByRole('link', { name: label, exact: true });
      await expect(next).toBeInViewport({ ratio: 1 });
      expect((await next.boundingBox())!.y).toBeLessThan((await panel.getByRole('listitem').first().boundingBox())!.y);
      await captureFullPageEvidence(page, `.e2e/component-browser/evidence/home-briefing-${state}-${width}-${testInfo.project.name}.png`);
    }
    expect(await storage(page)).toEqual(before);
  }
  expect(requests).toEqual({ writes: 0, api: 0 });
});
