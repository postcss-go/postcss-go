# Phase 1 verification

Base: pushed Phase 0 commit `7eec8c16e9c0009b42b80cc7ccc2975dc4294528`.
Scope: [protocol 2.1](../../native-handle-protocol-v2.md), measured working tree
containing the Phase 1 changes. Owner: postcss-go maintainers.

- Core: **581/581** tests; **96.79%** lines, **89.98%** branches,
  **99.37%** functions. All existing coverage thresholds pass.
- Go: **95.9%** statements, above the required 90%; all Go tests pass.
- Vite: 100% lines; webpack/rspack: 99.62% lines; compatibility adapter:
  99.65% lines. Existing package thresholds pass.
- Both upstream modes: **701/701**, no skips. Vendored-node coverage is not
  Go-backed facade coverage.
- Race: `go test -race ./internal/asthandle ./internal/nativebridge` passes.
- Generated protocol drift check, typechecks, native/JS/WASM builds, ESLint,
  Go vet, module-path check, Prettier, gofmt and `git diff --check` pass.
- The standalone C ABI fixture compiles/executes against the actual archive:
  old V2 calls retain their signatures, cursors work, and new errors are freed
  through the library. CI now runs this fixture after native build.
- Windows dynamic function-pointer declarations compile against the generated
  cgo header using a C type-compatibility check. Windows execution is not claimed.
- The Phase 0 corpus still reports 1/7 forced-handle compatible, with the same
  recorded map difference and six unsupported cases; automatic rollout is blocked.

The aggregate coverage command stalled in its npm installation smoke test because
Turborepo filters the offline environment variable. It was interrupted at the
blocked npm child and the complete core suite rerun directly with cached npm
packages; no tests or thresholds were skipped. The final passing commands include:

```sh
npm_config_offline=true pnpm --filter @postcss-go/core test:coverage
pnpm test:coverage:go
pnpm test:upstream
pnpm test:upstream:go
pnpm qualify:native
pnpm check:handles
pnpm check
pnpm format:check
pnpm lint
go test -race ./internal/asthandle ./internal/nativebridge
```

[benchmarks.json](benchmarks.json) retains five independent processes for the
1,000-declaration fixture and Modern Normalize. The large pathological bulk
stress case was not rerun in Phase 1 and must not be used to justify rollout.
The benchmark rows carry stability/gate outcomes: the 1,000-declaration case
passes, while Modern Normalize fails the stability bound. These remain restricted
scalar measurements and do not qualify rollout. [lines-base.json](lines-base.json) and
[lines-current.json](lines-current.json) refresh the phase-boundary counts using
the same script. No runtime language-ratio or general facade performance claim
is made from generated constants or compatibility adapters.
