#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/postcss/postcss}"
UPSTREAM_REF="${1:-${UPSTREAM_REF:-main}}"
TARGET_DIR="${TARGET_DIR:-$ROOT_DIR/vendor/postcss}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

ARCHIVE_URL="${UPSTREAM_REPO%/}/archive/$UPSTREAM_REF.tar.gz"

curl -fsSL "$ARCHIVE_URL" -o "$TMP_DIR/postcss.tar.gz"
tar -xzf "$TMP_DIR/postcss.tar.gz" -C "$TMP_DIR"

mkdir -p "$TARGET_DIR"
rm -rf "$TARGET_DIR/test" "$TARGET_DIR/lib"

SOURCE_DIR="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"

if [ -z "$SOURCE_DIR" ]; then
  echo "Unable to find extracted PostCSS archive directory."
  exit 1
fi

cp -R "$SOURCE_DIR/test" "$TARGET_DIR/test"
cp -R "$SOURCE_DIR/lib" "$TARGET_DIR/lib"
cp "$SOURCE_DIR/package.json" "$TARGET_DIR/package.json"

if [ "${SKIP_PREPARE_COMPAT:-0}" != "1" ]; then
  "$ROOT_DIR/scripts/prepare-upstream-compat.sh"
fi

REPO_PATH="${UPSTREAM_REPO#https://github.com/}"
REPO_PATH="${REPO_PATH%.git}"
COMMIT_SHA="$(curl -fsSL "https://api.github.com/repos/$REPO_PATH/commits/$UPSTREAM_REF" | jq -r '.sha')"

jq -n \
  --arg repo "$UPSTREAM_REPO" \
  --arg ref "$UPSTREAM_REF" \
  --arg commit "$COMMIT_SHA" \
  '{repo: $repo, ref: $ref, commit: $commit}' \
  > "$TARGET_DIR/SOURCE.json"

echo "Synced upstream PostCSS lib/test from $UPSTREAM_REPO@$UPSTREAM_REF ($COMMIT_SHA) into $TARGET_DIR"
