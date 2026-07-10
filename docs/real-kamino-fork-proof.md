# Real-Kamino deposit→claim — surfpool mainnet-fork proof

**Status: PASSED 2026-07-10.** Certifies the mainnet transaction shape for the
v2 custody program against the REAL Kamino Lend (klend) program, on a local
surfpool mainnet fork. This is the artifact the mainnet-readiness checklist
requires ("Green devnet e2e does NOT certify mainnet tx shape").

## What it proves

- `deposit_reserve_liquidity` CPI into real klend mints cTokens to the lock's
  collateral ATA, with our exact 14-account `lock_funds_v2` layout.
- `refresh_reserve` (prepended client-side) is accepted by real klend.
- `redeem_reserve_collateral` CPI + the `settle` split return USDC to the
  owner, route the yield share, and close the lock.
- The on-chain program already pins real `KLEND_PROGRAM_ID` on a non-`devnet`
  build (the mock reserve is a `--features devnet` path only).

## What it does NOT prove

Yield **magnitude**. klend enforces an oracle `max_age` of 180s. A surfpool
fork freezes the scope oracle at fork time and cannot re-crank it, so warping
the clock forward to accrue visible interest ages the price out and klend
rejects the refresh (and large warps overflow klend's accrual math). Redeem
returns principal minus klend integer-rounding dust (~1 lamport) because ~0
time elapses. On mainnet the live scope oracle is cranked every slot and the
collateral exchange rate rises over the lock — that is a runtime property, not
a tx-shape property.

## Key facts discovered

- Active main-market USDC reserve: `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`
  (status=0, ~4.4% APY). `getReserveBySymbol('USDC')` returns an OBSOLETE
  status=2 reserve (`5xXxt9uV…`, deposit-limit 0, 0.000% APY) — always pin the
  active reserve by address.
- USDC uses the **Scope** oracle only (`3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH`);
  pyth/switchboard slots take the klend program-id sentinel.
- `refresh_reserve` discriminator `[2,218,138,235,79,201,25,102]`, accounts
  `[reserve(w), lendingMarket, pyth, sbPrice, sbTwap, scopePrices]`.

## Reproduce

```bash
# 1. surfpool mainnet fork (see backend/scripts/README-SURFPOOL.md to install)
surfpool start --network mainnet --no-tui        # RPC @127.0.0.1:8899

# 2. resolve the active reserve's account set
cd backend
node scripts/resolve-kamino-usdc-reserve.mjs http://127.0.0.1:8899 /tmp/kamino-usdc-reserve.json

# 3. build locked_in with declare_id == a keypair you hold, deploy to the fork
#    (the live 3RC9… keypair is not held locally — the fork proof uses the
#     target/deploy/locked_in-keypair.json id EUABEbHUj…; declare_id is
#     temporarily set to match, then reverted. See git history.)
cd .. && anchor build -p locked_in
solana program deploy target/deploy/locked_in.so \
  --program-id target/deploy/locked_in-keypair.json --url http://127.0.0.1:8899

# 4. run the round-trip proof
cd backend && node scripts/fork-proof-kamino-roundtrip.mjs
# → ✅ FORK PROOF PASSED
```

## Mainnet cutover checklist (still open)

The tx shape is proven; these remain before real funds (see
`docs/mainnet-readiness-checklist.md`):

- Deploy `locked_in` to mainnet with a program id whose keypair is held
  (Squads-owned upgrade authority); fix `declare_id` + `community_pot` IDL build.
- `initialize_vault_v2` with the active reserve accounts (resolver output),
  distinct pot/fee vaults behind the multisig, `authority` = ops key.
- Set `NEXT_PUBLIC_KAMINO_SCOPE_PRICES` (defaults to the USDC scope oracle) and
  the client's `NEXT_PUBLIC_VAULT_V2_PROGRAM_ID`/USDC mint to mainnet.
- Backend `YIELD_STRATEGY_PROFILE=kamino_usdc_mainnet`, `CLUSTER=mainnet`,
  paid RPC; `YIELD_KAMINO_RESERVE_ADDRESS` pinned to `D6q6wuQS…`.
- External audit + monitoring + soft-launch with your own funds first.
