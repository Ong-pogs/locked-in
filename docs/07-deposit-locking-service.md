# Deposit and Locking Service Spec (v4.0)

## Scope

This service orchestrates user lock setup and lock lifecycle reads from the Next.js web-app (PWA).
It is the transaction builder/orchestration layer, not the settlement authority.

The custody escrow now lives in the single merged `locked_in` Anchor program
(program ID `68im45BCfv8sL6WnVVV9JF4edLkB11udeU9EAApNaEx3`, devnet). The former
separate `lock_vault` and `community_pot` programs were merged into `locked_in`
(separated only by PDA seeds: `vault-protocol` vs `pot-protocol`); the
`yield_splitter` program was removed entirely. The vault is CUSTODY-ONLY:
escrow principal -> clock-gated wait -> return principal.

Current implementation checkpoint:

- on-chain `lock_funds` now exists in the `locked_in` program's vault module (`programs/locked_in/src/vault.rs`)
- the web-app now builds a real `lock_funds` transaction from `web-app/app/onboarding/deposit/page.tsx` (tx builder in `web-app/services/solana/lockVault.ts`)
- the client derives lock/vault PDAs, fetches wallet token balances, signs through a browser wallet adapter (Privy) using `@solana/web3.js`, and submits the raw transaction from the web-app for confirmation
- the client passes the trailing SKR source account (`owner_skr_token_account`) only as an OPTIONAL final key; the merged Anchor program declares it `Option<...>`, so it is not required for `USDC`-only locks
- the deposit page now:
  - checks for an existing on-chain lock before attempting another deposit
  - shows `SOL` alongside `USDC` and `SKR`
  - simulates `lock_funds` before opening the wallet so program/token errors surface in-app
  - reads a per-course lock policy from the course catalog
  - enforces minimum deposit and duration bounds before building the transaction
  - offers quick principal presets (for example `1`, `5`, `10`, `25`, `50`, `100`)
  - keeps `1 USDC` available as a dev/demo preset without changing the normal course policy
  - is now reachable from both the first-connect onboarding flow and the in-app course browser
  - only unlocks lesson access for the specific course that was locked
- the Solana client layer can now also build a real `unlock_funds` transaction for a locked course
- the flow still depends on configured program/mint env vars and a deployed `locked_in` program on the selected cluster
- live lock inspection is now available through `scripts/inspect-lock-vault.mjs`

## Required Inputs

- connected wallet public key
- selected course id
- course lock policy:
  - minimum deposit
  - optional maximum deposit
  - minimum lock duration
  - maximum lock duration
- lock duration (currently constrained by on-chain presets: `14 | 30 | 45 | 60 | 90 | 180 | 365`)
- principal amount (USDC)
- optional SKR amount

## Canonical Deposit Flow

1. fetch wallet token balances (stablecoin and SKR)
2. validate amount, mint support, and per-course policy bounds
3. derive required accounts:
   - lock PDA
   - user ATAs
   - vault ATAs
4. simulate `lock_funds(...)` locally to catch account/mint/balance errors before wallet approval
5. build transaction for `lock_funds(...)`
6. request wallet signature
7. submit and confirm transaction
8. persist lock reference in app state
9. route user into that course's lesson path

Current flow note:

- user connects wallet
- sees the course catalog
- selects a specific course
- locks funds for that specific course
- only then descends into that course's lesson path (no gauntlet stage — v4 removed the legacy 7-day onboarding lock; all mechanics fire from day 1)

## Single-Transaction Requirement

User principal and optional SKR lock must execute atomically in one transaction path for lock creation.
Partial lock creation is not permitted.

## Lock State Read Model

Service must expose per-course lock reads. The on-chain `LockAccount` (138
bytes, 9 fields: `owner`, `course_id_hash`, `stable_mint`, `principal_amount`,
`skr_locked_amount`, `lock_start_ts`, `lock_end_ts`, `status`, `bump`) is the
source of truth for custody facts; game state lives off-chain in Postgres.

On-chain (from `LockAccount`):

- principal amount and mint
- lock start/end timestamps
- SKR locked amount
- status and unlock eligibility (clock-gated against `lock_end_ts`)

Off-chain (Postgres counters, not on-chain, not SPL tokens):

- Fuel counter (drives the fire timer; see `docs/03-fuel.md`)
- Ichor counter (in-game shop currency; see `docs/04-tokenomics.md`)

There is NO extension total and NO saver state stored on-chain. `lock_end_ts`
is written exactly once at `lock_funds` and is never mutated — missed learning
days penalize YIELD ONLY and never extend the principal lock (v4 fire-timer
model).

## Extension Handling

There is NO lock extension in v4. `lock_end_ts` is set exactly once at
`lock_funds` and no surviving on-chain code path mutates it. The old automatic
"penalty extension" is gone: missed learning days penalize YIELD ONLY (via the
off-chain fire timer / yield routing) and never extend the principal lock.
See `docs/04-tokenomics.md` (authoritative) and `docs/03-fuel.md`.

## Resurface Flow

When lock is unlockable:

1. build and sign `unlock_funds`
2. confirm return of principal stablecoin
3. confirm return of locked SKR
4. refresh all course lock state

Current implementation checkpoint:

- the transaction builder now exists in `web-app/services/solana/lockVault.ts` (`buildUnlockFundsTransaction`)
- the web-app now includes:
  - a persisted resurface receipt store (`web-app/stores/resurfaceStore.ts`), hydrated on app boot via `web-app/components/AppShell.tsx`
  - receipts are written on a confirmed `unlock_funds` and surfaced to the user from the persisted store
- backend now also supports an independent unlock indexer path:
  - recent `locked_in` program transactions are scanned for real `unlock_funds` instructions
  - verified unlocks can be written into backend receipt history even if the app never posts the receipt payload
  - runtime rows now persist lock metadata needed for that chain-derived receipt path

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
- single `locked_in` program ID (`68im45BCfv8sL6WnVVV9JF4edLkB11udeU9EAApNaEx3`
  on devnet) — the former separate `LockVault` / `YieldSplitter` / `CommunityPot`
  IDs are gone (vault + pot merged into `locked_in`; `yield_splitter` removed)
- supported stablecoin mint addresses
- SKR mint address
- compute budget and priority fee policy

RPC note: the backend uses a dedicated Alchemy RPC configured SERVER-SIDE ONLY
(`SOLANA_RPC_URL`); the frontend stays on the public RPC. The Alchemy key is
NEVER placed in a `NEXT_PUBLIC_` var (that would ship it to the
browser). Cluster profiles (devnet/mainnet) are switched via
`scripts/use-cluster.sh`; all `.env`/`.env.*` are gitignored.

## Non-goals

This layer does not:

- compute final reward settlement
- decide penalty policy
- trust local clocks for unlockability

Those concerns remain in on-chain programs and backend schedulers.
