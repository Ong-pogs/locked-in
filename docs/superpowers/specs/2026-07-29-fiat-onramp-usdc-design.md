# Fiat → USDC Onramp (Privy-native) — Design

**Date:** 2026-07-29 (rev 2 after 3-lens adversarial review)
**Status:** approved-pending-user-review
**Scope owner:** web-app (frontend) + one tiny backend touch (see SOL stopgap)

## Problem

Google-login users get a Privy embedded Solana wallet and land on the deposit
screen with $0 USDC and $0 SOL — no in-app way to acquire the $10–$50 USDC a
lock requires. Phantom users can also run short mid-flow. Today the pre-tx
form shows "You have $X USDC" and a disabled CTA (DepositFormV2), and a 0-SOL
wallet is stopped earlier by the SOL gate card (DepositV2 renders the gate
*instead of* the form). There is no funding action anywhere.

Decision from brainstorming: unblock Google-login users first; the same
button serves Phantom users short on USDC.

## Explicit non-goals (separate spec)

- **Gasless relay / fee sponsorship** (user's chosen end-state for SOL fees).
  Security-sensitive net-new infra (`LOCK_VAULT_RELAY_ENABLED` is a dead env
  var nothing reads; the only existing "relay" is the community-pot keeper,
  which submits the backend's own txs). Gets its own spec.
- No on-chain program changes. No DB schema changes.

## The SOL problem this spec MUST NOT ignore (review blocker)

Selling USDC into a wallet that cannot pay fees strands real card money: the
user pays ~4-5% card fees, then reads "send 0.005 SOL from an exchange" —
which a fiat-first Google user does not have.

**Resolution (user decision 2026-07-29): drip stopgap.** A new thin authed
endpoint `POST /v1/wallet/gas-stipend` (JWT auth; wallet must equal the
session wallet; standard rate limiting) invokes the existing drip logic
(`dripSolOnce` — same code the mounted-but-never-called
`/v1/internal/sol-drip` route uses) to send 0.005 SOL, once per wallet,
global cap 200 wallets, ~$0.10 total worst case. The frontend calls it when
the user initiates funding (or lands on the deposit screen) with an
embedded wallet whose SOL is below the gate. Idempotency, cap accounting,
and fail-closed behavior are already implemented and tested in
`backend/src/lib/solDrip.mjs`; the endpoint is a wrapper, not new money
logic. Responses `dripped` / `already_dripped` are success for the UX;
`cap_reached` leaves the SOL gate's existing honest copy in place.

This is an explicit **stopgap**: the gasless relay spec, when it ships,
becomes the end-state and the stipend endpoint can be retired (or kept as a
belt-and-suspenders onboarding path). With the stipend in place, the buy CTA
may render for embedded 0-SOL wallets — the stipend request fires first, so
by the time USDC arrives the wallet can transact.

## Approach (chosen) and alternatives

**Chosen: Privy-native funding** — `useFundWallet` from
`@privy-io/react-auth/solana` (`^3.18` declared, **3.21.2 installed** — all
type claims verified against 3.21.2). Privy hosts the modal and provider
integrations (MoonPay, Coinbase Onramp, bank, exchange transfer). We hold no
provider keys, run no fiat backend, inherit Privy's KYC/geo handling.

Verified API surface (3.21.2):
- `useSolanaFundingPlugin()` — must be registered once in the provider tree.
- `useFundWallet(callbacks?)` → `fundWallet({ address, options?: SolanaFundingConfig }): Promise<void>`.
  **No result object.** The only completion signal is the
  `onUserExited({ address, fundingMethod, chain, balance })` callback, which
  fires on ANY modal close and reports the wallet's post-exit `balance`
  (bigint, funded asset units) when available.
- `SolanaFundingConfig = { chain?, amount?: string, defaultFundingMethod?,
  card?.preferredProvider?, uiConfig?, asset?: 'native-currency' | 'USDC' }`.

Because there is no success/cancel status, the flow is **balance-driven**:
one flow for every modal exit, outcome decided by reading the wallet.

Rejected alternatives: direct MoonPay SDK (own keys + URL-signing backend +
KYC contract), direct Coinbase Onramp (same, single provider). Privy-native:
zero keys, zero fiat backend, already paid for.

## Architecture (6 units)

1. **Privy dashboard config (not code).** Enable funding; asset USDC on
   Solana mainnet. Launch checklist (manual — not preflightable):
   **MUST** have ≥1 card provider enabled and visible in the modal;
   SHOULD enable bank/exchange if the plan allows; record which methods were
   live at launch.

2. **`app/providers.tsx`** — register `useSolanaFundingPlugin()` (one-line
   inner component, per Privy v3 plugin architecture). Owned here explicitly
   because forgetting it fails the whole feature at runtime; unit test
   asserts the plugin hook is invoked in the provider tree.

3. **`web-app/services/onramp/computeOnrampAmount.ts`** — pure.
   `computeOnrampAmount(deficitUsdc: number): number`:
   - Domain: caller passes deficit > 0; inputs ≤ 0 or non-finite throw (a
     caller bug, never a prefill of NaN).
   - Returns `max(10, ceil(max(deficit + 2, deficit * 1.10)))`. The $10
     floor keeps re-offer top-ups from being fee-dominated micro-purchases
     (fixed card fees ~$4 would rival a $2 buy).
   - Denomination note: Privy's `amount` with `asset: 'USDC'` is the USDC
     (receive) amount per the typing; the buffer guards provider minimums,
     rounding/slippage, and the possibility some providers treat it as
     spend. **Implementation must verify against the live modal during the
     smoke test and adjust the buffer comment to what is observed.**

4. **`web-app/services/onramp/useAddFunds.ts`** — the only file that knows
   Privy funding exists. Exposes `{ addFunds(deficitUsdc), pending }`.
   `addFunds`:
   - Resolves the signer exactly like the deposit does:
     `pickSignerWallet(solanaWallets, walletAddress)`. **If null → refuse:**
     surface `missingSignerMessage(walletAddress)`, never fall back to
     `wallets[0]` or an unvalidated store string (the 4100 claim-mismatch
     bug class). Unit test asserts `fundWallet` is NOT called on null.
   - Writes a funding breadcrumb to localStorage
     (`{ address, amount, initiatedAt }`) BEFORE opening the modal (same
     rationale as the deposit flow's `writePendingEnroll`: iOS PWA death
     during the 3DS/provider leg erases React state).
   - Wraps `fundWallet` in try/catch → any pre-modal rejection clears
     `pending`, shows neutral "couldn't open funding — try again" copy.
   - `pending` watchdog: if the promise hasn't settled and the page regains
     visibility after a grace period (~60 s), clear `pending` so the button
     revives without a reload (iOS standalone PWA can eat the exit event).

5. **`components/v2/DepositFormV2.tsx` integration** (the real anchor — the
   pre-tx insufficiency signal `numericAmount > Number(walletBalanceUi)`
   lives here; DepositV2 has no such branch).
   - **Balance semantics fix (blocker):** `readWalletUsdcUi` returns `null`
     for BOTH "ATA absent" and "RPC failed". Add a v2-safe variant (or fix
     in place): ATA-absent → `'0'`; RPC failure → `null`. A fresh embedded
     wallet is exactly the ATA-absent case — it must read as $0, not
     unknown. When balance is `null` (genuinely unknown), the Add-funds
     button does NOT render — never prefill a card purchase off an unknown
     balance.
   - Render "Add funds" when `deficit = amount − balance > 0` AND
     remaining beta capacity fits: `amount ≤ GLOBAL_CAP_UI − currentTvlUi`
     (data already on the page). If capacity is short, show "beta capacity
     is nearly full" copy instead of selling USDC for a lock that will
     reject on-chain. For an embedded wallet below the SOL gate, the
     gas-stipend request (Unit 6) fires before/alongside the funding modal
     so the wallet can transact by the time USDC lands; on `cap_reached`
     the SOL gate's existing copy stands and the buy CTA is suppressed.
   - Button disabled while `pending`. If a breadcrumb younger than ~30 min
     exists, tapping again first shows "a purchase may still be on its way —
     buying again can charge your card twice", requiring explicit confirm.
   - **After modal exit (single balance-driven flow, no status):** perform
     one immediate balance re-read.
     - Balance covers the amount → clear state, CTA enables, breadcrumb
       cleared.
     - Balance improved but still short → deficit recomputes, button
       re-offers the remainder (min $10 prefill).
     - Balance unchanged → return to the form silently (covers cancel).
     - Then show a manual **"Check again"** action + one automatic re-read
       on `visibilitychange` refocus — the same pattern the SOL gate uses
       (`solGateTick`), instead of a poll state machine. Card settlements
       (first-time KYC + 3DS) routinely take 10-30 min; a passive "funds can
       take a few minutes — check again shortly" note stays until the
       balance covers the deficit. Breadcrumb expires after 30 min.

6. **`backend/src/modules/wallet/gasStipend.mjs`** (route) — the drip
   stopgap. `POST /v1/wallet/gas-stipend`: requires the standard user JWT;
   the dripped address is ALWAYS the authenticated session wallet (taken
   from the JWT claim, never from the request body — no parameter at all,
   so no one can aim the drip at an arbitrary address); standard
   @fastify/rate-limit; delegates to `dripSolOnce` from `lib/solDrip.mjs`
   (idempotent, 200-wallet cap, fail-closed — all pre-existing and tested).
   Returns `{ status: 'dripped' | 'already_dripped' | 'cap_reached' }`.
   The internal scheduler-key route stays as is.

Boundaries: the form knows nothing about providers; the hook knows nothing
about deposit UI; the amount function is pure; providers.tsx owns plugin
registration; the stipend route owns no money logic (wrapper over the
tested drip lib). Swapping providers touches only the dashboard.

## Data flow

```
DepositFormV2 (lock $X)
  ├─ balance = readWalletUsdcUiV2()   // ATA absent ⇒ '0', RPC fail ⇒ null
  ├─ deficit = X − balance            // only when balance != null
  └─ deficit > 0 ∧ capacity ok → [Add funds]
       ├─ (embedded ∧ SOL below gate → POST /v1/wallet/gas-stipend first;
       │   cap_reached/503 ⇒ suppress buy, SOL-gate copy stands)
       └─ useAddFunds.addFunds(deficit)
            ├─ signer = pickSignerWallet(...)  // null ⇒ refuse, no fallback
            ├─ breadcrumb → localStorage
            ├─ amount = computeOnrampAmount(deficit)
            └─ fundWallet({ address: signer, options:
                 { asset: 'USDC', chain: <verified literal>, amount } })
       └─ onUserExited / promise settle → single balance re-read
            ├─ covered   → CTA enabled, breadcrumb cleared
            ├─ improved  → re-offer remainder
            └─ unchanged → silent return; "Check again" + refocus re-read
```

USDC flows provider → user wallet directly. No custody. The chain identifier
literal (`'solana:mainnet'` vs CAIP-2 genesis-hash form) is verified against
the installed SDK during implementation — same treatment as the `amount`
denomination.

## Edge cases

| Case | Behavior |
| --- | --- |
| User cancels modal | Exit fires, balance unchanged → silent return |
| Bought but still short | Deficit recomputes; re-offer remainder (min $10) |
| Provider minimum above prefill | Provider modal surfaces its floor; user adjusts in-modal (accepted v1) |
| Region/KYC rejection | Provider UI owns it; our copy stays neutral |
| Balance read fails (RPC) | Button hidden (never buy off unknown balance); form otherwise unchanged |
| Fresh wallet, no USDC ATA | Reads as $0 → full-amount deficit → button shows (blocker fix) |
| Double-tap / re-buy while purchase in transit | `pending` disable + breadcrumb confirm gate |
| PWA killed during 3DS leg | Breadcrumb survives; on remount, confirm gate + "Check again" recover |
| `fundWallet` rejects pre-modal | Clear pending, neutral copy, button revives |
| No resolvable signer wallet | Refuse with `missingSignerMessage`; `fundWallet` never called |
| Beta TVL cap nearly full | Buy CTA replaced by capacity copy; no USDC sold for an impossible lock |
| Embedded user, 0 SOL | Gas stipend fires (JWT-bound wallet, once ever); buy proceeds. `cap_reached` → buy CTA suppressed, SOL-gate copy stands |
| Stipend endpoint 503 (drip unconfigured) | Same as cap_reached: suppress buy CTA, SOL gate copy stands — fail closed, never sell USDC into a frozen wallet |
| Phantom user short on USDC | Same button; `fundWallet` funds external addresses too |

## Testing

- **Unit (vitest, existing patterns):**
  - `computeOnrampAmount`: throws on ≤0/non-finite; $10 floor; +$2 vs 10%
    crossover at $20; ceil rounding.
  - `useAddFunds` (mocked `useFundWallet`): signer address passed; amount is
    a string; `pending` toggles; null signer → refuses, `fundWallet` not
    called; pre-modal rejection clears pending; breadcrumb written before
    modal, cleared on covered balance.
  - `DepositFormV2`: button renders only when deficit > 0 ∧ balance known ∧
    capacity ok; hidden on null balance; disabled while pending; exit +
    unchanged balance → no toast; exit + improved-but-short → re-offer;
    exit + covered → CTA enabled; breadcrumb confirm gate; refocus re-read
    (fake timers + simulated visibilitychange).
  - ATA-absent → `'0'` semantics of the balance reader.
  - Providers tree registers `useSolanaFundingPlugin`.
- **Backend integration tests** (existing solDrip test patterns):
  `/v1/wallet/gas-stipend` — 401 without JWT; drips to the SESSION wallet
  ignoring any body; second call → `already_dripped`; cap → `cap_reached`;
  unconfigured → 503. Frontend treats 503/cap as "suppress buy".
- **E2E exclusion (explicit):** the Privy modal is a hosted flow
  `NEXT_PUBLIC_E2E_TX_STUB` cannot stub; out of E2E scope.
- **Manual mainnet smoke (launch gate):** lock $10 with $0 USDC → expect
  prefill **$12**; complete a real card purchase (fiat total ~$13-14 with
  provider fees); verify USDC arrival, "Check again" pickup, then a
  successful deposit. **MUST be executed on an installed iOS PWA
  (standalone display mode) and once on Android** — the 3DS handoff/return
  path behaves differently there than on desktop.
- **Launch checklist:** dashboard funding config per Unit 1; denomination +
  chain-literal verification per Units 3/4.

## Risks / notes

- `SolanaFundingConfig.amount` doc-comment says "amount in SOL"; with
  `asset: 'USDC'` it is the USDC amount — verified in code during
  implementation and re-verified against the live modal in the smoke test.
- Provider fees/minimums vary by region; the buffer is a heuristic — the
  still-short re-offer path is the safety net.
- Privy funding availability is dashboard-plan dependent; fewer methods →
  fewer options in the modal. An entirely unconfigured plan is caught by the
  mandatory smoke test (fundWallet throw path shows neutral copy, button
  revives).
- `/v1/internal/sol-drip` is mounted and live in production behind the
  scheduler key — it has had no callers until now. The gas-stipend route is
  the drip logic's first real consumer (via `dripSolOnce`, not via HTTP to
  the internal route).
