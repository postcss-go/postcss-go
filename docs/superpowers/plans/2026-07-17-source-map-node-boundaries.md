# Source Map Node Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Make Go-generated source maps include node end mappings and declaration value-level mappings so DevTools can locate CSS more precisely while preserving PostCSS-compatible behavior.

**Architecture:** Keep source map v3 encoding and path handling unchanged. Extend `sourceMapWriter` with an end-position mapping operation that reuses a node's source input and accepts an explicit source position, then call it from the existing mapped stringifier at node boundaries and declaration value boundaries.

**Tech Stack:** Go, `github.com/go-sourcemap/sourcemap`, Go test.

## Global Constraints

- Preserve existing source map metadata, path, UTF-16 generated-column, and `<no source>` behavior.
- Use source locations already attached to AST nodes; do not add a new AST node type or parser dependency.
- Write regression tests before production changes and verify the focused test fails for the current implementation.

---

### Task 1: Add source map boundary regression coverage

**Files:**
- Modify: `internal/stringifier/stringifier_test.go`

**Interfaces:**
- Consumes: `parser.Parse`, `StringifyWithSourceMap`, and `github.com/go-sourcemap/sourcemap`.
- Produces: tests that assert generated positions map to declaration start, value start, and node end, including a no-source node.

- [x] **Step 1: Write the failing test**

  Parse a declaration with a source file, stringify it with a source map, parse the map, and assert:

  ```go
  // generated positions must map to source positions:
  // "color" starts at generated column 2 and source column 5,
  // "red" starts at generated column 9 and source column 12,
  // and the semicolon/end boundary maps to source column 15.
  ```

  Also assert a manually constructed declaration without a source maps at both start and end to `<no source>`.

- [x] **Step 2: Run the focused test to verify it fails**

  Run: `go test ./internal/stringifier -run 'TestStringifySourceMap(NodeBoundaries|NoSourceNodeBoundaries)' -count=1`

  Expected: FAIL because the current implementation has only the declaration start mapping and no end/value mappings.

### Task 2: Implement minimal source map boundary support

**Files:**
- Modify: `internal/stringifier/source_map.go`
- Modify: `internal/stringifier/stringifier.go`

**Interfaces:**
- Consumes: existing `source.Location` start/end positions and writer generated cursor state.
- Produces: `AddEndMapping(node ast.Node)` plus explicit source-position mapping used by declaration serialization.

- [x] **Step 1: Add source-position mapping support**

  Refactor the existing mapping code so a node can map either its start or an explicit source position. Preserve `<no source>` fallback and source path/content registration.

- [x] **Step 2: Add `AddEndMapping`**

  Use `location.End` when source exists, otherwise map to `<no source>`. At the generated cursor after writing a node, use `column - 2` for semicolon-terminated childless nodes and `column - 1` for other nodes, matching PostCSS's end mapping placement.

- [x] **Step 3: Add mapped declaration value boundary and node end calls**

  Keep declaration start mapping, map the value start using the declaration source start plus the original property/value offset, then add the end mapping after the semicolon or `!important` text. Add end mappings after Rule, AtRule, and Comment output as applicable.

- [x] **Step 4: Run focused tests**

  Run: `go test ./internal/stringifier -count=1`

  Expected: PASS.

### Task 3: Verify compatibility and formatting

**Files:**
- No additional files.

- [x] **Step 1: Run all Go tests**

  Run: `go test ./...`

  Expected: PASS with zero failures.

- [x] **Step 2: Run Go vet and formatting checks**

  Run: `go vet ./...` and `test -z "$(gofmt -l internal/stringifier/stringifier.go internal/stringifier/source_map.go internal/stringifier/stringifier_test.go)"`

  Expected: both commands exit successfully with no formatting output.

- [x] **Step 3: Review the diff**

  Run: `git diff -- internal/stringifier/stringifier.go internal/stringifier/source_map.go internal/stringifier/stringifier_test.go`

  Expected: only source map boundary behavior and its tests are changed; unrelated existing worktree modifications remain untouched.
