package nativebridge

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/postcss-go/postcss-go/internal/result"
)

func TestCallRejectsBinaryASTFrames(t *testing.T) {
	if _, err := Call(Parse, []byte(".a{}"), nil); err == nil {
		t.Fatal("expected parse AST frame rejection")
	}
	if _, err := Call(Stringify, []byte(".a{}"), nil); err == nil {
		t.Fatal("expected stringify AST frame rejection")
	}
	if _, err := Call(StringifyBuilder, []byte(".a{}"), nil); err == nil {
		t.Fatal("expected stringifyBuilder AST frame rejection")
	}
	if _, err := Call(Operation(255), nil, nil); err == nil {
		t.Fatal("expected unknown operation error")
	}
}

func TestProcessReturnsJSONWithoutAST(t *testing.T) {
	payload, err := Call(Process, []byte("a { color: blue; }"), []byte(`{"from":"p.css"}`))
	if err != nil {
		t.Fatalf("process: %v", err)
	}
	var result processResult
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatalf("decode process json: %v", err)
	}
	if result.CSS != "a { color: blue; }" {
		t.Fatalf("unexpected process css: %q", result.CSS)
	}
}

func TestNoWorkPreservesCSS(t *testing.T) {
	css := "/* keep */ a { color: red; }"
	payload, err := Call(NoWork, []byte(css), nil)
	if err != nil {
		t.Fatalf("noWork: %v", err)
	}
	var result stringifyResult
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatalf("decode noWork json: %v", err)
	}
	if result.CSS != css {
		t.Fatalf("noWork should preserve css, got %q", result.CSS)
	}
}

func TestCallRejectsInvalidOptions(t *testing.T) {
	if _, err := Call(Process, []byte("a{}"), []byte("{")); err == nil {
		t.Fatal("expected bad process options error")
	}
	if _, err := Call(NoWork, []byte("a{}"), []byte("{")); err == nil {
		t.Fatal("expected bad no-work options error")
	}
}

func TestCallErrorAndWarningPaths(t *testing.T) {
	if got := warnings(nil); got != nil {
		t.Fatalf("expected nil warnings for empty input, got %#v", got)
	}
	converted := warnings([]result.Warning{{Type: "warning", Text: "heads up", Plugin: "demo"}})
	if len(converted) != 1 || converted[0].Text != "heads up" || converted[0].Plugin != "demo" {
		t.Fatalf("unexpected warnings conversion: %#v", converted)
	}
	if !strings.Contains(errBinaryAST.Error(), "handle sessions") {
		t.Fatalf("unexpected binary AST error: %v", errBinaryAST)
	}
}
