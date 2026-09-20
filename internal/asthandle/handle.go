// Package asthandle is an opaque-handle ABI over the Go AST. Live nodes stay in
// a Go arena; TypeScript only forwards handle operations and public class identity.
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

var (
	ErrInvalidHandle   = errors.New("asthandle: invalid handle")
	ErrStaleHandle     = errors.New("asthandle: stale handle")
	ErrClosed          = errors.New("asthandle: session closed")
	ErrNotContainer    = errors.New("asthandle: node is not a container")
	ErrBadField        = errors.New("asthandle: unsupported field for node")
	ErrCursor          = errors.New("asthandle: invalid cursor")
	ErrParse           = errors.New("asthandle: parse failed")
	ErrExhausted       = errors.New("asthandle: ID space exhausted")
	ErrInvalidArgument = errors.New("asthandle: invalid argument")
	ErrCycle           = errors.New("asthandle: mutation would create a cycle")
)

type slotRecord struct {
	live bool
	node ast.Node
}

// Session is one parse/process arena. Handles are valid only for the session
// that minted them. Close invalidates every handle at once.
type Session struct {
	slots      map[uint32]slotRecord
	nextNode   uint32
	nextCursor uint32
	byNode     map[ast.Node]uint32
	root       Handle
	closed     bool
	cursors    map[uint32]*cursor
	dirty      map[Handle]struct{}
}

type cursor struct {
	handles []Handle
	offset  int
}

// Parse builds a session from CSS and interns every node in the tree.
func Parse(css string) (*Session, Handle, error) {
	return ParseWithOptions(css, sourcemap.Options{})
}

func ParseWithOptions(css string, options sourcemap.Options) (*Session, Handle, error) {
	root, err := parser.Parse(css, options)
	if err != nil {
		return nil, 0, fmt.Errorf("%w: %v", ErrParse, err)
	}
	session := New()
	if err := session.internTree(root); err != nil {
		session.Close()
		return nil, 0, err
	}
	session.root = session.Identity(root)
	return session, session.root, nil
}

// New returns an empty session. Detached nodes can be created without a parse.
func New() *Session {
	return &Session{
		slots:   make(map[uint32]slotRecord),
		cursors: make(map[uint32]*cursor),
		byNode:  map[ast.Node]uint32{},
		dirty:   map[Handle]struct{}{},
	}
}

func (s *Session) Root() Handle { return s.root }

func (s *Session) Close() {
	if s == nil || s.closed {
		return
	}
	s.closed = true
	s.slots = nil
	s.byNode = nil
	s.root = 0
	s.cursors = nil
	s.dirty = nil
}

// internTree preflights the whole allocation so failed clones leave no partial IDs.
func (s *Session) internTree(n ast.Node) error {
	if s == nil || s.closed {
		return ErrClosed
	}
	nodes := []ast.Node{}
	if n == nil {
		return nil
	}
	if err := ast.Walk(n, func(node ast.Node) error {
		if _, ok := s.byNode[node]; !ok {
			nodes = append(nodes, node)
		}
		return nil
	}); err != nil {
		return err
	}
	if uint64(s.nextNode)+uint64(len(nodes)) > uint64(^uint32(0)) {
		return ErrExhausted
	}
	for _, node := range nodes {
		s.nextNode++
		s.slots[s.nextNode] = slotRecord{live: true, node: node}
		s.byNode[node] = s.nextNode
	}
	return nil
}

func (s *Session) intern(n ast.Node) (Handle, error) {
	if err := s.internTree(n); err != nil {
		return 0, err
	}
	return s.Identity(n), nil
}

func (s *Session) lookup(h Handle) (ast.Node, error) {
	if s == nil || s.closed {
		return nil, ErrClosed
	}
	slot := uint32(h)
	rec, exists := s.slots[slot]
	if slot == 0 || !exists {
		return nil, ErrInvalidHandle
	}
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
	case FieldImportant:
		decl, ok := node.(*ast.Declaration)
		if !ok {
			return "", ErrBadField
		}
		if decl.Important {
			return "1", nil
		}
		return "0", nil
	default:
		return "", ErrBadField
	}
}

func (s *Session) SetField(h Handle, field Field, value string) error {
	node, err := s.lookup(h)
	if err != nil {
		return err
	}
	changed := false
	switch field {
	case FieldProp:
		decl, ok := node.(*ast.Declaration)
		if !ok {
			return ErrBadField
		}
		if decl.Prop != value {
			decl.Prop = value
			changed = true
		}
	case FieldValue:
		decl, ok := node.(*ast.Declaration)
		if !ok {
			return ErrBadField
		}
		if decl.Value != value {
			decl.Value = value
			changed = true
		}
	case FieldSelector:
		rule, ok := node.(*ast.Rule)
		if !ok {
			return ErrBadField
		}
		if rule.Selector != value {
			rule.Selector = value
			changed = true
		}
	case FieldName:
		at, ok := node.(*ast.AtRule)
		if !ok {
			return ErrBadField
		}
		if at.Name != value {
			at.Name = value
			changed = true
		}
	case FieldParams:
		at, ok := node.(*ast.AtRule)
		if !ok {
			return ErrBadField
		}
		if at.Params != value {
			at.Params = value
			changed = true
		}
	case FieldText:
		comment, ok := node.(*ast.Comment)
		if !ok {
			return ErrBadField
		}
		if comment.Text != value {
			comment.Text = value
			changed = true
		}
	case FieldImportant:
		decl, ok := node.(*ast.Declaration)
		if !ok {
			return ErrBadField
		}
		important, err := parseImportant(value)
		if err != nil {
			return err
		}
		if decl.Important != important {
			decl.Important = important
			changed = true
		}
	default:
		return ErrBadField
	}
	if changed {
		s.markDirty(h)
	}
	return nil
}

func parseImportant(value string) (bool, error) {
	switch value {
	case "0", "":
		return false, nil
	case "1":
		return true, nil
	default:
		return false, fmt.Errorf("%w: important must be 0 or 1", ErrInvalidArgument)
	}
}

func (s *Session) markDirty(h Handle) {
	if s == nil || s.closed {
		return
	}
	if s.dirty == nil {
		s.dirty = map[Handle]struct{}{}
	}
	for current := h; current != 0; {
		if _, seen := s.dirty[current]; seen {
			return
		}
		s.dirty[current] = struct{}{}
		parent, err := s.Parent(current)
		if err != nil || parent == 0 {
			return
		}
		current = parent
	}
}

// IsDirty reports whether a live handle has been marked dirty by a scalar write.
func (s *Session) IsDirty(h Handle) (bool, error) {
	if _, err := s.lookup(h); err != nil {
		return false, err
	}
	_, ok := s.dirty[h]
	return ok, nil
}

// HasDirty reports whether any node in the session still needs a revisit.
func (s *Session) HasDirty() bool {
	return s != nil && !s.closed && len(s.dirty) > 0
}

// ClearDirty removes dirty marks for h and, when h is the root, the whole tree.
func (s *Session) ClearDirty(h Handle) error {
	if _, err := s.lookup(h); err != nil {
		return err
	}
	if h == s.root {
		s.dirty = map[Handle]struct{}{}
		return nil
	}
	delete(s.dirty, h)
	return nil
}

// FieldPatch is one ordered scalar write inside an atomic ApplyPatches batch.
type FieldPatch struct {
	Handle Handle
	Field  Field
	Value  string
}

// ApplyPatches validates every scalar write, then commits them in order.
func (s *Session) ApplyPatches(patches []FieldPatch) error {
	if s == nil || s.closed {
		return ErrClosed
	}
	if len(patches) > int(MaxBatchSize) {
		return fmt.Errorf("%w: patch batch exceeds maximum", ErrInvalidArgument)
	}
	for _, patch := range patches {
		if _, err := s.GetField(patch.Handle, patch.Field); err != nil {
			return err
		}
		if patch.Field == FieldImportant {
			if _, err := parseImportant(patch.Value); err != nil {
				return err
			}
		}
	}
	for _, patch := range patches {
		if err := s.SetField(patch.Handle, patch.Field, patch.Value); err != nil {
			return err
		}
	}
	return nil
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
	return s.Identity(parent), nil
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
	return s.Identity(children[index]), nil
}

// NewDecl creates a detached declaration. It has no parent until Append or
// InsertBefore; Dispose drops the session's reference so the node can be GC'd.
func (s *Session) NewDecl(prop, value string) (Handle, error) {
	if s == nil || s.closed {
		return 0, ErrClosed
	}
	decl := ast.NewDeclaration(prop, value)
	return s.intern(decl)
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
	s.markDirty(parent)
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
	if err := targetNode.Before(childNode); err != nil {
		return err
	}
	if parent, err := s.Parent(target); err == nil && parent != 0 {
		s.markDirty(parent)
	}
	return nil
}

func (s *Session) Remove(h Handle) error {
	node, err := s.lookup(h)
	if err != nil {
		return err
	}
	parent, _ := s.Parent(h)
	node.Remove()
	if parent != 0 {
		s.markDirty(parent)
	}
	return nil
}

func (s *Session) Clone(h Handle) (Handle, error) {
	node, err := s.lookup(h)
	if err != nil {
		return 0, err
	}
	cloned := node.Clone()
	return s.intern(cloned)
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
		s.slots[slot] = slotRecord{}
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
		out = append(out, s.Identity(current))
		return nil
	})
	return out, err
}

// OpenCursor snapshots a walk so JS can pull handles in batches.
func (s *Session) OpenCursor(root Handle, declsOnly bool) (uint32, error) {
	handles, err := s.Collect(root, declsOnly)
	if err != nil {
		return 0, err
	}
	if s.nextCursor == ^uint32(0) {
		return 0, ErrExhausted
	}
	s.nextCursor++
	id := s.nextCursor
	s.cursors[id] = &cursor{handles: handles}
	return id, nil
}

func (s *Session) CursorNext(id uint32, dst []Handle) (int, error) {
	if s == nil || s.closed {
		return 0, ErrClosed
	}
	if s.cursors[id] == nil {
		return 0, ErrCursor
	}
	cur := s.cursors[id]
	n := copy(dst, cur.handles[cur.offset:])
	cur.offset += n
	return n, nil
}

func (s *Session) CloseCursor(id uint32) error {
	if s == nil || s.closed {
		return ErrClosed
	}
	if id == 0 || id > s.nextCursor {
		return ErrCursor
	}
	delete(s.cursors, id)
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
		return fmt.Errorf("%w: mutation batch length mismatch", ErrInvalidArgument)
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
