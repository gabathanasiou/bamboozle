import { Page, expect } from '@playwright/test';

/** Collect uncaught page errors for a spec. */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Navigate via baseURL and wait for the document to be interactive. */
export async function gotoApp(page: Page, path = '/'): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
}

/** Fail with the collected errors rather than a bare `toEqual([])`. */
export function expectNoPageErrors(errors: string[]): void {
  expect(errors, `uncaught page errors:\n${errors.join('\n')}`).toEqual([]);
}
