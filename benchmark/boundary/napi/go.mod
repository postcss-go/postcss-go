// Isolated from the root module so the spike's cgo code never affects
// `go build ./...`, `go vet ./...`, or CI in the main module.
module postcss-go-spike-napi

go 1.25.0
