import { test, expect } from '@playwright/test';

/**
 * Auth flow tests — verifies public access to /courses.
 *
 * Most routes became public after the village-hub pivot — /village, /menu,
 * /dashboard, /courses, /shop, /alchemy, /community-pot, /inventory,
 * /leaderboard. The flow guard only redirects auth-required action flows
 * (deposit, lessons, brew, redeem).
 *
 * Authenticated UI is covered by Vitest component tests since Privy can't
 * be mocked end-to-end.
 */

test.describe('Unauthenticated access', () => {
  test.beforeEach(async ({ page }) => {
    // Skip splash screen
    await page.addInitScript(() => {
      sessionStorage.setItem('splash-shown', '1');
    });
    // Keep Privy in loading state
    await page.route('**/api.privy.io/**', () => {});
    await page.route('**/localhost:3001/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
  });

  test('/courses is accessible without auth', async ({ page }) => {
    await page.goto('/courses');

    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 15_000 });
    const text = await heading.textContent();
    expect(text).toContain('Courses');
  });

  test('shows Sign In button on courses page', async ({ page }) => {
    await page.goto('/courses');
    const signIn = page.getByRole('button', { name: /sign in/i });
    await expect(signIn).toBeVisible({ timeout: 15_000 });
  });
});
