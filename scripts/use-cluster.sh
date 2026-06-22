#!/usr/bin/env bash
#
# Switch the active Solana cluster profile for the backend + web-app.
#
#   Usage: scripts/use-cluster.sh <devnet|mainnet>
#
# Copies the per-cluster profile into the file each app actually loads:
#   backend/.env.<cluster>      -> backend/.env        (dotenv loads this)
#   web-app/.env.<cluster>      -> web-app/.env.local   (Next loads this last; wins)
#
# All .env / .env.* files are gitignored (they hold the Alchemy RPC key +
# secrets). The Alchemy key lives ONLY in backend files — never in web-app
# (NEXT_PUBLIC_* ships to the browser). The mainnet profile carries a
# <FILL_AT_MAINNET_DEPLOY> placeholder for the program ID that must be
# filled once the program is deployed to mainnet.
set -euo pipefail

CLUSTER="${1:-}"
if [[ "$CLUSTER" != "devnet" && "$CLUSTER" != "mainnet" ]]; then
  echo "Usage: $0 <devnet|mainnet>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for app_file in "backend/.env.$CLUSTER:backend/.env" "web-app/.env.$CLUSTER:web-app/.env.local"; do
  src="$ROOT/${app_file%%:*}"
  dst="$ROOT/${app_file##*:}"
  if [[ ! -f "$src" ]]; then
    echo "ERROR: missing profile $src" >&2
    exit 1
  fi
  cp "$src" "$dst"
  echo "  $dst  <-  ${app_file%%:*}"
done

echo "✅ Switched to $CLUSTER. Restart backend (node --watch src/server.mjs) and web-app (next dev) to apply."
if [[ "$CLUSTER" == "mainnet" ]]; then
  echo "⚠️  mainnet profile has a <FILL_AT_MAINNET_DEPLOY> placeholder — fill the program ID before running."
fi
