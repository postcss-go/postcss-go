# postcss-go

`postcss-go` 的目标是把 [eryue0220/postcss](https://github.com/eryue0220/postcss) 的核心架构迁到 Go，并用 [eryue0220/rslint](https://github.com/eryue0220/rslint) 那种清晰的分层组织仓库。

当前阶段已经具备这条主链路：

1. `tokenizer` 把 CSS 变成 token stream
2. `parser` 把 token stream 变成 AST
3. `processor` 用 visitor 风格插件遍历并修改 AST
4. `stringifier` 把 AST 输出回 CSS

## 仓库结构

- `internal/postcss`：Go 侧 facade，聚合 AST / parser / processor / stringifier
- `internal/ast`：节点、容器、遍历
- `internal/tokenizer`：tokenizer
- `internal/parser`：parser
- `internal/processor`：插件 visitor 管线
- `internal/result`：结果和 warning
- `internal/stringifier`：CSS 输出
- `packages/postcss-go`：Node.js / TypeScript 互操作入口
- `packages/postcss-go-wasm`：浏览器 / worker / wasm 入口骨架
- `docs/architecture.md`：架构说明

## Workspace

仓库现在使用 `pnpm` 管理前端包工作区：

```bash
pnpm install
pnpm build
pnpm check
```

当前 `packages/` 先提供包边界和类型入口，Go bridge / wasm runtime 还在后续实现中。

Go 侧已经进一步收敛到 `internal/` 下，不再保留根级公开 facade；仓库当前更偏向“内部 Go 引擎 + JS/TS packages 对外接口”的组织方式。

## 示例

```go
package main

import (
	"fmt"

	postcss "postcss-go"
)

func main() {
	processor := postcss.New(
		postcss.Plugin{
			Name: "rewrite",
			Visitor: postcss.Visitor{
				Declaration: func(decl *postcss.Declaration, result *postcss.Result) error {
					if decl.Prop == "color" && decl.Value == "red" {
						decl.Value = "tomato"
					}
					return nil
				},
			},
		},
	)

	result, err := processor.Process(".btn { color: red; }")
	if err != nil {
		panic(err)
	}

	fmt.Println(result.CSS)
}
```

## Visitor Hooks

目前支持这些 hook：

- `Once`
- `OnceExit`
- `Root` / `RootExit`
- `Rule` / `RuleExit`
- `AtRule` / `AtRuleExit`
- `Declaration` / `DeclarationExit`
- `Comment` / `CommentExit`

## 当前边界

这一版已经比最初的简化实现更接近 upstream 架构，但还没有完全移植：

- 还没有 `lazy-result` 和 async plugin
- 还没有 `raws`、source map、保真格式输出
- JS/TS `packages/` 还只是互操作骨架，尚未真正桥接 Go 二进制或 wasm runtime
- parser / tokenizer 还需要继续向 upstream 行为对齐

## 验证

```bash
go test ./...
pnpm check
```
