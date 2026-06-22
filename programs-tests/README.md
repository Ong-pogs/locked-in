# Integration tests for the Locked In Anchor programs

LiteSVM-driven end-to-end test of the full lock lifecycle. Satisfies
**Milestone 2 #6** of the Solana Foundation grant tranche:

> "Integration tests (lock → supply → yield accrual → claim)"

## What it covers

A single test in `tests/lock-lifecycle.test.ts` chains **15 real
transactions** through `lock_vault` and `community_pot`:

1. Create stable + SKR mints, fund test owner, pre-fund redemption + pot vaults
2. `lock_vault.initialize_protocol` (fuel cap, max savers, mints)
3. `community_pot.initialize_protocol`
4. `lock_vault.upsert_course_policy` (course-specific min/max principal + duration)
5. `lock_vault.lock_funds(100 USDC, 30 days)` + asserts stable_vault balance, lock_account.principal_amount, owner USDC delta
6. `apply_verified_completion × 7` (the gauntlet) + asserts gauntlet_complete, savers_remaining, fuel_counter, current_streak
7. Clock warp to day 8
8. `lock_vault.apply_harvest_result(1 USDC)` + asserts ichor_counter increased, lock_vault HarvestReceipt PDA written
9. `community_pot.record_redirect` + asserts PotWindow total_redirected_amount, redirect_count
10. Clock warp past lock_end_ts
11. `lock_vault.redeem_ichor(1)` + asserts owner USDC increased, ichor_counter decreased
12. `lock_vault.unlock_funds()` + asserts owner USDC += principal, stable_vault closed, lock_account closed

Every `→ assert` is on **real on-chain state** produced by **real
transactions** sent to an in-process LiteSVM (mainnet-equivalent BPF
execution). No struct mutation in memory, no mocked CPI. Both
programs run as compiled `.so` files loaded from `target/deploy/`.

## Run

```bash
cd /                       # repo root
anchor build --skip-lint   # produce target/deploy/*.so + target/idl/*.json
cd programs-tests
npm install                # first time only
npm test
```

Expected: `Tests  1 passed (1)` in ~500ms.

## Hermetic

- No devnet / mainnet RPC
- No SOL airdrops from a faucet
- No env vars required
- Same input → same output every run
- Runs in CI without network

## Why LiteSVM (not Surfpool, not devnet)

LiteSVM is an in-process BPF runtime — equivalent semantics to mainnet but
deterministic and instant. Surfpool is the right tool for testing CPIs
into other people's mainnet protocols (e.g. Kamino, Jupiter); irrelevant
here because we're testing our own programs in isolation. Devnet is
non-deterministic and slow.

## Findings during construction

These were noted while building the harness — not fixed (per the
"don't modify program code" instruction). Worth triaging:

1. **`community_pot::DistributeWindow.recipient` lacks a `/// CHECK:` doc
   comment.** Anchor's strict lint flags it (`anchor build --skip-lint`
   is currently needed to generate the IDL). The safety reasoning is
   sound — the recipient ATA's `associated_token::authority` constraint
   enforces the recipient pubkey — but a one-line `/// CHECK:` comment
   should be added before the next grant tranche review so the lint
   passes cleanly.

2. **Build-config gap: `programs/{lock_vault,community_pot}/Cargo.toml`
   was missing `anchor-spl/idl-build` in the `idl-build` feature.**
   Without it, Anchor 0.31.1's IDL generator can't resolve SPL token
   interface types. Added in this PR.

These are documentation / hygiene findings, not security bugs.
