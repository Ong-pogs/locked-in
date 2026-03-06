# Timer, Brewer, and Yield Product State Machine (v3.0)

## Scope

This spec defines user-visible lifecycle behavior for lock timers, gauntlet progression, brewer activity, and extension outcomes.

## Per-course Independence

Each active course has isolated state:

- lock timer
- gauntlet status
- saver inventory
- Fuel counter
- Brewer cycle
- Ichor accumulation
- extension total

No state is shared across courses.

## Lifecycle Phases

### Phase 1: Lock Start

- lock timestamp starts at `lock_funds` confirmation
- countdown timer begins immediately
- gauntlet is active (`Day 1`)

### Phase 2: Gauntlet (Day 1-7)

- no Ichor production
- no saver usage
- high consequence framing and disclosures

Gauntlet completion condition:

- seven required daily completions accepted by verification pipeline

### Phase 3: Post-gauntlet Activation (Day 8+)

On Day 8 unlock event:

- saver inventory is set to max (3)
- Brewer is allowed to run when Fuel is available
- Ichor production via yield harvesting becomes eligible
- Ichor Exchange becomes available

### Phase 4: Recovery and Consequences

If a day is missed:

- saver is consumed when available
- penalty tier advances (10%, then 20%, then 20%)
- saver recovery mode can activate
- Fuel earning pauses in recovery mode until saver inventory is full again

If no savers remain and another miss occurs:

- 100% yield redirection
- lock extension applied

Current implementation checkpoint:

- backend runtime state now tracks saver consumption, recovery mode, redirect bps, and extension days
- miss-day consequences are applied through an idempotent scheduler event key
- app UI can render remaining savers, redirect percent, and extension total from synced runtime state

## Timer Rules

Unlock timer is based on:

`effective_unlock_ts = base_lock_end_ts + extension_seconds_total`

User can resurface only when `now >= effective_unlock_ts`.

## Brewer Cycle Rules

- burn rate: `1 Fuel / 24h`
- Brewer active condition: `gauntlet_complete && fuel_counter > 0`
- if Fuel reaches zero, Brewer stops until Fuel is earned again

## Display Requirements

Per course UI must show:

- remaining lock time
- extension added so far
- gauntlet day/progress or completion state
- savers remaining (0..3)
- Fuel balance and next burn checkpoint
- current Ichor balance
- current penalty redirect state

## Messaging Requirements

Penalty messaging must be explicit:

- principal remains safe
- consequence applies to yield and time, not principal seizure
- extension reason and duration are shown in history/audit view
