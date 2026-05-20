# Yield Calculation and Display Spec (v4.0)

## Scope

Defines the yield math and how it routes to user vs community pot.

In the current phase, yield is a **real-rate simulation**: the live
Kamino USDC supply APY is read from mainnet and applied to devnet
principal. No funds are actually deposited into Kamino. "Claiming" yield
transfers devnet USDC from the treasury wallet to the user (Option 1 /
treasury-funded). Phase 3 will replace this with a real
`kamino_lending` deposit/withdraw CPI.

## Strategy profiles (backend/src/config.mjs)

- `fixed_apy_dev` — mock 8% APY, no RPC reads
- `kamino_surfpool` — local Surfpool mainnet fork (dev only)
- `kamino_devnet_demo` — **active in prod**. Reads live Kamino USDC
  mainnet APY via Helius, applies to devnet locks, hourly harvest
- `kamino_usdc_mainnet` — real mainnet path (not yet active)

When a profile is set it takes precedence over raw `YIELD_*` env fields,
except `YIELD_KAMINO_RPC_URL` (where the Helius key lives).

## Harvest math

At each harvest interval (hourly for `kamino_devnet_demo`):

```
gross_yield = principal × apyBps × elapsedSeconds / (10_000 × YEAR_SECONDS)
```

Where `apyBps` is the live Kamino USDC supply APY in basis points (e.g.
752 = 7.52%). Implementation: `computeQuotedYieldFromApy` in
backend/src/lib/yieldStrategy.mjs.

Important: `KaminoMarket.load()` must be passed the SDK's
`DEFAULT_RECENT_SLOT_DURATION_MS` (≈400ms). Passing a wrong slot duration
scales the APY by the same ratio (a past bug rendered 6.95% as 0.09%).

## Routing (split)

No platform fee in the active path. Split is purely fire + saver:

```
fire OUT  → redirected = gross           (100% pot)
fire LIT  → redirected = gross × redirect_bps / 10_000
            user_share = gross − redirected
            (redirect_bps = 0 / 1000 / 1500 / 2000 by saver tier)
```

Each harvest writes a `harvest_result_receipts` row with
`gross_yield_amount` and `redirected_amount`. User-side unclaimed yield =
`sum(gross − redirected) where claimed_at is null`.

## Claim

`POST /v1/progress/brewery/claim`:

1. lock the unclaimed receipts (SELECT FOR UPDATE), mark `claimed_at`
2. transfer the summed USDC from the treasury wallet to the user
   (`transferUsdcAtomic`)
3. on transfer failure, roll back `claimed_at` so the user can retry

Returns the Solana tx signature for the explorer link.

## UI metrics (Brewery + dashboard)

- fire state + countdown
- fuel balance / cap
- unclaimed yield (USDC) + claim button
- 7-day strip: per-day user vs pot split
- live APY chip (dashboard, from `/v1/yield/current-apy`)
- ichor balance + savers banked

## Safety rules

1. Display values are projections; on-chain/DB ledger is settlement.
2. Harvest quote failures (Kamino RPC) skip only that harvest; burn/miss
   scheduler work continues, falling back to last-cached APY.
