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
- A **funded deploy wallet** keypair (**~3.7 SOL** — the 505 KB program's data
  rent is ~3.6 SOL, recoverable if you ever close the program; the rest is fees
  + init-account rent). Deploys at 1x (`solana program deploy` default) with
  zero upgrade headroom — pass `--max-len` if you want room to patch a larger
  binary later.
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
# fund the deploy wallet with ~3.7 SOL first, then:
MAINNET_RPC_URL=https://<paid-rpc> DEPLOY_KEYPAIR=<deploy-wallet.json> \
  scripts/deploy/deploy-mainnet.sh
```

## 6. Initialize the pot + vault `[RUN]` — BEFORE the authority transfer

Both inits require the payer/authority relationships below; `initialize_vault_v2`
needs the payer to be the program's CURRENT upgrade authority (the deploy wallet
after step 5), so do all of step 6 now, then transfer in step 7.

**6a. Community-pot config** (creates the `pot-protocol` PDA). Two distinct
keys, mirroring 6b: the SIGNER is the deploy wallet (the on-chain front-run
gate requires the program's current upgrade authority), and
`POT_AUTHORITY_PUBKEY` — stored as `PotConfig.authority` — MUST be the pubkey
of the backend's `COMMUNITY_POT_WORKER_PRIVATE_KEY`; the pot cycle refuses to
run otherwise.

```bash
MAINNET_RPC_URL=https://<paid-rpc> DEPLOY_KEYPAIR=<deploy-wallet.json> \
  POT_AUTHORITY_PUBKEY=<ops-relay-pubkey> \
  CONFIRM_POT_AUTHORITY=<ops-relay-pubkey again — double-entry guard> \
  node scripts/deploy/init-mainnet-pot.mjs
```

If the stored authority is ever wrong anyway, `set_pot_authority` (signed by
the current upgrade authority — the Squads vault after step 7) rotates it
without a program upgrade.

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

**Scope oracle — one value, two variable names.** If you override the Kamino
scope-prices account (i.e. you pinned a reserve other than the default main-market
USDC one), it must be set for BOTH sides or they refresh different oracles for
the same reserve:

- frontend (Vercel): `NEXT_PUBLIC_KAMINO_SCOPE_PRICES` — read by
  `web-app/services/solana/vaultV2.ts` (deposit/claim).
- backend/ops scripts: `KAMINO_SCOPE_PRICES` — read by
  `backend/scripts/force-return-crank.mjs`, which also **falls back to
  `NEXT_PUBLIC_KAMINO_SCOPE_PRICES`** so a shell that only has the documented
  frontend name still cranks against the right oracle. Setting the backend name
  explicitly is still preferred; it wins when both are present.

Leaving it unset on both sides is fine — they share the same default.

## 9. Apply the cron blueprint `[YOU]`

Apply `render.yaml` as a Render Blueprint — it defines THREE crons, all of
which must be configured or real money behavior silently breaks:

- `locked-in-pot-cycle` (daily 03:00 UTC): set `SCHEDULER_SECRET` +
  `POT_CYCLE_BASE_URL`. Closes + distributes the previous UTC month.
- `locked-in-lapse-sweep` (daily): set `SCHEDULER_SECRET` +
  `LAPSE_SWEEP_BASE_URL`. This is the ONLY miss judge off-devnet (the
  in-process worker refuses to start on mainnet) — without it, lapse
  penalties are never applied and every voucher pays full yield.
- `locked-in-leaderboard-snapshot-refresh`: set `SCHEDULER_SECRET` +
  `LEADERBOARD_REFRESH_BASE_URL`.

## 10. Frontend env + deploy `[YOU]`

Fill `scripts/deploy/env.mainnet.frontend.template` into Vercel:
`NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`, `NEXT_PUBLIC_SOLANA_RPC_URL`,
`NEXT_PUBLIC_SOLANA_WS_URL` (**replace the stale devnet wss**),
`NEXT_PUBLIC_VAULT_V2_PROGRAM_ID=FAuFtX…`, real USDC mint, scope oracle; confirm
`NEXT_PUBLIC_E2E_TX_STUB` is absent. Then **git push** (NEXT_PUBLIC_* bake at
build — `vercel redeploy` alone won't rebuild env).

⚠ The FRONTEND cluster detection fails OPEN to devnet: if
`NEXT_PUBLIC_SOLANA_CLUSTER` is unset and the RPC hostname doesn't contain
"mainnet" (Triton/custom domains don't), the UI shows devnet chrome (dev
button, "· devnet" APY suffix). The backend fails closed, so no money risk —
but set the cluster var explicitly, always.

## 11. DB migrations `[RUN]`

```bash
cd backend && DATABASE_URL=<prod> npm run migrate
```

## 11a. `[RUN]` Content-fix report — check for unresolved findings

Migration `0057_fix_false_content_claims.sql` corrects live course content that
misstates custody and risk (it claims deposits are diversified across Kamino
*and* Marginfi, and that funds stay "safe and accessible" through another
interface — both false). Its patterns are matched against stored jsonb, so
content drift can make a pattern miss silently.

It no longer aborts the migration when that happens — a stale string match must
not kill an unrelated deploy — it records the finding instead. **Check it after
every migrate run:**

```bash
psql "<prod>" -c "select migration, ran_at, unresolved_count, detail
                    from lesson.content_fix_reports
                   order by ran_at desc limit 5"
```

`unresolved_count = 0` on the latest row is the pass condition. Anything else
means false content may still be served: rewrite 0057's patterns against the
current stored jsonb and re-apply. (A pattern that matched and survived the
replace, or a graded key that disagrees with its own option rows, still hard-fails
the migration — those can only be bugs in the file itself.)

## 11b. `[⚠][RUN]` Cutover reset — purge devnet user state

**Mainnet reuses the SAME Postgres as devnet-prod.** There is no fresh
database. That is a deliberate decision, and it is only safe because of this
step. Run it after migrations and **before the first real deposit**.

**Why you must not skip this.** Completion vouchers are derived purely from DB
rows: `issueCourseCompletionVoucher` reads `user_course_runtime_state.
course_completed_at` and `.lapse_count` and never asks the chain which cluster
that progress was earned on. So every devnet row is silently treated as
mainnet truth. Concretely: any wallet that finished a course on devnet is
permanently `COURSE_COMPLETED` and can **never deposit on that course again**
— and only 3 courses have real content, so that is most of the product; devnet
`lapse_count` is embedded in the signed voucher and **cuts a real user's real
payout** with no way to appeal; `sol_drips.wallet_address` is `UNIQUE` with no
round column, so a devnet-dripped wallet can never receive the mainnet drip and
lands with 0 SOL and no way to pay fees; and devnet XP/streaks become the
mainnet leaderboard. None of this surfaces as an error — it looks like the
product working correctly, on a user who has lost money.

Dry run first (default; writes nothing, prints exact per-table counts):

```bash
cd backend && DATABASE_URL=<prod> node scripts/mainnet-cutover-reset.mjs
```

Then execute. Both confirmations are required and are checked against the
database you are actually connected to:

```bash
DATABASE_URL=<prod> node scripts/mainnet-cutover-reset.mjs --execute \
  --confirm-target <host>/<database> \
  --confirm "PURGE DEVNET USER STATE"
```

It purges per-user/per-cluster state (progress, attempts, runtime state,
vouchers, enrollments, XP, receipts, faucet + SOL drips, leaderboard snapshots,
pot accounting, devnet chain cursors, auth sessions) in ONE transaction, and
preserves **all** content — courses, modules, lessons, questions,
`published_*`, `publish_releases`. Content rows are counted before and after
inside that transaction and any drift aborts the whole thing, so a bad edit to
the table list cannot quietly eat the catalog.

Notes:
- It is deliberately **not** a migration. `npm run migrate` runs unattended on
  every deploy; this deletes user data and may only run under a human.
- Run it as a role that can **bypass RLS** (table owner with `BYPASSRLS`, or
  superuser). The `user_*` tables use `FORCE ROW LEVEL SECURITY` keyed on a JWT
  wallet claim, so an ordinary app role's `DELETE` matches **zero rows and
  reports success** — verified: `DELETE 0` while the rows are still there. The
  script sets `row_security = off` so this fails loudly instead of leaving you
  believing the cutover ran.
- `lesson.user_consents` is **not** purged — it is the record that a wallet
  accepted a terms version, and deleting it destroys that audit trail. The
  script prints it every run so the call stays explicit. If mainnet ships a new
  `terms_version`, the old rows do not satisfy it and no purge is needed.
- If you ever re-point at devnet and back, run it again — it is idempotent.

## 11c. `[⚠][RUN]` Pre-flight check — env + on-chain must agree

Read-only. Run it AFTER init (step 6), the env is set (steps 8/10), migrations
(11) and the cutover reset (11b), and BEFORE the first real deposit. It mirrors
the boot guards and decodes the live on-chain config, so a misconfig surfaces
here instead of after money is in flight. It must print `0 FAIL`.

```bash
cd backend && node scripts/mainnet-preflight-check.mjs \
  --backend-env  ../scripts/deploy/env.mainnet.backend.filled \
  --frontend-env ../scripts/deploy/env.mainnet.frontend.filled \
  --squads <SQUADS_VAULT_PUBKEY>
```

Fails loudly on the launch-killers: `config.authority != LOCK_VAULT_WORKER_
PRIVATE_KEY` (every voucher unclaimable), `PotConfig.authority != COMMUNITY_POT_
WORKER_PRIVATE_KEY` (pot cron refuses), non-canonical USDC mint, kaminoProgram
not klend, the upgrade authority still a hot key (pass `--squads` to assert the
handover landed), `DEV_TOOLS_ENABLED=true`, frontend program-id/mint/cluster
disagreeing with the backend, a devnet WS url, or devnet completion residue in
the DB. Resolve every FAIL, review every WARN, then proceed.

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

- Program bug pre-funds: pause via `set_config_v2`. Pausing stops new deposits;
  claims still work, and there is **no admin drain path** — the program can never
  move a user's principal to us.
- **`[⚠]` There is NO owner-only redeem.** Do not plan a rollback around one.
  `claim_v2` (`programs/locked_in/src/vault_v2.rs`) requires an ed25519
  completion voucher signed by the ops key, so a user cannot exit unaided while
  the backend is down or refusing to sign. The only non-voucher exit is
  `force_return_v2`, callable by anyone **180 days** after lock start
  (`FORCE_RETURN_AFTER_SECS`), and it settles at `user_yield_bps = 0`: principal
  returns to the owner, **all** yield goes to the community pot. Principal is
  therefore recoverable but not promptly and not by the owner alone. If the
  backend is down or the ops key is compromised, follow
  `docs/mainnet-emergency-runbook.md` — restoring voucher signing is the exit,
  not the chain.
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
