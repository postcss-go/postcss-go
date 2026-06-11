# @postcss-go/core

Node.js-facing package for `postcss-go`.

This package is intended to become the primary JS/TS integration point for:

- local Node.js usage
- bundler integrations
- CLI (`@postcss-go/cli`)
- future binary / IPC bridging to the Go engine

At this stage it provides the public TypeScript surface and service abstraction, while the actual Go bridge is still being implemented.
