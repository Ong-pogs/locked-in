# Done: 03 Fuel

## Scope Completed

This checkpoint established the off-chain runtime model for Fuel, Brewer burn cycles, and saver consequences.
It also removed the old `M Tokens` user-facing path so the app reflects the v3 resource model.

## What Was Implemented

### Canonical Fuel runtime state

- Per-wallet, per-course runtime is now stored in `lesson.user_course_runtime_state`.
- Runtime includes streak, gauntlet, Fuel, saver, redirect, and extension fields.
- App course state now hydrates and persists the matching Fuel/runtime fields locally.

### Fuel UI and state sync

- `Inventory` now shows Fuel balance, cap, earn status, and next burn timestamp.
- `Profile` now shows Fuel and saver state instead of legacy `M Tokens`.
- `Streak Status`, `Profile`, `Inventory`, and `Community Pot` now refresh runtime from the backend on focus.
- `Alchemy` and brewing flows now read from per-course Fuel state.

### Legacy economy cleanup

- User-facing `M Tokens` were removed from the v3 learning/brewing flow.
- Brewer gating now depends on Fuel and gauntlet status, not the legacy global token store.

### Fuel earn rules

- Accepted verified lesson completions now update course runtime server-side.
- Backend awards at most `1 Fuel / day / course`.
- Fuel can be earned during gauntlet.
- Brewer remains locked until gauntlet completion.
- Fuel earning pauses during saver recovery.

### Fuel burn rules

- Daily burn cycles are handled by `POST /v1/internal/fuel/burn`.
- Burn execution is idempotent by scheduler `cycleId`.
- Every burn attempt writes a `lesson.fuel_burn_cycle_receipts` row.
- Post-gauntlet burn decrements Fuel and records `lastBrewerBurnTs`.

### Saver consequence rules

- Miss-day consequences are handled by `POST /v1/internal/consequences/miss`.
- Miss handling is idempotent by `missEventId`.
- First three misses consume savers and move redirect to `10%`, `20%`, and `20%`.
- Saver recovery mode pauses Fuel earning until saver inventory is restored.
- After savers are exhausted, the backend applies full consequence:
  - `100%` redirect
  - streak reset
  - extension days added

## Main Schema and API Changes

- `backend/sql/0005_user_course_runtime_state.sql`
- `backend/sql/0006_fuel_burn_cycle_receipts.sql`
- `backend/sql/0007_saver_consequence_runtime.sql`
- `GET /v1/progress/runtime/courses/:courseId`
- `POST /v1/internal/fuel/burn`
- `POST /v1/internal/consequences/miss`

## Main App and Backend Files

- `backend/src/modules/progress/repository.mjs`
- `backend/src/modules/progress/routes.mjs`
- `backend/src/config.mjs`
- `src/stores/courseStore.ts`
- `src/types/courseState.ts`
- `src/services/api/progress/progressApi.ts`
- `src/services/api/types.ts`
- `src/screens/main/InventoryScreen.tsx`
- `src/screens/main/ProfileScreen.tsx`
- `src/screens/main/StreakStatusScreen.tsx`
- `src/screens/main/CommunityPotScreen.tsx`
- `src/screens/main/AlchemyScreen.tsx`
- `src/screens/main/LessonScreen.tsx`
- `src/screens/main/LessonResultScreen.tsx`
- `src/screens/main/UndergroundHubScreen.tsx`

## Verified Outcomes

- First verified lesson completion on a day credits Fuel once and syncs the runtime snapshot back to the app.
- Replaying another accepted completion on the same day does not grant a second Fuel credit.
- Burn requests are blocked during gauntlet with `GAUNTLET_LOCKED`.
- Post-gauntlet burn succeeds, decrements Fuel, and records `lastBrewerBurnTs`.
- Replaying the same burn `cycleId` does not double-burn Fuel.
- First saver miss applies once, moves the app to recovery mode, and replaying the same `missEventId` does not reapply the penalty.
- Saver counts now refresh correctly in `Profile` and `Community Pot`.

## Remaining Follow-up

- Move the verified completion, Fuel credit, burn, and saver consequence logic onto the `LockVault` instruction surface.
- Add the real scheduler/worker layer that consumes outbox events and drives the internal routes.
