package benchmark_test

import (
	"sync"
	"testing"

	"postcss-go/benchmark"
	postcss "postcss-go/internal/postcss"
	"postcss-go/internal/stringifier"
)

// The timed loops below use `for b.Loop()` (Go 1.24+) instead of `for i := 0; i
// < b.N; i++`, and the fixtures/synthetic stylesheets they measure are cached at
// package level.
//
// Reason: the CodSpeed walltime runner records one measurement per timed
// section. `b.N` loops reset that buffer on every framework round, so a whole
// benchmark collapsed into a single sample (rounds: 1, stdev: 0) that could not
// be median-filtered or outlier-filtered, and unrelated GC/scheduling jitter
// showed up as double-digit "regressions" in PR reports. `b.Loop()` reports
// every iteration, which gives CodSpeed hundreds of rounds per benchmark.
//
// `b.Loop()` also excludes work done before the loop from the measurement, so no
// b.ResetTimer() call is needed; caching the setup keeps it off the hot path
// entirely (re-reading the embedded fixtures on every round used to add GC
// pressure to the measured section).

func TestRealWorldFixturesParse(t *testing.T) {
	fixtures, err := benchmark.RealWorldFixtures()
	if err != nil {
		t.Fatalf("load fixtures: %v", err)
	}

	for _, fixture := range fixtures {
		t.Run(fixture.ID, func(t *testing.T) {
			root, err := postcss.Parse(fixture.CSS)
			if err != nil {
				t.Fatalf("parse failed (%d bytes): %v", fixture.Bytes, err)
			}
			if root == nil {
				t.Fatal("expected root")
			}
			_ = postcss.Stringify(root)
		})
	}
}

func TestBootstrapDirectEligible(t *testing.T) {
	fixture, err := benchmark.RealWorldFixtureByID("Bootstrap")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	root, err := postcss.Parse(fixture.CSS)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if !stringifier.DirectEligible(root) {
		t.Fatal("expected parser-built Bootstrap tree to use the direct stringifier path")
	}
	css := postcss.Stringify(root)
	if css == "" {
		t.Fatal("expected non-empty css")
	}
}

func benchmarkParseCSS(b *testing.B, css string) {
	b.SetBytes(int64(len(css)))
	b.ReportAllocs()

	for b.Loop() {
		if _, err := postcss.Parse(css); err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkParseStringifyCSS(b *testing.B, css string) {
	b.SetBytes(int64(len(css)))
	b.ReportAllocs()

	for b.Loop() {
		root, err := postcss.Parse(css)
		if err != nil {
			b.Fatal(err)
		}
		_ = postcss.Stringify(root)
	}
}

func benchmarkProcessCSS(b *testing.B, css string) {
	processor := postcss.New()
	b.SetBytes(int64(len(css)))
	b.ReportAllocs()

	for b.Loop() {
		if _, err := processor.Process(css); err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkParse(b *testing.B, rules int) {
	benchmarkParseCSS(b, generatedCSS(rules))
}

func benchmarkParseStringify(b *testing.B, rules int) {
	benchmarkParseStringifyCSS(b, generatedCSS(rules))
}

func benchmarkProcess(b *testing.B, rules int) {
	benchmarkProcessCSS(b, generatedCSS(rules))
}

func BenchmarkParse_Medium(b *testing.B) { benchmarkParse(b, benchmark.MediumRules) }
func BenchmarkParse_Large(b *testing.B)  { benchmarkParse(b, benchmark.LargeRules) }

func BenchmarkParseStringify_Medium(b *testing.B) { benchmarkParseStringify(b, benchmark.MediumRules) }
func BenchmarkParseStringify_Large(b *testing.B)  { benchmarkParseStringify(b, benchmark.LargeRules) }

func BenchmarkProcess_Medium(b *testing.B) { benchmarkProcess(b, benchmark.MediumRules) }
func BenchmarkProcess_Large(b *testing.B)  { benchmarkProcess(b, benchmark.LargeRules) }

func BenchmarkParseReal_ModernNormalize(b *testing.B) {
	fixture := mustFixture(b, "ModernNormalize")
	benchmarkParseCSS(b, fixture.CSS)
}

func BenchmarkParseReal_TailwindPreflight(b *testing.B) {
	fixture := mustFixture(b, "TailwindPreflight")
	benchmarkParseCSS(b, fixture.CSS)
}

func BenchmarkParseReal_AnimateMin(b *testing.B) {
	fixture := mustFixture(b, "AnimateMin")
	benchmarkParseCSS(b, fixture.CSS)
}

func BenchmarkParseReal_Bootstrap(b *testing.B) {
	fixture := mustFixture(b, "Bootstrap")
	benchmarkParseCSS(b, fixture.CSS)
}

func BenchmarkParseReal_BootstrapMin(b *testing.B) {
	fixture := mustFixture(b, "BootstrapMin")
	benchmarkParseCSS(b, fixture.CSS)
}

func BenchmarkParseStringifyReal_ModernNormalize(b *testing.B) {
	fixture := mustFixture(b, "ModernNormalize")
	benchmarkParseStringifyCSS(b, fixture.CSS)
}

func BenchmarkParseStringifyReal_TailwindPreflight(b *testing.B) {
	fixture := mustFixture(b, "TailwindPreflight")
	benchmarkParseStringifyCSS(b, fixture.CSS)
}

func BenchmarkParseStringifyReal_AnimateMin(b *testing.B) {
	fixture := mustFixture(b, "AnimateMin")
	benchmarkParseStringifyCSS(b, fixture.CSS)
}

func BenchmarkParseStringifyReal_Bootstrap(b *testing.B) {
	fixture := mustFixture(b, "Bootstrap")
	benchmarkParseStringifyCSS(b, fixture.CSS)
}

func BenchmarkParseStringifyReal_BootstrapMin(b *testing.B) {
	fixture := mustFixture(b, "BootstrapMin")
	benchmarkParseStringifyCSS(b, fixture.CSS)
}

func BenchmarkProcessReal_ModernNormalize(b *testing.B) {
	fixture := mustFixture(b, "ModernNormalize")
	benchmarkProcessCSS(b, fixture.CSS)
}

func BenchmarkProcessReal_TailwindPreflight(b *testing.B) {
	fixture := mustFixture(b, "TailwindPreflight")
	benchmarkProcessCSS(b, fixture.CSS)
}

func BenchmarkProcessReal_AnimateMin(b *testing.B) {
	fixture := mustFixture(b, "AnimateMin")
	benchmarkProcessCSS(b, fixture.CSS)
}

func BenchmarkProcessReal_Bootstrap(b *testing.B) {
	fixture := mustFixture(b, "Bootstrap")
	benchmarkProcessCSS(b, fixture.CSS)
}

func BenchmarkProcessReal_BootstrapMin(b *testing.B) {
	fixture := mustFixture(b, "BootstrapMin")
	benchmarkProcessCSS(b, fixture.CSS)
}

// fixturesByID decodes the manifest and reads every embedded stylesheet, so it
// is resolved once for the whole benchmark binary instead of once per round.
var fixturesByID = sync.OnceValues(func() (map[string]benchmark.RealWorldFixture, error) {
	fixtures, err := benchmark.RealWorldFixtures()
	if err != nil {
		return nil, err
	}

	byID := make(map[string]benchmark.RealWorldFixture, len(fixtures))
	for _, fixture := range fixtures {
		byID[fixture.ID] = fixture
	}

	return byID, nil
})

func mustFixture(b *testing.B, id string) benchmark.RealWorldFixture {
	b.Helper()

	byID, err := fixturesByID()
	if err != nil {
		b.Fatalf("load fixtures: %v", err)
	}

	fixture, ok := byID[id]
	if !ok {
		b.Fatalf("unknown fixture id %q", id)
	}

	return fixture
}

// generatedCSS memoizes the synthetic stylesheets so generation stays out of
// the timed benchmark bodies.
var (
	generatedCSSMu    sync.Mutex
	generatedCSSCache = map[int]string{}
)

func generatedCSS(rules int) string {
	generatedCSSMu.Lock()
	defer generatedCSSMu.Unlock()

	css, ok := generatedCSSCache[rules]
	if !ok {
		css = benchmark.GenerateCSS(rules)
		generatedCSSCache[rules] = css
	}

	return css
}
