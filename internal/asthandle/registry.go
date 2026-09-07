package asthandle

import (
	"github.com/postcss-go/postcss-go/internal/sourcemap"
	"sync"
)

// Registry owns independent arenas. A lease serializes operations on one arena;
// unrelated sessions can proceed concurrently. Session itself is not thread safe.
type Registry struct {
	mu      sync.Mutex
	next    uint32
	entries map[uint32]*entry
}

type entry struct {
	mu      sync.Mutex
	session *Session
}

// Len is a lifecycle diagnostic, not an ownership or synchronization primitive.
func (r *Registry) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.entries)
}

func (r *Registry) Parse(css string) (uint32, Handle, error) {
	return r.ParseWithOptions(css, sourcemap.Options{})
}

func (r *Registry) ParseWithOptions(css string, options sourcemap.Options) (uint32, Handle, error) {
	s, root, err := ParseWithOptions(css, options)
	if err != nil {
		return 0, 0, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	// Never reuse IDs: late closes/finalizers must not close a newer arena.
	if r.next == ^uint32(0) {
		s.Close()
		return 0, 0, ErrExhausted
	}
	r.next++
	if r.entries == nil {
		r.entries = make(map[uint32]*entry)
	}
	r.entries[r.next] = &entry{session: s}
	return r.next, root, nil
}

func (r *Registry) Acquire(id uint32) (*Session, func()) {
	r.mu.Lock()
	e := r.entries[id]
	r.mu.Unlock()
	if e == nil {
		return nil, func() {}
	}
	e.mu.Lock()
	if e.session == nil {
		e.mu.Unlock()
		return nil, func() {}
	}
	return e.session, e.mu.Unlock
}

func (r *Registry) Close(id uint32) {
	r.mu.Lock()
	e := r.entries[id]
	delete(r.entries, id)
	r.mu.Unlock()
	if e == nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.session.Close()
	e.session = nil
}
