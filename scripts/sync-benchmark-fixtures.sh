#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/benchmark/fixtures/css"

mkdir -p "$DIR"

curl -fsSL -o "$DIR/modern-normalize.css" \
  "https://cdn.jsdelivr.net/npm/modern-normalize@3.0.1/modern-normalize.css"
curl -fsSL -o "$DIR/tailwind-preflight.css" \
  "https://cdn.jsdelivr.net/npm/tailwindcss@3.4.17/src/css/preflight.css"
curl -fsSL -o "$DIR/animate.min.css" \
  "https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.min.css"
curl -fsSL -o "$DIR/bootstrap.css" \
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.css"
curl -fsSL -o "$DIR/bootstrap.min.css" \
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"

echo "Synced benchmark fixtures into $DIR"
