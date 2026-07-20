# Contributing

## Prerequisites

- Go 1.25+
- Node.js 22+
- pnpm 9.12.3+

Install dependencies from the repository root:

```bash
pnpm install
```

## Development workflow

Use the narrowest command that covers your change:

| Change           | Command          |
| ---------------- | ---------------- |
| Go core          | `pnpm test:go`   |
| Node.js packages | `pnpm test`      |
| Package checks   | `pnpm check`     |
| Full validation  | `pnpm check:all` |

Run `pnpm check:all` before opening a pull request. It covers formatting, linting, upstream compatibility, tests, and builds.

## Upstream compatibility

The repository vendors the upstream PostCSS test suite. Check and run the compatibility lanes with:

```bash
pnpm check:upstream
pnpm test:upstream
pnpm test:upstream:go
pnpm test:upstream:go:parse
pnpm test:upstream:go:stringify
```

Refresh the vendored snapshot only when needed:

```bash
pnpm sync:upstream
```

See [the Go compatibility overrides](../packages/postcss-compat/overrides/go/README.md) for coverage details.

## Benchmarks

Compare the Go engine with upstream PostCSS:

```bash
pnpm bench
```

See [benchmark.md](benchmark.md) for workloads and individual benchmark commands.

## Pull requests

Before submitting a pull request:

- keep changes focused and update relevant tests;
- run the narrowest checks for the changed modules;
- run `pnpm check:all` for cross-layer changes;
- include benchmark results when changing performance-sensitive code;
- update documentation when public behavior or commands change.

GitHub Actions runs the same validation across Ubuntu, macOS, and Windows. A scheduled workflow keeps the vendored PostCSS tests in sync.
