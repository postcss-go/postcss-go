# PostCSS raws Parity Design

## Goal

Improve Go parser and stringifier compatibility for PostCSS `raws` formatting,
covering block spacing, at-rule parameters, inferred formatting for new nodes,
and bridge-facing raw field types.

## Design

The parser will preserve the token slices that contain formatting around a
node instead of reconstructing them after trimming semantic values. At-rule
name spacing, parameter comments, and pre-semicolon spacing will be represented
as separate raw fields so stringification never emits the same token twice.

The stringifier will centralize fallback formatting inference. Explicit node
raws always win; otherwise it will infer whitespace from compatible nodes and
derive indentation from the root or existing nested formatting. Existing
two-space defaults remain unchanged for this project, while explicit PostCSS
raws continue to support arbitrary indentation.

The TypeScript raws model will permit arbitrary JSON-compatible values where
PostCSS exposes an open-ended raws object, including `null` values. Existing
typed common fields remain available for normal callers.

## Verification

Add Go regression tests for every identified failing case, run them red before
implementation, then run `go test ./...`, TypeScript checks, and the upstream
compatibility suite after implementation.
