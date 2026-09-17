package asthandle

import (
	"encoding/json"
	"fmt"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/stringifier"
)

func (s *Session) guardCycle(parent, child ast.Node) error {
	for ancestor := parent; ancestor != nil; ancestor = ancestor.Parent() {
		if ancestor == child {
			return ErrCycle
		}
	}
	return nil
}

func (s *Session) Prepend(parent, child Handle) error {
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
	if err := s.guardCycle(parentNode, childNode); err != nil {
		return err
	}
	container.Prepend(childNode)
	s.markDirty(parent)
	return nil
}

func (s *Session) InsertAfter(target, child Handle) error {
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
	if err := s.guardCycle(targetNode.Parent(), childNode); err != nil {
		return err
	}
	if err := targetNode.After(childNode); err != nil {
		return err
	}
	if parent, err := s.Parent(target); err == nil && parent != 0 {
		s.markDirty(parent)
	}
	return nil
}

func (s *Session) ReplaceWith(target Handle, replacements ...Handle) error {
	targetNode, err := s.lookup(target)
	if err != nil {
		return err
	}
	nodes := make([]ast.Node, len(replacements))
	for i, id := range replacements {
		node, err := s.lookup(id)
		if err != nil {
			return err
		}
		if err := s.guardCycle(targetNode.Parent(), node); err != nil {
			return err
		}
		nodes[i] = node
	}
	parent, _ := s.Parent(target)
	if err := targetNode.ReplaceWith(nodes...); err != nil {
		return err
	}
	if parent != 0 {
		s.markDirty(parent)
	}
	s.markDirty(target)
	return nil
}

func (s *Session) NewRule(selector string) (Handle, error) {
	if s == nil || s.closed {
		return 0, ErrClosed
	}
	return s.intern(ast.NewRule(selector))
}

func (s *Session) NewAtRule(name, params string) (Handle, error) {
	if s == nil || s.closed {
		return 0, ErrClosed
	}
	return s.intern(ast.NewAtRule(name, params))
}

func (s *Session) NewComment(text string) (Handle, error) {
	if s == nil || s.closed {
		return 0, ErrClosed
	}
	return s.intern(ast.NewComment(text))
}

// RawPatch encodes a single raws key write. Kind is "string", "bool", "value", or "delete".
type RawPatch struct {
	Key   string          `json:"key"`
	Kind  string          `json:"kind"`
	Value json.RawMessage `json:"value,omitempty"`
}

func (s *Session) SetRaw(h Handle, patch RawPatch) error {
	node, err := s.lookup(h)
	if err != nil {
		return err
	}
	switch patch.Kind {
	case "delete":
		ast.DeleteRaw(node, patch.Key)
	case "bool":
		var value bool
		if err := json.Unmarshal(patch.Value, &value); err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidArgument, err)
		}
		ast.SetRawBool(node, patch.Key, value)
	case "value":
		var value ast.RawValue
		if err := json.Unmarshal(patch.Value, &value); err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidArgument, err)
		}
		ast.SetRawValue(node, patch.Key, value)
	case "string", "":
		var value string
		if len(patch.Value) == 0 {
			value = ""
		} else if err := json.Unmarshal(patch.Value, &value); err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidArgument, err)
		}
		ast.SetRawString(node, patch.Key, value)
	default:
		return fmt.Errorf("%w: unknown raw kind %q", ErrInvalidArgument, patch.Kind)
	}
	s.markDirty(h)
	return nil
}

func (s *Session) GetRawsJSON(h Handle) (string, error) {
	node, err := s.lookup(h)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(ast.CloneRaws(node.RawFormattingReadOnly()))
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidArgument, err)
	}
	return string(encoded), nil
}

// StringifyMap returns CSS and an optional source-map JSON payload.
func (s *Session) StringifyMap(h Handle, opts stringifier.SourceMapOptions) (css string, mapJSON string, err error) {
	node, err := s.lookup(h)
	if err != nil {
		return "", "", err
	}
	result, err := stringifier.StringifyWithSourceMap(node, opts)
	if err != nil {
		return "", "", err
	}
	return result.CSS, result.Map, nil
}

// RefreshSnapshots re-reads live relationship and scalar rows for the given IDs.
func (s *Session) RefreshSnapshots(handles []Handle) ([]Snapshot, error) {
	return s.ReadSnapshots(handles)
}

// MarkStructuralDirty marks a node dirty after a structural mutation.
func (s *Session) MarkStructuralDirty(h Handle) {
	s.markDirty(h)
}
