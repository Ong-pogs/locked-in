# v2 visual snapshot suite

Visual regression baselines for the v2 money surfaces (dashboard card states,
claim review/success, deposit form). Complements — does **not** replace — the
functional suite (`e2e/playwright.v2.config.ts`) and the spec §7 devnet
funded-wallet e2e.

## Running

```bash
npm run test:visual          # compare against committed baselines
npm run test:visual:update   # regenerate baselines (after an intended UI change)
```

Both spin up a **production build** on port 3300 (deterministic — dev-server
on-demand compilation races the first navigation and flakes). To iterate fast
against an already-running prod server: `E2E_BASE_URL=http://localhost:3300 npx
playwright test --config e2e/visual.config.ts`.

## Determinism guarantees

- Production build (no compile-on-navigate), `serviceWorkers: 'block'` (Serwist
  otherwise intercepts and bypasses route mocks), `reducedMotion: 'reduce'`,
  fixed clock (`page.clock.setFixedTime` in the fixture), `timezoneId: 'UTC'`.
- The **ticking position value** (`[data-testid=position-value]`) is `mask`ed in
  every dashboard shot — its per-frame accrual must never enter a baseline. It
  is a pure function of `Date.now()`/`requestAnimationFrame` (both clock-fakeable)
  and freezes under `prefers-reduced-motion`. FlameGauge animation is CSS-only.
- No `fullPage` screenshots: the theme's `background-attachment: fixed` + the
  `position: fixed` tint overlay produce scroll-stitch banding. Shots are
  locator-scoped to the card/review/form.

## Baselines

Committed baselines are **darwin** (`*-darwin.png`, dev machine). There is no
Linux screenshot CI runner yet, so a first CI run must regenerate Linux
baselines with `--update-snapshots` (font hinting differs across platforms).
Scope: chromium only (both projects); iOS Safari/WebKit rendering is manual QA.

## Scope

`e2e/visual/` is a separate config and testDir. It does not touch the default
`e2e/playwright.config.ts`, the legacy specs, or `e2e/playwright.v2.config.ts`.
