package stringifier

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-sourcemap/sourcemap"
	"postcss-go/internal/ast"
	"postcss-go/internal/parser"
	"postcss-go/internal/source"
)

func TestStringifyComplexTree(t *testing.T) {
	root := ast.NewRoot()
	root.Append(ast.NewComment("top"))
	rule := ast.NewRule(".a")
	decl := ast.NewDeclaration("color", "red")
	decl.Important = true
	rule.Append(decl)
	atRule := ast.NewAtRule("media", "screen")
	atRule.Block = true
	atRule.Append(rule)
	root.Append(atRule)

	got := Stringify(root)
	want := `/* top */
@media screen {
    .a {
        color: red !important;
    }
}`
	if got != want {
		t.Fatalf("unexpected stringified css\nwant:\n%s\n\ngot:\n%s", want, got)
	}
}

func TestStringifyAtRuleWithoutBlock(t *testing.T) {
	node := ast.NewAtRule("import", `"a.css"`)
	node.RawFormatting()["semicolon"] = true
	if got := Stringify(node); got != `@import "a.css";` {
		t.Fatalf("unexpected at-rule string: %q", got)
	}
}

func TestParseStringifyPreservesPostCSSRaws(t *testing.T) {
	css := "/*x*/\n.a{color:red!important;\n  background :  blue  ;}\n"
	root, err := parser.Parse(css, source.Options{From: "input.css"})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if got := Stringify(root); got != css {
		t.Fatalf("raw formatting was not preserved\nwant: %q\ngot:  %q", css, got)
	}
}

func TestParseStringifyPreservesRawSpacingAroundBlocksAndAtRules(t *testing.T) {
	tests := []struct {
		name string
		css  string
	}{
		{name: "rule opening spacing", css: ".a  { color: red }"},
		{name: "at rule opening spacing", css: "@media screen  { color: red }"},
		{name: "at rule parameter comment", css: "@media /*c*/ screen { color: red; }"},
		{name: "at rule semicolon spacing", css: "@import x ;"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root, err := parser.Parse(test.css, source.Options{})
			if err != nil {
				t.Fatalf("parse failed: %v", err)
			}
			if got := Stringify(root); got != test.css {
				t.Fatalf("raw formatting was not preserved\nwant: %q\ngot:  %q", test.css, got)
			}
		})
	}
}

func TestStringifyInfersBeforeFromFormattedSibling(t *testing.T) {
	root, err := parser.Parse(".a {\n  color: red;\n}\n.b {\n  color: blue;\n}", source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	root.Append(ast.NewRule(".c"))

	want := ".a {\n  color: red;\n}\n.b {\n  color: blue;\n}\n.c {}"
	if got := Stringify(root); got != want {
		t.Fatalf("inferred raw spacing was incorrect\nwant: %q\ngot:  %q", want, got)
	}
}

func TestParsePreservesCommentsAsASTNodes(t *testing.T) {
	tests := []struct {
		name string
		css  string
	}{
		{name: "comment before declaration", css: "a{ /*x*/ color:red }"},
		{name: "comment before closing brace", css: "a{/*x*/}"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root, err := parser.Parse(test.css, source.Options{})
			if err != nil {
				t.Fatalf("parse failed: %v", err)
			}
			rule, ok := root.First().(*ast.Rule)
			if !ok {
				t.Fatalf("expected rule, got %T", root.First())
			}
			if test.name == "comment before closing brace" {
				if len(rule.Children()) != 1 {
					t.Fatalf("expected one child, got %d", len(rule.Children()))
				}
				if _, ok := rule.First().(*ast.Comment); !ok {
					t.Fatalf("expected comment node, got %T", rule.First())
				}
			}
			if test.name == "comment before declaration" {
				if len(rule.Children()) != 2 {
					t.Fatalf("expected comment+decl, got %d", len(rule.Children()))
				}
				comment, ok := rule.First().(*ast.Comment)
				if !ok || comment.Text != "x" {
					t.Fatalf("expected leading comment, got %#v", rule.First())
				}
				decl, ok := rule.Children()[1].(*ast.Declaration)
				if !ok || decl.Prop != "color" {
					t.Fatalf("expected declaration prop color, got %#v", rule.Children()[1])
				}
				if got := decl.RawFormatting()["before"]; got != " " {
					t.Fatalf("expected decl before space, got %#v", got)
				}
			}
			if got := Stringify(root); got != test.css {
				t.Fatalf("raw formatting was not preserved\nwant: %q\ngot:  %q", test.css, got)
			}
		})
	}
}

func TestParseStringifyPreservesAtRuleOnlyCommentSpacing(t *testing.T) {
	css := "@media /*x*/ {a{}}"
	root, err := parser.Parse(css, source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if got := Stringify(root); got != css {
		t.Fatalf("raw formatting was not preserved\nwant: %q\ngot:  %q", css, got)
	}
}

func TestParseAtRuleCommentParamsExposeSemanticAndRawValues(t *testing.T) {
	root, err := parser.Parse("@media /*c*/ screen {}", source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	node := root.First().(*ast.AtRule)
	if node.Params != "screen" {
		t.Fatalf("expected semantic params screen, got %q", node.Params)
	}
	if got := node.RawFormatting()["afterName"]; got != " /*c*/ " {
		t.Fatalf("expected afterName %q, got %#v", " /*c*/ ", got)
	}
	if _, ok := node.RawFormatting()["params"]; ok {
		t.Fatalf("params raws should be absent when comments live in afterName, got %#v", node.RawFormatting()["params"])
	}
	if got := Stringify(root); got != "@media /*c*/ screen {}" {
		t.Fatalf("raw params were not preserved, got %q", got)
	}
}

func TestParseStringifyPreservesTrailingAtRuleComments(t *testing.T) {
	for _, css := range []string{
		"@media screen /*c*/ {a{}}",
		"@import screen /*c*/ ;",
	} {
		root, err := parser.Parse(css, source.Options{})
		if err != nil {
			t.Fatalf("parse %q failed: %v", css, err)
		}
		if got := Stringify(root); got != css {
			t.Fatalf("at-rule comment was duplicated\nwant: %q\ngot:  %q", css, got)
		}
	}
}

func TestParseStringifyPreservesDeclarationValueComments(t *testing.T) {
	css := "a{color: /*c*/ red}"
	root, err := parser.Parse(css, source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if got := Stringify(root); got != css {
		t.Fatalf("declaration comment was duplicated\nwant: %q\ngot:  %q", css, got)
	}
}

func TestParseStringifyPreservesColonAdjacentCommentsInBetween(t *testing.T) {
	css := "a{color:/*c*/red}"
	root, err := parser.Parse(css, source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	decl := root.First().(*ast.Rule).First().(*ast.Declaration)
	if decl.Value != "red" {
		t.Fatalf("expected semantic value red, got %q", decl.Value)
	}
	if got := decl.RawFormatting()["between"]; got != ":/*c*/" {
		t.Fatalf("expected between :/*c*/, got %#v", got)
	}
	if got := Stringify(root); got != css {
		t.Fatalf("colon comment round-trip failed\nwant: %q\ngot:  %q", css, got)
	}
}

func TestParseStringifyPreservesPropSideColonComments(t *testing.T) {
	css := "a{color/**/:red}"
	root, err := parser.Parse(css, source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	decl := root.First().(*ast.Rule).First().(*ast.Declaration)
	if decl.Prop != "color" {
		t.Fatalf("expected prop color, got %q", decl.Prop)
	}
	if got := decl.RawFormatting()["between"]; got != "/**/:" {
		t.Fatalf("expected between /**/:, got %#v", got)
	}
	if got := Stringify(root); got != css {
		t.Fatalf("prop-side colon comment round-trip failed\nwant: %q\ngot:  %q", css, got)
	}
}

func TestParsePreservesOwnSemicolon(t *testing.T) {
	css := ".a {} ;"
	root, err := parser.Parse(css, source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	rule := root.First().(*ast.Rule)
	if got := rule.RawFormatting()["ownSemicolon"]; got != " ;" {
		t.Fatalf("expected ownSemicolon %q, got %#v", " ;", got)
	}
	if got := Stringify(root); got != css {
		t.Fatalf("ownSemicolon round-trip failed\nwant: %q\ngot:  %q", css, got)
	}
}

func TestParseTrailingValueCommentBecomesSiblingNode(t *testing.T) {
	css := "a{color:red/*c*/}"
	root, err := parser.Parse(css, source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	rule := root.First().(*ast.Rule)
	if len(rule.Children()) != 2 {
		t.Fatalf("expected decl+comment, got %d children", len(rule.Children()))
	}
	decl := rule.First().(*ast.Declaration)
	if decl.Value != "red" {
		t.Fatalf("expected value red, got %q", decl.Value)
	}
	if _, ok := rule.Children()[1].(*ast.Comment); !ok {
		t.Fatalf("expected comment sibling, got %T", rule.Children()[1])
	}
	if got := Stringify(root); got != css {
		t.Fatalf("trailing value comment round-trip failed\nwant: %q\ngot:  %q", css, got)
	}
}

func TestParseLeadingBlockCommentBecomesSiblingNode(t *testing.T) {
	css := "a{\n  /*c*/\n  color:red\n}"
	root, err := parser.Parse(css, source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	rule := root.First().(*ast.Rule)
	if len(rule.Children()) != 2 {
		t.Fatalf("expected comment+decl, got %d", len(rule.Children()))
	}
	if _, ok := rule.First().(*ast.Comment); !ok {
		t.Fatalf("expected comment first, got %T", rule.First())
	}
	rule.Append(ast.NewDeclaration("width", "1px"))
	want := "a{\n  /*c*/\n  color:red;\n  width:1px\n}"
	if got := Stringify(root); got != want {
		t.Fatalf("inferred before should not copy comment\nwant: %q\ngot:  %q", want, got)
	}
}

func TestParseImportantWithInternalSpaces(t *testing.T) {
	css := "a{color:red ! important}"
	root, err := parser.Parse(css, source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	decl := root.First().(*ast.Rule).First().(*ast.Declaration)
	if !decl.Important {
		t.Fatal("expected important=true")
	}
	if decl.Value != "red" {
		t.Fatalf("expected value red, got %q", decl.Value)
	}
	if got := decl.RawFormatting()["important"]; got != " ! important" {
		t.Fatalf("expected important raw %q, got %#v", " ! important", got)
	}
	if got := Stringify(root); got != css {
		t.Fatalf("important spacing round-trip failed\nwant: %q\ngot:  %q", css, got)
	}
}

func TestStringifyAppendedAtRuleInfersNewlineWithoutSemicolon(t *testing.T) {
	root, err := parser.Parse(".a {\n  color: red;\n}", source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	root.Append(ast.NewAtRule("media", "print"))
	want := ".a {\n  color: red;\n}\n@media print"
	if got := Stringify(root); got != want {
		t.Fatalf("appended at-rule formatting incorrect\nwant: %q\ngot:  %q", want, got)
	}
}

func TestParseStringifyPreservesImportantTrailingSpacing(t *testing.T) {
	css := "a{color : blue !important ;}"
	root, err := parser.Parse(css, source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if got := Stringify(root); got != css {
		t.Fatalf("important spacing was not preserved\nwant: %q\ngot:  %q", css, got)
	}
}

func TestParseStringifyPreservesCustomPropertyComments(t *testing.T) {
	css := "a{--x: /*c*/ foo  ;}"
	root, err := parser.Parse(css, source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if got := Stringify(root); got != css {
		t.Fatalf("custom property comments were not preserved\nwant: %q\ngot:  %q", css, got)
	}
}

func TestMappedStringifyPreservesOwnSemicolon(t *testing.T) {
	root := ast.NewRoot()
	rule := ast.NewRule(".a")
	rule.RawFormatting()["before"] = ""
	rule.RawFormatting()["between"] = " "
	rule.RawFormatting()["after"] = ""
	rule.RawFormatting()["ownSemicolon"] = " ;"
	root.Append(rule)

	got := Stringify(root)
	if got != ".a {} ;" {
		t.Fatalf("unmapped ownSemicolon failed\nwant: %q\ngot:  %q", ".a {} ;", got)
	}
	mapped, err := StringifyWithSourceMap(root, SourceMapOptions{From: "input.css", To: "out.css"})
	if err != nil {
		t.Fatalf("mapped stringify failed: %v", err)
	}
	if mapped.CSS != ".a {} ;" {
		t.Fatalf("mapped ownSemicolon failed\nwant: %q\ngot:  %q", ".a {} ;", mapped.CSS)
	}
}

func TestMappedStringifyMatchesCompressedFormatting(t *testing.T) {
	root, err := parser.Parse("a{color:red;width:1px}", source.Options{From: "input.css"})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	result, err := StringifyWithSourceMap(root, SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("stringify with source map failed: %v", err)
	}
	if want := Stringify(root); result.CSS != want {
		t.Fatalf("mapped stringification changed formatting\nwant: %q\ngot:  %q", want, result.CSS)
	}
}

func TestMappedStringifyUsesFourSpaceDefaultIndent(t *testing.T) {
	root := ast.NewRoot()
	rule := ast.NewRule(".a")
	rule.Append(ast.NewDeclaration("color", "red"))
	root.Append(rule)
	result, err := StringifyWithSourceMap(root, SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("stringify with source map failed: %v", err)
	}
	want := ".a {\n    color: red;\n}"
	if result.CSS != want {
		t.Fatalf("unexpected mapped default indentation\nwant: %q\ngot:  %q", want, result.CSS)
	}
}

func TestStringifyDoesNotInitializeNilRaws(t *testing.T) {
	node := ast.NewDeclaration("color", "red")
	if node.Raws != nil {
		t.Fatal("expected nil raws before stringify")
	}
	_ = Stringify(node)
	if node.Raws != nil {
		t.Fatal("stringify should not mutate nil raws into an empty map")
	}
}

func TestStringifyUsesExplicitRootIndentInMappedAndUnmappedOutput(t *testing.T) {
	root := ast.NewRoot()
	root.RawFormatting()["indent"] = "\t"
	rule := ast.NewRule(".a")
	rule.Append(ast.NewDeclaration("color", "red"))
	root.Append(rule)

	want := ".a {\n\tcolor: red;\n}"
	if got := Stringify(root); got != want {
		t.Fatalf("unexpected explicit-indent output\nwant: %q\ngot:  %q", want, got)
	}
	result, err := StringifyWithSourceMap(root, SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("stringify with source map failed: %v", err)
	}
	if result.CSS != want {
		t.Fatalf("mapped output ignored explicit indent\nwant: %q\ngot:  %q", want, result.CSS)
	}
}

func TestStringifyInfersDeclarationBetweenFromSibling(t *testing.T) {
	root, err := parser.Parse("a{color:red}", source.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	rule := root.First().(*ast.Rule)
	rule.Append(ast.NewDeclaration("width", "1px"))
	if got := Stringify(root); got != "a{color:red;width:1px}" {
		t.Fatalf("did not infer declaration formatting\ngot: %q", got)
	}
}

func TestStringifyWithSourceMap(t *testing.T) {
	input, err := source.NewInput(".a { color: red; }", source.Options{From: "input.css"})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	root := ast.NewRoot()
	root.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(input.CSS))))
	rule := ast.NewRule(".a")
	rule.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(input.CSS))))
	decl := ast.NewDeclaration("color", "red")
	decl.SetSource(input.Location(input.FromOffset(5), input.FromOffset(15)))
	rule.Append(decl)
	root.Append(rule)

	result, err := StringifyWithSourceMap(root, SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("stringify with source map failed: %v", err)
	}
	if !strings.Contains(result.CSS, "color: red;") {
		t.Fatalf("unexpected css: %q", result.CSS)
	}

	var payload struct {
		Version        int      `json:"version"`
		File           string   `json:"file"`
		Sources        []string `json:"sources"`
		SourcesContent []string `json:"sourcesContent"`
		Mappings       string   `json:"mappings"`
	}
	if err := json.Unmarshal([]byte(result.Map), &payload); err != nil {
		t.Fatalf("invalid source map json: %v\n%s", err, result.Map)
	}
	if payload.Version != 3 || payload.File != "out.css" {
		t.Fatalf("unexpected source map metadata: %#v", payload)
	}
	if len(payload.Sources) != 1 || !strings.HasSuffix(payload.Sources[0], "input.css") {
		t.Fatalf("unexpected source map sources: %#v", payload.Sources)
	}
	if payload.Mappings == "" {
		t.Fatal("expected mappings to be populated")
	}
}

func TestStringifySourceMapNodeBoundaries(t *testing.T) {
	root, err := parser.Parse(".a { color: red; }", source.Options{From: "input.css"})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	result, err := StringifyWithSourceMap(root, SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("stringify with source map failed: %v", err)
	}
	consumer, err := sourcemap.Parse("out.css.map", []byte(result.Map))
	if err != nil {
		t.Fatalf("parse source map: %v", err)
	}

	assertMapping := func(generatedLine, generatedColumn, sourceLine, sourceColumn int) {
		t.Helper()
		file, _, line, column, ok := consumer.Source(generatedLine, generatedColumn)
		if !ok || file != "input.css" || line != sourceLine || column != sourceColumn {
			t.Fatalf("unexpected mapping at generated %d:%d: file=%q source=%d:%d ok=%v", generatedLine, generatedColumn, file, line, column, ok)
		}
	}

	assertMapping(1, 5, 1, 5)
	assertMapping(1, 12, 1, 12)
	assertMapping(1, 15, 1, 15)
	assertMapping(1, 18, 1, 2)
}

func TestStringifySourceMapNoSourceNodeBoundaries(t *testing.T) {
	root := ast.NewRoot()
	rule := ast.NewRule(".a")
	rule.Append(ast.NewDeclaration("color", "red"))
	root.Append(rule)
	result, err := StringifyWithSourceMap(root, SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("stringify with source map failed: %v", err)
	}
	consumer, err := sourcemap.Parse("out.css.map", []byte(result.Map))
	if err != nil {
		t.Fatalf("parse source map: %v", err)
	}
	for _, column := range []int{2, 12} {
		file, _, line, sourceColumn, ok := consumer.Source(2, column)
		if !ok || file != "<no source>" || line != 1 || sourceColumn != 0 {
			t.Fatalf("unexpected no-source mapping at generated 2:%d: file=%q source=%d:%d ok=%v", column, file, line, sourceColumn, ok)
		}
	}
}

func TestStringifySourceMapPathsAreRelativeToMapFile(t *testing.T) {
	tempDir := t.TempDir()
	inputFile := filepath.Join(tempDir, "src", "input.css")
	outputFile := filepath.Join(tempDir, "dist", "output.css")
	mapFile := filepath.Join(tempDir, "dist", "maps", "output.css.map")
	input, err := source.NewInput(".a {}", source.Options{From: inputFile})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	rule := ast.NewRule(".a")
	rule.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(input.CSS))))

	result, err := StringifyWithSourceMap(rule, SourceMapOptions{To: outputFile, MapFile: mapFile})
	if err != nil {
		t.Fatalf("stringify with source map failed: %v", err)
	}
	var payload struct {
		File    string   `json:"file"`
		Sources []string `json:"sources"`
	}
	if err := json.Unmarshal([]byte(result.Map), &payload); err != nil {
		t.Fatalf("invalid source map: %v", err)
	}
	if payload.File != "../output.css" {
		t.Fatalf("unexpected generated file path: %q", payload.File)
	}
	if len(payload.Sources) != 1 || payload.Sources[0] != "../../src/input.css" {
		t.Fatalf("unexpected relative source paths: %#v", payload.Sources)
	}
}

func TestSourceMapWriterUsesUTF16GeneratedColumns(t *testing.T) {
	writer := newSourceMapWriter()
	writer.writeString("🔥")
	writer.AddMapping(ast.NewDeclaration("color", "red"))
	encoded, err := writer.sourceMap(SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("generate source map: %v", err)
	}
	consumer, err := sourcemap.Parse("out.css.map", []byte(encoded))
	if err != nil {
		t.Fatalf("parse source map: %v", err)
	}
	if _, _, _, _, ok := consumer.Source(1, 1); ok {
		t.Fatal("mapping must not begin inside the emoji surrogate pair")
	}
	file, _, line, column, ok := consumer.Source(1, 2)
	if !ok || file != "<no source>" || line != 1 || column != 0 {
		t.Fatalf("unexpected UTF-16 generated mapping: file=%q line=%d column=%d ok=%v", file, line, column, ok)
	}
}

func TestStringifyEmptyTreeProducesConsumableSourceMap(t *testing.T) {
	result, err := StringifyWithSourceMap(ast.NewRoot(), SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("stringify empty tree: %v", err)
	}
	if result.CSS != "" {
		t.Fatalf("expected empty CSS, got %q", result.CSS)
	}
	consumer, err := sourcemap.Parse("out.css.map", []byte(result.Map))
	if err != nil {
		t.Fatalf("empty output map must be consumable: %v", err)
	}
	if file, _, line, column, ok := consumer.Source(1, 0); !ok ||
		file != "<no source>" || line != 1 || column != 0 {
		t.Fatalf("unexpected empty output mapping: file=%q line=%d column=%d ok=%v", file, line, column, ok)
	}
}

func TestSourceMapMetadataOptions(t *testing.T) {
	input, err := source.NewInput("a{}", source.Options{From: "/src/a.css"})
	if err != nil {
		t.Fatalf("new input: %v", err)
	}
	rule := ast.NewRule("a")
	rule.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(input.CSS))))

	includeContent := false
	result, err := StringifyWithSourceMap(rule, SourceMapOptions{
		From:           "input.css",
		SourceMapFrom:  "virtual.css",
		SourcesContent: &includeContent,
		Absolute:       true,
	})
	if err != nil {
		t.Fatalf("stringify source map: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(result.Map), &payload); err != nil {
		t.Fatalf("decode source map: %v", err)
	}
	if payload["file"] != "input.css" {
		t.Fatalf("expected from fallback for file, got %#v", payload["file"])
	}
	if _, ok := payload["sourcesContent"]; ok {
		t.Fatalf("sourcesContent must be omitted when disabled: %s", result.Map)
	}
	sources := payload["sources"].([]any)
	if sources[0] != "virtual.css" {
		t.Fatalf("source override must be preserved, got %#v", sources)
	}

	absoluteResult, err := StringifyWithSourceMap(rule, SourceMapOptions{
		To:       "/dist/out.css",
		Absolute: true,
	})
	if err != nil {
		t.Fatalf("stringify absolute sources: %v", err)
	}
	var absolutePayload struct {
		Sources []string `json:"sources"`
	}
	if err := json.Unmarshal([]byte(absoluteResult.Map), &absolutePayload); err != nil {
		t.Fatalf("decode absolute map: %v", err)
	}
	if len(absolutePayload.Sources) != 1 || absolutePayload.Sources[0] != "file:///src/a.css" {
		t.Fatalf("expected absolute file URL source, got %#v", absolutePayload.Sources)
	}

	urlResult, err := StringifyWithSourceMap(rule, SourceMapOptions{
		To:      "https://example.com/assets/out.css",
		MapFile: "https://example.com/maps/out.css.map",
	})
	if err != nil {
		t.Fatalf("stringify URL output: %v", err)
	}
	var urlPayload struct {
		File string `json:"file"`
	}
	if err := json.Unmarshal([]byte(urlResult.Map), &urlPayload); err != nil {
		t.Fatalf("decode URL map: %v", err)
	}
	if urlPayload.File != "https://example.com/assets/out.css" {
		t.Fatalf("absolute output URL must be preserved, got %q", urlPayload.File)
	}
}
