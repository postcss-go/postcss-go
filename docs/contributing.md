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

| Change            | Command          |
| ----------------- | ---------------- |
| Go core           | `pnpm test:go`   |
| Node.js packages  | `pnpm test`      |
| TypeScript checks | `pnpm check`     |
| Full validation   | `pnpm check:all` |

Run `pnpm check:all` before opening a pull request. It runs formatting, linting, TypeScript type checks, upstream sync verification, JS/Go/upstream tests (including `test:upstream:go`), and builds.

## Upstream compatibility

The repository vendors the upstream PostCSS test suite. Check and run the compatibility lanes with:

```bash
pnpm check:upstream
pnpm test:upstream
pnpm test:upstream:go
```

Refresh the vendored snapshot only when needed:

```bash
pnpm sync:upstream
```

See [the Go compatibility overrides](../packages/postcss-compat/src/README.md) for coverage details.

## Benchmarks

See [benchmark.md](benchmark.md) for workloads and individual benchmark commands.

## Pull requests

Before submitting a pull request:

- keep changes focused and update relevant tests;
- run the narrowest checks for the changed modules;
- run `pnpm check:all` for cross-layer changes;
- include benchmark results when changing performance-sensitive code;
- update documentation when public behavior or commands change.

## Releases

When a change affects a published package, add a changeset before opening the
pull request:

```bash
pnpm changeset
```

Select the affected package(s), choose the semver bump, and commit the
generated file under `.changeset/`. The release workflow creates a release PR
that updates package versions and changelogs. After that PR is merged, it
builds and publishes the public packages to npm.

Useful local checks and commands:

```bash
pnpm changeset:check
pnpm changeset:version
pnpm release
```

Publishing requires the repository `NPM_TOKEN` secret. The compatibility
harness package remains private and is not published.

GitHub Actions runs the same validation across Ubuntu, macOS, and Windows. A scheduled workflow keeps the vendored PostCSS tests in sync.
