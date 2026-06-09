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
