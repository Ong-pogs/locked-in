# Vault Program Spec (v4.0)

## Scope

The vault is the custody domain of the single merged `locked_in` Anchor
program. It is **custody-only**: it escrows stablecoin principal (`USDC`),
clock-gates the unlock against an immutable
`lock_end_ts`, and returns the full principal to the owner via a
PDA-signed payout. It holds **no game/economy state** — Fuel, Ichor,
savers, streaks, and yield routing are all off-chain backend counters
(see 08-timer-yield-product, 04-tokenomics, 05-yield-calculator).

Source of truth: `programs/locked_in/src/vault.rs` (custody logic),
`programs/locked_in/src/lib.rs` (program entrypoints + program ID).

Current implementation checkpoint:

- one Anchor program named `locked_in`, program ID
  `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav`, deployed on devnet
- the vault is one of two modules under this program ID, separated only by
  PDA config seed: `vault` (`b"vault-protocol"`) and `pot`
  (`b"pot-protocol"`)
- `initialize_vault` records the canonical USDC mint into a singleton
  `VaultConfig` PDA
- `lock_funds` validates the configured mint + duration, creates the lock
  PDA, creates the lock-owned stable vault ATA, escrows the principal
  atomically, and writes `lock_end_ts` exactly once (it is never mutated
  afterward)
- `unlock_funds` is clock-gated against `lock_end_ts`, asserts the vault
  still holds the full escrowed principal, binds the supplied mint,
  returns the principal via PDA-signed `transfer_checked`, closes the vault
  ATA, and closes the lock account back to the owner
- Rust unit tests cover principal snapshotting, the immutable lock end,
  canonical duration validation, and the clock-gated double-close guard

### What changed from v3.0

The v3 model shipped three separate programs and an on-chain economy. This
has been reduced to a single custody program:

- **Three programs → one.** The former `lock_vault` (custody) and
  `community_pot` (redirected-yield accumulator + payout) were **merged**
  into the single `locked_in` program; the separate `YieldSplitter` program
  was **removed entirely** (program + backend + API + web-app + tests). This
  cut the default deploy cost from ~15.27 SOL to ~2.51 SOL.
- **On-chain economy → off-chain.** Fuel/Ichor/saver counters, the
  `redeem_ichor` instruction, the `IchorRedeemed` event, the fuel→ichor
  conversion, and the on-chain course policy were all **removed from the
  chain**. The vault no longer stores any per-course game state.
- **SKR removed entirely.** The vault is now pure USDC principal custody —
  no SKR escrow, no SKR mint in config, no SKR vault ATA, and no on-chain
  tier/boost logic.
- **No Ichor redemption.** Ichor is an off-chain shop currency only; there
  is no ichor→USDC settlement anywhere (see 04-tokenomics).

## Responsibilities

1. Escrow stablecoin principal (USDC) in one course lock.
2. Enforce the canonical lock duration set and write an immutable lock end.
3. Authorize unlock only when the clock has passed `lock_end_ts`.
4. Return the full escrowed principal via a PDA-signed payout.

## Canonical Instructions

The vault domain exposes exactly three entrypoints (plus the one-time
config init). All are routed through `locked_in::{...}` in `lib.rs` to the
`vault::` handlers in `vault.rs`.

### `initialize_vault(usdc_mint)`

Authorized caller: deploy authority (one-time setup).

Effects:

- creates the singleton `VaultConfig` PDA (seed `b"vault-protocol"`)
- records `authority` and the canonical `usdc_mint`

Validation:

- `usdc_mint` must be non-default (`InvalidMintConfig`)

### `lock_funds(course_id_hash, lock_duration_days, stable_amount)`

Authorized caller: lock owner.

Effects:

- escrows `stable_amount` USDC from the owner ATA into the lock-owned stable
  vault ATA via `transfer_checked`
- creates the per-course `LockAccount` PDA and snapshots the principal,
  `lock_start_ts`, and the immutable `lock_end_ts`
- emits `LockCreated`

Validation:

- `stable_amount > 0` (`InvalidPrincipalAmount`)
- supplied stable mint must equal the configured USDC mint
  (`UnsupportedStableMint`)
- `lock_duration_days` in the allowed set (`14`, `30`, `45`, `60`, `90`,
  `180`, `365`) (`InvalidLockDuration`)
- the owner stable token account must be owned by the signer and match the
  stable mint
- one active lock per `(owner, course_id_hash)` key (PDA seed
  `[b"lock", owner, course_id_hash]`)

Note:

- `lock_end_ts` is written exactly once here; missed learning days are
  yield-only and **never** extend the principal lock (v4 fire-timer model)

### `unlock_funds()`

Authorized caller: lock owner (`has_one = owner`, else `InvalidLockOwner`).

Preconditions:

- `now >= lock_end_ts` (`LockStillActive`)
- the lock is not already closed (`LockAlreadyClosed`)
- the stable vault still holds exactly `principal_amount`
  (`UnexpectedStableVaultBalance`)

Effects:

- returns the full principal to the owner via PDA-signed `transfer_checked`,
  signed by the `LockAccount` PDA seeds
- closes the vault ATA, refunding its rent to the owner
- marks the lock closed (`status = CLOSED_STATUS`) and closes the lock
  account back to the owner (`close = owner`)
- emits `LockUnlocked`

Mint binding (custody-hardening):

- the supplied stable mint is bound to the lock's recorded `stable_mint`;
  a mismatch fails with **`InvalidMint`**. This blocks a
  fake-mint + fake-vault unlock that would otherwise strand the real
  principal vault under the closed lock PDA. `unlock_funds` takes no
  `protocol_config` account — the mint is read directly from the lock.

## Account Topology

Global PDA:

- `VaultConfig` — singleton config, seed `[b"vault-protocol"]`. Stores
  `authority`, `usdc_mint`, `bump`.

Per-course lock PDAs:

- `LockAccount` — seed `[b"lock", owner, course_id_hash]`. The custody
  account and the authority of the vault ATA.
- stablecoin vault ATA — authority = `LockAccount` PDA

### `LockAccount` layout (130 bytes)

8-byte Anchor discriminator + 8 fields (122 bytes of data):

| Field               | Type      | Bytes |
| ------------------- | --------- | ----- |
| `owner`             | `Pubkey`  | 32    |
| `course_id_hash`    | `[u8; 32]`| 32    |
| `stable_mint`       | `Pubkey`  | 32    |
| `principal_amount`  | `u64`     | 8     |
| `lock_start_ts`     | `i64`     | 8     |
| `lock_end_ts`       | `i64`     | 8     |
| `status`            | `u8`      | 1     |
| `bump`              | `u8`      | 1     |

`status` is `0 = ACTIVE`, `2 = CLOSED`. `unlock_funds` binds the supplied
stable mint to this account's recorded `stable_mint`.

## Access Control

User-signed only:

- `lock_funds`
- `unlock_funds`

Deploy authority only:

- `initialize_vault` (one-time config init)

There is no on-chain worker/scheduler signer set in the vault domain
anymore — completion, fuel-burn, and miss handling are off-chain backend
concerns and no longer touch this program.

## Time Source

Program time logic uses Solana clock sysvar unix timestamp.
No client clock is trusted for settlement-critical decisions.

## Safety Invariants

1. Principal is never redirected; the only `LockAccount` payout path returns
   it to the recorded `owner`.
2. `unlock_funds` asserts the vault balance equals the recorded snapshot
   before paying out.
3. `lock_end_ts` is set once at funding and never mutated — missed days are
   yield-only and cannot extend the lock.
4. The supplied stable mint is bound to the recorded mint at unlock
   (`InvalidMint`), preventing fake-mint substitution.
5. Duration math uses checked arithmetic (`NumericalOverflow`).

## Events

- `LockCreated` — emitted by `lock_funds`
- `LockUnlocked` — emitted by `unlock_funds`

Events are used for analytics, indexers, and reconciliation. The v3 economy
events (`FuelCredited`, `FuelBurned`, `SaverConsumed`,
`FullConsequenceApplied`, `IchorRedeemed`) no longer exist — those mechanics
are off-chain.

## Sibling domain: the pot

The community pot lives in the **same** `locked_in` program as a second
module separated by config seed `b"pot-protocol"`
(`programs/locked_in/src/pot.rs`). It is the redirected-yield accumulator +
payout system: `initialize_pot`, `record_redirect`,
`close_distribution_window`, and `distribute_window`, with payouts settled
from a program-owned USDC pot vault. It is documented separately and shares
no state with the vault custody PDAs.

The former separate `YieldSplitter` program is **gone** — yield routing math
now lives in the backend (see 05-yield-calculator), not on-chain.
