package benchmark_test

import (
	"testing"

	"postcss-go/benchmark"
	postcss "postcss-go/internal/postcss"
)

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

func benchmarkParseCSS(b *testing.B, css string) {
	b.SetBytes(int64(len(css)))
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		if _, err := postcss.Parse(css); err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkParseStringifyCSS(b *testing.B, css string) {
	b.SetBytes(int64(len(css)))
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
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
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		if _, err := processor.Process(css); err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkParse(b *testing.B, rules int) {
	benchmarkParseCSS(b, benchmark.GenerateCSS(rules))
}

func benchmarkParseStringify(b *testing.B, rules int) {
	benchmarkParseStringifyCSS(b, benchmark.GenerateCSS(rules))
}

func benchmarkProcess(b *testing.B, rules int) {
	benchmarkProcessCSS(b, benchmark.GenerateCSS(rules))
}

func BenchmarkParse_Small(b *testing.B)  { benchmarkParse(b, benchmark.SmallRules) }
func BenchmarkParse_Medium(b *testing.B) { benchmarkParse(b, benchmark.MediumRules) }
func BenchmarkParse_Large(b *testing.B)  { benchmarkParse(b, benchmark.LargeRules) }

func BenchmarkParseStringify_Small(b *testing.B)  { benchmarkParseStringify(b, benchmark.SmallRules) }
func BenchmarkParseStringify_Medium(b *testing.B) { benchmarkParseStringify(b, benchmark.MediumRules) }
func BenchmarkParseStringify_Large(b *testing.B)  { benchmarkParseStringify(b, benchmark.LargeRules) }

func BenchmarkProcess_Small(b *testing.B)  { benchmarkProcess(b, benchmark.SmallRules) }
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

func mustFixture(b *testing.B, id string) benchmark.RealWorldFixture {
	b.Helper()

	fixture, err := benchmark.RealWorldFixtureByID(id)
	if err != nil {
		b.Fatalf("load fixture %q: %v", id, err)
	}

	return fixture
}
