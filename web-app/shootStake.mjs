// Screenshots the StakePanel in each of its states, desktop and phone width.
//
// Auth must be cookies set BEFORE navigation (the edge guard reads them there),
// under the key `locked-in-user` at version 1, and Privy is left hanging — if
// it resolves, useAuth wipes the session.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = 'C:/Users/ongee/AppData/Local/Temp/claude/C--Project-LockedIn/4ed87fa6-9361-4830-b6b1-1a832a851dc2/scratchpad/pgtest';
const S = JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf8'));
const OUT = join(here, 'shots');
mkdirSync(OUT, { recursive: true });

const ORIGIN = S.webOrigin;

const browser = await chromium.launch();

for (const [name, who] of Object.entries(S)) {
  if (name === 'webOrigin') continue;
  for (const [label, viewport] of [
    ['desktop', { width: 1280, height: 1400 }],
    ['phone', { width: 400, height: 1200 }],
  ]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    // Privy must never resolve.
    await ctx.route('**/*privy*/**', () => {});
    await ctx.addInitScript(([w, t]) => {
      const v = JSON.stringify({
        state: {
          walletAddress: w, authToken: t, refreshToken: t,
          isAuthenticated: true, onboardingPhase: 'main',
        },
        version: 1,
      });
      window.localStorage.setItem('locked-in-user', v);
    }, [who.wallet, who.token]);
    await ctx.addCookies([
      { name: 'li_wallet', value: who.wallet, url: ORIGIN },
      { name: 'li_auth', value: '1', url: ORIGIN },
    ]);

    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${ORIGIN}/arena`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);

    const file = join(OUT, `${name}-${label}.png`);
    await page.screenshot({ path: file, fullPage: label === 'desktop' });

    const panel = await page.locator('[data-testid="arena-stake-standing"], [data-testid="arena-stake-optin"]').count();
    const headline = await page.locator('[data-testid="arena-stake-headline"]').textContent().catch(() => null);
    console.log(`${name}/${label}: panel=${panel} headline=${JSON.stringify(headline)} errors=${errors.length}`);
    if (errors.length) console.log('   first error:', errors[0].slice(0, 160));
    await ctx.close();
  }
}

await browser.close();
console.log('shots in', OUT);
