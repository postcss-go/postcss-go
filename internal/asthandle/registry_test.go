package asthandle

import (
	"errors"
	"sync"
	"testing"
)

func TestRegistryIsolationAndClose(t *testing.T) {
	var r Registry
	a, ar, err := r.Parse("a{x:one}")
	if err != nil {
		t.Fatal(err)
	}
	b, br, _ := r.Parse("b{x:two}")
	defer r.Close(b)
	if a == b {
		t.Fatal("duplicate session")
	}
	r.Close(a)
	r.Close(a)
	if s, release := r.Acquire(a); s != nil {
		release()
		t.Fatal("closed session")
	} else {
		release()
	}
	s, release := r.Acquire(b)
	defer release()
	css, err := s.Stringify(br)
	if err != nil || css != "b{x:two}" {
		t.Fatalf("%s %v", css, err)
	}
	if ar == 0 {
		t.Fatal("missing root")
	}
}

func TestRegistryConcurrentUseAndClose(t *testing.T) {
	var r Registry
	id, root, _ := r.Parse("a{x:y}")
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 30; j++ {
				s, release := r.Acquire(id)
				if s != nil {
					if _, err := s.Stringify(root); err != nil {
						t.Error(err)
					}
				}
				release()
			}
			r.Close(id)
		}()
	}
	wg.Wait()
	if r.Len() != 0 {
		t.Fatal("session leak")
	}
}

func TestRegistryParseFailureAndExhaustion(t *testing.T) {
	var r Registry
	if _, _, err := r.Parse("{"); !errors.Is(err, ErrParse) {
		t.Fatal(err)
	}
	r.next = ^uint32(0)
	if _, _, err := r.Parse(""); !errors.Is(err, ErrInvalidHandle) {
		t.Fatal(err)
	}
}

func TestBatchFailureIsAtomic(t *testing.T) {
	s, root, _ := Parse("a{x:old;y:old}")
	defer s.Close()
	ids, _ := s.Collect(root, true)
	for _, bad := range []Handle{0, root} {
		if err := s.SetFields([]Handle{ids[0], bad}, FieldValue, []string{"new", "new"}); err == nil {
			t.Fatal("invalid batch accepted")
		}
		value, _ := s.GetField(ids[0], FieldValue)
		if value != "old" {
			t.Fatal("partial commit")
		}
	}
	if err := s.SetFields([]Handle{ids[0], ids[0]}, FieldValue, []string{"first", "last"}); err != nil {
		t.Fatal(err)
	}
	if value, _ := s.GetField(ids[0], FieldValue); value != "last" {
		t.Fatal(value)
	}
	s.Close()
	if err := s.SetFields(nil, FieldValue, nil); !errors.Is(err, ErrClosed) {
		t.Fatal(err)
	}
}

func TestRejectCyclesBeforeMutation(t *testing.T) {
	s, root, _ := Parse("a{x:y}")
	defer s.Close()
	rule, _ := s.ChildAt(root, 0)
	decl, _ := s.ChildAt(rule, 0)
	for _, pair := range [][2]Handle{{root, root}, {rule, root}} {
		if err := s.Append(pair[0], pair[1]); !errors.Is(err, ErrCycle) {
			t.Fatal(err)
		}
	}
	if err := s.InsertBefore(decl, root); !errors.Is(err, ErrCycle) {
		t.Fatal(err)
	}
	if err := s.InsertBefore(decl, decl); err != nil {
		t.Fatal(err)
	}
	if css, _ := s.Stringify(root); css != "a{x:y}" {
		t.Fatal(css)
	}
}
