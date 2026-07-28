# Fiat → USDC Onramp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-app fiat→USDC funding (Privy `useFundWallet`) wired into the deposit flow, plus a JWT-bound gas-stipend endpoint so embedded-wallet users can transact once USDC arrives.

**Architecture:** Frontend-only Privy-native funding (no provider keys, no fiat backend) integrated at `DepositFormV2`'s insufficiency state, with a balance-driven completion flow (Solana `fundWallet` returns `Promise<void>` — no result object). One thin backend route wraps the existing, tested `dripSolOnce` lib as the SOL stopgap until the gasless-relay spec ships.

**Tech Stack:** Next.js 16 / React, `@privy-io/react-auth` 3.21.2 (`/solana` subpath), Zustand, vitest; Fastify + `@fastify/rate-limit` backend.

**Spec:** `docs/superpowers/specs/2026-07-29-fiat-onramp-usdc-design.md`

## Global Constraints

- Lock bounds: `$10 min / $50 max / $1,000 global TVL cap` (`MIN_UI`/`MAX_UI`/`GLOBAL_CAP_UI` in DepositFormV2).
- Prefill formula: `max(10, ceil(max(deficit + 2, deficit * 1.10)))`; deficit ≤ 0 or non-finite throws.
- Funding wallet address MUST come from `pickSignerWallet(wallets, ownerAddress)`; on `null` refuse with `missingSignerMessage(ownerAddress)` — never `wallets[0]`.
- Stipend drips ONLY to `request.auth.walletAddress` (JWT claim). No body parameter.
- Balance semantics: ATA absent → `'0'`; RPC failure → `null`; never render the buy button on `null` balance.
- Breadcrumb TTL 30 min; localStorage key `locked-in-funding-breadcrumb`.
- Chain literal `'solana:mainnet'` (verified: a valid Privy `SolanaChain`; providers.tsx already derives it).
- No AI attribution in commits.

---

### Task 1: Balance semantics — ATA absent reads as $0

**Files:**
- Modify: `web-app/services/solana/vaultV2.ts` (readWalletUsdcUi, ~line 243)
- Test: `web-app/__tests__/services/onramp/readWalletUsdcUi.test.ts`

**Interfaces:**
- Produces: `readWalletUsdcUi(ownerAddress): Promise<string | null>` — `'0'` when the USDC ATA does not exist; `null` only on RPC failure.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getAccountInfo = vi.fn();
const getTokenAccountBalance = vi.fn();
vi.mock('@/services/solana/connection', () => ({
  connection: {
    getAccountInfo: (...a: unknown[]) => getAccountInfo(...a),
    getTokenAccountBalance: (...a: unknown[]) => getTokenAccountBalance(...a),
  },
  CLUSTER: 'mainnet-beta',
  RPC_ENDPOINT: 'http://mock',
}));

import { readWalletUsdcUi } from '@/services/solana/vaultV2';

const OWNER = 'C5D95rPis3kw4Vpig3A3fUFryA1FNzSLRbAQG7uLKkkB';

describe('readWalletUsdcUi', () => {
  beforeEach(() => { getAccountInfo.mockReset(); getTokenAccountBalance.mockReset(); });

  it('returns "0" when the ATA does not exist (fresh embedded wallet)', async () => {
    getAccountInfo.mockResolvedValue(null);
    await expect(readWalletUsdcUi(OWNER)).resolves.toBe('0');
    expect(getTokenAccountBalance).not.toHaveBeenCalled();
  });

  it('returns the balance when the ATA exists', async () => {
    getAccountInfo.mockResolvedValue({ data: Buffer.alloc(0) });
    getTokenAccountBalance.mockResolvedValue({ value: { uiAmountString: '12.5' } });
    await expect(readWalletUsdcUi(OWNER)).resolves.toBe('12.5');
  });

  it('returns null on RPC failure (unknown, not zero)', async () => {
    getAccountInfo.mockRejectedValue(new Error('429'));
    await expect(readWalletUsdcUi(OWNER)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`'0'` case returns `null` today): `npx vitest run __tests__/services/onramp/readWalletUsdcUi.test.ts`
- [ ] **Step 3: Implement** — in `readWalletUsdcUi`, before `getTokenAccountBalance`: `const info = await connection.getAccountInfo(ata); if (!info) return '0';` keep the catch → `null`. Update the doc comment (ATA absent ⇒ '0', RPC fail ⇒ null).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `fix(deposit): read a missing USDC ATA as $0, not unknown`

### Task 2: `computeOnrampAmount`

**Files:**
- Create: `web-app/services/onramp/computeOnrampAmount.ts`
- Test: `web-app/__tests__/services/onramp/computeOnrampAmount.test.ts`

**Interfaces:**
- Produces: `computeOnrampAmount(deficitUsdc: number): number`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeOnrampAmount } from '@/services/onramp/computeOnrampAmount';

describe('computeOnrampAmount', () => {
  it('throws on zero, negative, and non-finite deficits', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() => computeOnrampAmount(bad)).toThrow();
    }
  });
  it('floors at $10 so top-ups are never fee-dominated', () => {
    expect(computeOnrampAmount(0.5)).toBe(10);
    expect(computeOnrampAmount(6)).toBe(10);
  });
  it('uses +$2 under the $20 crossover, 10% above', () => {
    expect(computeOnrampAmount(10)).toBe(12);   // 10+2 > 11
    expect(computeOnrampAmount(20)).toBe(22);   // equal at 22
    expect(computeOnrampAmount(50)).toBe(55);   // 55 > 52
  });
  it('ceils fractional results', () => {
    expect(computeOnrampAmount(30.5)).toBe(34); // 33.55 → 34
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).
- [ ] **Step 3: Implement**

```ts
/**
 * USDC amount to prefill in the funding modal for a given shortfall.
 * Buffer (max of +$2 / +10%) guards provider minimums and fee treatment;
 * the $10 floor keeps re-offer top-ups from being purchases where fixed
 * card fees (~$4) rival the value received. Deficit ≤ 0 is a caller bug —
 * the button must never render without a real shortfall.
 */
export function computeOnrampAmount(deficitUsdc: number): number {
  if (!Number.isFinite(deficitUsdc) || deficitUsdc <= 0) {
    throw new Error(`computeOnrampAmount: deficit must be a positive finite number, got ${deficitUsdc}`);
  }
  return Math.max(10, Math.ceil(Math.max(deficitUsdc + 2, deficitUsdc * 1.1)));
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(onramp): deficit-buffered prefill amount`

### Task 3: Funding breadcrumb

**Files:**
- Create: `web-app/services/onramp/fundingBreadcrumb.ts`
- Test: `web-app/__tests__/services/onramp/fundingBreadcrumb.test.ts`

**Interfaces:**
- Produces: `writeFundingBreadcrumb({address, amountUsdc})`, `readFundingBreadcrumb(): FundingBreadcrumb | null` (null once older than 30 min or unparseable), `clearFundingBreadcrumb()`; type `FundingBreadcrumb = { address: string; amountUsdc: number; initiatedAt: string }`.

- [ ] **Step 1: Failing test** — write/read round-trip; expiry (write with `initiatedAt` 31 min ago via injected `now`); clear; corrupted JSON → null; storage throwing → no crash (mirror `pendingEnroll.ts` swallow style).

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  writeFundingBreadcrumb, readFundingBreadcrumb, clearFundingBreadcrumb,
  FUNDING_BREADCRUMB_KEY,
} from '@/services/onramp/fundingBreadcrumb';

describe('fundingBreadcrumb', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a fresh breadcrumb', () => {
    writeFundingBreadcrumb({ address: 'Abc', amountUsdc: 12 });
    expect(readFundingBreadcrumb()).toMatchObject({ address: 'Abc', amountUsdc: 12 });
  });
  it('expires after 30 minutes', () => {
    localStorage.setItem(FUNDING_BREADCRUMB_KEY, JSON.stringify({
      address: 'Abc', amountUsdc: 12,
      initiatedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
    }));
    expect(readFundingBreadcrumb()).toBeNull();
  });
  it('clears', () => {
    writeFundingBreadcrumb({ address: 'Abc', amountUsdc: 12 });
    clearFundingBreadcrumb();
    expect(readFundingBreadcrumb()).toBeNull();
  });
  it('returns null on corrupted JSON', () => {
    localStorage.setItem(FUNDING_BREADCRUMB_KEY, '{nope');
    expect(readFundingBreadcrumb()).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** (try/catch around all storage ops; `readFundingBreadcrumb` validates shape + age). **Step 4: PASS.** **Step 5: Commit** `feat(onramp): funding breadcrumb against double card charges`

### Task 4: Register the Solana funding plugin

**Files:**
- Modify: `web-app/app/providers.tsx`
- Test: `web-app/__tests__/app/solanaFundingBridge.test.tsx`

**Interfaces:**
- Produces: exported `SolanaFundingBridge` component (renders null; calls `useSolanaFundingPlugin()`), mounted inside `PrivyProvider`.

- [ ] **Step 1: Failing test** — mock `@privy-io/react-auth/solana` with a spy `useSolanaFundingPlugin`; render `<SolanaFundingBridge />`; assert the spy was called.
- [ ] **Step 2: FAIL.** **Step 3: Implement** in providers.tsx:

```tsx
import { useSolanaFundingPlugin } from '@privy-io/react-auth/solana';

/** Privy v3 plugin architecture: funding UI is registered by calling this
 *  hook once inside the provider tree. Without it, fundWallet() no-ops. */
export function SolanaFundingBridge() {
  useSolanaFundingPlugin();
  return null;
}
```
Mount `<SolanaFundingBridge />` as first child inside `<PrivyProvider …>`.
- [ ] **Step 4: PASS.** **Step 5: Commit** `feat(onramp): register Privy solana funding plugin`

### Task 5: `useAddFunds` hook

**Files:**
- Create: `web-app/services/onramp/useAddFunds.ts`
- Test: `web-app/__tests__/services/onramp/useAddFunds.test.tsx`

**Interfaces:**
- Consumes: `computeOnrampAmount` (T2), `writeFundingBreadcrumb` (T3), `pickSignerWallet`/`missingSignerMessage` (existing), Privy `useFundWallet`.
- Produces: `useAddFunds(): { addFunds(a: { deficitUsdc: number; ownerAddress: string; wallets: readonly { address: string }[] }): Promise<boolean>; pending: boolean; error: string | null; clearError(): void }` — resolves `true` when the modal ran (exited), `false` when refused/failed pre-modal.

- [ ] **Step 1: Failing tests** (renderHook; mock `@privy-io/react-auth/solana` `useFundWallet`):
  - passes `{ address: owner }` and `options.amount === '12'` (string), `asset: 'USDC'`, `chain: 'solana:mainnet'` for deficit 10;
  - signer missing → returns false, sets `error` to `missingSignerMessage(owner)`, `fundWallet` NOT called, no breadcrumb;
  - breadcrumb written BEFORE `fundWallet` resolves;
  - `fundWallet` rejection → `pending` false, `error` = "Couldn't open funding — try again.", returns false;
  - `pending` true while the (unresolved) `fundWallet` promise is open, false after resolve.
- [ ] **Step 2: FAIL.** **Step 3: Implement**

```ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFundWallet } from '@privy-io/react-auth/solana';
import { CLUSTER } from '@/services/solana/connection';
import { pickSignerWallet, missingSignerMessage } from '@/services/solana/pickSignerWallet';
import { computeOnrampAmount } from './computeOnrampAmount';
import { writeFundingBreadcrumb } from './fundingBreadcrumb';

const FUNDING_CHAIN = CLUSTER === 'mainnet-beta' ? 'solana:mainnet' : (`solana:${CLUSTER}` as const);
const WATCHDOG_GRACE_MS = 60_000;

export function useAddFunds() {
  const { fundWallet } = useFundWallet();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedAtRef = useRef<number | null>(null);

  // iOS standalone PWA can eat the modal-exit event during the provider/3DS
  // leg. If the page becomes visible again well after opening and the promise
  // never settled, revive the button rather than requiring a full reload.
  useEffect(() => {
    if (!pending) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const openedAt = openedAtRef.current;
      if (openedAt != null && Date.now() - openedAt > WATCHDOG_GRACE_MS) setPending(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pending]);

  const addFunds = useCallback(
    async ({ deficitUsdc, ownerAddress, wallets }: {
      deficitUsdc: number; ownerAddress: string; wallets: readonly { address: string }[];
    }): Promise<boolean> => {
      setError(null);
      const signer = pickSignerWallet(wallets, ownerAddress);
      if (!signer) { setError(missingSignerMessage(ownerAddress)); return false; }
      const amount = computeOnrampAmount(deficitUsdc);
      // Breadcrumb BEFORE the modal: PWA death during 3DS erases React state,
      // and a re-buy without this record can charge the card twice.
      writeFundingBreadcrumb({ address: ownerAddress, amountUsdc: amount });
      setPending(true);
      openedAtRef.current = Date.now();
      try {
        await fundWallet({
          address: ownerAddress,
          options: { asset: 'USDC', chain: FUNDING_CHAIN, amount: String(amount) },
        });
        return true;
      } catch {
        setError("Couldn't open funding — try again.");
        return false;
      } finally {
        setPending(false);
        openedAtRef.current = null;
      }
    },
    [fundWallet],
  );

  return { addFunds, pending, error, clearError: useCallback(() => setError(null), []) };
}
```

- [ ] **Step 4: PASS.** **Step 5: Commit** `feat(onramp): useAddFunds hook (signer-validated, breadcrumbed, watchdogged)`

### Task 6: Backend gas-stipend route

**Files:**
- Create: `backend/src/modules/wallet/routes.mjs`
- Modify: `backend/src/server.mjs` (import + `app.register(walletRoutes)` after `dripRoutes`)
- Test: `backend/tests/integration/api/gasStipend.test.mjs`

**Interfaces:**
- Consumes: `requireAccessAuth` (`plugins/auth.mjs`), `hasSolDripConfig`/`dripSolOnce`/`__setTransferSolForTests` (`lib/solDrip.mjs`), `HttpError` (`lib/errors.mjs`).
- Produces: `POST /v1/wallet/gas-stipend` → `{ status: 'dripped' | 'already_dripped' | 'cap_reached', signature?, lamports? }`; 401 unauthenticated; 503 unconfigured.

- [ ] **Step 1: Failing tests** (mirror `solDrip.test.mjs` setup: `createTestServer`, `__setTransferSolForTests`, and `getTestAuthHeaders(walletAddress)` from `tests/helpers/test-auth.mjs`):
  - 401 without a token;
  - drips to the SESSION wallet and ignores any `walletAddress` in the body (send a different address in the payload; assert the drip row is for the session wallet);
  - second call → `already_dripped`, transfer called once;
  - `hasSolDripConfig()` false (unset worker key via appConfig override) → 503 `GAS_STIPEND_UNCONFIGURED`.
- [ ] **Step 2: FAIL** (route 404). **Step 3: Implement**

```js
import { HttpError } from '../../lib/errors.mjs';
import { requireAccessAuth } from '../../plugins/auth.mjs';
import { hasSolDripConfig, dripSolOnce } from '../../lib/solDrip.mjs';

// Gas stipend (onramp spec 2026-07-29): the SOL leg of fiat onboarding until
// the gasless relay ships. Thin authed wrapper over lib/solDrip.mjs — all
// money logic (idempotency, global cap, fail-closed ordering) lives there.
// The dripped address is ALWAYS the authenticated session wallet; no request
// parameter exists, so the drip cannot be aimed at an arbitrary address.
export async function walletRoutes(app) {
  app.post(
    '/v1/wallet/gas-stipend',
    {
      preHandler: requireAccessAuth,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request) => {
      if (!hasSolDripConfig()) {
        throw new HttpError(503, 'Gas stipend is not available.', 'GAS_STIPEND_UNCONFIGURED');
      }
      return dripSolOnce(request.auth.walletAddress);
    },
  );
}
```

- [ ] **Step 4: PASS** (`cd backend && npx vitest run tests/integration/api/gasStipend.test.mjs`). **Step 5: Commit** `feat(api): authed gas-stipend endpoint wrapping the sol-drip lib`

### Task 7: Frontend stipend client

**Files:**
- Create: `web-app/services/onramp/gasStipend.ts`
- Test: `web-app/__tests__/services/onramp/gasStipend.test.ts`

**Interfaces:**
- Consumes: `httpRequest` (`services/api/httpClient.ts`; `RequestOptions = { method?, body?, token?, signal?, timeoutMs? }`).
- Produces: `requestGasStipend(token: string): Promise<{ status: 'dripped' | 'already_dripped' | 'cap_reached' }>`.

- [ ] **Step 1: Failing test** — mock `@/services/api/httpClient`; assert path `/v1/wallet/gas-stipend`, `method: 'POST'`, token passthrough.
- [ ] **Step 2: FAIL.** **Step 3: Implement**

```ts
import { httpRequest } from '@/services/api/httpClient';

export type GasStipendStatus = 'dripped' | 'already_dripped' | 'cap_reached';

export function requestGasStipend(token: string): Promise<{ status: GasStipendStatus }> {
  return httpRequest('/v1/wallet/gas-stipend', { method: 'POST', token });
}
```

- [ ] **Step 4: PASS.** **Step 5: Commit** `feat(onramp): gas-stipend client`

### Task 8: `DepositFormV2` — Add-funds button

**Files:**
- Modify: `web-app/components/v2/DepositFormV2.tsx`
- Test: `web-app/__tests__/components/depositFormV2Funding.test.tsx`

**Interfaces:**
- Consumes: existing `Props`; `readFundingBreadcrumb` (T3).
- Produces: three new optional props consumed by DepositV2 (T9):
  `onAddFunds?: (deficitUsdc: number) => void`, `fundingPending?: boolean`, `fundingNotice?: string | null`.

Behavior (all inside the existing insufficiency branch — `validationError === 'You have $X USDC'` case):
- Button `data-testid="v2-add-funds"` renders when: `onAddFunds` provided ∧ `walletBalanceUi != null` ∧ `numericAmount > Number(walletBalanceUi)` ∧ amount within `MIN_UI..MAX_UI` ∧ `numericAmount ≤ GLOBAL_CAP_UI − currentTvlUi`.
- Capacity short → `data-testid="v2-capacity-blocked"` copy: "Beta capacity is nearly full — locking this amount isn't possible right now." (no button).
- Disabled while `fundingPending`.
- Fresh breadcrumb (readFundingBreadcrumb() non-null) → first tap swaps to `data-testid="v2-funding-confirm"`: "A purchase may still be on its way — buying again can charge your card twice." + "Buy anyway" button that calls `onAddFunds`.
- `fundingNotice` string renders under the button (`data-testid="v2-funding-notice"`).
- Tap → `onAddFunds(numericAmount − Number(walletBalanceUi))`.

- [ ] **Step 1: Failing tests** — render with `walletBalanceUi: '0'`, amount typed `10`, `currentTvlUi: 10`, spy `onAddFunds`: button shows, click → called with `10`; hidden when balance `null`; hidden without `onAddFunds`; disabled when `fundingPending`; capacity case (`currentTvlUi: 995`) shows blocked copy, no button; breadcrumb present → confirm gate before spy fires; notice renders.
- [ ] **Step 2: FAIL.** **Step 3: Implement.** **Step 4: PASS.** **Step 5: Commit** `feat(onramp): add-funds CTA in the deposit form (capacity + double-charge gates)`

### Task 9: `DepositV2` — wiring (stipend + funding flow + balance-driven exit)

**Files:**
- Modify: `web-app/app/onboarding/deposit/DepositV2.tsx`
- Test: `web-app/__tests__/components/depositV2Funding.test.tsx`

**Interfaces:**
- Consumes: `useAddFunds` (T5), `requestGasStipend` (T7), `readWalletUsdcUi` (T1), `clearFundingBreadcrumb` (T3), `fetchWithAuth` (existing), new DepositFormV2 props (T8).

Behavior:
- **Auto-stipend:** effect when `solGate.status === 'insufficient'` ∧ authenticated: call `fetchWithAuth(requestGasStipend)` once per mount (ref guard). `'dripped'` → `setSolGateTick((t) => t + 1)` (gate re-reads; passes → form renders). `already_dripped` → no-op (user genuinely spent their stipend; gate copy stands). `cap_reached`/error/503 → no-op (gate copy stands). Never throws to the UI.
- **handleAddFunds(deficit):** `const ran = await addFunds({ deficitUsdc: deficit, ownerAddress: walletAddress, wallets: solanaWallets })`; if `ran`: single `readWalletUsdcUi(walletAddress)` re-read → `setWalletBalanceUi(next)`; if `next` covers the last-typed amount → `clearFundingBreadcrumb()`, `fundingNotice = null`; if improved-but-short or unchanged → `fundingNotice = "Funds can take a few minutes to arrive — check again shortly."` plus keep breadcrumb.
- **Check again for funds:** while `fundingNotice` set, a `visibilitychange`→visible listener does one balance re-read (same cover/clear logic). The notice area includes a "Check again" affordance: reuse the notice text + a small button `data-testid="v2-funding-check-again"` that runs the same re-read.
- Pass `onAddFunds={handleAddFunds}`, `fundingPending={pending}`, `fundingNotice={fundingNotice ?? addFundsError}` to `DepositFormV2`.

- [ ] **Step 1: Failing tests** — mock `useAddFunds`, `requestGasStipend`, `readWalletUsdcUi`, solGate reads:
  - sol-insufficient + authed → stipend called once; `dripped` → gate re-check triggered;
  - stipend cap_reached → gate card remains, no crash;
  - add-funds flow: exit + covered balance → breadcrumb cleared, no notice; exit + unchanged → notice set; check-again button re-reads.
- [ ] **Step 2: FAIL.** **Step 3: Implement.** **Step 4: PASS + run the full existing deposit test files.** **Step 5: Commit** `feat(onramp): deposit flow funding wiring + auto gas stipend`

### Task 10: Full verification + ship

- [ ] `cd web-app && npx tsc --noEmit` — clean.
- [ ] `cd web-app && npx vitest run` — all green.
- [ ] `cd backend && npx vitest run` — all green.
- [ ] `cd web-app && npm run build` — clean production build.
- [ ] Commit any stragglers; push `master` (Vercel + Render auto-deploy).
- [ ] Hand the user the manual launch checklist:
  1. Privy dashboard → funding: enable, asset USDC on Solana mainnet, ≥1 card provider visible; record enabled methods.
  2. Confirm Render deploy picked up the new route (`POST /v1/wallet/gas-stipend` 401s without a token — curl check).
  3. Smoke on installed iOS PWA + once on Android: Google login → deposit screen → auto-stipend lands 0.005 SOL → lock $10 → Add funds prefills $12 → real card buy (~$13-14 fiat) → balance appears (Check again) → deposit succeeds.
