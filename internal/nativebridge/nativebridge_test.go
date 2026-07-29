package nativebridge

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"postcss-go/internal/codec"
)

func TestParseReturnsBinaryCodec(t *testing.T) {
	encoded, err := Call(Parse, []byte(".a { color: red; }"), []byte("in.css"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !bytes.HasPrefix(encoded, []byte("PCGW")) {
		t.Fatalf("missing magic, got %q", encoded[:min(4, len(encoded))])
	}
	dto, err := codec.DecodeDTO(encoded)
	if err != nil {
		t.Fatalf("DecodeDTO: %v", err)
	}
	if dto == nil || dto.Type != "root" {
		t.Fatalf("expected root dto, got %#v", dto)
	}
	if dto.Source == nil || !strings.HasSuffix(dto.Source.File, "in.css") {
		t.Fatalf("expected from ending in in.css, got %#v", dto.Source)
	}
}

func TestParseRoundTripsThroughStringify(t *testing.T) {
	encoded, err := Call(Parse, []byte(".a { color: red !important; }\n"), []byte("x.css"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	payload, err := Call(Stringify, encoded, nil)
	if err != nil {
		t.Fatalf("stringify: %v", err)
	}
	var result stringifyResult
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatalf("decode stringify json: %v", err)
	}
	if !strings.Contains(result.CSS, "color: red !important") {
		t.Fatalf("unexpected css: %q", result.CSS)
	}
}

func TestCallRejectsInvalidInputs(t *testing.T) {
	if _, err := Call(Stringify, []byte("XXXX\x01"), nil); err == nil {
		t.Fatal("expected bad AST error")
	}
	if _, err := Call(Process, []byte("a{}"), []byte("{")); err == nil {
		t.Fatal("expected bad process options error")
	}
	if _, err := Call(NoWork, []byte("a{}"), []byte("{")); err == nil {
		t.Fatal("expected bad no-work options error")
	}
	if _, err := Call(Operation(255), nil, nil); err == nil {
		t.Fatal("expected unknown operation error")
	}
}

func TestProcessEmbedsBinaryRoot(t *testing.T) {
	payload, err := Call(Process, []byte("a { color: blue; }"), []byte(`{"from":"p.css"}`))
	if err != nil {
		t.Fatalf("process: %v", err)
	}
	var result struct {
		CSS     string          `json:"css"`
		RootBin json.RawMessage `json:"rootBin"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatalf("decode process json: %v", err)
	}
	var rootBin []byte
	if err := json.Unmarshal(result.RootBin, &rootBin); err != nil {
		t.Fatalf("decode rootBin: %v", err)
	}
	if !bytes.HasPrefix(rootBin, []byte("PCGW")) {
		t.Fatalf("rootBin missing magic: %q", rootBin[:min(4, len(rootBin))])
	}
}

func TestNoWorkPreservesCSS(t *testing.T) {
	css := "/* keep */ a { color: red; }"
	payload, err := Call(NoWork, []byte(css), nil)
	if err != nil {
		t.Fatalf("noWork: %v", err)
	}
	var result stringifyResult
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatalf("decode noWork json: %v", err)
	}
	if result.CSS != css {
		t.Fatalf("noWork should preserve css, got %q", result.CSS)
	}
}
