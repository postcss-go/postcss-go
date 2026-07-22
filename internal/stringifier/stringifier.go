package stringifier

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"postcss-go/internal/ast"
	"postcss-go/internal/sourcemap"
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

type cssWriter interface {
	writeString(string)
	writeByte(byte)
}

type builderWriter struct {
	*strings.Builder
}

func (w builderWriter) writeString(text string) {
	w.Builder.WriteString(text)
}

func (w builderWriter) writeByte(ch byte) {
	w.Builder.WriteByte(ch)
}

func Stringify(node ast.Node) string {
	var builder strings.Builder
	writeNode(builderWriter{&builder}, node, 0)
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

func writeNode(writer cssWriter, node ast.Node, depth int) {
	switch current := node.(type) {
	case *ast.Document:
		writeChildren(writer, current.Nodes, depth)
		writer.writeString(rawString(current, "after", ""))
	case *ast.Root:
		writeChildren(writer, current.Nodes, depth)
		writer.writeString(rawString(current, "after", ""))
	case *ast.Rule:
		writer.writeString(ruleHeader(current))
		writer.writeByte('{')
		writeChildren(writer, current.Nodes, depth+1)
		writeBlockClose(writer, current, len(current.Nodes), depth)
		writer.writeString(rawString(current, "ownSemicolon", ""))
	case *ast.AtRule:
		writer.writeString(atRuleHeader(current))
		if !current.Block {
			writer.writeString(rawString(current, "between", ""))
			if atRuleHasSemicolon(current) {
				writer.writeByte(';')
			}
			return
		}
		writer.writeString(rawBetween(current, "between", " "))
		writer.writeByte('{')
		writeChildren(writer, current.Nodes, depth+1)
		writeBlockClose(writer, current, len(current.Nodes), depth)
	case *ast.Declaration:
		writer.writeString(declarationText(current))
		if parent := current.Parent(); parent != nil && needsSemicolon(parent, current) {
			writer.writeByte(';')
		}
	case *ast.Comment:
		writer.writeString(commentText(current))
	}
}

func writeMappedNode(writer *sourceMapWriter, node ast.Node, depth int) bool {
	switch current := node.(type) {
	case *ast.Document:
		writeMappedChildren(writer, current.Nodes, depth)
		writer.writeString(rawString(current, "after", ""))
	case *ast.Root:
		writeMappedChildren(writer, current.Nodes, depth)
		writer.writeString(rawString(current, "after", ""))
	case *ast.Rule:
		writer.AddMapping(current)
		writer.writeString(ruleHeader(current))
		writer.writeByte('{')
		writeMappedChildren(writer, current.Nodes, depth+1)
		writeBlockClose(writer, current, len(current.Nodes), depth)
		writer.writeString(rawString(current, "ownSemicolon", ""))
		writer.AddEndMapping(current)
		return true
	case *ast.AtRule:
		writer.AddMapping(current)
		writer.writeString(atRuleHeader(current))
		if !current.Block {
			writer.writeString(rawString(current, "between", ""))
			if atRuleHasSemicolon(current) {
				writer.writeByte(';')
			}
			writer.AddEndMapping(current)
			return true
		}
		writer.writeString(rawBetween(current, "between", " "))
		writer.writeByte('{')
		writeMappedChildren(writer, current.Nodes, depth+1)
		writeBlockClose(writer, current, len(current.Nodes), depth)
		writer.AddEndMapping(current)
		return true
	case *ast.Declaration:
		writer.AddMapping(current)
		writer.writeString(declarationPrefix(current))
		writer.AddMappingAt(current, declarationValuePosition(current))
		writer.writeString(declarationValueText(current))
		if parent := current.Parent(); parent != nil && needsSemicolon(parent, current) {
			writer.writeByte(';')
		}
		writer.AddEndMapping(current)
		return true
	case *ast.Comment:
		if !writer.preserveAnnotation && isSourceMapAnnotation(current.Text) {
			return false
		}
		writer.AddMapping(current)
		writer.writeString(commentText(current))
		writer.AddEndMapping(current)
		return true
	}
	return true
}

func atRuleHasSemicolon(node *ast.AtRule) bool {
	if rawBool(node, "semicolon", false) {
		return true
	}
	if parent := node.Parent(); parent != nil {
		return rawBool(parent, "semicolon", false)
	}
	return false
}

func writeBlockClose(writer cssWriter, node ast.Node, childCount, depth int) {
	if hasRaw(node, "after") {
		writer.writeString(rawString(node, "after", ""))
	} else if childCount != 0 {
		writer.writeByte('\n')
		writeIndent(writer, node, depth)
	}
	writer.writeByte('}')
}

func declarationValuePosition(node *ast.Declaration) sourcemap.Position {
	location := node.Source()
	if location == nil || location.Input == nil {
		return sourcemap.Position{}
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
	for index, child := range nodes {
		if !writer.preserveAnnotation && isSourceMapAnnotationNode(child) {
			continue
		}
		writer.writeString(nodeBefore(child, depth, index))
		writeMappedNode(writer, child, depth)
	}
}

func isSourceMapAnnotationNode(node ast.Node) bool {
	comment, ok := node.(*ast.Comment)
	return ok && isSourceMapAnnotation(comment.Text)
}

func isSourceMapAnnotation(text string) bool {
	return strings.HasPrefix(strings.TrimSpace(text), "# sourceMappingURL=")
}

func writeChildren(writer cssWriter, nodes []ast.Node, depth int) {
	for index, child := range nodes {
		writer.writeString(nodeBefore(child, depth, index))
		writeNode(writer, child, depth)
	}
}

func writeIndent(writer cssWriter, node ast.Node, depth int) {
	indent := indentFor(node)
	for i := 0; i < depth; i++ {
		writer.writeString(indent)
	}
}

func hasRaw(node ast.Node, key string) bool {
	raws := node.RawFormattingReadOnly()
	if raws == nil {
		return false
	}
	_, ok := raws[key]
	return ok
}

func rawString(node ast.Node, key, fallback string) string {
	value, ok := lookupRaw(node, key)
	if !ok {
		return fallback
	}
	if stringValue, ok := value.(string); ok {
		return stringValue
	}
	return fallback
}

func rawBool(node ast.Node, key string, fallback bool) bool {
	value, ok := lookupRaw(node, key)
	if !ok {
		return fallback
	}
	boolean, ok := value.(bool)
	if !ok {
		return fallback
	}
	return boolean
}

func rawValue(node ast.Node, key, fallback string) string {
	value, ok := lookupRaw(node, key)
	if !ok {
		return fallback
	}
	switch current := value.(type) {
	case string:
		return current
	case ast.RawValue:
		if current.Value == fallback {
			return current.Raw
		}
	case *ast.RawValue:
		if current != nil && current.Value == fallback {
			return current.Raw
		}
	case map[string]string:
		if raw, rawOK := current["raw"]; rawOK {
			if semantic, semanticOK := current["value"]; !semanticOK || semantic == fallback {
				return raw
			}
		}
	case map[string]any:
		if raw, rawOK := current["raw"].(string); rawOK {
			if semantic, semanticOK := current["value"].(string); !semanticOK || semantic == fallback {
				return raw
			}
		}
	}
	return fallback
}

func lookupRaw(node ast.Node, key string) (any, bool) {
	raws := node.RawFormattingReadOnly()
	if raws == nil {
		return nil, false
	}
	value, ok := raws[key]
	return value, ok
}

func ruleHeader(node *ast.Rule) string {
	return rawValue(node, "selector", strings.TrimSpace(node.Selector)) + rawBetween(node, "between", " ")
}

func atRuleHeader(node *ast.AtRule) string {
	params := rawValue(node, "params", strings.TrimSpace(node.Params))
	if params == "" && !hasRaw(node, "afterName") {
		return "@" + node.Name
	}
	return "@" + node.Name + rawString(node, "afterName", " ") + params
}

func declarationText(node *ast.Declaration) string {
	return declarationPrefix(node) + declarationValueText(node)
}

func declarationPrefix(node *ast.Declaration) string {
	return strings.TrimSpace(node.Prop) + rawBetween(node, "between", ": ")
}

func declarationValueText(node *ast.Declaration) string {
	value := node.Value
	if !strings.HasPrefix(node.Prop, "--") {
		value = strings.TrimSpace(value)
	}
	text := rawValue(node, "value", value)
	if node.Important {
		text += rawString(node, "important", " !important")
	}
	return text
}

func commentText(node *ast.Comment) string {
	return "/*" + rawString(node, "left", " ") + node.Text + rawString(node, "right", " ") + "*/"
}

func nodeBefore(node ast.Node, depth, index int) string {
	if hasRaw(node, "before") {
		return rawString(node, "before", "")
	}
	// A newly inserted first node in a root has no leading separator. Existing
	// parsed nodes can still preserve an explicit `raws.before` above.
	if index == 0 && depth == 0 {
		return ""
	}
	if parent := node.Parent(); parent != nil {
		if inferred, ok := inferSiblingRaw(parent, "before", node.Type()); ok {
			return inferred
		}
		if inferred, ok := inferSiblingRaw(parent, "before", ""); ok && inferred != "" {
			return inferred
		}
	}
	if index == 0 && depth == 0 {
		return ""
	}
	return "\n" + strings.Repeat(indentFor(node), depth)
}

func rawBetween(node ast.Node, key, fallback string) string {
	if value, ok := lookupRaw(node, key); ok {
		if stringValue, ok := value.(string); ok {
			return stringValue
		}
		return fallback
	}
	if parent := node.Parent(); parent != nil {
		if inferred, ok := inferSiblingRaw(parent, key, node.Type()); ok {
			return inferred
		}
	}
	return fallback
}

func inferSiblingRaw(parent ast.Container, key string, nodeType ast.NodeType) (string, bool) {
	var inferred string
	hasExplicit := false
	for _, sibling := range parent.Children() {
		if nodeType != "" && sibling.Type() != nodeType {
			continue
		}
		value, ok := lookupRaw(sibling, key)
		if !ok {
			continue
		}
		hasExplicit = true
		if stringValue, ok := value.(string); ok {
			inferred = stringValue
		} else {
			inferred = ""
		}
		if inferred != "" {
			return inferred, true
		}
	}
	return inferred, hasExplicit
}

func indentFor(node ast.Node) string {
	if root := node.Root(); root != nil {
		if indent := rawString(root, "indent", ""); indent != "" {
			return indent
		}
	}
	return "    "
}

func needsSemicolon(parent ast.Container, node ast.Node) bool {
	children := parent.Children()
	lastSignificant := -1
	nodeIndex := -1
	for index, child := range children {
		if child == node {
			nodeIndex = index
		}
		if child.Type() != ast.NodeComment {
			lastSignificant = index
		}
	}
	// Parsed containers record their semicolon style explicitly. For manually
	// constructed containers, match PostCSS's default and omit the final one.
	return nodeIndex < lastSignificant || rawBool(parent, "semicolon", false)
}
