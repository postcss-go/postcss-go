// Package boundary measures the cost of moving a CSS AST across the
// JavaScript/Go boundary, to decide where serialization belongs.
//
// The Go half lives here; the JavaScript half is in the sibling .mjs scripts,
// which also build a NAPI addon and a wasip1 reactor module to price a single
// synchronous crossing. Run everything with:
//
//	node benchmark/run-boundary.mjs
//
// Pass --js-only or --go-only to run just one half of the suite.
//
// The Go benchmarks are opt-in so they stay out of `go test ./...`:
//
//	go test ./benchmark/boundary/ -bench . -benchmem -benchtime=100ms
//
// BenchmarkParseScaling is also the entry point for profiling the parser:
//
//	go test ./benchmark/boundary/ -run XXX \
//	  -bench 'BenchmarkParseScaling/single-line/4000' -cpuprofile /tmp/parse.prof
//	go tool pprof -top -nodecount=15 /tmp/parse.prof
package boundary
