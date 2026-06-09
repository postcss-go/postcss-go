package csserrors

import (
	"strings"
	"testing"
)

func TestSyntaxErrorFormattingAndSourceCode(t *testing.T) {
	err := New("Unexpected token", 2, 4, ".a {\n  color red;\n}", "/tmp/input.css", "demo-plugin")

	if got := err.Error(); !strings.Contains(got, "demo-plugin: /tmp/input.css:2:4: Unexpected token") {
		t.Fatalf("unexpected error message: %q", got)
	}

	source := err.ShowSourceCode()
	if !strings.Contains(source, "> 2 |   color red;") {
		t.Fatalf("expected highlighted source line, got %q", source)
	}
	if !strings.Contains(source, "^") {
		t.Fatalf("expected caret marker, got %q", source)
	}

	if got := err.String(); !strings.Contains(got, "CssSyntaxError:") || !strings.Contains(got, "Unexpected token") {
		t.Fatalf("unexpected string form: %q", got)
	}
}

func TestSyntaxErrorWithoutSource(t *testing.T) {
	err := New("Boom", 0, 0, "", "", "")
	if got := err.ShowSourceCode(); got != "" {
		t.Fatalf("expected empty source code, got %q", got)
	}
	if got := err.String(); got != "CssSyntaxError: <css input>: Boom" {
		t.Fatalf("unexpected string without source: %q", got)
	}
}
