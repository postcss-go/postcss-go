# postcss-go Architecture

这个仓库不是“受 PostCSS 启发的简化实现”，而是按 `eryue0220/postcss` 的核心模块划分去做 Go 移植，并借鉴 `eryue0220/rslint` 的分层方式。

## 目标

- 对齐 `postcss` 的核心数据流：`parse -> AST -> plugin visitors -> stringify`
- 公开 API 保持很薄，核心能力尽量沉到 `internal/`
- 仓库结构参考 `rslint`：按职责分层，而不是把所有逻辑堆在单个 package

## 分层

- `postcss.go`
  - 对外 facade，导出 `Parse`、`New`、`Stringify`、节点类型和遍历函数
- `internal/ast`
  - 节点定义、容器操作、遍历
- `internal/tokenizer`
  - tokenizer，负责把 CSS 文本变成 token stream
- `internal/parser`
  - parser，负责 token stream -> AST
- `internal/processor`
  - visitor 驱动的插件执行管线
- `internal/result`
  - 处理结果与 warning 收集
- `internal/stringifier`
  - AST -> CSS

## 当前状态

第一阶段已经完成：

- 有可工作的 tokenizer / parser / AST / stringifier 闭环
- 有接近 PostCSS visitor 模型的 processor
- 支持 `Once / OnceExit / Root / Rule / AtRule / Declaration / Comment` 及其 `Exit` hook

还没做完的部分：

- `lazy-result` / async plugin 模型
- `input` / `CssSyntaxError` / source map / raws 保真
- 更完整的 node mutation API，例如 clone、replaceWith、raws、source line/column
- 更贴近 upstream 的 tokenizer/parser 边角行为
