import { test, expect } from '@playwright/test';
import { expectNoPageErrors, gotoApp, trackPageErrors } from './helpers';

test('home renders and offers host/join without page errors', async ({ page }) => {
  const errors = trackPageErrors(page);

  await gotoApp(page);

  await expect(page).toHaveTitle(/bamboozle/i);
  await expect(page.getByText('BAMBOOZLE', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /host game/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /join game/i })).toBeVisible();

  expectNoPageErrors(errors);
});
