# Upstream PostCSS Tests

This repository tracks the upstream `postcss/postcss` `lib/` and `test/` directories under `vendor/postcss/`.

Snapshot provenance is recorded in `vendor/postcss/SOURCE.json`:

```json
{
  "repo": "https://github.com/postcss/postcss",
  "ref": "main",
  "commit": "<pinned-sha>"
}
```

## Why vendor the upstream tests

- We want a stable, reviewable snapshot of the upstream test suite inside this repository.
- We do not want every unrelated PR to fail just because `postcss/postcss` changed a few minutes earlier.
- A bot-driven sync PR makes upstream test changes explicit and easy to review.

## Phases

1. **Phase 1 (active):** Keep the upstream snapshot synchronized automatically and gate PRs on snapshot freshness.
2. **Phase 2 (active):** Run the vendored upstream suite through `@postcss-go/compat`, with selective Go-backed overrides.
3. **Phase 3 (active):** Gate PRs on the full upstream `uvu` unit suite in CI.

## Local commands

Sync the latest upstream snapshot:

```bash
pnpm sync:upstream
```

Fail if the vendored copy is stale:

```bash
pnpm check:upstream
```

Prepare compat overrides on top of the vendored `lib/`:

```bash
pnpm prepare:upstream-compat
```

Run the full upstream unit suite (652 tests):

```bash
pnpm test:upstream
```

Run the Go compat tokenizer subset:

```bash
pnpm test:upstream:go
```

## Compat modes

`packages/postcss-compat/overrides/` can replace individual modules under `vendor/postcss/lib/`.

| Mode       | Command                        | Behavior                             |
| ---------- | ------------------------------ | ------------------------------------ |
| `upstream` | `POSTCSS_COMPAT_MODE=upstream` | Vendored upstream `lib/` only        |
| `go`       | `POSTCSS_COMPAT_MODE=go`       | Apply overrides from `overrides/go/` |

See `packages/postcss-compat/overrides/go/README.md` for the current Go-backed module status.

## CI behavior

### Snapshot freshness (Phase 1)

The main CI workflow runs `./scripts/check-upstream-postcss-sync.sh` on every push and pull request.

### Full upstream suite (Phase 3)

CI also runs:

- `pnpm test:upstream` — full vendored PostCSS unit suite
- `pnpm test:upstream:go` — Go compat tokenizer subset

### Automatic sync PRs

The GitHub workflow `.github/workflows/upstream-postcss-sync.yml` runs on a schedule and can also be triggered manually.

When the upstream `lib/` or `test/` directories change, the workflow updates `vendor/postcss/` and opens a pull request with the synchronized snapshot.
