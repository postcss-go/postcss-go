package jsbridge

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"postcss-go/internal/ast"
	"postcss-go/internal/csserrors"
	postcss "postcss-go/internal/postcss"
	"postcss-go/internal/sourcemap"
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
