#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_LIB="${POSTCSS_COMPAT_TARGET_LIB:-$ROOT_DIR/vendor/postcss/lib}"
OVERRIDES_DIR="$ROOT_DIR/packages/postcss-compat/overrides"
MODE="${POSTCSS_COMPAT_MODE:-upstream}"

if [ ! -d "$TARGET_LIB" ]; then
  echo "Missing vendored upstream lib at $TARGET_LIB"
  echo "Run ./scripts/sync-upstream-postcss-tests.sh first."
  exit 1
fi

apply_override() {
  local file="$1"
  case "$file" in
    *.js) ;;
    *) return 0 ;;
  esac
  cp "$file" "$TARGET_LIB/$(basename "$file")"
}

case "$MODE" in
  upstream)
    if [ -d "$OVERRIDES_DIR/upstream" ]; then
      for file in "$OVERRIDES_DIR/upstream"/*; do
        [ -e "$file" ] || continue
        apply_override "$file"
      done
    fi
    ;;
  go)
    if [ ! -d "$OVERRIDES_DIR/go" ]; then
      echo "Missing Go compat overrides at $OVERRIDES_DIR/go"
      exit 1
    fi
    for file in "$OVERRIDES_DIR/go"/*; do
      [ -e "$file" ] || continue
      apply_override "$file"
    done
    ;;
  *)
    echo "Unsupported POSTCSS_COMPAT_MODE: $MODE (expected upstream or go)"
    exit 1
    ;;
esac

echo "Prepared upstream compat lib (mode=$MODE)"
