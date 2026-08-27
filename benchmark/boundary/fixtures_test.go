package boundary

import (
	"testing"

	"github.com/postcss-go/postcss-go/benchmark"
	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/parser"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
)

type fixture struct {
	name string
	css  string
}

// fixtures reuses the vendored stylesheets from the parent benchmark package
// and matches the set used by lib/fixtures.mjs, so the Go and JavaScript halves
// of the measurement can be added together.
func fixtures(tb testing.TB) []fixture {
	tb.Helper()

	ids := []string{"ModernNormalize", "TailwindPreflight", "AnimateMin", "Bootstrap"}
	out := make([]fixture, 0, len(ids)+1)
	for _, id := range ids {
		real, err := benchmark.RealWorldFixtureByID(id)
		if err != nil {
			tb.Fatalf("load fixture %q: %v", id, err)
		}
		out = append(out, fixture{name: id, css: real.CSS})
	}
	return append(out, fixture{
		name: "Generated10k",
		css:  benchmark.GenerateCSS(benchmark.LargeRules),
	})
}

func mustParse(tb testing.TB, css string) *ast.Root {
	tb.Helper()

	root, err := parser.Parse(css, sourcemap.Options{From: "bench.css", TrackSource: true})
	if err != nil {
		tb.Fatalf("parse: %v", err)
	}
	return root
}

func countNodes(node ast.Node) int {
	total := 1
	if container, ok := node.(ast.Container); ok {
		for _, child := range container.Children() {
			total += countNodes(child)
		}
	}
	return total
}
