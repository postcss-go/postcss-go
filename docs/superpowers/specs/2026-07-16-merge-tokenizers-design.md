# Merge Tokenize and Tokenizer Design

## Goal

保留 `internal/tokenizer` 作为仓库唯一的 CSS tokenizer 实现，删除重复的 `internal/tokenize` 包，同时保持 parser 行为和 jsbridge 的现有 RPC JSON 协议。

## Current State

仓库中存在两套独立实现：

- `internal/tokenize` 使用 PostCSS 风格的 `Processor`、`Input` 和 `[]any` token，支持 tokenizer bridge、回退、位置查询、错误忽略和 UTF-16 错误位置。
- `internal/tokenizer` 使用结构化的 `Token{Kind, Start, End}`，由 `internal/parser` 使用，底层依赖 `github.com/tdewolff/parse/v2`。

两套实现各自扫描 CSS，导致行为、错误处理和维护逻辑重复。

## Architecture

保留 `internal/tokenizer`，将 `internal/tokenize` 中有价值且尚未覆盖的行为迁移到 `internal/tokenizer`。统一后的数据流为：

```text
CSS string
    |
    v
internal/tokenizer.Tokenizer
    |
    +--> internal/parser consumes structured Token directly
    |
    +--> internal/jsbridge converts structured Token to legacy []any JSON token
```

统一的内部 token 类型为：

```go
type Token struct {
    Kind  string
    Start int
    End   int
}
```

`Token.Text(input)` 继续从原始 CSS 按范围读取文本，不在 token 中重复存储文本。

`Tokenizer` 提供统一的扫描和状态 API：

```go
type Options struct {
    IgnoreErrors bool
}

type NextOptions struct {
    IgnoreUnclosed bool
}

func New(input string, opts Options) *Tokenizer
func (t *Tokenizer) Next(opts NextOptions) (Token, error)
func (t *Tokenizer) Back(token Token)
func (t *Tokenizer) Position() int
func (t *Tokenizer) EOF() bool
```

具体实现可以替换当前 `tdewolff/parse` lexer，只要保持上述行为和接口。实现应覆盖空白、普通 word、at-word、注释、字符串、括号和控制字符，并保留未闭合字符串、注释、括号的错误分类。

## Compatibility

`internal/parser` 改为继续使用 `internal/tokenizer` 的统一结构化 token，不引入第二个 token 类型。

`internal/jsbridge` 不再导入 `internal/tokenize`。它保留已有 RPC 方法名、请求字段和响应 JSON 结构，在 bridge 层完成结构化 token 与旧 `[]any` token 的转换：

```text
structured Token{Kind, Start, End} + input
    -> []any legacy token
```

这样不会改变现有 JavaScript 客户端看到的 `tokenize.open/next/back/position/eof/close` 协议。

完成迁移后删除：

- `internal/tokenize/tokenize.go`
- `internal/tokenize/tokenize_test.go`
- 仅由旧 tokenizer 使用且不再需要的依赖（若全仓库确认无其他引用）

## Testing

测试分三层：

1. 将旧 tokenizer 测试中仍然适用的行为迁移到 `internal/tokenizer`，并新增选项、错误位置、回退和位置查询测试。
2. 保留 parser 测试，确保 parser 输出和 source range 行为不变。
3. 为 jsbridge 增加 RPC 层测试，验证旧数组 token JSON 形状、回退、位置查询和 EOF 行为不变。

至少覆盖：空输入、空白、普通 word、at-word、控制字符、注释、字符串、URL/括号、转义、UTF-8 内容、未闭合输入和 `IgnoreErrors`/`IgnoreUnclosed`。

验证命令为：

```bash
go test ./...
go vet ./...
```

## Scope Boundaries

本次重构不改变 parser 的 AST 设计、不改变 jsbridge RPC 名称或 JSON 协议、不新增 tokenizer 功能，也不重构与 tokenizer 无关的模块。
