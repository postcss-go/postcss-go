# Phase 0 qualification inputs

Owner: **postcss-go maintainers** (native runtime and compatibility maintainers).
Recorded 2026-09-07. This qualifies the migration baseline and measurement inputs;
it does not qualify default handle rollout.

## Reproducible source

Base commit: `6698aa06369fe2e978eb38667bae43f691397257`.
[base-ci.json](base-ci.json) records successful CI, Unit Tests and Codecov runs
for that exact commit, including GitHub run URLs. Those results belong to the
base commit, not to the uncommitted Phase 0 changes. No release was published or
qualified in this task; the two-release rollback window has not started.

The measured working tree additionally includes the existing protocol-negotiation
fixes captured in [baseline-overlay.patch](baseline-overlay.patch). Apply this
patch to the base to reproduce the runtime used here; use the qualification
scripts and manifest from this directory's change set. Rebuild the production
addon and JS package before measuring. The lockfile fixes transitive dependencies.

```sh
pnpm install --frozen-lockfile
pnpm --filter @postcss-go/core build
pnpm qualify:native
node benchmark/run-handles.mjs --qualification --stress
node scripts/count-runtime-lines.mjs --baseline
node scripts/count-runtime-lines.mjs
pnpm check:all
pnpm test:coverage
go test -race ./internal/asthandle ./internal/nativebridge
```

## Maintained corpus and denominator

[corpus.json](corpus.json) version **1.0.0** pins PostCSS 8.5.15,
postcss-import 16.1.1 and postcss-nested 8.0.1, their options and literal fixture
inputs. Six real-plugin cases cover import expansion, duplicate imports, nested
rules, preserved empty rules, custom bubbling and external maps; one owned scalar
case covers the currently implemented handle surface. Data URLs make import
resolution independent of network access and the current working directory.

Each of the **7 cases** has equal weight. The 95% threshold is **7/7** after
rounding up. Unsupported cases, map cases and known differences stay in the
denominator. These are a bounded maintained qualification corpus, not a claim
to represent every npm plugin or market share. Add filesystem import, async,
structural and previous-map cases as those phases define their contracts.

Maintainers own monthly and phase-boundary reviews. Dependency updates, option
changes, input edits and removals require a corpus version bump, regenerated
results and review of the denominator. Adding scalar variants to inflate the
selection numerator is prohibited. A baseline update must not silently accept a
new mismatch. The runner checks exact installed plugin versions and compares CSS,
warnings, messages and source maps against upstream with fresh plugin instances
for binary, auto and forced handle runs.

[corpus-results.json](corpus-results.json) records **1/7 forced-handle compatible**;
6/7 reject unsupported shapes/maps. Auto currently uses binary. Forced success
alone does not prove no hydration or auto selection: `--gate` fails closed until
selection/no-hydration instrumentation exists. The later 95% gate must count only
cases that select handles without hydration and satisfy the full observable
contract, including traces and errors added in later phases.

The exact `nested-map` mappings difference is owned and recorded in the manifest.
All other map fields remain compared. The runner marks this case
`known-difference`, not compatible. This records an existing bulk stringifier
limitation, not approval to waive source-map equivalence for rollout. Fix/review
it in Phase 4. No vendored upstream tests are skipped (701/701 in both modes).
Those suites use vendored node classes with Go parse/stringify overrides, not
Go-backed handle wrappers; they cannot contribute to the handle numerator.

## Benchmarks and bulk allocation investigation

The production benchmark records runtime, Go version, CPU, OS/kernel, architecture,
fixture SHA-256 and bytes, 10 warmups, 30 measured iterations and five independent
processes per mode, alternating order. RSS is process `maxRSS` in KiB, including
warmup, native Go heap and V8 heap. The memory comparison uses the maximum peak
across samples, not the median of peaks. Samples with max/min time above 1.20 in
either mode are marked unstable and cannot pass. The 1.20 stability bound is a
conservative qualification rule; stable samples still need the 1.05 time and 1.10
RSS gates. `--qualification` records failures without treating them as a release
failure; process errors or CSS mismatches still fail the command.

The 1,000/10,000-declaration synthetic workloads exercise scalar writes; pinned
Modern Normalize 3.0.1 exercises read-only scalar visits over representative mixed
CSS. These do not imply that real structural plugins work in handle mode. Their
unsupported outcomes are captured separately in the corpus report. CI runs the
small and representative fixtures and uploads raw results keyed by commit. The
10,000-declaration stress case is explicit (`--stress`) because the existing bulk
allocation issue can consume several GiB and should not exhaust shared CI runners.

Code-path investigation confirms the problematic scaling:

- `packages/postcss-go/src/codec.ts`: every `encodeLiveNode` invokes `encodeSource`,
  which writes `source.input.css` and map metadata for every node.
- `internal/codec/decode.go`: `decodeASTSource` passes each decoded source to
  `SourceFromBridgeDTO`.
- `internal/jsbridge/bridge.go`: `sourceFromDTO` creates a new Input whenever
  `loc.CSS` or `loc.Map` is nonempty, even with an inherited Input.

For 10,000 declarations, the 100,003-byte input is repeated at least 10,000 times:
at least **1,000,030,000 bytes** of CSS payload before writer copies, decoding and
Input allocations. This explains an allocation mechanism consistent with the
observed high RSS and unstable timings; it is not a heap-profile attribution of
all memory. It makes this bulk workload unsuitable for rollout speedup claims.
The runtime owner must deduplicate source identities/metadata with mixed-input,
previous-map and detached-node tests before using its ratios. A naive omission of
child input fields would corrupt imported-node origins and is not an acceptable
Phase 0 shortcut. No runtime codec change is included here.

## Line counts

[lines-base.json](lines-base.json) and [lines-current.json](lines-current.json)
record exact base SHA and whether sources come from the commit or working tree.
Counts exclude tests, generated code and the generator. The historical motivation
numbers in the design are preserved separately. Phase 0 adds qualification tooling,
not a runtime language-ratio improvement. Run the same commands at every phase
boundary and keep both artifacts.

## Recorded verification

[provenance.json](provenance.json) fingerprints the measured JS bundle, runtime
overlay, lockfile, manifest and benchmark/runner sources. Raw five-process samples
are in [benchmarks.json](benchmarks.json). The 10,000-declaration bulk samples
used 6.64–7.28 GiB peak RSS with 441–551 ms/iteration; both modes exceed the
stability bound on this workload, so its performance gate is **failed** regardless
of the favorable ratio. The 1,000-declaration and Modern Normalize samples are
stable and pass the restricted benchmark gates. None establishes rollout readiness.

Local verification of the measured working tree:

| Check                                                             | Result                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Core tests                                                        | 578 passed                                                                                                                           |
| Upstream / Go-backed upstream                                     | 701 / 701 passed, zero skips                                                                                                         |
| Package tests, typechecks and builds                              | Passed                                                                                                                               |
| Go tests and native session/bridge race tests                     | Passed                                                                                                                               |
| JS coverage                                                       | Core 96.76% lines, 89.94% branches, 99.37% functions; webpack/rspack 99.62% lines; Vite 100% lines; existing thresholds passed       |
| Go coverage                                                       | 95.6% statements, required 90%                                                                                                       |
| Qualification metric regressions                                  | 5 passed; 100% lines, branches and functions, enforced in CI                                                                         |
| Corpus baseline                                                   | Passed with the exact recorded map difference; 95% rollout gate blocked                                                              |
| Format, ESLint, Go vet, module-path and generated protocol checks | Passed                                                                                                                               |
| `pnpm bench:boundary`                                             | Passed; prototype diagnostics only, not production rollout evidence                                                                  |
| Upstream snapshot independent check                               | Exact file-set and byte equality for all 86 files using the pinned archive via curl; see [snapshot evidence](upstream-snapshot.json) |
| `pnpm check:all`                                                  | Blocked twice at upstream snapshot download (`fetch failed`); remaining constituent checks ran separately and passed                 |

The failed network checks are retained as failures, not replaced by the older
base-CI success. CI now runs the maintained corpus and metric regression tests,
collects small/representative benchmark samples and line counts, and uploads their
raw artifacts under the exact commit SHA. Results for this uncommitted change set
will only exist remotely after it is submitted; Phase 0 records the green base CI
and local evidence, not a fictional new CI/release run.
