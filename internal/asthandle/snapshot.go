package asthandle

import (
	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/jsbridge"
)

// Snapshot is a flat read-only page row. Relationships remain session-local IDs;
// source text is retained once by the session, never repeated in each row.
type Snapshot struct {
	Source    *jsbridge.SourceLocationDTO `json:"source,omitempty"`
	ID        Handle                      `json:"id"`
	Type      ast.NodeType                `json:"type"`
	Parent    Handle                      `json:"parent"`
	Nodes     []Handle                    `json:"nodes,omitempty"`
	Block     bool                        `json:"block,omitempty"`
	Prop      string                      `json:"prop,omitempty"`
	Value     string                      `json:"value,omitempty"`
	Selector  string                      `json:"selector,omitempty"`
	Name      string                      `json:"name,omitempty"`
	Params    string                      `json:"params,omitempty"`
	Text      string                      `json:"text,omitempty"`
	Important bool                        `json:"important,omitempty"`
	Raws      ast.Raws                    `json:"raws"`
}

func (s *Session) ReadSnapshots(handles []Handle) ([]Snapshot, error) {
	if s == nil || s.closed {
		return nil, ErrClosed
	}
	if len(handles) > int(MaxBatchSize) {
		return nil, ErrInvalidArgument
	}
	rows := make([]Snapshot, len(handles))
	for i, id := range handles {
		node, err := s.lookup(id)
		if err != nil {
			return nil, err
		}
		row := Snapshot{ID: id, Type: node.Type(), Raws: ast.CloneRaws(node.RawFormattingReadOnly())}
		if parent := node.Parent(); parent != nil {
			row.Parent = s.Identity(parent)
		}
		if container, ok := node.(ast.Container); ok {
			for _, child := range container.Children() {
				row.Nodes = append(row.Nodes, s.Identity(child))
			}
		}
		switch n := node.(type) {
		case *ast.Declaration:
			row.Prop, row.Value, row.Important = n.Prop, n.Value, n.Important
		case *ast.Rule:
			row.Selector = n.Selector
		case *ast.AtRule:
			row.Name, row.Params, row.Block = n.Name, n.Params, n.HasBlock()
		case *ast.Comment:
			row.Text = n.Text
		}
		switch n := node.(type) {
		case *ast.Rule:
			own, _ := ast.LookupRawString(n, "ownSemicolon")
			row.Source = jsbridge.RuleSourceToBridgeDTO(n.Source(), own != "", false)
		default:
			row.Source = jsbridge.SourceToBridgeDTO(node.Source(), node.Type() != ast.NodeRoot && node.Type() != ast.NodeDocument, row.Block, false, false)
		}
		rows[i] = row
	}
	return rows, nil
}
