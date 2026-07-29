package benchmark_test

import (
	"strings"
	"testing"

	"postcss-go/benchmark"
	postcss "postcss-go/internal/postcss"
	"postcss-go/internal/tokenizer"
)

// Stage-level benchmarks complement the end-to-end scenarios in bench_test.go by
// isolating tokenize / walk / plugin / sourcemap.
//
// Naming follows the oxc CodSpeed stage[fixture] shape as closely as Go allows:
// each case is a discrete top-level Benchmark* (not b.Run under one parent), so
// CodSpeed ids stay stable and stages do not all run before Parse/Process.
// Conceptual label tokenize[bootstrap.css] → BenchmarkTokenize_bootstrap_css.

func benchmarkTokenizeCSS(b *testing.B, css string) {
	b.SetBytes(int64(len(css)))
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		tok := tokenizer.New(css, tokenizer.Options{File: "input.css"})
		for !tok.EOF() {
			if _, err := tok.Next(tokenizer.NextOptions{}); err != nil {
				b.Fatal(err)
			}
		}
	}
}

func benchmarkWalkCSS(b *testing.B, css string) {
	root, err := postcss.Parse(css)
	if err != nil {
		b.Fatal(err)
	}

	// No SetBytes: this loop walks a pre-parsed AST and does not re-process the
	// CSS byte stream, so reporting MB/s from len(css) would be misleading.
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		nodes := 0
		if err := postcss.Walk(root, func(postcss.Node) error {
			nodes++
			return nil
		}); err != nil {
			b.Fatal(err)
		}
		if nodes == 0 {
			b.Fatal("expected visited nodes")
		}
	}
}

// benchmarkPluginCSS measures Process with one declaration visitor that rewrites
// display values — visitor dispatch plus a changed stringify path.
func benchmarkPluginCSS(b *testing.B, css string) {
	const rewritePrefix = "-bench-"
	plugin := postcss.Plugin{
		Name: "bench-display-prefixer",
		Visitor: postcss.Visitor{
			DeclarationProp: map[string]func(*postcss.Declaration, *postcss.Result) error{
				"display": func(decl *postcss.Declaration, _ *postcss.Result) error {
					decl.Value = rewritePrefix + decl.Value
					return nil
				},
			},
		},
	}
	processor := postcss.New(plugin)

	// Verify once outside the timed loop so the full-CSS scan is not measured.
	warm, err := processor.Process(css)
	if err != nil {
		b.Fatal(err)
	}
	if !strings.Contains(warm.CSS, rewritePrefix) {
		b.Fatal("expected plugin rewrite")
	}

	b.SetBytes(int64(len(css)))
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		if _, err := processor.Process(css); err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkSourcemapCSS(b *testing.B, css string) {
	processor := postcss.New()
	// MapInline is set explicitly so the generated map is returned separately
	// instead of being base64-embedded in the output CSS.
	inline := false
	opts := postcss.ProcessOptions{From: "input.css", To: "output.css", Map: true, MapInline: &inline}

	b.SetBytes(int64(len(css)))
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		res, err := processor.Process(css, opts)
		if err != nil {
			b.Fatal(err)
		}
		if res.Map == "" {
			b.Fatal("expected source map")
		}
	}
}

func BenchmarkTokenize_small(b *testing.B) {
	benchmarkTokenizeCSS(b, benchmark.GenerateCSS(benchmark.SmallRules))
}

func BenchmarkTokenize_medium(b *testing.B) {
	benchmarkTokenizeCSS(b, benchmark.GenerateCSS(benchmark.MediumRules))
}

func BenchmarkTokenize_large(b *testing.B) {
	benchmarkTokenizeCSS(b, benchmark.GenerateCSS(benchmark.LargeRules))
}

func BenchmarkTokenize_bootstrap_css(b *testing.B) {
	benchmarkTokenizeCSS(b, mustFixture(b, "Bootstrap").CSS)
}

func BenchmarkTokenize_bootstrap_min_css(b *testing.B) {
	benchmarkTokenizeCSS(b, mustFixture(b, "BootstrapMin").CSS)
}

func BenchmarkWalk_medium(b *testing.B) {
	benchmarkWalkCSS(b, benchmark.GenerateCSS(benchmark.MediumRules))
}

func BenchmarkWalk_bootstrap_css(b *testing.B) {
	benchmarkWalkCSS(b, mustFixture(b, "Bootstrap").CSS)
}

func BenchmarkPlugin_medium(b *testing.B) {
	benchmarkPluginCSS(b, benchmark.GenerateCSS(benchmark.MediumRules))
}

func BenchmarkPlugin_bootstrap_css(b *testing.B) {
	benchmarkPluginCSS(b, mustFixture(b, "Bootstrap").CSS)
}

func BenchmarkSourcemap_medium(b *testing.B) {
	benchmarkSourcemapCSS(b, benchmark.GenerateCSS(benchmark.MediumRules))
}

func BenchmarkSourcemap_tailwind_preflight_css(b *testing.B) {
	benchmarkSourcemapCSS(b, mustFixture(b, "TailwindPreflight").CSS)
}

func BenchmarkSourcemap_bootstrap_css(b *testing.B) {
	benchmarkSourcemapCSS(b, mustFixture(b, "Bootstrap").CSS)
}
