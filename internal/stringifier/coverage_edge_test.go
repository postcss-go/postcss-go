package stringifier

import (
	"encoding/json"
	"runtime"
	"strings"
	"testing"

	"postcss-go/internal/ast"
	"postcss-go/internal/parser"
	"postcss-go/internal/sourcemap"
)

func TestStringifyWithBuilderCoversNodeKinds(t *testing.T) {
	doc := ast.NewDocument()
	rootA := ast.NewRoot()
	rootA.RawFormatting()["after"] = "\n"
	rule := ast.NewRule(".a")
	rule.RawFormatting()["between"] = " "
	rule.RawFormatting()["after"] = "\n"
	rule.RawFormatting()["ownSemicolon"] = ";"
	decl := ast.NewDeclaration("color", "red")
	decl.Important = true
	rule.Append(decl)
	rootA.Append(rule)

	rootB := ast.NewRoot()
	atBlock := ast.NewAtRule("media", "screen")
	atBlock.Block = true
	nested := ast.NewRule(".b")
	nested.Append(ast.NewDeclaration("width", "1px"))
	atBlock.Append(nested)
	atImport := ast.NewAtRule("import", `"x.css"`)
	atImport.RawFormatting()["semicolon"] = true
	rootB.Append(atBlock, atImport, ast.NewComment("hi"))
	doc.Append(rootA, rootB)

	parts := StringifyWithBuilder(doc)
	if len(parts) == 0 {
		t.Fatal("expected builder parts")
	}
	var joined strings.Builder
	for _, part := range parts {
		joined.WriteString(part.CSS)
	}
	css := joined.String()
	if !strings.Contains(css, ".a {") || !strings.Contains(css, "@media screen") {
		t.Fatalf("unexpected builder css: %q", css)
	}
	if !strings.Contains(css, `@import "x.css";`) || !strings.Contains(css, "/* hi */") {
		t.Fatalf("missing at-rule/comment in builder css: %q", css)
	}
}

func TestStringifyWithBuilderInfersBlockClose(t *testing.T) {
	root := ast.NewRoot()
	ruleA := ast.NewRule(".a")
	ruleA.RawFormatting()["after"] = "\n  "
	ruleA.Append(ast.NewDeclaration("color", "red"))
	ruleB := ast.NewRule(".b")
	ruleB.Append(ast.NewDeclaration("color", "blue"))
	root.Append(ruleA, ruleB)

	parts := StringifyWithBuilder(root)
	var css strings.Builder
	for _, part := range parts {
		css.WriteString(part.CSS)
	}
	if got := css.String(); !strings.Contains(got, ".b {") {
		t.Fatalf("expected inferred sibling after, got %q", got)
	}

	// Empty-child rule uses default close without after.
	lonely := ast.NewRoot()
	lonely.Append(ast.NewRule(".c"))
	parts = StringifyWithBuilder(lonely)
	css.Reset()
	for _, part := range parts {
		css.WriteString(part.CSS)
	}
	if got := css.String(); got != ".c {}" {
		t.Fatalf("empty rule builder: %q", got)
	}
}

func TestStringifyDocumentAndMappedDocument(t *testing.T) {
	doc := ast.NewDocument()
	root := ast.NewRoot()
	root.Append(ast.NewRule(".a"))
	doc.Append(root)
	doc.RawFormatting()["after"] = "\n"
	if got := Stringify(doc); !strings.Contains(got, ".a {}") {
		t.Fatalf("document stringify: %q", got)
	}
	result, err := StringifyWithSourceMap(doc, SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("mapped document: %v", err)
	}
	if !strings.Contains(result.CSS, ".a {}") {
		t.Fatalf("mapped document css: %q", result.CSS)
	}
}

func TestStringifyEscapesHTMLInCSS(t *testing.T) {
	rule := ast.NewRule("a</style><style><!--")
	if got := Stringify(rule); !strings.Contains(got, `\3c /style`) ||
		!strings.Contains(got, `\3c style`) ||
		!strings.Contains(got, `\3c !--`) {
		t.Fatalf("expected HTML escapes, got %q", got)
	}
}

func TestStringifyRawValueShapes(t *testing.T) {
	decl := ast.NewDeclaration("color", "red")
	decl.RawFormatting()["value"] = ast.RawValue{Raw: "RED /*x*/", Value: "red"}
	if got := Stringify(decl); got != "color: RED /*x*/" {
		t.Fatalf("RawValue: %q", got)
	}

	decl2 := ast.NewDeclaration("color", "blue")
	decl2.RawFormatting()["value"] = &ast.RawValue{Raw: "BLUE", Value: "blue"}
	if got := Stringify(decl2); got != "color: BLUE" {
		t.Fatalf("*RawValue: %q", got)
	}

	decl3 := ast.NewDeclaration("color", "green")
	decl3.RawFormatting()["value"] = map[string]string{"raw": "GREEN", "value": "green"}
	if got := Stringify(decl3); got != "color: GREEN" {
		t.Fatalf("map[string]string: %q", got)
	}

	decl4 := ast.NewDeclaration("color", "black")
	decl4.RawFormatting()["value"] = map[string]any{"raw": "BLACK", "value": "black"}
	if got := Stringify(decl4); got != "color: BLACK" {
		t.Fatalf("map[string]any: %q", got)
	}

	decl5 := ast.NewDeclaration("color", "x")
	decl5.RawFormatting()["value"] = 123
	if got := Stringify(decl5); got != "color: x" {
		t.Fatalf("non-string raw fallback: %q", got)
	}

	decl6 := ast.NewDeclaration("color", "y")
	decl6.RawFormatting()["between"] = true
	if got := Stringify(decl6); got != "color: y" {
		t.Fatalf("non-string between fallback: %q", got)
	}

	at := ast.NewAtRule("charset", "")
	if got := Stringify(at); got != "@charset" {
		t.Fatalf("empty params at-rule: %q", got)
	}
}

func TestStringifyNodeBeforeSpecialCases(t *testing.T) {
	root, err := parser.Parse("@keyframes x {\nfrom { color: red }\nto { color: blue }\n}", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	keyframes := root.First().(*ast.AtRule)
	from := keyframes.First().(*ast.Rule)
	// Drop before so nodeBefore hits the "from" selector shortcut.
	delete(from.RawFormatting(), "before")
	got := Stringify(root)
	if !strings.Contains(got, "from {") {
		t.Fatalf("keyframes from: %q", got)
	}

	// Manual keyframes child without source should skip leading newline.
	manual := ast.NewAtRule("keyframes", "y")
	manual.Block = true
	frame := ast.NewRule("from")
	frame.Append(ast.NewDeclaration("opacity", "0"))
	manual.Append(frame)
	if got := Stringify(manual); !strings.HasPrefix(got, "@keyframes y {from") {
		t.Fatalf("manual keyframes before: %q", got)
	}
}

func TestStringifyInfersBetweenAndIndentEdges(t *testing.T) {
	root, err := parser.Parse("a{\n  color:red\n}", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	rule := root.First().(*ast.Rule)
	// Empty between on new decl should fall back / infer from sibling.
	extra := ast.NewDeclaration("width", "1px")
	extra.RawFormatting()["between"] = ""
	rule.Append(extra)
	if got := Stringify(root); !strings.Contains(got, "width:1px") && !strings.Contains(got, "width: 1px") {
		t.Fatalf("empty between inference: %q", got)
	}

	// Comment-containing sibling between should collapse to ":".
	root2, err := parser.Parse("a{color:/*c*/red}", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	rule2 := root2.First().(*ast.Rule)
	rule2.Append(ast.NewDeclaration("width", "1px"))
	if got := Stringify(root2); !strings.Contains(got, "width:") {
		t.Fatalf("comment between inference: %q", got)
	}

	// Infer descendant between from nested sibling container.
	outer := ast.NewRoot()
	sample := ast.NewRule(".s")
	sampleDecl := ast.NewDeclaration("color", "red")
	sampleDecl.RawFormatting()["between"] = ": "
	sample.Append(sampleDecl)
	target := ast.NewRule(".t")
	target.Append(ast.NewDeclaration("width", "1px"))
	outer.Append(sample, target)
	if got := Stringify(outer); !strings.Contains(got, "width: 1px") && !strings.Contains(got, "width:1px") {
		t.Fatalf("descendant between: %q", got)
	}
}

func TestStringifyRawBoolAndStringFallbacks(t *testing.T) {
	at := ast.NewAtRule("import", "x")
	at.RawFormatting()["semicolon"] = "yes"
	root := ast.NewRoot()
	root.Append(at, ast.NewComment("c"))
	if got := Stringify(root); !strings.Contains(got, "@import x;") {
		// semicolon raw is non-bool so atRuleHasSemicolon uses sibling presence.
		t.Fatalf("semicolon via sibling: %q", got)
	}

	comment := ast.NewComment("z")
	comment.RawFormatting()["left"] = 1
	comment.RawFormatting()["right"] = true
	if got := Stringify(comment); got != "/* z */" {
		t.Fatalf("non-string comment paddings: %q", got)
	}

	rule := ast.NewRule(".a")
	rule.RawFormatting()["before"] = true
	root2 := ast.NewRoot()
	root2.Append(ast.NewRule(".b"), rule)
	_ = Stringify(root2) // rawBeforeDetected non-string path
}

func TestMappedStringifyAtRulesAndPreserveAnnotation(t *testing.T) {
	root := ast.NewRoot()
	atImport := ast.NewAtRule("import", `"a.css"`)
	atImport.RawFormatting()["semicolon"] = true
	atBlock := ast.NewAtRule("media", "all")
	atBlock.Block = true
	atBlock.Append(ast.NewRule(".a"))
	annotation := ast.NewComment("# sourceMappingURL=x.map")
	keep := ast.NewComment("# keep")
	root.Append(atImport, atBlock, keep, annotation)

	stripped, err := StringifyWithSourceMap(root, SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("mapped: %v", err)
	}
	if strings.Contains(stripped.CSS, "sourceMappingURL") {
		t.Fatalf("annotation should be stripped by default: %q", stripped.CSS)
	}
	if !strings.Contains(stripped.CSS, "/*# keep */") && !strings.Contains(stripped.CSS, "keep") {
		t.Fatalf("non-annotation comment lost: %q", stripped.CSS)
	}

	preserved, err := StringifyWithSourceMap(root, SourceMapOptions{To: "out.css", PreserveAnnotation: true})
	if err != nil {
		t.Fatalf("preserve: %v", err)
	}
	if !strings.Contains(preserved.CSS, "sourceMappingURL=x.map") {
		t.Fatalf("annotation should be preserved: %q", preserved.CSS)
	}
}

func TestMappedStringifyDeclarationValuePositionEdges(t *testing.T) {
	input, err := sourcemap.NewInput("color red", sourcemap.Options{From: "in.css", TrackSource: true})
	if err != nil {
		t.Fatalf("input: %v", err)
	}
	decl := ast.NewDeclaration("color", "red")
	// No colon in range -> start fallback.
	decl.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(input.CSS))))
	root := ast.NewRoot()
	root.Append(decl)
	if _, err := StringifyWithSourceMap(root, SourceMapOptions{To: "out.css"}); err != nil {
		t.Fatalf("no-colon map: %v", err)
	}

	// Inverted offsets.
	decl2 := ast.NewDeclaration("width", "1px")
	start := input.FromOffset(5)
	end := input.FromOffset(1)
	decl2.SetSource(&sourcemap.Location{Input: input, Start: start, End: end})
	root2 := ast.NewRoot()
	root2.Append(decl2)
	if _, err := StringifyWithSourceMap(root2, SourceMapOptions{To: "out.css"}); err != nil {
		t.Fatalf("inverted offsets: %v", err)
	}
}

func TestNodeBeforeDocumentAndIndentInference(t *testing.T) {
	child := ast.NewRoot()
	child.RawFormatting()["before"] = "\n\n"
	if got := nodeBeforeDocument(child, 0, 0); got != "\n\n" {
		t.Fatalf("document before raw: %q", got)
	}
	if got := nodeBeforeDocument(ast.NewRoot(), 0, 1); got != "" {
		t.Fatalf("document before default: %q", got)
	}

	parent := ast.NewRule(".p")
	parent.RawFormatting()["before"] = "\n  "
	childDecl := ast.NewDeclaration("color", "red")
	parent.Append(childDecl)
	if indent := inferredContainerIndent(parent); indent != "  " {
		t.Fatalf("container indent from before: %q", indent)
	}

	root := ast.NewRoot()
	rule := ast.NewRule(".a")
	rule.RawFormatting()["before"] = "\n\t"
	root.Append(rule)
	if indent := inferredIndent(root); indent != "\t" {
		t.Fatalf("inferred indent: %q", indent)
	}

	// Space-only before without newline on parent child.
	box := ast.NewRule(".box")
	inner := ast.NewDeclaration("x", "1")
	inner.RawFormatting()["before"] = "  "
	box.Append(inner)
	if indent := inferredContainerIndent(box); indent != "  " {
		t.Fatalf("space indent: %q", indent)
	}
}

func TestClearSourceMapAnnotationsEdgeCases(t *testing.T) {
	if got := ClearSourceMapAnnotations("a{} /*# unfinished"); got != "a{} /*# unfinished" {
		t.Fatalf("unclosed annotation: %q", got)
	}
	if got := ClearSourceMapAnnotations(""); got != "" {
		t.Fatalf("empty: %q", got)
	}
	if got := SourceMapEOL("a{\n}"); got != "\n" {
		t.Fatalf("lf eol: %q", got)
	}
}

func TestNoWorkWithSourceMapEdges(t *testing.T) {
	prev := `{"version":3,"sources":["a.css"],"names":null,"mappings":"AAAA","file":"old.css","sourcesContent":["a{}"]}`
	include := false
	result, err := NoWorkWithSourceMap("a{}", prev, SourceMapOptions{
		To:             "out.css",
		SourcesContent: &include,
	})
	if err != nil {
		t.Fatalf("previous map: %v", err)
	}
	var payload noWorkMapPayload
	if err := json.Unmarshal([]byte(result.Map), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.SourcesContent != nil {
		t.Fatalf("sourcesContent should be cleared: %#v", payload.SourcesContent)
	}
	if payload.Names == nil {
		t.Fatal("names should be normalized to empty slice")
	}

	if _, err := NoWorkWithSourceMap("a{}", "{bad", SourceMapOptions{}); err == nil {
		t.Fatal("expected previous map parse error")
	}

	result, err = NoWorkWithSourceMap("body{}", "", SourceMapOptions{})
	if err != nil {
		t.Fatalf("defaults: %v", err)
	}
	if err := json.Unmarshal([]byte(result.Map), &payload); err != nil {
		t.Fatalf("decode defaults: %v", err)
	}
	if payload.File != "to.css" && !strings.HasSuffix(payload.File, "to.css") {
		t.Fatalf("default file: %#v", payload.File)
	}
	if len(payload.Sources) != 1 || payload.Sources[0] != "<no source>" {
		t.Fatalf("default source: %#v", payload.Sources)
	}

	result, err = NoWorkWithSourceMap(
		"x{}\n/*# sourceMappingURL=keep.map */",
		"",
		SourceMapOptions{From: "in.css", PreserveAnnotation: true},
	)
	if err != nil {
		t.Fatalf("preserve annotation: %v", err)
	}
	if !strings.Contains(result.CSS, "sourceMappingURL=keep.map") {
		t.Fatalf("annotation should remain: %q", result.CSS)
	}
}

func TestSourceMapPathHelpers(t *testing.T) {
	if got := fileURL("/tmp/a.css"); !strings.HasPrefix(got, "file:") {
		t.Fatalf("absolute fileURL: %q", got)
	}
	rel := fileURL("relative.css")
	if !strings.HasPrefix(rel, "file:") {
		t.Fatalf("relative fileURL: %q", rel)
	}

	if got := relativePath("/abs/maps", "rel.css"); !strings.Contains(got, "rel.css") {
		t.Fatalf("abs base relative: %q", got)
	}
	if got := relativePath("maps", "/tmp/out.css"); got == "" {
		t.Fatal("abs target relative empty")
	}

	// URI map directory with non-URI output should go through EscapedPath.
	result, err := StringifyWithSourceMap(ast.NewRule(".a"), SourceMapOptions{
		To:      "out.css",
		MapFile: "https://cdn.example/maps/out.css.map",
	})
	if err != nil {
		t.Fatalf("uri mapdir: %v", err)
	}
	var payload struct {
		File string `json:"file"`
	}
	if err := json.Unmarshal([]byte(result.Map), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.File == "" {
		t.Fatal("expected file in uri map")
	}

	// Empty From/To falls back to to.css in sourceMap().
	result, err = StringifyWithSourceMap(ast.NewRoot(), SourceMapOptions{})
	if err != nil {
		t.Fatalf("empty opts: %v", err)
	}
	if err := json.Unmarshal([]byte(result.Map), &payload); err != nil {
		t.Fatalf("decode empty: %v", err)
	}
	if payload.File != "to.css" {
		t.Fatalf("fallback file: %q", payload.File)
	}

}

func TestRawStringDetectedInfersFromSibling(t *testing.T) {
	root, err := parser.Parse("/* a */\n/* b */", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	second := root.Children()[1].(*ast.Comment)
	delete(second.RawFormatting(), "left")
	delete(second.RawFormatting(), "right")
	if got := Stringify(root); !strings.Contains(got, "/* b */") {
		t.Fatalf("sibling comment paddings: %q", got)
	}
}

func TestWriteMappedChildrenSkipsAnnotation(t *testing.T) {
	root := ast.NewRoot()
	root.Append(ast.NewRule(".a"), ast.NewComment("# sourceMappingURL=z.map"))
	result, err := StringifyWithSourceMap(root, SourceMapOptions{To: "o.css"})
	if err != nil {
		t.Fatalf("map: %v", err)
	}
	if strings.Contains(result.CSS, "sourceMappingURL") {
		t.Fatalf("annotation leaked: %q", result.CSS)
	}

	// Direct annotation root hits writeMappedNode's skip branch.
	result, err = StringifyWithSourceMap(ast.NewComment("# sourceMappingURL=alone.map"), SourceMapOptions{To: "o.css"})
	if err != nil {
		t.Fatalf("direct annotation: %v", err)
	}
	if strings.Contains(result.CSS, "sourceMappingURL") {
		t.Fatalf("direct annotation leaked: %q", result.CSS)
	}
}

func TestAtRuleHasSemicolonFromParentRaw(t *testing.T) {
	root := ast.NewRoot()
	root.RawFormatting()["semicolon"] = true
	at := ast.NewAtRule("import", "x")
	root.Append(at)
	if got := Stringify(root); got != "@import x;" {
		t.Fatalf("parent semicolon: %q", got)
	}
}

func TestStringifyBuilderAtRuleWithAfterAndInferredClose(t *testing.T) {
	root := ast.NewRoot()
	first := ast.NewAtRule("media", "a")
	first.Block = true
	first.RawFormatting()["after"] = "\n"
	first.Append(ast.NewRule(".a"))
	second := ast.NewAtRule("media", "b")
	second.Block = true
	second.Append(ast.NewRule(".b"))
	root.Append(first, second)

	parts := StringifyWithBuilder(root)
	var css strings.Builder
	for _, p := range parts {
		css.WriteString(p.CSS)
	}
	if got := css.String(); !strings.Contains(got, "@media b") {
		t.Fatalf("builder at-rule: %q", got)
	}

	// Declaration semicolon in builder when followed by sibling.
	rule := ast.NewRule(".x")
	rule.Append(ast.NewDeclaration("color", "red"), ast.NewDeclaration("width", "1px"))
	parts = StringifyWithBuilder(rule)
	css.Reset()
	for _, p := range parts {
		css.WriteString(p.CSS)
	}
	if got := css.String(); !strings.Contains(got, "color: red;") {
		t.Fatalf("builder decl semicolon: %q", got)
	}
}

func TestWriteBlockCloseInfersSiblingAfter(t *testing.T) {
	root := ast.NewRoot()
	a := ast.NewRule(".a")
	a.RawFormatting()["after"] = "\n "
	a.Append(ast.NewDeclaration("color", "red"))
	b := ast.NewRule(".b")
	b.Append(ast.NewDeclaration("color", "blue"))
	root.Append(a, b)
	if got := Stringify(root); !strings.Contains(got, ".b {") {
		t.Fatalf("inferred after close: %q", got)
	}
	result, err := StringifyWithSourceMap(root, SourceMapOptions{To: "o.css"})
	if err != nil {
		t.Fatalf("mapped: %v", err)
	}
	if !strings.Contains(result.CSS, ".b {") {
		t.Fatalf("mapped inferred after: %q", result.CSS)
	}
}

func TestNodeBeforeUsesContainerIndentAndRawBeforeDetected(t *testing.T) {
	root := ast.NewRoot()
	sample := ast.NewRule(".a")
	sample.RawFormatting()["before"] = "\n  "
	sample.Append(ast.NewDeclaration("color", "red"))
	inserted := ast.NewRule(".b")
	// No before raw; first child of root with depth>0 path via nested parent.
	nested := ast.NewAtRule("media", "all")
	nested.Block = true
	nested.RawFormatting()["before"] = "\n"
	child := ast.NewRule(".c")
	// sibling with before for rawBeforeDetected
	sib := ast.NewRule(".d")
	sib.RawFormatting()["before"] = "\n    "
	nested.Append(sib, child)
	root.Append(sample, nested, inserted)
	got := Stringify(root)
	if !strings.Contains(got, ".c") {
		t.Fatalf("nodeBefore paths: %q", got)
	}

	// rawBeforeDetected with non-string before on same-type sibling.
	box := ast.NewRoot()
	r1 := ast.NewRule(".1")
	r1.RawFormatting()["before"] = 12
	r2 := ast.NewRule(".2")
	box.Append(ast.NewComment("pad"), r1, r2)
	_ = Stringify(box)

	// Cross-type before fallback in second loop.
	mix := ast.NewRoot()
	c := ast.NewComment("c")
	c.RawFormatting()["before"] = "\n"
	r := ast.NewRule(".r")
	mix.Append(ast.NewRule(".first"), c, r)
	_ = Stringify(mix)
}

func TestIndentForUsesParentAndRootInference(t *testing.T) {
	root := ast.NewRoot()
	rule := ast.NewRule(".a")
	rule.RawFormatting()["before"] = "\n\t\t"
	decl := ast.NewDeclaration("color", "red")
	rule.Append(decl)
	root.Append(rule)
	if got := Stringify(decl); !strings.Contains(got, "color") {
		t.Fatalf("indent via parent: %q", got)
	}

	// Root indent raw.
	root2 := ast.NewRoot()
	root2.RawFormatting()["indent"] = "  "
	r := ast.NewRule(".z")
	r.Append(ast.NewDeclaration("x", "1"))
	root2.Append(r)
	if got := Stringify(root2); !strings.Contains(got, "\n  x") {
		t.Fatalf("root indent raw: %q", got)
	}
}

func TestInferDescendantRawRecurses(t *testing.T) {
	root := ast.NewRoot()
	outer := ast.NewAtRule("media", "x")
	outer.Block = true
	inner := ast.NewRule(".inner")
	sample := ast.NewDeclaration("color", "red")
	sample.RawFormatting()["between"] = ":  "
	inner.Append(sample)
	outer.Append(inner)
	targetRule := ast.NewRule(".target")
	targetRule.Append(ast.NewDeclaration("width", "1px"))
	root.Append(outer, targetRule)
	if got := Stringify(root); !strings.Contains(got, "width") {
		t.Fatalf("descendant recurse: %q", got)
	}
}

func TestRawValueAndBetweenFallbacks(t *testing.T) {
	decl := ast.NewDeclaration("color", "red")
	decl.RawFormatting()["value"] = ast.RawValue{Raw: "nope", Value: "other"}
	if got := Stringify(decl); got != "color: red" {
		t.Fatalf("RawValue mismatch fallback: %q", got)
	}
	decl.RawFormatting()["value"] = &ast.RawValue{Raw: "nope", Value: "other"}
	if got := Stringify(decl); got != "color: red" {
		t.Fatalf("*RawValue mismatch fallback: %q", got)
	}
	decl.RawFormatting()["value"] = map[string]string{"raw": "X", "value": "other"}
	if got := Stringify(decl); got != "color: red" {
		t.Fatalf("map mismatch fallback: %q", got)
	}
	decl.RawFormatting()["between"] = false
	if got := Stringify(decl); !strings.Contains(got, "color") {
		t.Fatalf("between non-string: %q", got)
	}
}

func TestMappedOriginPreviousSourceMap(t *testing.T) {
	previous := []byte(`{"version":3,"file":"generated.css","sources":["original.css"],"sourcesContent":[".a{color:red}"],"names":[],"mappings":"AAAA"}`)
	input, err := sourcemap.NewInput(".a{color:red}", sourcemap.Options{
		From:         "generated.css",
		SourceMap:    previous,
		SourceMapURL: "generated.css.map",
		TrackSource:  true,
	})
	if err != nil {
		t.Fatalf("input: %v", err)
	}
	root := ast.NewRoot()
	root.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(input.CSS))))
	rule := ast.NewRule(".a")
	rule.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(input.CSS))))
	decl := ast.NewDeclaration("color", "red")
	decl.SetSource(input.Location(input.FromOffset(3), input.FromOffset(12)))
	rule.Append(decl)
	root.Append(rule)

	result, err := StringifyWithSourceMap(root, SourceMapOptions{To: "out.css"})
	if err != nil {
		t.Fatalf("stringify: %v", err)
	}
	if result.Map == "" {
		t.Fatal("expected map")
	}

	// Empty/<css input> source name path.
	anon, err := sourcemap.NewInput("a{}", sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("anon: %v", err)
	}
	r := ast.NewRule("a")
	r.SetSource(anon.Location(anon.FromOffset(0), anon.FromOffset(2)))
	if _, err := StringifyWithSourceMap(r, SourceMapOptions{To: "o.css"}); err != nil {
		t.Fatalf("anon source: %v", err)
	}
}

func TestAddMappingContentBackfill(t *testing.T) {
	writer := newSourceMapWriter()
	writer.addMappingAtGenerated("src.css", nil, 0, 0, 0, 0)
	content := "a{}"
	writer.addMappingAtGenerated("src.css", &content, 0, 1, 0, 1)
	if writer.sourcesContent["src.css"] == nil {
		t.Fatal("expected content backfill")
	}
}

func TestRelativePathErrorFallback(t *testing.T) {
	// On most systems Rel between valid paths succeeds; still exercise abs/rel combos.
	if got := relativePath(".", "a.css"); got == "" {
		t.Fatal("expected relative path")
	}
	if runtime.GOOS == "windows" {
		_ = fileURL(`C:\temp\a.css`)
	}
}
