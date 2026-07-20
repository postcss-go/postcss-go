# PostCSS raws Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Go `raws` round-trip and inferred-formatting gaps identified in the PostCSS compatibility review.

**Architecture:** Preserve formatting token slices in the parser, centralize fallback raw inference in the stringifier, and widen the bridge TypeScript raws value model without changing the AST node shape.

**Tech Stack:** Go, Go testing, TypeScript declaration checking, vendored PostCSS compatibility tests.

## Global Constraints

- Explicit node raws take precedence over inferred formatting.
- Semantic node values must remain clean while raw values preserve original formatting.
- Existing project defaults and public node types remain compatible.
- Every behavior change must have a regression test.

---

### Task 1: Add failing parser/stringifier regression tests

**Files:**

- Modify: `internal/stringifier/stringifier_test.go`

- [ ] Add tests covering double spaces before `{`, at-rule comments, at-rule trailing spaces before `;`, and nested inferred indentation.
- [ ] Run the focused tests and confirm the current implementation fails with the known output differences.

### Task 2: Preserve parser raw slices

**Files:**

- Modify: `internal/parser/parser.go`

- [ ] Capture the original header/body slices before semantic trimming.
- [ ] Set `raws.between` from the original tokens before the opening brace.
- [ ] Split at-rule `afterName`, `params`, and trailing `between` without duplication.
- [ ] Preserve declaration and at-rule semicolon-adjacent whitespace.
- [ ] Run parser/stringifier regression tests.

### Task 3: Improve stringifier raw inference

**Files:**

- Modify: `internal/stringifier/stringifier.go`

- [ ] Replace sibling-only `nodeBefore` fallback with node-kind-aware whitespace inference.
- [ ] Derive indentation from explicit root indent or existing before raws while preserving explicit raws.
- [ ] Keep mapped and unmapped stringification behavior aligned.
- [ ] Run all Go tests.

### Task 4: Widen bridge raws types and verify public checks

**Files:**

- Modify: `packages/postcss-go/src/types.ts`
- Test: existing package checks

- [ ] Allow arbitrary JSON-compatible raw fields and null values while retaining common typed fields.
- [ ] Run TypeScript checks and package tests.

### Task 5: Final verification

- [ ] Run `gofmt` on modified Go files.
- [ ] Run `go test ./...`.
- [ ] Run workspace TypeScript checks.
- [ ] Run the upstream compatibility suite.
- [ ] Review the diff for unrelated changes.
