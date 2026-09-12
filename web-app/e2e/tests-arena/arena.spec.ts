// Two-player arena e2e against a REAL backend with REAL signed JWTs.
//
// Unit and integration tests prove the API is correct. They do not prove a
// human can play a match. Every screenshot this produces is meant to be
// opened and looked at — a green run with a blank page is not a pass.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const STACK = JSON.parse(
  readFileSync(
    'C:/Users/ongee/AppData/Local/Temp/claude/C--Project-LockedIn/4ed87fa6-9361-4830-b6b1-1a832a851dc2/scratchpad/pgtest/stackinfo.json',
    'utf8',
  ),
);

const SHOTS = 'test-results-arena';

/**
 * Seeds the persisted zustand user store with a REAL access token.
 *
 * Mirrors e2e/fixtures/auth.fixture.ts: the store key is `locked-in-user` at
 * version 1, the splash and tutorial flags have to be pre-set, and — the part
 * that is easy to miss — Privy's API must be left hanging. If Privy resolves
 * as "not authenticated", useAuth's cleanup wipes the seeded session and every
 * route bounces back to the village.
 */
async function signIn(page: Page, who: { wallet: string; token: string }) {
  await page.route('**/api.privy.io/**', () => { /* never resolve, by design */ });
  await page.route('**/auth.privy.io/**', () => { /* never resolve, by design */ });

  // proxy.ts gates routes on the `locked-in-auth` cookie at the EDGE, before a
  // single line of client JS runs — so this cookie has to exist on the request
  // itself. Setting it in addInitScript is too late and the route bounces to
  // /village.
  await page.context().addCookies([
    { name: 'locked-in-auth', value: '1', url: 'http://localhost:39300' },
    { name: 'locked-in-tutorial-done', value: '1', url: 'http://localhost:39300' },
  ]);

  await page.addInitScript((seed) => {
    sessionStorage.setItem('splash-shown', '1');
    localStorage.setItem('locked-in-user', JSON.stringify({
      state: {
        walletAddress: seed.wallet,
        walletAuthToken: 'e2e-wallet-auth',
        displayName: 'Arena Player',
        avatarUrl: null,
        onboardingPhase: 'main',
        createdAt: new Date().toISOString(),
        dungeonTourCompleted: true,
        tutorialCompleted: true,
        authToken: seed.token,
        refreshToken: seed.token,
      },
      version: 1,
    }));
    localStorage.setItem('locked-in-tutorial-done', '1');
    document.cookie = 'locked-in-auth=1; path=/; max-age=604800; samesite=lax';
    document.cookie = 'locked-in-tutorial-done=1; path=/; max-age=31536000; samesite=lax';
  }, who);
}

test('the arena hub renders for a signed-in player', async ({ page }) => {
  await signIn(page, STACK.alice);
  await page.goto('/spire');
  await expect(page.getByTestId('arena-title')).toBeVisible();
  await expect(page.getByTestId('arena-my-rating')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-hub.png`, fullPage: true });
});

test('two players complete a full 1v1 match', async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const a = await aliceCtx.newPage();
  const b = await bobCtx.newPage();
  await signIn(a, STACK.alice);
  await signIn(b, STACK.bob);

  await a.goto('/spire');
  await a.getByTestId('arena-create-challenge').click();
  await expect(a.getByTestId('arena-join-code')).toBeVisible();
  const code = (await a.getByTestId('arena-join-code').innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  await a.screenshot({ path: `${SHOTS}/02-challenge-created.png`, fullPage: true });

  // The invite landing must say something before asking anyone to sign in.
  await b.goto(`/spire/join/${code}`);
  await expect(b.getByTestId('arena-invite-challenger')).toBeVisible();
  await b.screenshot({ path: `${SHOTS}/03-invite-landing.png`, fullPage: true });

  // Signed-in visitors auto-join; wait for the match route.
  await b.waitForURL(/\/spire\/[0-9a-f-]{36}$/, { timeout: 15_000 });

  const matchUrl = b.url();
  await a.goto(matchUrl);

  for (const [page, tag] of [[a, 'alice'], [b, 'bob']] as const) {
    await expect(page.getByTestId('arena-start-match')).toBeVisible();
    await page.getByTestId('arena-start-match').click();

    for (let i = 1; i <= 7; i++) {
      await expect(page.getByTestId('arena-question-prompt')).toBeVisible();
      // Exactly one question on screen — the anti-cheat contract.
      await expect(page.getByTestId('arena-question-prompt')).toHaveCount(1);
      if (i === 1) {
        await page.screenshot({ path: `${SHOTS}/04-${tag}-question.png`, fullPage: true });
      }
      await page.getByTestId('arena-option-0').click();
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: `${SHOTS}/05-${tag}-finished.png`, fullPage: true });
  }

  // Both done -> the match resolves and scores become visible.
  await a.reload();
  await expect(a.getByTestId('arena-match-result')).toBeVisible({ timeout: 15_000 });
  await expect(a.getByTestId('arena-result-row')).toHaveCount(2);
  await a.screenshot({ path: `${SHOTS}/06-result.png`, fullPage: true });

  // The ladder should now show both players.
  await a.goto('/spire');
  await expect(a.getByTestId('arena-ladder-row').first()).toBeVisible();
  await a.screenshot({ path: `${SHOTS}/07-ladder-populated.png`, fullPage: true });
});

test('the answer key never reaches the browser', async ({ page }) => {
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/v1/arena/')) {
      try { bodies.push(await r.text()); } catch { /* non-text response */ }
    }
  });

  await signIn(page, STACK.alice);
  await page.goto('/spire');
  await page.getByTestId('arena-create-challenge').click();
  await expect(page.getByTestId('arena-join-code')).toBeVisible();
  await page.waitForTimeout(500);

  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) {
    expect(body).not.toContain('correct_option_id');
    expect(body).not.toContain('correctOptionId');
  }
  const html = await page.content();
  expect(html).not.toContain('correct_option_id');
  expect(html).not.toContain('correctOptionId');
});

test('arena screens do not scroll horizontally at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, STACK.alice);
  for (const path of ['/spire', '/spire/join/ABCD2345']) {
    await page.goto(path);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `${SHOTS}/08-mobile${path.replace(/\//g, '-')}.png`,
      fullPage: true,
    });
  }
});
