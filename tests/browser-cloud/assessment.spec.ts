import { test, expect } from './fixture';

const prepareLabel = '녹음 형식 확인 · 전송 안 함';
const checkLabel = '연결 준비 확인 · 음성 전송 안 함';

test('assessment retention uncertainty remains visible before and after mock readiness without sending audio', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?case=assessment');
  const panel = page.getByTestId('assessment-panel');
  const metrics = page.getByTestId('assessment-fixture-metrics');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: prepareLabel, exact: true }).click();
  const retention = panel.getByText('한도 확인용 기록의 보관 기간과 삭제 절차는 아직 확인이 필요해요. 계정을 삭제해도 함께 지워진다고 보장할 수 없어요. 실제 전송 전에 보관·삭제 안내를 확인해 주세요.', { exact: true });
  await expect(retention).toBeVisible();
  await expect(panel).not.toContainText('계정 삭제 전까지 남는 설계예요');
  await expect(panel.getByText('녹음·문장·점수 자체는 이 한도 기록에 저장하지 않아요.', { exact: false })).toBeVisible();
  const beforeCheck = panel.getByRole('checkbox', { name: '이 녹음과 문장의 전송 안내를 확인했어요 · 지금은 전송하지 않아요', exact: true });
  await expect(beforeCheck).not.toBeChecked();
  await beforeCheck.check();
  await panel.getByRole('button', { name: '전송할 내용 확인 · 전송 안 함', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-checks', '0');
  await expect(metrics).toHaveAttribute('data-posts', '0');
  await panel.getByRole('button', { name: checkLabel, exact: true }).click();
  const afterCheck = panel.getByRole('checkbox', { name: '위 전송·보관 안내를 확인했고 이번 녹음과 문장을 Microsoft로 보내는 데 동의해요.', exact: true });
  await expect(afterCheck).not.toBeChecked();
  await expect(retention).toBeVisible();
  await expect(panel.getByRole('button', { name: '발음 점수 받기', exact: true })).toBeDisabled();
  await expect(metrics).toHaveAttribute('data-checks', '1');
  await expect(metrics).toHaveAttribute('data-posts', '0');
  await afterCheck.check();
  await expect(retention).toBeVisible();
  await expect(panel.getByRole('button', { name: '발음 점수 받기', exact: true })).toBeEnabled();
  await expect(metrics).toHaveAttribute('data-posts', '0');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.e2e/component-browser/evidence/assessment-retention-consent-${testInfo.project.name}.png`, fullPage: true });
});

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


test('new explicitly requested mock assessment result survives an older cancelled response released last', async ({ page }) => {
  await page.goto('/?case=assessment');
  const panel = page.getByTestId('assessment-panel');
  const metrics = page.getByTestId('assessment-fixture-metrics');
  await panel.locator('summary').click();
  const prepare = panel.getByRole('button', { name: prepareLabel, exact: true });
  const check = panel.getByRole('button', { name: checkLabel, exact: true });
  const consent = panel.getByRole('checkbox');
  const start = async () => {
    await prepare.click(); await expect(consent).toBeVisible(); await consent.check();
    await check.click(); await expect(consent).not.toBeChecked();
    const send = panel.getByRole('button', { name: '발음 점수 받기', exact: true });
    await expect(send).toBeDisabled(); await consent.check(); await send.click();
  };
  await start();
  await expect(metrics).toHaveAttribute('data-response-count', '1');
  await expect(metrics).toHaveAttribute('data-posts', '1');
  await panel.getByRole('button', { name: '요청 취소', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-pending-aborts', '1');
  await expect(panel.getByRole('status')).toContainText('1회 시험 한도 복구를 보장하지 않아요.');

  // Fresh synthetic readiness is deliberately injected; the hosted trial ledger
  // is not part of this lane, and no permission to repeat a real trial is implied.
  await page.getByRole('button', { name: 'Reset one-second recording', exact: true }).click();
  await start();
  await expect(metrics).toHaveAttribute('data-response-count', '2');
  await expect(metrics).toHaveAttribute('data-checks', '2');
  await expect(metrics).toHaveAttribute('data-posts', '2');
  await page.getByRole('button', { name: 'Release latest mock response with distinct scores', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-response-count', '1');
  await expect(panel.getByText('발음 정확도: 93 / 100', { exact: true })).toBeVisible();
  await expect(panel.getByText('말하기 흐름: 88 / 100', { exact: true })).toBeVisible();
  await expect(panel.locator('summary')).toHaveText('발음 평가 결과');
  await page.getByRole('button', { name: 'Release mock assessment response', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-response-count', '0');
  await expect(metrics).toHaveAttribute('data-response-held', 'false');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(panel.getByText('발음 정확도: 93 / 100', { exact: true })).toBeVisible();
  await expect(panel.getByText('말하기 흐름: 88 / 100', { exact: true })).toBeVisible();
  await expect(panel.getByText('발음 정확도: 81 / 100', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('말하기 흐름: 72 / 100', { exact: true })).toHaveCount(0);
  await expect(check).toBeDisabled(); await expect(consent).toBeDisabled(); await expect(consent).not.toBeChecked();
  await expect(metrics).toHaveAttribute('data-posts', '2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await page.getByTestId('assessment-panel').locator('summary').click();
  await expect(panel.getByText('발음 정확도: 93 / 100', { exact: true })).toHaveCount(0);
  await expect(metrics).toHaveAttribute('data-posts', '0');
  await expect(metrics).toHaveAttribute('data-response-count', '0');
});


for (const failure of [
  { name: 'HTTP failure', slug: 'http-failure', release: 'Release mock HTTP failure' },
  { name: 'malformed response', slug: 'malformed-response', release: 'Release malformed mock response' },
]) {
  test(`assessment ${failure.name} keeps uncertainty and blocks duplicate-id controls`, async ({ page }, testInfo) => {
    await page.goto('/?case=assessment');
    const panel = page.getByTestId('assessment-panel');
    const metrics = page.getByTestId('assessment-fixture-metrics');
    const summary = panel.locator('summary');
    await summary.click();
    const prepare = panel.getByRole('button', { name: prepareLabel, exact: true });
    const check = panel.getByRole('button', { name: checkLabel, exact: true });
    const review = panel.getByRole('button', { name: '전송할 내용 확인 · 전송 안 함', exact: true });
    const consent = panel.getByRole('checkbox');
    await prepare.click(); await consent.check(); await check.click();
    await expect(consent).not.toBeChecked(); await consent.check();
    await panel.getByRole('button', { name: '발음 점수 받기', exact: true }).click();
    await expect(metrics).toHaveAttribute('data-posts', '1');
    await expect(metrics).toHaveAttribute('data-response-count', '1');
    await page.getByRole('button', { name: failure.release, exact: true }).click();
    await expect(metrics).toHaveAttribute('data-response-count', '0');
    await expect(summary).toHaveText('발음 평가 결과 확인 필요');
    const alert = panel.getByRole('alert');
    await expect(alert).toContainText('평가 결과를 확인하지 못했어요. 자동으로 다시 보내지 않아요.');
    await expect(alert).toContainText('이미 전달된 녹음의 처리 종료를 뜻하지는 않아요.');
    await expect(panel.getByText('같은 요청을 다시 보내지 않아요.', { exact: false })).toBeVisible();
    await expect(consent).toBeDisabled(); await expect(consent).not.toBeChecked();
    await expect(check).toBeDisabled(); await expect(review).toBeDisabled();
    await expect(panel.getByRole('button', { name: '발음 점수 받기 · 준비 중', exact: true })).toBeDisabled();
    await expect(panel.getByText('발음 정확도: 81 / 100', { exact: true })).toHaveCount(0);
    await expect(metrics).toHaveAttribute('data-checks', '1');
    await expect(metrics).toHaveAttribute('data-posts', '1');
    // Keyboard disclosure keeps the error title and does not retry the request.
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(alert).not.toBeVisible(); await expect(summary).toHaveText('발음 평가 결과 확인 필요');
    await page.keyboard.press('Enter'); await expect(alert).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Capture the open error and locked controls before preparation/reload clears them.
    await page.screenshot({ path: `.e2e/component-browser/evidence/assessment-${failure.slug}-locked-${testInfo.project.name}.png`, fullPage: true });

    // Starting local preparation is not another provider attempt or quota reset.
    await prepare.click(); await expect(consent).toBeEnabled(); await expect(consent).not.toBeChecked();
    await expect(alert).toHaveCount(0); await expect(check).toBeEnabled();
    await expect(panel.getByRole('button', { name: '발음 점수 받기 · 준비 중', exact: true })).toBeDisabled();
    await expect(metrics).toHaveAttribute('data-checks', '1'); await expect(metrics).toHaveAttribute('data-posts', '1');
    await page.reload(); await summary.click();
    await expect(alert).toHaveCount(0); await expect(metrics).toHaveAttribute('data-posts', '0');
  });
}
