import { test, expect } from './fixture';
import type { Locator, Page } from '@playwright/test';
import { captureFullPageEvidence } from './evidence-capture';

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

async function completeLabelGeometry(locator: Locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(element);
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    const tops: number[] = [];
    for (const rect of rects) if (!tops.some(top => Math.abs(top - rect.top) <= 1)) tops.push(rect.top);
    return { lines: tops.length, fontSize: parseFloat(getComputedStyle(element).fontSize),
      fits: element.scrollWidth <= element.clientWidth + 1 && rects.every(rect =>
        rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1),
      withinViewport: box.left >= 0 && box.right <= innerWidth + 1 };
  });
}

// A native date input can fit while its internal glyphs clip. Test the visible
// alternative's actual text ranges instead of treating input geometry as proof.
async function expectDatePreview(page: Page, value: string, rootSize: number) {
  const date = page.getByLabel('측정 날짜', { exact: true });
  await expect(date).toHaveValue(value);
  await expect(date).toHaveAccessibleName('측정 날짜');
  expect(await date.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(rootSize);
  const preview = page.locator('#body-measurement-date-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('aria-hidden', 'true');
  await expect(preview.locator('time')).toHaveAttribute('datetime', value);
  const parts = preview.locator('time > span');
  await expect(parts).toHaveText(value.split('-').map((part, index) => part + ['년', '월', '일'][index]));
  for (const part of await parts.all()) {
    const box = await completeLabelGeometry(part);
    expect(box.fontSize).toBe(rootSize);
    expect(box.lines).toBe(1);
    expect(box.fits && box.withinViewport).toBe(true);
  }
}

async function completeButtonWords(locator: Locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let words = 0;
    while ((node = walker.nextNode())) {
      for (const match of node.textContent!.matchAll(/\S+/g)) {
        words++;
        const range = document.createRange();
        range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
        if (!rects.length || rects.some(rect => Math.abs(rect.top - rects[0].top) > 1 ||
          rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) return false;
      }
    }
    return words > 0 && box.left >= 0 && box.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
  });
}

test('record labels, actions and full-date alternative remain readable at narrow widths and 200 percent root text', async ({ page }, testInfo) => {
  await seed(page);
  const before = await snapshot(page);
  const badge = page.getByText('체중·인바디', { exact: true });
  const steps = page.getByRole('list', { name: '사진 입력 순서', exact: true }).getByRole('listitem');
  await expect(steps).toHaveText(['1. 사진 선택', '2. 내용 확인', '3. 저장']);
  for (const state of ['idle', 'draft'] as const) {
    if (state === 'draft') {
      await upload(page);
      await expect(page.getByLabel('가져오기 확인', { exact: true })).toBeVisible();
      await expect(page.getByText('2. 내용 확인 · 아직 저장 전이에요', { exact: true })).toBeVisible();
    }
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const rootSize of [16, 32]) {
        // Root-text reflow, not a claim about physical-device browser zoom.
        await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, rootSize);
        await test.step(`b3-reflow/${state}/${width}/${rootSize}/checks`, async () => {
          const badgeBox = await completeLabelGeometry(badge);
          expect(badgeBox.fontSize).toBe(rootSize * 0.6875);
          expect(badgeBox.lines).toBe(1);
          expect(badgeBox.fits && badgeBox.withinViewport).toBe(true);
          for (const step of await steps.all()) {
            const box = await completeLabelGeometry(step);
            expect(box.fontSize).toBe(rootSize * 0.75);
            expect(box.lines).toBe(1);
            expect(box.fits && box.withinViewport).toBe(true);
          }
          const photo = page.getByRole('button', { name: '사진 선택', exact: true });
          const save = page.getByRole('button', { name: state === 'draft' ? '확인한 측정일에 저장' : '체중·인바디 저장', exact: true });
          for (const button of [photo, save]) expect(await completeButtonWords(button)).toBe(true);
          expect((await completeLabelGeometry(photo)).fontSize).toBe(rootSize * 0.875);
          if (state === 'idle') {
            const remove = page.getByRole('button', { name: '이 날짜 기록 삭제', exact: true });
            expect(await completeButtonWords(remove)).toBe(true);
            expect((await completeLabelGeometry(remove)).fontSize).toBe(rootSize * 0.8125);
            const saveBox = await save.boundingBox(), removeBox = await remove.boundingBox();
            expect(saveBox && removeBox && removeBox.y >= saveBox.y + saveBox.height).toBeTruthy();
          }
          if (state === 'draft') {
            const date = page.getByLabel('측정 날짜', { exact: true });
            await expectDatePreview(page, day, rootSize);
            expect(await date.evaluate(element => {
              const box = element.getBoundingClientRect(), parent = element.parentElement!.getBoundingClientRect();
              return box.left >= parent.left - 1 && box.right <= parent.right + 1 && box.right <= innerWidth + 1;
            })).toBe(true);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          expect(await snapshot(page)).toEqual(before);
        });
        await test.step(`b3-reflow/${state}/${width}/${rootSize}/full-page-capture`, () => captureFullPageEvidence(page,
          `.e2e/component-browser/evidence/body-import-${state}-${width}-root${rootSize}-${testInfo.project.name}.png`));
        if (state === 'draft') await test.step(`b3-reflow/${state}/${width}/${rootSize}/date-closeup`, async () => {
          await page.locator('#body-measurement-date-preview').screenshot({
            path: `.e2e/component-browser/evidence/body-date-preview-${width}-root${rootSize}-${testInfo.project.name}.png`,
          });
        });
      }
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.getByRole('button', { name: '사진 입력 취소', exact: true }).click();
  await expect(page.getByLabel('가져오기 확인', { exact: true })).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});


test('full-date alternative follows native edits and clearing without extra controls or persisted writes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await seed(page);
  const before = await snapshot(page);
  await upload(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  const date = page.getByLabel('측정 날짜', { exact: true });
  const preview = page.locator('#body-measurement-date-preview');
  const save = page.getByRole('button', { name: '확인한 측정일에 저장', exact: true });
  await page.getByRole('button', { name: '사진의 날짜·숫자 확인하기', exact: true }).click();
  await expect(date).toBeFocused();
  await date.fill('2024-02-29');
  await expectDatePreview(page, '2024-02-29', 32);
  expect(await snapshot(page)).toEqual(before);
  await date.fill('');
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('실제 측정 날짜를 입력해 주세요');
  await expect(save).toBeDisabled();
  expect(await snapshot(page)).toEqual(before);
  await date.fill(day);
  await expectDatePreview(page, day, 32);
  await expect(save).toBeEnabled();
  await page.getByRole('button', { name: '사진 입력 취소', exact: true }).click();
  await expect(preview).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await upload(page);
  await expectDatePreview(page, day, 32);
  await page.getByRole('button', { name: '사진 입력 취소', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
});
