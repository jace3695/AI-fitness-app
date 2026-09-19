import type { Page } from '@playwright/test';
import { test, expect, login, original, synced, today } from './fixture';
import { buildCurrentWorkoutSettings } from '../../app/data/currentWorkoutDirection';
import { syntheticAudio } from './synthetic-audio';

const policy = { voice: 'ko-KR-Chirp3-HD-Zephyr', useDeviceVoice: false };
async function openWorkout(page: Page, account: Parameters<typeof login>[1]) {
  const settings = buildCurrentWorkoutSettings({ weeklyGroups: {}, weeklyMethods: {}, weeklyEdits: {}, exerciseTargets: {}, dateOverrides: {} });
  settings.dateOverrides[today()] = { groupId: 'current-weekend-recovery', exerciseTargets: { '기본 몸풀기': { durationMinutes: 1 } } };
  const seeded = { ...original, 'ai-fitness-user-workout-settings': settings,
    'ai-fitness-workout-direction-version': 'five-day-circuit-v1', 'ai-fitness-selected-weekly-workout-plan': 'five-day-fullbody-circuit' };
  expect((await account.client.from('user_app_state').update({ state: seeded }).eq('user_id', account.id)).error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() => {
    (window as unknown as { deviceSpeechCalls: number }).deviceSpeechCalls = 0;
    if (window.speechSynthesis) window.speechSynthesis.speak = () => { (window as unknown as { deviceSpeechCalls: number }).deviceSpeechCalls++; };
  });
  await login(page, account); await synced(page); await page.goto('/fitness'); await synced(page);
  await startWorkout(page);
}
async function startWorkout(page: Page) {
  await page.getByRole('navigation', { name: '운동 주요 메뉴' }).getByRole('button', { name: '운동하기', exact: true }).click();
  await page.getByRole('button', { name: '운동 시작하기', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('region', { name: '동작 타이머', exact: true })).toContainText('01:00');
}
async function discard(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: '나가기', exact: true }).click();
  await page.getByRole('button', { name: '저장 없이 종료', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await synced(page);
}

test('first timer click, pause, resume and automatic transition reuse Zephyr audio across reload', async ({ page, qa }) => {
  let posts = 0; let gets = 0; let speech = '';
  await page.route('**/api/tts', async route => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if (route.request().method() === 'GET') { gets++; await route.fulfill({ json: { ...policy, enabled: true, remainingCharacters: 100000 } }); return; }
    posts++; const { text, requestId } = route.request().postDataJSON(); speech = text;
    await route.fulfill({ json: { ...policy, requestId, audioContent: syntheticAudio, remainingCharacters: 99900 } });
  });
  await page.clock.install(); await openWorkout(page, qa.account);
  expect(posts).toBe(0); expect(gets).toBe(0);
  const timer = page.getByRole('region', { name: '동작 타이머', exact: true });
  await timer.getByRole('button', { name: '시작', exact: true }).click();
  await expect(timer.getByRole('button', { name: '일시정지', exact: true })).toBeVisible();
  await expect.poll(() => posts).toBe(1);
  await expect(page.getByText('연이 음성 준비 중…', { exact: true })).toHaveCount(0);
  await page.clock.fastForward(3000); await timer.getByRole('button', { name: '일시정지', exact: true }).click();
  const paused = await timer.innerText(); await page.clock.fastForward(4000); expect(await timer.innerText()).toBe(paused);
  await timer.getByRole('button', { name: '계속', exact: true }).click(); await page.clock.fastForward(61000);
  await expect(page.getByRole('dialog').getByRole('heading', { name: '실내 걷기', exact: true })).toBeVisible();
  expect(speech).toBe('다음 운동은 실내 걷기입니다.');
  const audio = page.locator('audio[aria-label="연이 운동 안내 음성"]');
  await expect(audio).toHaveAttribute('data-voice', policy.voice);
  await expect(audio).toHaveAttribute('src', /^data:audio\/mpeg;base64,/);
  await page.getByRole('button', { name: '안내 재생', exact: true }).click();
  await expect.poll(() => audio.evaluate(el => (el as HTMLAudioElement).ended)).toBe(true);
  expect(posts).toBe(1); expect(gets).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { deviceSpeechCalls: number }).deviceSpeechCalls)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await discard(page); await page.reload(); await synced(page); await startWorkout(page);
  await timer.getByRole('button', { name: '시작', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '완료하고 다음', exact: true }).click();
  await expect(audio).toHaveAttribute('src', /^data:audio\/mpeg;base64,/);
  expect(posts).toBe(1); expect(gets).toBe(1); await discard(page);
  expect((await qa.read())['ai-fitness-workout-completed-days']).toEqual(original['ai-fitness-workout-completed-days']);
});

test('rapid next-exercise then timer start respects the synthesis interval without delaying the timer', async ({ page, qa }) => {
  const submissions: number[] = [];
  await page.route('**/api/tts', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { ...policy, enabled: true, remainingCharacters: 100000 } }); return; }
    submissions.push(Date.now());
    const { requestId } = route.request().postDataJSON();
    await route.fulfill({ json: { ...policy, requestId, audioContent: syntheticAudio, remainingCharacters: 99900 } });
  });
  await openWorkout(page, qa.account);
  await page.getByRole('dialog').getByRole('button', { name: '완료하고 다음', exact: true }).click();
  await expect(page.getByRole('button', { name: '안내 재생', exact: true })).toBeVisible();
  const timer = page.getByRole('region', { name: '동작 타이머', exact: true });
  await timer.getByRole('button', { name: '시작', exact: true }).click();
  await expect(timer.getByRole('button', { name: '일시정지', exact: true })).toBeVisible();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1] - submissions[0]).toBeGreaterThanOrEqual(5000);
  await expect(page.getByText('연이 음성 준비 중…', { exact: true })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: '완료하고 다음', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: '기본 정리운동', exact: true })).toBeVisible();
  await expect(page.locator('audio[aria-label="연이 운동 안내 음성"]')).toHaveAttribute('src', /^data:audio\/mpeg;base64,/);
  expect(submissions).toHaveLength(2); await discard(page);
});

test('workout timer continues at limits and never regenerates a lost response', async ({ page, qa }) => {
  let limited = true; let posts = 0;
  await page.route('**/api/tts', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { ...policy, enabled: !limited, remainingCharacters: limited ? 0 : 100000, message: '이번 달 음성 한도에 도달했어요.' } }); return; }
    posts++; await route.abort('failed');
  });
  await openWorkout(page, qa.account);
  const timer = page.getByRole('region', { name: '동작 타이머', exact: true });
  await timer.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('이번 달 음성 한도');
  await expect(timer.getByRole('button', { name: '일시정지', exact: true })).toBeVisible(); expect(posts).toBe(0);
  await timer.getByRole('button', { name: '초기화', exact: true }).click(); limited = false;
  await timer.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('화면 안내와 타이머는 계속');
  await timer.getByRole('button', { name: '초기화', exact: true }).click();
  await timer.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('이미 음성 생성을 요청'); expect(posts).toBe(1);
  await expect(timer.getByRole('button', { name: '일시정지', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { deviceSpeechCalls: number }).deviceSpeechCalls)).toBe(0);
  await discard(page);
});

test('muting a pending workout cue prevents stale playback and further generation', async ({ page, qa }) => {
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); let posts = 0;
  await page.route('**/api/tts', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { ...policy, enabled: true, remainingCharacters: 100000 } }); return; }
    posts++; const { requestId } = route.request().postDataJSON(); await pending;
    await route.fulfill({ json: { ...policy, requestId, audioContent: syntheticAudio, remainingCharacters: 99900 } });
  });
  try {
    await openWorkout(page, qa.account);
    await page.getByRole('dialog').getByRole('button', { name: '완료하고 다음', exact: true }).click();
    await expect.poll(() => posts).toBe(1);
    await page.getByRole('button', { name: '음성 켜짐', exact: true }).click();
    const response = page.waitForResponse(res => res.url().endsWith('/api/tts') && res.request().method() === 'POST');
    release(); await response;
    await expect(page.locator('audio[aria-label="연이 운동 안내 음성"]')).not.toHaveAttribute('src', /^data:audio\/mpeg/);
    await expect(page.getByRole('button', { name: '안내 재생', exact: true })).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: '완료하고 다음', exact: true }).click(); expect(posts).toBe(1);
    await discard(page);
  } finally { release(); }
});
