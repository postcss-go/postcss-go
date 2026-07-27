package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"postcss-go/internal/codec"
	"postcss-go/internal/jsbridge"
)

func TestParseASTReturnsBinaryCodec(t *testing.T) {
	encoded, err := parseAST(".a { color: red; }", "in.css")
	if err != nil {
		t.Fatalf("parseAST: %v", err)
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
		t.Fatalf("expected from ending in in.css on root source, got %#v", dto.Source)
	}
}

func TestParseASTRoundTripsThroughStringify(t *testing.T) {
	css := ".a { color: red !important; }\n@media (min-width: 1px) { b { x: 1; } }\n"
	encoded, err := parseAST(css, "x.css")
	if err != nil {
		t.Fatalf("parseAST: %v", err)
	}
	payload, err := stringifyAST(encoded, nil)
	if err != nil {
		t.Fatalf("stringifyAST: %v", err)
	}
	var result jsbridge.StringifyResult
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatalf("decode stringify json: %v", err)
	}
	if !strings.Contains(result.CSS, "color: red !important") {
		t.Fatalf("unexpected css: %q", result.CSS)
	}
	if !strings.Contains(result.CSS, "@media") {
		t.Fatalf("missing at-rule in css: %q", result.CSS)
	}
}

func TestStringifyASTRejectsBadMagic(t *testing.T) {
	if _, err := stringifyAST([]byte("XXXX\x01"), nil); err == nil {
		t.Fatal("expected bad magic error")
	}
}

func TestStringifyASTRejectsBadOptionsJSON(t *testing.T) {
	encoded, err := parseAST("a{}", "")
	if err != nil {
		t.Fatalf("parseAST: %v", err)
	}
	if _, err := stringifyAST(encoded, []byte("{")); err == nil {
		t.Fatal("expected options json error")
	}
}

func TestProcessCSSEmbedsRootBin(t *testing.T) {
	payload, err := processCSS("a { color: blue; }", []byte(`{"from":"p.css"}`))
	if err != nil {
		t.Fatalf("processCSS: %v", err)
	}
	var result struct {
		CSS     string          `json:"css"`
		RootBin json.RawMessage `json:"rootBin"`
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatalf("decode process json: %v", err)
	}
	if !strings.Contains(result.CSS, "color: blue") {
		t.Fatalf("unexpected css: %q", result.CSS)
	}
	// rootBin is encoded as a JSON base64 string of the binary AST.
	var rootBin []byte
	if err := json.Unmarshal(result.RootBin, &rootBin); err != nil {
		t.Fatalf("decode rootBin: %v", err)
	}
	if !bytes.HasPrefix(rootBin, []byte("PCGW")) {
		t.Fatalf("rootBin missing magic: %q", rootBin[:min(4, len(rootBin))])
	}
	dto, err := codec.DecodeDTO(rootBin)
	if err != nil {
		t.Fatalf("DecodeDTO(rootBin): %v", err)
	}
	if dto.Type != "root" {
		t.Fatalf("expected root, got %s", dto.Type)
	}
}

func TestProcessCSSRejectsBadOptionsJSON(t *testing.T) {
	if _, err := processCSS("a{}", []byte("{")); err == nil {
		t.Fatal("expected options json error")
	}
}

func TestNoWorkCSSReturnsCSS(t *testing.T) {
	css := "/* keep */ a { color: red; }"
	payload, err := noWorkCSS(css, nil)
	if err != nil {
		t.Fatalf("noWorkCSS: %v", err)
	}
	var result jsbridge.NoWorkResult
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatalf("decode noWork json: %v", err)
	}
	if result.CSS != css {
		t.Fatalf("noWork should preserve css, got %q", result.CSS)
	}
}

func TestNoWorkCSSRejectsBadOptionsJSON(t *testing.T) {
	if _, err := noWorkCSS("a{}", []byte("{")); err == nil {
		t.Fatal("expected options json error")
	}
}

func TestFitPayload(t *testing.T) {
	payload := []byte("hello-world")

	t.Run("short buffer reports needed size without write", func(t *testing.T) {
		out := make([]byte, 4)
		n := fitPayload(out, payload)
		if n != len(payload) {
			t.Fatalf("want %d, got %d", len(payload), n)
		}
		if string(out) == "hell" && bytes.Equal(out, payload[:4]) {
			// copy must not happen when capacity is too small
			t.Fatal("short buffer should not receive payload")
		}
		if !bytes.Equal(out, make([]byte, 4)) {
			t.Fatalf("short buffer was mutated: %q", out)
		}
	})

	t.Run("exact buffer copies payload", func(t *testing.T) {
		out := make([]byte, len(payload))
		n := fitPayload(out, payload)
		if n != len(payload) || !bytes.Equal(out, payload) {
			t.Fatalf("n=%d out=%q", n, out)
		}
	})

	t.Run("large buffer copies without growing return", func(t *testing.T) {
		out := make([]byte, len(payload)+8)
		n := fitPayload(out, payload)
		if n != len(payload) {
			t.Fatalf("want %d, got %d", len(payload), n)
		}
		if !bytes.Equal(out[:len(payload)], payload) {
			t.Fatalf("prefix mismatch: %q", out[:len(payload)])
		}
	})
}
