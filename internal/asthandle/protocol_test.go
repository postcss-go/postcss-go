package asthandle

import (
	"errors"
	"fmt"
	"testing"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
)

func TestExhaustionIsAtomicAndNeverReusesIDs(t *testing.T) {
	s, root, _ := Parse("a{x:y}")
	defer s.Close()
	s.nextNode = ^uint32(0) - 1
	before := len(s.slots)
	if _, err := s.Clone(root); !errors.Is(err, ErrExhausted) {
		t.Fatal(err)
	}
	if len(s.slots) != before || s.nextNode != ^uint32(0)-1 {
		t.Fatal("clone partially allocated")
	}
	last, err := s.NewDecl("last", "value")
	if err != nil || uint32(last) != ^uint32(0) {
		t.Fatal(last, err)
	}
	if err := s.Dispose(last); err != nil {
		t.Fatal(err)
	}
	if _, err := s.NewDecl("overflow", "value"); !errors.Is(err, ErrExhausted) {
		t.Fatal(err)
	}
	if _, err := s.GetField(last, FieldValue); !errors.Is(err, ErrStaleHandle) {
		t.Fatal(err)
	}
	s.nextCursor = ^uint32(0) - 1
	cursor, err := s.OpenCursor(root, true)
	if err != nil || cursor != ^uint32(0) {
		t.Fatal(cursor, err)
	}
	if n, err := s.CursorNext(cursor, make([]Handle, 1)); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	if err := s.CloseCursor(cursor); err != nil {
		t.Fatal(err)
	}
	if err := s.CloseCursor(cursor); err != nil {
		t.Fatal("close is not idempotent", err)
	}
	if len(s.cursors) != 0 {
		t.Fatal("closed cursor retained")
	}
	if _, err := s.OpenCursor(root, true); !errors.Is(err, ErrExhausted) {
		t.Fatal(err)
	}
	if _, err := s.CursorNext(cursor, nil); !errors.Is(err, ErrCursor) {
		t.Fatal(err)
	}
	var r Registry
	r.next = ^uint32(0) - 1
	id, _, err := r.Parse("a{}")
	if err != nil || id != ^uint32(0) {
		t.Fatal(id, err)
	}
	r.Close(id)
	if _, _, err := r.Parse("a{}"); !errors.Is(err, ErrExhausted) {
		t.Fatal(err)
	}
	if r.Len() != 0 {
		t.Fatal("failed parse leaked session")
	}
}

func TestParseSourceIdentityAndDetachContract(t *testing.T) {
	s, root, err := ParseWithOptions("a{x:y}", sourcemap.Options{From: "/sources/original.css", Document: "original", TrackSource: true})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	node, _ := s.lookup(root)
	ids, _ := s.Collect(root, true)
	decl, _ := s.lookup(ids[0])
	if node.Source().Input != decl.Source().Input || decl.Source().Input.File != "/sources/original.css" || decl.Source().Input.CSS != "a{x:y}" {
		t.Fatal("source identity lost")
	}
	rule, _ := s.ChildAt(root, 0)
	if err := s.Remove(ids[0]); err != nil {
		t.Fatal(err)
	}
	if parent, _ := s.Parent(ids[0]); parent != 0 {
		t.Fatal("detached parent")
	}
	if err := s.Append(rule, ids[0]); err != nil {
		t.Fatal(err)
	}
	if s.Identity(decl) != ids[0] {
		t.Fatal("reinsertion changed identity")
	}
	if err := s.Dispose(rule); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Parent(ids[0]); !errors.Is(err, ErrStaleHandle) {
		t.Fatal(err)
	}
	s.Close()
	if _, err := s.intern(ast.NewRoot()); !errors.Is(err, ErrClosed) {
		t.Fatal(err)
	}
}

func TestErrorStatus(t *testing.T) {
	cases := []struct {
		err  error
		want uint32
	}{{nil, StatusOK}, {ErrInvalidHandle, StatusInvalidHandle}, {ErrStaleHandle, StatusStaleHandle}, {ErrClosed, StatusClosed}, {ErrNotContainer, StatusNotContainer}, {ErrBadField, StatusBadField}, {ErrCursor, StatusCursor}, {ErrParse, StatusParse}, {ErrCycle, StatusCycle}, {ErrExhausted, StatusExhausted}, {ErrInvalidArgument, StatusInvalidArgument}, {errors.New("unknown"), StatusInternal}}
	for _, c := range cases {
		if got := ErrorStatus(c.err); got != c.want {
			t.Fatal(got, c.want)
		}
		if c.err != nil && ErrorStatus(fmt.Errorf("wrapped: %w", c.err)) != c.want {
			t.Fatal("wrapped status lost")
		}
	}
}
