# WASM Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Make the browser service execute the existing Go parse, process, and stringify operations through a Web Worker and Go WASM runtime.

**Architecture:** Add a small `syscall/js` Go entrypoint that exposes one global request function returning JSON. Add a TypeScript worker client that loads `wasm_exec.js`, boots the WASM binary, and forwards request IDs. `BrowserPostcssGoService` will use an injected Worker-compatible factory or the browser Worker constructor while preserving the existing service contract.

**Tech Stack:** Go 1.25, `syscall/js`, TypeScript, Web Worker messaging, Vitest.

## Global Constraints

- Keep the existing `PostcssGoService` methods and DTO shapes unchanged.
- Do not add plugin execution, custom syntax, or full PostCSS object-model work in this line.
- Browser runtime errors must reject the matching request and close must reject pending requests.
- Node tests must not require a real browser or network access.

### Task 1: Define the worker protocol with failing tests

**Files:**

- Modify: `packages/postcss-go/src/browser.ts`
- Test: `packages/postcss-go-wasm/test/index.test.ts`

- [x] Write tests for request dispatch, response matching, RPC errors, and close behavior using a fake Worker.
- [x] Run the WASM package tests and confirm the new tests fail because the service is still unsupported.

### Task 2: Implement the browser service client

**Files:**

- Modify: `packages/postcss-go/src/browser.ts`
- Modify: `packages/postcss-go/src/service.ts` only if the worker-facing type needs a public contract
- Test: `packages/postcss-go-wasm/test/index.test.ts`

- [x] Implement the minimal Worker-compatible transport and service methods.
- [x] Run focused tests and confirm all browser service tests pass.
- [x] Add pending-request cleanup and idempotent close behavior.

### Task 3: Add the Go WASM entrypoint

**Files:**

- Create: `cmd/wasm/main.go`
- Test: `cmd/wasm/main_test.go`

- [x] Expose JSON request handling for `parse`, `process`, and `stringify` through `syscall/js`.
- [x] Reuse `internal/jsbridge` RPC handlers rather than duplicating parser or stringifier logic.
- [x] Run native Go tests and a compile-only `GOOS=js GOARCH=wasm go build` check.

### Task 4: Add build and package documentation

**Files:**

- Create: `packages/postcss-go-wasm/scripts/build-wasm.mjs`
- Modify: `packages/postcss-go-wasm/package.json`
- Modify: `packages/postcss-go-wasm/README.md`
- Modify: `packages/postcss-go-wasm/src/index.ts`

- [x] Add a reproducible WASM build command and package exports for the worker helper.
- [x] Document required `wasmUrl`, `wasmExecUrl`, and worker usage.
- [x] Run package build, focused tests, and the repository Go checks.
