# Locked In — Mainnet Deploy Runbook (A → Z)

Everything buildable/testable was prepared on branch `feat/mainnet-prep-real-kamino`.
This runbook is the ordered path from "asleep" to "live on mainnet."

**Legend:** `[YOU]` = you must do it (secrets, hardware, real money). `[RUN]` =
run the prepared script/command. `[⚠]` = safety-critical, do not skip.

---

## 0. What is already done (no action)

- ✅ Real Kamino deposit→claim **proven** on a surfpool mainnet fork with the
  actual mainnet build artifact (`docs/real-kamino-fork-proof.md`).
- ✅ Client injects `refresh_reserve` for real klend; backend reads the live
  klend exchange rate; active USDC reserve pinned.
- ✅ Mainnet program id generated: **`FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6`**
  (keypair held at `keys/mainnet/…`, gitignored — BACK IT UP).
- ✅ Monthly community-pot cycle automated (Render cron, `render.yaml`).
- ✅ Deploy/init scripts + env templates written.
- ✅ All tests green (backend 299, web-app 212 unit + e2e/visual, fork proof).

## 1. Prerequisites you must have `[YOU]`

- A **paid mainnet RPC** (Helius/Triton) — public RPC will be rate-limited.
- A **funded deploy wallet** keypair (~8 SOL for program deploy + rent).
- A **Squads multisig** (2-of-3) — this is the `[⚠]` key ceremony; do it with
  your co-signers/hardware wallets. You need its vault address.
- An **ops voucher key** (a fresh keypair). Its pubkey = `VAULT_AUTHORITY`
  (on-chain) and its bs58 secret = `LOCK_VAULT_WORKER_PRIVATE_KEY` (Render).
  These MUST correspond — `claim_v2` verifies every voucher against
  `config.authority`. Keep it DISTINCT from the deploy/upgrade key.

## 2. Merge the prepared branch `[RUN]`

```bash
cd /Users/ongeeshen/Project/locked-in
git checkout master && git merge feat/mainnet-prep-real-kamino
```

## 3. `[⚠][YOU]` Squads multisig ceremony

Create/confirm the Squads 2-of-3 vault. Record the **vault address** — it will
be the program upgrade authority, and the owner of the pot + fee vaults. This
is the single most important safety step; a single hot key controlling upgrade
+ treasury is the #1 blocker in `docs/mainnet-readiness-checklist.md`.

## 4. Build the mainnet program `[RUN]`

```bash
scripts/deploy/build-mainnet-program.sh
# bakes declare_id = FAuFtX…, restores the repo to devnet 3RC9 afterward
```

## 5. Fund + deploy the program `[YOU]` fund, `[RUN]` deploy

```bash
# fund the deploy wallet with ~8 SOL first, then:
MAINNET_RPC_URL=https://<paid-rpc> DEPLOY_KEYPAIR=<deploy-wallet.json> \
  scripts/deploy/deploy-mainnet.sh
```

## 6. `[⚠][RUN]` Transfer upgrade authority to Squads

```bash
solana program set-upgrade-authority FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6 \
  --keypair <deploy-wallet.json> --new-upgrade-authority <SQUADS_VAULT> \
  --url https://<paid-rpc>
```
Do NOT leave the hot deploy wallet as upgrade authority.

## 7. Initialize the vault config `[RUN]`

```bash
# resolve the real reserve account set (writes /tmp/reserve.json)
node backend/scripts/resolve-kamino-usdc-reserve.mjs https://<paid-rpc> /tmp/reserve.json

# init: VAULT_AUTHORITY = pubkey of your ops voucher key;
# pot/fee owners = the Squads vault (distinct vaults are created for it).
MAINNET_RPC_URL=https://<paid-rpc> DEPLOY_KEYPAIR=<deploy-wallet.json> \
  VAULT_AUTHORITY=<ops-key-pubkey> \
  POT_VAULT_OWNER=<SQUADS_VAULT> FEE_VAULT_OWNER=<SQUADS_VAULT> \
  RESERVE_JSON=/tmp/reserve.json \
  node scripts/deploy/init-mainnet-vault.mjs
```
(The payer must be the current upgrade authority at init time — so init BEFORE
step 6, or run init from the Squads vault after. Simplest: init in step 5's
window, then transfer authority in step 6.)

## 8. Backend env + deploy `[YOU]`

Fill `scripts/deploy/env.mainnet.backend.template` into Render (secrets via
`sync:false`). Key values: `SOLANA_RPC_URL` (paid, non-'devnet'),
`VAULT_V2_PROGRAM_ID=FAuFtX…`, `YIELD_STRATEGY_PROFILE=kamino_usdc_mainnet`,
`LOCK_VAULT_WORKER_PRIVATE_KEY` = your ops key (pubkey must equal
`VAULT_AUTHORITY` from step 7), fresh `JWT_SECRET`/`SCHEDULER_SECRET` (≥32 bytes).
The backend refuses to boot on a mainnet RPC with dev-fallback secrets or a
dev/mock yield profile. Then deploy backend (git push / Render deploy).

## 9. Apply the pot cron blueprint `[YOU]`

Apply `render.yaml` as a Render Blueprint (adds `locked-in-pot-cycle`, monthly).
Set its `SCHEDULER_SECRET` + `POT_CYCLE_BASE_URL`. No further action — it closes
+ distributes the previous UTC month automatically.

## 10. Frontend env + deploy `[YOU]`

Fill `scripts/deploy/env.mainnet.frontend.template` into Vercel:
`NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`, `NEXT_PUBLIC_SOLANA_RPC_URL`,
`NEXT_PUBLIC_VAULT_V2_PROGRAM_ID=FAuFtX…`, real USDC mint, scope oracle. Then
**git push** (NEXT_PUBLIC_* bake at build — `vercel redeploy` alone won't rebuild env).

## 11. DB migrations `[RUN]`

```bash
cd backend && DATABASE_URL=<prod> npm run migrate
```

## 12. Smoke test `[RUN]`

- `/v1/courses` returns courses; `/v1/yield/current-apy` returns the live
  Kamino APY (~4-6%, NOT 0% and NOT a hardcoded 8%).
- Connect a wallet with real USDC, deposit the minimum ($10) on a course,
  complete a lesson, confirm the position value tracks, claim after completion.
  Use YOUR OWN funds first.

## 13. `[⚠]` Guardrails already in place

- On-chain caps: $10 min / $50 max per lock / $1,000 global TVL.
- Do YOUR-funds-first for ~1 week before raising caps or announcing.
- Kill switch: `set_config_v2(..., paused=true)` halts new deposits (claims
  always work).

## 14. Rollback

- Program bug pre-funds: pause via `set_config_v2`. Principal is always
  claimable (owner-only redeem); no admin drain path.
- Frontend/backend: revert the env flip + redeploy (points back at devnet
  staging `3RC9…`).

---

## What is NOT one-click (honest gaps)

- **`[⚠]` No external audit.** You are routing real USDC into a lending
  protocol. The fork proof certifies the tx shape, not economic safety at scale.
- **`[⚠]` Multisig ceremony is manual** (step 3) — hardware + co-signers.
- **Monitoring** (Sentry/alerts) is not wired — you will learn of failures from
  logs/users until added.

These are the reasons "fund + deploy = done" is the *minimal* launch, not the
*safe-at-scale* launch. Start tiny, your own funds, caps on.
