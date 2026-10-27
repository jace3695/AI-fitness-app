import { test, expect } from './fixture';
import type { Page } from '@playwright/test';

const day = '2025-04-07';
const originalSource = { device: 'OA long report', originalLabel: '체중', originalUnit: 'kg',
  originalText: '80.2kg', method: 'ocr', mappingVersion: 'oa-pro-v1' };
async function seed(page: Page) {
  await page.goto('/?case=body-import');
  await page.evaluate(({ day, originalSource }) => {
    localStorage.setItem('fitness-cloud-sync-user', 'synthetic-unit-A');
    localStorage.setItem('fitness-cloud-sync-epoch', '1');
    localStorage.setItem('ai-fitness-weight-records', JSON.stringify({ [day]: { weight: 80.2, recordedAt: 'original' } }));
    localStorage.setItem('ai-fitness-inbody-records', JSON.stringify({ [day]: {
      bmi: 24.1, memo: 'synthetic keep', metricSources: { weight: originalSource },
    } }));
  }, { day, originalSource });
  await page.reload();
}
async function snapshot(page: Page) {
  return page.evaluate(() => ({
    weights: JSON.parse(localStorage.getItem('ai-fitness-weight-records') || '{}'),
    inbody: JSON.parse(localStorage.getItem('ai-fitness-inbody-records') || '{}'),
  }));
}
async function upload(page: Page) {
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-observations.png',
    mimeType: 'image/png', buffer: Buffer.from('Synthetic OCR observations, not an image accuracy test') });
  await expect(page.getByLabel('측정 날짜', { exact: true })).toHaveValue(day);
}

test('unknown-unit import stays unrecognized, preserves records on cancel and survives save/reload', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await seed(page);
  const before = await snapshot(page);
  await upload(page);
  await page.locator('summary').filter({ hasText: '원본 30개 항목 대조표' }).click();
  await expect(page.locator('[data-oa-field="weight"]')).toContainText('미인식 · 직접 확인 필요');
  expect(await snapshot(page)).toEqual(before);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '확인한 측정일에 저장', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByLabel('가져오기 확인', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '확인한 측정일에 저장', exact: true }).click();
  await expect(page.getByLabel('가져오기 확인', { exact: true })).toHaveCount(0);
  await page.reload();
  const saved = await snapshot(page);
  expect(saved.weights).toEqual(before.weights);
  expect(saved.inbody[day]).toEqual({ ...before.inbody[day], bmi: 24.8 });
  await upload(page);
  await page.getByRole('button', { name: '사진 입력 취소', exact: true }).click();
  expect(await snapshot(page)).toEqual(saved);
  await expect(page.getByLabel('가져오기 확인', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('explicit correction after an unrecognized weight keeps original evidence and marks it edited', async ({ page }) => {
  await seed(page);
  await upload(page);
  await page.locator('input[inputmode=decimal]').first().fill('82.4');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '확인한 측정일에 저장', exact: true }).click();
  await expect(page.getByLabel('가져오기 확인', { exact: true })).toHaveCount(0);
  await page.reload();
  const saved = await snapshot(page);
  expect(saved.weights[day].weight).toBe(82.4);
  expect(saved.inbody[day].memo).toBe('synthetic keep');
  expect(saved.inbody[day].metricSources.weight).toEqual({ ...originalSource, method: 'ocr-edited' });
  await page.locator('summary').filter({ hasText: '사진 항목 출처·원문 보기' }).click();
  await expect(page.getByLabel('사진 항목 출처', { exact: true })).toContainText('사진 입력 후 수정');
  await expect(page.getByLabel('사진 항목 출처', { exact: true })).toContainText('80.2kg');
});
