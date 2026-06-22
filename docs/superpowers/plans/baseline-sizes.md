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
