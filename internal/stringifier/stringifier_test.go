package stringifier

import (
	"testing"

	"postcss-go/internal/ast"
)

func TestStringifyComplexTree(t *testing.T) {
	root := ast.NewRoot()
	root.Append(ast.NewComment("top"))
	rule := ast.NewRule(".a")
	decl := ast.NewDeclaration("color", "red")
	decl.Important = true
	rule.Append(decl)
	atRule := ast.NewAtRule("media", "screen")
	atRule.Block = true
	atRule.Append(rule)
	root.Append(atRule)

	got := Stringify(root)
	want := `/* top */
@media screen {
  .a {
    color: red !important;
  }
}`
	if got != want {
		t.Fatalf("unexpected stringified css\nwant:\n%s\n\ngot:\n%s", want, got)
	}
}

func TestStringifyAtRuleWithoutBlock(t *testing.T) {
	node := ast.NewAtRule("import", `"a.css"`)
	if got := Stringify(node); got != `@import "a.css";` {
		t.Fatalf("unexpected at-rule string: %q", got)
	}
}
