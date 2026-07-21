#!/usr/bin/env bash
# Deploy the mainnet-built locked_in.so to mainnet. Run build-mainnet-program.sh
# FIRST (its .so carries the mainnet declare_id). Requires a funded deploy
# wallet (~6-8 SOL for a program this size + rent).
#
#   MAINNET_RPC_URL=https://... DEPLOY_KEYPAIR=~/.config/solana/mainnet-deploy.json \
#     scripts/deploy/deploy-mainnet.sh
#
# After deploy, the upgrade authority is the DEPLOY WALLET. Transfer it to the
# Squads multisig immediately (see the runbook) — do NOT leave a hot key as
# upgrade authority on mainnet.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

RPC="${MAINNET_RPC_URL:?set MAINNET_RPC_URL to a paid mainnet RPC}"
DEPLOY_KP="${DEPLOY_KEYPAIR:?set DEPLOY_KEYPAIR to the funded deploy wallet json}"
PROGRAM_KP="keys/mainnet/locked_in-mainnet-keypair.json"
SO="target/deploy/locked_in.so"

[ -f "$PROGRAM_KP" ] || { echo "ERROR: $PROGRAM_KP missing."; exit 1; }
[ -f "$SO" ] || { echo "ERROR: $SO missing — run build-mainnet-program.sh first."; exit 1; }

MAINNET_ID="$(solana address -k "$PROGRAM_KP")"
IDL_ID="$(node -e "console.log(require('./target/idl/locked_in.json').address)")"
if [ "$IDL_ID" != "$MAINNET_ID" ]; then
  echo "ERROR: built IDL address ($IDL_ID) != mainnet program id ($MAINNET_ID)."
  echo "Re-run build-mainnet-program.sh (a devnet build overwrote the artifacts)."
  exit 1
fi

echo "program id : $MAINNET_ID"
echo "rpc        : $RPC"
echo "deploy wallet balance:"; solana balance -k "$DEPLOY_KP" --url "$RPC"
read -r -p "Deploy to MAINNET with REAL SOL? type 'deploy' to continue: " ok
[ "$ok" = "deploy" ] || { echo "aborted."; exit 1; }

# --use-rpc: send the ~515 write-chunk txs through the paid RPC instead of
#   forwarding to validator TPUs from this laptop (the default), which drops
#   writes through a third-party RPC like Alchemy and strands the buffer.
# --with-compute-unit-price: a priority fee so writes land under congestion
#   (override via PRIORITY_MICROLAMPORTS; ~negligible cost at 527KB).
# --max-sign-attempts: default 5 (~5 min) is too few if the network is busy.
PRIORITY_MICROLAMPORTS="${PRIORITY_MICROLAMPORTS:-50000}"
solana program deploy "$SO" \
  --program-id "$PROGRAM_KP" \
  --keypair "$DEPLOY_KP" \
  --url "$RPC" \
  --commitment confirmed \
  --use-rpc \
  --with-compute-unit-price "$PRIORITY_MICROLAMPORTS" \
  --max-sign-attempts 30

echo ""
echo "deployed $MAINNET_ID. Upgrade authority = deploy wallet (HOT)."
echo "NEXT (do not skip): transfer upgrade authority to the Squads multisig:"
echo "  solana program set-upgrade-authority $MAINNET_ID \\"
echo "    --keypair $DEPLOY_KP --new-upgrade-authority <SQUADS_VAULT> --url $RPC"
