import { test, expect, login } from './fixture';
import { syntheticAudio } from './synthetic-audio';
import { prepareZephyrSpeech } from '../../lib/zephyr-playback';

const policy = { voice: 'ko-KR-Chirp3-HD-Zephyr', useDeviceVoice: false };

test('saved assistant answer plays real audio only on click; replay and reload never regenerate it (synthetic provider)', async ({ page, qa }) => {
  let statusCalls = 0; let synthesisCalls = 0; let spokenText = '';
  await page.route('**/api/tts', async route => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if (route.request().method() === 'GET') {
      statusCalls++; await route.fulfill({ json: { ...policy, enabled: true, remainingCharacters: 100000 } }); return;
    }
    synthesisCalls++;
    const { text, requestId } = route.request().postDataJSON(); spokenText = text;
    expect(requestId).toMatch(/^[a-f0-9-]{14}4[a-f0-9-]{21}$/);
    await route.fulfill({ json: { ...policy, requestId, audioContent: syntheticAudio, remainingCharacters: 100000 - Array.from(text).length } });
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await page.goto('/assistant');
  await page.getByRole('button', { name: '오늘 운동 계획 보여줘', exact: true }).click();
  const read = page.getByRole('button', { name: '답변 읽기', exact: true });
  await expect(read).toBeVisible(); expect(synthesisCalls).toBe(0); expect(statusCalls).toBe(0);
  const saved = await qa.account.client.from('assistant_chat_messages').select('content').eq('user_id', qa.account.id).eq('role', 'assistant');
  expect(saved.error).toBeNull(); expect(saved.data).toHaveLength(1);
  await read.click();
  const audio = page.locator('audio[aria-label="Zephyr 답변 음성"]');
  await expect(audio).toBeVisible();
  // WebKit may require a second gesture after the asynchronous generation.
  await expect(page.getByRole('button', { name: /^(다시 재생|읽기 중지)$/ })).toBeEnabled();
  if (await audio.evaluate(element => (element as HTMLAudioElement).paused && !(element as HTMLAudioElement).ended)) await page.getByRole('button', { name: '다시 재생', exact: true }).click();
  await expect.poll(() => audio.evaluate(element => Number.isFinite((element as HTMLAudioElement).duration))).toBe(true);
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).ended)).toBe(true);
  expect(spokenText).toBe(prepareZephyrSpeech(saved.data![0].content).text);
  await expect(page.getByText('재생을 마쳤어요. 다시 재생해도 문자수를 추가로 사용하지 않아요.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '다시 재생', exact: true }).click();
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).ended)).toBe(true);
  expect(synthesisCalls).toBe(1); expect(statusCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload(); await read.click();
  await expect(page.getByText('이 답변은 이미 음성 생성을 요청했어요. 중복 생성을 막기 위해 다시 요청하지 않아요.', { exact: true })).toBeVisible();
  expect(synthesisCalls).toBe(1); expect(statusCalls).toBe(1);
  expect((await qa.account.client.from('assistant_chat_messages').select('content').eq('user_id', qa.account.id).eq('role', 'assistant')).data).toEqual(saved.data);
});

test('budget answer preserves text at a limit and never retries a lost synthesis response', async ({ page, qa }) => {
  expect((await qa.account.client.from('budget_profiles').insert({ user_id: qa.account.id, nickname: '음성 검증' })).error).toBeNull();
  let mode: 'limit' | 'lost' = 'limit'; let synthesisCalls = 0;
  await page.route('**/api/tts', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { ...policy, enabled: mode !== 'limit', remainingCharacters: mode === 'limit' ? 0 : 100000, code: mode === 'limit' ? 'MONTH_LIMIT' : 'READY', message: '이번 달 음성 사용 한도에 도달했어요.' } }); return;
    }
    synthesisCalls++; await route.abort('failed');
  });
  await login(page, qa.account); await page.goto('/budget');
  await page.getByRole('navigation', { name: '가계부 주요 메뉴' }).getByRole('button', { name: '분석', exact: true }).click();
  await page.getByRole('tab', { name: 'AI 상담', exact: true }).click();
  await page.getByRole('textbox', { name: 'AI에게 질문할 내용', exact: true }).fill('이번 달 식비는 얼마나 썼어?');
  await page.getByRole('button', { name: '질문하기', exact: true }).click();
  const read = page.getByRole('button', { name: '답변 읽기', exact: true });
  await expect(read).toBeVisible(); expect(synthesisCalls).toBe(0);
  await expect(page.getByRole('button', { name: /자동 읽기/ })).toHaveCount(0);
  await read.click(); await expect(page.getByText('이번 달 음성 사용 한도에 도달했어요.', { exact: true })).toBeVisible();
  expect(synthesisCalls).toBe(0); mode = 'lost';
  await read.click(); await expect(page.getByText('음성 연결을 확인하지 못했어요. 자동으로 다시 생성하지 않아요.', { exact: true })).toBeVisible();
  await read.click(); await expect(page.getByText('이 답변은 이미 음성 생성을 요청했어요. 중복 생성을 막기 위해 다시 요청하지 않아요.', { exact: true })).toBeVisible();
  expect(synthesisCalls).toBe(1); await expect(page.getByText('AI 답변', { exact: true })).toBeVisible();
  expect((await qa.account.client.from('budget_transactions').select('id').eq('user_id', qa.account.id)).data).toEqual([]);
});

test('quick command replacement stops a pending voice from playing a stale answer', async ({ page, qa }) => {
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void; const submitted = new Promise<void>(resolve => { arrived = resolve; });
  let synthesisCalls = 0;
  await page.route('**/api/tts', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { ...policy, enabled: true, remainingCharacters: 100000 } }); return; }
    synthesisCalls++; const { requestId } = route.request().postDataJSON(); arrived(); await wait;
    await route.fulfill({ json: { ...policy, requestId, audioContent: syntheticAudio, remainingCharacters: 99900 } });
  });
  try {
    await login(page, qa.account); await page.goto('/assistant/quick');
    await page.getByLabel('실행할 명령', { exact: true }).fill('오늘 운동 계획 보여줘');
    await page.getByRole('button', { name: '명령 실행', exact: true }).click();
    await page.getByRole('button', { name: '답변 읽기', exact: true }).click(); await submitted;
    await page.getByLabel('실행할 명령', { exact: true }).fill('오늘 브리핑 보여줘');
    await page.getByRole('button', { name: '명령 실행', exact: true }).click();
    await expect(page.getByRole('button', { name: '답변 읽기', exact: true })).toBeVisible();
    const delivered = page.waitForResponse(response => response.url().endsWith('/api/tts') && response.request().method() === 'POST');
    release(); await delivered;
    await expect(page.locator('audio[src]')).toHaveCount(0); expect(synthesisCalls).toBe(1);
    await expect(page.getByRole('button', { name: '답변 읽기', exact: true })).toBeEnabled();
  } finally { release(); }
});
