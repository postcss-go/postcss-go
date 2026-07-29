package benchmark_test

import (
	"strings"
	"testing"

	"postcss-go/benchmark"
	postcss "postcss-go/internal/postcss"
	"postcss-go/internal/tokenizer"
)

// Stage-level benchmarks complement the end-to-end scenarios in bench_test.go by
// isolating the individual pipeline stages: tokenizing, AST traversal, plugin
// visiting, and source map generation.

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

	b.SetBytes(int64(len(css)))
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

// benchmarkPluginPipelineCSS measures a realistic single-plugin pipeline: every
// declaration is inspected and a subset is rewritten, which is what most PostCSS
// plugins do.
func benchmarkPluginPipelineCSS(b *testing.B, css string) {
	plugin := postcss.Plugin{
		Name: "bench-prefixer",
		Visitor: postcss.Visitor{
			Declaration: func(decl *postcss.Declaration, _ *postcss.Result) error {
				if strings.HasPrefix(decl.Prop, "display") {
					decl.Value = strings.TrimSpace(decl.Value)
				}
				return nil
			},
		},
	}
	processor := postcss.New(plugin)

	b.SetBytes(int64(len(css)))
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		if _, err := processor.Process(css); err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkProcessSourceMapCSS(b *testing.B, css string) {
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

func BenchmarkTokenize_Small(b *testing.B) {
	benchmarkTokenizeCSS(b, benchmark.GenerateCSS(benchmark.SmallRules))
}

func BenchmarkTokenize_Medium(b *testing.B) {
	benchmarkTokenizeCSS(b, benchmark.GenerateCSS(benchmark.MediumRules))
}

func BenchmarkTokenize_Large(b *testing.B) {
	benchmarkTokenizeCSS(b, benchmark.GenerateCSS(benchmark.LargeRules))
}

func BenchmarkTokenizeReal_Bootstrap(b *testing.B) {
	benchmarkTokenizeCSS(b, mustFixture(b, "Bootstrap").CSS)
}

func BenchmarkTokenizeReal_BootstrapMin(b *testing.B) {
	benchmarkTokenizeCSS(b, mustFixture(b, "BootstrapMin").CSS)
}

func BenchmarkWalk_Medium(b *testing.B) {
	benchmarkWalkCSS(b, benchmark.GenerateCSS(benchmark.MediumRules))
}

func BenchmarkWalkReal_Bootstrap(b *testing.B) {
	benchmarkWalkCSS(b, mustFixture(b, "Bootstrap").CSS)
}

func BenchmarkPluginPipeline_Medium(b *testing.B) {
	benchmarkPluginPipelineCSS(b, benchmark.GenerateCSS(benchmark.MediumRules))
}

func BenchmarkPluginPipelineReal_Bootstrap(b *testing.B) {
	benchmarkPluginPipelineCSS(b, mustFixture(b, "Bootstrap").CSS)
}

func BenchmarkProcessSourceMap_Medium(b *testing.B) {
	benchmarkProcessSourceMapCSS(b, benchmark.GenerateCSS(benchmark.MediumRules))
}

func BenchmarkProcessSourceMapReal_TailwindPreflight(b *testing.B) {
	benchmarkProcessSourceMapCSS(b, mustFixture(b, "TailwindPreflight").CSS)
}

func BenchmarkProcessSourceMapReal_Bootstrap(b *testing.B) {
	benchmarkProcessSourceMapCSS(b, mustFixture(b, "Bootstrap").CSS)
}
