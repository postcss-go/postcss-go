package nativebridge

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"strings"
	"testing"

	"postcss-go/internal/codec"
	"postcss-go/internal/result"
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

func TestStringifyBuilderReturnsChunksAndBoundaries(t *testing.T) {
	encoded, err := Call(Parse, []byte(".a { color: red; }"), []byte("x.css"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	payload, err := Call(StringifyBuilder, encoded, []byte("1"))
	if err != nil {
		t.Fatalf("stringify builder: %v", err)
	}
	var result stringifyBuilderResult
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatalf("decode builder result: %v", err)
	}
	if len(result.Parts) == 0 {
		t.Fatal("expected builder chunks")
	}
	var css strings.Builder
	var start, end bool
	for _, part := range result.Parts {
		css.WriteString(part.CSS)
		start = start || part.Type == "start"
		end = end || part.Type == "end"
	}
	if css.String() != ".a { color: red; }" || !start || !end {
		t.Fatalf("unexpected builder result: css=%q parts=%#v", css.String(), result.Parts)
	}
	if _, err := Call(StringifyBuilder, encoded, []byte("99")); err == nil {
		t.Fatal("expected an invalid builder target error")
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
	if !bytes.HasPrefix(payload, processFrameMagic[:]) {
		t.Fatalf("process frame missing magic: %q", payload[:min(4, len(payload))])
	}
	if len(payload) < 8 {
		t.Fatalf("process frame too short: %d", len(payload))
	}
	metadataLength := int(binary.LittleEndian.Uint32(payload[4:8]))
	if metadataLength > len(payload)-8 {
		t.Fatalf("metadata length %d exceeds frame size %d", metadataLength, len(payload))
	}
	var result processResult
	if err := json.Unmarshal(payload[8:8+metadataLength], &result); err != nil {
		t.Fatalf("decode process metadata: %v", err)
	}
	rootBin := payload[8+metadataLength:]
	if !bytes.HasPrefix(rootBin, []byte("PCGW")) {
		t.Fatalf("rootBin missing magic: %q", rootBin[:min(4, len(rootBin))])
	}
	if result.CSS != "a { color: blue; }" {
		t.Fatalf("unexpected process css: %q", result.CSS)
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

func TestCallErrorAndWarningPaths(t *testing.T) {
	if _, err := Call(Parse, []byte(".a {"), []byte("bad.css")); err == nil {
		t.Fatal("expected parse error for unclosed rule")
	}

	encoded, err := Call(Parse, []byte("a { color: red; }"), nil)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	payload, err := Call(Stringify, encoded, []byte(`{"map":true,"mapInline":false,"mapAnnotationDisabled":true,"to":"out.css"}`))
	if err != nil {
		t.Fatalf("stringify with options: %v", err)
	}
	var mapped stringifyResult
	if err := json.Unmarshal(payload, &mapped); err != nil {
		t.Fatalf("decode mapped stringify: %v", err)
	}
	if mapped.Map == "" {
		t.Fatal("expected external source map from stringify options")
	}
	if _, err := Call(Stringify, encoded, []byte(`{`)); err == nil {
		t.Fatal("expected bad stringify options error")
	}

	if got := warnings(nil); got != nil {
		t.Fatalf("expected nil warnings for empty input, got %#v", got)
	}
	converted := warnings([]result.Warning{{Type: "warning", Text: "heads up", Plugin: "demo"}})
	if len(converted) != 1 || converted[0].Text != "heads up" || converted[0].Plugin != "demo" {
		t.Fatalf("unexpected warnings conversion: %#v", converted)
	}
}
