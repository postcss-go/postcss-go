package ast

import (
	"reflect"
	"testing"
)

func TestContainerOperationsAndNodeHelpers(t *testing.T) {
	root := NewRoot()
	rule := NewRule(".a")
	decl1 := NewDeclaration("color", "red")
	decl2 := NewDeclaration("background", "blue")
	comment := NewComment("note")

	rule.Append(decl1)
	root.Append(rule)
	rule.Prepend(comment)
	if err := rule.InsertAfter(comment, decl2); err != nil {
		t.Fatalf("insert after failed: %v", err)
	}

	if got := rule.Index(decl1); got != 2 {
		t.Fatalf("expected decl1 index 2, got %d", got)
	}
	if decl2.Next() != decl1 {
		t.Fatal("expected decl2 next to be decl1")
	}
	if decl1.Prev() != decl2 {
		t.Fatal("expected decl1 prev to be decl2")
	}
	if decl1.Root() != root {
		t.Fatal("expected decl1 root to be root")
	}

	clone := decl1.Clone().(*Declaration)
	clone.Prop = "border"
	if err := decl1.ReplaceWith(clone); err != nil {
		t.Fatalf("replace failed: %v", err)
	}
	if got := rule.Children()[2].(*Declaration).Prop; got != "border" {
		t.Fatalf("expected replaced declaration prop border, got %q", got)
	}

	if removed := comment.Remove(); removed != comment {
		t.Fatal("expected remove to return same node")
	}
	if err := rule.RemoveChild(decl2); err != nil {
		t.Fatalf("remove child failed: %v", err)
	}
	if err := rule.RemoveChild(decl2); err == nil {
		t.Fatal("expected removing missing child to fail")
	}
	if err := root.InsertBefore(NewRule(".missing"), NewRule(".b")); err == nil {
		t.Fatal("expected insert before missing target to fail")
	}
}

func TestDocumentContainsRootsAndClones(t *testing.T) {
	document := NewDocument()
	first := NewRoot()
	first.Append(NewRule("a"))
	second := NewRoot()
	second.Append(NewRule("b"))
	document.Append(first, second)

	if document.Type() != NodeDocument || len(document.Children()) != 2 {
		t.Fatalf("unexpected document: type=%q children=%d", document.Type(), len(document.Children()))
	}
	if first.Parent() != document || second.Parent() != document {
		t.Fatal("expected roots to point at their document parent")
	}
	clone := document.Clone().(*Document)
	if len(clone.Children()) != 2 || clone.Children()[0] == first {
		t.Fatal("expected document clone to deep copy roots")
	}
}

func TestRuleSelectorsRootStringVariableAndClone(t *testing.T) {
	root := NewRoot()
	rule := NewRule(" .a, .b ")
	atRule := NewAtRule("media", "screen")
	atRule.Block = true
	atRule.Append(NewRule(".nested"))
	decl := NewDeclaration("--color", "red")
	decl.Important = true
	root.Append(rule, atRule, decl)

	if got := rule.Selectors(); !reflect.DeepEqual(got, []string{".a", ".b"}) {
		t.Fatalf("unexpected selectors: %#v", got)
	}
	rule.SetSelectors([]string{".x", ".y"})
	if rule.Selector != ".x, .y" {
		t.Fatalf("unexpected selector after set: %q", rule.Selector)
	}
	if !decl.Variable() {
		t.Fatal("expected custom property declaration to be variable")
	}
	if !atRule.HasBlock() {
		t.Fatal("expected at-rule block to be true")
	}
	if got := root.String(); got == "" {
		t.Fatal("expected non-empty root string")
	}

	clonedRoot := root.Clone().(*Root)
	if len(clonedRoot.Children()) != len(root.Children()) {
		t.Fatal("expected cloned root to preserve children length")
	}
	if clonedRoot.Children()[0] == root.Children()[0] {
		t.Fatal("expected clone to deep copy children")
	}
}

func TestCloneDeepCopiesNestedRaws(t *testing.T) {
	node := NewDeclaration("color", "red")
	node.RawFormatting()["custom"] = map[string]any{
		"nested": []any{map[string]any{"value": "red"}},
	}
	clone := node.Clone().(*Declaration)
	clone.RawFormatting()["custom"].(map[string]any)["nested"].([]any)[0].(map[string]any)["value"] = "blue"

	original := node.RawFormatting()["custom"].(map[string]any)["nested"].([]any)[0].(map[string]any)["value"]
	if original != "red" {
		t.Fatalf("nested raws were shared with clone: %v", original)
	}
}

func TestCloneDeepCopiesTypedRawContainers(t *testing.T) {
	node := NewDeclaration("color", "red")
	node.RawFormatting()["map"] = map[string]string{"value": "red"}
	node.RawFormatting()["slice"] = []string{"red"}
	clone := node.Clone().(*Declaration)
	clone.RawFormatting()["map"].(map[string]string)["value"] = "blue"
	clone.RawFormatting()["slice"].([]string)[0] = "blue"

	if node.RawFormatting()["map"].(map[string]string)["value"] != "red" ||
		node.RawFormatting()["slice"].([]string)[0] != "red" {
		t.Fatal("typed raws containers were shared with clone")
	}
}

func TestContainerCollectionHelpers(t *testing.T) {
	rule := NewRule(".a")
	decl1 := NewDeclaration("color", "red")
	decl2 := NewDeclaration("background", "blue")
	rule.Append(decl1, decl2)

	if rule.First() != decl1 {
		t.Fatal("expected first child")
	}
	if rule.Last() != decl2 {
		t.Fatal("expected last child")
	}
	if !rule.Some(func(node Node) bool { return node.(*Declaration).Prop == "color" }) {
		t.Fatal("expected Some to find matching child")
	}
	if rule.Some(func(node Node) bool { return node.(*Declaration).Prop == "missing" }) {
		t.Fatal("did not expect Some to match")
	}
	if !rule.Every(func(node Node) bool { return node.Type() == NodeDecl }) {
		t.Fatal("expected Every to pass")
	}
	if rule.Every(func(node Node) bool { return node.(*Declaration).Prop == "color" }) {
		t.Fatal("did not expect Every to pass")
	}

	rule.RemoveAll()
	if len(rule.Children()) != 0 {
		t.Fatalf("expected children to be removed, got %d", len(rule.Children()))
	}
	if decl1.Parent() != nil || decl2.Parent() != nil {
		t.Fatal("expected removed children to clear parents")
	}
}

func TestBeforeAndAfterInsertSiblings(t *testing.T) {
	root := NewRoot()
	rule := NewRule(".a")
	decl := NewDeclaration("color", "red")
	rule.Append(decl)
	root.Append(rule)

	if err := decl.Before(NewDeclaration("-webkit-color", "red")); err != nil {
		t.Fatalf("before failed: %v", err)
	}
	if err := decl.After(NewDeclaration("background", "blue")); err != nil {
		t.Fatalf("after failed: %v", err)
	}
	if err := rule.After(NewRule(".b")); err != nil {
		t.Fatalf("rule after failed: %v", err)
	}

	got := []string{
		rule.Children()[0].(*Declaration).Prop,
		rule.Children()[1].(*Declaration).Prop,
		rule.Children()[2].(*Declaration).Prop,
		root.Children()[1].(*Rule).Selector,
	}
	want := []string{"-webkit-color", "color", "background", ".b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected sibling order: %#v", got)
	}
}
