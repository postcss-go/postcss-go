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
