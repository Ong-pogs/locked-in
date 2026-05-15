# Surfpool + Kamino — demo runbook

For demo recordings we route our existing Kamino integration through a
local Surfpool mainnet fork. The deployed app at `lockedin.ong` stays on
`fixed_apy_dev` (devnet) — Surfpool is local-only because hosting it
would defeat its purpose.

## Why

- Real Kamino program (mainnet KLend at `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`)
- Real USDC reserve (main market `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF`)
- Real Pyth/Scope oracles posting fresh prices
- Real borrowers paying interest → APY > 0
- Zero real-money risk; runs locally

## One-time install

```bash
# Apple Silicon
TMP=$(mktemp -d)
curl -sL https://github.com/solana-foundation/surfpool/releases/download/v1.2.1/surfpool-darwin-arm64.tar.gz \
  | tar -xz -C "$TMP"
mkdir -p ~/.local/bin
cp "$TMP/surfpool" ~/.local/bin/surfpool
chmod +x ~/.local/bin/surfpool
rm -rf "$TMP"
surfpool --version   # should print 1.2.1
```

For Intel Macs / Linux, swap `darwin-arm64` for `darwin-x64` or `linux-x64`.

## Start Surfpool (before recording)

```bash
surfpool start --network mainnet --no-tui
```

This:
- Boots a local Solana validator on `127.0.0.1:8899` (RPC) and `:8900` (WS)
- Lazy-fetches any mainnet account your transactions touch
- Tracks your writes locally — real mainnet is never modified

Leave it running in its own terminal. Cancel with Ctrl-C.

## Verify it's working

```bash
node backend/scripts/test-surfpool-kamino.mjs
```

Expected output: live USDC supply APY, borrow APY, utilization, and total
supply/borrow numbers pulled from real mainnet state via Surfpool. If the
numbers come back, the path is working.

## Point the backend at Surfpool

Set one env var in `backend/.env` (or a `.env.surfpool` you swap in for
demo recordings):

```
YIELD_STRATEGY_PROFILE=kamino_surfpool
```

The `kamino_surfpool` profile is defined in `backend/src/config.mjs` and
locks in the localhost RPC + Kamino main-market address + USDC reserve
symbol. No individual override needed.

Available profiles:

- `fixed_apy_dev` — devnet default, mock 8% APY
- `kamino_surfpool` — local Surfpool fork, real Kamino mainnet state
- `kamino_usdc_mainnet` — real mainnet, real funds

Restart the backend. The dashboard's APY display now reads from real
Kamino state via Surfpool. The lock-vault relay and faucet still run
against devnet — only the yield reads use Surfpool.

## After the demo

Stop Surfpool (Ctrl-C), revert the env vars to your normal devnet config,
restart the backend. The deployed prod stack at `lockedin.ong` is
unaffected — it's never been pointed at Surfpool.

## Gotchas

- Surfpool's first request for an unknown mainnet account takes ~1-2s
  (the lazy fetch). Subsequent reads are instant. Pre-warm by running
  the smoke test before recording.
- The local fork's slot advances on its own schedule (default 400ms per
  slot). If reserve refresh logic complains about stale slots, restart
  Surfpool for a fresh checkpoint.
- Mainnet RPC quotas: Surfpool falls back to the public
  `api.mainnet-beta.solana.com` which rate-limits aggressively. Set
  `SURFPOOL_DATASOURCE_RPC_URL` to a Helius or Triton URL if you hit
  429s. For a one-shot demo recording, the default is fine.
