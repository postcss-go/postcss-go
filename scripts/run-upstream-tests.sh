#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_DIR="$ROOT_DIR/vendor/postcss"
MODE="${POSTCSS_COMPAT_MODE:-upstream}"
PATTERN="${UPSTREAM_TEST_PATTERN:-\\.test\\.(ts|js)$}"

export POSTCSS_COMPAT_MODE="$MODE"
export FORCE_COLOR=1
unset NO_COLOR

"$ROOT_DIR/scripts/prepare-upstream-compat.sh"

if [ ! -d "$UPSTREAM_DIR/test" ] || [ ! -d "$UPSTREAM_DIR/lib" ]; then
  echo "Missing vendored upstream PostCSS snapshot."
  echo "Run ./scripts/sync-upstream-postcss-tests.sh first."
  exit 1
fi

TEST_DIR="$UPSTREAM_DIR/test"

if [ "$MODE" = "go" ]; then
  pnpm --dir "$ROOT_DIR/packages/postcss-compat" exec uvu \
    -r "$ROOT_DIR/packages/postcss-compat/register.cjs" \
    "$TEST_DIR" "$PATTERN"
else
  pnpm --dir "$ROOT_DIR/packages/postcss-compat" exec uvu \
    -r "$ROOT_DIR/packages/postcss-compat/register.cjs" \
    "$TEST_DIR" "$PATTERN"
fi
