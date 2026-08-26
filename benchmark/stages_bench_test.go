package benchmark_test

import (
	"strings"
	"sync"
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

// The stage helpers follow the same measurement rules as the end-to-end ones
// (see the comment in bench_test.go): `for b.Loop()` so CodSpeed records every
// iteration, and setup (parsed trees, plugin processors) cached per case id and
// kept outside the timed loop.
func benchmarkTokenizeCSS(b *testing.B, css string) {
	b.SetBytes(int64(len(css)))
	b.ReportAllocs()

	for b.Loop() {
		tok := tokenizer.New(css, tokenizer.Options{File: "input.css"})
		for !tok.EOF() {
			if _, err := tok.Next(tokenizer.NextOptions{}); err != nil {
				b.Fatal(err)
			}
		}
	}
}

// walkTrees caches the parsed AST per case id: Walk is read-only, so the same
// tree can be reused by every round.
var (
	stageSetupMu sync.Mutex
	walkTrees    = map[string]*postcss.Root{}
	pluginProcs  = map[string]*postcss.Processor{}
)

func walkTree(b *testing.B, id, css string) *postcss.Root {
	b.Helper()

	stageSetupMu.Lock()
	defer stageSetupMu.Unlock()

	root, ok := walkTrees[id]
	if !ok {
		parsed, err := postcss.Parse(css)
		if err != nil {
			b.Fatal(err)
		}
		root = parsed
		walkTrees[id] = root
	}

	return root
}

func benchmarkWalkCSS(b *testing.B, id, css string) {
	root := walkTree(b, id, css)

	// No SetBytes: this loop walks a pre-parsed AST and does not re-process the
	// CSS byte stream, so reporting MB/s from len(css) would be misleading.
	b.ReportAllocs()

	for b.Loop() {
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

// pluginProcessor builds the plugin processor for a case id and verifies the
// rewrite once, outside of any timed benchmark body.
func pluginProcessor(b *testing.B, id, css string) *postcss.Processor {
	b.Helper()

	const rewritePrefix = "-bench-"

	stageSetupMu.Lock()
	defer stageSetupMu.Unlock()

	processor, ok := pluginProcs[id]
	if !ok {
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
		processor = postcss.New(plugin)

		warm, err := processor.Process(css)
		if err != nil {
			b.Fatal(err)
		}
		if !strings.Contains(warm.CSS, rewritePrefix) {
			b.Fatal("expected plugin rewrite")
		}

		pluginProcs[id] = processor
	}

	return processor
}

// benchmarkPluginCSS measures Process with one declaration visitor that rewrites
// display values — visitor dispatch plus a changed stringify path.
func benchmarkPluginCSS(b *testing.B, id, css string) {
	processor := pluginProcessor(b, id, css)

	b.SetBytes(int64(len(css)))
	b.ReportAllocs()

	for b.Loop() {
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

	for b.Loop() {
		res, err := processor.Process(css, opts)
		if err != nil {
			b.Fatal(err)
		}
		if res.Map == "" {
			b.Fatal("expected source map")
		}
	}
}

func BenchmarkTokenize_medium(b *testing.B) {
	benchmarkTokenizeCSS(b, generatedCSS(benchmark.MediumRules))
}

func BenchmarkTokenize_large(b *testing.B) {
	benchmarkTokenizeCSS(b, generatedCSS(benchmark.LargeRules))
}

func BenchmarkTokenize_bootstrap_css(b *testing.B) {
	benchmarkTokenizeCSS(b, mustFixture(b, "Bootstrap").CSS)
}

func BenchmarkTokenize_bootstrap_min_css(b *testing.B) {
	benchmarkTokenizeCSS(b, mustFixture(b, "BootstrapMin").CSS)
}

func BenchmarkWalk_medium(b *testing.B) {
	benchmarkWalkCSS(b, "medium", generatedCSS(benchmark.MediumRules))
}

func BenchmarkWalk_bootstrap_css(b *testing.B) {
	benchmarkWalkCSS(b, "bootstrap_css", mustFixture(b, "Bootstrap").CSS)
}

func BenchmarkPlugin_medium(b *testing.B) {
	benchmarkPluginCSS(b, "medium", generatedCSS(benchmark.MediumRules))
}

func BenchmarkPlugin_bootstrap_css(b *testing.B) {
	benchmarkPluginCSS(b, "bootstrap_css", mustFixture(b, "Bootstrap").CSS)
}

func BenchmarkSourcemap_medium(b *testing.B) {
	benchmarkSourcemapCSS(b, generatedCSS(benchmark.MediumRules))
}

func BenchmarkSourcemap_tailwind_preflight_css(b *testing.B) {
	benchmarkSourcemapCSS(b, mustFixture(b, "TailwindPreflight").CSS)
}

func BenchmarkSourcemap_bootstrap_css(b *testing.B) {
	benchmarkSourcemapCSS(b, mustFixture(b, "Bootstrap").CSS)
}
