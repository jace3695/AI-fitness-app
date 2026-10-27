import { test, expect } from './fixture';

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
