// Isolated from the root module so the spike's cgo code never affects
// `go build ./...`, `go vet ./...`, or CI in the main module.
module postcss-go-spike-napi

go 1.25.0

require postcss-go v0.0.0

require github.com/go-sourcemap/sourcemap v2.1.4+incompatible // indirect

replace postcss-go => ../../..
