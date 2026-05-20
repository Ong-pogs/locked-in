# Fuel Spec (v4.0 — fire-timer model)

## Scope

Fuel powers the **fire** in the Brewery. While the fire burns, a locked
course's Kamino yield routes to the user's wallet. While it's out, that
yield routes to the community pot. Fuel is an internal off-chain counter
in `lesson.user_course_runtime_state` (the on-chain `LockAccount` also
carries a `fuel_counter` field, but the off-chain ledger is authoritative
in the current dev phase).

Fuel is non-transferable and non-tradeable. No SPL token, no mint, no
token account.

## Earn rules

- **+1 fuel per verified lesson completion.** No daily cap.
- Capped at `fuel_cap` (default 7).
- Failing a lesson (reward units 0) earns no fuel.

Because there's no daily cap, an active learner can binge several lessons
to bank a buffer of fire-days, then coast through travel or sick days.
Daily-habit pressure is enforced separately by the streak mechanic.

(The old fragment accumulator — 0.2-0.5 partial fuel per lesson, 1/day
cap — was removed in v4.0.)

## Burn rules (the fire timer)

- Feeding the fire consumes **1 fuel** and extends `fire_lit_until` by
  **24 hours**.
- Feeding while the fire is still lit **stacks** additively (6h left +
  feed = 30h left). Caps naturally at 7 × 24h since fuel caps at 7.
- The fire is "lit" at any moment `now < fire_lit_until`.
- There is no automatic daily burn. Feeding is an explicit user action in
  the Brewery.

## Yield routing (see also 05-yield-calculator, 04-tokenomics)

At each hourly harvest:

- fire **out** → 100% of that harvest's gross yield → community pot
- fire **lit** → split by saver tier (0/10/15/20% to pot, rest to user)

## Interaction with savers

Fuel and savers are separate resources:

- fuel powers the fire (yield routing to user)
- savers protect the streak on a missed day and lower the yield-redirect
  tier
- savers cannot be spent as fuel; fuel cannot restore savers
- savers are bought in the shop with ichor (see 04-tokenomics)

## UX requirements

- show current fuel balance and cap per course
- show fire state (burning + countdown, or out)
- show the yield-routing consequence of the current fire/saver state
- "Feed the Fire (−1 fuel, +24h)" action when fuel > 0
