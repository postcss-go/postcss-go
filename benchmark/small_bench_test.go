package benchmark_test

import (
	"testing"

	"github.com/postcss-go/postcss-go/benchmark"
)

// Small synthetic fixtures finish in tens of microseconds. They used to be
// compiled out of CodSpeed CI because walltime on shared GitHub runners
// false-tripped the default ~10% threshold with no Go engine change; CodSpeed
// now runs on the dedicated `codspeed-macro` bare-metal runner (see
// .github/workflows/codspeed.yml), so they are measured in CI as well.

func BenchmarkParse_Small(b *testing.B) { benchmarkParse(b, benchmark.SmallRules) }

func BenchmarkParseStringify_Small(b *testing.B) {
	benchmarkParseStringify(b, benchmark.SmallRules)
}

func BenchmarkProcess_Small(b *testing.B) { benchmarkProcess(b, benchmark.SmallRules) }

func BenchmarkTokenize_small(b *testing.B) {
	benchmarkTokenizeCSS(b, generatedCSS(benchmark.SmallRules))
}
