import { test, expect } from './fixture';
import { captureFullPageEvidence } from './evidence-capture';

test('practice input and topic survive rerenders and same-owner remount, but not reload or owner change', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/?case=practice');
  const panel = page.getByTestId('practice-panel');
  const input = panel.getByRole('textbox', { name: '일본어 문장', exact: true });
  const topic = panel.getByRole('combobox', { name: '이야기 주제' });
  const consent = panel.getByRole('checkbox', { name: '위 내용을 확인하고 전송에 동의해요.', exact: true });
  const metrics = page.getByTestId('practice-fixture-metrics');
  await expect(input).toBeEnabled();
  await input.fill('合成の下書きです。');
  await topic.selectOption('여행');
  await consent.check();
  await page.getByRole('button', { name: 'Rerender practice workspace', exact: true }).click();
  await expect(input).toHaveValue('合成の下書きです。');
  await expect(topic).toHaveValue('여행');
  await expect(consent).toBeChecked();
  await page.getByRole('button', { name: 'Remount same practice owner', exact: true }).click();
  await expect(input).toHaveValue('合成の下書きです。');
  await expect(topic).toHaveValue('여행');
  await expect(consent).not.toBeChecked();
  await expect(metrics).toHaveAttribute('data-calls', '0');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'Change synthetic practice owner', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(topic).toHaveValue('일상');
  await input.fill('別の合成入力です。');
  await page.getByRole('button', { name: 'Change synthetic practice owner', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.fill('再読み込み前の合成入力です。');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(input).toHaveValue('');
  await expect(consent).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => sessionStorage.length)).toBe(0);
});

test('practice request survives rerenders; synthetic pagehide clears input, aborts and rejects late response', async ({ page }) => {
  await page.goto('/?case=practice');
  const panel = page.getByTestId('practice-panel');
  const input = panel.getByRole('textbox', { name: '일본어 문장', exact: true });
  const topic = panel.getByRole('combobox', { name: '이야기 주제' });
  const consent = panel.getByRole('checkbox', { name: '위 내용을 확인하고 전송에 동의해요.', exact: true });
  const metrics = page.getByTestId('practice-fixture-metrics');
  await expect(input).toBeEnabled();
  await input.fill('合成の送信待ちです。');
  await topic.selectOption('여행');
  await consent.check();
  await panel.getByRole('button', { name: 'AI와 대화하기', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-held', 'true');
  await page.getByRole('button', { name: 'Rerender practice workspace', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-rerenders', '1');
  await expect(metrics).toHaveAttribute('data-aborts', '0');
  await expect(metrics).toHaveAttribute('data-calls', '1');
  await expect(input).toHaveValue('合成の送信待ちです。');
  await expect(input).toBeDisabled();
  await expect(topic).toHaveValue('여행');
  await expect(topic).toBeDisabled();
  await expect(panel.getByRole('button', { name: '요청 취소', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Dispatch synthetic practice pagehide', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-aborts', '1');
  await expect(input).toHaveValue('');
  await expect(input).toBeDisabled();
  await expect(panel.locator('.practice-page > p[role="status"]')).toContainText('화면을 떠나 임시 응답을 비웠어요');
  await page.getByRole('button', { name: 'Release mock practice response', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-held', 'false');
  await expect(panel.getByRole('region', { name: '방금 나눈 대화', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.length)).toBe(0);
  await page.getByRole('button', { name: 'Remount same practice owner', exact: true }).click();
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('');
  await expect(topic).toHaveValue('일상');
  await expect(consent).not.toBeChecked();
  await expect(metrics).toHaveAttribute('data-calls', '1');
});

test('practice owner-keyed remount aborts old request and a fresh synthetic response saves and reloads locally', async ({ page }) => {
  await page.goto('/?case=practice');
  const panel = page.getByTestId('practice-panel');
  const input = panel.getByRole('textbox', { name: '일본어 문장', exact: true });
  const consent = panel.getByRole('checkbox', { name: '위 내용을 확인하고 전송에 동의해요.', exact: true });
  const send = panel.getByRole('button', { name: 'AI와 대화하기', exact: true });
  const metrics = page.getByTestId('practice-fixture-metrics');
  await expect(input).toBeEnabled();
  await input.fill('古い所有者の合成文です。');
  await consent.check(); await send.click();
  await expect(metrics).toHaveAttribute('data-held', 'true');
  await page.getByRole('button', { name: 'Change synthetic practice owner', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-aborts', '1');
  await expect(input).toHaveValue('');
  await expect(consent).not.toBeChecked();
  await page.getByRole('button', { name: 'Release mock practice response', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-held', 'false');
  await expect(panel.getByRole('region', { name: '방금 나눈 대화', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.length)).toBe(0);

  await page.getByRole('button', { name: 'Change synthetic practice owner', exact: true }).click();
  await input.fill('新しい合成の練習文です。');
  await consent.check(); await send.click();
  await page.getByRole('button', { name: 'Release mock practice response', exact: true }).click();
  await expect(panel.getByRole('region', { name: '방금 나눈 대화', exact: true })).toContainText('合成応答です。');
  await expect(input).toHaveValue('');
  await expect(metrics).toHaveAttribute('data-calls', '2');
  await page.reload();
  await expect(panel.getByRole('region', { name: '방금 나눈 대화', exact: true })).toContainText('新しい合成の練習文です。');
  await expect(consent).not.toBeChecked();
  await expect(metrics).toHaveAttribute('data-calls', '0');
});

test('actual recorder explains local playback and gated external assessment across narrow open-close-reopen flows without capture or requests', async ({ page }, testInfo) => {
  const requestMethods: string[] = [];
  page.on('request', request => {
    if (['fetch', 'xhr'].includes(request.resourceType())) requestMethods.push(request.method());
  });
  await page.goto('/?case=practice');
  const panel = page.getByTestId('practice-panel');
  const summary = panel.getByText('내 목소리로 연습하기 (선택)', { exact: true });
  const recorder = panel.getByRole('region', { name: '발음 자기 점검', exact: true });
  const copy = recorder.getByText('최대 30초 녹음 후 직접 들어 보세요. 로컬 녹음과 다시 듣기는 이 화면에서만 처리해요. 문장 변경이나 화면 이탈 시 이 화면의 녹음은 지워져요. 외부 발음 평가는 별도 승인과 연결 준비를 마친 뒤, 전송 안내에 동의하고 직접 요청할 때만 녹음과 연습 문장을 보내요.', { exact: true });
  const metrics = page.getByTestId('practice-fixture-metrics');

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(summary).toBeVisible();
    await expect(recorder).toHaveCount(0);
    await summary.click();
    await expect(copy).toBeVisible();
    await expect(recorder.getByRole('button', { name: '내 발음 녹음', exact: true })).toBeEnabled();
    await expect(recorder.locator('audio')).toHaveCount(0);
    await summary.click();
    await expect(recorder).toHaveCount(0);
    await summary.click();
    await expect(copy).toBeVisible();
    await recorder.getByText('발음 점수는 준비 중이에요', { exact: true }).click();
    await expect(recorder.getByRole('button', { name: '발음 점수 받기 · 준비 중', exact: true })).toBeVisible();
    await expect(recorder.getByRole('button', { name: '발음 점수 받기 · 준비 중', exact: true })).toBeDisabled();
    await expect(recorder.getByText('연결 준비를 확인한 뒤, 어디로 보내는지 확인하고 동의한 녹음과 연습 문장만 보낼 수 있어요. 지금은 보낼 수 없어요.', { exact: true })).toBeVisible();
    await expect(metrics).toHaveAttribute('data-calls', '0');
    await expect.poll(() => page.evaluate(() => sessionStorage.length)).toBe(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await captureFullPageEvidence(page, `.e2e/component-browser/evidence/recorder-consent-${width}-${testInfo.project.name}.png`);
    await summary.click();
    await expect(recorder).toHaveCount(0);
  }
  await page.reload();
  await expect(summary).toBeVisible();
  await expect(recorder).toHaveCount(0);
  await expect(metrics).toHaveAttribute('data-calls', '0');
  await expect.poll(() => page.evaluate(() => sessionStorage.length)).toBe(0);
  expect(requestMethods, 'Opening local guidance must not initiate fetch/XHR requests').toEqual([]);
});
