package stringifier

import "testing"

func TestClearSourceMapAnnotationsPreservesTrailingContent(t *testing.T) {
	css := ".foo { color: red }\n\n/*# sourceMappingURL=data:application/json;base64,e30= */\n"
	got := ClearSourceMapAnnotations(css)
	want := ".foo { color: red }"
	if got != want {
		t.Fatalf("unexpected cleared CSS:\n got: %q\nwant: %q", got, want)
	}
}

func TestClearSourceMapAnnotationsRemovesSameLineSpacing(t *testing.T) {
	got := ClearSourceMapAnnotations("a{} /*# sourceMappingURL=x.map */")
	if got != "a{}" {
		t.Fatalf("unexpected same-line clear: %q", got)
	}
	got = ClearSourceMapAnnotations("a{}\r\n/*# sourceMappingURL=x.map */")
	if got != "a{}" {
		t.Fatalf("unexpected CRLF clear: %q", got)
	}
}

func TestNoWorkSourceMapUsesInputLineEnding(t *testing.T) {
	result, err := NoWorkWithSourceMap("a {\r\n}", "", SourceMapOptions{
		From: "a.css",
		To:   "b.css",
	})
	if err != nil {
		t.Fatalf("generate no-work map: %v", err)
	}
	if got, want := result.CSS+SourceMapEOL(result.CSS)+"/* map */", "a {\r\n}\r\n/* map */"; got != want {
		t.Fatalf("unexpected annotation line ending: %q", got)
	}
}
