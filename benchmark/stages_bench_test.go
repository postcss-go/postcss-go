package benchmark_test

import (
	"strings"
	"testing"

	"postcss-go/benchmark"
	postcss "postcss-go/internal/postcss"
	"postcss-go/internal/tokenizer"
)

// Stage-level benchmarks complement the end-to-end scenarios in bench_test.go.
// Tokenize and Walk isolate a single stage; PluginPipeline and ProcessSourceMap
// are full Process runs that attribute cost to a declaration visitor and to
// source map generation respectively.

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

// benchmarkPluginPipelineCSS measures Process with one declaration visitor that
// rewrites display values, which exercises visitor dispatch plus a changed
// stringify path — the common PostCSS plugin shape.
func benchmarkPluginPipelineCSS(b *testing.B, css string) {
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

	b.SetBytes(int64(len(css)))
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		res, err := processor.Process(css)
		if err != nil {
			b.Fatal(err)
		}
		if !strings.Contains(res.CSS, rewritePrefix) {
			b.Fatal("expected plugin rewrite")
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
