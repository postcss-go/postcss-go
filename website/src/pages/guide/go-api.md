---
layout: ../../layouts/GuideLayout.astro
title: Go API
section: go-api
---

# Go API

The Go facade is the native surface for applications that want direct access
to parsing, AST mutation, traversal, stringifying, and source maps.

## Parse and transform

```go
import postcss "postcss-go"

root, err := postcss.Parse(".button { color: red; }")
if err != nil {
  return err
}

postcss.WalkDecls(root, func(decl *postcss.Declaration) error {
  if decl.Prop == "color" {
    decl.Value = "tomato"
  }
  return nil
})

output := postcss.Stringify(root)
```

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

The module root exports this facade as package `postcss`; it is backed by the
same internal parser, AST, processor, stringifier, and source-map packages used
by the native Node and WASM bridges.
