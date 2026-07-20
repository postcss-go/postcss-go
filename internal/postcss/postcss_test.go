package postcss

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestParseStringify(t *testing.T) {
	css := `
@media screen and (min-width: 768px) {
  .card {
    color: red;
    background: url("/demo;a.png");
  }
}
`

	root, err := Parse(css)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	got := Stringify(root)
	want := css
	if got != want {
		t.Fatalf("stringify mismatch\nwant:\n%s\n\ngot:\n%s", want, got)
	}
}

func TestVisitorPipeline(t *testing.T) {
	events := []string{}

	processor := New(
		Plugin{
			Name: "trace",
			Visitor: Visitor{
				Once: func(root *Root, result *Result) error {
					events = append(events, "Once")
					return nil
				},
				Rule: func(rule *Rule, result *Result) error {
					events = append(events, "Rule:"+rule.Selector)
					return nil
				},
				Declaration: func(decl *Declaration, result *Result) error {
					events = append(events, "Decl:"+decl.Prop)
					return nil
				},
				RuleExit: func(rule *Rule, result *Result) error {
					events = append(events, "RuleExit:"+rule.Selector)
					return nil
				},
				OnceExit: func(root *Root, result *Result) error {
					events = append(events, "OnceExit")
					return nil
				},
			},
		},
	)

	_, err := processor.Process(".btn { color: red; }")
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}

	want := []string{"Once", "Rule:.btn", "Decl:color", "RuleExit:.btn", "OnceExit"}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("unexpected events\nwant: %#v\ngot:  %#v", want, events)
	}
}

func TestPluginCanMutateAST(t *testing.T) {
	processor := New(
		Plugin{
			Name: "rewrite",
			Visitor: Visitor{
				Rule: func(rule *Rule, result *Result) error {
					children := append([]Node(nil), rule.Children()...)
					for _, child := range children {
						decl, ok := child.(*Declaration)
						if ok && decl.Prop == "display" && strings.TrimSpace(decl.Value) == "flex" {
							return rule.InsertBefore(child, NewDeclaration("display", "-webkit-box"))
						}
					}
					return nil
				},
				Declaration: func(decl *Declaration, result *Result) error {
					if decl.Prop == "color" && decl.Value == "red" {
						decl.Value = "tomato"
					}
					return nil
				},
			},
		},
	)

	res, err := processor.Process(".btn { display: flex; color: red; }")
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}

	if !strings.Contains(res.CSS, "display: -webkit-box;") {
		t.Fatalf("expected prefixed display, got %q", res.CSS)
	}
	if !strings.Contains(res.CSS, "color: tomato;") {
		t.Fatalf("expected rewritten color, got %q", res.CSS)
	}
}

func TestPreserveEmptyAtRuleBlockAndComments(t *testing.T) {
	root, err := Parse("@layer demo {} .btn { color: red/* ok */; }")
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	got := Stringify(root)
	if !strings.Contains(got, "@layer demo {}") {
		t.Fatalf("expected empty block at-rule, got %q", got)
	}
	if !strings.Contains(got, "color: red/* ok */;") {
		t.Fatalf("expected inline comment to stay attached to declaration value, got %q", got)
	}
}

func TestInputAndSyntaxError(t *testing.T) {
	_, err := ParseWithOptions(".a {\n  color red;\n}", ParseOptions{From: "fixtures/input.css"})
	if err == nil {
		t.Fatal("expected parse error")
	}

	var syntaxErr *CssSyntaxError
	if !errors.As(err, &syntaxErr) {
		t.Fatalf("expected CssSyntaxError, got %T", err)
	}
	if syntaxErr.Line != 2 || syntaxErr.Column != 3 {
		t.Fatalf("unexpected error position: line=%d column=%d", syntaxErr.Line, syntaxErr.Column)
	}
	if !strings.Contains(syntaxErr.Error(), "input.css") {
		t.Fatalf("expected file in error message, got %q", syntaxErr.Error())
	}
}

func TestNodeErrorSupportsIndexAndWord(t *testing.T) {
	root, err := ParseWithOptions("a { color: x red }", ParseOptions{From: "fixtures/error.css"})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	rule := root.Children()[0].(*Rule)
	decl := rule.Children()[0].(*Declaration)

	indexErr := decl.Error("Bad value", ErrorOptions{Index: 7})
	if indexErr.Line != 1 || indexErr.Column != 12 {
		t.Fatalf("unexpected index error position: %#v", indexErr)
	}
	if got := indexErr.ShowSourceCode(); !strings.Contains(got, "^") {
		t.Fatalf("expected caret in source code, got %q", got)
	}

	wordErr := decl.Error("Wrong color", ErrorOptions{Word: "x"})
	if wordErr.Line != 1 || wordErr.Column != 12 {
		t.Fatalf("unexpected word error position: %#v", wordErr)
	}
	if !strings.Contains(wordErr.Error(), "error.css:1:12") {
		t.Fatalf("expected file and location in message, got %q", wordErr.Error())
	}
}

func TestNodeErrorWithoutSourceFallsBackToCssInput(t *testing.T) {
	rule := NewRule("a")
	err := rule.Error("Test")
	if got := err.Error(); got != "<css input>: Test" {
		t.Fatalf("unexpected error message: %q", got)
	}
}

func TestNodeMutationAPI(t *testing.T) {
	root, err := Parse(".a, .b { color: red; }")
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	rule := root.Children()[0].(*Rule)
	if got := rule.Selectors(); !reflect.DeepEqual(got, []string{".a", ".b"}) {
		t.Fatalf("unexpected selectors: %#v", got)
	}
	rule.SetSelectors([]string{".x", ".y"})
	decl := rule.Children()[0].(*Declaration)
	if decl.Next() != nil || decl.Prev() != nil {
		t.Fatal("single declaration should have no siblings")
	}
	clone := decl.Clone().(*Declaration)
	clone.Prop = "background"
	if err := decl.ReplaceWith(clone, decl); err != nil {
		t.Fatalf("replace failed: %v", err)
	}
	after, err := decl.CloneAfter(NewDeclaration("border-color", "red"))
	if err != nil {
		t.Fatalf("clone after failed: %v", err)
	}
	before, err := decl.CloneBefore(NewDeclaration("-webkit-color", "red"))
	if err != nil {
		t.Fatalf("clone before failed: %v", err)
	}
	if after.Prev() != decl || before.Next() != decl {
		t.Fatal("clone helpers should preserve sibling order")
	}
	got := Stringify(root)
	if !strings.Contains(got, ".x, .y") ||
		!strings.Contains(got, "background: red;") ||
		!strings.Contains(got, "-webkit-color: red;") ||
		!strings.Contains(got, "border-color: red;") {
		t.Fatalf("unexpected css after mutation: %q", got)
	}
}
