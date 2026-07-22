---
layout: ../../layouts/GuideLayout.astro
title: JavaScript API
section: javascript-api
---

# JavaScript API

`@postcss-go/core` is the Node.js and TypeScript integration surface. It
manages the Go bridge and converts data into PostCSS-shaped AST classes.

## API at a glance

| Surface   | Entry point                             | Best for                                                      |
| --------- | --------------------------------------- | ------------------------------------------------------------- |
| Parse     | `parse`, `parseAst`                     | Read CSS into a bridge result or AST root.                    |
| Process   | `process`                               | Run configured processing and return CSS, maps, and messages. |
| Transform | PostCSS-shaped node methods             | Walk and mutate declarations, rules, and other nodes.         |
| Output    | `stringifyAst`                          | Serialize an AST root back to CSS.                            |
| Engine    | `createGoEngine`, `processWithGoEngine` | Reuse the native Go engine in application code.               |
| Service   | `createNodeService`                     | Share one persistent bridge across requests.                  |

## Parse and stringify

<div class="code-sample" data-code-sample><div class="code-sample__header"><span class="code-sample__file">transform.ts</span><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div><pre><code>import { parseAst, stringifyAst } from '@postcss-go/core';

const root = await parseAst('.button { color: red; }');
root.walkDecls((decl) =&gt; {
if (decl.prop === 'color') decl.value = 'tomato';
});

console.log(await stringifyAst(root));</code></pre></div>

| Function                      | Purpose                                          |
| ----------------------------- | ------------------------------------------------ |
| `parse(css, options)`         | Parse CSS and return the bridge result.          |
| `parseAst(css, options)`      | Parse CSS into a PostCSS-shaped AST root.        |
| `process(css, options)`       | Process CSS through the configured engine.       |
| `stringifyAst(root, options)` | Serialize an AST root to CSS.                    |
| `toResult(response)`          | Convert a service response into a result object. |

## Engine and service

<div class="code-sample" data-code-sample><div class="code-sample__header"><span class="code-sample__file">engine.ts</span><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div><pre><code>import { createGoEngine, processWithGoEngine } from '@postcss-go/core';

const engine = createGoEngine();
const result = await processWithGoEngine(engine, {}, '.a { color: red }');
console.log(result.css);
await engine.close();</code></pre></div>

Use `createNodeService` when several operations should share one persistent Go
bridge process. The browser-compatible service is exposed through the package's
`./browser` entry point.

## Compatibility boundary

JavaScript plugins, configuration loading, warnings, and PostCSS result
semantics still use the compatibility layer. See the
[compatibility progress](../../progress/) page for the remaining work toward a
complete PostCSS JavaScript replacement.
