//go:build !codspeed

package benchmark_test

import (
	"testing"

	"postcss-go/benchmark"
)

// Small synthetic fixtures finish in tens of microseconds. CodSpeed walltime on
// shared GitHub runners routinely false-trips the default ~10% threshold on
// these with no Go engine change, so they are compiled out of CodSpeed CI via
// the `codspeed` build tag (see .github/workflows/codspeed.yml). Local runs
// without that tag still include them: go test -bench=. ./benchmark/

func BenchmarkParse_Small(b *testing.B) { benchmarkParse(b, benchmark.SmallRules) }

func BenchmarkParseStringify_Small(b *testing.B) {
	benchmarkParseStringify(b, benchmark.SmallRules)
}

func BenchmarkProcess_Small(b *testing.B) { benchmarkProcess(b, benchmark.SmallRules) }

func BenchmarkTokenize_small(b *testing.B) {
	benchmarkTokenizeCSS(b, benchmark.GenerateCSS(benchmark.SmallRules))
}
