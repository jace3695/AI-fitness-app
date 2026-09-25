import { test, expect, login, synced, original } from './fixture';
import type { Route, APIResponse } from '@playwright/test';

const pinApi = 'http://127.0.0.1:3000/api/pin';
const protectedHeading = '식단 설정';
const errorHeading = '로그인 확인을 완료하지 못했어요';

async function deliver(route: Route, response: APIResponse) {
  try { await route.fulfill({ response }); }
  catch (error) {
    if (!/abort|cancel/i.test(route.request().failure()?.errorText ?? '')) throw error;
  }
}

test('PIN status failure keeps content closed and explicit retry uses a real successful response', async ({ page, qa }) => {
  let fail = true;
  await page.route(pinApi, async route => {
    if (fail && route.request().postDataJSON()?.action === 'status') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic PIN status outage' }) });
    else await route.fallback();
  });
  await login(page, qa.account); await synced(page);
  await expect(page.getByRole('heading', { name: errorHeading, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: protectedHeading, exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: '다시 확인', exact: true }).click();
  await expect(page.getByRole('heading', { name: protectedHeading, exact: true })).toBeVisible();
  expect(await qa.read()).toEqual(original);
});

test('delayed PIN status never exposes content before confirmation', async ({ page, qa }) => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void; const received = new Promise<void>(resolve => { arrived = resolve; });
  await page.route(pinApi, async route => {
    const response = await route.fetch(); arrived(); await held;
    await deliver(route, response);
  });
  try {
    await login(page, qa.account); await received; await synced(page);
    await expect(page.getByText('AI 연이를 불러오는 중…', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: protectedHeading, exact: true })).toHaveCount(0);
    release();
    await expect(page.getByRole('heading', { name: protectedHeading, exact: true })).toBeVisible();
    expect(await qa.read()).toEqual(original);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('late PIN status after logout cannot reopen the previous account', async ({ page, qa }) => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  let arrived!: () => void; const received = new Promise<void>(resolve => { arrived = resolve; });
  let unhandledRejections = 0;
  page.on('pageerror', error => { if (error.name === 'Unhandled Promise Rejection') unhandledRejections++; });
  await page.route(pinApi, async route => {
    const response = await route.fetch(); arrived(); await held;
    await deliver(route, response);
  });
  try {
    await login(page, qa.account); await received;
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    release(); await page.unrouteAll({ behavior: 'wait' });
    await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: protectedHeading, exact: true })).toHaveCount(0);
    await login(page, qa.account); await synced(page);
    await expect(page.getByRole('heading', { name: protectedHeading, exact: true })).toBeVisible();
    expect(unhandledRejections).toBe(0); expect(await qa.read()).toEqual(original);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});
