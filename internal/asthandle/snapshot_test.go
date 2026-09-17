package asthandle

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/jsbridge"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
)

func TestReadSnapshots(t *testing.T) {
	for _, css := range []string{"", "/* hi */ @charset \"utf-8\"; @media all { a,b { --x: red !important } };", "a{};\n", "😀{x:é}"} {
		s, root, err := ParseWithOptions(css, sourcemap.Options{From: "input.css", TrackSource: true})
		if err != nil {
			t.Fatal(err)
		}
		ids, _ := s.Collect(root, false)
		rows, err := s.ReadSnapshots(ids)
		if err != nil || len(rows) != len(ids) {
			t.Fatal(rows, err)
		}
		for i, row := range rows {
			node, _ := s.lookup(ids[i])
			dto, err := jsbridge.ToDTO(node)
			if err != nil {
				t.Fatal(err)
			}
			if row.ID != ids[i] || row.Type != node.Type() || !reflect.DeepEqual(row.Raws, dto.Raws) {
				t.Fatal(row, dto)
			}
			if row.Source != nil {
				dto.Source.CSS, dto.Source.MapURL = "", ""
				if !reflect.DeepEqual(row.Source, dto.Source) {
					t.Fatal(row.Source, dto.Source)
				}
			}
			if row.Prop != dto.Prop || row.Value != dto.Value || row.Selector != dto.Selector || row.Name != dto.Name || row.Params != dto.Params || row.Text != dto.Text || row.Important != dto.Important {
				t.Fatal(row, dto)
			}
			parent, _ := s.Parent(ids[i])
			if row.Parent != parent {
				t.Fatal(row)
			}
			for j, id := range row.Nodes {
				child, _ := s.ChildAt(ids[i], j)
				if child != id {
					t.Fatal(row)
				}
			}
			if row.Raws != nil {
				row.Raws["before"] = "changed"
				if node.RawFormattingReadOnly()["before"] == "changed" {
					t.Fatal("snapshot aliases live raws")
				}
			}
		}
		if _, err := json.Marshal(rows); err != nil {
			t.Fatal(err)
		}
		s.Close()
		if _, err := s.ReadSnapshots(ids); !errors.Is(err, ErrClosed) {
			t.Fatal(err)
		}
	}
}

func TestSnapshotValidationAndDocument(t *testing.T) {
	var closed *Session
	if _, err := closed.ReadSnapshots(nil); !errors.Is(err, ErrClosed) {
		t.Fatal(err)
	}
	s := New()
	doc := ast.NewDocument()
	doc.Append(ast.NewRoot())
	if err := s.internTree(doc); err != nil {
		t.Fatal(err)
	}
	id := s.Identity(doc)
	rows, err := s.ReadSnapshots([]Handle{id})
	if err != nil || rows[0].Type != ast.NodeDocument || len(rows[0].Nodes) != 1 {
		t.Fatal(rows, err)
	}
	if _, err := s.ReadSnapshots([]Handle{0}); !errors.Is(err, ErrInvalidHandle) {
		t.Fatal(err)
	}
	if _, err := s.ReadSnapshots(make([]Handle, int(MaxBatchSize)+1)); !errors.Is(err, ErrInvalidArgument) {
		t.Fatal(err)
	}
	if err := s.Dispose(id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadSnapshots([]Handle{id}); !errors.Is(err, ErrStaleHandle) {
		t.Fatal(err)
	}
}
