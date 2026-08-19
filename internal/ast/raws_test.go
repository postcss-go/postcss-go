package ast

import "testing"

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
