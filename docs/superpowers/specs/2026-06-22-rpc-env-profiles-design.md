# RPC Env Profiles + Alchemy Key Handling — Design

**Date:** 2026-06-22
**Status:** Implemented (devnet active); mainnet profile is a fill-at-deploy template.

## Goal

Use a dedicated Alchemy RPC for Solana, switch cleanly between **devnet** and
**mainnet**, and **never expose the Alchemy key publicly** (it is an
unrestricted-origin key).

## Key security invariant

The Alchemy key lives **only in backend, server-side env files** — `SOLANA_RPC_URL`
(follows the active cluster) and `YIELD_KAMINO_RPC_URL` (always mainnet; Kamino
reserves are on mainnet).

It must **never** appear in any `NEXT_PUBLIC_*` (web) or `EXPO_PUBLIC_*` (mobile)
variable — those are compiled into the client bundle and visible to anyone. The
frontend therefore stays on the **public** Solana RPC for now. (Pre-mainnet
follow-up: a backend RPC proxy so the browser also gets Alchemy speed without
seeing the key — see "Deferred".)

`.gitignore` ignores `.env` and `.env.*` in every directory (only `*.example`
is tracked), so no profile file — and thus no key — can be committed.

## Architecture

- **Backend** (`backend/src/config.mjs` reads full URLs from env — no code change):
  - `SOLANA_RPC_URL` → Alchemy `solana-devnet` (devnet) / `solana-mainnet` (mainnet)
  - `YIELD_KAMINO_RPC_URL` → Alchemy `solana-mainnet` (both profiles)
- **Web-app** (`NEXT_PUBLIC_SOLANA_RPC_URL`): public RPC, no key.

## File layout

Per app, two canonical profiles + the file the app actually loads:

| App | Profiles (canonical) | Active file (loaded) | Holds key? |
|---|---|---|---|
| backend | `.env.devnet`, `.env.mainnet` | `.env` (dotenv) | **Yes** — all gitignored |
| web-app | `.env.devnet`, `.env.mainnet` | `.env.local` (Next, loaded last) | No (public RPC + program IDs + mints) |

Network-specific values that differ per profile: RPC URL(s), `SOLANA_CLUSTER`,
program IDs, token mints, `FAUCET_ENABLED` (off on mainnet). Secrets (DB, JWT,
Privy, scheduler, worker keys) are identical across both backend profiles.

## Switching clusters

```
scripts/use-cluster.sh <devnet|mainnet>
```
Copies `backend/.env.<cluster>` → `backend/.env` and `web-app/.env.<cluster>` →
`web-app/.env.local`, then prompts a restart of backend (`node --watch
src/server.mjs`) and web-app (`next dev`).

## Mainnet profile — fill at deploy

`backend/.env.mainnet` and `web-app/.env.mainnet` carry `<FILL_AT_MAINNET_DEPLOY>`
placeholders for `LOCK_VAULT_PROGRAM_ID` / `COMMUNITY_POT_PROGRAM_ID` (the program
does not exist on mainnet until it is deployed). `LOCK_VAULT_USDC_MINT`
is preset to the canonical mainnet USDC mint
(`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) — **verify before launch**.

## Deferred (pre-mainnet hardening)

1. **Backend RPC proxy** (`POST /v1/rpc` + WS) so the browser uses Alchemy on
   mainnet without exposing the key. Public mainnet RPC is too rate-limited for
   a production frontend.
2. **Leaderboard batch-RPC fix** — `computeLeaderboardRows` makes one sequential
   `getAccountInfo` per lock; switching providers does not fix the O(N) RPC
   pattern. Batch with `getMultipleAccountsInfo` before mainnet scale.
