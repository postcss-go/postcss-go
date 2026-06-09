package stringifier

import (
	"strings"

	"postcss-go/internal/ast"
)

func Stringify(node ast.Node) string {
	var builder strings.Builder
	writeNode(&builder, node, 0)
	return builder.String()
}

func writeNode(builder *strings.Builder, node ast.Node, depth int) {
	switch current := node.(type) {
	case *ast.Root:
		for index, child := range current.Nodes {
			if index > 0 {
				builder.WriteByte('\n')
			}
			writeNode(builder, child, depth)
		}
	case *ast.Rule:
		writeIndent(builder, depth)
		builder.WriteString(strings.TrimSpace(current.Selector))
		builder.WriteString(" {\n")
		writeChildren(builder, current.Nodes, depth+1)
		builder.WriteByte('\n')
		writeIndent(builder, depth)
		builder.WriteByte('}')
	case *ast.AtRule:
		writeIndent(builder, depth)
		builder.WriteByte('@')
		builder.WriteString(current.Name)
		if strings.TrimSpace(current.Params) != "" {
			builder.WriteByte(' ')
			builder.WriteString(strings.TrimSpace(current.Params))
		}
		if !current.Block {
			builder.WriteByte(';')
			return
		}
		builder.WriteString(" {\n")
		writeChildren(builder, current.Nodes, depth+1)
		builder.WriteByte('\n')
		writeIndent(builder, depth)
		builder.WriteByte('}')
	case *ast.Declaration:
		writeIndent(builder, depth)
		builder.WriteString(strings.TrimSpace(current.Prop))
		builder.WriteString(": ")
		builder.WriteString(strings.TrimSpace(current.Value))
		if current.Important {
			builder.WriteString(" !important")
		}
		builder.WriteByte(';')
	case *ast.Comment:
		writeIndent(builder, depth)
		builder.WriteString("/* ")
		builder.WriteString(strings.TrimSpace(current.Text))
		builder.WriteString(" */")
	}
}

func writeChildren(builder *strings.Builder, nodes []ast.Node, depth int) {
	for index, child := range nodes {
		if index > 0 {
			builder.WriteByte('\n')
		}
		writeNode(builder, child, depth)
	}
}

func writeIndent(builder *strings.Builder, depth int) {
	for i := 0; i < depth; i++ {
		builder.WriteString("  ")
	}
}
