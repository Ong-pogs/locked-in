# Solana Deployment Cost-Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the one-time mainnet deploy cost of the three Anchor programs from ~12.44 SOL to ~4.6 SOL (≈63%), plus eliminate the dominant recurring per-user account rent, without weakening fund custody.

**Architecture:** Three independent levers applied in sequence — (1) size build flags, (2) delete/move all non-custodial on-chain logic the backend already owns, (3) merge the surviving custodial surface of all three programs into one `locked_in` program with domain-separated PDA seeds and a hardened upgrade authority. Custody primitives (principal escrow, clock-gated unlock, PDA-signed pot payout + double-pay guard, on-chain redirect cap) never move.

**Tech Stack:** Anchor (Rust, SBF), `cargo test` / `cargo build-sbf`, Postgres (`backend/sql/NNNN_*.sql`), Fastify backend (`.mjs`, manual instruction building), Next.js web-app (`@solana/kit` / web3.js), vitest.

---

## Cost & Safety Model (reference)

- **Deploy SOL** ≈ `len(.so) bytes × 0.00001392` (upgradeable programdata = 2× bytecode, rent at 6960 lamports/byte).
- **Per-user PDA rent** ≈ `(account_bytes + 128) × 6960 / 1e9` SOL, paid at init, reclaimable only on `close`.
- **Current binaries (verified):** `lock_vault.so` 399,336 B (~5.56 SOL), `community_pot.so` 286,992 B (~3.99 SOL), `yield_splitter.so` 207,704 B (~2.89 SOL). Total **~12.44 SOL**.
- **Custody invariant (must hold after EVERY task):** no change may let the worker/authority key (already held by the backend) move, mint, or fabricate user value that it cannot already move today. The backend is a *trusted relayer/treasury signer already*; we only remove on-chain logic that grants it no new power, and we keep on-chain every guard that bounds it (`unlock_funds` clock gate, `distribute_window` payout cap + `DistributionReceipt`, the `PotWindow.total_redirected_amount` redirect cap).

## File Structure

**On-chain (Rust):**
- `programs/lock_vault/src/lib.rs` — trimmed in Phase 2, folded into `locked_in` in Phase 3.
- `programs/community_pot/src/lib.rs` — trimmed in Phase 2, folded in Phase 3.
- `programs/yield_splitter/src/lib.rs` — **deleted** in Phase 2.
- `programs/locked_in/src/lib.rs` — **new** merged program (Phase 3); split into `mod vault; mod pot;` submodules sharing one `#[program]`.
- `Cargo.toml` (workspace) — `[profile.release]` flags (Phase 1); `members` updated (Phase 2/3).
- `Anchor.toml` — program-id table updated (Phase 2 removal, Phase 3 merge).

**Backend (`.mjs`):**
- `backend/src/config.mjs` — program-id/key env wiring (lines 229–259).
- `backend/src/lib/lockVault.mjs`, `communityPot.mjs`, `yieldSplitter.mjs`, `redemptionVault.mjs` — instruction builders/decoders.
- `backend/src/workers/{lockVaultRelayWorker,runtimeSchedulerWorker,unlockIndexerWorker,redemptionVaultAutofundWorker}.mjs` — stop publishing removed instructions.
- `backend/sql/0038_*.sql … 0040_*.sql` — new migrations (idempotency unique keys).

**Client (web-app):**
- `web-app/services/solana/lockVault.ts`, `web-app/services/solana/index.ts`, `web-app/app/providers.tsx` — program-id repoint (Phase 3 only; lock/unlock instruction shape unchanged).
- `web-app/.env.example`, `backend/.env.example` — program-id vars.

**Tests:**
- Rust unit tests inline in each `lib.rs` (`cargo test --workspace`) — primary fast TDD loop.
- `programs-tests/tests/lock-lifecycle.test.ts` (vitest) — integration.
- `backend/tests/**` (vitest) — backend builders/workers.

---

## Phase 0 — Pre-flight (no behavior change)

### Task 0.1: Branch + baseline build measurement

- [ ] **Step 1: Create a working branch**

```bash
cd /Users/marcus/Projects/locked-in
git checkout -b cost-reduction
```

- [ ] **Step 2: Confirm the toolchain builds today**

```bash
anchor build
```
Expected: three `.so` files in `target/deploy/`. If it fails on edition2024/rustc, STOP and resolve the toolchain (see memory: proc-macro-crate / unicode-segmentation downgrades) before continuing — every measurement below depends on a working build.

- [ ] **Step 3: Record the baseline sizes**

```bash
ls -la target/deploy/*.so | awk '{print $5, $9}'
```
Expected (±a few KB): `399336 lock_vault.so`, `286992 community_pot.so`, `207704 yield_splitter.so`. Write these numbers at the top of a scratch note — every later phase compares against them.

- [ ] **Step 4: Confirm the existing test suites are green**

```bash
cargo test --workspace
cd programs-tests && npm test ; cd ..
```
Expected: PASS. (These are the regression nets for Phases 1–3.)

- [ ] **Step 5: Commit the branch checkpoint (no code change yet)**

```bash
git commit --allow-empty -m "chore: start cost-reduction branch; baseline sizes recorded"
```

---

## Phase 1 — Zero-risk size build flags

**Expected saving: ~120–200 KB across the suite ≈ ~2.0–2.9 SOL. No trust change. Fully reversible.**

### Task 1.1: Add size-optimizing release profile flags

**Files:**
- Modify: `Cargo.toml` (workspace root, `[profile.release]`)

- [ ] **Step 1: Edit `[profile.release]`**

Replace the current block:
```toml
[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
```
with:
```toml
[profile.release]
overflow-checks = true   # KEEP: money math; do NOT trade ~30 KB for silent wraparound
lto = "fat"
codegen-units = 1
opt-level = "z"          # optimize for size (benchmark "s" in Step 3)
panic = "abort"          # SBF aborts on panic anyway; drops unwind tables/format strings
strip = true             # remove symbol/debug metadata
```

- [ ] **Step 2: Rebuild and measure**

```bash
anchor build && ls -la target/deploy/*.so | awk '{print $5, $9}'
```
Expected: each `.so` is meaningfully smaller than the Phase 0 baseline (target ~15–25% off lock_vault/community_pot). Record the new numbers.

- [ ] **Step 3: Benchmark `opt-level = "s"` vs `"z"`**

Change `opt-level = "z"` → `opt-level = "s"`, rebuild, measure. `z` can defeat the inlining `lto="fat"` wants, so `s` is occasionally smaller. Keep whichever produces the smaller total. Revert to `z` if `s` is not smaller.

- [ ] **Step 4: Verify behavior is unchanged**

```bash
cargo test --workspace
```
Expected: PASS (panic="abort" changes nothing — no `catch_unwind`/`set_hook` exists in `programs/`).

- [ ] **Step 5: Verify the program interface (IDL) did not change**

```bash
anchor build && git diff --stat -- target/idl/ 2>/dev/null ; echo "review IDL diff (should be empty / formatting only)"
```
Expected: no instruction/account schema changes — build flags must not alter the ABI.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml
git commit -m "perf(programs): size build flags (opt-level=z/s, panic=abort, strip) — keep overflow-checks"
```

> **Note:** Feature-gating anchor-spl `token_2022`/`zk`/`elgamal`/`transfer-hook` is NOT worth doing — fat LTO already dead-strips those crates (0 symbols in the binary). It would save compile time, not bytes. Skip it.

---

## Phase 2 — Trim non-custodial on-chain logic & state

**Expected saving: ~delete yield_splitter (~2.89 SOL) + strip lock_vault game layer (~1.6 SOL) + recurring per-user rent (>1 SOL per long lock). Each sub-task ships independently and is testable on its own.**

> **Trust rule for this phase:** every instruction removed here is *worker-signed* and *already mirrored or owned in Postgres*. Removing it grants the backend no power it lacks today. Each removal pairs with a DB idempotency guard so the off-chain path keeps the on-chain `init`-based double-write protection it is losing.

### Task 2A.1: Add DB idempotency for harvest receipts (precondition for deleting yield_splitter)

**Files:**
- Create: `backend/sql/0038_harvest_receipt_unique.sql`
- Test: `backend/tests/unit/` (new) — assert duplicate insert rejected

- [ ] **Step 1: Write the migration**

```sql
-- 0038_harvest_receipt_unique.sql
-- Replace the on-chain HarvestReceipt PDA's init-based idempotency with a DB unique key,
-- so deleting the yield_splitter program cannot cause double-counted harvest splits.
ALTER TABLE lesson.harvest_result_receipts
  ADD CONSTRAINT harvest_result_receipts_lock_receipt_uniq
  UNIQUE (lock_account, receipt_key);
```
(Confirm exact column names against `backend/sql/0010_harvest_result_receipts.sql` first; adjust if the columns are named differently.)

- [ ] **Step 2: Apply + verify the constraint exists**

```bash
# apply via the project's migration runner (see backend/sql/ apply mechanism), then:
psql "$DATABASE_URL" -c "\d lesson.harvest_result_receipts" | grep -i uniq
```
Expected: the unique constraint is listed.

- [ ] **Step 3: Write a failing test for duplicate rejection**

In `backend/tests/integration/harvestReceiptIdempotency.test.mjs`: insert a `harvest_result_receipts` row, then insert a second with the same `(lock_account, receipt_key)`; assert the second throws a unique-violation. Run `npm test --prefix backend`; expect FAIL until migration applied, PASS after.

- [ ] **Step 4: Commit**

```bash
git add backend/sql/0038_harvest_receipt_unique.sql backend/tests/integration/harvestReceiptIdempotency.test.mjs
git commit -m "feat(db): unique (lock_account, receipt_key) for harvest receipts (pre-splitter-delete)"
```

### Task 2A.2: Delete the yield_splitter program

**Files:**
- Delete: `programs/yield_splitter/` (whole crate)
- Modify: `Anchor.toml` (remove `yield_splitter` line), `Cargo.toml` workspace members if pinned
- Modify: `backend/src/lib/yieldSplitter.mjs` (stop building on-chain tx; keep DB write), `backend/src/workers/runtimeSchedulerWorker.mjs` (drop the yield-splitter publish step), `backend/src/config.mjs` (remove `yieldSplitterProgramId`/key resolution if now unused)

- [ ] **Step 1: Remove the on-chain publish from the scheduler worker**

In `backend/src/workers/runtimeSchedulerWorker.mjs`, find where it signs/sends the `harvest_and_split` instruction and delete that block. The DB write to `harvest_result_receipts` (now guarded by the unique key from 2A.1) stays and becomes the sole source of truth. Leave the `harvest_result_yield_splitter_publish_status` column (migration 0016) but stop transitioning it to `published` via chain; mark it `not_applicable` going forward.

- [ ] **Step 2: Delete the program crate and config**

```bash
git rm -r programs/yield_splitter
```
Remove the `yield_splitter = "..."` line from `[programs.localnet]` in `Anchor.toml`. In `backend/src/config.mjs`, delete the `yieldSplitterProgramId` and `yieldSplitterWorkerPrivateKey` resolution (lines ~233–234, ~253–254) if no longer referenced.

- [ ] **Step 3: Rebuild — confirm two programs remain and build**

```bash
anchor build && ls -la target/deploy/*.so | awk '{print $5, $9}'
```
Expected: only `lock_vault.so` and `community_pot.so`. The full 207,704 B / ~2.89 SOL is gone.

- [ ] **Step 4: Backend tests green**

```bash
npm test --prefix backend
```
Expected: PASS (no test should depend on an on-chain harvest_and_split being sent).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete yield_splitter program; harvest split is DB-authoritative (-2.89 SOL deploy)"
```

### Task 2B.1: Remove `redeem_ichor` + redemption vault (v4: ichor is off-chain points, not USDC-redeemable)

**Files:**
- Modify: `programs/lock_vault/src/lib.rs` — delete `pub fn redeem_ichor` (~line 412), the `RedeemIchor` accounts struct (incl. `redemption_vault`, ~line 811), the `LockAccount::redeem_ichor` method (~line 1195), and the inline test `redeem_ichor_on_closed_lock_fails` (~line 2462)
- Modify: `backend/src/lib/redemptionVault.mjs`, `backend/src/workers/redemptionVaultAutofundWorker.mjs` — delete (no longer needed); remove their registration in `backend/src/server.mjs`
- Modify: `backend/src/config.mjs` — remove redemption-vault env wiring

- [ ] **Step 1: Adjust the Rust unit tests first (TDD: tests define the new surface)**

Delete `redeem_ichor_on_closed_lock_fails` and any test asserting ichor→USDC conversion. Run `cargo test --workspace`; expect compile error referencing the now-removed-in-test symbols until Step 2 removes the impl too (these are deleted together).

- [ ] **Step 2: Delete the instruction, accounts, and method**

Remove from `programs/lock_vault/src/lib.rs`: the `redeem_ichor` handler, the `RedeemIchor` context struct, the `redemption_vault` account, and `LockAccount::redeem_ichor(...)`. Leave `ichor_counter` field handling only if Task 2C still needs it transiently; otherwise remove the field in 2C.

- [ ] **Step 3: Confirm no fund stranding**

Because `redeem_ichor` was the ONLY reader of `redemption_vault`, and a fresh mainnet deploy never calls `initialize`-funds for it, the merged/trimmed program will never create or fund a redemption vault on mainnet → nothing can be stranded. Note this explicitly in the PR description.

- [ ] **Step 4: Delete backend redemption code + worker registration**

```bash
git rm backend/src/lib/redemptionVault.mjs backend/src/workers/redemptionVaultAutofundWorker.mjs
```
Remove the `redemptionVaultAutofundWorker` `onReady` registration from `backend/src/server.mjs` and its env in `config.mjs`.

- [ ] **Step 5: Build + test**

```bash
anchor build && cargo test --workspace && npm test --prefix backend
```
Expected: PASS. Record new `lock_vault.so` size.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(lock_vault): remove redeem_ichor + redemption vault (v4 ichor is off-chain points)"
```

### Task 2C.1: Strip the non-custodial game layer from lock_vault

**Files:**
- Modify: `programs/lock_vault/src/lib.rs` — delete instructions `apply_verified_completion`, `consume_daily_fuel`, `apply_harvest_result`, `convert_fuel_to_ichor`, and `upsert_course_policy`; delete the `WorkerReceipt` and `CoursePolicy` account structs + their seeds (`COMPLETION_SEED`/`FUEL_BURN_SEED`/`HARVEST_SEED`/`CONVERSION_SEED` ~lines 1288–1292, `course-policy` ~854); shrink `LockAccount` (drop `streak`, `fuel_counter`, `gauntlet_day`, `skr_tier`, `ichor_counter`, `current_yield_redirect_bps`, and other game/analytics fields no longer written on-chain) from ~212 B to ~110 B
- Modify: `backend/src/workers/lockVaultRelayWorker.mjs` (stop building `apply_verified_completion`), `runtimeSchedulerWorker.mjs` (stop building `apply_harvest_result`/`convert_fuel_to_ichor`/`consume_daily_fuel`); `backend/src/lib/lockVault.mjs` (remove those instruction builders + the `LockAccount` decoder fields)
- Create: `backend/sql/0039_runtime_game_state_idempotency.sql` — ensure the DB receipt tables (`verified_completion_events`, `fuel_burn_cycle_receipts`, `fuel_conversion_receipts`, `harvest_result_receipts`) each have a unique idempotency key replacing the removed `WorkerReceipt` PDA `init` guard

- [ ] **Step 1: Add DB idempotency keys (precondition)**

```sql
-- 0039_runtime_game_state_idempotency.sql
-- Replace WorkerReceipt PDA init-idempotency with DB unique keys per event family.
ALTER TABLE lesson.verified_completion_events
  ADD CONSTRAINT vce_lock_day_uniq UNIQUE (lock_account, day_index);
ALTER TABLE lesson.fuel_burn_cycle_receipts
  ADD CONSTRAINT fbc_lock_day_uniq UNIQUE (lock_account, burn_day);
ALTER TABLE lesson.fuel_conversion_receipts
  ADD CONSTRAINT fcr_lock_key_uniq UNIQUE (lock_account, receipt_key);
-- (Confirm/adjust column names against each migration before applying.)
```
Apply, verify with `\d`. Some of these may already exist (check 0008/0009 publish-status work) — skip duplicates.

- [ ] **Step 2: Delete the on-chain publish steps in the workers**

In `lockVaultRelayWorker.mjs` and `runtimeSchedulerWorker.mjs`, remove the blocks that build/sign the four game instructions. These workers already write the DB receipt first; the chain publish was the optional second step. The DB row (now uniquely keyed) is authoritative. `user_course_runtime_state` (migration 0005) and `ichor_*` (0037) are already the source of truth.

- [ ] **Step 3: Delete the four instructions + receipt/policy accounts + shrink LockAccount**

Remove the handlers, their `#[derive(Accounts)]` structs, `WorkerReceipt`, `CoursePolicy`, and the now-unused `LockAccount` fields. Keep ONLY the fields `unlock_funds` and `lock_funds` need: `owner`, `principal_amount`, `skr_amount` (if SKR custody kept), `lock_start_ts`, `lock_end_ts`, bumps, `course_id_hash`, `is_closed`. Fold base + extension end-timestamps into a single `lock_end_ts: i64` (the extension writer is removed in 2D; until then keep both).

- [ ] **Step 4: Update Rust unit tests to the trimmed surface**

Delete/adjust inline tests referencing removed instructions/fields. Keep and KEEP-PASSING: `unlock_requires_lock_end_and_prevents_double_close` and any principal-custody/lock-window test. Run `cargo test --workspace`; expect PASS.

- [ ] **Step 5: Build + measure + integration test**

```bash
anchor build && ls -la target/deploy/lock_vault.so | awk '{print $5,$9}'
cd programs-tests && npm test ; cd ..
npm test --prefix backend
```
Expected: lock_vault meaningfully smaller; lock→unlock lifecycle integration test PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(lock_vault): strip game layer (completion/fuel/harvest/conversion + WorkerReceipt/CoursePolicy); shrink LockAccount 212B->~110B"
```

### Task 2D.1 (GATED — requires product sign-off): make `lock_end_ts` immutable; move miss-consequence off-chain

> **Decision gate — DO NOT start this task until the product owner confirms in writing: "missed days affect yield redirection only, never principal-release timing."** This matches the v4 fire-timer model (docs/04-tokenomics.md). If NOT confirmed, SKIP 2D entirely and keep `consume_saver_or_apply_full_consequence` + the LockAccount saver/redirect fields it needs on-chain.

**Files:**
- Modify: `programs/lock_vault/src/lib.rs` — delete `consume_saver_or_apply_full_consequence`, remove the `lock_end_ts` extension write (set once in `lock_funds`, never again), remove `saver`/`yield_redirect_bps` fields if only used here
- Modify: `backend/src/workers/runtimeSchedulerWorker.mjs` — stop building the miss instruction; miss consequence is computed and applied to `user_course_runtime_state` + community-pot redirect only

- [ ] **Step 1: Write the immutability test (TDD)**

Add a Rust unit test asserting there is no code path that mutates `lock_end_ts` after `lock_funds`. (Mechanically: the field is written once in `lock_funds`; assert no setter remains.) Run `cargo test`; expect FAIL until Step 2.

- [ ] **Step 2: Remove the extension instruction + write path**

Delete `consume_saver_or_apply_full_consequence` and its accounts; ensure `lock_end_ts` has exactly one writer (`lock_funds`).

- [ ] **Step 3: Move miss handling fully off-chain in the scheduler**

The miss penalty now only adjusts `current_yield_redirect_bps` in `user_course_runtime_state` and records a community-pot redirect — no chain write to the lock.

- [ ] **Step 4: Build + full test + commit**

```bash
anchor build && cargo test --workspace && cd programs-tests && npm test ; cd ..
git add -A
git commit -m "refactor(lock_vault): lock_end_ts immutable post-lock; miss consequence is yield-only & off-chain"
```

### Task 2E.1: community_pot — shrink receipts to markers (safe); keep custody chain

**Files:**
- Modify: `programs/community_pot/src/lib.rs` — shrink `DistributionReceipt` 89 B → ~9 B (existence-only marker; the double-pay guard is PDA *existence* via Anchor `init`, not contents); shrink `RedirectReceipt` similarly; drop pure-analytics fields on `PotWindow`/`DistributionWindow` (timestamps/counts kept only if the backend cannot reconstruct them). **Keep the `DistributionPaid` event emit** (free log data, preserves on-chain payout auditability). **Do NOT touch** `distribute_window`'s `remaining_amount() >= amount` cap or the `PotWindow.total_redirected_amount` accumulation.

- [ ] **Step 1: Shrink the receipt structs + keep the event**

Reduce `DistributionReceipt`/`RedirectReceipt` to a minimal marker (e.g. a single `bump: u8` + discriminator). The guard that prevents double-pay is that Anchor `init` fails if the PDA already exists — that is preserved regardless of size.

- [ ] **Step 2: Adjust + run Rust unit tests for the payout cap and double-pay guard**

Ensure tests for "payout exceeding remaining fails" and "second pay to same recipient/window fails" still PASS. `cargo test --workspace`.

- [ ] **Step 3: Build + measure + commit**

```bash
anchor build && ls -la target/deploy/community_pot.so | awk '{print $5,$9}'
git add -A
git commit -m "refactor(community_pot): receipts -> existence markers; keep payout cap + DistributionPaid event"
```

### Task 2E.2 (GATED — requires on-chain budget re-anchoring): move `record_redirect` off-chain

> **DO NOT move `record_redirect`/`close_distribution_window` off-chain unless the per-window payout budget is re-anchored to a value the backend cannot forge** — e.g. a program-measured `fund_window` deposit instruction, or an oracle/governance-signed total. The current `total_redirected_amount` ledger is the ONLY bound stopping a malicious backend from draining the pot beyond committed redirects. The naive "backend asserts the total in distribute_window" path is a **critical** uncapped-withdrawal vulnerability — explicitly forbidden.

- [ ] **Step 1:** If re-anchoring is in scope, add `fund_window(amount)` that transfers stablecoin into `pot_vault` and sets `PotWindow.total_redirected_amount` from the *measured* delta (not an argument). Only then delete `record_redirect`. Otherwise, SKIP — keep both on-chain. Test the new cap, build, commit.

### Verification gate — after Phase 2

- [ ] **Run an independent Codex adversarial review** of the full Phase 2 diff (`codex:codex-rescue` agent, or ask the user to run `/codex:adversarial-review`). Prompt it to prove that no removed instruction lets the worker key extract or fabricate user value beyond what it can do today, and that every DB unique key correctly replaces a removed PDA `init` guard. Resolve findings before Phase 3. (Self-review shares the blind spots that produced the changes — this gate is mandatory per project policy.)

---

## Phase 3 — Merge survivors into one `locked_in` program

**Expected saving: removes ~2 duplicated Anchor baselines + 1 programdata account; target single optimized `.so` ≈ 300–360 KB ≈ ~4.6 SOL total deploy (from ~12.44).**

> **Two non-negotiable mitigations. If either cannot be guaranteed, DO NOT merge — keep two programs.**
> 1. **Domain-separate the colliding seeds** (confirmed collision: all programs use `ProtocolConfig::SEED = b"protocol"` — lock_vault:838, community_pot:337). Under one program ID these collapse onto one PDA across different struct layouts.
> 2. **Harden the upgrade authority** — one binary governs all custody; put programdata under a Squads-style multisig + timelock distinct from the hot worker key (or make it immutable post-audit).

### Task 3.1: Scaffold the merged crate with domain-separated seeds

**Files:**
- Create: `programs/locked_in/Cargo.toml`, `programs/locked_in/src/lib.rs`, `programs/locked_in/src/vault.rs`, `programs/locked_in/src/pot.rs`
- Modify: `Anchor.toml`, workspace `Cargo.toml`

- [ ] **Step 1: New crate, one `#[program]`, two domain modules**

`programs/locked_in/src/lib.rs` declares one `#[program] pub mod locked_in` whose handlers delegate to `vault::*` and `pot::*`. Move the trimmed lock_vault logic into `vault.rs`, trimmed community_pot logic into `pot.rs`.

- [ ] **Step 2: Re-seed ALL PDAs with domain prefixes (collision fix)**

```rust
// vault.rs
pub const VAULT_PROTOCOL_SEED: &[u8] = b"vault-protocol";
pub const LOCK_SEED:           &[u8] = b"lock";          // unchanged (no cross-domain name clash)
// pot.rs
pub const POT_PROTOCOL_SEED:   &[u8] = b"pot-protocol";
pub const POT_WINDOW_SEED:     &[u8] = b"window";
pub const DISTRIBUTION_SEED:   &[u8] = b"distribution";
pub const DISTRIBUTION_RECEIPT_SEED: &[u8] = b"distribution-receipt";
```
**Critical:** keep the community_pot **vault-signing PDA byte-identical** to its current seeds so the live pot ATA address does not move (if the pot is already funded on devnet/mainnet). Verify by deriving the PDA before and after and asserting equality in a test.

- [ ] **Step 3: Generate a fresh program keypair + set the program ID**

```bash
solana-keygen new -o target/deploy/locked_in-keypair.json --no-bip39-passphrase
solana address -k target/deploy/locked_in-keypair.json
```
Put the printed pubkey in `declare_id!(...)` and in `Anchor.toml` `[programs.localnet] locked_in = "<pubkey>"`. Remove the old `lock_vault`/`community_pot` lines.

- [ ] **Step 4: Build the single binary + measure**

```bash
anchor build && ls -la target/deploy/locked_in.so | awk '{print $5,$9}'
```
Expected: one `.so` ≈ 300–360 KB.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: merge lock_vault + community_pot into one locked_in program; domain-separated seeds"
```

### Task 3.2: Port + extend tests to assert no cross-domain authority

**Files:** `programs/locked_in/src/*.rs` inline tests; `programs-tests/tests/lock-lifecycle.test.ts`

- [ ] **Step 1:** Move all surviving inline tests into the new crate. Add a test proving a vault-domain instruction cannot sign for a pot-domain token account and vice-versa (PDA seeds differ, so signer derivation fails). `cargo test --workspace` → PASS.
- [ ] **Step 2:** Update `programs-tests` to the new program ID; run the lock→unlock + distribute lifecycle. `cd programs-tests && npm test` → PASS.
- [ ] **Step 3: Commit.**

### Task 3.3: Repoint all clients to the merged program ID

**Files:** `backend/src/config.mjs`, `backend/src/lib/{lockVault,communityPot}.mjs`, `backend/.env.example`, `web-app/services/solana/{index,lockVault}.ts`, `web-app/app/providers.tsx`, `web-app/.env.example`

- [ ] **Step 1:** Set `LOCK_VAULT_PROGRAM_ID` and `COMMUNITY_POT_PROGRAM_ID` both to the new `locked_in` pubkey (or introduce a single `LOCKED_IN_PROGRAM_ID` and point both module readers at it). Update the PDA seed strings in `lockVault.mjs`/`communityPot.mjs` to the new domain-prefixed seeds from Task 3.1 Step 2.
- [ ] **Step 2:** Update `web-app/services/solana/lockVault.ts` program-id + seed constants (the lock/unlock instruction *shape* is unchanged — only the program ID and the protocol-PDA seed change).
- [ ] **Step 3:** Grep to prove nothing references the old IDs/seeds:
```bash
grep -rn "41TexnrHDMV4ASJmqNNFcgQ7RBk6N193yvukfiCzKQmD\|BsJDnhJGVdLQ3mxBJ7YCMkkBitKP2RT49zFqR9XsGri1\|8bevd3T3LWoUh2Z9348UKwFFN1p5MdbRbAe2zniCrnVv\|b\"protocol\"" backend web-app --exclude-dir=node_modules --exclude-dir=.next
```
Expected: no matches (or only historical comments).
- [ ] **Step 4:** `npm test --prefix backend` + web-app tests → PASS. **Commit.**

### Task 3.4: Harden the upgrade authority (mitigation #2)

- [ ] **Step 1:** Document the deploy procedure: deploy `locked_in`, then `solana program set-upgrade-authority <programId> --new-upgrade-authority <SquadsMultisigPDA>` (or `--final` for immutability post-audit). The upgrade authority MUST differ from the hot worker signer. Add this to `docs/deploy-mainnet.md`.
- [ ] **Step 2: Commit the doc.**

### Verification gate — after Phase 3 (before any mainnet deploy)

- [ ] **Run an independent Codex adversarial review** of the merge diff. Prompt: prove no instruction can sign for a token account in a different logical domain, the pot vault PDA address is unchanged, and the upgrade-authority/worker-key separation holds. Resolve before deploy.
- [ ] **Final size + cost check:**
```bash
anchor build && ls -la target/deploy/locked_in.so | awk '{print $5,$9}'
# deploy SOL ~= bytes * 0.00001392
```

---

## Self-Review (run after writing; checklist)

**Spec coverage vs the audit's 12 ranked actions:**
- #1 build flags → Phase 1 ✅
- #2 delete yield_splitter → 2A ✅
- #3 strip game layer + remove redeem_ichor → 2B + 2C ✅
- #4 merge into one program → Phase 3 ✅
- #5 drop CoursePolicy → 2C ✅
- #6 shrink LockAccount → 2C ✅
- #7 shrink DistributionReceipt → 2E.1 ✅
- #8 move record_redirect (gated on re-anchoring) → 2E.2 ✅
- #9 immutable lock_end_ts + off-chain miss (gated) → 2D ✅
- #10 trim error strings/events → covered by panic="abort" (Phase 1) + struct trims (2C/2E) ✅
- #11 token_interface→concrete Token → intentionally OMITTED (only ~0.07 SOL, narrows accepted token program; revisit only if both mints are permanently classic SPL) — noted, not a task.
- #12 const-ify tuning params → marginal (~0.02 SOL); fold opportunistically into 2C, not a standalone task.

**Custody invariant held:** principal custody, `unlock_funds` clock gate, `distribute_window` cap + `DistributionReceipt` guard, `PotWindow.total_redirected_amount` cap — none moved. ✅

**Gated/risky items explicitly marked:** 2D (product sign-off), 2E.2 (re-anchor budget or forbidden), Phase 3 (two mandatory mitigations or don't merge). ✅

**Verification gates:** Codex adversarial review after Phase 2 and Phase 3; size measured after every size-affecting task. ✅
