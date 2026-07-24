---
layout: ../../layouts/GuideLayout.astro
title: Go API
section: go-api
---

# Go API

The Go facade is the native surface for applications that want direct access
to parsing, AST mutation, traversal, stringifying, and source maps.

## Parse and transform

<div class="mb-12 mt-7 overflow-hidden rounded-[.85rem] border border-white/10 bg-transparent" data-code-sample><div class="flex items-center justify-between gap-4 border-b border-white/[.08] px-[1.1rem] py-[.7rem]"><span class="font-mono text-[.68rem] tracking-[.08em] text-white/50">main.go</span><button class="shrink-0 cursor-pointer rounded-full border border-white/10 bg-transparent px-[.7rem] py-[.35rem] font-mono text-[.68rem] text-white/70 transition-colors duration-150 hover:border-acid hover:text-acid focus-visible:border-acid focus-visible:text-acid focus-visible:outline-none" type="button" data-copy-code>Copy</button></div><pre class="m-0 rounded-none border-0 px-[1.1rem] py-5"><code class="select-text whitespace-pre rounded-none border-0 bg-transparent p-0 text-[.9rem] leading-[inherit] text-inherit">root, err := postcss.Parse(".button { color: red; }")
if err != nil {
    return err
}

postcss.WalkDecls(root, func(decl \*postcss.Declaration) error {
if decl.Prop == "color" {
decl.Value = "tomato"
}
return nil
})

output := postcss.Stringify(root)</code></pre></div>

## Entry points

| API                                              | Purpose                                   |
| ------------------------------------------------ | ----------------------------------------- |
| `postcss.Parse`                                  | Parse CSS into a position-aware Root AST. |
| `postcss.ParseWithOptions`                       | Parse with source and source-map options. |
| `postcss.New(...).Process`                       | Run plugins, then stringify (with maps).  |
| `postcss.NoWork`                                 | No-plugin map/annotation path; no parse.  |
| `postcss.Stringify`                              | Serialize AST nodes into CSS.             |
| `postcss.Walk*`                                  | Walk all nodes or filtered node types.    |
| `postcss.NewRoot`                                | Construct a root and mutate it directly.  |
| `postcss.NewRule`, `NewAtRule`, `NewDeclaration` | Construct common AST nodes.               |

## Source maps

`Process` and `NoWork` accept flat `ProcessOptions` (`Map`, `MapInline`, `PreviousMap`, `MapAnnotation`, …). Prefer setting output mode explicitly when you need an external `.map` payload:

- bare `Map: true` → inline map (PostCSS-compatible default)
- `MapInline: &false` (or annotation flags) → keep `Result.Map` as JSON

Annotation cleanup differs by path: `Process` removes `# sourceMappingURL=` comment nodes from the AST; `NoWork` clears raw `/*#` comments without parsing.

## Best for

- Native Go build tools and CSS pipelines
- Synchronous, low-overhead processing
- Go-native plugins using `Plugin` and `Visitor`
- Direct access to source locations, raw formatting, and source maps

The Go API does not require the Node.js runtime. Use the JavaScript API when
you need PostCSS configuration files or JavaScript plugins.
