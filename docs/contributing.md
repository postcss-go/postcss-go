# Contributing

## Prerequisites

- Go 1.25+
- Node.js 22+
- pnpm 9.12.3+

Install dependencies from the repository root:

```bash
pnpm install
```

Package scripts (`build`, `check`, `test`, `test:coverage`) are orchestrated with [Turborepo](https://turborepo.dev/). Prefer the root `pnpm` scripts below; they call `turbo run` so dependent packages build in the correct order and cacheable outputs are reused.

## Development workflow

Use the narrowest command that covers your change:

| Change             | Command          |
| ------------------ | ---------------- |
| Go core            | `pnpm test:go`   |
| Node.js packages   | `pnpm test:js`   |
| JS + Go unit tests | `pnpm test`      |
| TypeScript checks  | `pnpm check`     |
| Full validation    | `pnpm check:all` |

Filter to a single package when needed, for example `pnpm exec turbo run test --filter=@postcss-go/shared`.

Run `pnpm check:all` before opening a pull request. It runs formatting, linting, TypeScript type checks, upstream sync verification, JS/Go/upstream tests (including `test:upstream:go`), and builds.

Installing dependencies configures a pre-commit hook that runs `pnpm lint` and `pnpm format:check`. If formatting fails, run `pnpm format`, review the changes, and commit again. If lint fails, fix the reported issues before committing.

`pnpm format` / `pnpm format:check` run Prettier on JS/TS and `gofmt` on Go files. Both skip `vendor/` (and `node_modules/`).

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
builds and publishes the public packages to npm and tags the matching Go
module release (`v0.0.x`, aligned with `@postcss-go/core`; first Go release
is `v0.0.5`). Merging Go API changes also triggers
`.github/workflows/go-module-release.yml` to push the tag when npm has already
shipped that version.

Useful local checks and commands:

```bash
pnpm changeset:check
pnpm changeset:version
pnpm release
node ./scripts/check-go-module-path.mjs
node ./scripts/smoke-go-module.mjs
```

`pnpm release` requires all eight validated native addons to be installed in
their platform packages. It snapshots them before the JavaScript/WASM build
and verifies that they are unchanged before publishing.

Publishing requires the repository `NPM_TOKEN` secret. The compatibility
harness and shared helper packages remain private; the shared runtime and
declarations are bundled into `@postcss-go/core`. The Go library is published
via Git tags on the root module (`github.com/postcss-go/postcss-go`); see
[Go API](go-api.md) for install and usage details.

GitHub Actions runs the same validation across Ubuntu, macOS, and Windows. A scheduled workflow keeps the vendored PostCSS tests in sync.
