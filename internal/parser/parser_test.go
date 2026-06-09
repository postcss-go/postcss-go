package parser

import (
	"strings"
	"testing"

	"postcss-go/internal/ast"
	"postcss-go/internal/source"
	"postcss-go/internal/tokenizer"
)

func TestParseBuildsSourceRangesAndNodes(t *testing.T) {
	root, err := Parse("@media screen { .a { color: red !important; } }", source.Options{From: "a.css"})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if root.Source() == nil || !strings.HasSuffix(root.Source().Input.From(), "a.css") {
		t.Fatal("expected root source info with file")
	}
	if len(root.Children()) != 1 {
		t.Fatalf("expected 1 top-level node, got %d", len(root.Children()))
	}
	atRule := root.Children()[0].(*ast.AtRule)
	if !atRule.Block || atRule.Name != "media" {
		t.Fatalf("unexpected at-rule: %#v", atRule)
	}
	rule := atRule.Children()[0].(*ast.Rule)
	decl := rule.Children()[0].(*ast.Declaration)
	if !decl.Important || decl.Prop != "color" || decl.Value != "red" {
		t.Fatalf("unexpected declaration: %#v", decl)
	}
	if decl.Range().Start >= decl.Range().End {
		t.Fatalf("expected declaration range to be populated, got %#v", decl.Range())
	}
}

func TestParseCommentOnly(t *testing.T) {
	root, err := Parse("/* c */", source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if len(root.Children()) != 1 {
		t.Fatalf("expected one child, got %d", len(root.Children()))
	}
	comment := root.Children()[0].(*ast.Comment)
	if comment.Text != "c" {
		t.Fatalf("unexpected comment text: %q", comment.Text)
	}
}

func TestParseErrors(t *testing.T) {
	if _, err := Parse("}", source.Options{}); err == nil || !strings.Contains(err.Error(), "unexpected closing brace") {
		t.Fatalf("expected unexpected closing brace error, got %v", err)
	}
	if _, err := Parse(".a { color: red;", source.Options{}); err == nil || !strings.Contains(err.Error(), "missing closing brace") {
		t.Fatalf("expected missing closing brace error, got %v", err)
	}
	if _, err := Parse("color red;", source.Options{}); err == nil || !strings.Contains(err.Error(), "expected declaration") {
		t.Fatalf("expected declaration parse error, got %v", err)
	}
}

func TestHelpersTrimTokensAndColon(t *testing.T) {
	tokens := []tokenizerTokenAlias{
		{Kind: "space", Value: " "},
		{Kind: "word", Value: "color"},
		{Kind: ":", Value: ":"},
		{Kind: "word", Value: "red"},
		{Kind: "space", Value: " "},
	}
	trimmed := trimSpaceTokens(castTokens(tokens))
	if len(trimmed) != 3 {
		t.Fatalf("expected 3 trimmed tokens, got %d", len(trimmed))
	}
	if got := topLevelColon(trimmed); got != 1 {
		t.Fatalf("expected colon at 1, got %d", got)
	}
	if got := tokensText(trimmed); got != "color:red" {
		t.Fatalf("unexpected tokens text: %q", got)
	}
}

type tokenizerTokenAlias struct {
	Kind  string
	Value string
	Start int
	End   int
}

func castTokens(in []tokenizerTokenAlias) []tokenizer.Token {
	out := make([]tokenizer.Token, len(in))
	for i, token := range in {
		out[i] = tokenizer.Token(token)
	}
	return out
}
