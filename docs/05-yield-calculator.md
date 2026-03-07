# Yield Calculation and Display Spec (v3.0)

## Scope

This spec defines the canonical yield math shown to users and the on-chain accounting source of truth.

Display values are projections unless backed by harvested on-chain data.
Settlement is determined by on-chain program state.

Current implementation checkpoint:

- `LockVault` now includes a worker-only `apply_harvest_result(...)` instruction
- backend can queue and publish manual harvest receipts into the live devnet lock
- a first `YieldSplitter` Anchor program now exists in the workspace with:
  - protocol config
  - idempotent harvest split receipts
  - canonical split math tests
- backend harvest receipts now track a separate `yield_splitter_status`
- backend now exposes a dedicated publish route for the split step before `LockVault`:
  - `POST /v1/internal/yield-splitter/yield/harvest/publish`
- backend now includes a fixed-APY strategy adapter for devnet/runtime testing
- backend now also supports a second strategy kind, `kamino_klend_reserve_v1`, which reads a live Kamino reserve supply APY and feeds that rate into the existing harvest math
- the Kamino adapter reads APY from a separate configured RPC path, so devnet lock/testing can still reference a mainnet Kamino rate source
- backend config now also supports one-line strategy profiles:
  - `fixed_apy_dev`
  - `kamino_usdc_mainnet`
- when a strategy profile is set, it takes precedence over the raw `YIELD_*` strategy env fields
- the runtime scheduler worker can now auto-create deterministic `auto-harvest:*` receipts
- a positive devnet harvest has already credited real `ichor_counter` and `ichor_lifetime_total`
- the mobile `Ichor Shop` now reads live on-chain Ichor state and redemption tier
- the mobile `Ichor Shop` now also reads backend harvest history and summary totals
- the redirected-yield share from a published harvest can now be relayed into the live `CommunityPot` program
- the mobile `Community Pot` screen now reads the live current-month pot balance on-chain
- full-redirect harvest math now uses the canonical rule:
  - `100% redirect` sends all gross yield to redirect
  - no platform fee is taken in that branch
  - user share stays `0`

## Inputs

Per course lock:

- `principal_amount`
- lock start/end timestamps
- realized strategy yield from Kamino/Marginfi
- `savers_remaining` and active penalty tier
- `skr_tier`
- Brewer active status (`gauntlet_complete && fuel_counter > 0`)

Protocol inputs:

- platform fee percentage (10-20%)
- conversion tier table

## Harvest and Split Sequence

At each yield harvest interval:

1. compute `gross_yield_harvested`
2. apply platform fee
3. apply saver penalty redirect share to community pot
4. compute user share remainder
5. if Brewer active, convert user share to Ichor counter increment
6. if Brewer inactive, user share does not mint Ichor for that cycle

Current auto-harvest note:

- the first strategy adapter uses fixed APY math for devnet verification
- the second adapter kind keeps the same receipt/relay pipeline but swaps the APY source to a configured Kamino reserve
- harvest quote failures from the Kamino read path now skip only that harvest and do not stop burn/miss scheduler work
- it collapses missed time into one deterministic catch-up harvest instead of backfilling many small periods

Full-redirect edge case:

- if penalty redirect is `100%`, then:
  - platform fee is `0`
  - redirected share is the full gross harvest
  - user share is `0`

## Penalty Application

Penalty is based on saver-consumption sequence.

- first saver event: 10% redirect
- second saver event: 20% redirect
- third saver event: 20% redirect
- no savers left miss: 100% redirect and lock extension

## SKR Multiplier Application

SKR boost applies to Ichor output for eligible user share:

`ichor_output = base_ichor_from_user_share * skr_multiplier`

Where `skr_multiplier` is one of:

- `1.00`
- `1.02`
- `1.05`
- `1.10`

## UI Metrics

Per course, UI should show:

- gross yield accrued (historical)
- redirected yield total (community penalties)
- platform fee total
- current Ichor balance (`ichor_counter`)
- projected daily equivalent yield under current APY assumptions
- active conversion tier and quote
- recent harvest receipts with audit status

## Ichor Exchange Quote Logic

Given requested `ichor_amount`:

1. determine conversion tier from `ichor_lifetime_total`
2. compute `usdc_out = ichor_amount / 1000 * tier_rate`
3. enforce max redeemable `ichor_amount <= ichor_counter`
4. execute atomic redeem (debit Ichor, release stablecoin)

Ichor Exchange is available any time after gauntlet completion.

## Timing and Interpolation

Real yield may harvest at discrete intervals.
UI may interpolate between harvest checkpoints for smooth display, but must label interpolated values as estimate.

## Safety Rules

1. Calculator display cannot be used as settlement authority.
2. Any discrepancy resolves in favor of on-chain account state.
3. Exchange preview must include exact tier rate used at quote time.
