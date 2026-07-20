# CLI `parseArgs` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove `yargs` from the postcss-go CLI and preserve its documented argument behavior, including `--help`.

**Architecture:** Keep the existing `parseCliArgs(argvInput)` boundary. Replace the internal parser with Node's `parseArgs`, a local usage/help string, and explicit post-parse validation for yargs semantics that are not supplied by `parseArgs`.

**Tech Stack:** TypeScript, Node.js `node:util.parseArgs`, Vitest, pnpm.

## Global Constraints

- Node runtime remains `>=18`.
- `yargs` must not remain in source, package manifests, or the lockfile.
- The returned `CliArgv` shape and existing CLI option semantics must remain compatible.
- `--help` and `-h` must print usage and exit successfully.

---

### Task 1: Lock down parser behavior with tests

**Files:**

- Modify: `packages/postcss-go/test/args.test.ts`
- Test: `packages/postcss-go/test/args.test.ts`

- [ ] Add tests for aliases and repeated `-u` values, `--no-map`, help output/exit behavior, and conflicts/implications.
- [ ] Run the focused args tests and confirm the new expectations fail against the current yargs implementation where behavior differs.

### Task 2: Replace yargs with `node:util.parseArgs`

**Files:**

- Modify: `packages/postcss-go/src/args.ts`

- [ ] Declare every supported option in `parseArgs`, preserving aliases and array collection.
- [ ] Add local help output and explicit validation for conflicts and required relationships.
- [ ] Keep `--ext` normalization and the `CliArgv` output shape.
- [ ] Run focused args tests and TypeScript checking.

### Task 3: Remove the dependency

**Files:**

- Modify: `packages/postcss-go/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] Remove the `yargs` dependency from the package manifest.
- [ ] Regenerate the lockfile without `yargs` and its now-unused transitive packages.
- [ ] Search the repository to verify no CLI/runtime reference to `yargs` remains.

### Task 4: Verify the package

**Files:**

- None.

- [ ] Run the package check/build and CLI tests.
- [ ] Run formatting validation for changed files.
- [ ] Inspect the final diff and report any unrelated pre-existing worktree changes separately.
