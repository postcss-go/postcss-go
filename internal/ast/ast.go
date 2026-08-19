package ast

import (
	"fmt"
	"strings"

	csserrors "postcss-go/internal/csserrors"
	"postcss-go/internal/sourcemap"
)

type NodeType string

const (
	NodeRoot     NodeType = "root"
	NodeDocument NodeType = "document"
	NodeRule     NodeType = "rule"
	NodeAtRule   NodeType = "atrule"
	NodeDecl     NodeType = "decl"
	NodeComment  NodeType = "comment"
)

type SourceRange struct {
	Start int
	End   int
}

// Raws stores the formatting metadata used by PostCSS's stringifier. Values
// are normally strings, except value-like entries (for example selector and
// declaration value) which may be {raw, value} objects.
type Raws map[string]any

// RawValue pairs an original raw spelling with its normalized semantic value.
type RawValue struct {
	Raw   string `json:"raw"`
	Value string `json:"value"`
}

type Node interface {
	Type() NodeType
	Parent() Container
	SetParent(Container)
	Range() SourceRange
	SetRange(SourceRange)
	Source() *sourcemap.Location
	SetSource(*sourcemap.Location)
	RawFormatting() Raws
	RawFormattingReadOnly() Raws
	// Root returns the nearest stylesheet root. For a node inside a Document it
	// stops at that Document's child Root; for a detached node it returns the
	// node itself, matching PostCSS's Node#root() semantics.
	Root() Node
	Next() Node
	Prev() Node
	Remove() Node
	ReplaceWith(...Node) error
	Clone() Node
	CloneBefore(...Node) (Node, error)
	CloneAfter(...Node) (Node, error)
	Before(...Node) error
	After(...Node) error
	Error(string, ...ErrorOptions) *csserrors.SyntaxError
}

type Container interface {
	Node
	Children() []Node
	Append(...Node)
	Prepend(...Node)
	InsertBefore(Node, ...Node) error
	InsertAfter(Node, ...Node) error
	RemoveChild(Node) error
	Index(Node) int
	First() Node
	Last() Node
	RemoveAll()
	Some(func(Node) bool) bool
	Every(func(Node) bool) bool
}

type BaseNode struct {
	parent           Container
	rng              SourceRange
	src              sourcemap.Location
	hasSrc           bool
	rawFlags         rawFlag
	rawSemicolon     bool
	rawBefore        string
	rawAfter         string
	rawBetween       string
	rawOwnSemicolon  string
	rawAfterName     string
	rawImportant     string
	rawLeft          string
	rawRight         string
	rawIndent        string
	rawSelector      RawValue
	rawValue         RawValue
	rawParams        RawValue
	Raws             Raws
	rawsMaterialized bool
	lastIterator     int
	iterators        map[int]int
}

type ErrorOptions struct {
	Plugin   string
	Index    int
	EndIndex int
	Word     string
	Start    *sourcemap.Position
	End      *sourcemap.Position
}

func (n *BaseNode) Parent() Container {
	return n.parent
}

func (n *BaseNode) SetParent(parent Container) {
	n.parent = parent
}

func (n *BaseNode) Range() SourceRange {
	return n.rng
}

func (n *BaseNode) SetRange(rng SourceRange) {
	n.rng = rng
}

func (n *BaseNode) Source() *sourcemap.Location {
	if !n.hasSrc {
		return nil
	}
	return &n.src
}

func (n *BaseNode) SetSource(src *sourcemap.Location) {
	if src == nil {
		n.hasSrc = false
		n.src = sourcemap.Location{}
		return
	}
	n.src = *src
	n.hasSrc = true
}

func (n *BaseNode) RawFormatting() Raws {
	return n.ensureRaws()
}

func (n *BaseNode) RawFormattingReadOnly() Raws {
	if n.rawFlags == 0 && n.Raws == nil {
		return nil
	}
	n.materializeRaws()
	return n.Raws
}

func (n *BaseNode) nextIterator() int {
	n.lastIterator++
	if n.iterators == nil {
		n.iterators = map[int]int{}
	}
	n.iterators[n.lastIterator] = 0
	return n.lastIterator
}

func (n *BaseNode) iteratorIndex(id int) int {
	if n.iterators == nil {
		return 0
	}
	return n.iterators[id]
}

func (n *BaseNode) advanceIterator(id int) {
	if n.iterators == nil {
		return
	}
	n.iterators[id]++
}

func (n *BaseNode) dropIterator(id int) {
	if n.iterators == nil {
		return
	}
	delete(n.iterators, id)
}

func (n *BaseNode) resetIterators() {
	n.iterators = nil
	n.lastIterator = 0
}

func (n *BaseNode) shiftIteratorsOnInsert(index, count int, before bool) {
	if n.iterators == nil || count == 0 {
		return
	}
	for id, current := range n.iterators {
		if before {
			if index <= current {
				n.iterators[id] = current + count
			}
			continue
		}
		if index < current {
			n.iterators[id] = current + count
		}
	}
}

func (n *BaseNode) shiftIteratorsOnRemove(index int) {
	if n.iterators == nil {
		return
	}
	for id, current := range n.iterators {
		if current >= index {
			n.iterators[id] = current - 1
		}
	}
}

type Root struct {
	BaseNode
	Nodes []Node
}

// Document is a container for multiple CSS roots. It is used by syntaxes that
// parse a document containing more than one stylesheet (for example HTML with
// multiple <style> blocks). A normal CSS parse still returns a Root.
type Document struct {
	BaseNode
	Nodes []Node
}

func NewDocument() *Document { return &Document{} }

func (d *Document) Type() NodeType        { return NodeDocument }
func (d *Document) Children() []Node      { return d.Nodes }
func (d *Document) Append(nodes ...Node)  { appendNodes(d, &d.Nodes, nodes...) }
func (d *Document) Prepend(nodes ...Node) { prependNodes(d, &d.Nodes, nodes...) }
func (d *Document) InsertBefore(target Node, nodes ...Node) error {
	return insertBefore(d, &d.Nodes, target, nodes...)
}
func (d *Document) InsertAfter(target Node, nodes ...Node) error {
	return insertAfter(d, &d.Nodes, target, nodes...)
}
func (d *Document) RemoveChild(target Node) error   { return removeChildFrom(d, &d.Nodes, target) }
func (d *Document) Index(target Node) int           { return indexNode(d.Nodes, target) }
func (d *Document) First() Node                     { return firstNode(d.Nodes) }
func (d *Document) Last() Node                      { return lastNode(d.Nodes) }
func (d *Document) RemoveAll()                      { removeAllChildren(d, &d.Nodes) }
func (d *Document) Some(fn func(Node) bool) bool    { return someNodes(d.Nodes, fn) }
func (d *Document) Every(fn func(Node) bool) bool   { return everyNodes(d.Nodes, fn) }
func (d *Document) Root() Node                      { return d }
func (d *Document) Next() Node                      { return nextNode(d) }
func (d *Document) Prev() Node                      { return prevNode(d) }
func (d *Document) Remove() Node                    { return removeNode(d) }
func (d *Document) ReplaceWith(nodes ...Node) error { return replaceNode(d, nodes...) }
func (d *Document) Clone() Node                     { return cloneNode(d) }
func (d *Document) Before(nodes ...Node) error      { return beforeNode(d, nodes...) }
func (d *Document) After(nodes ...Node) error       { return afterNode(d, nodes...) }
func (d *Document) Error(message string, opts ...ErrorOptions) *csserrors.SyntaxError {
	return errorNode(d, message, opts...)
}
func (d *Document) CloneBefore(overrides ...Node) (Node, error) {
	return cloneBefore(d, overrides...)
}
func (d *Document) CloneAfter(overrides ...Node) (Node, error) {
	return cloneAfter(d, overrides...)
}

func NewRoot() *Root {
	return &Root{}
}

func (r *Root) Type() NodeType { return NodeRoot }

func (r *Root) Children() []Node { return r.Nodes }

func (r *Root) Append(nodes ...Node) { appendNodes(r, &r.Nodes, nodes...) }

func (r *Root) Prepend(nodes ...Node) { prependNodes(r, &r.Nodes, nodes...) }

func (r *Root) InsertBefore(target Node, nodes ...Node) error {
	return insertBefore(r, &r.Nodes, target, nodes...)
}

func (r *Root) InsertAfter(target Node, nodes ...Node) error {
	return insertAfter(r, &r.Nodes, target, nodes...)
}

func (r *Root) RemoveChild(target Node) error {
	return removeChildFrom(r, &r.Nodes, target)
}

func (r *Root) Index(target Node) int {
	return indexNode(r.Nodes, target)
}
func (r *Root) First() Node { return firstNode(r.Nodes) }
func (r *Root) Last() Node  { return lastNode(r.Nodes) }
func (r *Root) RemoveAll()  { removeAllChildren(r, &r.Nodes) }
func (r *Root) Some(fn func(Node) bool) bool {
	return someNodes(r.Nodes, fn)
}
func (r *Root) Every(fn func(Node) bool) bool {
	return everyNodes(r.Nodes, fn)
}

func (r *Root) Root() Node                      { return r }
func (r *Root) Next() Node                      { return nextNode(r) }
func (r *Root) Prev() Node                      { return prevNode(r) }
func (r *Root) Remove() Node                    { return removeNode(r) }
func (r *Root) ReplaceWith(nodes ...Node) error { return replaceNode(r, nodes...) }
func (r *Root) Clone() Node                     { return cloneNode(r) }
func (r *Root) Before(nodes ...Node) error      { return beforeNode(r, nodes...) }
func (r *Root) After(nodes ...Node) error       { return afterNode(r, nodes...) }
func (r *Root) Error(message string, opts ...ErrorOptions) *csserrors.SyntaxError {
	return errorNode(r, message, opts...)
}
func (r *Root) CloneBefore(overrides ...Node) (Node, error) {
	return cloneBefore(r, overrides...)
}
func (r *Root) CloneAfter(overrides ...Node) (Node, error) {
	return cloneAfter(r, overrides...)
}

func (r *Root) String() string {
	var builder strings.Builder
	for idx, node := range r.Nodes {
		if idx > 0 {
			builder.WriteByte('\n')
		}
		builder.WriteString(stringifyNode(node))
	}
	return builder.String()
}

type Rule struct {
	BaseNode
	Selector string
	Nodes    []Node
}

func NewRule(selector string) *Rule { return &Rule{Selector: selector} }

func (r *Rule) Type() NodeType { return NodeRule }

func (r *Rule) Children() []Node { return r.Nodes }

func (r *Rule) Append(nodes ...Node) { appendNodes(r, &r.Nodes, nodes...) }

func (r *Rule) Prepend(nodes ...Node) { prependNodes(r, &r.Nodes, nodes...) }

func (r *Rule) InsertBefore(target Node, nodes ...Node) error {
	return insertBefore(r, &r.Nodes, target, nodes...)
}

func (r *Rule) InsertAfter(target Node, nodes ...Node) error {
	return insertAfter(r, &r.Nodes, target, nodes...)
}

func (r *Rule) RemoveChild(target Node) error {
	return removeChildFrom(r, &r.Nodes, target)
}

func (r *Rule) Index(target Node) int {
	return indexNode(r.Nodes, target)
}
func (r *Rule) First() Node { return firstNode(r.Nodes) }
func (r *Rule) Last() Node  { return lastNode(r.Nodes) }
func (r *Rule) RemoveAll()  { removeAllChildren(r, &r.Nodes) }
func (r *Rule) Some(fn func(Node) bool) bool {
	return someNodes(r.Nodes, fn)
}
func (r *Rule) Every(fn func(Node) bool) bool {
	return everyNodes(r.Nodes, fn)
}

func (r *Rule) Root() Node                      { return rootOf(r) }
func (r *Rule) Next() Node                      { return nextNode(r) }
func (r *Rule) Prev() Node                      { return prevNode(r) }
func (r *Rule) Remove() Node                    { return removeNode(r) }
func (r *Rule) ReplaceWith(nodes ...Node) error { return replaceNode(r, nodes...) }
func (r *Rule) Clone() Node                     { return cloneNode(r) }
func (r *Rule) Before(nodes ...Node) error      { return beforeNode(r, nodes...) }
func (r *Rule) After(nodes ...Node) error       { return afterNode(r, nodes...) }
func (r *Rule) Error(message string, opts ...ErrorOptions) *csserrors.SyntaxError {
	return errorNode(r, message, opts...)
}
func (r *Rule) CloneBefore(overrides ...Node) (Node, error) {
	return cloneBefore(r, overrides...)
}
func (r *Rule) CloneAfter(overrides ...Node) (Node, error) {
	return cloneAfter(r, overrides...)
}

func (r *Rule) Selectors() []string {
	parts := strings.Split(r.Selector, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		out = append(out, strings.TrimSpace(part))
	}
	return out
}

func (r *Rule) SetSelectors(values []string) {
	r.Selector = strings.Join(values, ", ")
}

type AtRule struct {
	BaseNode
	Name   string
	Params string
	Block  bool
	Nodes  []Node
}

func NewAtRule(name, params string) *AtRule { return &AtRule{Name: name, Params: params} }

func (r *AtRule) Type() NodeType { return NodeAtRule }

func (r *AtRule) Children() []Node { return r.Nodes }

func (r *AtRule) Append(nodes ...Node) { appendNodes(r, &r.Nodes, nodes...) }

func (r *AtRule) Prepend(nodes ...Node) { prependNodes(r, &r.Nodes, nodes...) }

func (r *AtRule) InsertBefore(target Node, nodes ...Node) error {
	return insertBefore(r, &r.Nodes, target, nodes...)
}

func (r *AtRule) InsertAfter(target Node, nodes ...Node) error {
	return insertAfter(r, &r.Nodes, target, nodes...)
}

func (r *AtRule) RemoveChild(target Node) error {
	return removeChildFrom(r, &r.Nodes, target)
}

func (r *AtRule) Index(target Node) int {
	return indexNode(r.Nodes, target)
}
func (r *AtRule) First() Node { return firstNode(r.Nodes) }
func (r *AtRule) Last() Node  { return lastNode(r.Nodes) }
func (r *AtRule) RemoveAll()  { removeAllChildren(r, &r.Nodes) }
func (r *AtRule) Some(fn func(Node) bool) bool {
	return someNodes(r.Nodes, fn)
}
func (r *AtRule) Every(fn func(Node) bool) bool {
	return everyNodes(r.Nodes, fn)
}

func (r *AtRule) Root() Node                      { return rootOf(r) }
func (r *AtRule) Next() Node                      { return nextNode(r) }
func (r *AtRule) Prev() Node                      { return prevNode(r) }
func (r *AtRule) Remove() Node                    { return removeNode(r) }
func (r *AtRule) ReplaceWith(nodes ...Node) error { return replaceNode(r, nodes...) }
func (r *AtRule) Clone() Node                     { return cloneNode(r) }
func (r *AtRule) Before(nodes ...Node) error      { return beforeNode(r, nodes...) }
func (r *AtRule) After(nodes ...Node) error       { return afterNode(r, nodes...) }
func (r *AtRule) Error(message string, opts ...ErrorOptions) *csserrors.SyntaxError {
	return errorNode(r, message, opts...)
}
func (r *AtRule) CloneBefore(overrides ...Node) (Node, error) {
	return cloneBefore(r, overrides...)
}
func (r *AtRule) CloneAfter(overrides ...Node) (Node, error) {
	return cloneAfter(r, overrides...)
}

func (r *AtRule) HasBlock() bool {
	return r.Block
}

type Declaration struct {
	BaseNode
	Prop      string
	Value     string
	Important bool
}

func NewDeclaration(prop, value string) *Declaration {
	return &Declaration{Prop: prop, Value: value}
}

func (d *Declaration) Type() NodeType                  { return NodeDecl }
func (d *Declaration) Root() Node                      { return rootOf(d) }
func (d *Declaration) Next() Node                      { return nextNode(d) }
func (d *Declaration) Prev() Node                      { return prevNode(d) }
func (d *Declaration) Remove() Node                    { return removeNode(d) }
func (d *Declaration) ReplaceWith(nodes ...Node) error { return replaceNode(d, nodes...) }
func (d *Declaration) Clone() Node                     { return cloneNode(d) }
func (d *Declaration) Before(nodes ...Node) error      { return beforeNode(d, nodes...) }
func (d *Declaration) After(nodes ...Node) error       { return afterNode(d, nodes...) }
func (d *Declaration) Error(message string, opts ...ErrorOptions) *csserrors.SyntaxError {
	return errorNode(d, message, opts...)
}
func (d *Declaration) CloneBefore(overrides ...Node) (Node, error) {
	return cloneBefore(d, overrides...)
}
func (d *Declaration) CloneAfter(overrides ...Node) (Node, error) {
	return cloneAfter(d, overrides...)
}

func (d *Declaration) Variable() bool {
	return strings.HasPrefix(d.Prop, "--") || strings.HasPrefix(d.Prop, "$")
}

type Comment struct {
	BaseNode
	Text string
}

func NewComment(text string) *Comment { return &Comment{Text: text} }

func (c *Comment) Type() NodeType                  { return NodeComment }
func (c *Comment) Root() Node                      { return rootOf(c) }
func (c *Comment) Next() Node                      { return nextNode(c) }
func (c *Comment) Prev() Node                      { return prevNode(c) }
func (c *Comment) Remove() Node                    { return removeNode(c) }
func (c *Comment) ReplaceWith(nodes ...Node) error { return replaceNode(c, nodes...) }
func (c *Comment) Clone() Node                     { return cloneNode(c) }
func (c *Comment) Before(nodes ...Node) error      { return beforeNode(c, nodes...) }
func (c *Comment) After(nodes ...Node) error       { return afterNode(c, nodes...) }
func (c *Comment) Error(message string, opts ...ErrorOptions) *csserrors.SyntaxError {
	return errorNode(c, message, opts...)
}
func (c *Comment) CloneBefore(overrides ...Node) (Node, error) {
	return cloneBefore(c, overrides...)
}
func (c *Comment) CloneAfter(overrides ...Node) (Node, error) {
	return cloneAfter(c, overrides...)
}

type iteratorContainer interface {
	Container
	nextIterator() int
	iteratorIndex(int) int
	advanceIterator(int)
	dropIterator(int)
	resetIterators()
	shiftIteratorsOnInsert(int, int, bool)
	shiftIteratorsOnRemove(int)
}

func cloneNode(node Node) Node {
	switch current := node.(type) {
	case *Document:
		out := NewDocument()
		out.BaseNode = cloneBaseNode(current.BaseNode)
		out.rng = current.rng
		out.src = current.src
		out.hasSrc = current.hasSrc
		for _, child := range current.Nodes {
			out.Append(cloneNode(child))
		}
		return out
	case *Root:
		out := NewRoot()
		out.BaseNode = cloneBaseNode(current.BaseNode)
		out.rng = current.rng
		out.src = current.src
		out.hasSrc = current.hasSrc
		for _, child := range current.Nodes {
			out.Append(cloneNode(child))
		}
		return out
	case *Rule:
		out := NewRule(current.Selector)
		out.BaseNode = cloneBaseNode(current.BaseNode)
		out.rng = current.rng
		out.src = current.src
		out.hasSrc = current.hasSrc
		for _, child := range current.Nodes {
			out.Append(cloneNode(child))
		}
		return out
	case *AtRule:
		out := NewAtRule(current.Name, current.Params)
		out.Block = current.Block
		out.BaseNode = cloneBaseNode(current.BaseNode)
		out.rng = current.rng
		out.src = current.src
		out.hasSrc = current.hasSrc
		for _, child := range current.Nodes {
			out.Append(cloneNode(child))
		}
		return out
	case *Declaration:
		out := NewDeclaration(current.Prop, current.Value)
		out.Important = current.Important
		out.BaseNode = cloneBaseNode(current.BaseNode)
		out.rng = current.rng
		out.src = current.src
		out.hasSrc = current.hasSrc
		return out
	case *Comment:
		out := NewComment(current.Text)
		out.BaseNode = cloneBaseNode(current.BaseNode)
		out.rng = current.rng
		out.src = current.src
		out.hasSrc = current.hasSrc
		return out
	default:
		return nil
	}
}

// CloneRaws deep-copies formatting metadata and normalizes value-like maps into RawValue.
func CloneRaws(raws Raws) Raws {
	if raws == nil {
		return nil
	}
	out := make(Raws, len(raws))
	for key, value := range raws {
		out[key] = cloneRawValue(value)
	}
	return out
}

func cloneRawValue(value any) any {
	switch current := value.(type) {
	case nil:
		return nil
	case string, bool, int, int64, float64:
		return current
	case RawValue:
		return current
	case *RawValue:
		if current == nil {
			return nil
		}
		copied := *current
		return &copied
	case map[string]string:
		if raw, ok := current["raw"]; ok {
			if _, hasValue := current["value"]; hasValue && len(current) == 2 {
				return RawValue{Raw: raw, Value: current["value"]}
			}
		}
		out := make(map[string]string, len(current))
		for key, item := range current {
			out[key] = item
		}
		return out
	case map[string]any:
		if raw, ok := current["raw"].(string); ok {
			if semantic, hasValue := current["value"].(string); hasValue && looksLikeRawValue(current) {
				return RawValue{Raw: raw, Value: semantic}
			}
		}
		out := make(map[string]any, len(current))
		for key, item := range current {
			out[key] = cloneRawValue(item)
		}
		return out
	case []any:
		out := make([]any, len(current))
		for index, item := range current {
			out[index] = cloneRawValue(item)
		}
		return out
	case []string:
		out := make([]string, len(current))
		copy(out, current)
		return out
	default:
		return current
	}
}

func looksLikeRawValue(value map[string]any) bool {
	if len(value) != 2 {
		return false
	}
	_, hasRaw := value["raw"]
	_, hasValue := value["value"]
	return hasRaw && hasValue
}

func stringifyNode(node Node) string {
	switch current := node.(type) {
	case *Rule:
		return current.Selector
	case *AtRule:
		if current.Params == "" {
			return "@" + current.Name
		}
		return "@" + current.Name + " " + current.Params
	case *Declaration:
		return current.Prop + ": " + current.Value
	case *Comment:
		return "/* " + current.Text + " */"
	default:
		return ""
	}
}

func rootOf(node Node) Node {
	current := node
	for current != nil && current.Parent() != nil {
		if _, isDocumentChild := current.Parent().(*Document); isDocumentChild {
			break
		}
		current = current.Parent()
	}
	return current
}

func nextNode(node Node) Node {
	if node == nil || node.Parent() == nil {
		return nil
	}
	index := node.Parent().Index(node)
	if index < 0 || index+1 >= len(node.Parent().Children()) {
		return nil
	}
	return node.Parent().Children()[index+1]
}

func prevNode(node Node) Node {
	if node == nil || node.Parent() == nil {
		return nil
	}
	index := node.Parent().Index(node)
	if index <= 0 {
		return nil
	}
	return node.Parent().Children()[index-1]
}

func removeNode(node Node) Node {
	if node == nil || node.Parent() == nil {
		return node
	}
	_ = node.Parent().RemoveChild(node)
	return node
}

func beforeNode(node Node, nodes ...Node) error {
	if node == nil || node.Parent() == nil {
		return nil
	}
	return node.Parent().InsertBefore(node, nodes...)
}

func afterNode(node Node, nodes ...Node) error {
	if node == nil || node.Parent() == nil {
		return nil
	}
	return node.Parent().InsertAfter(node, nodes...)
}

func errorNode(node Node, message string, optsList ...ErrorOptions) *csserrors.SyntaxError {
	var opts ErrorOptions
	if len(optsList) > 0 {
		opts = optsList[0]
	}
	location := node.Source()
	if location == nil || location.Input == nil {
		return csserrors.New(message, 0, 0, "", "", opts.Plugin)
	}

	start := location.Start
	end := location.End
	if opts.Start != nil {
		start = *opts.Start
	}
	if opts.End != nil {
		end = *opts.End
	}
	if opts.Word != "" {
		if wordStart, wordEnd, ok := locateWord(node, opts.Word); ok {
			start = wordStart
			end = wordEnd
		}
	} else if opts.Index > 0 || opts.EndIndex > 0 {
		if indexStart, indexEnd, ok := locateIndex(node, opts.Index, opts.EndIndex); ok {
			start = indexStart
			end = indexEnd
		}
	}

	err := csserrors.New(message, start.Line, start.Column, location.Input.CSS, location.Input.File, opts.Plugin)
	err.EndLine = end.Line
	err.EndColumn = end.Column
	return err
}

func replaceNode(node Node, nodes ...Node) error {
	if node == nil || node.Parent() == nil {
		return nil
	}
	parent := node.Parent()
	index := parent.Index(node)
	if index < 0 {
		return nil
	}
	if err := parent.RemoveChild(node); err != nil {
		return err
	}
	children := parent.Children()
	if index >= len(children) {
		parent.Append(nodes...)
		return nil
	}
	return parent.InsertBefore(children[index], nodes...)
}

func cloneBefore(node Node, overrides ...Node) (Node, error) {
	clone := node.Clone()
	if len(overrides) > 0 && overrides[0] != nil {
		clone = overrides[0]
	}
	if node.Parent() == nil {
		return clone, nil
	}
	return clone, node.Parent().InsertBefore(node, clone)
}

func cloneAfter(node Node, overrides ...Node) (Node, error) {
	clone := node.Clone()
	if len(overrides) > 0 && overrides[0] != nil {
		clone = overrides[0]
	}
	if node.Parent() == nil {
		return clone, nil
	}
	return clone, node.Parent().InsertAfter(node, clone)
}

func appendNodes(parent Container, dst *[]Node, nodes ...Node) {
	var sample Node
	if len(*dst) > 0 {
		sample = (*dst)[len(*dst)-1]
	}
	prepared := prepareNodes(parent, sample, nodes...)
	*dst = append(*dst, prepared...)
}

func prependNodes(parent Container, dst *[]Node, nodes ...Node) {
	var sample Node
	if len(*dst) > 0 {
		sample = (*dst)[0]
	}
	prepared := prepareNodes(parent, sample, nodes...)
	*dst = append(prepared, *dst...)
	if tracked, ok := parent.(iteratorContainer); ok {
		tracked.shiftIteratorsOnInsert(0, len(prepared), true)
	}
}

func insertBefore(parent Container, dst *[]Node, target Node, nodes ...Node) error {
	index := indexNode(*dst, target)
	if index < 0 {
		return fmt.Errorf("target node not found")
	}
	prepared := prepareNodes(parent, target, nodes...)
	*dst = append((*dst)[:index], append(prepared, (*dst)[index:]...)...)
	if tracked, ok := parent.(iteratorContainer); ok {
		tracked.shiftIteratorsOnInsert(index, len(prepared), true)
	}
	return nil
}

func insertAfter(parent Container, dst *[]Node, target Node, nodes ...Node) error {
	index := indexNode(*dst, target)
	if index < 0 {
		return fmt.Errorf("target node not found")
	}
	prepared := prepareNodes(parent, target, nodes...)
	pos := index + 1
	*dst = append((*dst)[:pos], append(prepared, (*dst)[pos:]...)...)
	if tracked, ok := parent.(iteratorContainer); ok {
		tracked.shiftIteratorsOnInsert(index, len(prepared), false)
	}
	return nil
}

func removeChild(dst *[]Node, target Node) error {
	index := indexNode(*dst, target)
	if index < 0 {
		return fmt.Errorf("target node not found")
	}
	(*dst)[index].SetParent(nil)
	*dst = append((*dst)[:index], (*dst)[index+1:]...)
	return nil
}

func removeChildFrom(parent Container, dst *[]Node, target Node) error {
	index := indexNode(*dst, target)
	if index < 0 {
		return fmt.Errorf("target node not found")
	}
	(*dst)[index].SetParent(nil)
	*dst = append((*dst)[:index], (*dst)[index+1:]...)
	if tracked, ok := parent.(iteratorContainer); ok {
		tracked.shiftIteratorsOnRemove(index)
	}
	return nil
}

func prepareNodes(parent Container, sample Node, nodes ...Node) []Node {
	prepared := make([]Node, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		if currentParent := node.Parent(); currentParent != nil {
			_ = currentParent.RemoveChild(node)
		}
		if sample != nil {
			if !HasRaw(node, "before") {
				if before, ok := mutationBefore(sample); ok {
					SetRawString(node, "before", strings.Map(func(r rune) rune {
						if r == ' ' || r == '\t' || r == '\r' || r == '\n' {
							return r
						}
						return -1
					}, before))
				}
			}
		}
		node.SetParent(parent)
		prepared = append(prepared, node)
	}
	return prepared
}

// mutationBefore mirrors PostCSS's normalize(node, sample) formatting rule.
// A multiline block carries its closing newline as the best separator for a
// newly appended sibling; otherwise the sample's own leading whitespace is
// used. Empty raw whitespace is meaningful and is preserved.
func mutationBefore(sample Node) (string, bool) {
	if text, ok := LookupRawString(sample, "before"); ok {
		if text != "" {
			return text, true
		}
		if container, ok := sample.(Container); ok {
			if afterText, ok := LookupRawString(container, "after"); ok && strings.Contains(afterText, "\n") {
				return afterText, true
			}
		}
		return text, true
	}
	return "", false
}

func appendParsed(parent Container, dst *[]Node, nodes ...Node) {
	for _, node := range nodes {
		if node == nil {
			continue
		}
		if currentParent := node.Parent(); currentParent != nil {
			_ = currentParent.RemoveChild(node)
		}
		node.SetParent(parent)
		*dst = append(*dst, node)
	}
}

// AppendParsed attaches nodes during parsing. Formatting raws are already set,
// so plugin-time mutation normalization is skipped.
func AppendParsed(parent Container, nodes ...Node) {
	switch current := parent.(type) {
	case *Document:
		appendParsed(current, &current.Nodes, nodes...)
	case *Root:
		appendParsed(current, &current.Nodes, nodes...)
	case *Rule:
		appendParsed(current, &current.Nodes, nodes...)
	case *AtRule:
		appendParsed(current, &current.Nodes, nodes...)
	default:
		parent.Append(nodes...)
	}
}

func firstNode(nodes []Node) Node {
	if len(nodes) == 0 {
		return nil
	}
	return nodes[0]
}

func lastNode(nodes []Node) Node {
	if len(nodes) == 0 {
		return nil
	}
	return nodes[len(nodes)-1]
}

func removeAllChildren(parent Container, dst *[]Node) {
	for _, child := range *dst {
		child.SetParent(nil)
	}
	*dst = nil
	if tracked, ok := parent.(iteratorContainer); ok {
		tracked.resetIterators()
	}
}

func someNodes(nodes []Node, fn func(Node) bool) bool {
	for _, node := range nodes {
		if fn(node) {
			return true
		}
	}
	return false
}

func everyNodes(nodes []Node, fn func(Node) bool) bool {
	for _, node := range nodes {
		if !fn(node) {
			return false
		}
	}
	return true
}

func locateWord(node Node, word string) (sourcemap.Position, sourcemap.Position, bool) {
	location := node.Source()
	if location == nil || location.Input == nil || word == "" {
		return sourcemap.Position{}, sourcemap.Position{}, false
	}
	nodeRange := node.Range()
	if nodeRange.End < nodeRange.Start || nodeRange.Start < 0 || nodeRange.End > len(location.Input.CSS) {
		return sourcemap.Position{}, sourcemap.Position{}, false
	}
	text := location.Input.CSS[nodeRange.Start:nodeRange.End]
	index := strings.Index(text, word)
	if index < 0 {
		return sourcemap.Position{}, sourcemap.Position{}, false
	}
	start := location.Input.FromOffset(nodeRange.Start + index)
	end := location.Input.FromOffset(nodeRange.Start + index + len(word))
	return start, end, true
}

func locateIndex(node Node, index, endIndex int) (sourcemap.Position, sourcemap.Position, bool) {
	location := node.Source()
	if location == nil || location.Input == nil {
		return sourcemap.Position{}, sourcemap.Position{}, false
	}
	nodeRange := node.Range()
	if index < 0 {
		index = 0
	}
	if endIndex < index {
		endIndex = index
	}
	startOffset := nodeRange.Start + index
	endOffset := nodeRange.Start + endIndex + 1
	if startOffset > nodeRange.End {
		startOffset = nodeRange.End
	}
	if endOffset > nodeRange.End {
		endOffset = nodeRange.End
	}
	start := location.Input.FromOffset(startOffset)
	end := location.Input.FromOffset(endOffset)
	return start, end, true
}

func indexNode(nodes []Node, target Node) int {
	for index, node := range nodes {
		if node == target {
			return index
		}
	}
	return -1
}
