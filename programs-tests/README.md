# Integration tests for the Locked In Anchor program

LiteSVM-driven end-to-end test of the full lock lifecycle. Satisfies
**Milestone 2 #6** of the Solana Foundation grant tranche:

> "Integration tests (lock → supply → yield accrual → claim)"

## What it covers

`lock_vault` + `community_pot` were merged into ONE program (`locked_in`) to
pay a single Anchor baseline instead of two. There is now ONE program ID and
ONE `Program` instance. The custody (vault) domain is still a pure escrow (v4):
the game/fuel/ichor layer moved off-chain (the backend owns points).
`lock_end_ts` is immutable — missed learning days are yield-only and never
extend the principal lock.

Because both former programs defined a `ProtocolConfig` (struct + `b"protocol"`
seed) and an `initialize_protocol` instruction, the merge re-named them to
avoid discriminator / PDA collisions under one program ID:

| Was                         | Now (vault)        | Now (pot)        |
|-----------------------------|--------------------|------------------|
| `ProtocolConfig` (struct)   | `VaultConfig`      | `PotConfig`      |
| seed `b"protocol"`          | `b"vault-protocol"`| `b"pot-protocol"`|
| `initialize_protocol` (ix)  | `initialize_vault` | `initialize_pot` |

All other seeds (`b"lock"`, `b"window"`, `b"distribution"`, `b"redirect"`,
`b"distribution-receipt"`) were already unique and are unchanged.

`tests/lock-lifecycle.test.ts` holds two tests against the merged program.

The happy-path test chains real transactions through the full lifecycle:

1. Create the stable mint, fund test owner, pre-fund the community pot vault
2. `initialize_vault` (usdc mint) — vault config PDA `b"vault-protocol"`
3. `initialize_pot` (stable mint) — pot config PDA `b"pot-protocol"`
4. `lock_funds(100 USDC, 30 days)` + asserts stable_vault balance, lock_account.principal_amount, owner USDC delta
5. `record_redirect` + asserts PotWindow total_redirected_amount, redirect_count
6. Clock warp past `lock_end_ts`
7. `unlock_funds()` + asserts owner USDC += full principal, stable_vault closed, lock_account closed

The second test is a custody security regression: it locks 100 real USDC, then
attempts `unlock_funds()` with a FAKE stable mint + fake vault (funded to
principal so the balance check alone would pass). `unlock_funds` MUST reject it
on the stable-mint address constraint (`InvalidMint`), leaving the real lock +
real USDC vault intact and un-stranded.

Every `→ assert` is on **real on-chain state** produced by **real
transactions** sent to an in-process LiteSVM (mainnet-equivalent BPF
execution). No struct mutation in memory, no mocked CPI. The program
runs as the compiled `locked_in.so` loaded from `target/deploy/`.

## Run

```bash
cd /                       # repo root
anchor build               # produce target/deploy/locked_in.so + target/idl/locked_in.json
cd programs-tests
npm install                # first time only
npm test
```

Expected: `Tests  2 passed (2)` in ~500ms.

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
here because we're testing our own program in isolation. Devnet is
non-deterministic and slow.

## Notes

- The `recipient` field on the pot `DistributeWindow` accounts struct carries
  a `/// CHECK:` doc comment (it is used only as the authority/owner of its
  ATA; the payout is bounded on-chain by the distribution-window remaining
  cap + the distribution-receipt double-pay guard), so `anchor build` lints
  cleanly without `--skip-lint`.
- The merged crate's `idl-build` feature includes `anchor-spl/idl-build` so
  Anchor 0.31.1's IDL generator resolves the SPL token-interface types.
