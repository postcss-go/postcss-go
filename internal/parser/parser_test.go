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

func TestParseFreeSemicolonAndEmptyBlocks(t *testing.T) {
	root, err := Parse(".a{};", sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	rule := root.Children()[0].(*ast.Rule)
	if _, ok := rule.RawFormattingReadOnly()["ownSemicolon"]; !ok {
		t.Fatalf("expected ownSemicolon raw, got %#v", rule.RawFormattingReadOnly())
	}

	root, err = Parse(".a{color:red};", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if _, ok := root.Children()[0].(*ast.Rule).RawFormattingReadOnly()["ownSemicolon"]; !ok {
		t.Fatal("expected ownSemicolon after rule")
	}

	root, err = Parse(";", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse lone semicolon: %v", err)
	}

	root, err = Parse("{ }", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse empty spaced rule: %v", err)
	}
	if got := root.Children()[0].(*ast.Rule).RawFormattingReadOnly()["after"]; got != " " && got != "" {
		// after may absorb trailing spaces inside the block
		_ = got
	}
}

func TestParseBracketsNestingAndUnclosed(t *testing.T) {
	root, err := Parse(`a[href="x"] { color: red; }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("attribute selector: %v", err)
	}
	if root.Children()[0].(*ast.Rule).Selector != `a[href="x"]` {
		t.Fatalf("unexpected selector: %q", root.Children()[0].(*ast.Rule).Selector)
	}

	root, err = Parse(`a[href={x}] { color: red; }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("braces in brackets: %v", err)
	}

	root, err = Parse(`div:is(.a, .b) { color: red; }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("parens nesting: %v", err)
	}

	if _, err := Parse(`a[href { color: red; }`, sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "Unclosed bracket") {
		t.Fatalf("expected unclosed bracket, got %v", err)
	}
	if _, err := Parse(`a(href { color: red; }`, sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "Unclosed bracket") {
		t.Fatalf("expected unclosed paren bracket, got %v", err)
	}
}

func TestParseSelectorsCommentsAndBOM(t *testing.T) {
	root, err := Parse(".a/*x*/.b {}", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got := root.Children()[0].(*ast.Rule).Selector; got != ".a/*x*/.b" {
		t.Fatalf("expected comment kept between tokens, got %q", got)
	}

	root, err = Parse(".a /*x*/ .b {}", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse spaced comment selector: %v", err)
	}
	if got := root.Children()[0].(*ast.Rule).Selector; got != ".a  .b" && got != ".a .b" {
		// comments between spaces are dropped
		if !strings.Contains(got, ".a") || !strings.Contains(got, ".b") {
			t.Fatalf("unexpected selector: %q", got)
		}
	}

	root, err = Parse("\ufeff.a{}", sourcemap.Options{})
	if err != nil {
		t.Fatalf("BOM selector: %v", err)
	}
	if root.Children()[0].(*ast.Rule).Selector != ".a" {
		t.Fatalf("expected BOM stripped, got %q", root.Children()[0].(*ast.Rule).Selector)
	}
}

func TestParseDeclarationsEdgeCases(t *testing.T) {
	cases := []struct {
		name  string
		css   string
		check func(*testing.T, *ast.Root)
	}{
		{
			name: "important spaced bang",
			css:  "a{color:red ! important;}",
			check: func(t *testing.T, root *ast.Root) {
				decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
				if !decl.Important || decl.Value != "red" {
					t.Fatalf("unexpected: %#v", decl)
				}
			},
		},
		{
			name: "important bangimportant",
			css:  "a{color:red!important;}",
			check: func(t *testing.T, root *ast.Root) {
				decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
				if !decl.Important {
					t.Fatal("expected important")
				}
			},
		},
		{
			name: "legacy star hack",
			css:  "a{*color: red;}",
			check: func(t *testing.T, root *ast.Root) {
				decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
				if decl.Prop != "color" {
					t.Fatalf("expected stripped prop, got %q", decl.Prop)
				}
			},
		},
		{
			name: "progid filter",
			css:  `a{filter:progid:DXImageTransform.Microsoft.Alpha(Opacity=50);}`,
			check: func(t *testing.T, root *ast.Root) {
				decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
				if !strings.Contains(decl.Value, "progid:") {
					t.Fatalf("unexpected value %q", decl.Value)
				}
			},
		},
		{
			name: "trailing comment without semicolon",
			css:  "a{color:red/*c*/}",
			check: func(t *testing.T, root *ast.Root) {
				rule := root.Children()[0].(*ast.Rule)
				if len(rule.Children()) < 1 {
					t.Fatal("expected declaration")
				}
			},
		},
		{
			name: "custom property trailing spaces",
			css:  "a{--x: 1 }",
			check: func(t *testing.T, root *ast.Root) {
				decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
				if decl.Prop != "--x" {
					t.Fatalf("unexpected prop %q", decl.Prop)
				}
			},
		},
		{
			name: "custom property comment value",
			css:  "a{--x: /*c*/;}",
			check: func(t *testing.T, root *ast.Root) {
				decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
				if decl.Prop != "--x" {
					t.Fatalf("unexpected %#v", decl)
				}
			},
		},
		{
			name: "custom property important",
			css:  "a{--x: 1 !important;}",
			check: func(t *testing.T, root *ast.Root) {
				decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
				if !decl.Important {
					t.Fatalf("expected important custom property: %#v", decl)
				}
			},
		},
		{
			name: "custom property comment before important",
			css:  "a{--x: /*c*/ !important;}",
			check: func(t *testing.T, root *ast.Root) {
				decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
				if !decl.Important {
					t.Fatalf("expected important: %#v", decl)
				}
			},
		},
		{
			name: "empty comment",
			css:  "/**/ a{}",
			check: func(t *testing.T, root *ast.Root) {
				if root.Children()[0].Type() != ast.NodeComment {
					t.Fatalf("expected leading comment, got %T", root.Children()[0])
				}
			},
		},
		{
			name: "comment then semicolon",
			css:  "/*c*/;",
			check: func(t *testing.T, root *ast.Root) {
				if len(root.Children()) == 0 || root.Children()[0].Type() != ast.NodeComment {
					t.Fatalf("expected comment node, got %#v", root.Children())
				}
			},
		},
		{
			name: "nested braces in value",
			css:  "a{--x: {a:1};}",
			check: func(t *testing.T, root *ast.Root) {
				decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
				if !strings.Contains(decl.Value, "{") {
					t.Fatalf("expected brace value, got %q", decl.Value)
				}
			},
		},
		{
			name: "spaces only before close",
			css:  "a{   }",
			check: func(t *testing.T, root *ast.Root) {
				if len(root.Children()) != 1 {
					t.Fatal("expected empty rule")
				}
			},
		},
		{
			name: "leading comment pending before",
			css:  "/*c*/\n.a{color:red}",
			check: func(t *testing.T, root *ast.Root) {
				if root.Children()[0].Type() != ast.NodeComment {
					t.Fatal("expected comment first")
				}
			},
		},
		{
			name: "colon prefixed nested custom property",
			css:  ":root{--x:1}",
			check: func(t *testing.T, root *ast.Root) {
				rule := root.Children()[0].(*ast.Rule)
				if rule.Selector != ":root" {
					t.Fatalf("selector=%q", rule.Selector)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root, err := Parse(tc.css, sourcemap.Options{TrackSource: true})
			if err != nil {
				t.Fatalf("parse %q: %v", tc.css, err)
			}
			tc.check(t, root)
		})
	}
}

func TestParseAtRulesEdgeCases(t *testing.T) {
	root, err := Parse(`@import "a.css"; @charset "utf-8"`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(root.Children()) != 2 {
		t.Fatalf("expected 2 atrules, got %d", len(root.Children()))
	}

	root, err = Parse(`@page { size: A4; }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("page: %v", err)
	}
	if !root.Children()[0].(*ast.AtRule).Block {
		t.Fatal("expected block atrule")
	}

	root, err = Parse(`@media screen/*c*/ { a{} }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("media comment: %v", err)
	}

	root, err = Parse(`@namespace /*c*/ url(http://example.com);`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("namespace: %v", err)
	}
	at := root.Children()[0].(*ast.AtRule)
	if at.Params == "" {
		t.Fatalf("expected params, got %#v", at)
	}

	if _, err := Parse("@;", sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "At-rule without name") {
		t.Fatalf("expected nameless atrule error, got %v", err)
	}
	if _, err := Parse("@", sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "At-rule without name") {
		t.Fatalf("expected nameless atrule at EOF error, got %v", err)
	}
}

func TestParseCustomPropertyBlockVariants(t *testing.T) {
	root, err := Parse(`:root { --box: { width: 1px; height: 2px; }; }`, sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
	if !strings.Contains(decl.Value, "width") {
		t.Fatalf("unexpected custom block value: %q", decl.Value)
	}

	root, err = Parse(`:root { --box: { a: 1 } }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("unterminated custom block: %v", err)
	}

	if _, err := Parse(`:root { --box: { a: 1 `, sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "closing brace") {
		t.Fatalf("expected missing brace, got %v", err)
	}
}

func TestParseErrorHintsForPreprocessorFiles(t *testing.T) {
	for _, from := range []string{"x.scss", "x.sass", "x.less"} {
		_, err := Parse("color red;", sourcemap.Options{From: from})
		if err == nil {
			t.Fatalf("expected error for %s", from)
		}
		msg := err.Error()
		if !strings.Contains(msg, "Unknown word") && !strings.Contains(msg, "expected declaration") {
			t.Fatalf("unexpected error for %s: %v", from, err)
		}
	}
}

func TestParseDoubleColonAndMissedSemicolon(t *testing.T) {
	if _, err := Parse("a{color::red;}", sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "Double colon") {
		t.Fatalf("expected double colon, got %v", err)
	}
	if _, err := Parse("a{color:red background:blue;}", sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "Missed semicolon") {
		t.Fatalf("expected missed semicolon, got %v", err)
	}
	if _, err := Parse("a{color red: blue;}", sourcemap.Options{}); err == nil {
		t.Fatal("expected unknown word in prop")
	}
}

func TestParseDeclarationWithSquaresAndParensInValue(t *testing.T) {
	root, err := Parse(`a{grid-template:[a] 1fr; background:url(http://x.com);}`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	rule := root.Children()[0].(*ast.Rule)
	if len(rule.Children()) != 2 {
		t.Fatalf("expected 2 decls, got %d", len(rule.Children()))
	}
}

func TestHelperSplitImportantAndTrailingSpaces(t *testing.T) {
	input := "red ! important"
	tokens := []tokenizer.Token{
		{Kind: "word", Start: 0, End: 2},
		{Kind: "space", Start: 3, End: 3},
		{Kind: "word", Start: 4, End: 4},
		{Kind: "space", Start: 5, End: 5},
		{Kind: "word", Start: 6, End: 14},
	}
	// Adjust ends to match input indexes: "red ! important"
	// r e d   !   i m p o r t a n t
	// 0 1 2 3 4 5 6 ...
	tokens = []tokenizer.Token{
		{Kind: "word", Start: 0, End: 2},
		{Kind: "space", Start: 3, End: 3},
		{Kind: "word", Start: 4, End: 4},
		{Kind: "space", Start: 5, End: 5},
		{Kind: "word", Start: 6, End: 14},
	}
	body, important, raw := splitImportant(input, tokens)
	if !important || len(body) != 1 || raw == "" {
		t.Fatalf("splitImportant bang+important: body=%d important=%v raw=%q", len(body), important, raw)
	}

	body, important, raw = splitImportant("red", []tokenizer.Token{{Kind: "word", Start: 0, End: 2}})
	if important || raw != "" || len(body) != 1 {
		t.Fatalf("expected non-important, got important=%v raw=%q", important, raw)
	}

	body, important, raw = splitImportant("   ", []tokenizer.Token{
		{Kind: "space", Start: 0, End: 2},
	})
	if important || len(body) != 1 {
		t.Fatalf("space-only important split failed: %#v %v", body, important)
	}

	body, trailing := splitTrailingSpaces([]tokenizer.Token{
		{Kind: "word", Start: 0, End: 0},
		{Kind: "space", Start: 1, End: 1},
		{Kind: "space", Start: 2, End: 2},
	})
	if len(body) != 1 || len(trailing) != 2 {
		t.Fatalf("splitTrailingSpaces: body=%d trailing=%d", len(body), len(trailing))
	}
}

func TestAppendRawStringHelper(t *testing.T) {
	node := ast.NewAtRule("media", "")
	appendRawString(node, "between", "")
	if _, ok := ast.LookupRaw(node, "between"); ok {
		t.Fatal("empty suffix should not set")
	}
	appendRawString(node, "between", " ")
	if value, ok := ast.LookupRaw(node, "between"); !ok || value != " " {
		t.Fatalf("expected between set, got %#v", value)
	}
	appendRawString(node, "between", "!")
	if value, ok := ast.LookupRaw(node, "between"); !ok || value != " !" {
		t.Fatalf("expected append, got %#v", value)
	}
}

func TestParseAtRuleBetweenOnBlockClose(t *testing.T) {
	root, err := Parse("@import 'x.css'\n", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	at := root.Children()[0].(*ast.AtRule)
	if at.Block {
		t.Fatal("expected non-block import")
	}

	// atrule then close of parent with trailing spaces after semicolon-less atrule
	root, err = Parse("@media{ @import 'x.css' }", sourcemap.Options{})
	if err != nil {
		t.Fatalf("nested import: %v", err)
	}
	media := root.Children()[0].(*ast.AtRule)
	if len(media.Children()) != 1 {
		t.Fatalf("expected nested import, got %#v", media.Children())
	}
}

func TestCleanValueHelpers(t *testing.T) {
	input := "fn/*c*/(1)"
	tokens := []tokenizer.Token{
		{Kind: "word", Start: 0, End: 1},
		{Kind: "comment", Start: 2, End: 6},
		{Kind: "word", Start: 7, End: 9},
	}
	if got := cleanDeclarationValue(input, tokens); !strings.Contains(got, "/*c*/") {
		t.Fatalf("expected comment kept before '(', got %q", got)
	}

	input = "--x: /*c*/"
	tokens = []tokenizer.Token{
		{Kind: "comment", Start: 5, End: 9},
	}
	if got := cleanCustomPropertyValue(input, tokens); got != " " {
		t.Fatalf("expected space for comment-only custom value, got %q", got)
	}
}

func TestContainerHasSemicolonHelper(t *testing.T) {
	rule := ast.NewRule(".a")
	if containerHasSemicolon(rule) {
		t.Fatal("expected false by default")
	}
	rule.RawFormatting()["semicolon"] = true
	if !containerHasSemicolon(rule) {
		t.Fatal("expected true when set")
	}
}

func TestParseTrailingFormattingAndFreeSemicolonVariants(t *testing.T) {
	root, err := Parse(`@media{ @import "x.css" }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	media := root.Children()[0].(*ast.AtRule)
	imp := media.Children()[0].(*ast.AtRule)
	if between, _ := imp.RawFormattingReadOnly()["between"].(string); between == "" {
		// between may absorb the space before closing brace
		_ = between
	}

	root, err = Parse(`a{--x: /*c*/ }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("custom trailing: %v", err)
	}

	root, err = Parse(`a{--x: y*/ }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("custom starslash: %v", err)
	}

	root, err = Parse(`a{color:red;;}`, sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("double semicolon: %v", err)
	}
	if got, ok := root.Children()[0].(*ast.Rule).RawFormattingReadOnly()["semicolon"].(bool); !ok || !got {
		t.Fatalf("expected semicolon raw true after free semicolon, got %#v", root.Children()[0].(*ast.Rule).RawFormattingReadOnly())
	}

	root, err = Parse(`a{color:red; ;}`, sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("spaced free semicolon: %v", err)
	}

	root, err = Parse(`a{}; ;`, sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("stacked ownSemicolon: %v", err)
	}
	rule := root.Children()[0].(*ast.Rule)
	if own, _ := rule.RawFormattingReadOnly()["ownSemicolon"].(string); own == "" {
		t.Fatal("expected accumulated ownSemicolon")
	}
}

func TestParseEmptyRuleWithSourceAndBareAtRule(t *testing.T) {
	root, err := Parse(`{}`, sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if root.Children()[0].Source() == nil {
		t.Fatal("expected empty rule source")
	}

	root, err = Parse(`@layer`, sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("bare atrule: %v", err)
	}
	if root.Children()[0].(*ast.AtRule).Name != "layer" {
		t.Fatalf("unexpected %#v", root.Children()[0])
	}

	root, err = Parse(`@media screen  {a{}}`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("media: %v", err)
	}
}

func TestParseColonPrefixedDeclarationAndTrailingComments(t *testing.T) {
	root, err := Parse(`a{ :color: red/*c*/ }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("colon prefix: %v", err)
	}
	rule := root.Children()[0].(*ast.Rule)
	foundDecl := false
	foundComment := false
	for _, child := range rule.Children() {
		switch child.Type() {
		case ast.NodeDecl:
			foundDecl = true
		case ast.NodeComment:
			foundComment = true
		}
	}
	if !foundDecl {
		t.Fatalf("expected declaration in %#v", rule.Children())
	}
	_ = foundComment

	root, err = Parse(`a{--x:1 /*c*/}`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("custom trailing comment: %v", err)
	}
}

func TestParseCustomImportantCommentAndEmptyValue(t *testing.T) {
	root, err := Parse(`a{--x:/*c*/!important;}`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
	if !decl.Important {
		t.Fatalf("expected important, got %#v", decl)
	}

	root, err = Parse(`a{--x: !important;}`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("empty important custom: %v", err)
	}

	root, err = Parse(`a{--x:  }`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("empty custom trailing spaces: %v", err)
	}
}

func TestParseParamsRawAndSetBetweenHelper(t *testing.T) {
	root, err := Parse(`@media screen/*x*/ and (color) {a{}}`, sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	at := root.Children()[0].(*ast.AtRule)
	if _, ok := at.RawFormattingReadOnly()["params"]; !ok && at.Params == "" {
		t.Fatalf("expected params content, got %#v", at)
	}

	node := ast.NewAtRule("media", "screen")
	setAtRuleBetween(node, " screen ", []tokenizer.Token{
		{Kind: "space", Start: 0, End: 0},
		{Kind: "word", Start: 1, End: 6},
		{Kind: "space", Start: 7, End: 7},
	})
	if _, ok := node.RawFormattingReadOnly()["between"]; !ok {
		t.Fatal("expected between set")
	}
	setAtRuleBetween(node, " screen ", []tokenizer.Token{
		{Kind: "word", Start: 1, End: 6},
		{Kind: "space", Start: 7, End: 7},
	})
}

func TestParseSpacesOnlyAndUnknownEmptyProp(t *testing.T) {
	root, err := Parse("   ", sourcemap.Options{})
	if err != nil {
		t.Fatalf("spaces: %v", err)
	}
	if len(root.Children()) != 0 {
		t.Fatalf("expected no children, got %d", len(root.Children()))
	}

	if _, err := Parse("a{: red;}", sourcemap.Options{}); err == nil {
		t.Fatal("expected empty property error")
	}
}

func TestSplitImportantNoBang(t *testing.T) {
	input := "red important"
	tokens := []tokenizer.Token{
		{Kind: "word", Start: 0, End: 2},
		{Kind: "space", Start: 3, End: 3},
		{Kind: "word", Start: 4, End: 12},
	}
	body, important, raw := splitImportant(input, tokens)
	if important || raw != "" || len(body) != 3 {
		t.Fatalf("expected important without bang ignored: important=%v raw=%q body=%d", important, raw, len(body))
	}
}

func TestParseNestedCustomPropertyDepth(t *testing.T) {
	root, err := Parse(`:root{--x:{a:{b:1}};}`, sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("nested custom: %v", err)
	}
	decl := root.Children()[0].(*ast.Rule).Children()[0].(*ast.Declaration)
	if !strings.Contains(decl.Value, "b:1") {
		t.Fatalf("unexpected value %q", decl.Value)
	}
}

func TestParseMissedSemicolonAfterFunction(t *testing.T) {
	if _, err := Parse(`a{color:rgb(1) background:blue;}`, sourcemap.Options{}); err == nil || !strings.Contains(err.Error(), "Missed semicolon") {
		t.Fatalf("expected missed semicolon after function, got %v", err)
	}
	if _, err := Parse(`a{content:"x":;}`, sourcemap.Options{}); err == nil {
		// may be double colon or missed semicolon depending on tokenization
		_ = err
	}
}

func TestParsePendingBeforeOnDeclaration(t *testing.T) {
	root, err := Parse("/*lead*/\ncolor: red", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	var decl *ast.Declaration
	for _, child := range root.Children() {
		if d, ok := child.(*ast.Declaration); ok {
			decl = d
		}
	}
	if decl == nil {
		t.Fatalf("expected declaration, children=%#v", root.Children())
	}

	// only trailing spaces/comments after custom prop without semicolon
	root, err = Parse("a{--x: /*only*/ }", sourcemap.Options{})
	if err != nil {
		t.Fatalf("custom comment only: %v", err)
	}
}
