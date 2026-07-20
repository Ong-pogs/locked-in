#!/usr/bin/env bash
# Build locked_in for the LIVE DEVNET v2 program: temporarily set declare_id to
# the deployed devnet v2 id, anchor build, then restore declare_id to the id the
# source checks in with so the working tree stays clean. Anchor bakes declare_id
# into the .so + IDL, so the artifacts carry the devnet v2 id even after the
# source is restored.
#
#   scripts/deploy/build-devnet-v2.sh
#
# This exists because the live devnet v2 program (EUAB…GucsN) is not the id in
# lib.rs, so without patching there is no way to rebuild and redeploy it — and
# every mainnet-only code path (set_pot_authority, the 2-arg initialize_pot,
# open_lock_v2's init_if_needed) would otherwise first execute on mainnet.
# Rehearse them on devnet with this build.
#
# Output: target/deploy/locked_in.so + target/idl/locked_in.json (devnet v2 id).
# Deploy immediately before any other `anchor build` overwrites these.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

LIB="programs/locked_in/src/lib.rs"
SOURCE_ID="3RC9XkPZNSgXksp9Fb7J4LE7cQNYUUQdxkaaQnz6kBav"
DEVNET_V2_ID="EUABEbHUjiUn9NijapRJT2MVqQ5nSdqH3gSzTxyGucsN"

grep -q "declare_id!(\"$SOURCE_ID\")" "$LIB" || {
  echo "ERROR: $LIB does not declare $SOURCE_ID — refusing to patch a tree that is mid-edit."
  exit 1
}
echo "devnet v2 program id: $DEVNET_V2_ID"

# Always restore declare_id, even on build failure.
restore() {
  if ! grep -q "declare_id!(\"$SOURCE_ID\")" "$LIB"; then
    perl -0pi -e "s/declare_id!\\(\"[^\"]+\"\\)/declare_id!(\"$SOURCE_ID\")/" "$LIB"
    echo "restored declare_id -> $SOURCE_ID"
  fi
}
trap restore EXIT

perl -0pi -e "s/declare_id!\\(\"[^\"]+\"\\)/declare_id!(\"$DEVNET_V2_ID\")/" "$LIB"
echo "declare_id set -> $DEVNET_V2_ID; building…"
anchor build -p locked_in

DEPLOYED_ID="$(solana address -k target/deploy/locked_in-keypair.json 2>/dev/null || echo '?')"
echo ""
echo "built: target/deploy/locked_in.so (declare_id $DEVNET_V2_ID)"
if [ "$DEPLOYED_ID" != "$DEVNET_V2_ID" ]; then
  echo "WARNING: target/deploy/locked_in-keypair.json = $DEPLOYED_ID, not the devnet v2 id."
  echo "         Pass the devnet v2 program keypair explicitly via --program-id."
fi
echo "upgrade (must be signed by the on-chain upgrade authority, NOT the ops key):"
echo "  solana program deploy --url devnet --program-id target/deploy/locked_in-keypair.json \\"
echo "    --upgrade-authority <upgrade-authority.json> target/deploy/locked_in.so"
