package asthandle

import (
	"encoding/json"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/stringifier"
)

type builderPart struct {
	CSS  string `json:"css"`
	Node uint32 `json:"node,omitempty"`
	Type string `json:"type,omitempty"`
}

// StringifyBuilder replays Go stringifier chunks with session-local handle ids.
func (s *Session) StringifyBuilder(handle Handle) (string, error) {
	node, err := s.lookup(handle)
	if err != nil {
		return "", err
	}
	indexed := make([]ast.Node, 0)
	_ = ast.Walk(node, func(current ast.Node) error {
		indexed = append(indexed, current)
		return nil
	})
	parts := stringifier.StringifyWithBuilder(node)
	out := make([]builderPart, 0, len(parts))
	for _, part := range parts {
		item := builderPart{CSS: part.CSS, Type: part.Type}
		if part.Node > 0 && part.Node <= len(indexed) {
			item.Node = uint32(s.Identity(indexed[part.Node-1]))
		}
		out = append(out, item)
	}
	encoded, err := json.Marshal(out)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
