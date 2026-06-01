#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== scc (size) =="
scc \
  --exclude-dir "node_modules,.git,dist,build,.next,coverage,src/generated/prisma" \
  "$ROOT_DIR/apps/web" \
  "$ROOT_DIR/packages/contracts"

echo "== lizard (complexity) =="
lizard -C 25 -L 300 -w \
  -x "*/node_modules/*" \
  -x "*/.next/*" \
  -x "*/coverage/*" \
  "$ROOT_DIR/apps/web/app" \
  "$ROOT_DIR/apps/web/lib" \
  "$ROOT_DIR/packages/contracts/src"
