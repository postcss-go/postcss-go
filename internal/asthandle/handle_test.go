package asthandle

import (
	"errors"
	"strings"
	"testing"

	"postcss-go/internal/ast"
)

const sampleCSS = `.card { color: red; display: flex; }
@media screen { .title { font-size: 16px; } }
/* note */`

func TestParseInternsStableIdentity(t *testing.T) {
	session, root, err := Parse(sampleCSS)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	if root == 0 {
		t.Fatal("expected root handle")
	}
	if got := session.Identity(nil); got != 0 {
		t.Fatalf("nil identity: %d", got)
	}

	first, err := session.ChildAt(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	again, err := session.ChildAt(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	if first != again {
		t.Fatalf("identity changed: %d vs %d", first, again)
	}
	kind, err := session.Type(first)
	if err != nil {
		t.Fatal(err)
	}
	if kind != TypeRule {
		t.Fatalf("type: got %d", kind)
	}
}

func TestGenerationRejectsDisposedHandles(t *testing.T) {
	session, root, err := Parse(".a { color: red; }")
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
	stale := decl
	if err := session.Dispose(decl); err != nil {
		t.Fatal(err)
	}
	if _, err := session.GetField(stale, FieldProp); !errors.Is(err, ErrStaleHandle) {
		t.Fatalf("stale lookup: %v", err)
	}

	replacement, err := session.NewDecl("margin", "0")
	if err != nil {
		t.Fatal(err)
	}
	if replacement == stale {
		t.Fatal("reused slot kept the old generation")
	}
	if err := session.Append(rule, replacement); err != nil {
		t.Fatal(err)
	}
	prop, err := session.GetField(replacement, FieldProp)
	if err != nil {
		t.Fatal(err)
	}
	if prop != "margin" {
		t.Fatalf("prop: %q", prop)
	}
}

func TestCloseInvalidatesHandles(t *testing.T) {
	session, root, err := Parse(".a { color: red; }")
	if err != nil {
		t.Fatal(err)
	}
	session.Close()
	if _, err := session.Type(root); !errors.Is(err, ErrClosed) {
		t.Fatalf("closed lookup: %v", err)
	}
	session.Close()
	if _, err := session.NewDecl("x", "y"); !errors.Is(err, ErrClosed) {
		t.Fatalf("closed NewDecl: %v", err)
	}
}

func TestDetachedNodeLifetime(t *testing.T) {
	session, root, err := Parse(".a { color: red; }")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	detached, err := session.NewDecl("opacity", "0")
	if err != nil {
		t.Fatal(err)
	}
	parent, err := session.Parent(detached)
	if err != nil {
		t.Fatal(err)
	}
	if parent != 0 {
		t.Fatalf("detached parent: %d", parent)
	}
	rootParent, err := session.Parent(root)
	if err != nil {
		t.Fatal(err)
	}
	if rootParent != 0 {
		t.Fatalf("root parent: %d", rootParent)
	}

	rule, err := session.ChildAt(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Append(rule, detached); err != nil {
		t.Fatal(err)
	}
	parent, err = session.Parent(detached)
	if err != nil {
		t.Fatal(err)
	}
	if parent != rule {
		t.Fatalf("attached parent: %d want %d", parent, rule)
	}

	count, err := session.ChildCount(rule)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("child count: %d", count)
	}

	if err := session.Dispose(detached); err != nil {
		t.Fatal(err)
	}
	count, err = session.ChildCount(rule)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("after dispose child count: %d", count)
	}
}

func TestFieldReadWriteAndBadField(t *testing.T) {
	session, root, err := Parse(".hero { color: red; } @media x { a { z-index: 1; } } /* c */")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	rule, err := session.ChildAt(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	sel, err := session.GetField(rule, FieldSelector)
	if err != nil {
		t.Fatal(err)
	}
	if sel != ".hero" {
		t.Fatalf("selector: %q", sel)
	}
	if err := session.SetField(rule, FieldSelector, ".hero-lg"); err != nil {
		t.Fatal(err)
	}
	if _, err := session.GetField(rule, FieldProp); !errors.Is(err, ErrBadField) {
		t.Fatalf("rule prop: %v", err)
	}

	decl, err := session.ChildAt(rule, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.SetField(decl, FieldValue, "navy"); err != nil {
		t.Fatal(err)
	}
	value, err := session.GetField(decl, FieldValue)
	if err != nil {
		t.Fatal(err)
	}
	if value != "navy" {
		t.Fatalf("value: %q", value)
	}
	if err := session.SetField(decl, FieldProp, "background"); err != nil {
		t.Fatal(err)
	}

	at, err := session.ChildAt(root, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.SetField(at, FieldName, "media"); err != nil {
		t.Fatal(err)
	}
	if err := session.SetField(at, FieldParams, "print"); err != nil {
		t.Fatal(err)
	}
	name, err := session.GetField(at, FieldName)
	if err != nil {
		t.Fatal(err)
	}
	params, err := session.GetField(at, FieldParams)
	if err != nil {
		t.Fatal(err)
	}
	if name != "media" || params != "print" {
		t.Fatalf("atrule: %q %q", name, params)
	}

	comment, err := session.ChildAt(root, 2)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.SetField(comment, FieldText, "ok"); err != nil {
		t.Fatal(err)
	}
	text, err := session.GetField(comment, FieldText)
	if err != nil {
		t.Fatal(err)
	}
	if text != "ok" {
		t.Fatalf("comment: %q", text)
	}

	if _, err := session.GetField(root, FieldText); !errors.Is(err, ErrBadField) {
		t.Fatalf("root text: %v", err)
	}
	if err := session.SetField(root, FieldValue, "x"); !errors.Is(err, ErrBadField) {
		t.Fatalf("root set: %v", err)
	}
	if _, err := session.GetField(decl, Field(-1)); !errors.Is(err, ErrBadField) {
		t.Fatalf("bad field: %v", err)
	}
	if err := session.SetField(decl, Field(-1), "x"); !errors.Is(err, ErrBadField) {
		t.Fatalf("set bad field: %v", err)
	}
}

func TestVisitorCursorAndBatches(t *testing.T) {
	session, root, err := Parse(".a { color: red; display: flex; } .b { color: blue; }")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	decls, err := session.Collect(root, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(decls) != 3 {
		t.Fatalf("decls: %d", len(decls))
	}
	props, err := session.ReadFields(decls, FieldProp)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(props, ",") != "color,display,color" {
		t.Fatalf("props: %q", props)
	}
	values := make([]string, len(decls))
	for i := range values {
		values[i] = "navy"
	}
	if err := session.SetFields(decls, FieldValue, values); err != nil {
		t.Fatal(err)
	}
	if err := session.SetFields(decls[:1], FieldValue, []string{"a", "b"}); err == nil {
		t.Fatal("expected length mismatch")
	}

	id, err := session.OpenCursor(root, true)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]Handle, 2)
	var seen []Handle
	for {
		n, err := session.CursorNext(id, buf)
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			break
		}
		seen = append(seen, buf[:n]...)
		if n < len(buf) {
			break
		}
	}
	if len(seen) != 3 {
		t.Fatalf("cursor: %d", len(seen))
	}
	if err := session.CloseCursor(id); err != nil {
		t.Fatal(err)
	}
	if _, err := session.CursorNext(id, buf); !errors.Is(err, ErrCursor) {
		t.Fatalf("closed cursor: %v", err)
	}

	css, err := session.Stringify(root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(css, "navy") {
		t.Fatalf("stringify: %q", css)
	}
}

func TestCloneInsertBeforeAndRemove(t *testing.T) {
	session, root, err := Parse(".a { display: flex; }")
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
	clone, err := session.Clone(decl)
	if err != nil {
		t.Fatal(err)
	}
	if clone == decl {
		t.Fatal("clone reused handle")
	}
	if err := session.SetField(clone, FieldProp, "backface-visibility"); err != nil {
		t.Fatal(err)
	}
	if err := session.SetField(clone, FieldValue, "hidden"); err != nil {
		t.Fatal(err)
	}
	if err := session.InsertBefore(decl, clone); err != nil {
		t.Fatal(err)
	}
	if got, _ := session.ChildCount(rule); got != 2 {
		t.Fatalf("children: %d", got)
	}
	if err := session.Remove(decl); err != nil {
		t.Fatal(err)
	}
	if got, _ := session.ChildCount(rule); got != 1 {
		t.Fatalf("after remove: %d", got)
	}
}

func TestLookupErrors(t *testing.T) {
	session, root, err := Parse(".a { color: red; }")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	if _, err := session.lookup(0); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("zero handle: %v", err)
	}
	if _, err := session.Type(Handle(1 << 20)); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("oob handle: %v", err)
	}
	decl, err := session.NewDecl("x", "y")
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Append(decl, root); !errors.Is(err, ErrNotContainer) {
		t.Fatalf("append to decl: %v", err)
	}
	if _, err := session.ChildAt(decl, 0); !errors.Is(err, ErrNotContainer) {
		t.Fatalf("child of decl: %v", err)
	}
	if _, err := session.ChildAt(root, 9); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("child oob: %v", err)
	}
	if n, err := session.ChildCount(decl); err != nil || n != 0 {
		t.Fatalf("decl children: %d %v", n, err)
	}
	if _, _, err := Parse("{"); err == nil {
		t.Fatal("expected parse error")
	} else if !errors.Is(err, ErrParse) {
		t.Fatalf("parse: %v", err)
	}
}

func TestInvalidCursorAndClosedSession(t *testing.T) {
	session, root, err := Parse(".a { color: red; }")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := session.CursorNext(99, nil); !errors.Is(err, ErrCursor) {
		t.Fatalf("missing cursor: %v", err)
	}
	if err := session.CloseCursor(99); !errors.Is(err, ErrCursor) {
		t.Fatalf("close missing: %v", err)
	}
	session.Close()
	if _, err := session.OpenCursor(root, false); !errors.Is(err, ErrClosed) {
		t.Fatalf("open closed: %v", err)
	}
	if _, err := session.CursorNext(0, nil); !errors.Is(err, ErrClosed) {
		t.Fatalf("next closed: %v", err)
	}
	if err := session.CloseCursor(0); !errors.Is(err, ErrClosed) {
		t.Fatalf("close cursor closed: %v", err)
	}
	if _, err := session.NewDecl("a", "b"); !errors.Is(err, ErrClosed) {
		t.Fatalf("new closed: %v", err)
	}
}

func TestDocumentAndCommentTypes(t *testing.T) {
	session := New()
	defer session.Close()
	doc := ast.NewDocument()
	root := ast.NewRoot()
	doc.Append(root)
	session.internTree(doc)
	h := session.mustHandle(doc)
	kind, err := session.Type(h)
	if err != nil {
		t.Fatal(err)
	}
	if kind != TypeDocument {
		t.Fatalf("document type: %d", kind)
	}
	comment := ast.NewComment("x")
	ch := session.mustHandle(comment)
	kind, err = session.Type(ch)
	if err != nil {
		t.Fatal(err)
	}
	if kind != TypeComment {
		t.Fatalf("comment type: %d", kind)
	}
}

func TestErrorPathsAndIdentity(t *testing.T) {
	session, root, err := Parse(".a { color: red; }")
	if err != nil {
		t.Fatal(err)
	}
	rule, err := session.ChildAt(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	decl, err := session.ChildAt(rule, 0)
	if err != nil {
		t.Fatal(err)
	}

	kind, err := session.Type(root)
	if err != nil || kind != TypeRoot {
		t.Fatalf("root type: %d %v", kind, err)
	}
	if session.intern(nil) != 0 {
		t.Fatal("intern nil")
	}
	if session.Identity(ast.NewDeclaration("missing", "1")) != 0 {
		t.Fatal("unknown identity")
	}
	node, err := session.lookup(decl)
	if err != nil {
		t.Fatal(err)
	}
	if session.Identity(node) != decl {
		t.Fatal("live identity")
	}

	stale := Handle(0)
	if _, err := session.GetField(stale, FieldProp); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("get stale: %v", err)
	}
	if err := session.SetField(stale, FieldProp, "x"); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("set stale: %v", err)
	}
	if _, err := session.Parent(stale); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("parent stale: %v", err)
	}
	if _, err := session.ChildCount(stale); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("count stale: %v", err)
	}
	if _, err := session.ChildAt(stale, 0); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("child stale: %v", err)
	}
	if err := session.Append(stale, decl); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("append parent: %v", err)
	}
	if err := session.Append(rule, stale); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("append child: %v", err)
	}
	if err := session.InsertBefore(stale, decl); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("insert target: %v", err)
	}
	if err := session.InsertBefore(decl, stale); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("insert child: %v", err)
	}
	if err := session.Remove(stale); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("remove: %v", err)
	}
	if _, err := session.Clone(stale); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("clone: %v", err)
	}
	if _, err := session.Collect(stale, false); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("collect: %v", err)
	}
	if _, err := session.ReadFields([]Handle{stale}, FieldProp); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("read: %v", err)
	}
	if err := session.SetFields([]Handle{stale}, FieldProp, []string{"x"}); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("write: %v", err)
	}
	if _, err := session.Stringify(stale); !errors.Is(err, ErrInvalidHandle) {
		t.Fatalf("stringify: %v", err)
	}

	session.Close()
	if session.Identity(node) != 0 {
		t.Fatal("identity after close")
	}
}

func TestInternReusesZeroGeneration(t *testing.T) {
	session := New()
	defer session.Close()
	first, err := session.NewDecl("a", "1")
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Dispose(first); err != nil {
		t.Fatal(err)
	}
	slot, _ := unpack(first)
	session.slots[slot].gen = 0
	next, err := session.NewDecl("b", "2")
	if err != nil {
		t.Fatal(err)
	}
	_, gen := unpack(next)
	if gen != 1 {
		t.Fatalf("zero gen repaired: %d", gen)
	}
}

func TestDisposeRootAndReuseGenerationWrap(t *testing.T) {
	session, root, err := Parse(".a { color: red; }")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if err := session.Dispose(root); err != nil {
		t.Fatal(err)
	}
	if session.Root() != 0 {
		t.Fatal("root handle should clear")
	}

	session = New()
	defer session.Close()
	h, err := session.NewDecl("a", "1")
	if err != nil {
		t.Fatal(err)
	}
	slot, _ := unpack(h)
	session.slots[slot].gen = 255
	wrapped := pack(slot, 255)
	if err := session.Dispose(wrapped); err != nil {
		t.Fatal(err)
	}
	next, err := session.NewDecl("b", "2")
	if err != nil {
		t.Fatal(err)
	}
	_, gen := unpack(next)
	if gen != 1 {
		t.Fatalf("wrapped gen: %d", gen)
	}
}
