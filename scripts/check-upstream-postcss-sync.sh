#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_DIR="$ROOT_DIR/vendor/postcss"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

if [ ! -d "$EXPECTED_DIR/test" ] || [ ! -d "$EXPECTED_DIR/lib" ]; then
  echo "Missing vendored upstream PostCSS snapshot at $EXPECTED_DIR"
  echo "Run ./scripts/sync-upstream-postcss-tests.sh first."
  exit 1
fi

SKIP_PREPARE_COMPAT=1 TARGET_DIR="$TMP_DIR/postcss" "$ROOT_DIR/scripts/sync-upstream-postcss-tests.sh" "${1:-main}" >/dev/null

if ! diff -qr "$EXPECTED_DIR" "$TMP_DIR/postcss" >/dev/null; then
  echo "Vendored upstream PostCSS snapshot is out of date."
  echo "Run ./scripts/sync-upstream-postcss-tests.sh and commit the result."
  if [ -f "$EXPECTED_DIR/SOURCE.json" ]; then
    echo "Current snapshot:"
    jq -r '"  \(.repo)@\(.ref) (\(.commit))"' "$EXPECTED_DIR/SOURCE.json"
  fi
  diff -qr "$EXPECTED_DIR" "$TMP_DIR/postcss" || true
  exit 1
fi

if [ -f "$EXPECTED_DIR/SOURCE.json" ]; then
  echo "Vendored upstream PostCSS snapshot is in sync ($(jq -r '.commit' "$EXPECTED_DIR/SOURCE.json"))."
else
  echo "Vendored upstream PostCSS snapshot is in sync."
fi
