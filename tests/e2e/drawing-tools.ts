import type { Page } from '@playwright/test';
import { expect } from './fixture';

// Exercise the shipping UI to expose optional tools for the exhaustive course
// regressions. Beginner tests deliberately do not use this helper.
export async function showDrawingTools(page: Page) {
  const toggle = page.getByRole('button', {name:'전체 도구 보기', exact:true});
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed','true');
}
