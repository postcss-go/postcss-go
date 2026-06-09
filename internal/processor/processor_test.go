package processor

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"postcss-go/internal/ast"
	"postcss-go/internal/result"
)

func TestProcessorUsePrepareAndFromOption(t *testing.T) {
	var events []string

	p := New().Use(Plugin{
		Name: "prepared",
		Prepare: func(res *result.Result) Visitor {
			events = append(events, "prepare")
			return Visitor{
				Root: func(root *ast.Root, res *result.Result) error {
					events = append(events, "root")
					if !strings.HasSuffix(root.Source().Input.From(), "input.css") {
						t.Fatalf("expected source file to propagate, got %q", root.Source().Input.From())
					}
					return nil
				},
				DeclarationExit: func(decl *ast.Declaration, res *result.Result) error {
					events = append(events, "decl-exit:"+decl.Prop)
					return nil
				},
			}
		},
	})

	res, err := p.Process(".a { color: red; }", Options{From: "input.css"})
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	if got := res.CSS; !strings.Contains(got, "color: red;") {
		t.Fatalf("unexpected css output: %q", got)
	}
	if !reflect.DeepEqual(events, []string{"prepare", "root", "decl-exit:color"}) {
		t.Fatalf("unexpected events: %#v", events)
	}
}

func TestProcessorPropagatesVisitorErrors(t *testing.T) {
	sentinel := errors.New("stop")
	p := New(Plugin{
		Name: "boom",
		Visitor: Visitor{
			Rule: func(rule *ast.Rule, result *result.Result) error {
				return sentinel
			},
		},
	})
	_, err := p.Process(".a {}")
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected sentinel error, got %v", err)
	}
}
