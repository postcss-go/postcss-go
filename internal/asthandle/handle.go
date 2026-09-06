// Package asthandle is an opaque-handle ABI over the Go AST for declaration-heavy
// plugin paths. Production Node N-API can opt into this model; the default
// binary AST codec remains for full PostCSS compatibility and WASM transport.
package asthandle

//go:generate go run ./cmd/genprotocol

import (
	"errors"
	"fmt"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/parser"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
	"github.com/postcss-go/postcss-go/internal/stringifier"
)

// Handle is a session-local opaque node id. IDs are never reused.
type Handle uint32

// Field identifies a scalar node property readable or writable across the ABI.
type Field int32

const (
	TypeNone int32 = iota
	TypeRoot
	TypeDocument
	TypeRule
	TypeAtRule
	TypeDecl
	TypeComment
)

var (
	ErrInvalidHandle = errors.New("asthandle: invalid handle")
	ErrStaleHandle   = errors.New("asthandle: stale handle")
	ErrClosed        = errors.New("asthandle: session closed")
	ErrNotContainer  = errors.New("asthandle: node is not a container")
	ErrBadField      = errors.New("asthandle: unsupported field for node")
	ErrCursor        = errors.New("asthandle: invalid cursor")
	ErrParse         = errors.New("asthandle: parse failed")
	ErrCycle         = errors.New("asthandle: mutation would create a cycle")
)

type slotRecord struct {
	live bool
	node ast.Node
}

// Session is one parse/process arena. Handles are valid only for the session
// that minted them. Close invalidates every handle at once.
type Session struct {
	slots   []slotRecord
	byNode  map[ast.Node]uint32
	root    Handle
	closed  bool
	cursors []*cursor
}

type cursor struct {
	handles []Handle
	offset  int
	open    bool
}

// Parse builds a session from CSS and interns every node in the tree.
func Parse(css string) (*Session, Handle, error) {
	root, err := parser.Parse(css, sourcemap.Options{From: "handle.css"})
	if err != nil {
		return nil, 0, fmt.Errorf("%w: %v", ErrParse, err)
	}
	session := New()
	session.internTree(root)
	session.root = session.mustHandle(root)
	return session, session.root, nil
}

// New returns an empty session. Detached nodes can be created without a parse.
func New() *Session {
	return &Session{
		slots:  []slotRecord{{}}, // slot 0 is reserved
		byNode: map[ast.Node]uint32{},
	}
}

func (s *Session) Root() Handle { return s.root }

func (s *Session) Close() {
	if s == nil || s.closed {
		return
	}
	s.closed = true
	for i := range s.slots {
		s.slots[i].live = false
		s.slots[i].node = nil
	}
	s.byNode = nil
	s.root = 0
	for _, cur := range s.cursors {
		if cur != nil {
			cur.open = false
			cur.handles = nil
		}
	}
}

func (s *Session) intern(n ast.Node) uint32 {
	if n == nil {
		return 0
	}
	if slot, ok := s.byNode[n]; ok {
		return slot
	}
	if uint64(len(s.slots)) > uint64(^uint32(0)) {
		panic("asthandle: node ID space exhausted")
	}
	slot := uint32(len(s.slots))
	s.slots = append(s.slots, slotRecord{live: true, node: n})
	s.byNode[n] = slot
	return slot
}

func (s *Session) internTree(n ast.Node) {
	s.intern(n)
	container, ok := n.(ast.Container)
	if !ok {
		return
	}
	for _, child := range container.Children() {
		s.internTree(child)
	}
}

func (s *Session) mustHandle(n ast.Node) Handle {
	slot := s.intern(n)
	return Handle(slot)
}

func (s *Session) lookup(h Handle) (ast.Node, error) {
	if s == nil || s.closed {
		return nil, ErrClosed
	}
	slot := uint32(h)
	if slot == 0 || int(slot) >= len(s.slots) {
		return nil, ErrInvalidHandle
	}
	rec := s.slots[slot]
	if !rec.live {
		return nil, ErrStaleHandle
	}
	return rec.node, nil
}

// Identity returns the current handle for a live node, or 0 if it is unknown.
func (s *Session) Identity(n ast.Node) Handle {
	if s == nil || s.closed || n == nil {
		return 0
	}
	slot, ok := s.byNode[n]
	if !ok {
		return 0
	}
	return Handle(slot)
}

func (s *Session) Type(h Handle) (int32, error) {
	node, err := s.lookup(h)
	if err != nil {
		return TypeNone, err
	}
	switch node.(type) {
	case *ast.Root:
		return TypeRoot, nil
	case *ast.Document:
		return TypeDocument, nil
	case *ast.Rule:
		return TypeRule, nil
	case *ast.AtRule:
		return TypeAtRule, nil
	case *ast.Declaration:
		return TypeDecl, nil
	case *ast.Comment:
		return TypeComment, nil
	default:
		return TypeNone, ErrInvalidHandle
	}
}

func (s *Session) GetField(h Handle, field Field) (string, error) {
	node, err := s.lookup(h)
	if err != nil {
		return "", err
	}
	switch field {
	case FieldProp:
		decl, ok := node.(*ast.Declaration)
		if !ok {
			return "", ErrBadField
		}
		return decl.Prop, nil
	case FieldValue:
		decl, ok := node.(*ast.Declaration)
		if !ok {
			return "", ErrBadField
		}
		return decl.Value, nil
	case FieldSelector:
		rule, ok := node.(*ast.Rule)
		if !ok {
			return "", ErrBadField
		}
		return rule.Selector, nil
	case FieldName:
		at, ok := node.(*ast.AtRule)
		if !ok {
			return "", ErrBadField
		}
		return at.Name, nil
	case FieldParams:
		at, ok := node.(*ast.AtRule)
		if !ok {
			return "", ErrBadField
		}
		return at.Params, nil
	case FieldText:
		comment, ok := node.(*ast.Comment)
		if !ok {
			return "", ErrBadField
		}
		return comment.Text, nil
	default:
		return "", ErrBadField
	}
}

func (s *Session) SetField(h Handle, field Field, value string) error {
	node, err := s.lookup(h)
	if err != nil {
		return err
	}
	switch field {
	case FieldProp:
		decl, ok := node.(*ast.Declaration)
		if !ok {
			return ErrBadField
		}
		decl.Prop = value
		return nil
	case FieldValue:
		decl, ok := node.(*ast.Declaration)
		if !ok {
			return ErrBadField
		}
		decl.Value = value
		return nil
	case FieldSelector:
		rule, ok := node.(*ast.Rule)
		if !ok {
			return ErrBadField
		}
		rule.Selector = value
		return nil
	case FieldName:
		at, ok := node.(*ast.AtRule)
		if !ok {
			return ErrBadField
		}
		at.Name = value
		return nil
	case FieldParams:
		at, ok := node.(*ast.AtRule)
		if !ok {
			return ErrBadField
		}
		at.Params = value
		return nil
	case FieldText:
		comment, ok := node.(*ast.Comment)
		if !ok {
			return ErrBadField
		}
		comment.Text = value
		return nil
	default:
		return ErrBadField
	}
}

func (s *Session) Parent(h Handle) (Handle, error) {
	node, err := s.lookup(h)
	if err != nil {
		return 0, err
	}
	parent := node.Parent()
	if parent == nil {
		return 0, nil
	}
	return s.mustHandle(parent), nil
}

func (s *Session) ChildCount(h Handle) (int, error) {
	node, err := s.lookup(h)
	if err != nil {
		return 0, err
	}
	container, ok := node.(ast.Container)
	if !ok {
		return 0, nil
	}
	return len(container.Children()), nil
}

func (s *Session) ChildAt(h Handle, index int) (Handle, error) {
	node, err := s.lookup(h)
	if err != nil {
		return 0, err
	}
	container, ok := node.(ast.Container)
	if !ok {
		return 0, ErrNotContainer
	}
	children := container.Children()
	if index < 0 || index >= len(children) {
		return 0, ErrInvalidHandle
	}
	return s.mustHandle(children[index]), nil
}

// NewDecl creates a detached declaration. It has no parent until Append or
// InsertBefore; Dispose drops the session's reference so the node can be GC'd.
func (s *Session) NewDecl(prop, value string) (Handle, error) {
	if s == nil || s.closed {
		return 0, ErrClosed
	}
	decl := ast.NewDeclaration(prop, value)
	return s.mustHandle(decl), nil
}

func (s *Session) Append(parent, child Handle) error {
	parentNode, err := s.lookup(parent)
	if err != nil {
		return err
	}
	childNode, err := s.lookup(child)
	if err != nil {
		return err
	}
	container, ok := parentNode.(ast.Container)
	if !ok {
		return ErrNotContainer
	}
	for ancestor := parentNode; ancestor != nil; ancestor = ancestor.Parent() {
		if ancestor == childNode {
			return ErrCycle
		}
	}
	container.Append(childNode)
	return nil
}

func (s *Session) InsertBefore(target, child Handle) error {
	targetNode, err := s.lookup(target)
	if err != nil {
		return err
	}
	childNode, err := s.lookup(child)
	if err != nil {
		return err
	}
	if targetNode == childNode {
		return nil
	}
	for ancestor := ast.Node(targetNode.Parent()); ancestor != nil; ancestor = ancestor.Parent() {
		if ancestor == childNode {
			return ErrCycle
		}
	}
	return targetNode.Before(childNode)
}

func (s *Session) Remove(h Handle) error {
	node, err := s.lookup(h)
	if err != nil {
		return err
	}
	node.Remove()
	return nil
}

func (s *Session) Clone(h Handle) (Handle, error) {
	node, err := s.lookup(h)
	if err != nil {
		return 0, err
	}
	cloned := node.Clone()
	s.internTree(cloned)
	return s.mustHandle(cloned), nil
}

// Dispose invalidates a handle. Attached nodes are removed from the tree first.
// Tombstones prevent stale IDs from ever referring to replacement nodes.
func (s *Session) Dispose(h Handle) error {
	node, err := s.lookup(h)
	if err != nil {
		return err
	}
	if node.Parent() != nil {
		node.Remove()
	}
	// Dispose the attached subtree, too: otherwise a child's Parent() could
	// re-intern the disposed parent and resurrect it under a different ID.
	stack := []ast.Node{node}
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if container, ok := current.(ast.Container); ok {
			stack = append(stack, container.Children()...)
		}
		slot := s.byNode[current]
		delete(s.byNode, current)
		s.slots[slot].node = nil
		s.slots[slot].live = false
	}
	if h == s.root {
		s.root = 0
	}
	return nil
}

// Collect walks from root and returns handles, optionally declarations only.
func (s *Session) Collect(root Handle, declsOnly bool) ([]Handle, error) {
	node, err := s.lookup(root)
	if err != nil {
		return nil, err
	}
	out := make([]Handle, 0, 64)
	err = ast.Walk(node, func(current ast.Node) error {
		if declsOnly {
			if _, ok := current.(*ast.Declaration); !ok {
				return nil
			}
		}
		out = append(out, s.mustHandle(current))
		return nil
	})
	return out, err
}

// OpenCursor snapshots a walk so JS can pull handles in batches.
func (s *Session) OpenCursor(root Handle, declsOnly bool) (int, error) {
	handles, err := s.Collect(root, declsOnly)
	if err != nil {
		return -1, err
	}
	id := len(s.cursors)
	s.cursors = append(s.cursors, &cursor{handles: handles, open: true})
	return id, nil
}

func (s *Session) CursorNext(id int, dst []Handle) (int, error) {
	if s == nil || s.closed {
		return 0, ErrClosed
	}
	if id < 0 || id >= len(s.cursors) || s.cursors[id] == nil || !s.cursors[id].open {
		return 0, ErrCursor
	}
	cur := s.cursors[id]
	n := copy(dst, cur.handles[cur.offset:])
	cur.offset += n
	return n, nil
}

func (s *Session) CloseCursor(id int) error {
	if s == nil || s.closed {
		return ErrClosed
	}
	if id < 0 || id >= len(s.cursors) || s.cursors[id] == nil {
		return ErrCursor
	}
	s.cursors[id].open = false
	s.cursors[id].handles = nil
	return nil
}

// ReadFields copies one field from every handle into a parallel string slice.
func (s *Session) ReadFields(handles []Handle, field Field) ([]string, error) {
	out := make([]string, len(handles))
	for i, h := range handles {
		value, err := s.GetField(h, field)
		if err != nil {
			return nil, err
		}
		out[i] = value
	}
	return out, nil
}

// SetFields validates the complete batch before changing any node.
func (s *Session) SetFields(handles []Handle, field Field, values []string) error {
	if len(handles) != len(values) {
		return fmt.Errorf("asthandle: mutation batch length mismatch")
	}
	if s == nil || s.closed {
		return ErrClosed
	}
	for _, h := range handles {
		if _, err := s.GetField(h, field); err != nil {
			return err
		}
	}
	for i, h := range handles {
		if err := s.SetField(h, field, values[i]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Session) Stringify(h Handle) (string, error) {
	node, err := s.lookup(h)
	if err != nil {
		return "", err
	}
	return stringifier.Stringify(node), nil
}
