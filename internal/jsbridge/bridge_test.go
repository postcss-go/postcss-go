package jsbridge

import (
	"context"
	"strings"
	"testing"

	"postcss-go/internal/ast"
)

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
		Options: RequestOpts{From: "demo.css", To: "out.css", Map: true},
	})
	if !processResp.OK || !strings.Contains(processResp.CSS, "color: red;") {
		t.Fatalf("unexpected process response: %#v", processResp)
	}
	if !strings.Contains(processResp.Map, `"version":3`) {
		t.Fatalf("expected process response source map, got %#v", processResp.Map)
	}

	stringifyResp := Execute(Request{
		Command: "stringify",
		AST:     parseResp.Root,
	})
	if !stringifyResp.OK || !strings.Contains(stringifyResp.CSS, ".a") {
		t.Fatalf("unexpected stringify response: %#v", stringifyResp)
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
			From: "demo.css",
			To:   "out.css",
			Map:  true,
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
