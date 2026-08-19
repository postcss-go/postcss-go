package benchmark_test

import "testing"

// Extended real-world fixtures (Bulma / Pure / UIkit / Materialize) add ~1.4 MB
// of CSS and 12 heavy Parse/ParseStringify/Process benches. They used to be
// compiled out of CodSpeed CI because walltime on shared runners measures the
// whole package in one process and pushed Bootstrap baselines over the default
// ~10% threshold with no Go engine change. CodSpeed now runs on the dedicated
// `codspeed-macro` bare-metal runner (see .github/workflows/codspeed.yml), so
// the full suite is tracked in CI alongside the local `go test -bench=.
// ./benchmark/` run and the JS cross-engine suite.

func BenchmarkParseReal_Bulma(b *testing.B) {
	fixture := mustFixture(b, "Bulma")
	benchmarkParseCSS(b, fixture.CSS)
}

func BenchmarkParseReal_Pure(b *testing.B) {
	fixture := mustFixture(b, "Pure")
	benchmarkParseCSS(b, fixture.CSS)
}

func BenchmarkParseReal_UIkit(b *testing.B) {
	fixture := mustFixture(b, "UIkit")
	benchmarkParseCSS(b, fixture.CSS)
}

func BenchmarkParseReal_Materialize(b *testing.B) {
	fixture := mustFixture(b, "Materialize")
	benchmarkParseCSS(b, fixture.CSS)
}

func BenchmarkParseStringifyReal_Bulma(b *testing.B) {
	fixture := mustFixture(b, "Bulma")
	benchmarkParseStringifyCSS(b, fixture.CSS)
}

func BenchmarkParseStringifyReal_Pure(b *testing.B) {
	fixture := mustFixture(b, "Pure")
	benchmarkParseStringifyCSS(b, fixture.CSS)
}

func BenchmarkParseStringifyReal_UIkit(b *testing.B) {
	fixture := mustFixture(b, "UIkit")
	benchmarkParseStringifyCSS(b, fixture.CSS)
}

func BenchmarkParseStringifyReal_Materialize(b *testing.B) {
	fixture := mustFixture(b, "Materialize")
	benchmarkParseStringifyCSS(b, fixture.CSS)
}

func BenchmarkProcessReal_Bulma(b *testing.B) {
	fixture := mustFixture(b, "Bulma")
	benchmarkProcessCSS(b, fixture.CSS)
}

func BenchmarkProcessReal_Pure(b *testing.B) {
	fixture := mustFixture(b, "Pure")
	benchmarkProcessCSS(b, fixture.CSS)
}

func BenchmarkProcessReal_UIkit(b *testing.B) {
	fixture := mustFixture(b, "UIkit")
	benchmarkProcessCSS(b, fixture.CSS)
}

func BenchmarkProcessReal_Materialize(b *testing.B) {
	fixture := mustFixture(b, "Materialize")
	benchmarkProcessCSS(b, fixture.CSS)
}
