//go:build js && wasm

package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/jsbridge"
)

func TestResponseJSON(t *testing.T) {
	encoded := responseJSON(jsbridge.Response{
		OK:  true,
		CSS: "a { color: red; }",
	})

	var response jsbridge.Response
	if err := json.Unmarshal([]byte(encoded), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.OK || response.CSS != "a { color: red; }" || response.Error != nil {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestResponseJSONReturnsFallbackErrorWhenEncodingFails(t *testing.T) {
	encoded := responseJSON(jsbridge.Response{
		Root: &jsbridge.NodeDTO{Raws: ast.Raws{"unsupported": func() {}}},
	})

	var response jsbridge.Response
	if err := json.Unmarshal([]byte(encoded), &response); err != nil {
		t.Fatalf("decode fallback response: %v", err)
	}
	if response.Error == nil {
		t.Fatalf("expected fallback error, got %+v", response)
	}
	if !strings.Contains(response.Error.Message, "unsupported type: func()") {
		t.Fatalf("unexpected fallback error: %q", response.Error.Message)
	}
}
