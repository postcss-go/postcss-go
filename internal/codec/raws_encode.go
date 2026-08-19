package codec

import (
	"encoding/binary"

	"postcss-go/internal/ast"
)

func encodeNodeRaws(dst []byte, node ast.Node) ([]byte, error) {
	dst = binary.AppendUvarint(dst, uint64(ast.CountRaws(node)))
	var err error
	ast.VisitRaws(node, func(key string, value any) bool {
		dst = appendString(dst, key)
		dst, err = encodeRawValue(dst, value)
		return err == nil
	})
	return dst, err
}

func lookupRawString(node ast.Node, key string) string {
	if text, ok := ast.LookupRawString(node, key); ok {
		return text
	}
	return ""
}
