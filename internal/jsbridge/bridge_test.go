package jsbridge

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/csserrors"
	postcss "github.com/postcss-go/postcss-go/internal/postcss"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
)

func TestProcessOptionsJSONContract(t *testing.T) {
	var params ProcessParams
	err := json.Unmarshal([]byte(`{
		"css":"a{}",
		"options":{
			"from":"src/a.css",
			"to":"dist/a.css",
			"map":true,
			"mapAuto":true,
			"mapFile":"dist/maps/a.css.map",
			"previousMap":"{}",
			"previousMapPath":"src/a.css.map",
			"previousMapUrl":"src/a.css.map",
			"previousMapDisabled":true,
			"sourceMapFrom":"virtual.css",
			"sourcesContent":false,
			"absolute":true,
			"preserveAnnotation":true,
			"mapInline":true,
			"mapInlineAuto":true,
			"mapAnnotation":"a.css.map",
			"mapAnnotationDefault":true,
			"mapAnnotationDisabled":true
		}
	}`), &params)
	if err != nil {
		t.Fatalf("decode process params: %v", err)
	}
	opts := params.Options
	if opts.From != "src/a.css" ||
		opts.To != "dist/a.css" ||
		!opts.Map ||
		!opts.MapAuto ||
		opts.MapFile != "dist/maps/a.css.map" ||
		opts.PreviousMap != "{}" ||
		opts.PreviousMapPath != "src/a.css.map" ||
		opts.PreviousMapURL != "src/a.css.map" ||
		!opts.PreviousMapDisabled ||
		opts.SourceMapFrom != "virtual.css" ||
		opts.SourcesContent == nil ||
		*opts.SourcesContent ||
		!opts.Absolute ||
		!opts.PreserveAnnotation ||
		opts.MapInline == nil || !*opts.MapInline ||
		!opts.MapInlineAuto ||
		opts.MapAnnotation != "a.css.map" ||
		!opts.MapAnnotationDefault ||
		!opts.MapAnnotationDisabled {
		t.Fatalf("unexpected decoded options: %#v", opts)
	}
}

func TestParseProcessAndStringifyBridge(t *testing.T) {
	parseResp := Execute(Request{
		Command: "parse",
		CSS:     ".a { color: red; }",
		Options: RequestOpts{From: "demo.css"},
	})
	if !parseResp.OK || parseResp.Root == nil {
		t.Fatalf("expected parse response root, got %#v", parseResp)
	}
	if parseResp.Root.Type != "root" || len(parseResp.Root.Nodes) != 1 {
		t.Fatalf("unexpected parse root dto: %#v", parseResp.Root)
	}
	if parseResp.Root.Source == nil || !strings.HasSuffix(parseResp.Root.Source.File, "demo.css") {
		t.Fatalf("expected source file on dto, got %#v", parseResp.Root.Source)
	}

	processResp := Execute(Request{
		Command: "process",
		CSS:     ".a { color: red; }",
		Options: RequestOpts{
			From:                  "demo.css",
			To:                    "out.css",
			Map:                   true,
			MapInline:             boolPtr(false),
			MapAnnotationDisabled: true,
		},
	})
	if !processResp.OK || !strings.Contains(processResp.CSS, "color: red;") {
		t.Fatalf("unexpected process response: %#v", processResp)
	}
	if !strings.Contains(processResp.Map, `"version":3`) {
		t.Fatalf("expected process response source map, got %#v", processResp.Map)
	}
	if processResp.MapFile != "out.css.map" {
		t.Fatalf("expected process response map file, got %q", processResp.MapFile)
	}

	stringifyResp := Execute(Request{
		Command: "stringify",
		AST:     parseResp.Root,
	})
	if !stringifyResp.OK || !strings.Contains(stringifyResp.CSS, ".a") {
		t.Fatalf("unexpected stringify response: %#v", stringifyResp)
	}
}

func TestNoWorkBridgeGeneratesIdentityMapWithoutParsing(t *testing.T) {
	resp, err := NoWorkRPC(context.Background(), NoWorkParams{
		CSS: "a {",
		Options: RequestOpts{
			From:      "a.css",
			Map:       true,
			MapInline: boolPtr(true),
		},
	})
	if err != nil {
		t.Fatalf("no-work RPC parsed unchanged CSS: %v", err)
	}
	if !strings.Contains(resp.CSS, "sourceMappingURL=data:application/json;base64,") {
		t.Fatalf("expected inline no-work map, got %q", resp.CSS)
	}
	if resp.Map != "" {
		t.Fatalf("expected inline map payload to be consumed, got %q", resp.Map)
	}
}

func TestStringifyBridgePreservesRawsFromDTO(t *testing.T) {
	resp := Execute(Request{
		Command: "stringify",
		AST: &NodeDTO{
			Type: "root",
			Raws: ast.Raws{"after": ""},
			Nodes: []*NodeDTO{{
				Type:     "rule",
				Selector: ".a",
				Raws:     ast.Raws{"before": "", "between": "", "after": "", "semicolon": false},
				Nodes: []*NodeDTO{{
					Type:  "decl",
					Prop:  "color",
					Value: "red",
					Raws:  ast.Raws{"before": "", "between": ":", "semicolon": false},
				}},
			}},
		},
	})
	if !resp.OK || resp.CSS != ".a{color:red}" {
		t.Fatalf("expected DTO raws to control output, got %#v", resp)
	}
}

func TestStringifyBridgeGeneratesSourceMapFromAST(t *testing.T) {
	inline := false
	source := &SourceLocationDTO{
		Start: SourcePositionDTO{Line: 1, Column: 1, Offset: 0},
		End:   SourcePositionDTO{Line: 1, Column: 15, Offset: 14},
		File:  "input.css",
		CSS:   ".a{color:red}",
	}
	resp := Execute(Request{
		Command: "stringify",
		Options: RequestOpts{
			Map:                  true,
			MapInline:            &inline,
			MapAnnotationDefault: true,
			From:                 "input.css",
			To:                   "output.css",
		},
		AST: &NodeDTO{
			Type:   "root",
			Source: source,
			Nodes: []*NodeDTO{{
				Type:     "rule",
				Selector: ".a",
				Source:   source,
				Nodes: []*NodeDTO{{
					Type:   "decl",
					Prop:   "color",
					Value:  "red",
					Source: source,
				}},
			}},
		},
	})
	if !resp.OK || resp.CSS == "" || resp.Map == "" {
		t.Fatalf("expected mapped AST stringify result, got %#v", resp)
	}
	if !strings.Contains(resp.Map, `"sources":["input.css"]`) {
		t.Fatalf("expected source map to reference input.css, got %q", resp.Map)
	}
}

func TestDocumentDTOStringifiesAndRoundTrips(t *testing.T) {
	document := &NodeDTO{
		Type: "document",
		Nodes: []*NodeDTO{
			{Type: "root", Nodes: []*NodeDTO{{Type: "rule", Selector: "a", Raws: ast.Raws{"between": " "}}}},
			{Type: "root", Nodes: []*NodeDTO{{Type: "rule", Selector: "b", Raws: ast.Raws{"between": " "}}}},
		},
	}
	node, err := FromDTO(document)
	if err != nil {
		t.Fatalf("document FromDTO failed: %v", err)
	}
	if node.Type() != ast.NodeDocument {
		t.Fatalf("expected document node, got %q", node.Type())
	}
	resp, err := StringifyRPC(context.Background(), StringifyParams{AST: document})
	if err != nil {
		t.Fatalf("document stringify failed: %v", err)
	}
	if resp.CSS != "a {}\nb {}" {
		t.Fatalf("unexpected document CSS: %q", resp.CSS)
	}
	roundTrip, err := ToDTO(node)
	if err != nil || roundTrip.Type != "document" || len(roundTrip.Nodes) != 2 {
		t.Fatalf("document ToDTO failed: dto=%#v err=%v", roundTrip, err)
	}
}

func TestToDTODoesNotInitializeNilRaws(t *testing.T) {
	root := ast.NewRoot()
	rule := ast.NewRule(".a")
	root.Append(rule)

	dto, err := ToDTO(root)
	if err != nil {
		t.Fatalf("ToDTO failed: %v", err)
	}
	if dto.Raws != nil {
		t.Fatalf("expected nil raws on DTO, got %#v", dto.Raws)
	}
	if root.RawFormattingReadOnly() != nil {
		t.Fatalf("ToDTO mutated AST raws: %#v", root.RawFormattingReadOnly())
	}
	if rule.RawFormattingReadOnly() != nil {
		t.Fatalf("ToDTO mutated child raws: %#v", rule.RawFormattingReadOnly())
	}
}

func TestFromDTOClonesRaws(t *testing.T) {
	raws := ast.Raws{"before": "\n"}
	dto := &NodeDTO{
		Type:     "rule",
		Selector: ".a",
		Raws:     raws,
	}
	node, err := FromDTO(dto)
	if err != nil {
		t.Fatalf("FromDTO failed: %v", err)
	}
	node.RawFormatting()["before"] = "\n  "
	if raws["before"] != "\n" {
		t.Fatalf("expected FromDTO to clone raws, got %#v", raws)
	}
}

func TestBridgeErrors(t *testing.T) {
	resp := Execute(Request{Command: "unknown"})
	if resp.OK || resp.Error == nil || !strings.Contains(resp.Error.Message, "unsupported command") {
		t.Fatalf("expected unsupported command error, got %#v", resp)
	}

	resp = Execute(Request{Command: "stringify"})
	if resp.OK || resp.Error == nil || !strings.Contains(resp.Error.Message, "missing ast payload") {
		t.Fatalf("expected missing ast error, got %#v", resp)
	}

	if _, err := ToJSON(resp); err != nil {
		t.Fatalf("expected response json marshal to succeed: %v", err)
	}

	if _, err := FromDTO(&NodeDTO{Type: "mystery"}); err == nil {
		t.Fatal("expected unknown dto type to fail")
	}
}

func TestRPCMethods(t *testing.T) {
	parseRes, err := ParseRPC(context.Background(), ParseParams{
		CSS: ".a { color: red; }",
		Options: RequestOpts{
			From: "demo.css",
		},
	})
	if err != nil || parseRes == nil || parseRes.Root == nil {
		t.Fatalf("parse rpc failed: res=%#v err=%v", parseRes, err)
	}

	processRes, err := ProcessRPC(context.Background(), ProcessParams{
		CSS: ".a { color: red; }",
		Options: RequestOpts{
			From:                  "demo.css",
			To:                    "out.css",
			Map:                   true,
			MapInline:             boolPtr(false),
			MapAnnotationDisabled: true,
		},
	})
	if err != nil || processRes == nil || !strings.Contains(processRes.CSS, "color: red;") {
		t.Fatalf("process rpc failed: res=%#v err=%v", processRes, err)
	}
	if !strings.Contains(processRes.Map, `"version":3`) {
		t.Fatalf("expected process rpc source map, got %#v", processRes.Map)
	}

	stringifyRes, err := StringifyRPC(context.Background(), StringifyParams{
		AST: parseRes.Root,
	})
	if err != nil || stringifyRes == nil || !strings.Contains(stringifyRes.CSS, ".a") {
		t.Fatalf("stringify rpc failed: res=%#v err=%v", stringifyRes, err)
	}

	if _, err := StringifyRPC(context.Background(), StringifyParams{}); err == nil {
		t.Fatal("expected stringify rpc without ast to fail")
	}
}

func TestExecuteNoWorkAndErrorPaths(t *testing.T) {
	noWork := Execute(Request{Command: "noWork", CSS: "a { color: red; }"})
	if !noWork.OK || noWork.CSS != "a { color: red; }" {
		t.Fatalf("unexpected noWork response: %#v", noWork)
	}
	if bad := Execute(Request{Command: "parse", CSS: ".a {"}); bad.OK || bad.Error == nil {
		t.Fatalf("expected parse error response, got %#v", bad)
	}
	if bad := Execute(Request{Command: "process", CSS: ".a {"}); bad.OK || bad.Error == nil {
		t.Fatalf("expected process error response, got %#v", bad)
	}
}

func TestStringifyBuilderAndComplexDTORoundTrip(t *testing.T) {
	parseRes, err := ParseRPC(context.Background(), ParseParams{
		CSS:     `@media screen { /* note */ .a { color: red !important; } }`,
		Options: RequestOpts{From: "complex.css"},
	})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	built, err := StringifyRPC(context.Background(), StringifyParams{
		AST:     parseRes.Root,
		Builder: true,
	})
	if err != nil || len(built.Parts) == 0 {
		t.Fatalf("builder stringify failed: %#v err=%v", built, err)
	}

	node, err := FromDTO(parseRes.Root)
	if err != nil {
		t.Fatalf("FromDTO: %v", err)
	}
	dto, err := ToDTO(node)
	if err != nil || dto.Type != "root" {
		t.Fatalf("ToDTO round-trip failed: %#v err=%v", dto, err)
	}
	if len(dto.Nodes) == 0 || dto.Nodes[0].Type != "atrule" {
		t.Fatalf("expected at-rule child, got %#v", dto.Nodes)
	}
}

func TestStringifyFlatASTDeepAndMalformed(t *testing.T) {
	const depth = 6000
	flat := make([]FlatNodeDTO, 0, depth+2)
	flat = append(flat, FlatNodeDTO{
		Node:       &NodeDTO{Type: "root", Raws: ast.Raws{"after": ""}},
		ChildCount: 1,
	})
	for range depth {
		flat = append(flat, FlatNodeDTO{
			Node: &NodeDTO{
				Type:     "rule",
				Selector: "a",
				Raws:     ast.Raws{"after": "", "before": "", "between": ""},
			},
			ChildCount: 1,
		})
	}
	flat = append(flat, FlatNodeDTO{
		Node: &NodeDTO{Type: "decl", Prop: "color", Value: "red", Raws: ast.Raws{"before": "", "between": ":"}},
	})

	result, err := StringifyRPC(context.Background(), StringifyParams{FlatAST: flat, Builder: true})
	if err != nil {
		t.Fatalf("deep flat stringify: %v", err)
	}
	want := strings.Repeat("a{", depth) + "color:red" + strings.Repeat("}", depth)
	if result.CSS != want || len(result.Parts) == 0 {
		t.Fatalf("deep flat stringify mismatch: css=%d want=%d parts=%d", len(result.CSS), len(want), len(result.Parts))
	}

	badCases := [][]FlatNodeDTO{
		{{Node: &NodeDTO{Type: "root"}, ChildCount: 1}},
		{{Node: &NodeDTO{Type: "decl", Prop: "a"}, ChildCount: 1}},
		{{Node: &NodeDTO{Type: "root"}}, {Node: &NodeDTO{Type: "rule", Selector: "a"}}},
		{{Node: nil}},
	}
	for _, bad := range badCases {
		if _, err := FromFlatDTO(bad); err == nil {
			t.Fatalf("expected malformed flat AST to fail: %#v", bad)
		}
	}
}

func TestSourceBridgeDTOHelpersAndFindBlockEnd(t *testing.T) {
	parseRes, err := ParseRPC(context.Background(), ParseParams{
		CSS:     `.a { content: "\{"; background: url('x)'); /* }*/ color: red; }`,
		Options: RequestOpts{From: "block.css"},
	})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	node, err := FromDTO(parseRes.Root)
	if err != nil {
		t.Fatalf("FromDTO: %v", err)
	}
	rule := node.(*ast.Root).Children()[0]
	bridged := SourceToBridgeDTO(rule.Source(), true, true, false, true)
	if bridged == nil || bridged.File == "" {
		t.Fatalf("SourceToBridgeDTO failed: %#v", bridged)
	}

	input, loc, err := SourceFromBridgeDTO(bridged, nil)
	if err != nil || input == nil || loc == nil {
		t.Fatalf("SourceFromBridgeDTO failed: input=%v loc=%v err=%v", input, loc, err)
	}

	end, ok := findBlockEnd(`.a { content: "\}"; /* } */ background:url(x); }`, 0)
	if !ok || end == 0 {
		t.Fatalf("findBlockEnd failed: end=%d ok=%v", end, ok)
	}
	if _, ok := findBlockEnd(`a { /*`, 0); ok {
		t.Fatal("unclosed comment should fail findBlockEnd")
	}
	if end, ok := findBlockEnd(`a[href="{"] { color: red; }`, 0); !ok || end == 0 {
		t.Fatalf("brackets/quotes should not confuse findBlockEnd: end=%d ok=%v", end, ok)
	}
}

func TestErrorDTOFromCssSyntaxErrorWithSourceMap(t *testing.T) {
	err := &csserrors.SyntaxError{
		Reason:    "boom",
		Line:      2,
		Column:    4,
		EndLine:   2,
		EndColumn: 6,
		Source:    "x",
		File:      "a.css",
		Plugin:    "demo",
		Input: &csserrors.InputInfo{
			Source:           "x",
			File:             "a.css",
			Line:             2,
			Column:           4,
			Offset:           3,
			SourceMapPresent: true,
		},
	}
	detail := ErrorDTOFromError(err)
	if detail.Name != "CssSyntaxError" || detail.Column != 3 || detail.EndColumn != 5 {
		t.Fatalf("expected source-map column adjustment, got %#v", detail)
	}
	if detail.Input == nil || !detail.Input.SourceMapPresent {
		t.Fatalf("expected input metadata, got %#v", detail.Input)
	}
}

func TestFromDTONilAndWarningsDTO(t *testing.T) {
	if _, err := FromDTO(nil); err == nil {
		t.Fatal("expected nil dto error")
	}
	if got := warningsToDTO(nil); got == nil || len(got) != 0 {
		t.Fatalf("expected empty warning slice, got %#v", got)
	}
	got := warningsToDTO([]postcss.Warning{{Type: "warning", Text: "heads up", Plugin: "demo"}})
	if len(got) != 1 || got[0].Text != "heads up" || got[0].Plugin != "demo" {
		t.Fatalf("unexpected warningsToDTO: %#v", got)
	}
}

func TestNoWorkAndSourceFromDTOErrorPaths(t *testing.T) {
	_, err := NoWorkRPC(context.Background(), NoWorkParams{
		CSS:     "a{}",
		Options: RequestOpts{Map: true, PreviousMapPath: filepath.Join(t.TempDir(), "missing.map")},
	})
	if err == nil {
		t.Fatal("expected NoWorkRPC previous map error")
	}
	resp := Execute(Request{
		Command: "noWork",
		CSS:     "a{}",
		Options: RequestOpts{Map: true, PreviousMapPath: filepath.Join(t.TempDir(), "missing-exec.map")},
	})
	if resp.OK || resp.Error == nil {
		t.Fatalf("expected noWork execute error, got %#v", resp)
	}

	_, _, err = SourceFromBridgeDTO(&SourceLocationDTO{
		Start: SourcePositionDTO{Line: 1, Column: 1},
		End:   SourcePositionDTO{Line: 1, Column: 2},
		Map:   "{",
	}, nil)
	if err == nil {
		t.Fatal("expected invalid source map decode error")
	}
}

func TestToDTOOwnSemicolonAndUnsupportedType(t *testing.T) {
	css := "a { color: red }"
	root, err := ParseRPC(context.Background(), ParseParams{CSS: css, Options: RequestOpts{From: "semi.css"}})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	node, err := FromDTO(root.Root)
	if err != nil {
		t.Fatalf("FromDTO: %v", err)
	}
	rule := node.(*ast.Root).Children()[0].(*ast.Rule)
	rule.RawFormatting()["ownSemicolon"] = ";"
	dto, err := ToDTO(node)
	if err != nil || dto.Nodes[0].Source == nil {
		t.Fatalf("ToDTO with ownSemicolon failed: %#v err=%v", dto, err)
	}

	if _, err := toDTO(unsupportedNode{}, true); err == nil {
		t.Fatal("expected unsupported node type error")
	}
}

func TestParseRPCOwnSemicolonSourceEnd(t *testing.T) {
	tests := []struct {
		css                  string
		offset, line, column int
	}{
		{css: ".a{}  ;", offset: 7, line: 1, column: 7},
		{css: "a{b:c} ;", offset: 8, line: 1, column: 8},
		// Trailing newline after the free semicolon must not be part of the end.
		{css: "a{b:c} ;\n", offset: 8, line: 1, column: 8},
	}
	for _, test := range tests {
		css := test.css
		result, err := ParseRPC(context.Background(), ParseParams{CSS: css})
		if err != nil {
			t.Fatalf("parse %q: %v", css, err)
		}
		end := result.Root.Nodes[0].Source.End
		if end.Offset != test.offset || end.Line != test.line || end.Column != test.column {
			t.Fatalf("source end for %q: got %#v, want offset=%d line=%d column=%d", css, end, test.offset, test.line, test.column)
		}
	}
}

func TestRuleSourceToBridgeDTOOwnSemicolonEdges(t *testing.T) {
	css := "a{}\n;\n"
	input, err := postcss.NewInput(css, sourcemap.Options{TrackSource: true})
	if err != nil {
		t.Fatalf("input: %v", err)
	}
	// End offset past the trailing newline; bridge should walk back to ";".
	loc := &postcss.SourceLocation{
		Start: input.FromOffset(0),
		End:   input.FromOffset(len(css)),
		Input: input,
	}
	dto := RuleSourceToBridgeDTO(loc, true, true)
	if dto == nil || dto.End.Offset != 5 || dto.End.Line != 2 || dto.End.Column != 1 {
		t.Fatalf("newline walk-back: got %#v, want offset=5 line=2 column=1", dto)
	}

	empty := &postcss.SourceLocation{
		Start: postcss.Position{Line: 1, Column: 1, Offset: 0},
		End:   postcss.Position{Line: 1, Column: 3, Offset: 2},
		Input: &postcss.Input{CSS: ""},
	}
	fallback := RuleSourceToBridgeDTO(empty, true, false)
	if fallback == nil || fallback.End.Column != 2 {
		t.Fatalf("empty CSS fallback: got %#v", fallback)
	}

	if RuleSourceToBridgeDTO(nil, true, false) != nil {
		t.Fatal("nil location should yield nil DTO")
	}
	plain := RuleSourceToBridgeDTO(loc, false, true)
	if plain == nil || plain.End.Offset != len(css) {
		t.Fatalf("without ownSemicolon should keep raw end, got %#v", plain)
	}
}

func TestFromFlatDTOErrorAndSourceInputPaths(t *testing.T) {
	if _, err := FromFlatDTO([]FlatNodeDTO{
		{Node: &NodeDTO{Type: "root"}, ChildCount: -1},
	}); err == nil {
		t.Fatal("expected negative root childCount to fail")
	}
	if _, err := FromFlatDTO([]FlatNodeDTO{
		{Node: &NodeDTO{Type: "root", Nodes: []*NodeDTO{{Type: "rule", Selector: "a"}}}},
	}); err == nil {
		t.Fatal("expected nested children in a flat root node to fail")
	}
	if _, err := FromFlatDTO([]FlatNodeDTO{{Node: &NodeDTO{Type: "mystery"}}}); err == nil {
		t.Fatal("expected unknown root type to fail")
	}
	if _, err := FromFlatDTO([]FlatNodeDTO{
		{Node: &NodeDTO{Type: "root"}, ChildCount: 1},
		{Node: nil},
	}); err == nil {
		t.Fatal("expected nil child node to fail")
	}
	if _, err := FromFlatDTO([]FlatNodeDTO{
		{Node: &NodeDTO{Type: "root"}, ChildCount: 1},
		{Node: &NodeDTO{Type: "rule", Selector: "a"}, ChildCount: -1},
	}); err == nil {
		t.Fatal("expected negative childCount to fail")
	}
	if _, err := FromFlatDTO([]FlatNodeDTO{
		{Node: &NodeDTO{Type: "root"}, ChildCount: 1},
		{Node: &NodeDTO{Type: "rule", Selector: "a", Nodes: []*NodeDTO{{Type: "decl"}}}},
	}); err == nil {
		t.Fatal("expected nested children in a flat child node to fail")
	}
	if _, err := FromFlatDTO([]FlatNodeDTO{
		{Node: &NodeDTO{Type: "root"}, ChildCount: 1},
		{Node: &NodeDTO{Type: "mystery"}},
	}); err == nil {
		t.Fatal("expected unknown child type to fail")
	}
	if _, err := FromFlatDTO([]FlatNodeDTO{
		{Node: &NodeDTO{Type: "root"}, ChildCount: 1},
		{Node: &NodeDTO{Type: "decl", Prop: "color", Value: "red"}, ChildCount: 1},
	}); err == nil {
		t.Fatal("expected non-container childCount to fail")
	}

	// Completing a nested frame should pop finished parents before appending
	// the next sibling, and sourceInput should prefer a child's own input.
	css := "a{color:red}b{}"
	parseRes, err := ParseRPC(context.Background(), ParseParams{CSS: css, Options: RequestOpts{From: "flat.css"}})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	root := parseRes.Root
	firstRule := *root.Nodes[0]
	firstRule.Nodes = nil
	flat := []FlatNodeDTO{
		{Node: &NodeDTO{Type: "root", Source: root.Source, Raws: root.Raws}, ChildCount: 2},
		{Node: &firstRule, ChildCount: 1},
		{Node: root.Nodes[0].Nodes[0]},
		{Node: root.Nodes[1]},
	}
	node, err := FromFlatDTO(flat)
	if err != nil {
		t.Fatalf("valid nested flat AST: %v", err)
	}
	built, err := ToDTO(node)
	if err != nil || len(built.Nodes) != 2 || built.Nodes[0].Source == nil || built.Nodes[0].Source.File == "" {
		t.Fatalf("expected sourced round-trip, got %#v err=%v", built, err)
	}
}

type unsupportedNode struct{}

func (unsupportedNode) Type() ast.NodeType              { return "x" }
func (unsupportedNode) Parent() ast.Container           { return nil }
func (unsupportedNode) SetParent(ast.Container)         {}
func (unsupportedNode) Range() ast.SourceRange          { return ast.SourceRange{} }
func (unsupportedNode) SetRange(ast.SourceRange)        {}
func (unsupportedNode) Source() *sourcemap.Location     { return nil }
func (unsupportedNode) SetSource(*sourcemap.Location)   {}
func (unsupportedNode) RawFormatting() ast.Raws         { return nil }
func (unsupportedNode) RawFormattingReadOnly() ast.Raws { return nil }
func (unsupportedNode) Root() ast.Node                  { return nil }
func (unsupportedNode) Next() ast.Node                  { return nil }
func (unsupportedNode) Prev() ast.Node                  { return nil }
func (unsupportedNode) Remove() ast.Node                { return nil }
func (unsupportedNode) ReplaceWith(...ast.Node) error   { return nil }
func (unsupportedNode) Clone() ast.Node                 { return unsupportedNode{} }
func (unsupportedNode) Before(...ast.Node) error        { return nil }
func (unsupportedNode) After(...ast.Node) error         { return nil }
func (unsupportedNode) Error(string, ...ast.ErrorOptions) *csserrors.SyntaxError {
	return nil
}
func (unsupportedNode) CloneBefore(...ast.Node) (ast.Node, error) { return nil, nil }
func (unsupportedNode) CloneAfter(...ast.Node) (ast.Node, error)  { return nil, nil }

func boolPtr(v bool) *bool {
	return &v
}
