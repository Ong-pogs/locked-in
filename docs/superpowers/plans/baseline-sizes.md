# Phase 0 Baseline (Tasks 0.1 + 0.2)

Branch `cost-reduction`. Date: 2026-06-22.
Toolchain: anchor 0.31.1, solana 3.0.6, cargo 1.93.0.

Task 0.1 recorded the first measurement (build was blocked at the IDL step).
Task 0.2 unblocked the full `anchor build` and re-measured the TRUE baseline
WITH IDL generation. This is the authoritative baseline for cost-reduction deltas.

## TRUE baseline `.so` sizes (full `anchor build`, IDL included)

The `.so` byte sizes are identical before/after the IDL fix (the fix only adds a
doc comment; it does not change the compiled binary). These are reproducible
across clean rebuilds.

| Program           | Size (bytes) | Deploy cost (SOL) |
|-------------------|--------------|-------------------|
| lock_vault.so     | 511512       | 7.120247          |
| community_pot.so  | 343960       | 4.787923          |
| yield_splitter.so | 241192       | 3.357393          |
| **TOTAL**         | **1096664**  | **15.265563**     |

Deploy cost = bytes x 0.00001392 SOL/byte.

### Stale-artifact note (why the plan's "expected" numbers were wrong)

The plan's expected figures (lock_vault ~399336, community_pot ~286992,
yield_splitter ~207704) were measured against an OLDER state of the code.
A stale `lock_vault.so` of exactly 399336 bytes from Jun 17 was sitting in
target/deploy, which is why that one number coincidentally matched. A clean
rebuild of the current committed source produces the sizes above. Deltas vs the
plan's expected: lock_vault +112176, community_pot +56968, yield_splitter +33488.

## Build status (after Task 0.2 fix)

- `anchor build` (full) -> SUCCESS. All 3 programs compile and all 3 IDLs are
  generated: target/idl/{lock_vault,community_pot,yield_splitter}.json.
- Fix applied: added a `/// CHECK:` doc comment on the `recipient` field in
  programs/community_pot/src/lib.rs (the only un-annotated UncheckedAccount in
  the codebase). It was tripping Anchor's account-safety lint during
  `anchor idl build`. `recipient` is used only as the authority/owner of its ATA
  (recipient_stable_token_account); no data is read, and the payout is bounded
  on-chain by the distribution_window cap + the distribution_receipt double-pay
  guard, so an arbitrary pubkey is safe.

## Test status (after Task 0.2 fix)

- Rust unit tests (`cargo test --workspace`): PASS.
  community_pot 13, lock_vault 42, yield_splitter 14 = 69 passed, 0 failed.

- Integration tests (`programs-tests`, LiteSVM in-process, `npm test`): PASS.
  1 test file, 1 test passed. Now that all 3 IDLs exist, the suite loads and runs.

## Note for later phases

Use the byte sizes / SOL costs above as the comparison point for all
cost-reduction deltas. Re-run full `anchor build` + `cargo test --workspace`
+ the integration suite after each change to confirm the build stays green and
to re-measure binary size.

---

# Phase 1 result (Task 1.1) — size build flags

Added to `[profile.release]` in the workspace Cargo.toml:
`opt-level = "z"`, `panic = "abort"`, `strip = true`. Kept `overflow-checks = true`
(money math — never trade size for silent wraparound), `lto = "fat"`,
`codegen-units = 1`.

## opt-level benchmark: "z" vs "s" (clean rebuild each)

| opt-level | total bytes |
|-----------|-------------|
| "z"       | 894296      |
| "s"       | 934416      |

WINNER: "z" (40120 bytes smaller than "s"). Kept `opt-level = "z"`.

## New sizes vs TRUE baseline (opt-level "z")

| Program           | Baseline (B) | New (B) | Reduction (B) | Reduction % | New cost (SOL) |
|-------------------|--------------|---------|---------------|-------------|----------------|
| lock_vault.so     | 511512       | 399480  | 112032        | 21.90%      | 5.560762       |
| community_pot.so  | 343960       | 287136  | 56824         | 16.52%      | 3.996933       |
| yield_splitter.so | 241192       | 207680  | 33512         | 13.89%      | 2.890906       |
| **TOTAL**         | **1096664**  | **894296** | **202368** | **18.45%**  | **12.448600**  |

Deploy cost @ 0.00001392 SOL/byte: 15.265563 SOL -> 12.448600 SOL
(saved ~2.82 SOL, -18.45%).

NOTE: the new "z" sizes (399480 / 287136 / 207680) land almost exactly on the
plan's original "expected" baselines, confirming those expected figures were
measured with these size flags already applied at some earlier point.

## Verification (flags did not change behavior or ABI)

- `cargo test --workspace`: 69 passed, 0 failed.
- `programs-tests` (LiteSVM, exercises on-chain ABI via regenerated IDL +
  the size-optimized .so): 1 test file, 1 test passed. Passing confirms the
  instruction interface is unchanged.

---

# Phase 2A-i result — yield_splitter program removed

The `yield_splitter` program was a pure notarization step (moved zero tokens);
the product decision was FULL removal — the DB is authoritative for harvests.
Removed the crate (`programs/yield_splitter`), its `[programs.localnet]` entry in
`Anchor.toml`, and all yield_splitter steps from the integration test
(`programs-tests/tests/lock-lifecycle.test.ts`). The workspace `members =
["programs/*"]` glob now resolves to two crates: lock_vault + community_pot.

## New `.so` sizes (full `anchor build`, IDL included)

| Program           | Size (bytes) | Deploy cost (SOL) |
|-------------------|--------------|-------------------|
| lock_vault.so     | 399480       | 5.560762          |
| community_pot.so  | 287136       | 3.996933          |
| **TOTAL**         | **686616**   | **9.557695**      |

Deploy cost = bytes x 0.00001392 SOL/byte.

## Delta vs post-Phase-1 (894296 B)

| Metric        | Post-Phase-1 | Phase 2A-i | Delta            |
|---------------|--------------|------------|------------------|
| Total bytes   | 894296       | 686616     | -207680 (-23.2%) |
| Deploy (SOL)  | 12.448600    | 9.557695   | -2.890906        |

The -207680 B reduction equals the prior yield_splitter.so size exactly; the
remaining two programs are byte-for-byte unchanged (no source touched).

## Verification

- `anchor build`: SUCCESS. `target/deploy/` now holds only lock_vault.so +
  community_pot.so; `target/idl/` only lock_vault.json + community_pot.json.
- `cargo test --workspace`: 55 passed, 0 failed (community_pot 13 + lock_vault
  42; yield_splitter's 14 tests removed with the crate).
- `programs-tests` (LiteSVM): 1 test file, 1 test passed. The lock_vault
  lock→gauntlet→harvest→redeem→unlock flow and the community_pot record_redirect
  flow remain intact and green.
