import { test, expect } from './fixture';
import type { Locator } from '@playwright/test';

async function textGeometry(locator: Locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = [...range.getClientRects()], lineTops: number[] = [];
    // Inline markup (for example <strong>) can yield several fragments on the same visual line.
    // Group their top positions with a 1px tolerance for subpixel/font-metric differences.
    for (const rect of rects) {
      if (rect.width > 0 && rect.height > 0 && !lineTops.some(top => Math.abs(top - rect.top) <= 1)) lineTops.push(rect.top);
    }
    return {
      top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height,
      fontSize: parseFloat(style.fontSize), lines: lineTops.length,
      fits: element.scrollWidth <= element.clientWidth + 1 && rects.every(line =>
        line.left >= box.left - 1 && line.right <= box.right + 1 && line.top >= box.top - 1 && line.bottom <= box.bottom + 1),
      withinViewport: box.left >= 0 && box.right <= innerWidth + 1,
    };
  });
}

test('empty and relevant-error states remain distinct with explicit callbacks at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?case=empty');
  const actual = page.getByTestId('actual-empty-state');
  const add = actual.getByRole('button', { name: '직접 추가하기', exact: true });
  await expect(add).toHaveAttribute('aria-controls', 'synthetic-entry');
  await add.click();
  await expect(page.getByLabel('Synthetic entry', { exact: true })).toBeVisible();
  await page.getByLabel('Synthetic list outcome').selectOption('failed');
  await expect(actual.getByRole('status')).toHaveText('목록을 불러오지 못했어요.');
  await expect(actual.getByText('항목이 없는지는 아직 알 수 없어요. 다시 불러와 주세요.')).toBeVisible();
  await expect(add).toHaveCount(0);
  await actual.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await expect(page.getByTestId('retry-count')).toHaveText('1');
  await page.getByLabel('Synthetic list outcome').selectOption('unrelated');
  await expect(add).toBeVisible();
  await expect(actual.getByRole('status')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByTestId('retry-count')).toHaveText('0');
  await expect(page.getByLabel('Synthetic entry', { exact: true })).toHaveCount(0);
});

test('AB preparation remains a static non-prescriptive diagram without playback controls', async ({ page }) => {
  await page.goto('/?case=static');
  const actual = page.locator('#fixture-root');
  await expect(actual.getByRole('img')).toHaveCount(1);
  await expect(actual.getByRole('region')).toHaveAccessibleName(/정지 도해/);
  await expect(actual).toContainText('유지 시간·횟수·다음 단계는 지정하지 않습니다.');
  await expect(actual.locator('button,input,select')).toHaveCount(0);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.addStyleTag({ content: 'html { font-size: 32px; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('deadbug disclosure resets its real player on close and respects keyboard/reduced motion', async ({ page }) => {
  await page.goto('/?case=motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const box = page.getByTestId('deadbug-disclosure'), summary = box.locator('summary');
  await expect(box.getByRole('slider')).toHaveCount(0);
  await summary.focus(); await page.keyboard.press('Enter');
  const stages = box.getByRole('combobox'), slider = box.getByRole('slider');
  await expect(stages.locator('option')).toHaveCount(2);
  await expect(slider).toHaveValue('0');
  await stages.selectOption('1');
  await box.getByRole('button', { name: '중간 자세 보기', exact: true }).click();
  await expect(slider).toHaveValue('0.25');
  await slider.focus(); await page.keyboard.press('End'); await expect(slider).toHaveValue('1');
  await box.getByRole('button', { name: '시작 자세 보기', exact: true }).click();
  await box.getByRole('button', { name: '재생', exact: true }).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(0);
  await summary.click(); await expect(slider).toHaveCount(0);
  await summary.click(); await expect(stages).toHaveValue('0'); await expect(slider).toHaveValue('0');
  await expect(box.getByRole('button', { name: '재생', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(box.getByRole('button', { name: '재생', exact: true })).toBeDisabled();
  await expect(box).toContainText('개인에게 할 운동을 정하거나 운동표에 추가하지 않습니다.');
});

test('roller informational stages stop on changes and close without completing the catalog routine', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?case=motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const box = page.getByTestId('roller-disclosure'), summary = box.locator('summary');
  await expect(box.getByRole('slider')).toHaveCount(0);
  await summary.click();
  await expect(box).toContainText('원 안내의 대상 조직을 확인한 것이 아니며');
  const stages = box.getByRole('combobox'), slider = box.getByRole('slider');
  await expect(stages.locator('option')).toHaveCount(9);
  await stages.selectOption('4');
  await expect(slider).toHaveValue('0');
  await box.getByRole('button', { name: '중간 자세 보기', exact: true }).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(0);
  await box.getByRole('button', { name: '재생', exact: true }).click();
  await expect(box.getByRole('button', { name: '일시정지', exact: true })).toBeVisible();
  await box.getByRole('button', { name: '다음 단계', exact: true }).click();
  await expect(stages).toHaveValue('5'); await expect(slider).toHaveValue('0');
  await expect(box.getByRole('button', { name: '재생', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await summary.click(); await expect(slider).toHaveCount(0);
  await summary.click(); await expect(stages).toHaveValue('0'); await expect(slider).toHaveValue('0');
  await page.addStyleTag({ content: 'html { font-size: 32px; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('roller captions and stage controls stay readable at 320px with 200% root text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?case=motion');
  const box = page.getByTestId('roller-disclosure');
  await box.locator('summary').click();
  const stages = box.getByRole('combobox'), heading = box.getByRole('heading', { level: 3 });
  const previous = box.getByRole('button', { name: '이전 단계', exact: true });
  const next = box.getByRole('button', { name: '다음 단계', exact: true });
  await expect(stages.locator('option')).toHaveCount(9);
  const names = await stages.locator('option').allTextContents();
  const legends = [
    '초록: 대상 부위 · 주황: 롤러 · 접촉 모식도',
    '작은 구간만 이동 · 관절·목·허리 직접 압박 제외',
    '바닥 준비·좌우 자세 전환은 별도로 수행',
  ];
  expect(names).toHaveLength(9);
  // This is root-text enlargement/reflow, not a claim about physical-device browser zoom.
  for (const rootSize of [16, 32]) {
    await page.addStyleTag({ content: `html { font-size: ${rootSize}px; }` });
    for (let index = 0; index < names.length; index++) {
      await stages.selectOption(String(index));
      await expect(heading).toHaveText(names[index]);
      const selected = await textGeometry(heading), selectBox = await stages.boundingBox();
      const before = await textGeometry(previous), after = await textGeometry(next);
      expect(selected.fontSize).toBe(rootSize * 0.875);
      expect(selected.fits && selected.withinViewport).toBe(true);
      expect(selectBox).not.toBeNull();
      expect(selected.top).toBeGreaterThanOrEqual(selectBox!.y + selectBox!.height);
      expect(selected.top - (selectBox!.y + selectBox!.height)).toBeLessThanOrEqual(rootSize);
      expect(selected.bottom).toBeLessThanOrEqual(before.top);
      for (const control of [before, after]) {
        expect(control.fontSize).toBe(rootSize * 0.875);
        expect(control.lines, 'complete Korean navigation label stays on one line').toBe(1);
        expect(control.height).toBeGreaterThanOrEqual(44);
        expect(control.fits && control.withinViewport).toBe(true);
      }
      if (rootSize === 32) expect(after.top).toBeGreaterThanOrEqual(before.bottom);
      const caption = box.locator('figcaption');
      await expect(caption).toBeVisible();
      const figure = box.locator('figure'), image = figure.locator('svg').last();
      const imageBox = await image.boundingBox(), captionBox = await caption.boundingBox();
      expect(imageBox && captionBox).toBeTruthy();
      expect(captionBox!.y).toBeGreaterThanOrEqual(imageBox!.y + imageBox!.height);
      const paragraphs = caption.locator('p');
      await expect(paragraphs).toHaveCount(3);
      if (![4, 5].includes(index)) {
        await expect(paragraphs).toHaveText(legends);
        await expect(figure.locator('svg text')).toHaveText(legends);
      }
      for (const paragraph of await paragraphs.all()) {
        const text = await textGeometry(paragraph);
        expect(text.fontSize).toBe(rootSize * 0.875);
        expect(text.fits && text.withinViewport).toBe(true);
        if (rootSize === 32) expect(text.lines).toBeGreaterThan(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await stages.selectOption('0');
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(stages).toHaveValue('1');
  await expect(heading).toHaveText(names[1]);
  await previous.click();
  await expect(heading).toHaveText(names[0]);
});
