import { test, expect } from './fixture';

const prepareLabel = '녹음 형식 확인 · 전송 안 함';
const checkLabel = '연결 준비 확인 · 음성 전송 안 함';

test('assessment rejects wrong text and six-second generated input locally at 390px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?case=assessment');
  const panel = page.getByTestId('assessment-panel');
  const metrics = page.getByTestId('assessment-fixture-metrics');
  await panel.locator('summary').click();
  await page.getByRole('button', { name: 'Use wrong reference', exact: true }).click();
  await panel.getByRole('button', { name: prepareLabel, exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('연결 시험 문장은');
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
  await expect(metrics).toHaveAttribute('data-input-reads', '0');
  await page.getByRole('button', { name: 'Use six-second recording', exact: true }).click();
  await panel.getByRole('button', { name: prepareLabel, exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('5초 이내');
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
  await expect(metrics).toHaveAttribute('data-input-reads', '1');
  await expect(metrics).toHaveAttribute('data-checks', '0');
  await expect(metrics).toHaveAttribute('data-posts', '0');
  await expect(panel.getByRole('button', { name: '발음 점수 받기 · 준비 중', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.e2e/component-browser/evidence/assessment-local-rejection-${testInfo.project.name}.png`, fullPage: true });
});

test('assessment local preparation cancellation ignores released input bytes and never sends', async ({ page }) => {
  await page.goto('/?case=assessment');
  const panel = page.getByTestId('assessment-panel');
  const metrics = page.getByTestId('assessment-fixture-metrics');
  await panel.locator('summary').click();
  await page.getByRole('button', { name: 'Hold local recording bytes', exact: true }).click();
  await panel.getByRole('button', { name: prepareLabel, exact: true }).click();
  await expect(metrics).toHaveAttribute('data-local-held', 'true');
  await expect(panel.getByRole('button', { name: prepareLabel, exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: '준비 취소', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('준비를 멈췄어요. 녹음은 보내지 않았어요.');
  await page.getByRole('button', { name: 'Release local recording bytes', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-local-held', 'false');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(panel.getByRole('checkbox')).toHaveCount(0);
  await expect(panel.getByRole('status')).toContainText('녹음은 보내지 않았어요.');
  await expect(metrics).toHaveAttribute('data-posts', '0');
  await expect(metrics).toHaveAttribute('data-checks', '0');
  // Fresh preparation still works using the real native decoder, not a replaced API.
  await page.getByRole('button', { name: 'Reset one-second recording', exact: true }).click();
  await panel.getByRole('button', { name: prepareLabel, exact: true }).click();
  await expect(panel.getByRole('checkbox')).toBeVisible();
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
});

test('assessment mock readiness requires new consent and late responses cannot restore cancelled or other-owner results', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?case=assessment');
  const panel = page.getByTestId('assessment-panel');
  const metrics = page.getByTestId('assessment-fixture-metrics');
  await panel.locator('summary').click();
  const prepare = panel.getByRole('button', { name: prepareLabel, exact: true });
  const check = panel.getByRole('button', { name: checkLabel, exact: true });
  const consent = panel.getByRole('checkbox');
  const send = () => panel.getByRole('button', { name: '발음 점수 받기', exact: true });
  const start = async () => {
    await prepare.click(); await expect(consent).toBeVisible(); await consent.check();
    await check.click(); await expect(consent).not.toBeChecked(); await expect(send()).toBeDisabled();
    await consent.check(); await send().click();
    await expect(metrics).toHaveAttribute('data-response-held', 'true');
  };
  await start();
  await expect(metrics).toHaveAttribute('data-posts', '1');
  await expect(panel.getByRole('status')).toContainText('결과를 기다리고 있어요');
  await panel.getByRole('button', { name: '요청 취소', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('처리 종료나 1회 시험 한도 복구를 보장하지 않아요.');
  await expect(metrics).toHaveAttribute('data-pending-aborts', '1');
  await page.getByRole('button', { name: 'Release mock assessment response', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-response-held', 'false');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(panel.getByText('발음 정확도: 81 / 100', { exact: true })).toHaveCount(0);
  await expect(consent).toHaveCount(0);
  await expect(metrics).toHaveAttribute('data-posts', '1');
  await expect(panel.getByRole('status')).toContainText('자동으로 다시 보내지 않아요.');

  await page.getByRole('button', { name: 'Reset one-second recording', exact: true }).click();
  await start();
  await page.getByRole('button', { name: 'Change synthetic owner', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-pending-aborts', '2');
  await page.getByRole('button', { name: 'Release mock assessment response', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-response-held', 'false');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(panel.getByText('발음 정확도: 81 / 100', { exact: true })).toHaveCount(0);
  await expect(consent).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset one-second recording', exact: true }).click();
  await start();
  await page.getByRole('button', { name: 'Release mock assessment response', exact: true }).click();
  await expect(panel.getByText('발음 정확도: 81 / 100', { exact: true })).toBeVisible();
  await expect(panel.getByText('말하기 흐름: 72 / 100', { exact: true })).toBeVisible();
  await expect(panel.locator('summary')).toHaveText('발음 평가 결과');
  await expect(check).toBeDisabled();
  await expect(panel.getByRole('button', { name: '전송할 내용 확인 · 전송 안 함', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.e2e/component-browser/evidence/assessment-mock-result-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Change synthetic owner', exact: true }).click();
  await expect(panel.getByText('발음 정확도: 81 / 100', { exact: true })).toHaveCount(0);
  await expect(consent).toHaveCount(0);
  await expect(metrics).toHaveAttribute('data-posts', '3');
});
