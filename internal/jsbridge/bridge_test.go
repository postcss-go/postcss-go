package jsbridge

import (
	"context"
	"strings"
	"testing"
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
	})
	if !processResp.OK || !strings.Contains(processResp.CSS, "color: red;") {
		t.Fatalf("unexpected process response: %#v", processResp)
	}

	stringifyResp := Execute(Request{
		Command: "stringify",
		AST:     parseResp.Root,
	})
	if !stringifyResp.OK || !strings.Contains(stringifyResp.CSS, ".a") {
		t.Fatalf("unexpected stringify response: %#v", stringifyResp)
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
	})
	if err != nil || processRes == nil || !strings.Contains(processRes.CSS, "color: red;") {
		t.Fatalf("process rpc failed: res=%#v err=%v", processRes, err)
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
