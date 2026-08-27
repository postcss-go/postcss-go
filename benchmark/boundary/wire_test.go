package boundary

import (
	"encoding/json"
	"testing"

	"github.com/postcss-go/postcss-go/internal/jsbridge"
)

// BenchmarkGoWire measures every stage the Go side pays today to hand one AST
// to JavaScript (`parse`) and take it back (`stringify`), against a compact
// binary encoding of the same tree.
//
// The pairs that are directly comparable:
//
//	ToDTO + JSONMarshal        vs  BinaryEncode
//	JSONUnmarshal + FromDTO    vs  BinaryDecodeToAST
func BenchmarkGoWire(b *testing.B) {
	for _, f := range fixtures(b) {
		b.Run(f.name, func(b *testing.B) {
			root := mustParse(b, f.css)
			dto, err := jsbridge.ToDTO(root)
			if err != nil {
				b.Fatalf("ToDTO: %v", err)
			}
			encoded, err := json.Marshal(dto)
			if err != nil {
				b.Fatalf("Marshal: %v", err)
			}
			binary := encodeBinary(nil, root)

			printMetric(
				"before — current JSON DTO path",
				"ToDTO → JSONMarshal → JSONUnmarshal → FromDTO.",
				"Sum ToDTO+JSONMarshal for encode; JSONUnmarshal+FromDTO for decode.",
			)

			b.Run("ToDTO", func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					_, _ = jsbridge.ToDTO(root)
				}
			})
			b.Run("JSONMarshal", func(b *testing.B) {
				b.SetBytes(int64(len(encoded)))
				b.ReportAllocs()
				for b.Loop() {
					_, _ = json.Marshal(dto)
				}
			})
			b.Run("JSONUnmarshal", func(b *testing.B) {
				b.SetBytes(int64(len(encoded)))
				b.ReportAllocs()
				for b.Loop() {
					var out jsbridge.NodeDTO
					_ = json.Unmarshal(encoded, &out)
				}
			})
			b.Run("FromDTO", func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					_, _ = jsbridge.FromDTO(dto)
				}
			})

			printMetric(
				"after — proposed binary path",
				"BinaryEncode → BinaryScan / BinaryDecodeToAST.",
				"Compare BinaryEncode vs ToDTO+JSONMarshal;",
				"compare BinaryDecodeToAST vs JSONUnmarshal+FromDTO.",
			)

			b.Run("BinaryEncode", func(b *testing.B) {
				buf := make([]byte, 0, len(binary))
				b.SetBytes(int64(len(binary)))
				b.ReportAllocs()
				for b.Loop() {
					_ = encodeBinary(buf[:0], root)
				}
			})
			b.Run("BinaryScan", func(b *testing.B) {
				b.SetBytes(int64(len(binary)))
				b.ReportAllocs()
				for b.Loop() {
					_ = decodeBinaryCount(binary)
				}
			})
			b.Run("BinaryDecodeToAST", func(b *testing.B) {
				b.SetBytes(int64(len(binary)))
				b.ReportAllocs()
				for b.Loop() {
					_ = decodeBinaryToAST(binary)
				}
			})
		})
	}
}

// TestBinaryCodec checks the codec round-trips every fixture and reports the
// payload sizes, which drive both the JSON cost and how much data JavaScript
// has to walk on the other side.
func TestBinaryCodec(t *testing.T) {
	printMetric(
		"BinaryCodec — payload sizes (css vs json vs binary)",
		"Smaller payloads cost less to encode, move, and walk on the JS side.",
		"Columns: css bytes, json bytes (+ratio to css), binary bytes (+ratio to css / json), nodes.",
	)

	for _, f := range fixtures(t) {
		t.Run(f.name, func(t *testing.T) {
			root := mustParse(t, f.css)
			want := countNodes(root)

			dto, err := jsbridge.ToDTO(root)
			if err != nil {
				t.Fatalf("ToDTO: %v", err)
			}
			encoded, err := json.Marshal(dto)
			if err != nil {
				t.Fatalf("Marshal: %v", err)
			}
			binary := encodeBinary(nil, root)

			if got := decodeBinaryCount(binary); got != want {
				t.Errorf("binary scan saw %d nodes, want %d", got, want)
			}
			if got := countNodes(decodeBinaryToAST(binary)); got != want {
				t.Errorf("binary decode built %d nodes, want %d", got, want)
			}

			t.Logf(
				"css=%7d  json=%8d (%4.1fx css)  binary=%8d (%4.1fx css, %4.1f%% of json)  nodes=%6d",
				len(f.css), len(encoded), float64(len(encoded))/float64(len(f.css)),
				len(binary), float64(len(binary))/float64(len(f.css)),
				100*float64(len(binary))/float64(len(encoded)), want,
			)
		})
	}
}
