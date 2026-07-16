package source

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestNewInputPreservesWindowsDrivePaths(t *testing.T) {
	input, err := NewInput("x", Options{From: "C:\\repo\\input.css"})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	if input.File != "C:\\repo\\input.css" {
		t.Fatalf("expected Windows drive path to be preserved, got %q", input.File)
	}
}

func TestWindowsDrivePathsAreNotSourceURIs(t *testing.T) {
	if isSourceURI(`C:\repo\input.css`) {
		t.Fatal("Windows drive-letter paths must not be treated as URIs")
	}
}

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

func TestNewInputPreservesSourceURI(t *testing.T) {
	input, err := NewInput("x", Options{From: "https://example.com/styles.css"})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	if got := input.From(); got != "https://example.com/styles.css" {
		t.Fatalf("expected source URI to be preserved, got %q", got)
	}
}

func TestInputColumnsUseUTF16CodeUnits(t *testing.T) {
	input, err := NewInput("中🔥x", Options{})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}

	pos := input.FromOffset(len("中🔥"))
	if pos.Column != 4 {
		t.Fatalf("expected UTF-16 column 4, got %#v", pos)
	}
	offset, err := input.FromLineAndColumn(1, 4)
	if err != nil || offset != len("中🔥") {
		t.Fatalf("unexpected UTF-16 column mapping: offset=%d err=%v", offset, err)
	}
	if _, err := input.FromLineAndColumn(1, 3); err == nil {
		t.Fatal("expected a column inside a surrogate pair to be rejected")
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
	if loc.Start.Offset != 0 {
		t.Fatalf("expected mapped start offset 0, got %d", loc.Start.Offset)
	}
}

func TestLocationOffsetRemappedThroughSourceMap(t *testing.T) {
	const sourceMap = `{
		"version": 3,
		"file": "generated.css",
		"sources": ["original.css"],
		"sourcesContent": [".a {\n  color: red;\n}"],
		"names": [],
		"mappings": "AAAA;EACE"
	}`

	input, err := NewInput(".a {\n  color: blue;\n}", Options{
		From:         "generated.css",
		SourceMapURL: "generated.css.map",
		SourceMap:    []byte(sourceMap),
	})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}

	startOffset := strings.Index(input.CSS, "color")
	loc := input.Location(
		input.FromOffset(startOffset),
		input.FromOffset(startOffset+5),
	)
	if loc.Input == nil || !strings.HasSuffix(loc.Input.File, "original.css") {
		t.Fatalf("expected original.css, got %q", loc.Input.File)
	}
	if loc.Start.Line != 2 || loc.Start.Column != 3 {
		t.Fatalf("expected mapped start 2:3, got %d:%d", loc.Start.Line, loc.Start.Column)
	}

	originalCSS := ".a {\n  color: red;\n}"
	wantStartOffset := strings.Index(originalCSS, "color")
	if loc.Start.Offset != wantStartOffset {
		t.Fatalf("expected start offset %d in original source, got %d", wantStartOffset, loc.Start.Offset)
	}
}
