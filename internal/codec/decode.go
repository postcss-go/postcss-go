package codec

import (
	"encoding/binary"
	"fmt"
	"math"

	"postcss-go/internal/ast"
	"postcss-go/internal/jsbridge"
	"postcss-go/internal/postcss"
)

// DecodeDTO rebuilds a bridge DTO tree from EncodeDTO / EncodeAST output.
func DecodeDTO(src []byte) (*jsbridge.NodeDTO, error) {
	offset, err := readHeader(src)
	if err != nil {
		return nil, err
	}
	node, err := decodeDTONode(src, &offset)
	if err != nil {
		return nil, err
	}
	if offset != len(src) {
		return nil, fmt.Errorf("codec: trailing bytes")
	}
	return node, nil
}

// DecodeAST rebuilds a live Go AST directly from the binary encoding, without
// allocating an intermediate NodeDTO tree.
func DecodeAST(src []byte) (ast.Node, error) {
	offset, err := readHeader(src)
	if err != nil {
		return nil, err
	}
	node, err := decodeASTNode(src, &offset, nil)
	if err != nil {
		return nil, err
	}
	if offset != len(src) {
		return nil, fmt.Errorf("codec: trailing bytes")
	}
	return node, nil
}

func readHeader(src []byte) (int, error) {
	if len(src) < 5 || src[0] != magic0 || src[1] != magic1 || src[2] != magic2 || src[3] != magic3 {
		return 0, fmt.Errorf("codec: bad magic")
	}
	if src[4] != version {
		return 0, fmt.Errorf("codec: unsupported version %d", src[4])
	}
	return 5, nil
}

func decodeASTNode(src []byte, offset *int, inherited *postcss.Input) (ast.Node, error) {
	tag, err := readByte(src, offset)
	if err != nil {
		return nil, err
	}

	switch tag {
	case tagRoot:
		node := ast.NewRoot()
		if node.Raws, err = decodeRaws(src, offset); err != nil {
			return nil, err
		}
		input, source, sourceErr := decodeASTSource(src, offset, inherited)
		if sourceErr != nil {
			return nil, sourceErr
		}
		node.SetSource(source)
		children, childErr := decodeASTChildren(src, offset, input)
		if childErr != nil {
			return nil, childErr
		}
		node.Append(children...)
		return node, nil
	case tagDocument:
		node := ast.NewDocument()
		if node.Raws, err = decodeRaws(src, offset); err != nil {
			return nil, err
		}
		input, source, sourceErr := decodeASTSource(src, offset, inherited)
		if sourceErr != nil {
			return nil, sourceErr
		}
		node.SetSource(source)
		children, childErr := decodeASTChildren(src, offset, input)
		if childErr != nil {
			return nil, childErr
		}
		node.Append(children...)
		return node, nil
	case tagRule:
		selector, selErr := readString(src, offset)
		if selErr != nil {
			return nil, selErr
		}
		node := ast.NewRule(selector)
		if node.Raws, err = decodeRaws(src, offset); err != nil {
			return nil, err
		}
		input, source, sourceErr := decodeASTSource(src, offset, inherited)
		if sourceErr != nil {
			return nil, sourceErr
		}
		node.SetSource(source)
		children, childErr := decodeASTChildren(src, offset, input)
		if childErr != nil {
			return nil, childErr
		}
		node.Append(children...)
		return node, nil
	case tagAtRule:
		name, nameErr := readString(src, offset)
		if nameErr != nil {
			return nil, nameErr
		}
		params, paramsErr := readString(src, offset)
		if paramsErr != nil {
			return nil, paramsErr
		}
		flag, flagErr := readByte(src, offset)
		if flagErr != nil {
			return nil, flagErr
		}
		node := ast.NewAtRule(name, params)
		node.Block = flag == 1
		if node.Raws, err = decodeRaws(src, offset); err != nil {
			return nil, err
		}
		input, source, sourceErr := decodeASTSource(src, offset, inherited)
		if sourceErr != nil {
			return nil, sourceErr
		}
		node.SetSource(source)
		children, childErr := decodeASTChildren(src, offset, input)
		if childErr != nil {
			return nil, childErr
		}
		node.Append(children...)
		return node, nil
	case tagDecl:
		prop, propErr := readString(src, offset)
		if propErr != nil {
			return nil, propErr
		}
		value, valueErr := readString(src, offset)
		if valueErr != nil {
			return nil, valueErr
		}
		flag, flagErr := readByte(src, offset)
		if flagErr != nil {
			return nil, flagErr
		}
		node := ast.NewDeclaration(prop, value)
		node.Important = flag == 1
		if node.Raws, err = decodeRaws(src, offset); err != nil {
			return nil, err
		}
		_, source, sourceErr := decodeASTSource(src, offset, inherited)
		if sourceErr != nil {
			return nil, sourceErr
		}
		node.SetSource(source)
		return node, nil
	case tagComment:
		text, textErr := readString(src, offset)
		if textErr != nil {
			return nil, textErr
		}
		node := ast.NewComment(text)
		if node.Raws, err = decodeRaws(src, offset); err != nil {
			return nil, err
		}
		_, source, sourceErr := decodeASTSource(src, offset, inherited)
		if sourceErr != nil {
			return nil, sourceErr
		}
		node.SetSource(source)
		return node, nil
	default:
		return nil, fmt.Errorf("codec: unknown tag %d", tag)
	}
}

func decodeASTChildren(src []byte, offset *int, inherited *postcss.Input) ([]ast.Node, error) {
	count, err := readUvarint(src, offset)
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, nil
	}
	out := make([]ast.Node, 0, count)
	for i := uint64(0); i < count; i++ {
		child, childErr := decodeASTNode(src, offset, inherited)
		if childErr != nil {
			return nil, childErr
		}
		out = append(out, child)
	}
	return out, nil
}

func decodeASTSource(
	src []byte,
	offset *int,
	inherited *postcss.Input,
) (*postcss.Input, *postcss.SourceLocation, error) {
	dto, err := decodeSource(src, offset)
	if err != nil {
		return nil, nil, err
	}
	return jsbridge.SourceFromBridgeDTO(dto, inherited)
}

func decodeDTONode(src []byte, offset *int) (*jsbridge.NodeDTO, error) {
	tag, err := readByte(src, offset)
	if err != nil {
		return nil, err
	}
	node := &jsbridge.NodeDTO{}
	switch tag {
	case tagRoot:
		node.Type = string(ast.NodeRoot)
	case tagDocument:
		node.Type = string(ast.NodeDocument)
	case tagRule:
		node.Type = string(ast.NodeRule)
		node.Selector, err = readString(src, offset)
	case tagAtRule:
		node.Type = string(ast.NodeAtRule)
		node.Name, err = readString(src, offset)
		if err != nil {
			return nil, err
		}
		node.Params, err = readString(src, offset)
		if err != nil {
			return nil, err
		}
		flag, flagErr := readByte(src, offset)
		if flagErr != nil {
			return nil, flagErr
		}
		node.Block = flag == 1
	case tagDecl:
		node.Type = string(ast.NodeDecl)
		node.Prop, err = readString(src, offset)
		if err != nil {
			return nil, err
		}
		node.Value, err = readString(src, offset)
		if err != nil {
			return nil, err
		}
		flag, flagErr := readByte(src, offset)
		if flagErr != nil {
			return nil, flagErr
		}
		node.Important = flag == 1
	case tagComment:
		node.Type = string(ast.NodeComment)
		node.Text, err = readString(src, offset)
	default:
		return nil, fmt.Errorf("codec: unknown tag %d", tag)
	}
	if err != nil {
		return nil, err
	}

	node.Raws, err = decodeRaws(src, offset)
	if err != nil {
		return nil, err
	}
	node.Source, err = decodeSource(src, offset)
	if err != nil {
		return nil, err
	}

	if tag == tagDecl || tag == tagComment {
		return node, nil
	}
	count, err := readUvarint(src, offset)
	if err != nil {
		return nil, err
	}
	if count > 0 {
		node.Nodes = make([]*jsbridge.NodeDTO, 0, count)
		for i := uint64(0); i < count; i++ {
			child, childErr := decodeDTONode(src, offset)
			if childErr != nil {
				return nil, childErr
			}
			node.Nodes = append(node.Nodes, child)
		}
	}
	return node, nil
}

func decodeSource(src []byte, offset *int) (*jsbridge.SourceLocationDTO, error) {
	flag, err := readByte(src, offset)
	if err != nil {
		return nil, err
	}
	if flag == 0 {
		return nil, nil
	}
	source := &jsbridge.SourceLocationDTO{}
	if source.Start.Line, err = readInt(src, offset); err != nil {
		return nil, err
	}
	if source.Start.Column, err = readInt(src, offset); err != nil {
		return nil, err
	}
	if source.Start.Offset, err = readInt(src, offset); err != nil {
		return nil, err
	}
	if source.End.Line, err = readInt(src, offset); err != nil {
		return nil, err
	}
	if source.End.Column, err = readInt(src, offset); err != nil {
		return nil, err
	}
	if source.End.Offset, err = readInt(src, offset); err != nil {
		return nil, err
	}
	if source.File, err = readString(src, offset); err != nil {
		return nil, err
	}
	if source.CSS, err = readString(src, offset); err != nil {
		return nil, err
	}
	if source.Map, err = readString(src, offset); err != nil {
		return nil, err
	}
	if source.MapURL, err = readString(src, offset); err != nil {
		return nil, err
	}
	return source, nil
}

func decodeRaws(src []byte, offset *int) (ast.Raws, error) {
	count, err := readUvarint(src, offset)
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, nil
	}
	raws := make(ast.Raws, count)
	for i := uint64(0); i < count; i++ {
		key, keyErr := readString(src, offset)
		if keyErr != nil {
			return nil, keyErr
		}
		value, valueErr := decodeRawValue(src, offset)
		if valueErr != nil {
			return nil, valueErr
		}
		raws[key] = value
	}
	return raws, nil
}

func decodeRawValue(src []byte, offset *int) (any, error) {
	tag, err := readByte(src, offset)
	if err != nil {
		return nil, err
	}
	switch tag {
	case rawNull:
		return nil, nil
	case rawString:
		return readString(src, offset)
	case rawBool:
		flag, flagErr := readByte(src, offset)
		if flagErr != nil {
			return nil, flagErr
		}
		return flag == 1, nil
	case rawInt:
		return readInt(src, offset)
	case rawFloat:
		if *offset+8 > len(src) {
			return nil, fmt.Errorf("codec: truncated float")
		}
		bits := binary.BigEndian.Uint64(src[*offset : *offset+8])
		*offset += 8
		return math.Float64frombits(bits), nil
	case rawRawValue:
		raw, rawErr := readString(src, offset)
		if rawErr != nil {
			return nil, rawErr
		}
		value, valueErr := readString(src, offset)
		if valueErr != nil {
			return nil, valueErr
		}
		return ast.RawValue{Raw: raw, Value: value}, nil
	case rawMap:
		count, countErr := readUvarint(src, offset)
		if countErr != nil {
			return nil, countErr
		}
		out := make(map[string]any, count)
		for i := uint64(0); i < count; i++ {
			key, keyErr := readString(src, offset)
			if keyErr != nil {
				return nil, keyErr
			}
			item, itemErr := decodeRawValue(src, offset)
			if itemErr != nil {
				return nil, itemErr
			}
			out[key] = item
		}
		return out, nil
	case rawList:
		count, countErr := readUvarint(src, offset)
		if countErr != nil {
			return nil, countErr
		}
		out := make([]any, 0, count)
		for i := uint64(0); i < count; i++ {
			item, itemErr := decodeRawValue(src, offset)
			if itemErr != nil {
				return nil, itemErr
			}
			out = append(out, item)
		}
		return out, nil
	default:
		return nil, fmt.Errorf("codec: unknown raw tag %d", tag)
	}
}

func readByte(src []byte, offset *int) (byte, error) {
	if *offset >= len(src) {
		return 0, fmt.Errorf("codec: truncated byte")
	}
	value := src[*offset]
	*offset++
	return value, nil
}

func readString(src []byte, offset *int) (string, error) {
	length, err := readUvarint(src, offset)
	if err != nil {
		return "", err
	}
	if *offset+int(length) > len(src) {
		return "", fmt.Errorf("codec: truncated string")
	}
	value := string(src[*offset : *offset+int(length)])
	*offset += int(length)
	return value, nil
}

func readInt(src []byte, offset *int) (int, error) {
	value, width := binary.Varint(src[*offset:])
	if width <= 0 {
		return 0, fmt.Errorf("codec: truncated int")
	}
	*offset += width
	return int(value), nil
}

func readUvarint(src []byte, offset *int) (uint64, error) {
	value, width := binary.Uvarint(src[*offset:])
	if width <= 0 {
		return 0, fmt.Errorf("codec: truncated uvarint")
	}
	*offset += width
	return value, nil
}
