# Done: 08 Timer, Brewer, and Runtime Scheduling

## Scope Completed

This checkpoint established the first real runtime worker loop around a live `LockVault`.
The backend can now evaluate due runtime actions against on-chain lock state instead of trusting stale local state.

## What Was Implemented

### Runtime scheduler worker

- Added a polling runtime scheduler worker under `backend/src/workers/runtimeSchedulerWorker.mjs`.
- The worker starts and stops with the Fastify server lifecycle.
- Before scheduling anything, it reads the live `LockVault` account and syncs the runtime row from chain.
- The worker can now also auto-create fixed-APY `auto-harvest:*` receipts in dev mode.

### Deterministic automatic runtime ids

- The scheduler now derives deterministic ids for:
  - daily Fuel burns
  - missed-day consequence events
- This keeps scheduler work idempotent even if the worker is restarted or retried.

### Safe gauntlet handling

- The scheduler no-ops safely while a lock is still in gauntlet.
- It does not emit automatic burn receipts before Brewer use is actually eligible.
- It does not emit automatic miss receipts when a UTC day has not really been missed.

### Relay safety

- Burn and miss receipts now track relay lifecycle through:
  - `pending`
  - `publishing`
  - `published`
  - `failed`
- Burn receipts that are too early are not publishable into `LockVault`.

### App runtime sync

- App screens now refresh runtime or lock state when opened, so visible Fuel, savers, unlock state, and Ichor numbers stay aligned with backend/on-chain truth.
- This removed stale UI cases after reconnects, misses, and live lock reads.

## Main Files

- `backend/sql/0009_runtime_receipt_publish_status.sql`
- `backend/src/server.mjs`
- `backend/src/workers/runtimeSchedulerWorker.mjs`
- `backend/src/workers/lockVaultRelayWorker.mjs`
- `backend/src/lib/lockVault.mjs`
- `backend/src/modules/progress/repository.mjs`
- `backend/src/modules/progress/routes.mjs`
- `src/screens/main/ProfileScreen.tsx`
- `src/stores/courseStore.ts`
- `src/navigation/AppNavigator.tsx`
- `src/navigation/OnboardingStack.tsx`

## Verified Outcomes

- The runtime scheduler worker was verified to no-op safely against the live devnet lock while nothing was due.
- After adding the fixed-APY adapter path, the worker created and published a real automatic harvest:
  - `auto-harvest:FRXsCB...:solana-fundamentals:1772877300`
- Automatic work did not misfire during gauntlet.
- Relay workers correctly rejected pre-lock completion history instead of mutating the live lock.
- App reconnect now returns to the existing locked course flow instead of incorrectly showing the deposit screen again.
- Live profile/runtime screens now show the real lock state after refresh.
- The user can now see recent harvest receipts in `Ichor Shop` instead of relying only on backend logs.

## Remaining Follow-up

- Add production scheduler cadence and deployment wiring beyond the current in-process worker.
- Add a real history/audit surface for automatic burns, misses, and extensions.
- Settle redirected yield into the monthly `CommunityPot` flow.
