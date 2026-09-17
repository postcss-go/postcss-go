package stringifier

import (
	"fmt"
	"strings"
	"testing"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/parser"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
)

func TestChildLayoutAcrossRenderers(t *testing.T) {
	for _, css := range []string{
		"a{x:y;z:w}", "a{x:y;z:w;}", "a{x:y/*tail*/}",
		"a{--x:y;/*tail*/}", "@a;/*tail*/", "@a;@b;@c",
		"a{/*only*/}", "a{x:y;/*middle*/z:w/*tail*/}",
	} {
		t.Run(css, func(t *testing.T) {
			root, err := parser.Parse(css, sourcemap.Options{From: "input.css"})
			if err != nil {
				t.Fatal(err)
			}
			if got := Stringify(root); got != css {
				t.Fatalf("direct: %q", got)
			}
			var general strings.Builder
			writeNode(builderWriter{Builder: &general, cache: &renderCache{}}, root, 0, false)
			if general.String() != css {
				t.Fatalf("general: %q", general.String())
			}
			var parts strings.Builder
			for _, part := range StringifyWithBuilder(root) {
				parts.WriteString(part.CSS)
			}
			if parts.String() != css {
				t.Fatalf("builder: %q", parts.String())
			}
			mapped, err := StringifyWithSourceMap(root, SourceMapOptions{})
			if err != nil || mapped.CSS != css {
				t.Fatalf("mapped: %q %v", mapped.CSS, err)
			}
		})
	}
}

func TestChildLayoutDoesNotSurviveTreeMutation(t *testing.T) {
	root, err := parser.Parse("a{x:y;z:w}", sourcemap.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := Stringify(root); got != "a{x:y;z:w}" {
		t.Fatal(got)
	}
	rule := root.Nodes[0].(*ast.Rule)
	rule.Nodes[1].Remove()
	if got := Stringify(root); got != "a{x:y}" {
		t.Fatal(got)
	}
	rule.RawFormatting()["semicolon"] = true
	if got := Stringify(root); got != "a{x:y;}" {
		t.Fatal(got)
	}
	clone := rule.Clone().(*ast.Rule)
	clone.Nodes[0].(*ast.Declaration).Value = "clone"
	if got := Stringify(clone); got != "a{x:clone;}" {
		t.Fatal(got)
	}
	if got := Stringify(root); got != "a{x:y;}" {
		t.Fatal(got)
	}
}

func BenchmarkFlatContainerStringify(b *testing.B) {
	for _, count := range []int{1000, 10000} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			css := "a{" + strings.Repeat("color:red;", count) + "}"
			root, err := parser.Parse(css, sourcemap.Options{})
			if err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.SetBytes(int64(len(css)))
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if got := Stringify(root); got != css {
					b.Fatal("output mismatch")
				}
			}
		})
	}
}
