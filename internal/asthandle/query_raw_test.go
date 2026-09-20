package asthandle

import (
	"strings"
	"testing"

	"github.com/postcss-go/postcss-go/internal/ast"
)

func TestInferRawBeforeCloseKeepsNewline(t *testing.T) {
	root := ast.NewRoot()
	withClose := ast.NewRule("a")
	withClose.Append(ast.NewDeclaration("color", "red"))
	ast.ApplyRaw(withClose, "after", "\n  ")
	root.Append(withClose)
	needsClose := ast.NewRule("b")
	needsClose.Append(ast.NewDeclaration("color", "blue"))
	root.Append(needsClose)

	got := inferRaw(needsClose, "after", "beforeClose")
	text, ok := got.(string)
	if !ok {
		t.Fatalf("beforeClose type %T, want string", got)
	}
	if !strings.Contains(text, "\n") {
		t.Fatalf("beforeClose = %q, want a newline prefix", text)
	}
}
