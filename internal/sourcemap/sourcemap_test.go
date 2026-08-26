package sourcemap

import (
	"errors"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestNewInputPathResolution(t *testing.T) {
	wantErr := errors.New("absolute path unavailable")
	tests := []struct {
		name    string
		from    string
		goos    string
		abs     func(string) (string, error)
		want    string
		wantErr error
	}{
		{
			name: "absolute path",
			from: "input.css",
			goos: "linux",
			abs: func(string) (string, error) {
				return "/repo/input.css", nil
			},
			want: "/repo/input.css",
		},
		{
			name: "native error",
			from: "input.css",
			goos: "linux",
			abs: func(string) (string, error) {
				return "", wantErr
			},
			wantErr: wantErr,
		},
		{
			name: "wasm virtual path",
			from: "styles/../input.css",
			goos: "js",
			abs: func(string) (string, error) {
				return "", wantErr
			},
			want: "input.css",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input, err := newInput("x", Options{From: test.from}, test.goos, test.abs)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("expected error %v, got %v", test.wantErr, err)
			}
			if test.wantErr != nil {
				return
			}
			if input.File != test.want {
				t.Fatalf("expected path %q, got %q", test.want, input.File)
			}
		})
	}
}

func TestNewInputPreservesWindowsDrivePaths(t *testing.T) {
	input, err := NewInput("x", Options{From: "C:\\repo\\input.css"})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	if input.File != "C:\\repo\\input.css" {
		t.Fatalf("expected Windows drive path to be preserved, got %q", input.File)
	}
}

func TestWindowsSourceMapPreservesSourcesContent(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("requires Windows path semantics")
	}

	const sourceMap = `{
		"version": 3,
		"sources": ["C:/repo/src/input.css"],
		"sourcesContent": [".a { color: red; }"],
		"names": [],
		"mappings": "AAAA"
	}`

	input, err := NewInput(".a { color: blue; }", Options{
		From:         `C:\repo\dist\output.css`,
		SourceMapURL: `C:/repo/dist/output.css.map`,
		SourceMap:    []byte(sourceMap),
	})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}

	errObj := input.Error("boom", 1, 1, "demo")
	if errObj.Source != ".a { color: red; }" {
		t.Fatalf("expected original source content, got %q", errObj.Source)
	}
}

func TestWindowsDrivePathsAreNotSourceURIs(t *testing.T) {
	if isSourceURI(`C:\repo\input.css`) {
		t.Fatal("Windows drive-letter paths must not be treated as URIs")
	}
}

func TestWindowsSourcePathKeysNormalizeSeparatorsAndCase(t *testing.T) {
	input := &Input{originContent: map[string]bool{
		sourcePathKey(`d:\repo\src\input.css`): true,
	}}
	if !input.originContentAvailable(`D:/repo/src/input.css`) {
		t.Fatal("Windows source paths with different separators or drive case must match")
	}
}

func TestNewInputFromOffsetsAndErrors(t *testing.T) {
	input, err := NewInput("\uFEFFa\nbc", Options{From: "fixtures/a.css", Document: "doc"})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	if !input.HasBOM || input.CSS != "a\nbc" || input.Document != "doc" {
		t.Fatalf("unexpected input normalization: %#v", input)
	}
	if !filepath.IsAbs(input.File) {
		t.Fatalf("expected absolute file path, got %q", input.File)
	}
	if got := input.From(); got != input.File {
		t.Fatalf("expected From to return file, got %q", got)
	}

	pos := input.FromOffset(3)
	if pos.Line != 2 || pos.Column != 2 || pos.Offset != 3 {
		t.Fatalf("unexpected position from offset: %#v", pos)
	}
	offset, err := input.FromLineAndColumn(2, 2)
	if err != nil || offset != 3 {
		t.Fatalf("unexpected line/column mapping: offset=%d err=%v", offset, err)
	}
	if _, err := input.FromLineAndColumn(9, 1); err == nil {
		t.Fatal("expected out of range line error")
	}

	errObj := input.ErrorAtOffset("boom", 2, "demo")
	if !strings.Contains(errObj.Error(), "demo:") || errObj.Line != 2 || errObj.Column != 1 {
		t.Fatalf("unexpected error object: %#v", errObj)
	}
	if got := input.String(); got != "a\nbc" {
		t.Fatalf("unexpected input string: %q", got)
	}
}

func TestNewInputWithoutFile(t *testing.T) {
	input, err := NewInput("x", Options{})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	if got := input.From(); got != "<css input>" {
		t.Fatalf("unexpected default from: %q", got)
	}
}

func TestNewInputPreservesSourceURI(t *testing.T) {
	input, err := NewInput("x", Options{From: "https://example.com/styles.css"})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	if got := input.From(); got != "https://example.com/styles.css" {
		t.Fatalf("expected source URI to be preserved, got %q", got)
	}
}

func TestInputColumnsUseUTF16CodeUnits(t *testing.T) {
	input, err := NewInput("中🔥x", Options{})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}

	pos := input.FromOffset(len("中🔥"))
	if pos.Column != 4 {
		t.Fatalf("expected UTF-16 column 4, got %#v", pos)
	}
	offset, err := input.FromLineAndColumn(1, 4)
	if err != nil || offset != len("中🔥") {
		t.Fatalf("unexpected UTF-16 column mapping: offset=%d err=%v", offset, err)
	}
	if _, err := input.FromLineAndColumn(1, 3); err == nil {
		t.Fatal("expected a column inside a surrogate pair to be rejected")
	}
}

func TestFromOffsetAscendingOnLongASCIILine(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 50_000; i++ {
		b.WriteString(".c{color:red}")
	}
	css := b.String()
	input, err := NewInput(css, Options{TrackSource: true})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	_ = input.FromOffset(0)
	if !input.asciiOnly {
		t.Fatal("expected ASCII-only input")
	}

	for offset := 0; offset <= len(css); offset += 137 {
		pos := input.FromOffset(offset)
		if pos.Line != 1 || pos.Column != offset+1 || pos.Offset != offset {
			t.Fatalf("offset %d: got %#v", offset, pos)
		}
	}
	mapped, err := input.FromLineAndColumn(1, len(css)/2+1)
	if err != nil || mapped != len(css)/2 {
		t.Fatalf("ASCII line/column mapping failed: offset=%d err=%v", mapped, err)
	}
}

func TestFromOffsetCursorOnNonASCIILine(t *testing.T) {
	css := "中文" + strings.Repeat("a", 1000) + "🔥尾"
	input, err := NewInput(css, Options{TrackSource: true})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}
	_ = input.FromOffset(0)
	if input.asciiOnly {
		t.Fatal("expected non-ASCII input")
	}

	// Ascending then a rewind, then ascending again — exercises the cursor reset path.
	offsets := []int{
		len("中"),
		len("中文"),
		len("中文") + 500,
		len("中文"),
		len(css) - len("尾"),
		len(css),
	}
	for _, offset := range offsets {
		got := input.FromOffset(offset)
		want := utf16Column(css[:offset]) + 1
		if got.Column != want {
			t.Fatalf("offset %d: column=%d want %d", offset, got.Column, want)
		}
	}
}

func TestFromOffsetCursorDoesNotCacheInsideUTF8Rune(t *testing.T) {
	css := "中a🔥尾"
	input, err := NewInput(css, Options{TrackSource: true})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}

	// Public offsets are byte offsets and may land inside a UTF-8 sequence.
	// Such a lookup must not poison a later ascending lookup at a rune boundary.
	offsets := []int{
		1,
		len("中"),
		len("中a") + 1,
		len("中a🔥"),
		len(css),
	}
	for _, offset := range offsets {
		got := input.FromOffset(offset)
		want := utf16Column(css[:offset]) + 1
		if got.Column != want {
			t.Fatalf("offset %d: column=%d want %d", offset, got.Column, want)
		}
	}
}

func TestNewInputWithSourceMap(t *testing.T) {
	const sourceMap = `{
		"version": 3,
		"file": "generated.css",
		"sourceRoot": "/src",
		"sources": ["original.css"],
		"sourcesContent": [".orig {\n  color: red;\n}"],
		"names": [],
		"mappings": "AAAA"
	}`

	input, err := NewInput(".gen{}", Options{
		From:         "generated.css",
		SourceMapURL: "generated.css.map",
		SourceMap:    []byte(sourceMap),
	})
	if err != nil {
		t.Fatalf("new input with sourcemap failed: %v", err)
	}

	errObj := input.Error("boom", 1, 1, "demo")
	if errObj.File != "/src/original.css" {
		t.Fatalf("expected mapped file, got %q", errObj.File)
	}
	if errObj.Line != 1 || errObj.Column != 1 {
		t.Fatalf("expected mapped location 1:1, got %d:%d", errObj.Line, errObj.Column)
	}
	if !strings.Contains(errObj.Source, ".orig") {
		t.Fatalf("expected original source content, got %q", errObj.Source)
	}

	loc := input.Location(Position{Line: 1, Column: 1, Offset: 0}, Position{Line: 1, Column: 2, Offset: 1})
	if loc.Input == nil || loc.Input.File != "/src/original.css" {
		t.Fatalf("expected mapped location input file, got %#v", loc.Input)
	}
	if loc.Start.Offset != 0 {
		t.Fatalf("expected mapped start offset 0, got %d", loc.Start.Offset)
	}
}

func TestNewInputComposesPreviousMapWithBackslashMapURL(t *testing.T) {
	const sourceMap = `{
		"version": 3,
		"file": "generated.css",
		"sources": ["original.css"],
		"sourcesContent": [".orig {\n  color: red;\n}"],
		"names": [],
		"mappings": "AAAA"
	}`

	input, err := NewInput(".gen{}", Options{
		From:         `C:\repo\input.css`,
		SourceMapURL: `C:\repo\input.css`,
		SourceMap:    []byte(sourceMap),
	})
	if err != nil {
		t.Fatalf("new input with backslash map URL failed: %v", err)
	}

	_, origin, line, column, ok := input.Origin(1, 1)
	if !ok {
		t.Fatal("expected previous-map origin lookup to succeed")
	}
	if origin == nil || !strings.HasSuffix(strings.ReplaceAll(origin.File, `\`, "/"), "/original.css") {
		t.Fatalf("expected origin file to end with original.css, got %#v", origin)
	}
	if line != 1 || column != 1 {
		t.Fatalf("expected origin 1:1, got %d:%d", line, column)
	}
}

func TestLocationOffsetRemappedThroughSourceMap(t *testing.T) {
	const sourceMap = `{
		"version": 3,
		"file": "generated.css",
		"sources": ["original.css"],
		"sourcesContent": [".a {\n  color: red;\n}"],
		"names": [],
		"mappings": "AAAA;EACE"
	}`

	input, err := NewInput(".a {\n  color: blue;\n}", Options{
		From:         "generated.css",
		SourceMapURL: "generated.css.map",
		SourceMap:    []byte(sourceMap),
	})
	if err != nil {
		t.Fatalf("new input failed: %v", err)
	}

	startOffset := strings.Index(input.CSS, "color")
	loc := input.Location(
		input.FromOffset(startOffset),
		input.FromOffset(startOffset+5),
	)
	if loc.Input == nil || !strings.HasSuffix(loc.Input.File, "original.css") {
		t.Fatalf("expected original.css, got %q", loc.Input.File)
	}
	if loc.Start.Line != 2 || loc.Start.Column != 3 {
		t.Fatalf("expected mapped start 2:3, got %d:%d", loc.Start.Line, loc.Start.Column)
	}

	originalCSS := ".a {\n  color: red;\n}"
	wantStartOffset := strings.Index(originalCSS, "color")
	if loc.Start.Offset != wantStartOffset {
		t.Fatalf("expected start offset %d in original source, got %d", wantStartOffset, loc.Start.Offset)
	}
}

func TestInputSourceTrackingHelpers(t *testing.T) {
	plain, err := NewInput("a{}", Options{TrackSource: true})
	if err != nil {
		t.Fatalf("new input: %v", err)
	}
	if !plain.TracksSource() {
		t.Fatal("TrackSource option should enable TracksSource")
	}
	if plain.HasSourceMap() {
		t.Fatal("plain input should not report a source map")
	}
	if !plain.SourceContentAvailable() {
		t.Fatal("nil originContent means content is treated as available")
	}

	const sourceMap = `{
		"version": 3,
		"file": "generated.css",
		"sources": ["original.css"],
		"sourcesContent": [".orig { color: red; }"],
		"names": [],
		"mappings": "AAAA"
	}`
	mapped, err := NewInput(".gen{}", Options{
		From:         "generated.css",
		SourceMapURL: "generated.css.map",
		SourceMap:    []byte(sourceMap),
	})
	if err != nil {
		t.Fatalf("mapped input: %v", err)
	}
	if !mapped.TracksSource() || !mapped.HasSourceMap() {
		t.Fatal("mapped input should track source and report HasSourceMap")
	}
	content, origin, line, column, ok := mapped.Origin(1, 1)
	if !ok || !strings.Contains(content, ".orig") || origin == nil || line != 1 || column != 1 {
		t.Fatalf("Origin failed: content=%q origin=%#v line=%d column=%d ok=%v", content, origin, line, column, ok)
	}
	if !origin.HasSourceMap() {
		t.Fatal("origin input should be marked sourceMapped")
	}
	if !mapped.SourceContentAvailable() {
		// with originContent populated and contentKnown paths
	}

	anonymous, err := NewInput("x", Options{})
	if err != nil {
		t.Fatalf("anonymous: %v", err)
	}
	if anonymous.TracksSource() {
		t.Fatal("anonymous input without trackSource should not track")
	}
}

func TestResolveMapSourceAndContentAvailability(t *testing.T) {
	raw := []byte(`{
		"version": 3,
		"sourceRoot": "https://cdn.example/root/",
		"sources": ["a.css"],
		"sourcesContent": ["body{}"],
		"sections": [{
			"map": {
				"version": 3,
				"sources": ["b.css"],
				"sourcesContent": ["html{}"],
				"mappings": "AAAA"
			}
		}],
		"mappings": "AAAA"
	}`)
	availability := sourceMapContentAvailability(raw, "file:///tmp/out.css.map", "/tmp/out.css")
	if len(availability) == 0 {
		t.Fatalf("expected content availability entries, got %#v", availability)
	}

	uri := resolveMapSource("https://example.com/a.css", "", "", "")
	if uri != "https://example.com/a.css" {
		t.Fatalf("URI source should pass through, got %q", uri)
	}
	rooted := resolveMapSource("a.css", "https://cdn.example/root/", "", "")
	if !strings.Contains(rooted, "cdn.example") {
		t.Fatalf("sourceRoot URL join failed: %q", rooted)
	}
	absRoot := resolveMapSource("a.css", "/src", "", "/tmp/out.css")
	if !strings.Contains(absRoot, "a.css") {
		t.Fatalf("absolute sourceRoot join failed: %q", absRoot)
	}
	rel := resolveMapSource("a.css", "", "", "/tmp/project/out.css")
	if !filepath.IsAbs(rel) {
		t.Fatalf("expected absolute resolved source, got %q", rel)
	}

	if got := normalizeSourcePath(`C:\repo\a.css`); !strings.Contains(got, "repo") {
		t.Fatalf("normalizeSourcePath failed: %q", got)
	}
	if offset, ok := byteOffsetForUTF16Column("ab", -1); ok || offset != 0 {
		t.Fatalf("negative UTF-16 column should fail: offset=%d ok=%v", offset, ok)
	}
	if offset := resolveOffset(&Input{CSS: ""}, 1, 1, 9); offset != 9 {
		t.Fatalf("empty CSS should use fallback offset, got %d", offset)
	}
}

func TestLocationFallsBackWhenMappedEndsDiffer(t *testing.T) {
	const sourceMap = `{
		"version": 3,
		"file": "generated.css",
		"sources": ["one.css", "two.css"],
		"sourcesContent": ["aaaa", "bbbb"],
		"names": [],
		"mappings": "AAAA,CAAC"
	}`
	input, err := NewInput("ab", Options{
		From:         "generated.css",
		SourceMapURL: "generated.css.map",
		SourceMap:    []byte(sourceMap),
	})
	if err != nil {
		t.Fatalf("new input: %v", err)
	}
	loc := input.Location(Position{Line: 1, Column: 1, Offset: 0}, Position{Line: 1, Column: 2, Offset: 1})
	if loc == nil || loc.Input == nil {
		t.Fatalf("expected location, got %#v", loc)
	}
}

func TestFromOffsetClampsAndOriginMiss(t *testing.T) {
	input, err := NewInput("ab\nc", Options{})
	if err != nil {
		t.Fatalf("new input: %v", err)
	}
	if got := input.FromOffset(-5); got.Offset != 0 {
		t.Fatalf("negative offset should clamp, got %#v", got)
	}
	if got := input.FromOffset(100); got.Offset != len(input.CSS) {
		t.Fatalf("large offset should clamp, got %#v", got)
	}
	if _, _, _, _, ok := input.Origin(1, 1); ok {
		t.Fatal("Origin without consumer should miss")
	}
}

func TestResolveOriginFileVariants(t *testing.T) {
	const sourceMap = `{
		"version": 3,
		"sources": ["original.css"],
		"sourcesContent": [".a{}"],
		"mappings": "AAAA"
	}`
	input, err := NewInput(".g{}", Options{
		From:         "generated.css",
		SourceMapURL: "file:///tmp/maps/generated.css.map",
		SourceMap:    []byte(sourceMap),
	})
	if err != nil {
		t.Fatalf("new input: %v", err)
	}
	if got := input.resolveOriginFile("file:///tmp/src/original.css"); !strings.Contains(got, "original.css") {
		t.Fatalf("file URI origin resolve failed: %q", got)
	}
	if got := input.resolveOriginFile("https://example.com/a.css"); got != "https://example.com/a.css" {
		t.Fatalf("http origin should pass through: %q", got)
	}
	if got := input.resolveOriginFile("/abs/original.css"); !strings.Contains(got, "original.css") {
		t.Fatalf("absolute origin failed: %q", got)
	}
}
