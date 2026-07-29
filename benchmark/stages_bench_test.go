package benchmark_test

import (
	"strings"
	"testing"

	"postcss-go/benchmark"
	postcss "postcss-go/internal/postcss"
	"postcss-go/internal/tokenizer"
)

// Stage-level benchmarks complement the end-to-end scenarios in bench_test.go.
//
// Go requires the function name to start with "Benchmark", so the oxc-style
// label lives in b.Run: reports read as Benchmark/tokenize[bootstrap.css]
// (CodSpeed UI / go test), matching oxc's tokenize[fixture] shape as closely
// as the testing package allows.

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

// Benchmark registers stage microbenchmarks. The public names are the b.Run
// labels (tokenize[…], walk[…], …); the "Benchmark/" prefix is required by Go.
func Benchmark(b *testing.B) {
	type stageCase struct {
		name string
		css  string
		run  func(*testing.B, string)
	}

	cases := []stageCase{
		{"tokenize[small]", benchmark.GenerateCSS(benchmark.SmallRules), benchmarkTokenizeCSS},
		{"tokenize[medium]", benchmark.GenerateCSS(benchmark.MediumRules), benchmarkTokenizeCSS},
		{"tokenize[large]", benchmark.GenerateCSS(benchmark.LargeRules), benchmarkTokenizeCSS},
		{"tokenize[bootstrap.css]", mustFixture(b, "Bootstrap").CSS, benchmarkTokenizeCSS},
		{"tokenize[bootstrap.min.css]", mustFixture(b, "BootstrapMin").CSS, benchmarkTokenizeCSS},

		{"walk[medium]", benchmark.GenerateCSS(benchmark.MediumRules), benchmarkWalkCSS},
		{"walk[bootstrap.css]", mustFixture(b, "Bootstrap").CSS, benchmarkWalkCSS},

		{"plugin[medium]", benchmark.GenerateCSS(benchmark.MediumRules), benchmarkPluginPipelineCSS},
		{"plugin[bootstrap.css]", mustFixture(b, "Bootstrap").CSS, benchmarkPluginPipelineCSS},

		{"sourcemap[medium]", benchmark.GenerateCSS(benchmark.MediumRules), benchmarkProcessSourceMapCSS},
		{"sourcemap[tailwind-preflight.css]", mustFixture(b, "TailwindPreflight").CSS, benchmarkProcessSourceMapCSS},
		{"sourcemap[bootstrap.css]", mustFixture(b, "Bootstrap").CSS, benchmarkProcessSourceMapCSS},
	}

	for _, tc := range cases {
		b.Run(tc.name, func(b *testing.B) {
			tc.run(b, tc.css)
		})
	}
}
