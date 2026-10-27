import { test, expect } from './fixture';
import { mkdir } from 'node:fs/promises';

test('saved reply decodes without autoplay, plays on explicit click and resets on reload', async ({ page }, testInfo) => {
  await page.goto('/?case=reply');
  const panel = page.getByRole('region', { name: '연이 대화 캐릭터', exact: true });
  const metrics = page.getByTestId('reply-source-metrics');
  const audio = panel.locator('audio');
  await expect(panel).toHaveAttribute('data-reply-status', 'idle');
  await expect(metrics).toHaveAttribute('data-loads', '0');
  await expect(audio).not.toHaveAttribute('src');

  await page.getByRole('button', { name: '저장 답변 전달', exact: true }).click();
  await expect(panel).toHaveAttribute('data-reply-status', 'ready');
  await expect(metrics).toHaveAttribute('data-loads', '1');
  await expect.poll(() => audio.evaluate(node => {
    const media = node as HTMLAudioElement;
    return Number.isFinite(media.duration) && Math.abs(media.duration * 1000 - 5376) <= 100;
  })).toBe(true);
  expect(await audio.evaluate(node => (node as HTMLAudioElement).paused && (node as HTMLAudioElement).currentTime === 0)).toBe(true);
  const source = await audio.getAttribute('src');
  expect(source).toMatch(/^blob:/);
  await expect(page.locator('[data-appearance-status]')).toHaveAttribute('data-appearance-status', 'ready');

  await panel.getByRole('button', { name: '답변 듣기', exact: true }).click();
  await expect(panel).toHaveAttribute('data-speech-state', 'playing');
  await expect.poll(() => audio.evaluate(node => (node as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await panel.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(panel).toHaveAttribute('data-speech-state', 'paused');
  expect(await audio.evaluate(node => (node as HTMLAudioElement).paused)).toBe(true);
  await panel.getByRole('button', { name: '답변 듣기', exact: true }).click();
  await expect(panel).toHaveAttribute('data-speech-state', 'playing');
  await panel.getByRole('button', { name: '처음으로', exact: true }).click();
  await expect(panel).toHaveAttribute('data-speech-state', 'ready');
  await expect.poll(() => audio.evaluate(node => (node as HTMLAudioElement).currentTime)).toBe(0);
  expect(await audio.getAttribute('src')).toBe(source);
  await expect(metrics).toHaveAttribute('data-loads', '1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('.e2e/component-browser/evidence', { recursive: true });
  await page.screenshot({ path: `.e2e/component-browser/evidence/reply-ready-${testInfo.project.name}.png`, fullPage: true });

  await page.reload();
  await expect(panel).toHaveAttribute('data-reply-status', 'idle');
  await expect(audio).not.toHaveAttribute('src');
  await expect(metrics).toHaveAttribute('data-loads', '0');
});

test('replacing a held source aborts its ownership and ignores its late clip', async ({ page }) => {
  await page.goto('/?case=reply');
  const panel = page.getByRole('region', { name: '연이 대화 캐릭터', exact: true });
  const metrics = page.getByTestId('reply-source-metrics');
  await page.getByRole('button', { name: '보류 소스로 바꾸기', exact: true }).click();
  await page.getByRole('button', { name: '저장 답변 전달', exact: true }).click();
  await expect(panel).toHaveAttribute('data-reply-status', 'loading');
  await expect(metrics).toHaveAttribute('data-pending', '1');
  await expect(metrics).toHaveAttribute('data-loads', '0');

  await page.getByRole('button', { name: '즉시 소스로 바꾸기', exact: true }).click();
  await expect(panel).toHaveAttribute('data-reply-status', 'ready');
  await expect(metrics).toHaveAttribute('data-aborts', '1');
  await expect(metrics).toHaveAttribute('data-resolutions', '2');
  const source = await panel.locator('audio').getAttribute('src');
  await page.getByRole('button', { name: '늦은 소스 결과 전달', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-releases', '1');
  await expect(metrics).toHaveAttribute('data-pending', '0');
  await expect(metrics).toHaveAttribute('data-loads', '1');
  await expect(panel).toHaveAttribute('data-reply-status', 'ready');
  expect(await panel.locator('audio').getAttribute('src')).toBe(source);
  expect(await panel.locator('audio').evaluate(node => (node as HTMLAudioElement).paused)).toBe(true);

  await page.getByRole('button', { name: '미등록 답변 전달', exact: true }).click();
  await expect(panel).toHaveAttribute('data-reply-status', 'text-only');
  await expect(panel.getByText('이 답변에 맞는 저장 음성이 없어요.', { exact: false })).toBeVisible();
  await expect(panel.getByRole('button', { name: '답변 듣기', exact: true })).toBeDisabled();
  await expect(panel.locator('audio')).not.toHaveAttribute('src');
  await expect(metrics).toHaveAttribute('data-loads', '1');
});

test('reset prevents source replacement resurrection and unmount cancels pending ownership', async ({ page }) => {
  await page.goto('/?case=reply');
  const panel = page.getByRole('region', { name: '연이 대화 캐릭터', exact: true });
  const metrics = page.getByTestId('reply-source-metrics');
  await page.getByRole('button', { name: '보류 소스로 바꾸기', exact: true }).click();
  await page.getByRole('button', { name: '저장 답변 전달', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-pending', '1');
  await page.getByRole('button', { name: '초기화 이벤트', exact: true }).click();
  await expect(panel).toHaveAttribute('data-reply-status', 'idle');
  await expect(metrics).toHaveAttribute('data-aborts', '1');
  await page.getByRole('button', { name: '즉시 소스로 바꾸기', exact: true }).click();
  await page.getByRole('button', { name: '늦은 소스 결과 전달', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-releases', '1');
  await expect(metrics).toHaveAttribute('data-resolutions', '1');
  await expect(metrics).toHaveAttribute('data-loads', '0');
  await expect(panel).toHaveAttribute('data-reply-status', 'idle');

  await page.getByRole('button', { name: '보류 소스로 바꾸기', exact: true }).click();
  await page.getByRole('button', { name: '저장 답변 전달', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-pending', '1');
  const oldAudio = await panel.locator('audio').elementHandle();
  expect(oldAudio).not.toBeNull();
  await page.getByRole('button', { name: '패널 제거', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(metrics).toHaveAttribute('data-aborts', '2');
  await page.getByRole('button', { name: '늦은 소스 결과 전달', exact: true }).click();
  await expect(metrics).toHaveAttribute('data-releases', '2');
  await expect(metrics).toHaveAttribute('data-loads', '0');
  expect(await oldAudio!.evaluate(node => (node as HTMLAudioElement).paused && !node.hasAttribute('src'))).toBe(true);
  await oldAudio!.dispose();
});


for (const presentation of ['review', 'assistant']) {
  test(`cancel pending clip in ${presentation} presentation without revival after late result or source replacement`, async ({ page }) => {
    await page.goto(`/?case=reply&presentation=${presentation}`);
    const panel = page.getByRole('region', { name: '연이 대화 캐릭터', exact: true });
    const metrics = page.getByTestId('reply-source-metrics');
    await page.getByRole('button', { name: '보류 소스로 바꾸기', exact: true }).click();
    await page.getByRole('button', { name: '저장 답변 전달', exact: true }).click();
    await expect(panel).toHaveAttribute('data-reply-status', 'loading');
    await expect(metrics).toHaveAttribute('data-pending', '1');
    const cancel = panel.getByRole('button', { name: '취소', exact: true });
    await expect(cancel).toBeVisible();
    const bounds = await cancel.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    if (presentation === 'assistant') {
      await expect(panel.getByRole('button', { name: '답변 듣기', exact: true })).toHaveCount(0);
      await cancel.focus(); await page.keyboard.press('Enter');
    } else await cancel.click();
    await expect(panel).toHaveAttribute('data-reply-status', 'idle');
    await expect(cancel).toHaveCount(0);
    await expect(metrics).toHaveAttribute('data-aborts', '1');
    await expect(panel.locator('audio')).not.toHaveAttribute('src');
    await page.getByRole('button', { name: '즉시 소스로 바꾸기', exact: true }).click();
    await page.getByRole('button', { name: '늦은 소스 결과 전달', exact: true }).click();
    await expect(metrics).toHaveAttribute('data-releases', '1');
    await expect(metrics).toHaveAttribute('data-resolutions', '1');
    await expect(metrics).toHaveAttribute('data-loads', '0');
    await expect(panel).toHaveAttribute('data-reply-status', 'idle');
    expect(await panel.locator('audio').evaluate(node => (node as HTMLAudioElement).paused)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Only a genuinely new response may prepare the same saved clip again.
    await page.getByRole('button', { name: '저장 답변 전달', exact: true }).click();
    await expect(panel).toHaveAttribute('data-reply-status', 'ready');
    await expect(metrics).toHaveAttribute('data-loads', '1');
    await expect(cancel).toHaveCount(0);
    expect(await panel.locator('audio').evaluate(node => (node as HTMLAudioElement).paused)).toBe(true);
    await page.reload();
    await expect(panel).toHaveAttribute('data-reply-status', 'idle');
    await expect(panel.locator('audio')).not.toHaveAttribute('src');
    await expect(metrics).toHaveAttribute('data-loads', '0');
  });
}
