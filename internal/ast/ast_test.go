package ast

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	csserrors "github.com/postcss-go/postcss-go/internal/csserrors"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
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
	if document.Root() != document || first.Root() != first || first.First().Root() != first {
		t.Fatal("expected Root() to stop at Document children")
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

func TestDocumentContainerAndNodeAPI(t *testing.T) {
	doc := NewDocument()
	first := NewRoot()
	second := NewRoot()
	third := NewRoot()
	first.Append(NewRule("a"))
	second.Append(NewRule("b"))
	third.Append(NewRule("c"))

	doc.Append(second)
	doc.Prepend(first)
	if err := doc.InsertAfter(first, third); err != nil {
		t.Fatalf("document insert after: %v", err)
	}
	if doc.Index(second) != 2 {
		t.Fatalf("expected second at index 2, got %d", doc.Index(second))
	}
	if doc.First() != first || doc.Last() != second {
		t.Fatal("unexpected document first/last")
	}
	if !doc.Some(func(n Node) bool { return n == third }) {
		t.Fatal("expected Some to find third")
	}
	if !doc.Every(func(n Node) bool { return n.Type() == NodeRoot }) {
		t.Fatal("expected Every to pass for roots")
	}
	if first.Next() != third || third.Prev() != first {
		t.Fatal("expected document sibling links")
	}

	extra := NewRoot()
	if err := first.Before(extra); err != nil {
		t.Fatalf("document before: %v", err)
	}
	if doc.First() != extra {
		t.Fatal("expected prepended root via Before")
	}
	if err := second.After(NewRoot()); err != nil {
		t.Fatalf("document after: %v", err)
	}
	clone, err := third.CloneBefore()
	if err != nil || clone == nil {
		t.Fatalf("clone before failed: %v", err)
	}
	afterClone, err := third.CloneAfter(NewRoot())
	if err != nil || afterClone == nil {
		t.Fatalf("clone after failed: %v", err)
	}
	if err := third.ReplaceWith(NewRoot()); err != nil {
		t.Fatalf("document replace: %v", err)
	}
	if removed := first.Remove(); removed != first {
		t.Fatal("expected remove to return first")
	}
	if err := doc.RemoveChild(second); err != nil {
		t.Fatalf("remove child: %v", err)
	}
	doc.RemoveAll()
	if len(doc.Children()) != 0 {
		t.Fatal("expected empty document")
	}
	if err := doc.Error("broken"); err == nil || err.Reason == "" {
		t.Fatal("expected document error")
	}

	// Cover Document node wrappers that require an explicit call on the document.
	_ = doc.Next()
	_ = doc.Prev()
	_ = doc.Remove()
	_ = doc.ReplaceWith()
	_ = doc.Before()
	_ = doc.After()
	if _, err := doc.CloneBefore(); err != nil {
		t.Fatalf("document clone before: %v", err)
	}
	if _, err := doc.CloneAfter(); err != nil {
		t.Fatalf("document clone after: %v", err)
	}
}

func TestRootContainerAndSiblingAPI(t *testing.T) {
	root := NewRoot()
	ruleA := NewRule(".a")
	ruleB := NewRule(".b")
	ruleC := NewRule(".c")
	root.Append(ruleB)
	root.Prepend(ruleA)
	if err := root.InsertAfter(ruleA, ruleC); err != nil {
		t.Fatalf("insert after: %v", err)
	}
	if root.Index(ruleB) != 2 || root.Last() != ruleB {
		t.Fatalf("unexpected root layout: index=%d last=%v", root.Index(ruleB), root.Last())
	}
	if !root.Some(func(n Node) bool { return n == ruleC }) || !root.Every(func(n Node) bool { return n.Type() == NodeRule }) {
		t.Fatal("expected collection helpers to work on root")
	}
	if ruleA.Next() != ruleC || ruleC.Prev() != ruleA {
		t.Fatal("expected root sibling links")
	}
	if ruleA.Error("oops") == nil {
		t.Fatal("expected error without source")
	}
	if root.Error("root-err") == nil {
		t.Fatal("expected root error")
	}
	before := NewRule(".before")
	if err := ruleA.Before(before); err != nil {
		t.Fatalf("before: %v", err)
	}
	if _, err := ruleB.CloneBefore(); err != nil {
		t.Fatalf("clone before: %v", err)
	}
	if _, err := ruleB.CloneAfter(); err != nil {
		t.Fatalf("clone after: %v", err)
	}
	if err := ruleC.ReplaceWith(NewRule(".replaced")); err != nil {
		t.Fatalf("replace: %v", err)
	}
	if ruleA.Remove() != ruleA {
		t.Fatal("expected remove to return rule")
	}
	if err := root.RemoveChild(ruleB); err != nil {
		t.Fatalf("remove child: %v", err)
	}
	root.RemoveAll()
	if root.First() != nil || root.Last() != nil {
		t.Fatal("expected empty first/last")
	}
	if root.Next() != nil || root.Prev() != nil {
		t.Fatal("expected detached root siblings to be nil")
	}
	if err := root.Before(NewRule(".x")); err != nil {
		t.Fatalf("detached before should no-op: %v", err)
	}
	if err := root.After(NewRule(".y")); err != nil {
		t.Fatalf("detached after should no-op: %v", err)
	}
	if err := root.ReplaceWith(NewRule(".z")); err != nil {
		t.Fatalf("detached replace should no-op: %v", err)
	}
	if root.Remove() != root {
		t.Fatal("detached remove should return self")
	}
	clone, err := root.CloneBefore(NewRule(".override"))
	if err != nil || clone.(*Rule).Selector != ".override" {
		t.Fatalf("detached clone before override failed: %v %#v", err, clone)
	}
	clone, err = root.CloneAfter(nil)
	if err != nil || clone == nil {
		t.Fatalf("detached clone after failed: %v", err)
	}
}

func TestRuleAtRuleCommentNodeAPI(t *testing.T) {
	root := NewRoot()
	rule := NewRule(".host")
	atRule := NewAtRule("media", "screen")
	atRule.Block = true
	nested := NewRule(".nested")
	comment := NewComment("keep")
	decl := NewDeclaration("color", "red")

	atRule.Append(nested)
	atRule.Prepend(comment)
	if err := atRule.InsertBefore(nested, NewRule(".mid")); err != nil {
		t.Fatalf("atrule insert before: %v", err)
	}
	if err := atRule.InsertAfter(comment, NewComment("after")); err != nil {
		t.Fatalf("atrule insert after: %v", err)
	}
	if atRule.Index(nested) < 0 || atRule.First() != comment || atRule.Last() != nested {
		t.Fatalf("unexpected atrule children: %#v", atRule.Children())
	}
	if !atRule.Some(func(n Node) bool { return n.Type() == NodeComment }) {
		t.Fatal("expected atrule Some")
	}
	if !atRule.Every(func(n Node) bool { return n != nil }) {
		t.Fatal("expected atrule Every")
	}
	root.Append(rule, atRule)
	rule.Append(decl)

	if rule.Clone().(*Rule).Selector != ".host" {
		t.Fatal("expected rule clone")
	}
	if atRule.Clone().(*AtRule).Name != "media" {
		t.Fatal("expected atrule clone")
	}
	if comment.Clone().(*Comment).Text != "keep" {
		t.Fatal("expected comment clone")
	}
	if rule.Next() != atRule || atRule.Prev() != rule {
		t.Fatal("expected rule/atrule siblings")
	}
	if comment.Root() != root || atRule.Root() != root {
		t.Fatal("expected nested roots")
	}
	if comment.Next() == nil || comment.Prev() != nil {
		t.Fatal("unexpected comment siblings")
	}
	if err := rule.Before(NewRule(".before-rule")); err != nil {
		t.Fatalf("rule before: %v", err)
	}
	if err := atRule.After(NewAtRule("supports", "(color:red)")); err != nil {
		t.Fatalf("atrule after: %v", err)
	}
	if err := comment.Before(NewComment("lead")); err != nil {
		t.Fatalf("comment before: %v", err)
	}
	if err := comment.After(NewComment("trail")); err != nil {
		t.Fatalf("comment after: %v", err)
	}
	if _, err := rule.CloneBefore(); err != nil {
		t.Fatalf("rule clone before: %v", err)
	}
	if _, err := atRule.CloneAfter(); err != nil {
		t.Fatalf("atrule clone after: %v", err)
	}
	if _, err := comment.CloneBefore(); err != nil {
		t.Fatalf("comment clone before: %v", err)
	}
	if _, err := comment.CloneAfter(); err != nil {
		t.Fatalf("comment clone after: %v", err)
	}
	if err := comment.ReplaceWith(NewComment("replaced")); err != nil {
		t.Fatalf("comment replace: %v", err)
	}
	if err := atRule.RemoveChild(nested); err != nil {
		t.Fatalf("atrule remove child: %v", err)
	}
	atRule.RemoveAll()
	if len(atRule.Children()) != 0 {
		t.Fatal("expected atrule emptied")
	}
	if rule.Remove() != rule {
		t.Fatal("expected rule remove")
	}
	_ = atRule.Next()
	if err := atRule.Before(NewAtRule("x", "")); err != nil {
		// may fail without parent; still exercises wrapper when parent exists
	}
	// Re-attach for remaining atrule wrappers.
	root.Append(atRule)
	if err := atRule.Before(NewAtRule("before-at", "")); err != nil {
		t.Fatalf("atrule before: %v", err)
	}
	if _, err := atRule.CloneBefore(); err != nil {
		t.Fatalf("atrule clone before: %v", err)
	}
	if err := atRule.ReplaceWith(NewAtRule("replaced-at", "")); err != nil {
		t.Fatalf("atrule replace: %v", err)
	}
	if atRule.Remove() != atRule {
		t.Fatal("expected atrule remove")
	}
	if rule.Error("r") == nil || NewAtRule("a", "").Error("a") == nil || comment.Error("c") == nil || decl.Error("d") == nil {
		t.Fatal("expected node errors")
	}
}

func TestRangeSourceAndErrorOptions(t *testing.T) {
	css := "color: red;"
	input, err := sourcemap.NewInput(css, sourcemap.Options{From: "in.css", TrackSource: true})
	if err != nil {
		t.Fatalf("input: %v", err)
	}
	decl := NewDeclaration("color", "red")
	decl.SetRange(SourceRange{Start: 0, End: len(css)})
	decl.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(css))))
	if decl.Range().End != len(css) || decl.Source() == nil {
		t.Fatal("expected range/source accessors")
	}

	if got := decl.Error("plain"); got.Line != 1 {
		t.Fatalf("expected sourced error, got %#v", got)
	}
	start := sourcemap.Position{Line: 1, Column: 2, Offset: 1}
	end := sourcemap.Position{Line: 1, Column: 5, Offset: 4}
	if got := decl.Error("opts", ErrorOptions{Plugin: "p", Start: &start, End: &end}); got.Plugin != "p" || got.EndColumn != 5 {
		t.Fatalf("unexpected optioned error: %#v", got)
	}
	if got := decl.Error("word", ErrorOptions{Word: "red"}); got.Column == 0 {
		t.Fatalf("expected word locate: %#v", got)
	}
	if got := decl.Error("idx", ErrorOptions{Index: 1, EndIndex: 4}); got.Column == 0 {
		t.Fatalf("expected index locate: %#v", got)
	}
	if _, _, ok := locateWord(decl, "missing"); ok {
		t.Fatal("expected missing word to fail")
	}
	if _, _, ok := locateWord(decl, ""); ok {
		t.Fatal("expected empty word to fail")
	}
	bad := NewDeclaration("x", "y")
	if _, _, ok := locateWord(bad, "x"); ok {
		t.Fatal("expected locateWord without source to fail")
	}
	if _, _, ok := locateIndex(bad, 0, 1); ok {
		t.Fatal("expected locateIndex without source to fail")
	}
	bad.SetSource(decl.Source())
	bad.SetRange(SourceRange{Start: 10, End: 5})
	if _, _, ok := locateWord(bad, "x"); ok {
		t.Fatal("expected invalid range to fail locateWord")
	}
	startPos, endPos, ok := locateIndex(decl, -1, -2)
	if !ok || startPos.Offset != 0 {
		t.Fatalf("expected clamped locateIndex, got %#v %#v", startPos, endPos)
	}
	startPos, endPos, ok = locateIndex(decl, 100, 200)
	if !ok || startPos.Offset != decl.Range().End {
		t.Fatalf("expected end clamp, got %#v %#v", startPos, endPos)
	}
}

func TestCloneRawValueNormalizationAndStringify(t *testing.T) {
	node := NewDeclaration("color", "red")
	raws := node.RawFormatting()
	raws["nil"] = nil
	raws["raw"] = RawValue{Raw: "r", Value: "v"}
	copied := RawValue{Raw: "p", Value: "q"}
	raws["ptr"] = &copied
	raws["nilptr"] = (*RawValue)(nil)
	raws["pair"] = map[string]string{"raw": "R", "value": "V"}
	raws["anyPair"] = map[string]any{"raw": "R2", "value": "V2"}
	raws["anyExtra"] = map[string]any{"raw": "R3", "value": "V3", "extra": true}
	raws["other"] = 3.14
	raws["struct"] = struct{ N int }{N: 1}
	clone := node.Clone().(*Declaration)
	if clone.RawFormatting()["pair"].(RawValue).Value != "V" {
		t.Fatalf("expected string map normalized: %#v", clone.RawFormatting()["pair"])
	}
	if clone.RawFormatting()["anyPair"].(RawValue).Raw != "R2" {
		t.Fatalf("expected any map normalized: %#v", clone.RawFormatting()["anyPair"])
	}
	if _, ok := clone.RawFormatting()["anyExtra"].(map[string]any); !ok {
		t.Fatalf("expected non-raw any map preserved: %#v", clone.RawFormatting()["anyExtra"])
	}
	if clone.RawFormatting()["nilptr"] != nil {
		t.Fatal("expected nil *RawValue to stay nil")
	}
	if !looksLikeRawValue(map[string]any{"raw": "a", "value": "b"}) {
		t.Fatal("expected looksLikeRawValue true")
	}
	if looksLikeRawValue(map[string]any{"raw": "a"}) {
		t.Fatal("expected looksLikeRawValue false for wrong size")
	}

	root := NewRoot()
	root.Append(
		NewRule(".a"),
		NewAtRule("charset", `"utf-8"`),
		NewAtRule("layer", ""),
		NewDeclaration("color", "red"),
		NewComment("c"),
	)
	got := root.String()
	if got == "" || stringifyNode(NewDocument()) != "" {
		t.Fatalf("unexpected stringify: %q", got)
	}
	var unknown Node
	if cloneNode(unknown) != nil {
		t.Fatal("expected nil clone for unknown")
	}
}

func TestMutationBeforeAndPrepareNodes(t *testing.T) {
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
	root.Append(empty)
	follower := NewRule(".e")
	root.Append(follower)
	if before, ok := follower.RawFormattingReadOnly()["before"].(string); !ok || before != "" {
		t.Fatalf("expected empty before preserved, got %#v", follower.RawFormattingReadOnly()["before"])
	}

	moved := NewDeclaration("z-index", "1")
	other := NewRule(".tmp")
	other.Append(moved)
	rule.Append(moved, nil)
	if moved.Parent() != rule {
		t.Fatal("expected prepareNodes to reparent")
	}
	if err := removeChild(&rule.Nodes, moved); err != nil {
		t.Fatalf("removeChild helper: %v", err)
	}
	if err := removeChild(&rule.Nodes, moved); err == nil {
		t.Fatal("expected removeChild missing target to fail")
	}
	if err := rule.InsertAfter(NewDeclaration("missing", "x"), NewDeclaration("a", "b")); err == nil {
		t.Fatal("expected insert after missing to fail")
	}
}

func TestIteratorNilGuardsAndInsertShift(t *testing.T) {
	base := &BaseNode{}
	if base.iteratorIndex(1) != 0 {
		t.Fatal("expected nil iterators index 0")
	}
	base.advanceIterator(1)
	base.dropIterator(1)

	root := NewRoot()
	a := NewRule(".a")
	b := NewRule(".b")
	root.Append(a, b)
	visited := 0
	if err := Each(root, func(node Node, index int) error {
		visited++
		if index == 0 {
			root.InsertAfter(a, NewRule(".mid"))
		}
		return nil
	}); err != nil {
		t.Fatalf("each: %v", err)
	}
	if visited < 3 {
		t.Fatalf("expected insert shift during each, visited=%d", visited)
	}

	// InsertAfter should shift iterators when the cursor is past the insert index.
	root2 := NewRoot()
	x := NewRule(".x")
	y := NewRule(".y")
	root2.Append(x, y)
	seen := 0
	if err := Each(root2, func(node Node, index int) error {
		seen++
		if node == x {
			if err := root2.InsertAfter(x, NewRule(".between")); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("each insert after: %v", err)
	}
	if seen < 3 {
		t.Fatalf("expected shifted insert-after iteration, seen=%d", seen)
	}
}

func TestReplaceAndNextEdgeCases(t *testing.T) {
	root := NewRoot()
	rule := NewRule(".a")
	root.Append(rule)
	if rule.Next() != nil {
		t.Fatal("expected nil next for last child")
	}
	orphan := NewRule(".orphan")
	if orphan.Next() != nil || orphan.Prev() != nil {
		t.Fatal("expected nil siblings for orphan")
	}

	// replaceNode early-return when parent index is stale: remove then call ReplaceWith
	// via a node that still thinks it has a parent is hard; exercise InsertBefore path
	// by replacing the last child so Append branch is unused and InsertBefore is used.
	second := NewRule(".b")
	root.Append(second)
	if err := rule.ReplaceWith(NewRule(".c")); err != nil {
		t.Fatalf("replace middle: %v", err)
	}

	sample := NewDeclaration("color", "red")
	sample.RawFormatting()["before"] = "/*keep*/\n  "
	host := NewRule(".host")
	host.Append(sample)
	added := NewDeclaration("display", "block")
	host.Append(added)
	before, _ := added.RawFormattingReadOnly()["before"].(string)
	if strings.Contains(before, "/") || strings.Contains(before, "*") {
		t.Fatalf("expected non-whitespace stripped from before, got %q", before)
	}
	if !strings.Contains(before, "\n") {
		t.Fatalf("expected newline preserved in before, got %q", before)
	}
}

func TestShiftInsertAfterPastCursorAndStaleReplace(t *testing.T) {
	root := NewRoot()
	x := NewRule(".x")
	y := NewRule(".y")
	root.Append(x, y)
	if err := Each(root, func(node Node, _ int) error {
		if node == y {
			return root.InsertAfter(x, NewRule(".mid"))
		}
		return nil
	}); err != nil {
		t.Fatalf("each: %v", err)
	}
	if len(root.Children()) != 3 {
		t.Fatalf("expected 3 children, got %d", len(root.Children()))
	}

	stale := NewRule(".stale")
	host := NewRoot()
	stale.SetParent(host)
	if err := replaceNode(stale, NewRule(".fresh")); err != nil {
		t.Fatalf("stale replace should no-op, got %v", err)
	}

	flaky := NewRule(".flaky")
	badParent := &removeFailContainer{nodes: []Node{flaky}}
	flaky.SetParent(badParent)
	if err := replaceNode(flaky, NewRule(".n")); err == nil {
		t.Fatal("expected remove failure to surface")
	}
}

type removeFailContainer struct {
	nodes []Node
}

func (r *removeFailContainer) Type() NodeType                   { return NodeRoot }
func (r *removeFailContainer) Parent() Container                { return nil }
func (r *removeFailContainer) SetParent(Container)              {}
func (r *removeFailContainer) Range() SourceRange               { return SourceRange{} }
func (r *removeFailContainer) SetRange(SourceRange)             {}
func (r *removeFailContainer) Source() *sourcemap.Location      { return nil }
func (r *removeFailContainer) SetSource(*sourcemap.Location)    {}
func (r *removeFailContainer) RawFormatting() Raws              { return Raws{} }
func (r *removeFailContainer) RawFormattingReadOnly() Raws      { return nil }
func (r *removeFailContainer) Children() []Node                 { return r.nodes }
func (r *removeFailContainer) Append(...Node)                   {}
func (r *removeFailContainer) Prepend(...Node)                  {}
func (r *removeFailContainer) InsertBefore(Node, ...Node) error { return nil }
func (r *removeFailContainer) InsertAfter(Node, ...Node) error  { return nil }
func (r *removeFailContainer) RemoveChild(Node) error {
	return errors.New("cannot remove")
}
func (r *removeFailContainer) Index(target Node) int {
	for i, n := range r.nodes {
		if n == target {
			return i
		}
	}
	return -1
}
func (r *removeFailContainer) First() Node                { return nil }
func (r *removeFailContainer) Last() Node                 { return nil }
func (r *removeFailContainer) RemoveAll()                 {}
func (r *removeFailContainer) Some(func(Node) bool) bool  { return false }
func (r *removeFailContainer) Every(func(Node) bool) bool { return true }
func (r *removeFailContainer) Root() Node                 { return r }
func (r *removeFailContainer) Next() Node                 { return nil }
func (r *removeFailContainer) Prev() Node                 { return nil }
func (r *removeFailContainer) Remove() Node               { return r }
func (r *removeFailContainer) ReplaceWith(...Node) error  { return nil }
func (r *removeFailContainer) Clone() Node                { return r }
func (r *removeFailContainer) CloneBefore(...Node) (Node, error) {
	return r, nil
}
func (r *removeFailContainer) CloneAfter(...Node) (Node, error) { return r, nil }
func (r *removeFailContainer) Before(...Node) error             { return nil }
func (r *removeFailContainer) After(...Node) error              { return nil }
func (r *removeFailContainer) Error(string, ...ErrorOptions) *csserrors.SyntaxError {
	return nil
}
