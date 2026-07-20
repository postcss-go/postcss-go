# WASM entrypoint tests design

## Goal

补充 `cmd/wasm/main.go` 的测试覆盖，验证 WASM 请求响应 JSON 的正常序列化和序列化失败时的兜底响应，同时确保 WASM 包可以通过目标平台编译。

## Scope and approach

新增 `cmd/wasm/main_test.go`，使用与 `main.go` 相同的 `js && wasm` 构建约束，直接测试纯 Go 的 `responseJSON` 函数。测试不尝试在宿主机执行 `syscall/js` 的事件循环或 JavaScript 回调；通过 `GOOS=js GOARCH=wasm go test -c ./cmd/wasm` 验证包含 WASM 入口的包能够编译。

覆盖两个行为：

1. 有效 `jsbridge.Response` 被编码为包含预期字段的 JSON。
2. 当响应包含 `encoding/json` 无法编码的值时，函数返回可解析的错误响应，并保留序列化错误信息。

不修改生产逻辑，不新增依赖，不触碰工作区已有的其他未提交改动。

## Success criteria

- `main_test.go` 在 `js/wasm` 构建约束下包含上述两个测试。
- WASM 目标下测试包编译成功。
- 在可执行的 Go 测试环境中，测试断言覆盖成功和 fallback 两条路径。
