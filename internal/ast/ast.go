package ast

import (
	"fmt"
	"strings"

	"postcss-go/internal/source"
)

type NodeType string

const (
	NodeRoot    NodeType = "root"
	NodeRule    NodeType = "rule"
	NodeAtRule  NodeType = "atrule"
	NodeDecl    NodeType = "decl"
	NodeComment NodeType = "comment"
)

type SourceRange struct {
	Start int
	End   int
}

type Node interface {
	Type() NodeType
	Parent() Container
	SetParent(Container)
	Range() SourceRange
	SetRange(SourceRange)
	Source() *source.Location
	SetSource(*source.Location)
	Root() *Root
	Next() Node
	Prev() Node
	Remove() Node
	ReplaceWith(...Node) error
	Clone() Node
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
}

type BaseNode struct {
	parent Container
	rng    SourceRange
	src    *source.Location
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

func (n *BaseNode) Source() *source.Location {
	return n.src
}

func (n *BaseNode) SetSource(src *source.Location) {
	n.src = src
}

type Root struct {
	BaseNode
	Nodes []Node
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
	return removeChild(&r.Nodes, target)
}

func (r *Root) Index(target Node) int {
	return indexNode(r.Nodes, target)
}

func (r *Root) Root() *Root                     { return r }
func (r *Root) Next() Node                      { return nextNode(r) }
func (r *Root) Prev() Node                      { return prevNode(r) }
func (r *Root) Remove() Node                    { return removeNode(r) }
func (r *Root) ReplaceWith(nodes ...Node) error { return replaceNode(r, nodes...) }
func (r *Root) Clone() Node                     { return cloneNode(r) }

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
	return removeChild(&r.Nodes, target)
}

func (r *Rule) Index(target Node) int {
	return indexNode(r.Nodes, target)
}

func (r *Rule) Root() *Root                     { return rootOf(r) }
func (r *Rule) Next() Node                      { return nextNode(r) }
func (r *Rule) Prev() Node                      { return prevNode(r) }
func (r *Rule) Remove() Node                    { return removeNode(r) }
func (r *Rule) ReplaceWith(nodes ...Node) error { return replaceNode(r, nodes...) }
func (r *Rule) Clone() Node                     { return cloneNode(r) }

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
	return removeChild(&r.Nodes, target)
}

func (r *AtRule) Index(target Node) int {
	return indexNode(r.Nodes, target)
}

func (r *AtRule) Root() *Root                     { return rootOf(r) }
func (r *AtRule) Next() Node                      { return nextNode(r) }
func (r *AtRule) Prev() Node                      { return prevNode(r) }
func (r *AtRule) Remove() Node                    { return removeNode(r) }
func (r *AtRule) ReplaceWith(nodes ...Node) error { return replaceNode(r, nodes...) }
func (r *AtRule) Clone() Node                     { return cloneNode(r) }

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
func (d *Declaration) Root() *Root                     { return rootOf(d) }
func (d *Declaration) Next() Node                      { return nextNode(d) }
func (d *Declaration) Prev() Node                      { return prevNode(d) }
func (d *Declaration) Remove() Node                    { return removeNode(d) }
func (d *Declaration) ReplaceWith(nodes ...Node) error { return replaceNode(d, nodes...) }
func (d *Declaration) Clone() Node                     { return cloneNode(d) }

func (d *Declaration) Variable() bool {
	return strings.HasPrefix(d.Prop, "--") || strings.HasPrefix(d.Prop, "$")
}

type Comment struct {
	BaseNode
	Text string
}

func NewComment(text string) *Comment { return &Comment{Text: text} }

func (c *Comment) Type() NodeType                  { return NodeComment }
func (c *Comment) Root() *Root                     { return rootOf(c) }
func (c *Comment) Next() Node                      { return nextNode(c) }
func (c *Comment) Prev() Node                      { return prevNode(c) }
func (c *Comment) Remove() Node                    { return removeNode(c) }
func (c *Comment) ReplaceWith(nodes ...Node) error { return replaceNode(c, nodes...) }
func (c *Comment) Clone() Node                     { return cloneNode(c) }

func cloneNode(node Node) Node {
	switch current := node.(type) {
	case *Root:
		out := NewRoot()
		out.rng = current.rng
		out.src = current.src
		for _, child := range current.Nodes {
			out.Append(cloneNode(child))
		}
		return out
	case *Rule:
		out := NewRule(current.Selector)
		out.rng = current.rng
		out.src = current.src
		for _, child := range current.Nodes {
			out.Append(cloneNode(child))
		}
		return out
	case *AtRule:
		out := NewAtRule(current.Name, current.Params)
		out.Block = current.Block
		out.rng = current.rng
		out.src = current.src
		for _, child := range current.Nodes {
			out.Append(cloneNode(child))
		}
		return out
	case *Declaration:
		out := NewDeclaration(current.Prop, current.Value)
		out.Important = current.Important
		out.rng = current.rng
		out.src = current.src
		return out
	case *Comment:
		out := NewComment(current.Text)
		out.rng = current.rng
		out.src = current.src
		return out
	default:
		return nil
	}
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

func rootOf(node Node) *Root {
	current := node
	for current != nil && current.Parent() != nil {
		current = current.Parent()
	}
	root, _ := current.(*Root)
	return root
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

func replaceNode(node Node, nodes ...Node) error {
	if node == nil || node.Parent() == nil {
		return nil
	}
	parent := node.Parent()
	if err := parent.InsertBefore(node, nodes...); err != nil {
		return err
	}
	return parent.RemoveChild(node)
}

func appendNodes(parent Container, dst *[]Node, nodes ...Node) {
	for _, node := range nodes {
		if node == nil {
			continue
		}
		node.SetParent(parent)
		*dst = append(*dst, node)
	}
}

func prependNodes(parent Container, dst *[]Node, nodes ...Node) {
	prepared := make([]Node, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		node.SetParent(parent)
		prepared = append(prepared, node)
	}
	*dst = append(prepared, *dst...)
}

func insertBefore(parent Container, dst *[]Node, target Node, nodes ...Node) error {
	index := indexNode(*dst, target)
	if index < 0 {
		return fmt.Errorf("target node not found")
	}
	prepared := make([]Node, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		node.SetParent(parent)
		prepared = append(prepared, node)
	}
	*dst = append((*dst)[:index], append(prepared, (*dst)[index:]...)...)
	return nil
}

func insertAfter(parent Container, dst *[]Node, target Node, nodes ...Node) error {
	index := indexNode(*dst, target)
	if index < 0 {
		return fmt.Errorf("target node not found")
	}
	prepared := make([]Node, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		node.SetParent(parent)
		prepared = append(prepared, node)
	}
	pos := index + 1
	*dst = append((*dst)[:pos], append(prepared, (*dst)[pos:]...)...)
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

func indexNode(nodes []Node, target Node) int {
	for index, node := range nodes {
		if node == target {
			return index
		}
	}
	return -1
}
