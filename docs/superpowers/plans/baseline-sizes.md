# Phase 0 Baseline (Task 0.1)

Recorded on branch `cost-reduction` at HEAD `d562a60`
(docs: add Solana cost-reduction implementation plan).
Date: 2026-06-22. Toolchain: anchor 0.31.1, solana 3.0.6, cargo 1.93.0.

## Baseline `.so` sizes (clean rebuild via `anchor build --no-idl`)

These are the TRUE current sizes from a fresh build of the committed
source. They differ from the plan's "expected" numbers because the plan's
expected figures were measured against an older state of the code (a stale
`lock_vault.so` of 399336 bytes was sitting in target/deploy from Jun 17).

| Program           | Current size (bytes) | Plan's expected (~) | Delta vs expected |
|-------------------|----------------------|---------------------|-------------------|
| lock_vault.so     | 511512               | 399336              | +112176 (larger)  |
| community_pot.so  | 343960               | 286992              | +56968 (larger)   |
| yield_splitter.so | 241192               | 207704              | +33488 (larger)   |

Total current = 1,096,664 bytes across the three programs.

## Build status

- `anchor build --no-idl`  -> SUCCESS for all 3 programs (SBF compile is healthy).
- `anchor build` (full)    -> FAILS at the IDL build step. Root cause:
  programs/community_pot/src/lib.rs:298 has
  `pub recipient: UncheckedAccount<'info>` with NO `/// CHECK:` doc comment,
  which trips Anchor's account-safety lint during `anchor idl build`.
  Only target/idl/yield_splitter.json exists; lock_vault.json and
  community_pot.json were never produced.

## Test status

- Rust unit tests (`cargo test --workspace`): PASS.
  community_pot 13, lock_vault 42, yield_splitter 14 = 69 passed, 0 failed.
  (The regular cargo compile does not run the IDL safety lint, so it is green.)

- Integration tests (`programs-tests`, LiteSVM, `npm test` after `npm install`):
  FAIL to load. Same root cause: tests/lock-lifecycle.test.ts reads
  target/idl/lock_vault.json, which does not exist because the IDL build failed.
  NOT an environment/dependency gap (npm install succeeded, LiteSVM is in-process)
  and NOT a test-code bug -- it is the missing-IDL downstream of the build failure.

## Note for later phases

Once the IDL build is unblocked (single-line `/// CHECK:` doc comment on the
`recipient` field), re-measure to get a clean baseline that also includes a
freshly built IDL, and re-run the integration suite. Use the byte sizes above
as the comparison point for cost-reduction deltas.
