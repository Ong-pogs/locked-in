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

## 6. Initialize the pot + vault `[RUN]` — BEFORE the authority transfer

Both inits require the payer/authority relationships below; `initialize_vault_v2`
needs the payer to be the program's CURRENT upgrade authority (the deploy wallet
after step 5), so do all of step 6 now, then transfer in step 7.

**6a. Community-pot config** (creates the `pot-protocol` PDA). `POT_AUTHORITY_KEYPAIR`
MUST be the keypair whose bs58 secret is the backend's `COMMUNITY_POT_WORKER_PRIVATE_KEY`
— the pot cycle refuses to run otherwise.

```bash
MAINNET_RPC_URL=https://<paid-rpc> POT_AUTHORITY_KEYPAIR=<ops-relay.json> \
  node scripts/deploy/init-mainnet-pot.mjs
```

**6b. Vault config.** The pot vault is auto-derived as the pot-protocol PDA's
USDC ATA, so forfeited yield lands straight in the vault `distribute_window`
pays from — no funding bridge. `VAULT_AUTHORITY` = pubkey of your ops voucher
key (`LOCK_VAULT_WORKER_PRIVATE_KEY`); `FEE_VAULT_OWNER` = the Squads vault
(must differ from the pot-protocol PDA).

```bash
# resolve the real reserve account set (writes /tmp/reserve.json)
node backend/scripts/resolve-kamino-usdc-reserve.mjs https://<paid-rpc> /tmp/reserve.json

MAINNET_RPC_URL=https://<paid-rpc> DEPLOY_KEYPAIR=<deploy-wallet.json> \
  VAULT_AUTHORITY=<ops-voucher-key-pubkey> \
  FEE_VAULT_OWNER=<SQUADS_VAULT> \
  RESERVE_JSON=/tmp/reserve.json \
  node scripts/deploy/init-mainnet-vault.mjs
```

## 7. `[⚠][RUN]` Transfer upgrade authority to Squads

```bash
solana program set-upgrade-authority FAuFtXbTAT9SiJTghxdZ1ZD4ShgrdTk2EqgyPxfq2gZ6 \
  --keypair <deploy-wallet.json> --new-upgrade-authority <SQUADS_VAULT> \
  --url https://<paid-rpc>
```
Do NOT leave the hot deploy wallet as upgrade authority.

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

## Deferred audit follow-ups (non-blocking, nice-to-have)

The 2026-07-11 adversarial audit found 34 gaps; the HIGH + money-critical +
mainnet-functional ones are all fixed (commits `ae38202..298167d`). These
remain as polish and do not block a capped, own-funds-first launch:

- **M8/M9** — deposit form does not pre-check the global TVL cap or that the
  wallet holds enough SOL for fees before prompting a signature (the on-chain
  program still rejects an over-cap deposit; the tx just fails later).
- **M10** — deposit min/max/cap are hardcoded (10/50/1000) rather than decoded
  from the on-chain config; correct as long as init uses those values.
- **L1** — yield tick extrapolates at a fixed 5% with no staleness clamp.
- **L6** — claim confirmation gives up at 30s without a final history check.
- **L8** — two lesson-complete paths skip the server call (voucher issuance is
  still server-gated, so this is a local-state, not money-integrity, issue).
