# Locked In — Deployment Handoff

> Handoff doc for deploying **Locked In** (Vercel frontend + Render backend/cron/DB).
> Written for a teammate (or their coding agent) with Vercel + Render access.
> **Secret values are NOT in this file** — they will be sent to you privately. This file
> lists every variable *name*, what it is, and where it goes.

---

## 🚨 READ FIRST — this is a DEVNET deployment, do NOT switch to mainnet

This app custodies tokens via a Solana program. A full mainnet-readiness audit found
**hard blockers** (simulated yield paid as real USDC, single-key program upgrade authority,
no prod DB migration runner, unlock path never validated on a real cluster). **Real money
must NOT be used yet.**

**Keep everything on devnet:**
- `NEXT_PUBLIC_SOLANA_CLUSTER=devnet`
- Use the **devnet** USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (NOT mainnet `EPjFW…`)
- Use **devnet** program ID `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav`

If you ever consider mainnet, stop and talk to Marcus first. (Full audit summary at the
bottom of this doc.)

---

## 1. What this is / topology

```
                ┌──────────────────────────┐
   Browser ───► │  Vercel: web-app (Next.js)│  NEXT_PUBLIC_* only (public)
                └─────────────┬────────────┘
                              │ HTTPS  (NEXT_PUBLIC_API_URL)
                              ▼
                ┌──────────────────────────┐
                │  Render: backend (Fastify)│  node src/server.mjs  (port from $PORT)
                │  https://locked-in-backend-oetf.onrender.com
                └──────┬──────────────┬─────┘
                       │              │
            ┌──────────▼───┐    ┌─────▼───────────────┐
            │ Render Postgres│    │ Render Cron          │
            │ (DATABASE_URL) │    │ leaderboard refresh  │  (render.yaml Blueprint)
            └────────────────┘    │ daily 00:00 UTC      │
                                  └──────────────────────┘

  External services: Privy (wallet auth), Solana devnet RPC (Alchemy, server-side),
                     OpenAI (optional answer grading), Dungeon iframe (separate Vercel static deploy)
```

| Component | Platform | Tech | Notes |
|---|---|---|---|
| **web-app** | **Vercel** | Next.js 16 (`next build` / `next start`) | the user-facing app |
| **backend** | **Render** (web service, dashboard-managed) | Fastify, Node ≥ 20, `node src/server.mjs` | API at `https://locked-in-backend-oetf.onrender.com` |
| **leaderboard cron** | **Render** (Blueprint) | `npm run cron:leaderboard-refresh` | defined in `render.yaml`, daily 00:00 UTC |
| **database** | **Render Postgres** (or Supabase) | Postgres 16 | schema in `backend/sql/*.sql` |
| **dungeon** | **Vercel** (separate static deploy) | Three.js | `https://dungeon-vert.vercel.app` — usually no action needed |

---

## 2. Branch / what to deploy

- Deploy from **`master`** (Marcus is merging the `cost-reduction` branch into master).
- `render.yaml` (the cron Blueprint) is **already committed** in the repo.
- The backend web service + Postgres on Render **already exist** (dashboard-managed). For most
  deploys you only need to: confirm they build from `master`, review env vars, redeploy.

---

## 3. Deploy steps

### A. Backend — Render web service (existing)
1. Service should already exist (`locked-in-backend-oetf`). Confirm:
   - **Root dir:** `backend`
   - **Build:** `npm ci`
   - **Start:** `npm start` (→ `node src/server.mjs`)
   - **Branch:** `master`
2. Set/verify env vars (see **§5 Backend env**). Most matter; `PRIVY_APP_ID` + `PRIVY_APP_SECRET`
   are required for login and are **not** in `.env.example`.
3. Apply DB migrations (see **§3D**) — at minimum the pending `0039`.
4. Redeploy. Verify `GET /health` returns `{ "ok": true, "databaseConfigured": true }`.

### B. Leaderboard cron — Render Blueprint  *(the piece Marcus set up locally)*
Marcus added the Render Blueprint locally:
- **New** `render.yaml` (repo root)
- Updated `docs/09-leaderboard.md:98`

It defines this cron service:
```yaml
name: locked-in-leaderboard-snapshot-refresh
schedule: "0 0 * * *"
rootDir: backend
startCommand: npm run cron:leaderboard-refresh
```

The Render *live* setup still needs **one dashboard step** (Marcus's local Render token is
expired and the cron needs the production `SCHEDULER_SECRET`):

1. In Render: **New → Blueprint**, point it at this repo (branch `master`).
2. Use `render.yaml`.
3. When prompted, set:
   - `SCHEDULER_SECRET` = **same value as the backend web service** (sent privately)
   - `LEADERBOARD_REFRESH_BASE_URL` = your backend URL, likely
     `https://locked-in-backend-oetf.onrender.com`
   - (`LEADERBOARD_SNAPSHOT_PAGE_SIZE` is already pinned to `25` in the Blueprint)
4. **Keep the backend web service env `LEADERBOARD_SNAPSHOT_ENABLED=false`** — the cron owns
   the refresh; the in-process worker stays off.

> `render.yaml` was verified to parse locally. `render blueprints validate` could not run
> because the Render CLI auth is expired — validate via the dashboard sync.

### C. Frontend — Vercel
1. Project root: `web-app`. Framework preset: **Next.js**. Build `next build`, output handled by Vercel.
2. Branch: `master`.
3. Set env vars (see **§6 Frontend env**) — all `NEXT_PUBLIC_*`, all non-secret.
4. **Critical:** `NEXT_PUBLIC_SOLANA_RPC_URL` must be the **public** devnet endpoint
   (`https://api.devnet.solana.com`) — **never** the Alchemy key. `NEXT_PUBLIC_*` ships to the
   browser; the Alchemy key is server-side only (backend `SOLANA_RPC_URL`).
5. After deploy, copy the Vercel URL into the backend's `CORS_ALLOWED_ORIGINS`.

### D. Database + migrations  ⚠️ no automatic runner yet
There is **no production migration runner** — migrations only auto-apply in test/CI. You must
apply SQL by hand to the prod Postgres. The schema lives in `backend/sql/*.sql` (numbered).

- The prod DB already exists and has most of the schema. The **known pending** migration is
  `backend/sql/0039_drop_skr_columns.sql`. Apply it:
  ```bash
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/sql/0039_drop_skr_columns.sql
  ```
- If you're provisioning a **fresh** DB, apply all files in order (they're mostly idempotent —
  `IF [NOT] EXISTS`):
  ```bash
  for f in $(ls backend/sql/*.sql | sort); do
    echo ">> $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f";
  done
  ```
  `sql/0002_seed_dev_release.sql` seeds the starter course content — needed for the app to show courses.
- Do **not** re-run the full set against the existing prod DB blindly; apply only files newer
  than what's already applied (at minimum `0039`).

---

## 4. Secrets Marcus will send you privately

Set these in the **Render backend web service** (and `SCHEDULER_SECRET` also in the cron):

- [ ] `DATABASE_URL` — Postgres connection string (or use Render's linked DB var)
- [ ] `JWT_SECRET` — long random string
- [ ] `SCHEDULER_SECRET` — long random string (**same value** in backend + cron)
- [ ] `PRIVY_APP_SECRET` — Privy server secret (login breaks without it)
- [ ] `SOLANA_RPC_URL` — Alchemy **devnet** RPC URL (server-side only)
- [ ] `OPENAI_API_KEY` — only if enabling hybrid answer grading (optional)
- [ ] worker keys (`LOCK_VAULT_WORKER_PRIVATE_KEY`, `COMMUNITY_POT_WORKER_PRIVATE_KEY`,
      `DEPLOYER_PRIVATE_KEY`) — **only if** you enable the relay/indexer/funding workers
      (they're OFF by default — you likely don't need these for a basic deploy)

Everything else below is non-secret (public devnet values / config defaults) and is safe to
type in directly.

---

## 5. Backend env (Render web service)

Legend: 🔒 = secret (sent privately) · 🌐 = public/safe · ⚙ = config default

| Variable | Value / source | Type |
|---|---|---|
| `DATABASE_URL` | Postgres conn string | 🔒 |
| `JWT_SECRET` | long random | 🔒 |
| `SCHEDULER_SECRET` | long random (matches cron) | 🔒 |
| `PRIVY_APP_ID` | `cmncshird026v0cl5n6yqq8z0` (same as frontend) | 🌐 |
| `PRIVY_APP_SECRET` | Privy server secret | 🔒 |
| `SOLANA_RPC_URL` | Alchemy **devnet** URL | 🔒 |
| `LOCK_VAULT_PROGRAM_ID` | `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav` | 🌐 |
| `COMMUNITY_POT_PROGRAM_ID` | `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav` (same merged program) | 🌐 |
| `LOCK_VAULT_USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (devnet USDC) | 🌐 |
| `CORS_ALLOWED_ORIGINS` | your Vercel URL(s), comma-separated (e.g. `https://<app>.vercel.app`) | 🌐 |
| `HOST` | `0.0.0.0` | ⚙ |
| `PORT` | set automatically by Render — don't hardcode | ⚙ |
| `LOG_LEVEL` | `info` | ⚙ |
| `JWT_ISSUER` | `lockedin-api` | ⚙ |
| `JWT_AUDIENCE` | `lockedin-mobile` | ⚙ |
| `ACCESS_TOKEN_TTL` | `15m` | ⚙ |
| `REFRESH_TOKEN_TTL` | `30d` | ⚙ |
| `LEADERBOARD_SNAPSHOT_ENABLED` | **`false`** (cron owns refresh) | ⚙ |
| `LEADERBOARD_SNAPSHOT_PAGE_SIZE` | `25` | ⚙ |
| `YIELD_STRATEGY_ENABLED` | `false` | ⚙ |
| `YIELD_STRATEGY_PROFILE` | *(blank)* | ⚙ |
| `LOCK_VAULT_RELAY_ENABLED` | `false` | ⚙ |
| `UNLOCK_INDEXER_ENABLED` | `false` | ⚙ |
| `RUNTIME_SCHEDULER_ENABLED` | `false` | ⚙ |
| `REDEMPTION_VAULT_AUTOFUND_ENABLED` | `false` | ⚙ |
| `FAUCET_ENABLED` | `true` to airdrop test SOL+USDC to new users (devnet), else `false` | ⚙ |
| `FAUCET_ROUND` | `1` (bump to let users re-claim) | ⚙ |
| `ANSWER_VALIDATOR_HYBRID_ENABLED` | `false` (set `true` only with `OPENAI_API_KEY`) | ⚙ |
| `OPENAI_API_KEY` | OpenAI key (only if hybrid grading on) | 🔒 |
| `OPENAI_VALIDATOR_MODEL` | `gpt-5-nano` | ⚙ |
| `LOCK_VAULT_WORKER_PRIVATE_KEY` | only if relay enabled | 🔒 |
| `COMMUNITY_POT_WORKER_PRIVATE_KEY` | only if pot worker enabled | 🔒 |
| `DEPLOYER_PRIVATE_KEY` | only if funding scripts run on server | 🔒 |

> Full reference with all tunables: `backend/.env.example`. Note `PRIVY_APP_ID` /
> `PRIVY_APP_SECRET` are **missing** from that example file but are required — set them.

---

## 6. Cron env (Render Blueprint)

| Variable | Value | Type |
|---|---|---|
| `SCHEDULER_SECRET` | **same as backend** | 🔒 |
| `LEADERBOARD_REFRESH_BASE_URL` | `https://locked-in-backend-oetf.onrender.com` | 🌐 |
| `LEADERBOARD_SNAPSHOT_PAGE_SIZE` | `25` (pinned in `render.yaml`) | ⚙ |

---

## 7. Frontend env (Vercel) — all `NEXT_PUBLIC_*`, all public

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://locked-in-backend-oetf.onrender.com` |
| `NEXT_PUBLIC_DUNGEON_URL` | `https://dungeon-vert.vercel.app` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | `cmncshird026v0cl5n6yqq8z0` |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | `https://api.devnet.solana.com`  ← **public, NOT Alchemy** |
| `NEXT_PUBLIC_SOLANA_WS_URL` | `wss://api.devnet.solana.com` |
| `NEXT_PUBLIC_LOCK_VAULT_PROGRAM_ID` | `3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav` |
| `NEXT_PUBLIC_LOCK_VAULT_USDC_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

> Full reference: `web-app/.env.example`. You can also `vercel env pull .env` to sync.

---

## 8. Post-deploy verification

1. **Backend health:** `curl https://locked-in-backend-oetf.onrender.com/health`
   → `{"ok":true,"databaseConfigured":true}`
2. **Frontend loads:** open the Vercel URL; the app should render and the Privy login should
   appear (proves `PRIVY_APP_ID` + backend `PRIVY_APP_SECRET` + CORS are all set).
3. **Login works end-to-end:** connect a wallet → you should reach the dashboard (proves CORS +
   Privy server verification).
4. **Courses show:** if the dashboard is empty, the DB seed (`0002_seed_dev_release.sql`) didn't run.
5. **Cron:** in Render, trigger the cron once manually; backend logs should show a leaderboard
   refresh. Then check the leaderboard page loads without timing out.
6. **Migrations:** confirm `0039` applied — `skr_locked_amount` column should be gone from
   `lesson.user_course_runtime_state`.

---

## 9. Known issues / do-NOT-touch

- **Leaderboard:** keep `LEADERBOARD_SNAPSHOT_ENABLED=false` on the web service — the **cron**
  refreshes the snapshot. If no snapshot exists yet, the live endpoint falls back to slow
  per-account RPC (can time out); running the cron once fixes it.
- **DB migrations are manual** — there's no runner. Apply new `sql/*.sql` files by hand on each
  schema change (see §3D). At minimum apply `0039` now.
- **Background workers are intentionally OFF** (relay, unlock indexer, runtime scheduler, yield,
  redemption autofund). Don't enable them without Marcus — several need the secret worker keys
  and only matter for the (not-yet-live) on-chain money flows.
- **Stay on devnet.** See the warning at the top.

---

## 10. Mainnet-readiness audit summary (why we're devnet-only)

Independent audit blockers, for context — **do not attempt mainnet** until resolved:

1. **Single-key program upgrade authority** — a compromised deployer key could replace the
   custody program and drain funds. Needs a Squads multisig.
2. **Simulated yield paid as real USDC** from an unbacked treasury — only safe today because
   payout paths are hard-gated to devnet. Mainnet without real Kamino integration = insolvent.
3. **Misleading copy** — onboarding says Ichor "redeems for real USDC"; it does not. Must fix.
4. **No prod DB migration runner** (see §3D).
5. **Unlock (principal return) never validated on a real cluster** — only in simulation.
6. **Leaderboard** N+1 RPC fallback (mitigated by the cron snapshot).
7. **No third-party security audit** of the custody program.

**What IS solid:** custody contract constraints (owner-gated unlock, vault bound to PDA,
fake-mint/fake-vault blocked, checked math), secrets hygiene (nothing sensitive committed,
Alchemy key server-side only), and the clean devnet/mainnet env split.

The recommended v1 direction is a **commitment/savings device** (lock principal, return 1:1,
treat all yield/ichor/fuel as cosmetic off-chain points) — which the current code already
supports on devnet.

---

*Questions → Marcus. Secrets will be shared privately, not in this repo.*
