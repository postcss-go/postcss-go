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

type BuilderPart struct {
	CSS  string `json:"css"`
	Node int    `json:"node,omitempty"`
	Type string `json:"type,omitempty"`
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
	return stringify(node, false)
}

// StringifyWithoutSourceMapAnnotations stringifies like Stringify but skips
// `# sourceMappingURL=` comment nodes (and their before whitespace), matching
// PostCSS's AST clearAnnotation path used by LazyResult.
func StringifyWithoutSourceMapAnnotations(node ast.Node) string {
	return stringify(node, true)
}

func stringify(node ast.Node, stripSourceMapAnnotations bool) string {
	var builder strings.Builder
	writeNode(builderWriter{&builder}, node, 0, stripSourceMapAnnotations)
	return builder.String()
}

func StringifyWithBuilder(node ast.Node) []BuilderPart {
	parts := make([]BuilderPart, 0)
	writeBuilderNode(&parts, node, 0, new(int))
	return parts
}

func appendBuilderPart(parts *[]BuilderPart, css string, node int, kind string) {
	if css != "" {
		*parts = append(*parts, BuilderPart{CSS: css, Node: node, Type: kind})
	}
}

func writeBuilderNode(parts *[]BuilderPart, node ast.Node, depth int, next *int) {
	(*next)++
	id := *next
	switch current := node.(type) {
	case *ast.Document:
		for index, child := range current.Nodes {
			appendBuilderPart(parts, nodeBeforeDocument(child, depth, index), 0, "")
			writeBuilderNode(parts, child, depth, next)
		}
		appendBuilderPart(parts, rawString(current, "after", ""), 0, "")
	case *ast.Root:
		for index, child := range current.Nodes {
			appendBuilderPart(parts, escapeHTMLInCSS(nodeBefore(child, depth, index)), 0, "")
			writeBuilderNode(parts, child, depth, next)
		}
		appendBuilderPart(parts, rawString(current, "after", ""), 0, "")
	case *ast.Rule:
		appendBuilderPart(parts, ruleHeader(current)+"{", id, "start")
		for index, child := range current.Nodes {
			appendBuilderPart(parts, escapeHTMLInCSS(nodeBefore(child, depth+1, index)), 0, "")
			writeBuilderNode(parts, child, depth+1, next)
		}
		close := "}"
		if hasRaw(current, "after") {
			close = escapeHTMLInCSS(rawString(current, "after", "")) + close
		} else if len(current.Nodes) != 0 {
			inferred, ok := inferSiblingRawForNode(current, "after")
			if ok {
				close = escapeHTMLInCSS(inferred) + close
			} else {
				close = "\n" + strings.Repeat(indentFor(current), depth) + close
			}
		}
		appendBuilderPart(parts, close+rawString(current, "ownSemicolon", ""), id, "end")
	case *ast.AtRule:
		if !current.Block {
			text := atRuleHeader(current) + rawString(current, "between", "")
			if atRuleHasSemicolon(current) {
				text += ";"
			}
			appendBuilderPart(parts, text, id, "")
			return
		}
		appendBuilderPart(parts, atRuleHeader(current)+rawBetween(current, "between", " ")+"{", id, "start")
		for index, child := range current.Nodes {
			appendBuilderPart(parts, escapeHTMLInCSS(nodeBefore(child, depth+1, index)), 0, "")
			writeBuilderNode(parts, child, depth+1, next)
		}
		close := "}"
		if hasRaw(current, "after") {
			close = escapeHTMLInCSS(rawString(current, "after", "")) + close
		} else if len(current.Nodes) != 0 {
			inferred, ok := inferSiblingRawForNode(current, "after")
			if ok {
				close = escapeHTMLInCSS(inferred) + close
			} else {
				close = "\n" + strings.Repeat(indentFor(current), depth) + close
			}
		}
		appendBuilderPart(parts, close, id, "end")
	case *ast.Declaration:
		text := declarationText(current)
		if parent := current.Parent(); parent != nil && needsSemicolon(parent, current) {
			text += ";"
		}
		appendBuilderPart(parts, text, id, "")
	case *ast.Comment:
		appendBuilderPart(parts, commentText(current), id, "")
	}
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

func writeNode(writer cssWriter, node ast.Node, depth int, stripSourceMapAnnotations bool) {
	switch current := node.(type) {
	case *ast.Document:
		writeChildren(writer, current.Nodes, depth, false, stripSourceMapAnnotations)
		writer.writeString(rawString(current, "after", ""))
	case *ast.Root:
		writeChildren(writer, current.Nodes, depth, true, stripSourceMapAnnotations)
		writer.writeString(rawString(current, "after", ""))
	case *ast.Rule:
		writer.writeString(ruleHeader(current))
		writer.writeByte('{')
		childCount := writeChildren(writer, current.Nodes, depth+1, true, stripSourceMapAnnotations)
		writeBlockClose(writer, current, childCount, depth)
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
		childCount := writeChildren(writer, current.Nodes, depth+1, true, stripSourceMapAnnotations)
		writeBlockClose(writer, current, childCount, depth)
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
		childCount := writeMappedChildren(writer, current.Nodes, depth+1)
		writeBlockClose(writer, current, childCount, depth)
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
		childCount := writeMappedChildren(writer, current.Nodes, depth+1)
		writeBlockClose(writer, current, childCount, depth)
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
		if rawBool(parent, "semicolon", false) {
			return true
		}
		children := parent.Children()
		for index, child := range children {
			if child == node {
				return index < len(children)-1
			}
		}
	}
	return false
}

func writeBlockClose(writer cssWriter, node ast.Node, childCount, depth int) {
	if hasRaw(node, "after") {
		writer.writeString(escapeHTMLInCSS(rawString(node, "after", "")))
	} else if childCount != 0 {
		if inferred, ok := inferSiblingRawForNode(node, "after"); ok {
			writer.writeString(escapeHTMLInCSS(inferred))
		} else {
			writer.writeByte('\n')
			writeIndent(writer, node, depth)
		}
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

func writeMappedChildren(writer *sourceMapWriter, nodes []ast.Node, depth int) int {
	written := 0
	for index, child := range nodes {
		if !writer.preserveAnnotation && isSourceMapAnnotationNode(child) {
			continue
		}
		writer.writeString(nodeBefore(child, depth, index))
		writeMappedNode(writer, child, depth)
		written++
	}
	return written
}

func isSourceMapAnnotationNode(node ast.Node) bool {
	comment, ok := node.(*ast.Comment)
	return ok && isSourceMapAnnotation(comment.Text)
}

func isSourceMapAnnotation(text string) bool {
	return strings.HasPrefix(strings.TrimSpace(text), "# sourceMappingURL=")
}

func writeChildren(writer cssWriter, nodes []ast.Node, depth int, escapeBefore, stripSourceMapAnnotations bool) int {
	written := 0
	for index, child := range nodes {
		if stripSourceMapAnnotations && isSourceMapAnnotationNode(child) {
			continue
		}
		before := nodeBefore(child, depth, index)
		if escapeBefore {
			before = escapeHTMLInCSS(before)
		}
		writer.writeString(before)
		writeNode(writer, child, depth, stripSourceMapAnnotations)
		written++
	}
	return written
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
	return escapeHTMLInCSS(rawValue(node, "selector", strings.TrimSpace(node.Selector)) + rawBetween(node, "between", " "))
}

func atRuleHeader(node *ast.AtRule) string {
	params := rawValue(node, "params", strings.TrimSpace(node.Params))
	if params == "" && !hasRaw(node, "afterName") {
		return "@" + node.Name
	}
	return escapeHTMLInCSS("@" + node.Name + rawStringDetected(node, "afterName", " ") + params)
}

func declarationText(node *ast.Declaration) string {
	return escapeHTMLInCSS(declarationPrefix(node) + declarationValueText(node))
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
	return escapeHTMLInCSS("/*" + rawStringDetected(node, "left", " ") + node.Text + rawStringDetected(node, "right", " ") + "*/")
}

func rawStringDetected(node ast.Node, key, fallback string) string {
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

func nodeBefore(node ast.Node, depth, index int) string {
	if hasRaw(node, "before") {
		return rawString(node, "before", "")
	}
	if rule, ok := node.(*ast.Rule); ok && rule.Selector == "from" {
		return ""
	}
	if node.Source() == nil && index == 0 {
		if parent := node.Parent(); parent != nil {
			if atRule, ok := parent.(*ast.AtRule); ok && atRule.Name == "keyframes" {
				return ""
			}
		}
	}
	// A newly inserted first node in a root has no leading separator. Existing
	// parsed nodes can still preserve an explicit `raws.before` above.
	if index == 0 && depth == 0 {
		return ""
	}
	if parent := node.Parent(); parent != nil {
		if inferred, ok := rawBeforeDetected(parent, node); ok {
			return inferred
		}
		after := rawString(node, "after", "")
		if indent := inferredContainerIndent(parent); indent != "" && strings.Contains(indent, " ") && !strings.Contains(indent, "\n") && !strings.Contains(after, "\n") {
			return indent
		}
	}
	if index == 0 && depth == 0 {
		return ""
	}
	return "\n" + strings.Repeat(indentFor(node), depth)
}

func nodeBeforeDocument(node ast.Node, depth, index int) string {
	if hasRaw(node, "before") {
		return rawString(node, "before", "")
	}
	return ""
}

// escapeHTMLInCSS protects CSS embedded in an HTML style context, matching
// PostCSS's default stringifier behavior.
func escapeHTMLInCSS(value string) string {
	if !strings.Contains(value, "<") {
		return value
	}
	value = strings.ReplaceAll(value, "</style", `\3c /style`)
	value = strings.ReplaceAll(value, "<style", `\3c style`)
	value = strings.ReplaceAll(value, "<!--", `\3c !--`)
	return value
}

func rawBetween(node ast.Node, key, fallback string) string {
	if value, ok := lookupRaw(node, key); ok {
		if stringValue, ok := value.(string); ok {
			if node.Type() == ast.NodeDecl && stringValue == "" {
				if parent := node.Parent(); parent != nil {
					if inferred, inferredOK := inferSiblingRaw(parent, key, node.Type()); inferredOK && inferred != "" {
						return inferred
					}
				}
				return fallback
			}
			return stringValue
		}
		return fallback
	}
	if parent := node.Parent(); parent != nil {
		if inferred, ok := inferSiblingRaw(parent, key, node.Type()); ok {
			if node.Type() != ast.NodeDecl || !strings.Contains(inferred, "/*") {
				return inferred
			}
			if strings.Contains(inferred, ":") {
				return ":"
			}
		}
		if node.Type() == ast.NodeDecl && node.Source() == nil {
			for container := parent; container != nil; container = container.Parent() {
				if inferred, ok := inferDescendantRaw(container, key, node.Type()); ok && inferred != "" {
					return inferred
				}
			}
		}
	}
	return fallback
}

func inferDescendantRaw(parent ast.Container, key string, nodeType ast.NodeType) (string, bool) {
	for _, sibling := range parent.Children() {
		if sibling.Type() == nodeType {
			continue
		}
		container, ok := sibling.(ast.Container)
		if !ok {
			continue
		}
		if inferred, ok := inferSiblingRaw(container, key, nodeType); ok && inferred != "" {
			return inferred, true
		}
		if inferred, ok := inferDescendantRaw(container, key, nodeType); ok && inferred != "" {
			return inferred, true
		}
	}
	return "", false
}

func inferSiblingRawForNode(node ast.Node, key string) (string, bool) {
	parent := node.Parent()
	if parent == nil {
		return "", false
	}
	for _, sibling := range parent.Children() {
		if sibling == node || sibling.Type() != node.Type() {
			continue
		}
		if value, ok := lookupRaw(sibling, key); ok {
			if text, ok := value.(string); ok {
				return text, true
			}
		}
	}
	return "", false
}

func rawBeforeDetected(parent ast.Container, node ast.Node) (string, bool) {
	// Prefer an existing sibling's explicit separator, but discard its
	// non-whitespace content when it is being used as a formatting sample.
	children := parent.Children()
	for index, sibling := range children {
		if sibling == node || (parent.Type() == ast.NodeRoot && index == 0) {
			continue
		}
		if sibling.Type() != node.Type() {
			continue
		}
		if value, ok := lookupRaw(sibling, "before"); ok {
			if text, ok := value.(string); ok {
				return text, true
			}
		}
	}
	for index, sibling := range children {
		if sibling == node || (parent.Type() == ast.NodeRoot && index == 0) {
			continue
		}
		if value, ok := lookupRaw(sibling, "before"); ok {
			if text, ok := value.(string); ok {
				return text, true
			}
		}
	}
	return "", false
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
	if parent := node.Parent(); parent != nil {
		if indent := inferredContainerIndent(parent); indent != "" {
			return indent
		}
	}
	if root := node.Root(); root != nil {
		if indent := rawString(root, "indent", ""); indent != "" {
			return indent
		}
		if indent := inferredIndent(root); indent != "" {
			return indent
		}
	}
	return "    "
}

func inferredContainerIndent(parent ast.Container) string {
	if before, ok := lookupRaw(parent, "before"); ok {
		if text, ok := before.(string); ok && text != "" && strings.TrimSpace(text) == "" {
			if newline := strings.LastIndexByte(text, '\n'); newline >= 0 {
				return text[newline+1:]
			}
			return text
		}
	}
	for _, child := range parent.Children() {
		if before, ok := lookupRaw(child, "before"); ok {
			if text, ok := before.(string); ok && strings.TrimSpace(text) == "" && text != "" {
				if newline := strings.LastIndexByte(text, '\n'); newline >= 0 {
					return text[newline+1:]
				}
				return text
			}
		}
	}
	return ""
}

func inferredIndent(node ast.Node) string {
	container, ok := node.(ast.Container)
	if !ok {
		return ""
	}
	for _, child := range container.Children() {
		if before, ok := lookupRaw(child, "before"); ok {
			if text, ok := before.(string); ok {
				if newline := strings.LastIndexByte(text, '\n'); newline >= 0 {
					indent := text[newline+1:]
					if indent != "" && strings.TrimSpace(indent) == "" {
						return indent
					}
				}
			}
		}
		if indent := inferredIndent(child); indent != "" {
			return indent
		}
	}
	return ""
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
