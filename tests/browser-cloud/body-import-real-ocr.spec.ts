import { test, expect } from './fixture';
import type { Page } from '@playwright/test';
import { resolve } from 'node:path';
import { OCR_ASSET_PREFIX } from '../../scripts/browser-qa/cloud/ocr-assets.mjs';
import { captureFullPageEvidence } from './evidence-capture';

const day = '2025-04-07';
const reviewName = 'InBody 원본의 항목명·단위·숫자와 측정 날짜를 대조했어요.';
const snapshot = (page: Page) => page.evaluate(() => ({
  weights: JSON.parse(localStorage.getItem('ai-fitness-weight-records') || '{}'),
  inbody: JSON.parse(localStorage.getItem('ai-fitness-inbody-records') || '{}'),
}));

async function expectMixedSourceLabels(page: Page) {
  const group = page.locator('[data-body-group="추가 체성분 항목"]');
  await expect(group).toBeVisible();
  await expect(group).not.toContainText('다른 기기·직접 입력');
  await expect(group).toContainText('사진 입력과 기존·직접 입력값이 함께 표시될 수 있어요.');
  await expect(group).toContainText('사진에 없는 값은 자동으로 바꾸지 않아요.');
  await expect(group).toContainText('사진 출처가 있는 항목은 위 원문 보기에서 확인해요.');
  const fat = group.locator('[data-body-field="bodyFatMass"]');
  expect(await fat.evaluate(element => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim())).toBe('체지방량');
  await expect(fat.locator('input')).toHaveValue('17.4');
  await expect(group.locator('[data-body-field="skeletalMuscleMass"] input')).toHaveValue('31.4');
  await expect(group.locator('[data-body-field="bodyAge"] input')).toHaveValue('41');
  // Keep the source boundary readable on both narrow widths, without font reduction or clipping.
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await group.locator('summary p').last().evaluate(element => {
      const box = element.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element);
      const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
      const tops: number[] = [];
      for (const rect of rects) if (!tops.some(top => Math.abs(top - rect.top) <= 1)) tops.push(rect.top);
      return { font: parseFloat(getComputedStyle(element).fontSize), lines: tops.length,
        fits: rects.length > 0 && element.scrollWidth <= element.clientWidth + 1 && rects.every(rect =>
          rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1) };
    });
    expect(geometry.font).toBe(11); expect(geometry.lines).toBeGreaterThan(0); expect(geometry.lines).toBeLessThanOrEqual(6);
    expect(geometry.fits).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
}

test('actual PNG and local best_int worker recognize four clear rows, reject graphs and preserve review save reload boundaries', async ({ page, context }, testInfo) => {
  // New real two-scale OCR only; existing mock-reader tests and timeouts are unchanged.
  test.setTimeout(90_000);
  const network = { writes: 0, api: 0, assets: new Set<string>() };
  context.on('request', request => {
    const url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) network.writes++;
    if (url.pathname.startsWith('/api/')) network.api++;
    if (url.pathname.startsWith(`${OCR_ASSET_PREFIX}/`)) network.assets.add(url.pathname);
  });
  const workers: string[] = []; let closedWorkers = 0;
  page.on('worker', worker => { workers.push(worker.url()); worker.on('close', () => { closedWorkers++; }); });
  await page.addInitScript(() => {
    const state = window as typeof window & { __qaInbodyCanvas: number[][] };
    state.__qaInbodyCanvas = [];
    const original = CanvasRenderingContext2D.prototype.drawImage;
    // Passive observation only: delegate every draw with the same receiver/arguments/result.
    CanvasRenderingContext2D.prototype.drawImage = function (...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      if (args[0] instanceof HTMLImageElement && [1800, 2100].includes(this.canvas.width)) {
        state.__qaInbodyCanvas.push([this.canvas.width, this.canvas.height, args[0].naturalWidth, args[0].naturalHeight]);
      }
      return result;
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?case=body-import-real-ocr');
  await page.evaluate(day => {
    localStorage.setItem('fitness-cloud-sync-user', 'synthetic-real-ocr-A');
    localStorage.setItem('fitness-cloud-sync-epoch', '1');
    localStorage.setItem('ai-fitness-weight-records', JSON.stringify({ [day]: { weight: 80.2, recordedAt: 'original' }, '2025-04-06': { weight: 80.3, recordedAt: 'keep-other-day' } }));
    localStorage.setItem('ai-fitness-inbody-records', JSON.stringify({ [day]: {
      bmi: 24.1, skeletalMuscleMass: 31.4, bodyFatPercent: 20.2, muscleMass: 58.1, trunkMuscleMass: 24.3,
      memo: 'synthetic keep', bodyAge: 41,
    }, '2025-04-06': { bmi: 24.2, memo: 'keep-other-day' } }));
  }, day);
  await page.reload(); const before = await snapshot(page);
  await page.getByLabel('결과지 형식', { exact: true }).selectOption('inbody-270s-en');
  const upload = page.locator('input[type=file]');
  await test.step('b3-real/decode-ratio', async () => {
    await upload.setInputFiles({ name: 'not-a-png.png', mimeType: 'image/png', buffer: Buffer.from('Deliberately invalid synthetic image bytes') });
    await expect(page.getByText('이미지를 열 수 없습니다.', { exact: true })).toBeVisible();
    await upload.setInputFiles(resolve('scripts/browser-qa/fixtures/inbody-wrong-ratio.png'));
    await expect(page.getByText(/InBody270S 영문 전체 결과지 사진을 선택해 주세요/)).toBeVisible();
    await expect(page.getByLabel('가져오기 확인', { exact: true })).toHaveCount(0);
    expect(workers).toEqual([]);
    expect(network.assets.size).toBe(0);
    expect(await snapshot(page)).toEqual(before);
  });
  await test.step('b3-real/worker-ocr', async () => {
    await upload.setInputFiles(resolve('scripts/browser-qa/fixtures/inbody-270s-synthetic.png'));
    await expect(page.getByLabel('가져오기 확인', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/숫자 4개를 읽었어요/)).toBeVisible();
    expect(await page.evaluate(() => (window as typeof window & { __qaInbodyCanvas: number[][] }).__qaInbodyCanvas)).toEqual([[1800, 2550, 1800, 2550], [2100, 2975, 1800, 2550]]);
    expect(workers).toEqual([`http://127.0.0.1:3107${OCR_ASSET_PREFIX}/worker.min.js`]);
    await expect.poll(() => closedWorkers).toBe(1);
    expect(network.assets.has(`${OCR_ASSET_PREFIX}/worker.min.js`)).toBe(true);
    expect(network.assets.has(`${OCR_ASSET_PREFIX}/eng.traineddata.gz`)).toBe(true);
    expect([...network.assets].filter(path => /tesseract-core-(?:simd-)?lstm\.wasm\.js$/.test(path))).toHaveLength(1);
    expect(network.assets.size).toBe(3);
    expect(await snapshot(page)).toEqual(before);
  });
  await test.step('b3-real/review', async () => {
    await expect(page.getByLabel('측정 날짜', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: '확인한 측정일에 저장', exact: true })).toBeDisabled();
    await page.locator('summary').filter({ hasText: 'InBody 지원 항목 대조표' }).click();
    for (const [key, text] of [['weight', 'Weight: 79.6 kg'], ['bodyFatMass', 'Body Fat Mass: 17.4 kg'], ['fatFreeMass', 'Fat Free Mass: 62.2 kg'], ['basalMetabolicRate', 'Basal Metabolic Rate: 1623 kcal']]) {
      await expect(page.locator(`[data-oa-field="${key}"]`)).toContainText(text);
      await expect(page.locator(`[data-oa-field="${key}"]`)).toContainText('사진 원문 출처 있음');
    }
    for (const key of ['skeletalMuscleMass', 'bodyFatPercent', 'bmi']) await expect(page.locator(`[data-oa-field="${key}"]`)).toContainText('미인식 · 직접 확인 필요');
    await page.getByLabel('측정 날짜', { exact: true }).fill('2099-01-01');
    await page.getByRole('checkbox', { name: reviewName, exact: true }).check();
    await expect(page.getByRole('button', { name: '확인한 측정일에 저장', exact: true })).toBeDisabled();
    await page.getByLabel('측정 날짜', { exact: true }).fill(day);
    await expect(page.getByRole('checkbox', { name: reviewName, exact: true })).not.toBeChecked();
    await expect(page.getByRole('button', { name: '확인한 측정일에 저장', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: reviewName, exact: true }).check();
    await expectMixedSourceLabels(page);
    await captureFullPageEvidence(page, `.e2e/component-browser/evidence/inbody-real-ocr-four-row-review-${testInfo.project.name}.png`);
    expect(await snapshot(page)).toEqual(before);
  });
  await test.step('b3-real/save-reload', async () => {
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '확인한 측정일에 저장', exact: true }).click();
    expect(await snapshot(page)).toEqual(before);
    await expect(page.getByLabel('가져오기 확인', { exact: true })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '확인한 측정일에 저장', exact: true }).click();
    await expect(page.getByLabel('가져오기 확인', { exact: true })).toHaveCount(0);
    await page.reload(); const saved = await snapshot(page);
    expect(saved.weights[day].weight).toBe(79.6);
    expect(saved.inbody[day]).toMatchObject({ ...before.inbody[day], bodyFatMass: 17.4, fatFreeMass: 62.2, basalMetabolicRate: 1623 });
    for (const [key, label, unit] of [['weight', 'Weight', 'kg'], ['bodyFatMass', 'Body Fat Mass', 'kg'], ['fatFreeMass', 'Fat Free Mass', 'kg'], ['basalMetabolicRate', 'Basal Metabolic Rate', 'kcal']]) {
      expect(saved.inbody[day].metricSources[key]).toMatchObject({ device: 'InBody 270S English report', originalLabel: label, originalUnit: unit, method: 'ocr', mappingVersion: 'inbody-270s-en-v1' });
      expect(saved.inbody[day].metricSources[key].originalText).toContain(label);
    }
    expect(Object.keys(saved.inbody[day].metricSources).sort()).toEqual(['basalMetabolicRate', 'bodyFatMass', 'fatFreeMass', 'weight']);
    expect(saved.weights['2025-04-06']).toEqual(before.weights['2025-04-06']);
    expect(saved.inbody['2025-04-06']).toEqual(before.inbody['2025-04-06']);
    await page.locator('summary').filter({ hasText: '사진 항목 출처·원문 보기' }).click();
    await expect(page.getByLabel('사진 항목 출처', { exact: true })).toContainText('InBody 270S English report');
    await expect(page.getByLabel('사진 항목 출처', { exact: true })).toContainText('Sum of the above Weight (kg) 79.6');
    await expectMixedSourceLabels(page);
    await captureFullPageEvidence(page, `.e2e/component-browser/evidence/inbody-real-ocr-reloaded-${testInfo.project.name}.png`);
  });
  expect(network.writes).toBe(0); expect(network.api).toBe(0);
});
