package stringifier

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"postcss-go/internal/ast"
	"postcss-go/internal/source"
)

type SourceMapOptions struct {
	From               string
	To                 string
	MapFile            string
	SourceMapFrom      string
	SourcesContent     *bool
	Absolute           bool
	PreserveAnnotation bool
}

type StringifyResult struct {
	CSS string
	Map string
}

func Stringify(node ast.Node) string {
	var builder strings.Builder
	writeNode(&builder, node, 0)
	return builder.String()
}

func StringifyWithSourceMap(node ast.Node, opts SourceMapOptions) (StringifyResult, error) {
	writer := newSourceMapWriter(opts.SourceMapFrom)
	writer.preserveAnnotation = opts.PreserveAnnotation
	writeMappedNode(writer, node, 0)
	if len(writer.mappings) == 0 {
		writer.AddMapping(node)
	}
	sourceMap, err := writer.sourceMap(opts)
	if err != nil {
		return StringifyResult{}, err
	}
	return StringifyResult{CSS: writer.String(), Map: sourceMap}, nil
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

func writeMappedNode(writer *sourceMapWriter, node ast.Node, depth int) bool {
	switch current := node.(type) {
	case *ast.Root:
		writeMappedChildren(writer, current.Nodes, depth)
	case *ast.Rule:
		writeMappedIndent(writer, depth)
		writer.AddMapping(current)
		writer.writeString(strings.TrimSpace(current.Selector))
		writer.writeString(" {\n")
		writeMappedChildren(writer, current.Nodes, depth+1)
		writer.writeByte('\n')
		writeMappedIndent(writer, depth)
		writer.writeByte('}')
		writer.AddEndMapping(current)
		return true
	case *ast.AtRule:
		writeMappedIndent(writer, depth)
		writer.AddMapping(current)
		writer.writeByte('@')
		writer.writeString(current.Name)
		if strings.TrimSpace(current.Params) != "" {
			writer.writeByte(' ')
			writer.writeString(strings.TrimSpace(current.Params))
		}
		if !current.Block {
			writer.writeByte(';')
			writer.AddEndMapping(current)
			return true
		}
		writer.writeString(" {\n")
		writeMappedChildren(writer, current.Nodes, depth+1)
		writer.writeByte('\n')
		writeMappedIndent(writer, depth)
		writer.writeByte('}')
		writer.AddEndMapping(current)
		return true
	case *ast.Declaration:
		writeMappedIndent(writer, depth)
		writer.AddMapping(current)
		writer.writeString(strings.TrimSpace(current.Prop))
		writer.writeString(": ")
		writer.AddMappingAt(current, declarationValuePosition(current))
		writer.writeString(strings.TrimSpace(current.Value))
		if current.Important {
			writer.writeString(" !important")
		}
		writer.writeByte(';')
		writer.AddEndMapping(current)
		return true
	case *ast.Comment:
		if !writer.preserveAnnotation && isSourceMapAnnotation(current.Text) {
			return false
		}
		writeMappedIndent(writer, depth)
		writer.AddMapping(current)
		writer.writeString("/* ")
		writer.writeString(strings.TrimSpace(current.Text))
		writer.writeString(" */")
		writer.AddEndMapping(current)
		return true
	}
	return true
}

func declarationValuePosition(node *ast.Declaration) source.Position {
	location := node.Source()
	if location == nil || location.Input == nil {
		return source.Position{}
	}
	input := location.Input
	start := max(location.Start.Offset, 0)
	end := min(location.End.Offset, len(input.CSS))
	if start > end {
		return location.Start
	}
	colon := strings.IndexByte(input.CSS[start:end], ':')
	if colon < 0 {
		return location.Start
	}
	valueOffset := start + colon + 1
	for valueOffset < end {
		r, size := utf8.DecodeRuneInString(input.CSS[valueOffset:end])
		if !unicode.IsSpace(r) {
			break
		}
		valueOffset += size
	}
	return input.FromOffset(valueOffset)
}

func writeMappedChildren(writer *sourceMapWriter, nodes []ast.Node, depth int) {
	written := false
	for _, child := range nodes {
		if !writer.preserveAnnotation && isSourceMapAnnotationNode(child) {
			continue
		}
		if written {
			writer.writeByte('\n')
		}
		written = writeMappedNode(writer, child, depth) || written
	}
}

func isSourceMapAnnotationNode(node ast.Node) bool {
	comment, ok := node.(*ast.Comment)
	return ok && isSourceMapAnnotation(comment.Text)
}

func isSourceMapAnnotation(text string) bool {
	return strings.HasPrefix(strings.TrimSpace(text), "# sourceMappingURL=")
}

func writeMappedIndent(writer *sourceMapWriter, depth int) {
	for i := 0; i < depth; i++ {
		writer.writeString("  ")
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
