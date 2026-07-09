# Locked In — Mainnet Readiness Checklist

> Scope: the merged `programs/locked_in` Anchor program + Fastify backend + Next.js PWA. Custody = real USDC principal. Current posture: **DEVNET-ONLY (correctly so).**

## 1. Verdict

**Not mainnet-ready. Not close.** The one subsystem that could credibly hold real money today is the non-custodial USDC lock vault (`programs/locked_in/src/vault.rs`) — owner-only unlock, immutable lock end, checked math, mint binding, no admin drain. Everything *around* it is not: the community pot is a custodial off-chain ledger with an on-chain payout rail and no on-chain fairness/backing; "yield" is fully simulated with no Kamino deposit behind it; and the entire fund-moving + program-upgrade authority collapses into a single plaintext hot key in a backend env var. The only thing standing between the current code and an insolvency/drain event on mainnet is a set of fragile `solanaRpcUrl.includes('devnet')` substring checks. On top of that, every money-deciding off-chain function and the on-chain USDC payout instruction have **zero test coverage**, and there has been **no external audit**. The project's own `HANDOFF.md` and memory say "do NOT switch to mainnet" — that stance is correct and must hold until the blockers below are closed.

## 2. 🔴 Blockers (must fix before ANY mainnet funds)

- [ ] **Upgrade authority and fund-moving worker key are the same secret (`DEPLOYER_PRIVATE_KEY`)** — one leaked env var can both replace the on-chain program with malicious bytecode AND drain the treasury/pot in the same breach. `backend/src/config.mjs:225-233` resolves `communityPotWorkerPrivateKey ?? lockVaultWorkerPrivateKey ?? DEPLOYER_PRIVATE_KEY`, and the deployer is the documented upgrade authority (`docs/devnet-e2e-playbook.md:69,104,152`). **Fix:** distinct per-role keys (cold/multisig upgrade authority, separate pot worker, separate treasury); delete the silent `??` fallback so a missing worker key fails closed; move upgrade authority to a Squads multisig.

- [ ] **Single backend hot key is both the pot distribution authority and a live treasury — no HSM/KMS/multisig** — a server/log/dependency/Render compromise drains the pot and sweeps treasury USDC/SOL. Pot signer at `backend/src/lib/communityPot.mjs:104-105` signs `distribute_window` (`:370-435`); treasury signer at `backend/src/lib/faucet.mjs:34` signs `transferUsdc`/`transferSol`; keys are plaintext bs58 in env (`config.mjs:225-233`). **Fix:** put pot + treasury authority behind a Squads multisig and/or KMS-backed signer where the raw secret never enters Node; scope treasury to a small float with a cold reserve; add outflow monitoring and value caps.

- [ ] **Program is upgradeable by a single keypair — god key over all custody, with no pause** — the upgrade authority can deploy bytecode that ignores every check in `vault.rs`/`pot.rs` and drains all principal + pot; a lost key means no patch path. `programs/locked_in/src/lib.rs:39`, `Anchor.toml`. **Fix:** set mainnet upgrade authority to a Squads multisig with timelock (or burn it post-audit + freeze); document and test the upgrade/migration path first.

- [ ] **Entire community pot is drainable by the single `authority` key with no on-chain caps or eligibility** — `distribute_window` signs as the `PotConfig` PDA and transfers USDC to an arbitrary `recipient: UncheckedAccount`, gated only by `has_one = authority`; payout amount, recipient, and the cap itself are all author-controlled. `programs/locked_in/src/pot.rs:137-200, 278-332`. **Fix:** multisig/governance authority instead of a hot key; per-window and per-recipient hard caps; commit a merkle root of `(recipient, weight)` at close and require a proof in `distribute_window`; timelock large payouts.

- [ ] **`initialize_vault` / `initialize_pot` are permissionless — front-run hijack of authority & mint** — first caller of the fixed-seed config PDAs becomes the pot drain authority, or pins the vault to a wrong/worthless mint (`validate_supported_mints` then bricks all real-USDC locking). `programs/locked_in/src/vault.rs:23-32,144-157`; `pot.rs:25-31,202-215`. **Fix:** gate init to a hardcoded/upgrade-authority key (programdata check), or atomically deploy+init in one flow and post-assert that resulting `authority` and `usdc_mint` equal expected values.

- [ ] **Pot is accounting-only on-chain — recorded redirects are never funded into `pot_vault`, and the distribute path has no devnet guard** — `record_redirect` increments `total_redirected_amount` with an author-supplied amount and moves no tokens; there is no deposit instruction; `distribute_window` pays real USDC capped only by these fabricated numbers. The redirect-recording worker is devnet-gated, but the close/distribute route handlers (`repository.mjs:2909+`, `routes.mjs:256-268`) are NOT, unlike `claimUnclaimedYield`. `programs/locked_in/src/pot.rs:33-85,447-465`; `backend/src/lib/communityPot.mjs:215-262`. **Fix:** transfer redirected USDC into `pot_vault` inside `record_redirect` so the total is backed 1:1; assert `pot_vault.amount` against accounting invariants; mirror the `isDevnetOnly()` guard onto close/distribute until real backing exists.

- [ ] **Real-value safety rests entirely on a fragile RPC-URL substring match** — faucet payouts and the treasury-funded yield claim are blocked on mainnet *only* by `isDevnetOnly() === solanaRpcUrl.includes('devnet')`; a custom/proxied mainnet endpoint whose host contains `'devnet'` flips the gate and lets the backend sign real transfers against uncollateralized simulated yield. `backend/src/lib/faucet.mjs:62-63`; `config.mjs:250`; `progress/repository.mjs:2155`. **Fix:** replace with an explicit `CLUSTER=devnet|mainnet` env and/or genesis-hash verification at startup; gate all transfers on `CLUSTER==='devnet'`; refuse to boot if unset on a non-local deploy.

- [ ] **Savers do not actually preserve the streak — and streak weights real USDC pot payouts** — the miss path (`repository.mjs:3764-3774`) keeps `current_streak` but never advances `last_completed_day`, so the next completion (`:517-521`) sees a >1-day gap and resets the streak to 1. Streak is a direct multiplier in pot weight (`weight = principalAmount * currentStreak`, `:2869`), so users who paid ichor for savers are silently underpaid real money. **Fix:** unify the two paths on one streak model (advance a streak-anchor on protected days, or compute continuity against `max(last_completed_day, last_miss_day)` + saver state); add the unit test: complete D1, miss D2 (saver), complete D3 → streak preserved.

- [ ] **On-chain pot payout (`distribute_window`) has zero integration coverage** — the only instruction that moves USDC out of `pot_vault` (PDA signer seeds, `remaining_amount` cap, double-pay receipt) is never exercised end-to-end against the compiled BPF. `programs-tests/tests/lock-lifecycle.test.ts` has 2 tests; `programs/locked_in/src/pot.rs:137-200` untested. **Fix:** extend the LiteSVM suite — `initialize → record_redirect → close → distribute_window` asserting recipient delta, vault decrement, second-pay rejection, `InsufficientPotBalance` on over-claim; add on-chain early-unlock (`LockStillActive`) and double-unlock (`LockAlreadyClosed`) tests.

## 3. 🟠 High priority (fix before public launch)

- [ ] **No production DB migration runner** — 39 ordered SQL files (`backend/sql/0001…0039`) are applied by hand with no `schema_migrations` tracking table; a missed/out-of-order migration silently diverges prod schema from code. Only runner is the CI loop (`.github/workflows/ci.yml:105-110`). **Fix:** add `node-pg-migrate`/`drizzle-kit` or a minimal tracking table + apply script wired into the Render predeploy hook; fail closed if schema version < expected.

- [ ] **Zero tests on off-chain fund-custody / economic functions** — `claimUnclaimedYield`, `recordHarvestResult`, `consumeSaverOrApplyFullConsequence`, `buyStreakSaver`, `computeWeightedPayouts`, and the distribution snapshot lifecycle (all in `backend/src/modules/progress/repository.mjs`) are entirely unverified; a regression in the 0/10/15/20 escalation, claim math, or pot split mis-pays real USDC silently. **Fix:** DB-backed integration tests (suite already has `docker-compose.test.yml`) driving complete→miss×4 tier transitions, harvest→claim idempotency, and `computeWeightedPayouts` invariants (sum==total, zero weight, dust remainder).

- [ ] **Weak/default JWT & scheduler secret only blocked by the RPC substring; no entropy floor** — `jwtSecret`/`schedulerSecret` fall back to `dev-only-*` (`config.mjs:155,160`); the only live guard (`:250-263`) rejects the `dev-only-` prefix on a non-devnet RPC but accepts any weak custom secret (`changeme`) with no length check. A forgeable JWT = full account takeover of any wallet. **Fix:** drive the guard off the explicit CLUSTER flag; require both secrets present AND ≥32 bytes entropy on any non-devnet cluster; ship no hardcoded fallback to a mainnet build.

- [ ] **Boot guard does not validate signing keys** — `config.mjs:251-263` only checks JWT/scheduler secrets, never that worker keys are present and distinct from `DEPLOYER_PRIVATE_KEY`, so the server can boot on mainnet with the upgrade key silently reused as the fund worker. **Fix:** on non-devnet, require both worker keys set and distinct from each other and from the deployer; or remove fund-signing keys from the backend entirely (KMS/multisig).

- [ ] **Default production yield profile fabricates an 8% APY** — with `YIELD_STRATEGY_PROFILE` unset (the documented default), `fixed_apy_dev` returns `fixedApyBps: 800` and `/v1/yield/current-apy` surfaces it as the user's rate. `config.mjs:58-93,79`; `yieldStrategy.mjs:191-207`. **Fix:** remove `fixed_apy_dev` as any production default; require an explicit profile on mainnet and refuse to boot if it implies fabricated yield; never display a hardcoded APY as a real rate.

- [ ] **No error tracking / monitoring** — no Sentry/Datadog/OTel anywhere; only a `/health` endpoint (`server.mjs:112`) and Render logs. A failing unlock path, broken cron, or RPC outage surfaces only via user reports. **Fix:** add Sentry (frontend + backend) and alert on health-check failures, cron non-execution, and 5xx spikes before any real-funds exposure.

- [ ] **Frontend hardcodes `CLUSTER='devnet'`** — `web-app/services/solana/connection.ts:5` is a literal not read from env, and `scripts/use-cluster.sh` never patches it, so a "mainnet" switch leaves the test-faucet UI rendered and `clusterApiUrl('devnet')` as the RPC fallback (the money path is saved only because the env RPC wins when set). **Fix:** derive `CLUSTER` from `NEXT_PUBLIC_SOLANA_CLUSTER` (matching `providers.tsx`); add a build-time assertion that the two agree.

- [ ] **Public RPC endpoints are not mainnet-grade** — frontend uses public `api.devnet.solana.com`/`clusterApiUrl()` and the Kamino read defaults to public `api.mainnet-beta.solana.com` (`config.mjs:201`); under real traffic the browser RPC would be throttled, breaking balance reads/sims/tx submission. **Fix:** provision a paid/proxied RPC (backend proxy or public-safe Helius/Triton) before mainnet; keep secret-keyed RPC server-side only.

## 4. 🟡 Medium / hardening

- [ ] **No pause/freeze/circuit-breaker in the program** (`pot.rs`/`vault.rs`, no admin pause) — add a pause flag on state-changing instructions gated by the multisig, keeping owner-unlock un-pausable. Incident response currently limited to a risky emergency upgrade.
- [ ] **First harvest never fires for active locks** — `syncCourseRuntimeStateWithLockSnapshot` resets `updated_at=now()` every cycle so the accrual cursor never ages past the 1h interval (`runtimeSchedulerWorker.mjs:49-71`; `repository.mjs:1215-1235`). Breaks the yield showcase on devnet and would regress into any real-yield port. Persist an explicit `last_harvested_at` advanced only on successful harvest.
- [ ] **Treasury devnet guard incomplete** — only `transferUsdcAtomic` self-guards; add `isDevnetOnly()` defense-in-depth to `transferSol`/`transferUsdc` (`faucet.mjs:66,85`) even though the sole route caller is currently gated.
- [ ] **No per-route rate limiting** — `@fastify/rate-limit` is `global:false`; `/v1/auth/*` (challenge writes a DB row per unauthenticated call), and authenticated `brewery/claim|feed`, `shop/buy-saver` are unthrottled (`server.mjs:67`; `auth/routes.mjs:58-165`; `progress/routes.mjs:131-157`). Add per-IP and per-wallet limits.
- [ ] **No `trustProxy`** — behind Render, per-IP rate-limit buckets collapse to the LB IP and logs record the wrong source IP (`server.mjs:42-46`). Set `trustProxy: true`.
- [ ] **Refresh-token reuse detected but descendant chain not revoked** — a stolen-then-rotated token keeps a self-renewing 30d session (`auth/state.mjs:110-178`). Add a `family_id` and nuke the lineage on detected reuse.
- [ ] **Token-2022 transfer-fee mints can permanently brick unlock** — strict `stable_vault.amount == principal_amount` equality (`vault.rs:92-95`) also breaks on token-donation griefing. Hardcode/whitelist the canonical USDC mint and/or relax to `>=`.
- [ ] **Public APY/unclaimed-yield UI has no cluster tag** — alchemy page shows a growing claimable-USDC balance whose claim 403s on mainnet (`yield/routes.mjs`; `alchemy/page.tsx`). Tag as "simulated/devnet" or hide the claim button off-devnet.
- [ ] **Yield claim transfer runs outside the DB tx** — a confirmation timeout on a landed tx reopens receipts and can double-pay (`repository.mjs:2222-2250`). Make the transfer idempotent (deterministic claim-id/memo) before lifting the devnet guard; reconcile ambiguous errors out-of-band.
- [ ] **Critical services + Postgres not in IaC** — `render.yaml` defines only the cron; promote the web service + DB with `sync:false` secrets.
- [ ] **No documented DB backup/restore runbook** — verify Render PITR/retention and test a restore once (principal is recoverable on-chain, but accounting/streak state is not).
- [ ] **DB TLS does not validate the cert chain** — `ssl: { rejectUnauthorized: false }` (`db.mjs:25-31`); pin the provider CA or document the private-network assumption.
- [ ] **Deployed merged program has no matching keypair in `target/deploy`** — for mainnet, mint a fresh program ID with a known multisig upgrade authority and never lose custody; verify `solana program show <id>` before launch.
- [ ] **`Anchor.toml` has no reviewed `[programs.mainnet]` block** — add it plus a deploy checklist verifying program id, upgrade authority, and post-init config.

## 5. 🟢 Low / nice-to-have

- JWT verify does not pin `algorithms: ['HS256']` (`jwt.mjs:76-83`) — not exploitable with symmetric key; add anyway.
- CORS silently falls back to localhost when env unset (`config.mjs:238-240`) — fail closed on non-devnet boot.
- `/v1/auth/verify` echoes raw parse error; no explicit `bodyLimit` (`auth/routes.mjs:85`; `server.mjs:42`).
- `secureEquals` leaks length via early return (`secureCompare.mjs:9-21`) — hash both sides to fixed width.
- CI/build env use stale pre-merge program IDs + dead SKR mint (`ci.yml:128-132,226-228`; `devnet-integration.yml:51-55`) — update to `3RC9XkPZ…kBav`.
- Pot timestamps are caller-supplied, not from `Clock` (`pot.rs:37,77,91,141`) — use `Clock::get()` for any value that may later matter.
- `close_distribution_window` can re-snapshot a zero-state window (`pot.rs:104-122`) — treat any initialized window as final.
- `VaultConfig.authority` is dead state (`vault.rs:230-234`) — remove or repurpose for the pause flag.
- Pot share rounding always floors toward the user (`yieldRouting.mjs:41-47`) — negligible dust leak; document direction.
- Dead `saverRecoveryMode` branch + MEMORY tier drift (10/20/20/100 vs live 0/10/15/20) (`repository.mjs:529-533`) — remove branch, update MEMORY.
- No emergency recovery for lost owner key (`vault.rs:84-142`) — by-design self-custody; disclose explicitly to users.

## 6. Cross-cutting themes

- **Custody key management is the central failure mode.** Program-upgrade authority, pot distribution authority, and the treasury all collapse toward one plaintext hot key with a silent `DEPLOYER_PRIVATE_KEY` fallback, no multisig, no HSM/KMS, and no on-chain caps. Every other custody finding is downstream of this.
- **Fake yield.** No Kamino deposit/withdraw CPI exists anywhere; "yield" is a pure off-chain formula paid 1:1 from a treasury wallet, and the default profile invents 8%. Enabling it on mainnet is structurally insolvent — only the devnet guards prevent a treasury drain.
- **Fragile cluster detection.** Insolvency protection, faucet gating, and secret validation all key off `solanaRpcUrl.includes('devnet')`. There is no authoritative `CLUSTER` flag or genesis-hash check, and no cross-check that the configured mint is the expected USDC.
- **The "community pot" is a custodial off-chain ledger with an on-chain payout rail.** Recorded redirects move no tokens, eligibility/weights are unverified author-supplied numbers, and the vault is funded out-of-band — there is no on-chain backing or fairness guarantee.
- **No audit, no test coverage on money paths.** The USDC payout instruction and every off-chain economic/custody function are untested, and no external security review has been done on a program that takes real USDC into custody.
- **Operational immaturity.** No migration runner, no monitoring/alerting, no IaC for the core services, no backup runbook, and unthrottled auth/spend endpoints.
- **Genuine strengths to preserve:** the non-custodial lock vault (owner-only unlock, immutable end, mint binding, checked math), parameterized SQL throughout, single-use nonce-bound wallet auth with refresh rotation, clean secret hygiene (no committed keys, non-secret `NEXT_PUBLIC_*`), and idempotent worker harvest dedup.

## 7. Recommended path to mainnet

**Phase 0 — Freeze scope & cluster integrity (days).** Hold devnet-only. Decide the v1 mainnet surface: ship *escrow only* (the vault is the one audit-credible subsystem) and keep pot + yield strictly devnet, or commit to the full redesign below. Replace every `includes('devnet')` check with an explicit `CLUSTER` enum + startup genesis-hash verification, fail-closed, and cross-check the USDC mint. Add the secret entropy floor and the worker-key distinctness boot guard.

**Phase 1 — Custody & key redesign (weeks).** Generate distinct per-role keys; remove the `??` fallback chain. Move program upgrade authority AND pot distribution authority to a Squads multisig with timelock (or burn the upgrade authority post-audit). Treasury behind KMS/HSM or multisig with a small float + cold reserve. Add program pause flags (owner-unlock un-pausable). Make `initialize_*` permissioned or atomic-with-deploy and post-assert authority/mint. Locate/escrow and verify the program + upgrade keypairs on-chain.

**Phase 2 — Real yield & backed pot (weeks).** Implement Kamino klend deposit-on-lock / withdraw-on-claim CPI so payouts are backed by earned interest; fund `pot_vault` 1:1 inside `record_redirect`; commit eligibility/weights as a merkle root checked in `distribute_window`. Fix the saver/streak unification, the harvest accrual cursor, and convert the claim to a two-phase outbox. Never display fabricated APY.

**Phase 3 — Test & external audit (weeks).** Add the LiteSVM integration tests (`distribute_window`, close, over-claim, double-pay, early/double unlock) and DB-backed economic tests (saver tiers, claim math, pot split invariants). Only then commission a professional audit of the program *and* the economic flows. Run a bug bounty.

**Phase 4 — Infra hardening (parallel with 3).** Migration runner with a tracking table wired to predeploy; Sentry + alerting; promote services to IaC; verified backup/restore runbook; paid/proxied RPC; per-IP/per-wallet rate limiting; `trustProxy`.

**Phase 5 — Staged rollout.** Launch with small per-deposit and global TVL caps, monitored outflows, and a kill switch (pause). Increase limits gradually only after clean operation and audit remediation are confirmed.
- [ ] **Client tx shape vs real Kamino**: `buildClaimTransaction`/`buildDepositTransaction`
  (web-app/services/solana/vaultV2.ts) must adopt the spec §3 order
  `[compute_budget, refresh_reserve, ed25519_verify, claim]` (pass
  `refresh_reserve` via the `prepend` param) and pass a surfpool mainnet-fork
  smoke before cutover. Green devnet e2e does NOT certify mainnet tx shape —
  the devnet mock reserve needs no refresh. Update
  `__tests__/services/solana/vaultV2.accounts.test.ts` pins with it.

## v2 audit follow-ups (adversarial swarm, 2026-07-10)

- [ ] **v2 lock server-side visibility (HIGH)**: a v2 deposit writes the lock only
  to the client Zustand store (`activateCourse`). There is no server-side writer for
  `user_course_enrollments`/lock metadata on deposit, so a v2 lock is invisible after a
  storage clear or on another device — `restoreFromBackend` and on-chain discovery can't
  see it. Add an enroll-on-deposit endpoint or a v2 deposit indexer before launch.
- [ ] **Real-Kamino exchange rate (HIGH, position value)**: `lockPosition.mjs` computes
  live value from the devnet **mock** reserve's slot-linear rate. Real Kamino needs the
  klend collateral exchange rate; returns `null` (falls back to principal) until then.
- [ ] **Platform-fee display (LOW)**: the claim breakdown shows yield-kept % from
  `voucher.bps` only; if `set_config_v2` sets a non-zero `platform_fee_bps`, "Yield kept
  100%" overstates by the fee. Wire the fee into the breakdown if a fee is ever enabled.
- [ ] **`Received (exact)` figure (INFO)**: the claim success "received" is a raw
  USDC-ATA delta; concurrent credits could inflate it and RPC lag drop it. Prefer the
  on-chain `LockV2Settled` event amount once an indexer exists.
- [ ] **Contrast sweep (MEDIUM, a11y)**: `T.textMuted` (45% white) on the 0.28-alpha
  glass fails WCAG 4.5:1 for 10–13px money copy. Flame labels were lightened; do a full
  pass on the small muted labels (add text-shadow or raise luminance).
- [ ] **Claim dust**: a fast deposit→claim at bps=10000 returns principal − 1 atomic
  unit (double-floor: `floor(amount/rate)` then `floor(shares·rate)`). Real Kamino cTokens
  floor the same way — surface "principal returned (±dust)" rather than an exact promise.
