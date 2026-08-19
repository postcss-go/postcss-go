package codec

import (
	"encoding/binary"
	"fmt"
	"math"

	"postcss-go/internal/ast"
	"postcss-go/internal/jsbridge"
	"postcss-go/internal/postcss"
)

// EncodeDTO serializes a bridge DTO tree.
func EncodeDTO(root *jsbridge.NodeDTO) ([]byte, error) {
	if root == nil {
		return nil, fmt.Errorf("codec: nil root")
	}
	dst := make([]byte, 0, encodeCapacity(nil))
	dst = append(dst, magic0, magic1, magic2, magic3, version)
	var err error
	dst, err = encodeDTONode(dst, root)
	return dst, err
}

// EncodeAST writes the PostCSS-facing binary encoding straight from a live Go
// AST. It applies the same source-column adjustments as jsbridge.ToDTO but does
// not allocate an intermediate NodeDTO tree or clone Raws.
func EncodeAST(node ast.Node) ([]byte, error) {
	if node == nil {
		return nil, fmt.Errorf("codec: nil node")
	}
	dst := make([]byte, 0, encodeCapacity(node))
	dst = append(dst, magic0, magic1, magic2, magic3, version)
	return encodeASTNode(dst, node, true)
}

func encodeCapacity(node ast.Node) int {
	const minCap = 256
	if node == nil {
		return minCap
	}
	rng := node.Range()
	size := rng.End - rng.Start
	if size < 0 {
		size = 0
	}
	// Raws keys and source metadata inflate the payload past CSS size; the
	// root also embeds the original CSS when includeInput is set.
	capacity := size*3 + minCap
	if capacity < minCap {
		return minCap
	}
	return capacity
}

func encodeASTNode(dst []byte, node ast.Node, includeInput bool) ([]byte, error) {
	var err error
	switch current := node.(type) {
	case *ast.Document:
		dst = append(dst, tagDocument)
		dst, err = encodeNodeRaws(dst, current)
		if err != nil {
			return nil, err
		}
		dst = encodeASTSource(dst, current.Source(), false, false, false, includeInput)
		return encodeASTChildren(dst, current.Children())
	case *ast.Root:
		dst = append(dst, tagRoot)
		dst, err = encodeNodeRaws(dst, current)
		if err != nil {
			return nil, err
		}
		dst = encodeASTSource(dst, current.Source(), false, false, false, includeInput)
		return encodeASTChildren(dst, current.Children())
	case *ast.Rule:
		dst = append(dst, tagRule)
		dst = appendString(dst, current.Selector)
		dst, err = encodeNodeRaws(dst, current)
		if err != nil {
			return nil, err
		}
		ownSemicolon := lookupRawString(current, "ownSemicolon") == ";"
		dst = encodeASTSource(dst, current.Source(), true, true, ownSemicolon, includeInput)
		return encodeASTChildren(dst, current.Children())
	case *ast.AtRule:
		dst = append(dst, tagAtRule)
		dst = appendString(dst, current.Name)
		dst = appendString(dst, current.Params)
		if current.Block {
			dst = append(dst, 1)
		} else {
			dst = append(dst, 0)
		}
		dst, err = encodeNodeRaws(dst, current)
		if err != nil {
			return nil, err
		}
		dst = encodeASTSource(dst, current.Source(), true, current.Block, false, includeInput)
		return encodeASTChildren(dst, current.Children())
	case *ast.Declaration:
		dst = append(dst, tagDecl)
		dst = appendString(dst, current.Prop)
		dst = appendString(dst, current.Value)
		if current.Important {
			dst = append(dst, 1)
		} else {
			dst = append(dst, 0)
		}
		dst, err = encodeNodeRaws(dst, current)
		if err != nil {
			return nil, err
		}
		dst = encodeASTSource(dst, current.Source(), true, false, false, includeInput)
		return dst, nil
	case *ast.Comment:
		dst = append(dst, tagComment)
		dst = appendString(dst, current.Text)
		dst, err = encodeNodeRaws(dst, current)
		if err != nil {
			return nil, err
		}
		preserveEndColumn := current.Source() != nil && current.Source().Input != nil && current.Source().Input.HasSourceMap()
		dst = encodeASTSource(dst, current.Source(), true, false, preserveEndColumn, includeInput)
		return dst, nil
	default:
		return nil, fmt.Errorf("codec: unsupported node type %T", node)
	}
}

func encodeASTChildren(dst []byte, children []ast.Node) ([]byte, error) {
	dst = binary.AppendUvarint(dst, uint64(len(children)))
	for _, child := range children {
		var err error
		dst, err = encodeASTNode(dst, child, false)
		if err != nil {
			return nil, err
		}
	}
	return dst, nil
}

func encodeDTONode(dst []byte, node *jsbridge.NodeDTO) ([]byte, error) {
	if node == nil {
		return nil, fmt.Errorf("codec: nil node")
	}
	var err error
	switch node.Type {
	case string(ast.NodeRoot):
		dst = append(dst, tagRoot)
	case string(ast.NodeDocument):
		dst = append(dst, tagDocument)
	case string(ast.NodeRule):
		dst = append(dst, tagRule)
		dst = appendString(dst, node.Selector)
	case string(ast.NodeAtRule):
		dst = append(dst, tagAtRule)
		dst = appendString(dst, node.Name)
		dst = appendString(dst, node.Params)
		if node.Block {
			dst = append(dst, 1)
		} else {
			dst = append(dst, 0)
		}
	case string(ast.NodeDecl):
		dst = append(dst, tagDecl)
		dst = appendString(dst, node.Prop)
		dst = appendString(dst, node.Value)
		if node.Important {
			dst = append(dst, 1)
		} else {
			dst = append(dst, 0)
		}
	case string(ast.NodeComment):
		dst = append(dst, tagComment)
		dst = appendString(dst, node.Text)
	default:
		return nil, fmt.Errorf("codec: unsupported node type %q", node.Type)
	}

	dst, err = encodeRaws(dst, node.Raws)
	if err != nil {
		return nil, err
	}
	dst = encodeSource(dst, node.Source)

	if node.Type == string(ast.NodeDecl) || node.Type == string(ast.NodeComment) {
		return dst, nil
	}
	dst = binary.AppendUvarint(dst, uint64(len(node.Nodes)))
	for _, child := range node.Nodes {
		dst, err = encodeDTONode(dst, child)
		if err != nil {
			return nil, err
		}
	}
	return dst, nil
}

func encodeASTSource(dst []byte, loc *postcss.SourceLocation, nodeEnd, block, preserveEndColumn, includeInput bool) []byte {
	var source jsbridge.SourceLocationDTO
	if !jsbridge.FillSourceDTO(&source, loc, nodeEnd, block, preserveEndColumn, includeInput) {
		return append(dst, 0)
	}
	// Rules with raws.ownSemicolon == ";" bump the end column after the shared
	// sourceToDTO adjustments, matching ToDTO.
	if preserveEndColumn && nodeEnd && block {
		source.End.Column++
	}
	return encodeSource(dst, &source)
}

func encodeSource(dst []byte, source *jsbridge.SourceLocationDTO) []byte {
	if source == nil {
		return append(dst, 0)
	}
	dst = append(dst, 1)
	dst = appendInt(dst, source.Start.Line)
	dst = appendInt(dst, source.Start.Column)
	dst = appendInt(dst, source.Start.Offset)
	dst = appendInt(dst, source.End.Line)
	dst = appendInt(dst, source.End.Column)
	dst = appendInt(dst, source.End.Offset)
	dst = appendString(dst, source.File)
	dst = appendString(dst, source.CSS)
	dst = appendString(dst, source.Map)
	dst = appendString(dst, source.MapURL)
	return dst
}

func encodeRaws(dst []byte, raws ast.Raws) ([]byte, error) {
	if len(raws) == 0 {
		return binary.AppendUvarint(dst, 0), nil
	}
	dst = binary.AppendUvarint(dst, uint64(len(raws)))
	for key, value := range raws {
		dst = appendString(dst, key)
		var err error
		dst, err = encodeRawValue(dst, value)
		if err != nil {
			return nil, err
		}
	}
	return dst, nil
}

func encodeRawValue(dst []byte, value any) ([]byte, error) {
	switch current := value.(type) {
	case nil:
		return append(dst, rawNull), nil
	case string:
		dst = append(dst, rawString)
		return appendString(dst, current), nil
	case bool:
		dst = append(dst, rawBool)
		if current {
			return append(dst, 1), nil
		}
		return append(dst, 0), nil
	case int:
		dst = append(dst, rawInt)
		return appendInt(dst, current), nil
	case int64:
		dst = append(dst, rawInt)
		return appendInt(dst, int(current)), nil
	case float64:
		dst = append(dst, rawFloat)
		return binary.BigEndian.AppendUint64(dst, math.Float64bits(current)), nil
	case ast.RawValue:
		dst = append(dst, rawRawValue)
		dst = appendString(dst, current.Raw)
		return appendString(dst, current.Value), nil
	case *ast.RawValue:
		if current == nil {
			return append(dst, rawNull), nil
		}
		dst = append(dst, rawRawValue)
		dst = appendString(dst, current.Raw)
		return appendString(dst, current.Value), nil
	case map[string]any:
		dst = append(dst, rawMap)
		dst = binary.AppendUvarint(dst, uint64(len(current)))
		for key, item := range current {
			dst = appendString(dst, key)
			var err error
			dst, err = encodeRawValue(dst, item)
			if err != nil {
				return nil, err
			}
		}
		return dst, nil
	case []any:
		dst = append(dst, rawList)
		dst = binary.AppendUvarint(dst, uint64(len(current)))
		for _, item := range current {
			var err error
			dst, err = encodeRawValue(dst, item)
			if err != nil {
				return nil, err
			}
		}
		return dst, nil
	default:
		return nil, fmt.Errorf("codec: unsupported raw value %T", value)
	}
}

func appendString(dst []byte, value string) []byte {
	dst = binary.AppendUvarint(dst, uint64(len(value)))
	return append(dst, value...)
}

func appendInt(dst []byte, value int) []byte {
	return binary.AppendVarint(dst, int64(value))
}
