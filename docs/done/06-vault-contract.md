# Done: 06 Vault Contract

## Scope Completed

This checkpoint established the first working `LockVault` program on devnet and connected the backend worker pipeline to its on-chain runtime instructions.

## What Was Implemented

### On-chain lock creation

- `LockVault` is deployed on devnet.
- `initialize_protocol` is bootstrapped with canonical Fuel/saver config.
- `lock_funds` now creates real course locks with:
  - official devnet USDC
  - project SKR mint
  - deterministic lock and vault PDAs

### On-chain unlock path

- `unlock_funds` now exists on the program.
- It checks `Clock` against the effective lock end time.
- It returns principal and locked SKR to the owner ATAs.
- It closes both vault token accounts and closes the lock account back to the owner.

### On-chain Ichor redemption path

- `redeem_ichor` now exists on the program.
- It debits `ichor_counter` on the lock account.
- It transfers USDC from the protocol redemption vault to the owner ATA.
- It uses the canonical lifetime-tier conversion table on-chain.

### On-chain harvest / Ichor accrual path

- `apply_harvest_result` now exists on the program as a worker-only instruction.
- Harvest applies:
  - platform fee
  - saver/community redirect
  - SKR boost
  - Ichor accrual into `ichor_counter` and `ichor_lifetime_total`
- Backend harvest receipts can now be queued and published to the live lock.
- `LockVault` harvest math now also guards the full-redirect edge case:
  - `100%` redirect sends the full harvest to redirect
  - no platform fee is taken in that branch
  - user-share underflow is avoided

### Companion CommunityPot program

- `CommunityPot` now exists as a separate on-chain program on devnet.
- It stores redirected yield in monthly UTC `YYYYMM` windows.
- Harvest receipts can now relay their redirected share into the live pot with separate idempotent status tracking.
- `close_distribution_window(window_id)` now exists as the first monthly settlement instruction.
- Closed windows can now carry total redirected amount, total weight, and eligible recipient count on-chain.
- `distribute_window(...)` now exists and transfers USDC out of the CommunityPot vault to eligible recipients.

### First YieldSplitter scaffold

- A dedicated `YieldSplitter` program now exists in the Anchor workspace.
- The first slice currently covers:
  - protocol config
  - idempotent harvest split receipts
  - canonical split math tests
- Backend harvest rows now track:
  - `yield_splitter_status`
  - receipt account
  - transaction signature
- The first live devnet relay was verified on `manual-harvest-ys-001`.

### Worker-side runtime instructions

- The program now supports worker-only mutations for:
  - verified completion application
  - daily Fuel burn
  - saver or full-consequence application
- Each worker path uses a receipt PDA for idempotency.

### Backend to chain relay

- Verified completion outbox rows can now be published to `LockVault`.
- Fuel burn receipts can now be published to `LockVault`.
- Miss consequence receipts can now be published to `LockVault`.
- Backend records per-item relay lifecycle:
  - `pending`
  - `publishing`
  - `published`
  - `failed`
- Successful relay stores the devnet transaction signature on the database row.

### Verified completion worker loop

- The backend now runs a polling relay worker on boot.
- The worker starts and stops with the Fastify server lifecycle.
- It safely skips historical completion rows that predate the live lock start.
- Those stale rows are marked `failed` with a concrete reason instead of mutating the lock.

### Runtime scheduler worker

- The backend now runs a second polling worker for runtime actions.
- Before scheduling anything, it syncs the runtime row from the live `LockVault` account.
- It derives deterministic automatic ids for:
  - daily Fuel burns
  - missed-day consequences
- On the current live dev lock, the worker was verified to no-op safely:
  - no `auto-burn:*` receipts created
  - no `auto-miss:*` receipts created
  - lock state remained `gauntletDay = 2`, `fuelCounter = 1`

### Inspection tooling

- `scripts/inspect-lock-vault.mjs` can decode and print a live lock account.
- This was used to confirm:
  - funded deposit state
  - gauntlet advancement
  - Fuel credit landing on-chain

## Main Files

- `programs/lock_vault/src/lib.rs`
- `backend/src/lib/lockVault.mjs`
- `backend/src/modules/progress/repository.mjs`
- `backend/src/modules/progress/routes.mjs`
- `backend/sql/0008_verified_completion_publish_status.sql`
- `backend/sql/0009_runtime_receipt_publish_status.sql`
- `scripts/init-lock-vault-protocol.mjs`
- `scripts/inspect-lock-vault.mjs`

## Verified Outcomes

- A real verified-completion event was published from the backend to devnet:
  - the event row moved to `published`
  - the lock advanced on-chain to `gauntletDay = 2`
  - `fuelCounter` increased to `1`
- A fresh gauntlet-locked burn receipt was published to devnet and marked `published`.
- A fresh gauntlet-locked miss receipt was published to devnet and marked `published`.
- Remaining historical pre-lock completion rows were automatically marked `failed` by the worker loop after restart.
- The upgraded program with `unlock_funds` and `redeem_ichor` is live again on devnet under the same program id.
- A positive manual harvest was published on devnet and increased the live lock to `ichor_counter = 840000`.
- The protocol redemption vault was funded with devnet USDC.
- The mobile app now reads live lock and redemption-vault state from chain.
- The mobile `Ichor Shop` can execute the real `redeem_ichor` path against the live program.
- The live CommunityPot window now holds the redirected `0.1 USDC` share from `manual-harvest-002`.
- A fresh `202604` CommunityPot window was closed with one eligible recipient snapshot and a `50000` atomic payout plan.
- The live `202604` batch payout succeeded and marked the snapshot row `distributed`.

## Remaining Follow-up

- Replace manual harvest seeding with a real `YieldSplitter` or strategy adapter path.
- Live-test `unlock_funds` once a real lock reaches its unlock timestamp.
