# Tokenomics and Economic Rules (v4.0)

## Core economic model

Locked In uses commitment-based yield economics.

- Users lock stablecoin principal (`USDC`) for a preset duration (`14`,
  `30`, `45`, `60`, `90`, `180`, `365` days).
- Principal is never confiscated. Economic consequence applies to **yield
  routing**, not principal.
- Yield is sourced from the live Kamino USDC supply APY (read from
  mainnet, applied to devnet locks in the current phase — see
  05-yield-calculator).

## What changed from v3.0

The v3 model (fuel → ichor → USDC redemption, SKR catalyst boost, 7-day
gauntlet, platform fee) has been replaced:

- **Gauntlet: removed.** No 7-day onboarding lock. All mechanics fire
  from day 1.
- **SKR catalyst: removed.** Users only lock USDC.
- **Ichor → USDC redemption: removed.** Ichor is now a pure in-game shop
  currency, not a redemption counter.
- **Platform fee: 0%** in the active path (the on-chain splitter retains
  the capability, dormant).
- **Fire-timer model added.** Fuel feeds a 24h fire; fire state gates
  whether yield routes to the user or the pot.

## Asset roles

### Principal stablecoin (USDC)

- on-chain token movement, locked for the course duration
- always returned at resurface (subject to lock timer)

### Fuel

- internal counter; +1 per lesson, cap 7
- feeds the fire (24h per fuel) — see 03-fuel

### Ichor

- internal counter; **random 20-50 per lesson completion**
  (slot-machine reward)
- spent only in the shop. The one item today: **Streak Saver, 500 ichor**
- no conversion to USDC, no secondary market

## Yield routing (the core split)

At each hourly harvest of a locked course:

```
fire OUT (fire_lit_until <= now):
    100% of gross yield → community pot

fire LIT:
    redirect by saver tier:
      0 savers used (3 banked):  0% → pot, 100% → user
      1 saver used  (2 banked): 10% → pot,  90% → user
      2 savers used (1 banked): 15% → pot,  85% → user
      3 savers used (0 banked): 20% → pot,  80% → user
```

User-side yield accrues to an unclaimed pool. The user claims it to their
wallet from the Brewery (devnet: a real USDC transfer from the treasury
wallet — see 05-yield-calculator).

## Savers

- 3 savers per lock, all "banked" initially (0 used)
- a missed day consumes one saver: the streak is **preserved** and the
  redirect tier bumps up one notch
- once all 3 are used, a further missed day **resets the streak to 0**
  and the redirect stays at the 20% cap (no further escalation, no lock
  extension)
- a saver is restored by buying one in the shop for 500 ichor, which also
  steps the redirect tier back down

## Streak

- increments on daily lesson completion
- protected by savers; resets to 0 when savers are exhausted and a day is
  missed
- purely a status/leaderboard signal — no ichor multiplier, no yield
  effect

## Community pot

- accumulates all redirected yield (unlit days + saver-redirect shares)
- distributed monthly to active streakers, weighted by streak length and
  deposit size
- window keyed by UTC `YYYYMM`

## Invariants

1. Fuel and ichor are internal counters only; no secondary market.
2. Principal is never consumed by penalty flow.
3. Per-course economics are isolated across simultaneous locks.
4. Yield-routing consequences never touch principal.
