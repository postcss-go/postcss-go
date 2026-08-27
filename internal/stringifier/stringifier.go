package stringifier

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
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
	renderCache() *renderCache
}

type builderWriter struct {
	*strings.Builder
	cache *renderCache
}

func (w builderWriter) writeString(text string) {
	w.Builder.WriteString(text)
}

func (w builderWriter) writeByte(ch byte) {
	w.Builder.WriteByte(ch)
}

func (w builderWriter) renderCache() *renderCache {
	return w.cache
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

// DirectEligible reports whether node can use the allocation-light stringifier path.
func DirectEligible(node ast.Node) bool {
	return directEligible(node)
}

func stringify(node ast.Node, stripSourceMapAnnotations bool) string {
	if directEligible(node) {
		return directStringify(node, stripSourceMapAnnotations)
	}
	var builder strings.Builder
	if rng := node.Range(); rng.End > rng.Start {
		builder.Grow(rng.End - rng.Start + 64)
	}
	writeNode(builderWriter{Builder: &builder, cache: &renderCache{}}, node, 0, stripSourceMapAnnotations)
	return builder.String()
}

func StringifyWithBuilder(node ast.Node) []BuilderPart {
	parts := make([]BuilderPart, 0)
	writeBuilderNode(&parts, node, 0, new(int), &renderCache{})
	return parts
}

func appendBuilderPart(parts *[]BuilderPart, css string, node int, kind string) {
	if css != "" {
		*parts = append(*parts, BuilderPart{CSS: css, Node: node, Type: kind})
	}
}

func writeBuilderNode(parts *[]BuilderPart, node ast.Node, depth int, next *int, cache *renderCache) {
	(*next)++
	id := *next
	switch current := node.(type) {
	case *ast.Document:
		for index, child := range current.Nodes {
			appendBuilderPart(parts, nodeBeforeDocument(child, depth, index), 0, "")
			writeBuilderNode(parts, child, depth, next, cache)
		}
		appendBuilderPart(parts, rawString(current, "after", ""), 0, "")
	case *ast.Root:
		for index, child := range current.Nodes {
			appendBuilderPart(parts, escapeHTMLInCSS(nodeBefore(cache, child, depth, index)), 0, "")
			writeBuilderNode(parts, child, depth, next, cache)
		}
		appendBuilderPart(parts, rawString(current, "after", ""), 0, "")
	case *ast.Rule:
		appendBuilderPart(parts, ruleHeader(cache, current)+"{", id, "start")
		for index, child := range current.Nodes {
			appendBuilderPart(parts, escapeHTMLInCSS(nodeBefore(cache, child, depth+1, index)), 0, "")
			writeBuilderNode(parts, child, depth+1, next, cache)
		}
		close := blockClosePrefix(cache, current, len(current.Nodes), depth) + "}"
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
		appendBuilderPart(parts, atRuleHeader(current)+rawBetween(cache, current, "between", " ")+"{", id, "start")
		for index, child := range current.Nodes {
			appendBuilderPart(parts, escapeHTMLInCSS(nodeBefore(cache, child, depth+1, index)), 0, "")
			writeBuilderNode(parts, child, depth+1, next, cache)
		}
		close := blockClosePrefix(cache, current, len(current.Nodes), depth) + "}"
		appendBuilderPart(parts, close, id, "end")
	case *ast.Declaration:
		text := declarationText(cache, current)
		if parent := current.Parent(); parent != nil && needsSemicolon(parent, current) {
			text += ";"
		}
		appendBuilderPart(parts, text, id, "")
	case *ast.Comment:
		appendBuilderPart(parts, commentText(cache, current), id, "")
	}
}

func StringifyWithSourceMap(node ast.Node, opts SourceMapOptions) (StringifyResult, error) {
	writer := newSourceMapWriter(opts.SourceMapFrom)
	writer.preserveAnnotation = opts.PreserveAnnotation
	writeMappedNode(writer, node, 0)
	if writer.mapBuilder.Len() == 0 {
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
		writer.writeString(ruleHeader(writer.renderCache(), current))
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
		writer.writeString(rawBetween(writer.renderCache(), current, "between", " "))
		writer.writeByte('{')
		childCount := writeChildren(writer, current.Nodes, depth+1, true, stripSourceMapAnnotations)
		writeBlockClose(writer, current, childCount, depth)
	case *ast.Declaration:
		writer.writeString(declarationText(writer.renderCache(), current))
		if parent := current.Parent(); parent != nil && needsSemicolon(parent, current) {
			writer.writeByte(';')
		}
	case *ast.Comment:
		writer.writeString(commentText(writer.renderCache(), current))
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
		writer.writeString(ruleHeader(writer.renderCache(), current))
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
		writer.writeString(rawBetween(writer.renderCache(), current, "between", " "))
		writer.writeByte('{')
		childCount := writeMappedChildren(writer, current.Nodes, depth+1)
		writeBlockClose(writer, current, childCount, depth)
		writer.AddEndMapping(current)
		return true
	case *ast.Declaration:
		writer.AddMapping(current)
		writer.writeString(declarationPrefix(writer.renderCache(), current))
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
		writer.writeString(commentText(writer.renderCache(), current))
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
	writer.writeString(blockClosePrefix(writer.renderCache(), node, childCount, depth))
	writer.writeByte('}')
}

func blockClosePrefix(cache *renderCache, node ast.Node, childCount, depth int) string {
	if hasRaw(node, "after") {
		return escapeHTMLInCSS(rawString(node, "after", ""))
	}
	if inferred, ok := cache.inferBlockAfter(node, childCount); ok {
		return escapeHTMLInCSS(inferred)
	}
	if childCount != 0 {
		return "\n" + strings.Repeat(indentFor(cache, node), depth)
	}
	return ""
}

// renderCache memoizes the document-wide lookups a stringify pass performs for
// nodes that carry no explicit raw. Without it every such node rescans the
// whole document, which makes stringifying quadratic in the node count. Raws
// never change during a pass, so every sample below is stable once computed.
type renderCache struct {
	blockAfter      map[blockAfterKey]blockAfterRaw
	containerIndent map[ast.Container]string
	rootIndent      map[ast.Node]string
	descendantRaw   map[descendantRawKey]string
	siblingRaw      map[descendantRawKey]blockAfterRaw
	beforeRaw       map[ast.Container]bool
}

type blockAfterKey struct {
	origin ast.Node
	empty  bool
}

type blockAfterRaw struct {
	value string
	ok    bool
}

type descendantRawKey struct {
	container ast.Container
	key       string
	nodeType  ast.NodeType
}

// containerIndentSample memoizes inferredContainerIndent, which scans all of
// `parent`'s children. It is called once per child, so without the cache a
// container costs O(children²).
func (cache *renderCache) containerIndentSample(parent ast.Container) string {
	if cache == nil {
		return inferredContainerIndent(parent)
	}
	if indent, found := cache.containerIndent[parent]; found {
		return indent
	}
	indent := inferredContainerIndent(parent)
	if cache.containerIndent == nil {
		cache.containerIndent = make(map[ast.Container]string, 8)
	}
	cache.containerIndent[parent] = indent
	return indent
}

// rootIndentSample memoizes the document-wide indent sample: an explicit
// `indent` raw on the root, or the first indent inferred from any descendant's
// `before` raw. Both only depend on the root.
func (cache *renderCache) rootIndentSample(root ast.Node) string {
	if cache == nil {
		return rootIndent(root)
	}
	if indent, found := cache.rootIndent[root]; found {
		return indent
	}
	indent := rootIndent(root)
	if cache.rootIndent == nil {
		cache.rootIndent = make(map[ast.Node]string, 2)
	}
	cache.rootIndent[root] = indent
	return indent
}

func rootIndent(root ast.Node) string {
	if indent := rawString(root, "indent", ""); indent != "" {
		return indent
	}
	return inferredIndent(root)
}

// siblingRawSample memoizes inferSiblingRaw, which scans all of `parent`'s
// children of a given type. The scan never excludes the node being written, so
// the sample only depends on the container, the raw key and the node type.
func (cache *renderCache) siblingRawSample(parent ast.Container, key string, nodeType ast.NodeType) (string, bool) {
	if cache == nil {
		return inferSiblingRaw(parent, key, nodeType)
	}
	cacheKey := descendantRawKey{container: parent, key: key, nodeType: nodeType}
	if cached, found := cache.siblingRaw[cacheKey]; found {
		return cached.value, cached.ok
	}
	value, ok := inferSiblingRaw(parent, key, nodeType)
	if cache.siblingRaw == nil {
		cache.siblingRaw = make(map[descendantRawKey]blockAfterRaw, 8)
	}
	cache.siblingRaw[cacheKey] = blockAfterRaw{value: value, ok: ok}
	return value, ok
}

// hasBeforeRaw reports whether any child of `parent` carries a `before` raw.
// When none does, rawBeforeDetected can only miss, whichever node is being
// written, so the answer short-circuits its per-node sibling scan.
func (cache *renderCache) hasBeforeRaw(parent ast.Container) bool {
	if cache == nil {
		return anyBeforeRaw(parent)
	}
	if present, found := cache.beforeRaw[parent]; found {
		return present
	}
	present := anyBeforeRaw(parent)
	if cache.beforeRaw == nil {
		cache.beforeRaw = make(map[ast.Container]bool, 8)
	}
	cache.beforeRaw[parent] = present
	return present
}

func anyBeforeRaw(parent ast.Container) bool {
	for _, sibling := range parent.Children() {
		if _, ok := lookupRaw(sibling, "before"); ok {
			return true
		}
	}
	return false
}

// descendantRawSample memoizes inferDescendantRaw, which walks the whole
// subtree of `container`. Callers only use a non-empty result, so an empty
// string marks a miss. The lookup does not depend on the node being written.
func (cache *renderCache) descendantRawSample(container ast.Container, key string, nodeType ast.NodeType) string {
	if cache == nil {
		inferred, ok := inferDescendantRaw(container, key, nodeType)
		if !ok {
			return ""
		}
		return inferred
	}
	cacheKey := descendantRawKey{container: container, key: key, nodeType: nodeType}
	if inferred, found := cache.descendantRaw[cacheKey]; found {
		return inferred
	}
	inferred, ok := inferDescendantRaw(container, key, nodeType)
	if !ok {
		inferred = ""
	}
	if cache.descendantRaw == nil {
		cache.descendantRaw = make(map[descendantRawKey]string, 8)
	}
	cache.descendantRaw[cacheKey] = inferred
	return inferred
}

// inferBlockAfter reuses another block of the same emptiness as a formatting
// sample for `node`'s closing brace.
//
// The sample only depends on the document `node` belongs to and on whether the
// block is empty: callers reach this path only when `node` itself has no
// `after` raw, so `node` can never be the sample and the result is shared by
// every block of the same emptiness in that document. That is what makes the
// per-document memoization below correct.
func (cache *renderCache) inferBlockAfter(node ast.Node, childCount int) (string, bool) {
	origin := node.Root()
	if origin == nil {
		origin = node
	}
	if cache == nil {
		return scanBlockAfter(origin, node, childCount == 0)
	}
	key := blockAfterKey{origin: origin, empty: childCount == 0}
	if cached, found := cache.blockAfter[key]; found {
		return cached.value, cached.ok
	}
	value, ok := scanBlockAfter(origin, node, childCount == 0)
	if cache.blockAfter == nil {
		cache.blockAfter = make(map[blockAfterKey]blockAfterRaw, 2)
	}
	cache.blockAfter[key] = blockAfterRaw{value: value, ok: ok}
	return value, ok
}

func scanBlockAfter(origin, node ast.Node, wantEmpty bool) (string, bool) {
	container, isContainer := origin.(ast.Container)
	if !isContainer {
		return "", false
	}
	return scanChildrenBlockAfter(container.Children(), node, wantEmpty)
}

func scanChildrenBlockAfter(nodes []ast.Node, node ast.Node, wantEmpty bool) (string, bool) {
	for _, candidate := range nodes {
		if candidate == nil {
			continue
		}
		container, isContainer := candidate.(ast.Container)
		if !isContainer {
			continue
		}
		if candidate != node && isBlockContainer(candidate) && (len(container.Children()) == 0) == wantEmpty {
			if value, exists := lookupRaw(candidate, "after"); exists {
				text, _ := value.(string)
				return text, true
			}
		}
		if value, ok := scanChildrenBlockAfter(container.Children(), node, wantEmpty); ok {
			return value, true
		}
	}
	return "", false
}

// isBlockContainer reports whether the node is written with braces, which is
// what makes its `after` raw usable as a sample for another block.
func isBlockContainer(node ast.Node) bool {
	switch node.(type) {
	case *ast.Root, *ast.Document:
		return false
	default:
		return true
	}
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
		writer.writeString(nodeBefore(writer.renderCache(), child, depth, index))
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
		before := nodeBefore(writer.renderCache(), child, depth, index)
		if escapeBefore {
			before = escapeHTMLInCSS(before)
		}
		writer.writeString(before)
		writeNode(writer, child, depth, stripSourceMapAnnotations)
		written++
	}
	return written
}

func hasRaw(node ast.Node, key string) bool {
	return ast.HasRaw(node, key)
}

func rawString(node ast.Node, key, fallback string) string {
	if text, ok := ast.LookupRawString(node, key); ok {
		return text
	}
	return fallback
}

func rawBool(node ast.Node, key string, fallback bool) bool {
	if value, ok := ast.LookupRawBool(node, key); ok {
		return value
	}
	return fallback
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
	return ast.LookupRaw(node, key)
}

func ruleHeader(cache *renderCache, node *ast.Rule) string {
	return escapeHTMLInCSS(rawValue(node, "selector", strings.TrimSpace(node.Selector)) + rawBetween(cache, node, "between", " "))
}

func atRuleHeader(node *ast.AtRule) string {
	params := rawValue(node, "params", strings.TrimSpace(node.Params))
	return escapeHTMLInCSS("@" + node.Name + atRuleAfterName(node, params) + params)
}

func atRuleAfterName(node *ast.AtRule, params string) string {
	if text, ok := ast.LookupRawString(node, "afterName"); ok {
		return text
	}
	if params != "" {
		if parent := node.Parent(); parent != nil {
			for _, sibling := range parent.Children() {
				other, ok := sibling.(*ast.AtRule)
				if !ok || other == node || strings.TrimSpace(other.Params) == "" {
					continue
				}
				if text, ok := ast.LookupRawString(other, "afterName"); ok {
					return text
				}
			}
		}
		return " "
	}
	return ""
}

func declarationText(cache *renderCache, node *ast.Declaration) string {
	return escapeHTMLInCSS(declarationPrefix(cache, node) + declarationValueText(node))
}

func declarationPrefix(cache *renderCache, node *ast.Declaration) string {
	return strings.TrimSpace(node.Prop) + rawBetween(cache, node, "between", ": ")
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

func commentText(cache *renderCache, node *ast.Comment) string {
	return escapeHTMLInCSS("/*" + rawStringDetected(cache, node, "left", " ") + node.Text + rawStringDetected(cache, node, "right", " ") + "*/")
}

func rawStringDetected(cache *renderCache, node ast.Node, key, fallback string) string {
	if text, ok := ast.LookupRawString(node, key); ok {
		return text
	}
	if parent := node.Parent(); parent != nil {
		if inferred, ok := cache.siblingRawSample(parent, key, node.Type()); ok {
			return inferred
		}
	}
	return fallback
}

func nodeBefore(cache *renderCache, node ast.Node, depth, index int) string {
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
		if inferred, ok := rawBeforeDetected(cache, parent, node); ok {
			return inferred
		}
		after := rawString(node, "after", "")
		if indent := cache.containerIndentSample(parent); indent != "" && strings.Contains(indent, " ") && !strings.Contains(indent, "\n") && !strings.Contains(after, "\n") {
			return indent
		}
	}
	if index == 0 && depth == 0 {
		return ""
	}
	return "\n" + strings.Repeat(indentFor(cache, node), depth)
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

func rawBetween(cache *renderCache, node ast.Node, key, fallback string) string {
	if value, ok := lookupRaw(node, key); ok {
		if stringValue, ok := value.(string); ok {
			if node.Type() == ast.NodeDecl && stringValue == "" {
				if parent := node.Parent(); parent != nil {
					if inferred, inferredOK := cache.siblingRawSample(parent, key, node.Type()); inferredOK && inferred != "" {
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
		if inferred, ok := cache.siblingRawSample(parent, key, node.Type()); ok {
			if node.Type() != ast.NodeDecl || !strings.Contains(inferred, "/*") {
				return inferred
			}
			if strings.Contains(inferred, ":") {
				return ":"
			}
		}
		if node.Type() == ast.NodeDecl && node.Source() == nil {
			for container := parent; container != nil; container = container.Parent() {
				if inferred := cache.descendantRawSample(container, key, node.Type()); inferred != "" {
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

func rawBeforeDetected(cache *renderCache, parent ast.Container, node ast.Node) (string, bool) {
	if !cache.hasBeforeRaw(parent) {
		return "", false
	}
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

func indentFor(cache *renderCache, node ast.Node) string {
	if parent := node.Parent(); parent != nil {
		if indent := cache.containerIndentSample(parent); indent != "" {
			return indent
		}
	}
	if root := node.Root(); root != nil {
		if indent := cache.rootIndentSample(root); indent != "" {
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
