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

## Source maps

PostCSS-shaped `map` options are normalized by `@postcss-go/shared` before they cross the bridge. Go owns previous-map loading, identity maps for empty plugin pipelines (`service.noWork` / CLI with no plugins), annotation cleanup, and inline/external `sourceMappingURL` emission.

Use ordinary PostCSS map options in app code (`map: true`, `map: { inline: false, annotation: '…' }`, `map.prev`, …). You do not need to set the flat bridge flags yourself unless you talk to the Go service with already-normalized options.

## Parse and stringify

<div class="mb-12 mt-7 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent" data-code-sample><div class="flex items-center justify-between gap-4 border-b border-white/[.08] px-[1.1rem] py-[.7rem]"><span class="font-mono text-[.68rem] tracking-[.08em] text-white/50">transform.ts</span><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div><pre class="m-0 rounded-none border-0 px-[1.1rem] py-5"><code class="select-text whitespace-pre rounded-none border-0 bg-transparent p-0 text-[.9rem] leading-[inherit] text-inherit">import { parseAst, stringifyAst } from '@postcss-go/core';

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

<div class="mb-12 mt-7 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent" data-code-sample><div class="flex items-center justify-between gap-4 border-b border-white/[.08] px-[1.1rem] py-[.7rem]"><span class="font-mono text-[.68rem] tracking-[.08em] text-white/50">engine.ts</span><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div><pre class="m-0 rounded-none border-0 px-[1.1rem] py-5"><code class="select-text whitespace-pre rounded-none border-0 bg-transparent p-0 text-[.9rem] leading-[inherit] text-inherit">import { createGoEngine, processWithGoEngine } from '@postcss-go/core';

const engine = createGoEngine();
const result = await processWithGoEngine(engine, {}, '.a { color: red }');
console.log(result.css);
await engine.close();</code></pre></div>

Use `createNodeService` when several operations should share one persistent Go
bridge process. The browser-compatible service is exposed through the package's
`./browser` entry point.

## Compatibility boundary

JavaScript plugins, configuration loading, AST helpers, warnings, and result
objects are implemented by `@postcss-go/core` and do not load the `postcss`
package. Custom parser, syntax, and stringifier options currently produce an
`UnsupportedSyntaxError` instead of falling back to PostCSS. See the
[compatibility progress](../../progress/) page for the remaining API work.
