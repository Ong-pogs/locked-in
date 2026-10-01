# Locked In: Deployment and Operations Handoff

> Handoff documentation for deploying **Locked In** (Vercel frontend, Render backend, Render cron jobs, Supabase Postgres).
> Written for a teammate or their coding agent with Vercel and Render access.
> **This repository is public. Secret values are never stored in this file or repository.**
> This document lists variable names, architectural layout, deployment workflows, and operational rules.

---

## 1. What is Live (Current Status)

Locked In is live on Solana mainnet with real USDC (v2).

- **Launch source of truth:** [docs/launch/MAINNET_SOURCE_OF_TRUTH.md](docs/launch/MAINNET_SOURCE_OF_TRUTH.md) (canonical config in config/mainnet-production.json and the read-only launch harness).
- **Frontend URLs:** `https://lockedin.quest` (redirects to `https://www.lockedin.quest`), `https://www.lockedin.quest`, and `https://locked-in-test-env.vercel.app`
- **Backend API:** `https://locked-in-backend-oetf.onrender.com`
- **Mainnet Program ID:** `FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6` (merged vault v2 custody and community pot)
- **Mainnet USDC Mint:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **Kamino Lending Program:** `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- **Devnet Test Environment:**
  - v2 Vault Program ID: `EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN`
  - Pot / v1 Program ID: `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav`
  - Devnet USDC Mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (with mock Kamino reserve)
- **On-chain Guardrails:**
  - Principal per lock: 10 to 50 USDC
  - Global TVL cap: 1,000 USDC
  - Platform fee: 0%
- **Security & Risk Note:** The smart contract has not undergone a third-party security audit. Locked principal sits in Kamino lending reserves, so deposits carry smart contract and protocol risk (warned on the deposit screen). A complete lock-to-claim round trip has succeeded on mainnet.

---

## 2. System Architecture and Topology

```
                +------------------------------------+
   Browser ---> |     Vercel: web-app (Next.js 16)   |  NEXT_PUBLIC_* variables
                +-----------------+------------------+
                                  | HTTPS (NEXT_PUBLIC_API_URL)
                                  v
                +------------------------------------+
                |    Render: backend (Fastify API)   |  node src/server.mjs
                |    locked-in-backend-oetf.onrender |
                +--------+------------------+--------+
                         |                  |
           +-------------v-----+     +------v----------------------------+
           | Supabase Postgres |     | 5 Render Cron Jobs (render.yaml)  |
           | (DATABASE_URL)    |     | - Leaderboard refresh (00:00 UTC) |
           | Schemas: lesson,  |     | - Lapse sweep (00:30 UTC)         |
           | lesson_auth,      |     | - Arena season (00:35 UTC)        |
           | arena             |     | - Pot cycle (03:00 UTC daily)     |
           +-------------------+     | - Arena sweep (every 15 min)      |
                                     +-----------------------------------+

   External Services:
     - Privy: User onboarding and wallet authentication
     - Helius RPC: Solana Mainnet RPC (separate client and server keys)
     - Kamino Lending: On-chain USDC liquidity reserve (KLend)
```

---

## 3. Components Summary

| Component | Platform | Tech | Deployment & Notes |
|---|---|---|---|
| **web-app** | **Vercel** (`locked-in-test-env`) | Next.js 16 PWA | Deploys automatically on push to `master` |
| **backend** | **Render** (`locked-in-backend`) | Fastify (Node >= 20) | Auto-deploys from `master` when files under `backend/` change. Health: `GET /health` |
| **cron jobs** (5) | **Render** (Blueprint) | Node scripts | Defined in `render.yaml`, auto-deploy from `master` when files under `backend/` change |
| **database** | **Supabase** (Postgres 17) | Postgres via `pg` | Schemas: `lesson`, `lesson_auth`, `arena`. Plain connection string |
| **docs-site** | **Vercel** (project `docs-site`) | Nextra | Live at `docs.lockedin.quest`. Not linked to Git, so it does not auto-deploy on push |

---

## 4. Deployment Workflow

### Automatic Deployments
- Pushing commits to the **`master`** branch automatically triggers:
  1. Vercel frontend (`web-app`): rebuilds on every push.
  2. Render backend web service (`locked-in-backend`) and all 5 Render cron jobs: their root directory is `backend/`, so Render only redeploys them when a pushed commit changes files under `backend/`. A web-only or docs-only push leaves them on the previous commit.
- To redeploy a Render service without a backend change (for example after editing its env vars), trigger a manual deploy in the Render dashboard.

### Database Migrations
- Migration files are located in `backend/sql/*.sql` (ordered numerically, latest `0066_arena_match_proposals.sql`).
- Runner script: `npm run migrate` in `backend/` (`backend/scripts/migrate.mjs`).
- **CRITICAL:** Migrations are **NOT** run automatically during Render deployments.
- You must run `npm run migrate` against the production `DATABASE_URL` **BEFORE** merging a schema change to `master`.
- The backend server enforces this on boot with `runMigrations({ dryRun: true })` and refuses to start if any migration is pending.
- **Supabase Table Editor Note:** The `public` schema is empty. Supabase Table Editor looks empty until you switch the schema selector dropdown to `lesson`, `lesson_auth`, or `arena`.

---

## 5. Scheduled Cron Jobs (Render Blueprint)

All 5 cron jobs are declared in `render.yaml` at the repo root. Each cron is a lightweight HTTP caller that transmits `SCHEDULER_SECRET` to the backend API.

| Cron Service Name | Schedule | Command | Required Env Vars | Purpose |
|---|---|---|---|---|
| `locked-in-leaderboard-snapshot-refresh` | `0 0 * * *` (00:00 UTC) | `npm run cron:leaderboard-refresh` | `SCHEDULER_SECRET`, `LEADERBOARD_REFRESH_BASE_URL` | Materializes daily leaderboard standings into the database snapshot table |
| `locked-in-lapse-sweep` | `30 0 * * *` (00:30 UTC) | `npm run cron:lapse-sweep` | `SCHEDULER_SECRET`, `LAPSE_SWEEP_BASE_URL` | Evaluates the previous UTC day for all active v2 locks: burns shields or records 1st/2nd lapses |
| `locked-in-arena-season` | `35 0 * * *` (00:35 UTC) | `npm run cron:arena-season` | `SCHEDULER_SECRET`, `ARENA_SWEEP_BASE_URL` | Closes completed 30-day Arena seasons, applies yield penalties for negative ratings, and opens new seasons |
| `locked-in-pot-cycle` | `0 3 * * *` (03:00 UTC daily) | `npm run cron:pot-cycle` | `SCHEDULER_SECRET`, `POT_CYCLE_BASE_URL` | **The ONLY cron moving real USDC.** Settles monthly pot allocations and submits on-chain payout transactions |
| `locked-in-arena-sweep` | `*/15 * * * *` (every 15 min) | `npm run cron:arena-sweep` | `SCHEDULER_SECRET`, `ARENA_SWEEP_BASE_URL` | Expires matches past their deadline and settles abandoned ones |

> Note: Crons never hold private keys or database credentials. They require only `SCHEDULER_SECRET` and their target base URL.

---

## 6. Environment Variables Reference

Legend:
- 🔒 = Secret value (provided securely, never committed)
- 🌐 = Public value / address / URL
- ⚙ = Operational config default

### A. Render Backend Web Service (`locked-in-backend`)

| Variable Name | Description / Target | Type | Production Value |
|---|---|---|---|
| `DATABASE_URL` | Postgres connection string | 🔒 | Supabase connection string (session pooler or direct) |
| `JWT_SECRET` | Secret for signing auth JWTs (minimum 32 bytes) | 🔒 | Random 32+ byte string |
| `SCHEDULER_SECRET` | Secret for authenticating cron HTTP calls (minimum 32 bytes) | 🔒 | Random 32+ byte string (must match crons) |
| `PRIVY_APP_ID` | Privy application identifier | 🌐 | `cmncshird026v0cl5n6yqq8z0` |
| `PRIVY_APP_SECRET` | Privy server verification secret | 🔒 | Privy server secret |
| `SOLANA_RPC_URL` | Helius mainnet RPC endpoint | 🔒 | Private Helius server endpoint |
| `YIELD_KAMINO_RPC_URL` | Helius mainnet RPC endpoint for Kamino reserve querying | 🔒 | Private Helius server endpoint |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed frontend origins | 🌐 | `https://lockedin.quest,https://www.lockedin.quest,https://locked-in-test-env.vercel.app` |
| `VAULT_V2_PROGRAM_ID` | Mainnet v2 vault program ID | 🌐 | `FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6` |
| `LOCK_VAULT_PROGRAM_ID` | Legacy v1 lock vault program ID. v2 flows (including the leaderboard) use `VAULT_V2_PROGRAM_ID`; only the legacy v1 path reads this one | 🌐 | Currently the devnet ID `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav` |
| `COMMUNITY_POT_PROGRAM_ID` | Mainnet community pot program ID | 🌐 | `FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6` |
| `LOCK_VAULT_USDC_MINT` | Mainnet USDC token mint | 🌐 | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `LOCK_VAULT_WORKER_PRIVATE_KEY` | Keypair for voucher signing and onboarding gas drips | 🔒 | Base58 private key (must hold SOL balance) |
| `COMMUNITY_POT_WORKER_PRIVATE_KEY` | Keypair for executing monthly community pot distributions | 🔒 | Base58 private key (must hold SOL balance) |
| `YIELD_STRATEGY_ENABLED` | Enables live Kamino APY polling | ⚙ | `true` |
| `YIELD_STRATEGY_PROFILE` | Yield profile name | ⚙ | `kamino_usdc_mainnet` |
| `OPENAI_API_KEY` | OpenAI key for hybrid question evaluation | 🔒 | Optional (set only if hybrid grading is enabled) |
| `HOST` | Server host bind | ⚙ | `0.0.0.0` |
| `LOG_LEVEL` | Logging level | ⚙ | `info` |
| `DEV_TOOLS_ENABLED` | Dev force-complete course endpoints | ⚙ | `false` (MUST stay false on mainnet) |
| `FAUCET_ENABLED` | Devnet test airdrop faucet | ⚙ | `false` (MUST stay false on mainnet) |
| `LEADERBOARD_SNAPSHOT_ENABLED` | In-process leaderboard poller | ⚙ | `false` (cron handles refresh) |
| `RUNTIME_SCHEDULER_ENABLED` | In-process runtime scheduler worker | ⚙ | `false` |
| `UNLOCK_INDEXER_ENABLED` | In-process unlock indexer worker | ⚙ | `false` |
| `LEGACY_MISS_ENGINE_ENABLED` | Legacy miss engine | ⚙ | `false` |
| `ANSWER_VALIDATOR_HYBRID_ENABLED` | Hybrid LLM answer validation | ⚙ | `false` |
| `OPENAI_VALIDATOR_MODEL` | Model for LLM validation | ⚙ | `gpt-4o-mini` in production (code default `gpt-5-nano`) |

### B. Render Cron Jobs (`render.yaml`)

| Variable Name | Description | Type | Production Value |
|---|---|---|---|
| `SCHEDULER_SECRET` | Secret token matching the backend `SCHEDULER_SECRET` | 🔒 | Same value as backend web service |
| `LEADERBOARD_REFRESH_BASE_URL` | Base URL for leaderboard refresh cron | 🌐 | `https://locked-in-backend-oetf.onrender.com` |
| `LAPSE_SWEEP_BASE_URL` | Base URL for lapse sweep cron | 🌐 | `https://locked-in-backend-oetf.onrender.com` |
| `ARENA_SWEEP_BASE_URL` | Base URL for Arena expiry and season crons | 🌐 | `https://locked-in-backend-oetf.onrender.com` |
| `POT_CYCLE_BASE_URL` | Base URL for monthly pot cycle cron | 🌐 | `https://locked-in-backend-oetf.onrender.com` |
| `LEADERBOARD_SNAPSHOT_PAGE_SIZE` | Page size for snapshot generation | ⚙ | `25` (pinned in `render.yaml`) |

### C. Vercel Frontend (`web-app`)

All frontend variables use the `NEXT_PUBLIC_*` prefix and are bundled into client code. None are secrets.

| Variable Name | Description | Production Value |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Backend Fastify API base URL | `https://locked-in-backend-oetf.onrender.com` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy application identifier | `cmncshird026v0cl5n6yqq8z0` |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | Solana network cluster | `mainnet-beta` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Domain-restricted Helius HTTP RPC URL | Domain-locked client RPC endpoint |
| `NEXT_PUBLIC_SOLANA_WS_URL` | Domain-restricted Helius WebSocket URL | Domain-locked client WSS endpoint |
| `NEXT_PUBLIC_VAULT_V2_PROGRAM_ID` | Mainnet v2 vault program ID (enables v2 app mode) | `FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6` |
| `NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID` | Legacy v1 lock vault program ID (used only by the legacy, non-v2 code path) | Currently the devnet ID `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav` |
| `NEXT_PUBLIC_LOCK_VAULT_USDC_MINT` | Mainnet USDC token mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `NEXT_PUBLIC_KAMINO_SCOPE_PRICES` | Kamino Scope oracle price feed account | `3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH` |

---

## 7. Helius Two-Key Architecture

To prevent API key exposure and abuse, the project uses two distinct Helius RPC configurations:

1. **Backend Server Key (`SOLANA_RPC_URL`, `YIELD_KAMINO_RPC_URL`):**
   - Private key used strictly on the server for transaction submissions, balance queries, and Kamino reserve reads.
   - **Never** put this key in any `NEXT_PUBLIC_*` variable or frontend bundle.
2. **Frontend Client Key (`NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_WS_URL`):**
   - Public key embedded into client code.
   - Locked in the Helius dashboard under **Allowed Domains** to exactly:
     - `lockedin.quest`
     - `www.lockedin.quest`
     - `locked-in-test-env.vercel.app`
   - **Rule:** If any new frontend custom domain is added, add it to Helius Allowed Domains immediately or client RPC requests will fail.

---

## 8. Wallets and Key Roles

- **`LOCK_VAULT_WORKER_PRIVATE_KEY` (Backend):**
  - Acts as the on-chain vault authority.
  - Signs Ed25519 completion vouchers when learners finish courses.
  - Dispenses a one-time 0.005 SOL onboarding gas stipend to new user wallets (capped at 200 total wallets).
  - Must remain funded with a modest balance of SOL.
- **`COMMUNITY_POT_WORKER_PRIVATE_KEY` (Backend):**
  - Acts as the community pot authority.
  - Signs monthly on-chain distribution transactions (`record_redirect`, `close_distribution_window`, `distribute_window`).
  - Must remain funded with a modest balance of SOL for transaction fees and account rent.
- **`DEPLOYER_PRIVATE_KEY` (Offline):**
  - Program upgrade authority for the Anchor smart contracts.
  - Held in a secure offline wallet by the project owner.
  - **Never** configure this key on Render. Backend boot guards will refuse to boot if `DEPLOYER_PRIVATE_KEY` is present in the environment.
- **Render Cron Jobs:** Cron containers must never hold private keys or database credentials.

---

## 9. Post-Deploy Verification Checklist

After deploying changes, verify the system following these steps:

1. **Backend Health Check:**
   `curl https://locked-in-backend-oetf.onrender.com/health`
   Should return: `{"ok":true,"databaseConfigured":true}`
2. **Frontend Availability:**
   Open `https://lockedin.quest` and `https://www.lockedin.quest`. Confirm the site loads and the Privy login interface appears.
3. **Authentication Flow:**
   Log in with Google or a Solana wallet. Confirm that session verification succeeds and redirects to the v2 dashboard.
4. **Course Catalog:**
   Confirm courses and lessons appear on the dashboard.
5. **Live APY Status:**
   Check `https://locked-in-backend-oetf.onrender.com/v1/yield/current-apy`. Confirm `"live": true` and valid APY numbers from Kamino are returned.
6. **Database Migration State:**
   In `backend/`, run `npm run migrate:dry-run` against production. Verify that 0 migrations are pending.
7. **Cron Triggers:**
   In the Render dashboard, trigger a manual run of `locked-in-leaderboard-snapshot-refresh` and confirm the backend logs record a successful refresh.

---

## 10. Known Gaps

1. **Monitoring:** UptimeRobot checks `/health` every 5 minutes and emails the owner on failure. There is no error tracking service (such as Sentry) yet.
2. **Database Backups:** Supabase runs on the Free plan, which does not include automated scheduled backups.
3. **Pot Distributions:** Monthly community pot payouts are initiated by a single hot worker key; the on-chain program does not independently verify recipient addresses.
4. **Force-Return Crank:** The permissionless force-return rescue script (`backend/scripts/force-return-crank.mjs`) is implemented but not yet scheduled as a recurring Render cron.
5. **Documentation Hierarchy:** Numbered specification files in `docs/` (00 to 10) predate v2 architecture. The current codebase, `README.md`, and `HANDOFF.md` represent the authoritative source of truth.

---

## 11. Do-Not-Touch Operational Rules

- **NEVER** place the backend Helius RPC key or any private key in `NEXT_PUBLIC_*` environment variables.
- **NEVER** configure database credentials or private keys on Render cron jobs.
- **NEVER** enable `DEV_TOOLS_ENABLED` or `FAUCET_ENABLED` on mainnet.
- **NEVER** increase the on-chain deposit limits (10 to 50 USDC) or global TVL cap (1,000 USDC) without a comprehensive security review and audit.
- **NEVER** place `DEPLOYER_PRIVATE_KEY` on Render.
