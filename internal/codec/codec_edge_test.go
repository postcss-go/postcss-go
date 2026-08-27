package codec_test

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/codec"
	"github.com/postcss-go/postcss-go/internal/jsbridge"
	"github.com/postcss-go/postcss-go/internal/parser"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
)

func TestEncodeNilRoots(t *testing.T) {
	if _, err := codec.EncodeDTO(nil); err == nil {
		t.Fatal("EncodeDTO(nil) should fail")
	}
	if _, err := codec.EncodeAST(nil); err == nil {
		t.Fatal("EncodeAST(nil) should fail")
	}
}

func TestCodecDocumentRoundTrip(t *testing.T) {
	doc := ast.NewDocument()
	rootA := ast.NewRoot()
	rootA.Append(ast.NewRule(".a"))
	rootB := ast.NewRoot()
	rootB.Append(ast.NewComment("b"))
	doc.Append(rootA, rootB)
	doc.RawFormatting()["after"] = "\n"

	encoded, err := codec.EncodeAST(doc)
	if err != nil {
		t.Fatalf("EncodeAST: %v", err)
	}
	decoded, err := codec.DecodeAST(encoded)
	if err != nil {
		t.Fatalf("DecodeAST: %v", err)
	}
	got, ok := decoded.(*ast.Document)
	if !ok {
		t.Fatalf("expected Document, got %T", decoded)
	}
	if len(got.Children()) != 2 {
		t.Fatalf("expected 2 roots, got %d", len(got.Children()))
	}
	if got.RawFormattingReadOnly()["after"] != "\n" {
		t.Fatalf("expected after raw, got %#v", got.RawFormattingReadOnly()["after"])
	}

	dto := &jsbridge.NodeDTO{
		Type: string(ast.NodeDocument),
		Nodes: []*jsbridge.NodeDTO{
			{Type: string(ast.NodeRoot)},
			{Type: string(ast.NodeRoot), Nodes: []*jsbridge.NodeDTO{
				{Type: string(ast.NodeComment), Text: "x"},
			}},
		},
	}
	dtoEncoded, err := codec.EncodeDTO(dto)
	if err != nil {
		t.Fatalf("EncodeDTO: %v", err)
	}
	dtoDecoded, err := codec.DecodeDTO(dtoEncoded)
	if err != nil {
		t.Fatalf("DecodeDTO: %v", err)
	}
	assertDTOEqual(t, dto, dtoDecoded)
}

func TestCodecRawValueTypesRoundTrip(t *testing.T) {
	var nilRaw *ast.RawValue
	dto := &jsbridge.NodeDTO{
		Type: string(ast.NodeRoot),
		Raws: ast.Raws{
			"nil":     nil,
			"str":     "hello",
			"t":       true,
			"f":       false,
			"i":       42,
			"i64":     int64(-7),
			"flt":     1.5,
			"rv":      ast.RawValue{Raw: "a /*c*/", Value: "a"},
			"rvPtr":   &ast.RawValue{Raw: "b", Value: "b"},
			"nilPtr":  nilRaw,
			"nested":  map[string]any{"k": "v", "n": nil, "b": true},
			"list":    []any{"x", false, 3, ast.RawValue{Raw: "r", Value: "v"}},
			"emptyM":  map[string]any{},
			"emptyL":  []any{},
			"between": ":",
		},
		Nodes: []*jsbridge.NodeDTO{
			{
				Type:     string(ast.NodeRule),
				Selector: ".a",
				Raws:     ast.Raws{"ownSemicolon": ";"},
				Source: &jsbridge.SourceLocationDTO{
					Start:  jsbridge.SourcePositionDTO{Line: 1, Column: 1, Offset: 0},
					End:    jsbridge.SourcePositionDTO{Line: 1, Column: 4, Offset: 3},
					File:   "a.css",
					CSS:    ".a{}",
					Map:    "{}",
					MapURL: "a.css.map",
				},
			},
			{
				Type:   string(ast.NodeAtRule),
				Name:   "media",
				Params: "screen",
				Block:  true,
				Nodes: []*jsbridge.NodeDTO{
					{Type: string(ast.NodeDecl), Prop: "color", Value: "red", Important: true},
				},
			},
			{
				Type:   string(ast.NodeAtRule),
				Name:   "import",
				Params: `"x.css"`,
				Block:  false,
			},
			{
				Type: string(ast.NodeComment),
				Text: "hi",
				Source: &jsbridge.SourceLocationDTO{
					Start: jsbridge.SourcePositionDTO{Line: 2, Column: 1, Offset: 5},
					End:   jsbridge.SourcePositionDTO{Line: 2, Column: 8, Offset: 12},
					File:  "a.css",
					CSS:   "/* hi */",
				},
			},
		},
	}

	encoded, err := codec.EncodeDTO(dto)
	if err != nil {
		t.Fatalf("EncodeDTO: %v", err)
	}
	decoded, err := codec.DecodeDTO(encoded)
	if err != nil {
		t.Fatalf("DecodeDTO: %v", err)
	}

	raws := decoded.Raws
	if raws["nil"] != nil {
		t.Fatalf("nil raw: %#v", raws["nil"])
	}
	if raws["str"] != "hello" || raws["t"] != true || raws["f"] != false {
		t.Fatalf("scalar raws: %#v", raws)
	}
	if raws["i"] != 42 {
		t.Fatalf("int: %#v", raws["i"])
	}
	if raws["i64"] != -7 {
		t.Fatalf("int64: %#v", raws["i64"])
	}
	if f, ok := raws["flt"].(float64); !ok || f != 1.5 {
		t.Fatalf("float: %#v", raws["flt"])
	}
	if rv, ok := raws["rv"].(ast.RawValue); !ok || rv.Raw != "a /*c*/" || rv.Value != "a" {
		t.Fatalf("RawValue: %#v", raws["rv"])
	}
	if rv, ok := raws["rvPtr"].(ast.RawValue); !ok || rv.Raw != "b" {
		t.Fatalf("*RawValue: %#v", raws["rvPtr"])
	}
	if raws["nilPtr"] != nil {
		t.Fatalf("nil *RawValue: %#v", raws["nilPtr"])
	}
	nested, ok := raws["nested"].(map[string]any)
	if !ok || nested["k"] != "v" || nested["n"] != nil || nested["b"] != true {
		t.Fatalf("map: %#v", raws["nested"])
	}
	list, ok := raws["list"].([]any)
	if !ok || len(list) != 4 {
		t.Fatalf("list: %#v", raws["list"])
	}
	if decoded.Nodes[0].Source == nil || decoded.Nodes[0].Source.MapURL != "a.css.map" {
		t.Fatalf("source fields: %#v", decoded.Nodes[0].Source)
	}
	if !decoded.Nodes[1].Block || !decoded.Nodes[1].Nodes[0].Important {
		t.Fatalf("at-rule/decl flags: %#v", decoded.Nodes[1])
	}
}

func TestEncodeUnsupportedRawAndNode(t *testing.T) {
	dto := &jsbridge.NodeDTO{
		Type: string(ast.NodeRoot),
		Raws: ast.Raws{"bad": struct{}{}},
	}
	if _, err := codec.EncodeDTO(dto); err == nil {
		t.Fatal("expected unsupported raw value error")
	}
	dto = &jsbridge.NodeDTO{Type: "unknown"}
	if _, err := codec.EncodeDTO(dto); err == nil {
		t.Fatal("expected unsupported node type error")
	}
	if _, err := codec.EncodeDTO(&jsbridge.NodeDTO{
		Type:  string(ast.NodeRoot),
		Nodes: []*jsbridge.NodeDTO{nil},
	}); err == nil {
		t.Fatal("expected nil child node error")
	}
}

func TestEncodeASTOwnSemicolonAndCommentSourceMap(t *testing.T) {
	css := ".a {} ;\n/* c */"
	root, err := parser.Parse(css, sourcemap.Options{From: "x.css", TrackSource: true})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	rule := root.First().(*ast.Rule)
	rule.RawFormatting()["ownSemicolon"] = ";"
	encoded, err := codec.EncodeAST(root)
	if err != nil {
		t.Fatalf("EncodeAST: %v", err)
	}
	decoded, err := codec.DecodeDTO(encoded)
	if err != nil {
		t.Fatalf("DecodeDTO: %v", err)
	}
	if decoded.Nodes[0].Raws["ownSemicolon"] != ";" {
		t.Fatalf("ownSemicolon lost: %#v", decoded.Nodes[0].Raws)
	}
	decodedAST, err := codec.DecodeAST(encoded)
	if err != nil {
		t.Fatalf("DecodeAST: %v", err)
	}
	if decodedAST.Type() != "root" {
		t.Fatalf("expected root, got %s", decodedAST.Type())
	}
}

func TestDecodeRejectsCorruptPayloads(t *testing.T) {
	header := []byte{'P', 'C', 'G', 'W', 1}

	tests := []struct {
		name string
		src  []byte
	}{
		{name: "bad version", src: []byte{'P', 'C', 'G', 'W', 99, 1}},
		{name: "truncated after header", src: append([]byte{}, header...)},
		{name: "unknown tag", src: append(append([]byte{}, header...), 99)},
		{name: "trailing bytes", src: func() []byte {
			encoded, err := codec.EncodeDTO(&jsbridge.NodeDTO{Type: string(ast.NodeRoot)})
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			return append(encoded, 0)
		}()},
		{name: "truncated string", src: append(append([]byte{}, header...), tagRuleBytes(t, true)...)},
		{name: "unknown raw tag", src: rootWithRawTag(t, 99)},
		{name: "truncated float", src: rootWithTruncatedFloat(t)},
		{name: "truncated int", src: append(append([]byte{}, header...), 1 /*root*/, 0 /*raws*/, 1 /*source present*/)},
		{name: "truncated uvarint", src: append(append([]byte{}, header...), 1, 0xff)},
		{name: "truncated bool raw", src: rootWithRawTag(t, 2 /*rawBool*/)},
		{name: "truncated map count", src: rootWithRawPrefix(t, []byte{6 /*rawMap*/, 0xff})},
		{name: "truncated list count", src: rootWithRawPrefix(t, []byte{7 /*rawList*/, 0xff})},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := codec.DecodeDTO(test.src); err == nil {
				t.Fatal("DecodeDTO expected error")
			}
			if _, err := codec.DecodeAST(test.src); err == nil {
				t.Fatal("DecodeAST expected error")
			}
		})
	}
}

func TestDecodeASTPartialNodeErrors(t *testing.T) {
	src := append([]byte{'P', 'C', 'G', 'W', 1, 3 /*rule*/}, encodeUvarint(10)...)
	if _, err := codec.DecodeAST(src); err == nil {
		t.Fatal("expected truncated rule selector")
	}
	src = append([]byte{'P', 'C', 'G', 'W', 1, 4 /*at-rule*/}, encodeUvarint(10)...)
	if _, err := codec.DecodeAST(src); err == nil {
		t.Fatal("expected truncated at-rule name")
	}
	src = append([]byte{'P', 'C', 'G', 'W', 1, 5 /*decl*/}, encodeUvarint(10)...)
	if _, err := codec.DecodeAST(src); err == nil {
		t.Fatal("expected truncated decl prop")
	}
	src = append([]byte{'P', 'C', 'G', 'W', 1, 6 /*comment*/}, encodeUvarint(10)...)
	if _, err := codec.DecodeAST(src); err == nil {
		t.Fatal("expected truncated comment text")
	}

	// Mid-node truncations for rule / at-rule / decl / comment error returns.
	nodes := []ast.Node{
		func() ast.Node {
			r := ast.NewRule(".abc")
			r.Append(ast.NewDeclaration("color", "red"))
			return r
		}(),
		func() ast.Node {
			a := ast.NewAtRule("media", "screen")
			a.Block = true
			a.Append(ast.NewRule(".a"))
			return a
		}(),
		ast.NewDeclaration("color", "blue"),
		ast.NewComment("hi"),
	}
	for _, node := range nodes {
		full, err := codec.EncodeAST(node)
		if err != nil {
			t.Fatalf("encode %T: %v", node, err)
		}
		for cut := len(full) - 1; cut >= 5; cut-- {
			if _, err := codec.DecodeAST(full[:cut]); err == nil {
				t.Fatalf("%T prefix len %d unexpectedly decoded", node, cut)
			}
		}
	}

	root := ast.NewRoot()
	root.Append(ast.NewRule(".a"))
	full, err := codec.EncodeAST(root)
	if err != nil {
		t.Fatalf("encode root: %v", err)
	}
	for cut := len(full) - 1; cut >= 5; cut-- {
		if _, err := codec.DecodeAST(full[:cut]); err == nil {
			t.Fatalf("root prefix len %d unexpectedly decoded", cut)
		}
	}
}

func TestDecodeSourceFieldTruncations(t *testing.T) {
	// Build a root with a full source, then chop fields off the end of the
	// source payload after the presence flag.
	dto := &jsbridge.NodeDTO{
		Type: string(ast.NodeRoot),
		Source: &jsbridge.SourceLocationDTO{
			Start:  jsbridge.SourcePositionDTO{Line: 1, Column: 2, Offset: 3},
			End:    jsbridge.SourcePositionDTO{Line: 4, Column: 5, Offset: 6},
			File:   "a.css",
			CSS:    "body{}",
			Map:    "{}",
			MapURL: "a.css.map",
		},
	}
	full, err := codec.EncodeDTO(dto)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	// Header(5) + tagRoot(1) + raws(1) + sourceFlag(1) = 8; truncate inside source.
	for cut := 8; cut < len(full); cut++ {
		if _, err := codec.DecodeDTO(full[:cut]); err == nil {
			t.Fatalf("source prefix len %d unexpectedly decoded", cut)
		}
	}
}

func TestDecodeDTOChildAndSourceErrors(t *testing.T) {
	// Root with child count 1 but no child payload.
	src := append([]byte{'P', 'C', 'G', 'W', 1, 1 /*root*/, 0 /*raws*/, 0 /*no source*/}, encodeUvarint(1)...)
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("expected missing child error")
	}
	if _, err := codec.DecodeAST(src); err == nil {
		t.Fatal("expected missing child error")
	}

	// Document with truncated raws key.
	src = append([]byte{'P', 'C', 'G', 'W', 1, 2 /*document*/}, encodeUvarint(1)...)
	src = append(src, encodeUvarint(5)...) // key length without bytes
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("expected truncated raws key")
	}

	// Source present but truncated after start line.
	src = append([]byte{'P', 'C', 'G', 'W', 1, 1, 0, 1 /*source*/}, encodeVarint(1)...)
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("expected truncated source")
	}

	// Raw map with key but missing value.
	src = rootWithRawPrefix(t, append([]byte{6 /*map*/}, encodeUvarint(1)...))
	src = append(src, encodeString("k")...)
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("expected truncated map value")
	}

	// Raw list with missing item.
	src = rootWithRawPrefix(t, append([]byte{7 /*list*/}, encodeUvarint(1)...))
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("expected truncated list item")
	}

	// RawValue missing value string.
	src = rootWithRawPrefix(t, append([]byte{3 /*rawRawValue*/}, encodeString("raw")...))
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("expected truncated RawValue value")
	}
}

func TestEncodeNestedRawEncodeErrors(t *testing.T) {
	dto := &jsbridge.NodeDTO{
		Type: string(ast.NodeRoot),
		Raws: ast.Raws{
			"m": map[string]any{"bad": make(chan int)},
		},
	}
	if _, err := codec.EncodeDTO(dto); err == nil {
		t.Fatal("expected nested map encode error")
	}
	dto = &jsbridge.NodeDTO{
		Type: string(ast.NodeRoot),
		Raws: ast.Raws{
			"l": []any{make(chan int)},
		},
	}
	if _, err := codec.EncodeDTO(dto); err == nil {
		t.Fatal("expected nested list encode error")
	}
}

func TestEncodeASTRawsErrorsPerNodeKind(t *testing.T) {
	bad := ast.Raws{"x": make(chan int)}
	cases := []ast.Node{
		func() ast.Node {
			d := ast.NewDocument()
			d.Raws = bad
			return d
		}(),
		func() ast.Node {
			r := ast.NewRoot()
			r.Raws = bad
			return r
		}(),
		func() ast.Node {
			r := ast.NewRule(".a")
			r.Raws = bad
			return r
		}(),
		func() ast.Node {
			a := ast.NewAtRule("media", "x")
			a.Block = true
			a.Raws = bad
			return a
		}(),
		func() ast.Node {
			a := ast.NewAtRule("import", "x")
			a.Raws = bad
			return a
		}(),
		func() ast.Node {
			d := ast.NewDeclaration("color", "red")
			d.Raws = bad
			return d
		}(),
		func() ast.Node {
			d := ast.NewDeclaration("color", "red")
			d.Important = true
			d.Raws = bad
			return d
		}(),
		func() ast.Node {
			c := ast.NewComment("c")
			c.Raws = bad
			return c
		}(),
	}
	for _, node := range cases {
		if _, err := codec.EncodeAST(node); err == nil {
			t.Fatalf("expected encode raws error for %T", node)
		}
	}

	root := ast.NewRoot()
	child := ast.NewRule(".a")
	child.Raws = bad
	root.Append(child)
	if _, err := codec.EncodeAST(root); err == nil {
		t.Fatal("expected encodeASTChildren error")
	}
}

func TestDecodeDocumentAndFieldTruncation(t *testing.T) {
	// Document tag then truncated raws.
	src := []byte{'P', 'C', 'G', 'W', 1, 2 /*document*/, 0xff}
	if _, err := codec.DecodeAST(src); err == nil {
		t.Fatal("truncated document raws")
	}
	// Document with raws ok, truncated source.
	src = []byte{'P', 'C', 'G', 'W', 1, 2, 0, 1}
	if _, err := codec.DecodeAST(src); err == nil {
		t.Fatal("truncated document source")
	}
	// Document with source absent, truncated children count.
	src = []byte{'P', 'C', 'G', 'W', 1, 2, 0, 0, 0xff}
	if _, err := codec.DecodeAST(src); err == nil {
		t.Fatal("truncated document children")
	}

	// DTO at-rule truncated name/params/flag.
	src = append([]byte{'P', 'C', 'G', 'W', 1, 4}, encodeUvarint(3)...)
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("truncated at-rule name")
	}
	src = append([]byte{'P', 'C', 'G', 'W', 1, 4}, encodeString("media")...)
	src = append(src, encodeUvarint(4)...)
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("truncated at-rule params")
	}
	src = append([]byte{'P', 'C', 'G', 'W', 1, 4}, encodeString("media")...)
	src = append(src, encodeString("x")...)
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("truncated at-rule flag")
	}

	// DTO decl truncated prop/value/flag.
	src = append([]byte{'P', 'C', 'G', 'W', 1, 5}, encodeUvarint(3)...)
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("truncated decl prop")
	}
	src = append([]byte{'P', 'C', 'G', 'W', 1, 5}, encodeString("color")...)
	src = append(src, encodeUvarint(3)...)
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("truncated decl value")
	}
	src = append([]byte{'P', 'C', 'G', 'W', 1, 5}, encodeString("color")...)
	src = append(src, encodeString("red")...)
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("truncated decl flag")
	}

	// Root with truncated children uvarint after valid empty-ish prefix.
	src = []byte{'P', 'C', 'G', 'W', 1, 1, 0, 0, 0xff}
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("truncated children count")
	}

	// RawValue truncated raw string.
	src = rootWithRawPrefix(t, append([]byte{3}, encodeUvarint(4)...))
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("truncated RawValue raw")
	}

	// Map entry truncated key.
	src = rootWithRawPrefix(t, append([]byte{6}, encodeUvarint(1)...))
	src = append(src, encodeUvarint(3)...)
	if _, err := codec.DecodeDTO(src); err == nil {
		t.Fatal("truncated map key")
	}
}

func TestDecodeFloatAndBoolRawValues(t *testing.T) {
	buf := bytes.NewBuffer(nil)
	buf.Write([]byte{'P', 'C', 'G', 'W', 1, 1 /*root*/})
	buf.Write(encodeUvarint(2)) // two raws
	buf.Write(encodeString("flt"))
	buf.WriteByte(5) // rawFloat
	var bits [8]byte
	binary.BigEndian.PutUint64(bits[:], math.Float64bits(2.25))
	buf.Write(bits[:])
	buf.Write(encodeString("ok"))
	buf.WriteByte(2) // rawBool
	buf.WriteByte(1)
	buf.WriteByte(0)            // no source
	buf.Write(encodeUvarint(0)) // no children

	decoded, err := codec.DecodeDTO(buf.Bytes())
	if err != nil {
		t.Fatalf("DecodeDTO: %v", err)
	}
	if f, ok := decoded.Raws["flt"].(float64); !ok || f != 2.25 {
		t.Fatalf("float raw: %#v", decoded.Raws["flt"])
	}
	if decoded.Raws["ok"] != true {
		t.Fatalf("bool raw: %#v", decoded.Raws["ok"])
	}
}

func encodeUvarint(v uint64) []byte {
	buf := make([]byte, binary.MaxVarintLen64)
	n := binary.PutUvarint(buf, v)
	return buf[:n]
}

func encodeVarint(v int64) []byte {
	buf := make([]byte, binary.MaxVarintLen64)
	n := binary.PutVarint(buf, v)
	return buf[:n]
}

func encodeString(s string) []byte {
	out := encodeUvarint(uint64(len(s)))
	return append(out, s...)
}

func tagRuleBytes(t *testing.T, truncated bool) []byte {
	t.Helper()
	out := []byte{3} // rule
	out = append(out, encodeUvarint(4)...)
	if !truncated {
		out = append(out, ".abc"...)
	}
	return out
}

func rootWithRawTag(t *testing.T, tag byte) []byte {
	t.Helper()
	return rootWithRawPrefix(t, []byte{tag})
}

func rootWithRawPrefix(t *testing.T, rawPayload []byte) []byte {
	t.Helper()
	out := []byte{'P', 'C', 'G', 'W', 1, 1 /*root*/}
	out = append(out, encodeUvarint(1)...) // one raw entry
	out = append(out, encodeString("k")...)
	out = append(out, rawPayload...)
	return out
}

func rootWithTruncatedFloat(t *testing.T) []byte {
	t.Helper()
	return rootWithRawPrefix(t, []byte{5, 1, 2, 3}) // rawFloat + <8 bytes
}
