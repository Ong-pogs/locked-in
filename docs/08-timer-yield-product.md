# Timer, Fire, and Yield Product State Machine (v4.0)

## Scope

User-visible lifecycle for lock timers, the fire timer, saver
consequences, and yield routing. No gauntlet (removed in v4.0).

## Per-course independence

Each active course has isolated state: lock timer, saver inventory, fuel
counter, fire timer, ichor balance, unclaimed yield. Nothing is shared
across simultaneous locks.

## Lifecycle

### Lock start

- lock timer starts at `lock_funds` confirmation
- 3 savers banked, fuel 0, fire out
- all mechanics active immediately (no gauntlet gate)

### Day-to-day

- complete a lesson → +1 fuel, +random 20-50 ichor, streak +1
- feed the fire in the Brewery → −1 fuel, +24h lit
- while lit, hourly harvests route yield to the user (minus saver
  redirect); while out, to the community pot
- claim unclaimed USDC yield any time from the Brewery

### Missed day

- saver available → consume one, streak preserved, redirect tier +1
  (10% → 15% → 20%)
- no savers → streak resets to 0, redirect stays at 20% cap, no lock
  extension
- buy a saver in the shop (500 ichor) to step the redirect back down

## Timer rules

`effective_unlock_ts = lock_end_ts`

(The on-chain `LockAccount` stores `lock_end_ts` once and never mutates it —
unlock is gated purely on it, and there is no on-chain extension field. The old
"no savers → +extension" penalty was removed in v4; a dormant `extension_days`
column survives in the off-chain DB but is never applied. Missed days penalize
yield only, never the lock.)

User can resurface (withdraw principal) when `now >= effective_unlock_ts`.

## Fire rules

- fuel feeds the fire: 1 fuel = 24h, additive
- fire lit ⇔ `now < fire_lit_until`
- no automatic burn; feeding is an explicit Brewery action

## Runtime scheduler (backend worker)

Per tick (every `RUNTIME_SCHEDULER_INTERVAL_MS`, default 15s):

- syncs runtime rows from live `LockAccount` custody state (fuel/fire/ichor
  stay off-chain authoritative — not overwritten)
- auto-creates `auto-harvest:*` receipts when a harvest interval is due,
  routing by fire + saver tier
- processes missed-day consequences (`deriveDueMiss` →
  `consumeSaverOrApplyFullConsequence`) via deterministic event keys

## Display requirements (per course)

- remaining lock time + resurface eligibility
- savers banked (0..3) and current redirect %
- fuel balance + fire countdown
- ichor balance
- unclaimed USDC yield + 7-day routing strip

## Messaging

- principal is always safe; consequence applies to yield routing only
- no lock extension or principal seizure under the v4 model
