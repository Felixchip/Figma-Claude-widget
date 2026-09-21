#!/usr/bin/env bash
# Build the uploadable archive: artifacts/gsa-build-kit.zip
# It contains the whole plugin, including the skill bundle.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/artifacts"
PLUGIN="$REPO/chatgpt-plugin"
ZIP="$OUT/gsa-build-kit.zip"

mkdir -p "$OUT"
rm -f "$OUT/gsa-build-kit.zip" "$OUT/gsa-build-kit-plugin.zip" "$OUT/gsa-build-kit-skill.zip"

# Wrap in a gsa-build-kit/ folder so it extracts cleanly.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/gsa-build-kit"
rsync -a \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.DS_Store' \
  "$PLUGIN/" "$TMP/gsa-build-kit/"
(cd "$TMP" && zip -qr "$ZIP" "gsa-build-kit")

echo "Built $ZIP"
unzip -l "$ZIP"
