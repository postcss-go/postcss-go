package codec_test

import (
	"encoding/json"
	"testing"

	"postcss-go/benchmark"
	"postcss-go/internal/codec"
	"postcss-go/internal/jsbridge"
	"postcss-go/internal/parser"
	"postcss-go/internal/sourcemap"
)

func TestCodecRoundTripFixtures(t *testing.T) {
	ids := []string{"ModernNormalize", "TailwindPreflight", "AnimateMin", "Bootstrap"}
	for _, id := range ids {
		t.Run(id, func(t *testing.T) {
			fixture, err := benchmark.RealWorldFixtureByID(id)
			if err != nil {
				t.Fatalf("fixture: %v", err)
			}
			root, err := parser.Parse(fixture.CSS, sourcemap.Options{From: id + ".css", TrackSource: true})
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			dto, err := jsbridge.ToDTO(root)
			if err != nil {
				t.Fatalf("ToDTO: %v", err)
			}
			encoded, err := codec.EncodeDTO(dto)
			if err != nil {
				t.Fatalf("EncodeDTO: %v", err)
			}
			decoded, err := codec.DecodeDTO(encoded)
			if err != nil {
				t.Fatalf("DecodeDTO: %v", err)
			}
			assertDTOEqual(t, dto, decoded)

			jsonBytes, err := json.Marshal(dto)
			if err != nil {
				t.Fatalf("json: %v", err)
			}
			t.Logf("css=%d json=%d binary=%d (%.1f%% of json)",
				len(fixture.CSS), len(jsonBytes), len(encoded),
				100*float64(len(encoded))/float64(len(jsonBytes)))
		})
	}
}

func TestCodecASTRoundTrip(t *testing.T) {
	css := ".a { color: red !important; }\n@media x {}\n/* hi */\n"
	root, err := parser.Parse(css, sourcemap.Options{From: "x.css", TrackSource: true})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want, err := jsbridge.ToDTO(root)
	if err != nil {
		t.Fatalf("ToDTO: %v", err)
	}
	encoded, err := codec.EncodeAST(root)
	if err != nil {
		t.Fatalf("EncodeAST: %v", err)
	}
	got, err := codec.DecodeDTO(encoded)
	if err != nil {
		t.Fatalf("DecodeDTO: %v", err)
	}
	assertDTOEqual(t, want, got)

	// DecodeAST must rebuild a tree Go can stringify; column adjustments in
	// ToDTO are one-way, so we do not require ToDTO(DecodeAST(x)) == ToDTO(x).
	decoded, err := codec.DecodeAST(encoded)
	if err != nil {
		t.Fatalf("DecodeAST: %v", err)
	}
	if decoded == nil || decoded.Type() != "root" {
		t.Fatalf("expected root, got %#v", decoded)
	}

	// EncodeAST must match EncodeDTO(ToDTO) semantically (round-trip through DecodeDTO).
	direct, err := codec.EncodeAST(root)
	if err != nil {
		t.Fatalf("EncodeAST: %v", err)
	}
	fromDirect, err := codec.DecodeDTO(direct)
	if err != nil {
		t.Fatalf("DecodeDTO(EncodeAST): %v", err)
	}
	assertDTOEqual(t, want, fromDirect)
}

func TestCodecRejectsBadMagic(t *testing.T) {
	if _, err := codec.DecodeDTO([]byte("XXXX\x01")); err == nil {
		t.Fatal("expected bad magic error")
	}
}

func assertDTOEqual(t *testing.T, want, got *jsbridge.NodeDTO) {
	t.Helper()
	wantJSON, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("marshal want: %v", err)
	}
	gotJSON, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal got: %v", err)
	}
	if string(wantJSON) != string(gotJSON) {
		t.Fatalf("dto mismatch\nwant: %s\ngot:  %s", wantJSON, gotJSON)
	}
}
