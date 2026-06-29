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

func TestProcessorFollowsMutationSafeTraversal(t *testing.T) {
	var visited []string

	p := New(Plugin{
		Name: "mutating",
		Visitor: Visitor{
			Declaration: func(decl *ast.Declaration, result *result.Result) error {
				visited = append(visited, decl.Prop)
				switch decl.Prop {
				case "color":
					if _, err := decl.CloneBefore(ast.NewDeclaration("-webkit-color", decl.Value)); err != nil {
						return err
					}
					if _, err := decl.CloneAfter(ast.NewDeclaration("background", "blue")); err != nil {
						return err
					}
				case "z-index":
					decl.Remove()
				}
				return nil
			},
		},
	})

	res, err := p.Process(".a { color: red; z-index: 1; }")
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}

	if !reflect.DeepEqual(visited, []string{"color", "background", "z-index"}) {
		t.Fatalf("unexpected visit order: %#v", visited)
	}
	if got := res.CSS; got != ".a {\n  -webkit-color: red;\n  color: red;\n  background: blue;\n}" {
		t.Fatalf("unexpected css output: %q", got)
	}
}

func TestProcessorDispatchesNamedVisitors(t *testing.T) {
	var events []string

	p := New(Plugin{
		Name: "named",
		Visitor: Visitor{
			AtRule: func(rule *ast.AtRule, result *result.Result) error {
				events = append(events, "atrule:"+rule.Name)
				return nil
			},
			AtRuleNamed: map[string]func(*ast.AtRule, *result.Result) error{
				"media": func(rule *ast.AtRule, result *result.Result) error {
					events = append(events, "atrule-named:"+rule.Name)
					return nil
				},
			},
			AtRuleExit: func(rule *ast.AtRule, result *result.Result) error {
				events = append(events, "atrule-exit:"+rule.Name)
				return nil
			},
			AtRuleExitNamed: map[string]func(*ast.AtRule, *result.Result) error{
				"media": func(rule *ast.AtRule, result *result.Result) error {
					events = append(events, "atrule-exit-named:"+rule.Name)
					return nil
				},
			},
			Declaration: func(decl *ast.Declaration, result *result.Result) error {
				events = append(events, "decl:"+decl.Prop)
				return nil
			},
			DeclarationProp: map[string]func(*ast.Declaration, *result.Result) error{
				"color": func(decl *ast.Declaration, result *result.Result) error {
					events = append(events, "decl-prop:"+decl.Prop)
					return nil
				},
			},
			DeclarationExit: func(decl *ast.Declaration, result *result.Result) error {
				events = append(events, "decl-exit:"+decl.Prop)
				return nil
			},
			DeclarationExitProp: map[string]func(*ast.Declaration, *result.Result) error{
				"color": func(decl *ast.Declaration, result *result.Result) error {
					events = append(events, "decl-exit-prop:"+decl.Prop)
					return nil
				},
			},
		},
	})

	_, err := p.Process("@media screen { .a { color: red; width: 1px; } }")
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}

	want := []string{
		"atrule:media",
		"atrule-named:media",
		"decl:color",
		"decl-prop:color",
		"decl-exit:color",
		"decl-exit-prop:color",
		"decl:width",
		"decl-exit:width",
		"atrule-exit:media",
		"atrule-exit-named:media",
	}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("unexpected named visitor events\nwant: %#v\ngot:  %#v", want, events)
	}
}
