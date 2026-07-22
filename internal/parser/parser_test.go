package parser

import (
	"strings"
	"testing"

	"postcss-go/internal/ast"
	"postcss-go/internal/sourcemap"
	"postcss-go/internal/tokenizer"
)

func TestParseBuildsSourceRangesAndNodes(t *testing.T) {
	root, err := Parse("@media screen { .a { color: red !important; } }", sourcemap.Options{From: "a.css"})
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
	root, err := Parse("/* c */", sourcemap.Options{})
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
	if _, err := Parse("}", sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "unexpected closing brace") {
		t.Fatalf("expected unexpected closing brace error, got %v", err)
	}
	if _, err := Parse(".a { color: red;", sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "missing closing brace") {
		t.Fatalf("expected missing closing brace error, got %v", err)
	}
	if _, err := Parse("color red;", sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "expected declaration") {
		t.Fatalf("expected declaration parse error, got %v", err)
	}
	if _, err := Parse(`color: "unterminated`, sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "Unclosed string") {
		t.Fatalf("expected tokenizer error to propagate, got %v", err)
	}
}

func TestParseCustomPropertyBlockAsDeclaration(t *testing.T) {
	root, err := Parse(":root { --size: {\n  width: 0;\n}; }", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if len(root.Children()) != 1 {
		t.Fatalf("expected one root child, got %d", len(root.Children()))
	}
	rule := root.Children()[0].(*ast.Rule)
	if len(rule.Children()) != 1 {
		t.Fatalf("expected one declaration, got %d", len(rule.Children()))
	}
	decl, ok := rule.Children()[0].(*ast.Declaration)
	if !ok {
		t.Fatalf("expected custom property declaration, got %T", rule.Children()[0])
	}
	if decl.Prop != "--size" || decl.Value != "{\n  width: 0;\n}" {
		t.Fatalf("unexpected custom property: prop=%q value=%q", decl.Prop, decl.Value)
	}
}

func TestParseNestedBracesInsideAtRuleParams(t *testing.T) {
	root, err := Parse(`@supports (--element("x", { "width": 1 })) { * { color: red; } }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if len(root.Children()) != 1 || root.Children()[0].Type() != ast.NodeAtRule {
		t.Fatalf("expected one at-rule, got %#v", root.Children())
	}
	atRule := root.Children()[0].(*ast.AtRule)
	if len(atRule.Children()) != 1 || atRule.Children()[0].Type() != ast.NodeRule {
		t.Fatalf("expected nested rule, got %#v", atRule.Children())
	}
}

func TestParseAtRuleWithoutSemicolonAtEOF(t *testing.T) {
	root, err := Parse(`@import"test.css"`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if len(root.Children()) != 1 {
		t.Fatalf("expected one at-rule, got %d", len(root.Children()))
	}
	atRule := root.Children()[0].(*ast.AtRule)
	if atRule.Name != "import" || atRule.Params != `"test.css"` || atRule.Block {
		t.Fatalf("unexpected at-rule: %#v", atRule)
	}
}

func TestParseEmptyRule(t *testing.T) {
	root, err := Parse(`{}`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if len(root.Children()) != 1 || root.Children()[0].Type() != ast.NodeRule {
		t.Fatalf("expected empty rule, got %#v", root.Children())
	}
}

func TestParseDeclarationSourceIncludesSemicolon(t *testing.T) {
	root, err := Parse("a{color: black;}", sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
	if got := decl.Source().End.Offset; got != 15 {
		t.Fatalf("declaration source end offset = %d, want 15", got)
	}
}

func TestParseWithSourceMapMapsLocations(t *testing.T) {
	const sourceMap = `{
		"version": 3,
		"file": "generated.css",
		"sourceRoot": "/src",
		"sources": ["original.css"],
		"sourcesContent": [".orig {\n  color: red;\n}"],
		"names": [],
		"mappings": "AAAA"
	}`

	root, err := Parse(".gen { color: red; }", sourcemap.Options{
		From:         "generated.css",
		SourceMapURL: "generated.css.map",
		SourceMap:    []byte(sourceMap),
	})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if root.Source() == nil || root.Source().Input == nil || root.Source().Input.File != "/src/original.css" {
		t.Fatalf("expected mapped root source, got %#v", root.Source())
	}
}

func TestHelpersTrimTokensAndColon(t *testing.T) {
	const input = " color:red "
	tokens := []tokenizer.Token{
		{Kind: "space", Start: 0, End: 0},
		{Kind: "word", Start: 1, End: 5},
		{Kind: ":", Start: 6, End: 6},
		{Kind: "word", Start: 7, End: 9},
		{Kind: "space", Start: 10, End: 10},
	}
	trimmed := trimSpaceTokens(tokens)
	if len(trimmed) != 3 {
		t.Fatalf("expected 3 trimmed tokens, got %d", len(trimmed))
	}
	if got := topLevelColon(trimmed); got != 1 {
		t.Fatalf("expected colon at 1, got %d", got)
	}
	parser := &Parser{input: input}
	if got := parser.tokensText(trimmed); got != "color:red" {
		t.Fatalf("unexpected tokens text: %q", got)
	}
}

type tokenizerTokenAlias struct {
	Kind  string
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
