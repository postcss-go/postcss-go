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
	if got := Stringify(node); got != `@import "a.css";` {
		t.Fatalf("unexpected at-rule string: %q", got)
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

	assertMapping(2, 2, 1, 5)
	assertMapping(2, 9, 1, 12)
	assertMapping(2, 12, 1, 15)
	assertMapping(3, 0, 1, 2)
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
