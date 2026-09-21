#!/usr/bin/env bash
# Build the uploadable archives:
#   artifacts/gsa-build-kit-plugin.zip  the whole plugin package
#   artifacts/gsa-build-kit-skill.zip   the skill bundle for the submission Skills tab
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/artifacts"
PLUGIN="$REPO/chatgpt-plugin"

mkdir -p "$OUT"
rm -f "$OUT/gsa-build-kit-plugin.zip" "$OUT/gsa-build-kit-skill.zip"

# --- whole plugin, wrapped in a gsa-build-kit/ folder ----------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/gsa-build-kit"
rsync -a \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.DS_Store' \
  "$PLUGIN/" "$TMP/gsa-build-kit/"
(cd "$TMP" && zip -qr "$OUT/gsa-build-kit-plugin.zip" "gsa-build-kit")

# --- skill bundle only (contents of skills/, for the Skills tab) -----------
(cd "$PLUGIN/skills" && zip -qr "$OUT/gsa-build-kit-skill.zip" "gsa-build-kit" -x '*.DS_Store')

echo "Built:"
unzip -l "$OUT/gsa-build-kit-plugin.zip"
echo
unzip -l "$OUT/gsa-build-kit-skill.zip"
