package benchmark_test

import (
	"strings"
	"sync"
	"testing"

	"github.com/postcss-go/postcss-go/benchmark"
	postcss "github.com/postcss-go/postcss-go/internal/postcss"
	"github.com/postcss-go/postcss-go/internal/stringifier"
	"github.com/postcss-go/postcss-go/internal/tokenizer"
)

// Timed loops use `for b.Loop()` (Go 1.24+) instead of `for i := 0; i < b.N`.
// CodSpeed walltime records one measurement per timed section; `b.N` loops
// reset that buffer every framework round, so a whole benchmark collapsed into
// a single sample that could not be median-filtered. `b.Loop()` reports every
// iteration. Work before the loop is excluded, so setup is cached at package
// level instead of sitting on the hot path.
//
// Small synthetics and the heavier real-world fixtures (Bulma / Pure / UIkit /
// Materialize) used to live in separate files behind a `codspeed` build tag
// because shared GitHub runners false-tripped the ~10% threshold. CodSpeed now
// runs on `codspeed-macro`, so the full suite is one file. Stage cases stay
// discrete top-level Benchmark* functions (not b.Run) so CodSpeed ids remain
// stable: tokenize[bootstrap.css] → BenchmarkTokenize_bootstrap_css.

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

func benchmarkParse(b *testing.B, rules int) { benchmarkParseCSS(b, generatedCSS(rules)) }
func benchmarkParseStringify(b *testing.B, rules int) {
	benchmarkParseStringifyCSS(b, generatedCSS(rules))
}
func benchmarkProcess(b *testing.B, rules int) { benchmarkProcessCSS(b, generatedCSS(rules)) }

func BenchmarkParse_Small(b *testing.B)  { benchmarkParse(b, benchmark.SmallRules) }
func BenchmarkParse_Medium(b *testing.B) { benchmarkParse(b, benchmark.MediumRules) }
func BenchmarkParse_Large(b *testing.B)  { benchmarkParse(b, benchmark.LargeRules) }

func BenchmarkParseStringify_Small(b *testing.B) {
	benchmarkParseStringify(b, benchmark.SmallRules)
}
func BenchmarkParseStringify_Medium(b *testing.B) {
	benchmarkParseStringify(b, benchmark.MediumRules)
}
func BenchmarkParseStringify_Large(b *testing.B) {
	benchmarkParseStringify(b, benchmark.LargeRules)
}

func BenchmarkProcess_Small(b *testing.B)  { benchmarkProcess(b, benchmark.SmallRules) }
func BenchmarkProcess_Medium(b *testing.B) { benchmarkProcess(b, benchmark.MediumRules) }
func BenchmarkProcess_Large(b *testing.B)  { benchmarkProcess(b, benchmark.LargeRules) }

func BenchmarkParseReal_ModernNormalize(b *testing.B) {
	benchmarkParseCSS(b, mustFixture(b, "ModernNormalize").CSS)
}
func BenchmarkParseReal_TailwindPreflight(b *testing.B) {
	benchmarkParseCSS(b, mustFixture(b, "TailwindPreflight").CSS)
}
func BenchmarkParseReal_AnimateMin(b *testing.B) {
	benchmarkParseCSS(b, mustFixture(b, "AnimateMin").CSS)
}
func BenchmarkParseReal_Bootstrap(b *testing.B) {
	benchmarkParseCSS(b, mustFixture(b, "Bootstrap").CSS)
}
func BenchmarkParseReal_BootstrapMin(b *testing.B) {
	benchmarkParseCSS(b, mustFixture(b, "BootstrapMin").CSS)
}
func BenchmarkParseReal_Bulma(b *testing.B) {
	benchmarkParseCSS(b, mustFixture(b, "Bulma").CSS)
}
func BenchmarkParseReal_Pure(b *testing.B) {
	benchmarkParseCSS(b, mustFixture(b, "Pure").CSS)
}
func BenchmarkParseReal_UIkit(b *testing.B) {
	benchmarkParseCSS(b, mustFixture(b, "UIkit").CSS)
}
func BenchmarkParseReal_Materialize(b *testing.B) {
	benchmarkParseCSS(b, mustFixture(b, "Materialize").CSS)
}

func BenchmarkParseStringifyReal_ModernNormalize(b *testing.B) {
	benchmarkParseStringifyCSS(b, mustFixture(b, "ModernNormalize").CSS)
}
func BenchmarkParseStringifyReal_TailwindPreflight(b *testing.B) {
	benchmarkParseStringifyCSS(b, mustFixture(b, "TailwindPreflight").CSS)
}
func BenchmarkParseStringifyReal_AnimateMin(b *testing.B) {
	benchmarkParseStringifyCSS(b, mustFixture(b, "AnimateMin").CSS)
}
func BenchmarkParseStringifyReal_Bootstrap(b *testing.B) {
	benchmarkParseStringifyCSS(b, mustFixture(b, "Bootstrap").CSS)
}
func BenchmarkParseStringifyReal_BootstrapMin(b *testing.B) {
	benchmarkParseStringifyCSS(b, mustFixture(b, "BootstrapMin").CSS)
}
func BenchmarkParseStringifyReal_Bulma(b *testing.B) {
	benchmarkParseStringifyCSS(b, mustFixture(b, "Bulma").CSS)
}
func BenchmarkParseStringifyReal_Pure(b *testing.B) {
	benchmarkParseStringifyCSS(b, mustFixture(b, "Pure").CSS)
}
func BenchmarkParseStringifyReal_UIkit(b *testing.B) {
	benchmarkParseStringifyCSS(b, mustFixture(b, "UIkit").CSS)
}
func BenchmarkParseStringifyReal_Materialize(b *testing.B) {
	benchmarkParseStringifyCSS(b, mustFixture(b, "Materialize").CSS)
}

func BenchmarkProcessReal_ModernNormalize(b *testing.B) {
	benchmarkProcessCSS(b, mustFixture(b, "ModernNormalize").CSS)
}
func BenchmarkProcessReal_TailwindPreflight(b *testing.B) {
	benchmarkProcessCSS(b, mustFixture(b, "TailwindPreflight").CSS)
}
func BenchmarkProcessReal_AnimateMin(b *testing.B) {
	benchmarkProcessCSS(b, mustFixture(b, "AnimateMin").CSS)
}
func BenchmarkProcessReal_Bootstrap(b *testing.B) {
	benchmarkProcessCSS(b, mustFixture(b, "Bootstrap").CSS)
}
func BenchmarkProcessReal_BootstrapMin(b *testing.B) {
	benchmarkProcessCSS(b, mustFixture(b, "BootstrapMin").CSS)
}
func BenchmarkProcessReal_Bulma(b *testing.B) {
	benchmarkProcessCSS(b, mustFixture(b, "Bulma").CSS)
}
func BenchmarkProcessReal_Pure(b *testing.B) {
	benchmarkProcessCSS(b, mustFixture(b, "Pure").CSS)
}
func BenchmarkProcessReal_UIkit(b *testing.B) {
	benchmarkProcessCSS(b, mustFixture(b, "UIkit").CSS)
}
func BenchmarkProcessReal_Materialize(b *testing.B) {
	benchmarkProcessCSS(b, mustFixture(b, "Materialize").CSS)
}

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

func BenchmarkTokenize_small(b *testing.B) {
	benchmarkTokenizeCSS(b, generatedCSS(benchmark.SmallRules))
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
