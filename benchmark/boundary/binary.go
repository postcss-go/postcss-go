package boundary

import (
	"encoding/binary"

	"github.com/postcss-go/postcss-go/internal/ast"
)

/*
A compact preorder encoding written straight from the AST: no intermediate DTO
tree, no reflection, no raws deep-clone. One byte of node type, then the node's
string fields, then a child count, then the children.

Strings are length-prefixed with a uvarint rather than escaped, so encoding is a
memcpy and decoding needs no scanning. That is the property JSON lacks and the
reason a decoder on the JavaScript side can go straight to the field it wants.

Raws coverage is deliberately partial: the five string keys the stringifier
reads on the hot path. A production encoder would need the full map, which adds
bytes but not algorithmic cost. Sizes below are therefore a lower bound.
*/

const (
	tagRoot byte = iota
	tagDocument
	tagRule
	tagAtRule
	tagDecl
	tagComment
)

var rawKeys = [...]string{"before", "between", "after", "important", "afterName"}

func encodeBinary(dst []byte, node ast.Node) []byte {
	switch current := node.(type) {
	case *ast.Root:
		dst = append(dst, tagRoot)
		dst = encodeRaws(dst, current.RawFormattingReadOnly())
		return encodeChildren(dst, current.Children())
	case *ast.Document:
		dst = append(dst, tagDocument)
		dst = encodeRaws(dst, current.RawFormattingReadOnly())
		return encodeChildren(dst, current.Children())
	case *ast.Rule:
		dst = append(dst, tagRule)
		dst = encodeString(dst, current.Selector)
		dst = encodeRaws(dst, current.RawFormattingReadOnly())
		return encodeChildren(dst, current.Children())
	case *ast.AtRule:
		dst = append(dst, tagAtRule)
		dst = encodeString(dst, current.Name)
		dst = encodeString(dst, current.Params)
		if current.Block {
			dst = append(dst, 1)
		} else {
			dst = append(dst, 0)
		}
		dst = encodeRaws(dst, current.RawFormattingReadOnly())
		return encodeChildren(dst, current.Children())
	case *ast.Declaration:
		dst = append(dst, tagDecl)
		dst = encodeString(dst, current.Prop)
		dst = encodeString(dst, current.Value)
		if current.Important {
			dst = append(dst, 1)
		} else {
			dst = append(dst, 0)
		}
		return encodeRaws(dst, current.RawFormattingReadOnly())
	case *ast.Comment:
		dst = append(dst, tagComment)
		dst = encodeString(dst, current.Text)
		return encodeRaws(dst, current.RawFormattingReadOnly())
	}
	return dst
}

func encodeChildren(dst []byte, children []ast.Node) []byte {
	dst = binary.AppendUvarint(dst, uint64(len(children)))
	for _, child := range children {
		dst = encodeBinary(dst, child)
	}
	return dst
}

// encodeRaws writes a presence bitmap followed by only the fields that are set,
// which keeps the common case (a single `before`) down to a few bytes.
func encodeRaws(dst []byte, raws ast.Raws) []byte {
	var present byte
	var values [len(rawKeys)]string
	for i, key := range rawKeys {
		if value, ok := raws[key].(string); ok && value != "" {
			present |= 1 << uint(i)
			values[i] = value
		}
	}
	dst = append(dst, present)
	for i := range rawKeys {
		if present&(1<<uint(i)) != 0 {
			dst = encodeString(dst, values[i])
		}
	}
	return dst
}

func encodeString(dst []byte, value string) []byte {
	dst = binary.AppendUvarint(dst, uint64(len(value)))
	return append(dst, value...)
}

// decodeBinaryCount walks the buffer the way a decoder would, returning the
// node count so the benchmark measures a full traversal rather than a no-op.
func decodeBinaryCount(src []byte) int {
	offset, count := 0, 0
	var walk func()
	walk = func() {
		count++
		tag := src[offset]
		offset++
		switch tag {
		case tagRule:
			skipString(src, &offset)
		case tagAtRule:
			skipString(src, &offset)
			skipString(src, &offset)
			offset++
		case tagDecl:
			skipString(src, &offset)
			skipString(src, &offset)
			offset++
		case tagComment:
			skipString(src, &offset)
		}

		present := src[offset]
		offset++
		for i := range rawKeys {
			if present&(1<<uint(i)) != 0 {
				skipString(src, &offset)
			}
		}

		if tag == tagDecl || tag == tagComment {
			return
		}
		children, width := binary.Uvarint(src[offset:])
		offset += width
		for i := uint64(0); i < children; i++ {
			walk()
		}
	}
	walk()
	return count
}

func skipString(src []byte, offset *int) {
	length, width := binary.Uvarint(src[*offset:])
	*offset += width + int(length)
}

// decodeBinaryToAST rebuilds a real AST from the buffer. This is the honest
// counterpart to json.Unmarshal followed by FromDTO, since it allocates the
// same nodes rather than just walking bytes.
func decodeBinaryToAST(src []byte) ast.Node {
	offset := 0
	return decodeNode(src, &offset)
}

func decodeNode(src []byte, offset *int) ast.Node {
	tag := src[*offset]
	*offset++

	switch tag {
	case tagRoot:
		node := ast.NewRoot()
		applyRaws(src, offset, node.RawFormatting())
		decodeChildrenInto(src, offset, node)
		return node
	case tagDocument:
		node := ast.NewDocument()
		applyRaws(src, offset, node.RawFormatting())
		decodeChildrenInto(src, offset, node)
		return node
	case tagRule:
		node := ast.NewRule(decodeString(src, offset))
		applyRaws(src, offset, node.RawFormatting())
		decodeChildrenInto(src, offset, node)
		return node
	case tagAtRule:
		name := decodeString(src, offset)
		params := decodeString(src, offset)
		block := src[*offset] == 1
		*offset++
		node := ast.NewAtRule(name, params)
		node.Block = block
		applyRaws(src, offset, node.RawFormatting())
		decodeChildrenInto(src, offset, node)
		return node
	case tagDecl:
		prop := decodeString(src, offset)
		value := decodeString(src, offset)
		important := src[*offset] == 1
		*offset++
		node := ast.NewDeclaration(prop, value)
		node.Important = important
		applyRaws(src, offset, node.RawFormatting())
		return node
	default:
		node := ast.NewComment(decodeString(src, offset))
		applyRaws(src, offset, node.RawFormatting())
		return node
	}
}

func decodeChildrenInto(src []byte, offset *int, parent ast.Container) {
	count, width := binary.Uvarint(src[*offset:])
	*offset += width
	for i := uint64(0); i < count; i++ {
		parent.Append(decodeNode(src, offset))
	}
}

func applyRaws(src []byte, offset *int, raws ast.Raws) {
	present := src[*offset]
	*offset++
	for i, key := range rawKeys {
		if present&(1<<uint(i)) != 0 {
			raws[key] = decodeString(src, offset)
		}
	}
}

func decodeString(src []byte, offset *int) string {
	length, width := binary.Uvarint(src[*offset:])
	*offset += width
	start := *offset + 0
	*offset += int(length)
	return string(src[start:*offset])
}
