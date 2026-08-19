package ast

import (
	"reflect"
	"testing"

	"postcss-go/internal/sourcemap"
)

func TestVisitRawsAndApplyRawStayCompact(t *testing.T) {
	decl := NewDeclaration("color", "red")
	SetRawString(decl, "before", "\n  ")
	SetRawString(decl, "between", ": ")
	SetRawBool(decl, "semicolon", true)

	if CountRaws(decl) != 3 {
		t.Fatalf("CountRaws = %d", CountRaws(decl))
	}
	seen := map[string]any{}
	VisitRaws(decl, func(key string, value any) bool {
		seen[key] = value
		return true
	})
	if seen["before"] != "\n  " || seen["between"] != ": " || seen["semicolon"] != true {
		t.Fatalf("VisitRaws = %#v", seen)
	}
	if decl.Raws != nil {
		t.Fatal("VisitRaws should not materialize")
	}

	out := NewDeclaration("color", "red")
	ApplyRaw(out, "before", "\n  ")
	ApplyRaw(out, "value", RawValue{Raw: " red", Value: "red"})
	if out.Raws != nil {
		t.Fatal("ApplyRaw of compact keys should not materialize")
	}
	if text, ok := LookupRawString(out, "before"); !ok || text != "\n  " {
		t.Fatalf("applied before = %q %v", text, ok)
	}
}

func TestHasRawAndLookupRawStringAvoidMaterialize(t *testing.T) {
	decl := NewDeclaration("color", "red")
	SetRawString(decl, "before", "\n  ")
	SetRawString(decl, "between", ": ")

	if !HasRaw(decl, "before") {
		t.Fatal("expected before raw")
	}
	if HasRaw(decl, "after") {
		t.Fatal("unexpected after raw")
	}
	if text, ok := LookupRawString(decl, "before"); !ok || text != "\n  " {
		t.Fatalf("before = %q, ok = %v", text, ok)
	}
	if decl.Raws != nil {
		t.Fatal("compact raws should not materialize a map")
	}
}

func TestLookupRawBoolCompact(t *testing.T) {
	root := NewRoot()
	SetRawBool(root, "semicolon", true)
	value, ok := LookupRawBool(root, "semicolon")
	if !ok || !value {
		t.Fatalf("semicolon = %v, ok = %v", value, ok)
	}
}

func TestPrepareNodesPreservesExplicitEmptyBefore(t *testing.T) {
	rule := NewRule(".a")
	first := NewDeclaration("color", "red")
	first.RawFormatting()["before"] = "\n  "
	rule.Append(first)
	second := NewDeclaration("display", "block")
	rule.Append(second)
	if before, _ := second.RawFormattingReadOnly()["before"].(string); before == "" {
		t.Fatal("expected mutationBefore to copy whitespace from sample")
	}

	block := NewRule(".b")
	block.RawFormatting()["before"] = ""
	block.RawFormatting()["after"] = "\n"
	root := NewRoot()
	root.Append(block)
	added := NewRule(".c")
	root.Append(added)
	if before, _ := added.RawFormattingReadOnly()["before"].(string); before != "\n" {
		t.Fatalf("expected multiline after to become before, got %q", before)
	}

	empty := NewRule(".d")
	empty.RawFormatting()["before"] = ""
	if !HasRaw(empty, "before") {
		t.Fatal("expected explicit empty before to be detected")
	}
	root.Append(empty)

	follower := NewRule(".e")
	root.Append(follower)
	if before, ok := follower.RawFormattingReadOnly()["before"].(string); !ok || before != "" {
		t.Fatalf("expected empty before preserved, got %#v", follower.RawFormattingReadOnly()["before"])
	}
}

var compactStringKeys = []string{
	"before", "after", "between", "ownSemicolon", "afterName",
	"important", "left", "right", "indent",
}

func everyCompactNode() []Node {
	return []Node{
		NewDocument(),
		NewRoot(),
		NewRule(".hero"),
		NewAtRule("media", "screen"),
		NewDeclaration("color", "red"),
		NewComment("note"),
	}
}

func TestCompactRawsRoundTripEveryKeyAndNodeType(t *testing.T) {
	selector := RawValue{Raw: ".hero ", Value: ".hero"}
	value := RawValue{Raw: " red", Value: "red"}
	params := RawValue{Raw: " screen", Value: "screen"}

	for _, node := range everyCompactNode() {
		t.Run(string(node.Type()), func(t *testing.T) {
			for _, key := range compactStringKeys {
				SetRawString(node, key, key+"-val")
				if !HasRaw(node, key) {
					t.Fatalf("HasRaw(%q) = false", key)
				}
				if got, ok := LookupRawString(node, key); !ok || got != key+"-val" {
					t.Fatalf("LookupRawString(%q) = %q %v", key, got, ok)
				}
				if got, ok := LookupRaw(node, key); !ok || got != key+"-val" {
					t.Fatalf("LookupRaw(%q) = %#v %v", key, got, ok)
				}
			}
			SetRawBool(node, "semicolon", true)
			if got, ok := LookupRawBool(node, "semicolon"); !ok || !got {
				t.Fatalf("LookupRawBool(semicolon) = %v %v", got, ok)
			}
			SetRawValue(node, "selector", selector)
			SetRawValue(node, "value", value)
			SetRawValue(node, "params", params)
			for key, want := range map[string]RawValue{"selector": selector, "value": value, "params": params} {
				if !HasRaw(node, key) {
					t.Fatalf("HasRaw(%q) = false", key)
				}
				got, ok := LookupRaw(node, key)
				if !ok || got != want {
					t.Fatalf("LookupRaw(%q) = %#v %v", key, got, ok)
				}
			}

			if HasRaw(node, "missing") {
				t.Fatal("unexpected missing raw")
			}
			if _, ok := LookupRawString(node, "semicolon"); ok {
				t.Fatal("bool raw is not a string")
			}
			if _, ok := LookupRawBool(node, "before"); ok {
				t.Fatal("string raw is not a bool")
			}
			if _, ok := LookupRaw(node, "missing"); ok {
				t.Fatal("LookupRaw missing")
			}

			stopped := 0
			VisitRaws(node, func(string, any) bool {
				stopped++
				return false
			})
			if stopped != 1 {
				t.Fatalf("compact VisitRaws stop = %d", stopped)
			}
			if CountRaws(node) != len(compactRawKeyOrder) {
				t.Fatalf("CountRaws = %d, want %d", CountRaws(node), len(compactRawKeyOrder))
			}
			keys := RawKeys(node)
			if !reflect.DeepEqual(keys, compactRawKeyOrder[:]) {
				t.Fatalf("RawKeys order = %#v", keys)
			}

			cloned := node.Clone()
			if cloned == nil {
				t.Fatal("clone returned nil")
			}
			if text, ok := LookupRawString(cloned, "before"); !ok || text != "before-val" {
				t.Fatalf("cloned before = %q %v", text, ok)
			}

			raws := node.RawFormatting()
			if raws["before"] != "before-val" || raws["semicolon"] != true {
				t.Fatalf("materialized raws = %#v", raws)
			}
			SetRawString(node, "between", " : ")
			SetRawBool(node, "semicolon", false)
			SetRawValue(node, "value", RawValue{Raw: " navy", Value: "navy"})
			if got, ok := LookupRawString(node, "between"); !ok || got != " : " {
				t.Fatalf("materialized between = %q %v", got, ok)
			}
			if got, ok := LookupRawBool(node, "semicolon"); !ok || got {
				t.Fatalf("materialized semicolon = %v %v", got, ok)
			}

			for _, key := range append(append([]string{}, compactRawKeyOrder[:]...), "missing") {
				DeleteRaw(node, key)
				if HasRaw(node, key) {
					t.Fatalf("DeleteRaw(%q) left the key set", key)
				}
			}
		})
	}
}

func TestRawsOverflowVisitApplyAndUnknownNode(t *testing.T) {
	unknown := &plainContainer{}
	VisitRaws(unknown, func(string, any) bool {
		t.Fatal("VisitRaws should no-op on unknown nodes")
		return true
	})
	if RawKeys(unknown) != nil || HasRaw(unknown, "before") {
		t.Fatal("unknown node should have no raws")
	}
	if _, ok := LookupRawString(unknown, "before"); ok {
		t.Fatal("LookupRawString unknown")
	}
	if _, ok := LookupRawBool(unknown, "semicolon"); ok {
		t.Fatal("LookupRawBool unknown")
	}
	if _, ok := LookupRaw(unknown, "before"); ok {
		t.Fatal("LookupRaw unknown")
	}
	SetRawString(unknown, "before", "x")
	SetRawBool(unknown, "semicolon", true)
	SetRawValue(unknown, "value", RawValue{Raw: "x", Value: "x"})
	DeleteRaw(unknown, "before")
	ApplyRaw(unknown, "before", "x")
	ApplyRaw(unknown, "before", nil)

	decl := NewDeclaration("color", "red")
	ApplyRaw(decl, "before", nil)
	if decl.Raws["before"] != nil {
		t.Fatalf("nil ApplyRaw = %#v", decl.Raws["before"])
	}
	ApplyRaw(decl, "before", "\n  ")
	ApplyRaw(decl, "semicolon", true)
	ApplyRaw(decl, "value", RawValue{Raw: " red", Value: "red"})
	ApplyRaw(decl, "params", &RawValue{Raw: " x", Value: "x"})
	var missing *RawValue
	ApplyRaw(decl, "selector", missing)
	ApplyRaw(decl, "custom", 42)
	SetRawString(decl, "overflow", "yes")
	SetRawBool(decl, "flag", false)
	SetRawValue(decl, "other", RawValue{Raw: "a", Value: "a"})

	seen := map[string]any{}
	VisitRaws(decl, func(key string, value any) bool {
		seen[key] = value
		return true
	})
	if seen["overflow"] != "yes" || seen["custom"] != 42 || seen["flag"] != false {
		t.Fatalf("overflow VisitRaws = %#v", seen)
	}

	stopped := 0
	VisitRaws(decl, func(string, any) bool {
		stopped++
		return false
	})
	if stopped != 1 {
		t.Fatalf("VisitRaws should stop after first key, got %d", stopped)
	}

	materialized := NewDeclaration("display", "block")
	SetRawString(materialized, "before", "\n")
	SetRawBool(materialized, "semicolon", true)
	raws := materialized.RawFormatting()
	raws["before"] = nil
	raws["ghost"] = nil
	if HasRaw(materialized, "before") || HasRaw(materialized, "ghost") {
		t.Fatal("nil materialized values should not count as set")
	}
	if _, ok := LookupRawString(materialized, "before"); ok {
		t.Fatal("nil string lookup")
	}
	if _, ok := LookupRawBool(materialized, "before"); ok {
		t.Fatal("string as bool")
	}
	if _, ok := LookupRaw(materialized, "before"); ok {
		t.Fatal("nil LookupRaw")
	}
	VisitRaws(materialized, func(key string, _ any) bool {
		if key == "before" {
			t.Fatal("VisitRaws should skip nil values")
		}
		return true
	})
	VisitRaws(materialized, func(string, any) bool { return false })

	compact := NewRule(".a")
	SetRawString(compact, "before", "\n")
	compact.Raws = Raws{"extra": "keep", "before": "ignored", "empty": nil}
	overflowStopped := 0
	VisitRaws(compact, func(key string, value any) bool {
		if key == "extra" {
			if value != "keep" {
				t.Fatalf("overflow value = %#v", value)
			}
			overflowStopped++
			return false
		}
		return true
	})
	if overflowStopped != 1 {
		t.Fatal("expected overflow VisitRaws to stop")
	}

	if text, ok := LookupRawString(compact, "before"); !ok || text != "\n" {
		t.Fatalf("compact before = %q %v", text, ok)
	}
	cloned := compact.Clone().(*Rule)
	if cloned.Raws["extra"] != "keep" {
		t.Fatalf("compact+overflow clone extra = %#v", cloned.Raws["extra"])
	}

	overflowOnly := NewAtRule("media", "x")
	SetRawString(overflowOnly, "custom", "y")
	if overflowOnly.Clone() == nil {
		t.Fatal("overflow-only clone")
	}

	empty := NewRoot()
	if empty.RawFormattingReadOnly() != nil {
		t.Fatal("empty RawFormattingReadOnly should be nil")
	}
	empty.SetSource(&sourcemap.Location{Start: sourcemap.Position{Offset: 4}})
	if empty.Source() == nil || empty.Source().Start.Offset != 4 {
		t.Fatal("expected source to be stored")
	}
	empty.SetSource(nil)
	if empty.Source() != nil {
		t.Fatal("SetSource(nil) should clear source")
	}
}

func TestAppendParsedSkipsNilAndReparents(t *testing.T) {
	root := NewRoot()
	rule := NewRule(".a")
	root.Append(rule)
	doc := NewDocument()
	AppendParsed(doc, nil, rule)
	if rule.Parent() != doc {
		t.Fatal("expected document parent")
	}
	if len(root.Children()) != 0 {
		t.Fatal("expected rule to leave the original root")
	}

	nested := NewRule(".b")
	host := NewRule(".host")
	AppendParsed(host, nested)
	if nested.Parent() != host {
		t.Fatal("expected rule parent")
	}

	at := NewAtRule("media", "screen")
	child := NewRule(".c")
	AppendParsed(at, child)
	if child.Parent() != at {
		t.Fatal("expected at-rule parent")
	}

	plain := &plainContainer{}
	AppendParsed(plain, NewRule(".d"))

	parsedRoot := NewRoot()
	AppendParsed(parsedRoot, NewRule(".parsed"), nil)
	if len(parsedRoot.Children()) != 1 {
		t.Fatalf("root AppendParsed = %d", len(parsedRoot.Children()))
	}
}

func TestLookupRawOverflowAndCompactBool(t *testing.T) {
	decl := NewDeclaration("color", "red")
	SetRawBool(decl, "semicolon", true)
	if got, ok := LookupRaw(decl, "semicolon"); !ok || got != true {
		t.Fatalf("compact semicolon LookupRaw = %#v %v", got, ok)
	}

	overflow := NewDeclaration("display", "block")
	overflow.Raws = Raws{}
	for _, key := range compactRawKeyOrder {
		overflow.Raws[key] = key
	}
	overflow.Raws["custom"] = true
	overflow.Raws["empty"] = nil
	VisitRaws(overflow, func(string, any) bool { return true })
	if got, ok := LookupRawBool(overflow, "custom"); !ok || !got {
		t.Fatalf("overflow bool = %v %v", got, ok)
	}
	if _, ok := LookupRawBool(overflow, "semicolon"); ok {
		t.Fatal("nil semicolon in overflow")
	}
	if _, ok := LookupRawBool(overflow, "before"); ok {
		t.Fatal("string as bool in overflow")
	}
	if _, ok := LookupRaw(overflow, "empty"); ok {
		t.Fatal("nil overflow LookupRaw")
	}
	if _, ok := LookupRaw(overflow, "missing"); ok {
		t.Fatal("missing overflow LookupRaw")
	}

	materialized := NewDeclaration("width", "1px")
	SetRawString(materialized, "before", "\n")
	_ = materialized.RawFormatting()
	if _, ok := LookupRawBool(materialized, "missing"); ok {
		t.Fatal("materialized missing bool")
	}
	if _, ok := LookupRaw(materialized, "missing"); ok {
		t.Fatal("materialized missing LookupRaw")
	}
}
