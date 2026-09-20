package asthandle

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/postcss-go/postcss-go/internal/sourcemap"
	"github.com/postcss-go/postcss-go/internal/stringifier"
)

func TestStructuralMutationsAndFactories(t *testing.T) {
	session, root, err := Parse(".a { color: red }")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	rule, err := session.NewRule(".b")
	if err != nil {
		t.Fatal(err)
	}
	decl, err := session.NewDecl("display", "flex")
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Append(rule, decl); err != nil {
		t.Fatal(err)
	}
	if err := session.Prepend(root, rule); err != nil {
		t.Fatal(err)
	}
	comment, err := session.NewComment("note")
	if err != nil {
		t.Fatal(err)
	}
	if err := session.InsertAfter(rule, comment); err != nil {
		t.Fatal(err)
	}
	replacement, err := session.NewRule(".c")
	if err != nil {
		t.Fatal(err)
	}
	if err := session.ReplaceWith(comment, replacement); err != nil {
		t.Fatal(err)
	}
	if err := session.InsertAfter(replacement, replacement); err != nil {
		t.Fatal("inserting a node after itself should be a no-op")
	}

	css, err := session.Stringify(root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(css, ".b") || !strings.Contains(css, ".c") {
		t.Fatalf("unexpected css after mutations: %q", css)
	}

	declHandle, err := session.ChildAt(rule, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Prepend(declHandle, rule); !errors.Is(err, ErrNotContainer) && !errors.Is(err, ErrCycle) {
		t.Fatalf("expected not-container or cycle, got %v", err)
	}
	if err := session.Prepend(root, root); !errors.Is(err, ErrCycle) {
		t.Fatalf("expected cycle, got %v", err)
	}
	if err := session.InsertAfter(0, rule); err == nil {
		t.Fatal("invalid insert-after target accepted")
	}
	if err := session.InsertAfter(rule, 0); err == nil {
		t.Fatal("invalid insert-after child accepted")
	}
	if err := session.InsertAfter(decl, root); !errors.Is(err, ErrCycle) {
		t.Fatalf("expected cycle inserting root after decl, got %v", err)
	}
	if err := session.ReplaceWith(rule, 0); err == nil {
		t.Fatal("invalid replace child accepted")
	}
	if err := session.ReplaceWith(0); err == nil {
		t.Fatal("invalid replace target accepted")
	}

	session.Close()
	if _, err := session.NewRule(".z"); !errors.Is(err, ErrClosed) {
		t.Fatal(err)
	}
	if _, err := session.NewAtRule("media", "screen"); !errors.Is(err, ErrClosed) {
		t.Fatal(err)
	}
	if _, err := session.NewComment("x"); !errors.Is(err, ErrClosed) {
		t.Fatal(err)
	}
}

func TestRawPatchesStringifyMapAndSnapshots(t *testing.T) {
	session, root, err := Parse(".a { color: red }")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	rule, err := session.ChildAt(root, 0)
	if err != nil {
		t.Fatal(err)
	}

	if err := session.SetRaw(rule, RawPatch{Key: "before", Kind: "string", Value: json.RawMessage(`"\n"`)}); err != nil {
		t.Fatal(err)
	}
	if err := session.SetRaw(rule, RawPatch{Key: "semicolon", Kind: "bool", Value: json.RawMessage(`true`)}); err != nil {
		t.Fatal(err)
	}
	if err := session.SetRaw(rule, RawPatch{
		Key:   "between",
		Kind:  "value",
		Value: json.RawMessage(`{"raw":" : ","value":":"}`),
	}); err != nil {
		t.Fatal(err)
	}
	if err := session.SetRaw(rule, RawPatch{Key: "empty", Kind: ""}); err != nil {
		t.Fatal(err)
	}
	if err := session.SetRaw(rule, RawPatch{Key: "before", Kind: "delete"}); err != nil {
		t.Fatal(err)
	}
	if err := session.SetRaw(rule, RawPatch{Key: "x", Kind: "mystery"}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("expected invalid kind, got %v", err)
	}
	if err := session.SetRaw(rule, RawPatch{Key: "x", Kind: "bool", Value: json.RawMessage(`"nope"`)}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatal(err)
	}
	if err := session.SetRaw(0, RawPatch{Key: "x", Kind: "string"}); err == nil {
		t.Fatal("invalid handle accepted")
	}

	rawJSON, err := session.GetRawsJSON(rule)
	if err != nil {
		t.Fatal(err)
	}
	if rawJSON == "" {
		t.Fatal("expected raws json")
	}
	if _, err := session.GetRawsJSON(0); err == nil {
		t.Fatal("invalid handle accepted")
	}

	css, mapJSON, err := session.StringifyMap(root, stringifier.SourceMapOptions{From: "in.css", To: "out.css"})
	if err != nil {
		t.Fatal(err)
	}
	if css == "" || mapJSON == "" {
		t.Fatalf("expected css and map, got css=%q map=%q", css, mapJSON)
	}
	if _, _, err := session.StringifyMap(0, stringifier.SourceMapOptions{}); err == nil {
		t.Fatal("invalid stringify handle accepted")
	}

	snapshots, err := session.RefreshSnapshots([]Handle{root, rule})
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshots) != 2 {
		t.Fatalf("snapshots: %d", len(snapshots))
	}
	session.MarkStructuralDirty(rule)
	dirty, err := session.IsDirty(rule)
	if err != nil || !dirty {
		t.Fatalf("expected dirty after MarkStructuralDirty: %v %v", dirty, err)
	}

	encoded, err := session.StringifyBuilder(root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(encoded, `"css"`) {
		t.Fatalf("unexpected builder payload: %s", encoded)
	}
	if _, err := session.StringifyBuilder(0); err == nil {
		t.Fatal("invalid builder handle accepted")
	}
}

func TestQueryWithTrackedSource(t *testing.T) {
	css := ".card {\n  color: red;\n  display: flex;\n}\n"
	session, root, err := ParseWithOptions(css, sourcemap.Options{From: "input.css", TrackSource: true, Document: css})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	rule, err := session.ChildAt(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	node, err := session.lookup(rule)
	if err != nil {
		t.Fatal(err)
	}
	if node.Source() == nil || node.Source().Input == nil {
		t.Fatal("expected tracked source input")
	}
	if _, _, ok := astLocateWord(node, "color"); !ok {
		t.Fatal("expected to locate color with tracked source")
	}
	if _, err := session.Query(rule, "rangeBy", `{"word":"color"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Query(rule, "rangeBy", `{"hasStart":true,"startLine":1,"startColumn":1}`); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Query(rule, "positionInside", `{"index":8}`); err != nil {
		t.Fatal(err)
	}
	positionInside(node, 8)
	positionInside(node, 10_000)
	offsetFromLineColumn(node, 2, 3)
}

func TestQueryHelpersCoverSourceAndRaws(t *testing.T) {
	session, root, err := Parse(".card {\n  color: red;\n  display: flex;\n}\n/* note */\n@media screen {}\n")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	rule, err := session.ChildAt(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	decl, err := session.ChildAt(rule, 0)
	if err != nil {
		t.Fatal(err)
	}
	comment, err := session.ChildAt(root, 1)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := session.Query(decl, "root", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Query(decl, "next", ""); err != nil {
		t.Fatal(err)
	}
	if encoded, err := session.Query(decl, "prev", ""); err != nil {
		t.Fatal(err)
	} else if encoded != "0" {
		t.Fatalf("first decl prev: %s", encoded)
	}
	if encoded, err := session.Query(decl, "index", ""); err != nil || encoded != "0" {
		t.Fatalf("index: %s %v", encoded, err)
	}
	if encoded, err := session.Query(root, "index", ""); err != nil || encoded != "0" {
		t.Fatalf("root index: %s %v", encoded, err)
	}
	if _, err := session.Query(rule, "bogus", ""); !errors.Is(err, ErrInvalidArgument) {
		t.Fatal(err)
	}
	if _, err := session.Query(rule, "raw", `{`); !errors.Is(err, ErrInvalidArgument) {
		t.Fatal(err)
	}

	queries := []struct {
		handle Handle
		kind   string
		opts   string
	}{
		{rule, "rangeBy", `{"word":"color"}`},
		{rule, "rangeBy", `{"word":"missing"}`},
		{rule, "rangeBy", `{"hasStart":true,"startLine":1,"startColumn":1,"hasEnd":true,"endLine":1,"endColumn":2}`},
		{rule, "rangeBy", `{"hasIndex":true,"index":0,"hasEndIndex":true,"endIndex":3}`},
		{rule, "positionBy", `{"hasIndex":true,"index":2}`},
		{rule, "positionBy", `{"word":"color"}`},
		{rule, "positionBy", `{"word":"missing"}`},
		{rule, "positionBy", `{}`},
		{rule, "positionInside", `{"index":4}`},
		{rule, "positionInside", `{"index":-1}`},
		{decl, "raw", `{"prop":"before"}`},
		{rule, "raw", `{"prop":"after"}`},
		{decl, "raw", `{"prop":"colon"}`},
		{rule, "raw", `{"prop":"semicolon"}`},
		{rule, "raw", `{"prop":"emptyBody"}`},
		{rule, "raw", `{"prop":"indent"}`},
		{rule, "raw", `{"prop":"beforeClose"}`},
		{decl, "raw", `{"prop":"beforeDecl"}`},
		{comment, "raw", `{"prop":"beforeComment"}`},
		{rule, "raw", `{"prop":"beforeRule"}`},
		{rule, "raw", `{"prop":"beforeOpen"}`},
		{decl, "raw", `{"prop":"customOwn"}`},
	}
	for _, query := range queries {
		if _, err := session.Query(query.handle, query.kind, query.opts); err != nil {
			t.Fatalf("%s %s: %v", query.kind, query.opts, err)
		}
	}

	if indentSample("a\n  ") != "  " || indentSample("  ") != "  " {
		t.Fatal("indentSample")
	}
	if stripNonSpace(" \t:x") != " \t" {
		t.Fatal("stripNonSpace")
	}
	if stripNonColonSpace(" : x") != " : " {
		t.Fatal("stripNonColonSpace")
	}
	if stringifyRaw(1) != "" || stringifyRaw("ok") != "ok" {
		t.Fatal("stringifyRaw")
	}
	if spacePrefix(" \n  x") == "" {
		t.Fatal("spacePrefix")
	}
	if spacePrefix("  x") == "" {
		t.Fatal("spacePrefix no newline")
	}

	node, err := session.lookup(rule)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, ok := astLocateWord(node, "color"); ok {
		t.Log("located color")
	}
	astLocateWord(node, "")
	_ = toQueryPosition(sourcemap.Position{Line: 1, Column: 2, Offset: 3})
	offsetFromLineColumn(node, 1, 1)
	offsetFromLineColumn(node, 99, 99)
	positionInside(node, 12)
	positionInside(node, 10_000)

	commentNode, err := session.lookup(comment)
	if err != nil {
		t.Fatal(err)
	}
	declNode, err := session.lookup(decl)
	if err != nil {
		t.Fatal(err)
	}
	_ = beforeAfter(declNode, "before")
	_ = beforeAfter(commentNode, "before")
	_ = beforeAfter(node, "before")
	_ = beforeAfter(node, "after")

	orphan, err := session.NewRule(".orphan")
	if err != nil {
		t.Fatal(err)
	}
	orphanNode, err := session.lookup(orphan)
	if err != nil {
		t.Fatal(err)
	}
	defaultRange(orphanNode)
	positionInside(orphanNode, 2)
	offsetFromLineColumn(orphanNode, 1, 1)
	astLocateWord(orphanNode, "x")

	session.MarkStructuralDirty(rule)
	if err := session.ClearDirty(rule); err != nil {
		t.Fatal(err)
	}
	if err := session.ClearDirty(root); err != nil {
		t.Fatal(err)
	}
	if err := session.ClearDirty(0); err == nil {
		t.Fatal("invalid clear accepted")
	}
}
