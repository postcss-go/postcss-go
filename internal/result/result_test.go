package result

import (
	"reflect"
	"testing"

	"postcss-go/internal/ast"
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
