# Deposit and Locking Service Spec (v3.0)

## Scope

This service orchestrates user lock setup and lock lifecycle reads from the mobile client.
It is the transaction builder/orchestration layer, not the settlement authority.

Current implementation checkpoint:

- on-chain `lock_funds` now exists under `programs/lock_vault`
- the mobile app now builds a real `lock_funds` transaction from `src/screens/onboarding/DepositScreen.tsx`
- the client derives lock/vault PDAs, fetches wallet token balances, signs through MWA, and submits the raw transaction from the app for confirmation
- the client now always passes the trailing SKR source account meta, even for `USDC`-only locks, because the live Anchor account layout still requires that final key during instruction decoding
- the deposit screen now:
  - checks for an existing on-chain lock before attempting another deposit
  - shows `SOL` alongside `USDC` and `SKR`
  - simulates `lock_funds` before opening the wallet so program/token errors surface in-app
- the Solana client layer can now also build a real `unlock_funds` transaction for a locked course
- the flow still depends on configured program/mint env vars and a deployed `LockVault` program on the selected cluster
- live lock inspection is now available through `scripts/inspect-lock-vault.mjs`

## Required Inputs

- connected wallet public key
- selected course id
- lock duration (`30 | 60 | 90` days)
- principal amount (USDC)
- optional SKR amount

## Canonical Deposit Flow

1. fetch wallet token balances (stablecoin and SKR)
2. validate amount, mint support, and minimums
3. derive required accounts:
   - lock PDA
   - user ATAs
   - vault ATAs
4. simulate `lock_funds(...)` locally to catch account/mint/balance errors before wallet approval
5. build transaction for `lock_funds(...)`
6. request wallet signature
7. submit and confirm transaction
8. persist lock reference in app state
9. route user to gauntlet flow

## Single-Transaction Requirement

User principal and optional SKR lock must execute atomically in one transaction path for lock creation.
Partial lock creation is not permitted.

## Lock State Read Model

Service must expose per-course lock reads:

- principal amount and mint
- lock start/end timestamps
- extension total
- saver state
- Fuel counter
- Ichor counter
- SKR locked amount and snapshot tier
- unlock eligibility

## Extension Handling

Two extension types:

1. automatic extension (penalty path)
2. optional user-initiated extension (if enabled by product policy)

Both must use explicit on-chain instruction paths and event logs.

## Resurface Flow

When lock is unlockable:

1. build and sign `unlock_funds`
2. confirm return of principal stablecoin
3. confirm return of locked SKR
4. refresh all course lock state

Current implementation checkpoint:

- the transaction builder now exists in `src/services/solana/lockVault.ts`
- the mobile app now includes:
  - a live resurface card in `Profile`
  - a persisted resurface receipt history screen
  - post-unlock navigation into that receipt history

## Failure Handling

Must handle and classify:

- user rejected signing
- insufficient token balance
- insufficient SOL for fees
- stale blockhash / transaction expiry
- RPC timeout or confirmation failure
- program-level validation errors

## Environment Configuration

Client/service config must include:

- cluster + RPC endpoint
- program IDs (`LockVault`, `YieldSplitter`, `CommunityPot`)
- supported stablecoin mint addresses
- SKR mint address
- compute budget and priority fee policy

## Non-goals

This layer does not:

- compute final reward settlement
- decide penalty policy
- trust local clocks for unlockability

Those concerns remain in on-chain programs and backend schedulers.
