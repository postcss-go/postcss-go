package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestGenerateSchemaAndValidation(t *testing.T) {
	data, err := os.ReadFile("../../protocol.json")
	if err != nil {
		t.Fatal(err)
	}
	outputs, err := generate(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, needle := range []string{"HANDLE_OPERATION_PARSE", "HANDLE_NODE_DECL", "HANDLE_PATCH_SETFIELD", "HANDLE_EVENT_ENTER", "HANDLE_STATUS_EXHAUSTED", "HANDLE_CAPABILITY_STRUCTUREDERRORS", "HANDLE_BRIDGE_METHODS", "'handleParse'"} {
		if !strings.Contains(string(outputs["../../packages/postcss-go/src/generated/handle-protocol.ts"]), needle) {
			t.Fatal(needle)
		}
	}
	if !strings.Contains(string(outputs["protocol_gen.go"]), `BridgeMethods = []string{`) {
		t.Fatal("missing Go bridge method table")
	}
	for _, edit := range []func(*protocol){
		func(p *protocol) { p.Major = 0 }, func(p *protocol) { p.MaxBatchSize = 0 }, func(p *protocol) { p.Capabilities = nil },
		func(p *protocol) { p.Capabilities[0].Bit = 32 }, func(p *protocol) { p.Capabilities[1].Bit = p.Capabilities[0].Bit },
		func(p *protocol) { p.Capabilities[0].Name = "bad-name" }, func(p *protocol) { p.Capabilities[0].Implemented = false },
		func(p *protocol) { p.Fields = nil }, func(p *protocol) { p.Fields[1].ID = p.Fields[0].ID },
		func(p *protocol) { p.Fields[1].Name = p.Fields[0].Name }, func(p *protocol) { p.Fields[0].Name = "bad-name" },
		func(p *protocol) { p.Operations[1].Bridge = p.Operations[0].Bridge },
		func(p *protocol) { p.Operations[0].Bridge = "parseV2" },
		func(p *protocol) { p.Fields[0].Bridge = "handleField" },
		func(p *protocol) {
			for i := range p.Operations {
				p.Operations[i].Bridge = ""
			}
		},
	} {
		var p protocol
		if err := json.Unmarshal(data, &p); err != nil {
			t.Fatal(err)
		}
		edit(&p)
		bad, _ := json.Marshal(p)
		if _, err := generate(bad); err == nil {
			t.Fatalf("invalid schema accepted: %s", bad)
		}
	}
	if _, err := generate([]byte(`{"unknown":1}`)); err == nil {
		t.Fatal("unknown field accepted")
	}
	if _, err := generate(append(data, []byte(`{}`)...)); err == nil {
		t.Fatal("trailing JSON accepted")
	}
	if _, err := generate([]byte(`{`)); err == nil {
		t.Fatal("invalid JSON accepted")
	}
}
