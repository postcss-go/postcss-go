---
layout: ../../layouts/GuideLayout.astro
title: Go API
section: go-api
---

# Go API

The Go facade is the native surface for applications that want direct access
to parsing, AST mutation, traversal, stringifying, and source maps.

## Parse and transform

<div class="code-sample" data-code-sample><div class="code-sample__header"><span class="code-sample__file">main.go</span><button class="code-sample__copy" type="button" data-copy-code>Copy</button></div><pre><code>root, err := postcss.Parse(".button { color: red; }")
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
| `postcss.Stringify`                              | Serialize AST nodes into CSS.             |
| `postcss.Walk*`                                  | Walk all nodes or filtered node types.    |
| `postcss.NewRoot`                                | Construct a root and mutate it directly.  |
| `postcss.NewRule`, `NewAtRule`, `NewDeclaration` | Construct common AST nodes.               |

## Best for

- Native Go build tools and CSS pipelines
- Synchronous, low-overhead processing
- Go-native plugins using `Plugin` and `Visitor`
- Direct access to source locations, raw formatting, and source maps

The Go API does not require the Node.js runtime. Use the JavaScript API when
you need PostCSS configuration files or JavaScript plugins.
