#!/usr/bin/env bash
# Build locked_in for MAINNET: temporarily set declare_id to the held mainnet
# program id, anchor build, then restore declare_id to the devnet id so the
# working tree stays clean. Anchor bakes declare_id into the .so + IDL, so the
# artifacts carry the mainnet id even after the source is restored.
#
#   scripts/deploy/build-mainnet-program.sh
#
# Output: target/deploy/locked_in.so + target/idl/locked_in.json (mainnet id).
# Deploy immediately (deploy-mainnet.sh) before any other `anchor build`
# overwrites these with the devnet id.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

KEYPAIR="keys/mainnet/locked_in-mainnet-keypair.json"
LIB="programs/locked_in/src/lib.rs"
DEVNET_ID="3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav"

[ -f "$KEYPAIR" ] || { echo "ERROR: $KEYPAIR missing — generate the mainnet program keypair first."; exit 1; }
MAINNET_ID="$(solana address -k "$KEYPAIR")"
echo "mainnet program id: $MAINNET_ID"

# Always restore declare_id, even on build failure.
restore() {
  if ! grep -q "declare_id!(\"$DEVNET_ID\")" "$LIB"; then
    perl -0pi -e "s/declare_id!\\(\"[^\"]+\"\\)/declare_id!(\"$DEVNET_ID\")/" "$LIB"
    echo "restored declare_id -> $DEVNET_ID"
  fi
}
trap restore EXIT

perl -0pi -e "s/declare_id!\\(\"[^\"]+\"\\)/declare_id!(\"$MAINNET_ID\")/" "$LIB"
echo "declare_id set -> $MAINNET_ID; building…"
anchor build -p locked_in

DEPLOYED_ID="$(solana address -k target/deploy/locked_in-keypair.json 2>/dev/null || echo '?')"
echo ""
echo "built: target/deploy/locked_in.so (declare_id $MAINNET_ID)"
echo "NOTE: deploy with --program-id $KEYPAIR (NOT target/deploy/locked_in-keypair.json = $DEPLOYED_ID)"
echo "next: scripts/deploy/deploy-mainnet.sh"
