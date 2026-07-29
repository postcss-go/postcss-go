package result

import (
	"reflect"
	"testing"

	"postcss-go/internal/ast"
	"postcss-go/internal/sourcemap"
)

func TestResultWarnWarningsAndString(t *testing.T) {
	root := ast.NewRoot()
	res := &Result{Root: root, CSS: ".a {}", LastPlugin: "demo"}

	warning := res.Warn("watch out")
	if warning.Plugin != "demo" || warning.Type != "warning" {
		t.Fatalf("unexpected warning: %#v", warning)
	}
	res.Messages = append(res.Messages, Warning{Type: "info", Text: "skip"})

	if got := res.Warnings(); !reflect.DeepEqual(got, []Warning{warning}) {
		t.Fatalf("unexpected warnings slice: %#v", got)
	}
	if got := res.String(); got != ".a {}" {
		t.Fatalf("unexpected result string: %q", got)
	}
	if got := warning.String(); got != "demo: watch out" {
		t.Fatalf("unexpected warning string: %q", got)
	}
	if got := (Warning{Text: "plain"}).String(); got != "plain" {
		t.Fatalf("unexpected plain warning string: %q", got)
	}
}

func TestResultWarnAttachesNodePosition(t *testing.T) {
	input, err := sourcemap.NewInput("a { color: red; }", sourcemap.Options{From: "fixtures/a.css"})
	if err != nil {
		t.Fatalf("input failed: %v", err)
	}
	rule := ast.NewRule("a")
	rule.SetRange(ast.SourceRange{Start: 0, End: 16})
	rule.SetSource(input.Location(input.FromOffset(0), input.FromOffset(16)))

	res := &Result{Root: ast.NewRoot(), LastPlugin: "plugin"}
	warning := res.Warn("watch out", WarnOptions{Node: rule})

	if warning.Line != 1 || warning.Column != 1 {
		t.Fatalf("unexpected warning position: %#v", warning)
	}
	if got := warning.String(); got != "plugin: "+input.From()+":1:1: watch out" {
		t.Fatalf("unexpected warning string: %q", got)
	}
}

func TestResultWarnSupportsWordRange(t *testing.T) {
	input, err := sourcemap.NewInput("a { color: red; }", sourcemap.Options{})
	if err != nil {
		t.Fatalf("input failed: %v", err)
	}
	decl := ast.NewDeclaration("color", "red")
	decl.SetRange(ast.SourceRange{Start: 4, End: 14})
	decl.SetSource(input.Location(input.FromOffset(4), input.FromOffset(14)))

	res := &Result{Root: ast.NewRoot(), LastPlugin: "plugin"}
	warning := res.Warn("bad value", WarnOptions{Node: decl, Word: "red"})

	if warning.Line != 1 || warning.Column != 12 {
		t.Fatalf("unexpected warning start: %#v", warning)
	}
	if warning.EndLine != 1 || warning.EndColumn != 15 {
		t.Fatalf("unexpected warning end: %#v", warning)
	}
	if got := warning.String(); got != "plugin: <css input>:1:12: bad value" {
		t.Fatalf("unexpected word warning string: %q", got)
	}
}

func TestResultWarnSupportsIndexRangeAndExplicitPositions(t *testing.T) {
	input, err := sourcemap.NewInput("a { color: red; }", sourcemap.Options{})
	if err != nil {
		t.Fatalf("input failed: %v", err)
	}
	decl := ast.NewDeclaration("color", "red")
	decl.SetRange(ast.SourceRange{Start: 4, End: 14})
	decl.SetSource(input.Location(input.FromOffset(4), input.FromOffset(14)))

	res := &Result{Root: ast.NewRoot(), LastPlugin: "plugin"}
	byIndex := res.Warn("by index", WarnOptions{Node: decl, Index: 7, EndIndex: 9})
	if byIndex.Line != 1 || byIndex.Column != 12 {
		t.Fatalf("unexpected index warning start: %#v", byIndex)
	}
	if byIndex.EndLine != 1 || byIndex.EndColumn != 15 {
		t.Fatalf("unexpected index warning end: %#v", byIndex)
	}

	start := &sourcemap.Position{Line: 2, Column: 3}
	end := &sourcemap.Position{Line: 2, Column: 8}
	byPos := res.Warn("by pos", WarnOptions{Node: decl, Start: start, End: end})
	if byPos.Line != 2 || byPos.Column != 3 || byPos.EndLine != 2 || byPos.EndColumn != 8 {
		t.Fatalf("explicit positions should win before word/index lookup: %#v", byPos)
	}

	missingWord := res.Warn("missing", WarnOptions{Node: decl, Word: "green"})
	if missingWord.Line != 1 || missingWord.Column != 5 {
		t.Fatalf("missing word should fall back to node range: %#v", missingWord)
	}
}

func TestWarningStringUsesCssInputFallback(t *testing.T) {
	warning := Warning{Text: "oops", Plugin: "demo", Line: 3, Column: 4}
	if got := warning.String(); got != "demo: <css input>:3:4: oops" {
		t.Fatalf("unexpected warning string: %q", got)
	}
}

func TestAstLocateHelpersRejectInvalidRanges(t *testing.T) {
	if _, _, ok := astLocateWord(ast.NewRule("a"), "a"); ok {
		t.Fatal("expected locate word without source to fail")
	}
	if _, _, ok := astLocateIndex(ast.NewRule("a"), 0, 1); ok {
		t.Fatal("expected locate index without source to fail")
	}

	input, err := sourcemap.NewInput("abcdef", sourcemap.Options{})
	if err != nil {
		t.Fatalf("input failed: %v", err)
	}
	node := ast.NewRule("a")
	node.SetSource(input.Location(input.FromOffset(0), input.FromOffset(6)))
	node.SetRange(ast.SourceRange{Start: 10, End: 4})
	if _, _, ok := astLocateWord(node, "a"); ok {
		t.Fatal("expected invalid range to fail word locate")
	}

	node.SetRange(ast.SourceRange{Start: 0, End: 6})
	start, end, ok := astLocateIndex(node, -2, -5)
	if !ok || start.Offset != 0 || end.Offset != 1 {
		t.Fatalf("negative indexes should clamp: start=%#v end=%#v ok=%v", start, end, ok)
	}
	start, end, ok = astLocateIndex(node, 100, 200)
	if !ok || start.Offset != 6 || end.Offset != 6 {
		t.Fatalf("overflow indexes should clamp to end: start=%#v end=%#v ok=%v", start, end, ok)
	}
}
