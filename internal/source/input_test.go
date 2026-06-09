package source

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestNewInputFromOffsetsAndErrors(t *testing.T) {
	input, err := NewInput("\uFEFFa\nbc", Options{From: "fixtures/a.css", Document: "doc"})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	if !input.HasBOM || input.CSS != "a\nbc" || input.Document != "doc" {
		t.Fatalf("unexpected input normalization: %#v", input)
	}
	if !filepath.IsAbs(input.File) {
		t.Fatalf("expected absolute file path, got %q", input.File)
	}
	if got := input.From(); got != input.File {
		t.Fatalf("expected From to return file, got %q", got)
	}

	pos := input.FromOffset(3)
	if pos.Line != 2 || pos.Column != 2 || pos.Offset != 3 {
		t.Fatalf("unexpected position from offset: %#v", pos)
	}
	offset, err := input.FromLineAndColumn(2, 2)
	if err != nil || offset != 3 {
		t.Fatalf("unexpected line/column mapping: offset=%d err=%v", offset, err)
	}
	if _, err := input.FromLineAndColumn(9, 1); err == nil {
		t.Fatal("expected out of range line error")
	}

	errObj := input.ErrorAtOffset("boom", 2, "demo")
	if !strings.Contains(errObj.Error(), "demo:") || errObj.Line != 2 || errObj.Column != 1 {
		t.Fatalf("unexpected error object: %#v", errObj)
	}
	if got := input.String(); got != "a\nbc" {
		t.Fatalf("unexpected input string: %q", got)
	}
}

func TestNewInputWithoutFile(t *testing.T) {
	input, err := NewInput("x", Options{})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	if got := input.From(); got != "<css input>" {
		t.Fatalf("unexpected default from: %q", got)
	}
}

func TestNewInputWithSourceMap(t *testing.T) {
	const sourceMap = `{
		"version": 3,
		"file": "generated.css",
		"sourceRoot": "/src",
		"sources": ["original.css"],
		"sourcesContent": [".orig {\n  color: red;\n}"],
		"names": [],
		"mappings": "AAAA"
	}`

	input, err := NewInput(".gen{}", Options{
		From:         "generated.css",
		SourceMapURL: "generated.css.map",
		SourceMap:    []byte(sourceMap),
	})
	if err != nil {
		t.Fatalf("new input with sourcemap failed: %v", err)
	}

	errObj := input.Error("boom", 1, 1, "demo")
	if errObj.File != "/src/original.css" {
		t.Fatalf("expected mapped file, got %q", errObj.File)
	}
	if errObj.Line != 1 || errObj.Column != 1 {
		t.Fatalf("expected mapped location 1:1, got %d:%d", errObj.Line, errObj.Column)
	}
	if !strings.Contains(errObj.Source, ".orig") {
		t.Fatalf("expected original source content, got %q", errObj.Source)
	}

	loc := input.Location(Position{Line: 1, Column: 1, Offset: 0}, Position{Line: 1, Column: 2, Offset: 1})
	if loc.Input == nil || loc.Input.File != "/src/original.css" {
		t.Fatalf("expected mapped location input file, got %#v", loc.Input)
	}
}
