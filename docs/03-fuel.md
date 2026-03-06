# Fuel Counter Spec (v3.0)

## Scope

Fuel powers the Brewer.
Fuel is an on-chain integer counter in each course `LockAccount`.
Fuel is not an SPL token.

## Canonical Representation

- Field: `fuel_counter: u16`
- Storage location: `LockAccount`
- Non-transferable and non-tradeable by design
- No mint authority
- No token account
- No token transfer instruction

Current implementation checkpoint:

- off-chain course state now carries `fuelCounter`, `fuelCap`, `lastFuelCreditDay`, and `lastBrewerBurnTs`
- UI now exposes Fuel balance, cap, earn status, next burn timestamp, and zero-Fuel brewer stopped state
- backend now computes at most `1 Fuel / day / course` after verified completion and syncs that snapshot back to the app
- Fuel can be earned during gauntlet, but Brewer remains locked until gauntlet completion
- backend now exposes an idempotent daily burn path keyed by scheduler `cycleId`
- each burn attempt writes a receipt row so replaying the same cycle cannot double-burn Fuel

## Earn Rules

Fuel credits are applied only after verified lesson completion.

Canonical earn constraints:

1. max 1 full Fuel per day per course lock
2. fractional lesson rewards may accumulate toward full Fuel
3. earning is paused when saver recovery mode is active
4. earning resumes only when saver inventory is restored to max (3)
5. Fuel balance cannot exceed configured cap (`7..14`)

## Burn Rules

- Brewer consumes 1 Fuel every 24 hours while active.
- If `fuel_counter` reaches 0, Brewer stops.
- Fuel burn is deterministic and scheduler-safe (idempotent cycle key).

## Interaction With Savers

Fuel and savers are separate resources:

- savers protect streak continuity when a day is missed
- Fuel powers brew cycles
- savers cannot be spent as Fuel
- Fuel cannot restore savers

During saver recovery:

- Fuel earning paused
- existing Fuel buffer can continue to burn
- prolonged recovery can eventually stop the Brewer

## Required On-chain Guards

1. Credit instruction enforces per-day cap server-side/on-chain.
2. Burn instruction enforces single-cycle execution per 24h window.
3. Counter operations use checked arithmetic.
4. Unauthorized signers cannot mutate Fuel.

## UX Requirements

- display current Fuel balance per course
- display cap and daily earn status
- display next burn timestamp
- clearly show Brewer stopped state when Fuel is zero
