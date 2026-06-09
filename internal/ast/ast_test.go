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
