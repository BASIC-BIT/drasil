#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

METRIC_PATHS=(
  "$ROOT_DIR/src"
  "$ROOT_DIR/apps/web"
  "$ROOT_DIR/packages/contracts"
)

echo "== scc (size) =="
scc \
  --exclude-dir "node_modules,.git,dist,build,.next,coverage,src/generated/prisma" \
  "${METRIC_PATHS[@]}"

echo "== lizard (production complexity/function length) =="
# Keep this separate from METRIC_PATHS: scc reports package size, while lizard
# gates only production source paths. The CCN baseline starts at 50 and ratchets
# toward 25 as documented in docs/dev/maintainability.md.
lizard -C 50 -L 300 -w \
  -x "*/node_modules/*" \
  -x "*/.next/*" \
  -x "*/coverage/*" \
  -x "*/src/generated/prisma/*" \
  -x "*/__tests__/*" \
  -x "*/test/*" \
  "$ROOT_DIR/src" \
  "$ROOT_DIR/apps/web/app" \
  "$ROOT_DIR/apps/web/lib" \
  "$ROOT_DIR/packages/contracts/src"

echo "== largest tracked source/test files (advisory) =="
git -C "$ROOT_DIR" ls-files --cached --others --exclude-standard \
  '*.ts' '*.tsx' '*.js' '*.mjs' \
  ':!:node_modules/**' \
  ':!:dist/**' \
  ':!:build/**' \
  ':!:.next/**' \
  ':!:coverage/**' \
  ':!:src/generated/prisma/**' |
while IFS= read -r file; do
  [[ -f "$ROOT_DIR/$file" ]] || continue
  lines="$(wc -l < "$ROOT_DIR/$file" | tr -d ' ')"
  printf '%5s %s\n' "$lines" "$file"
done | sort -nr | head -20
