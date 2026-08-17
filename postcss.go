// Package postcss exposes the public Go API for the postcss-go CSS pipeline.
package postcss

import internal "postcss-go/internal/postcss"

type Node = internal.Node
type Container = internal.Container
type NodeType = internal.NodeType
type SourceRange = internal.SourceRange
type Raws = internal.Raws
type RawValue = internal.RawValue
type Position = internal.Position
type SourceLocation = internal.SourceLocation

const (
	NodeRoot     = internal.NodeRoot
	NodeDocument = internal.NodeDocument
	NodeRule     = internal.NodeRule
	NodeAtRule   = internal.NodeAtRule
	NodeDecl     = internal.NodeDecl
	NodeComment  = internal.NodeComment
)

type Root = internal.Root
type Document = internal.Document
type Rule = internal.Rule
type AtRule = internal.AtRule
type Declaration = internal.Declaration
type Comment = internal.Comment

type ProcessOptions = internal.ProcessOptions
type ParseOptions = internal.ParseOptions
type ErrorOptions = internal.ErrorOptions
type Processor = internal.Processor
type Plugin = internal.Plugin
type Visitor = internal.Visitor
type Result = internal.Result
type Warning = internal.Warning
type CssSyntaxError = internal.CssSyntaxError
type Input = internal.Input

func New(plugins ...Plugin) *Processor { return internal.New(plugins...) }

func NoWork(css string, opts ProcessOptions) (*Result, error) {
	return internal.NoWork(css, opts)
}

func StringifyWithOptions(node Node, opts ProcessOptions) (*Result, error) {
	return internal.StringifyWithOptions(node, opts)
}

func Parse(css string) (*Root, error) { return internal.Parse(css) }

func ParseWithOptions(css string, opts ParseOptions) (*Root, error) {
	return internal.ParseWithOptions(css, opts)
}

func Stringify(node Node) string { return internal.Stringify(node) }

func NewRoot() *Root { return internal.NewRoot() }

func NewDocument() *Document { return internal.NewDocument() }

func NewRule(selector string) *Rule { return internal.NewRule(selector) }

func NewAtRule(name, params string) *AtRule { return internal.NewAtRule(name, params) }

func NewDeclaration(prop, value string) *Declaration {
	return internal.NewDeclaration(prop, value)
}

func NewComment(text string) *Comment { return internal.NewComment(text) }

func NewInput(css string, opts ParseOptions) (*Input, error) {
	return internal.NewInput(css, opts)
}

func Walk(node Node, fn func(Node) error) error { return internal.Walk(node, fn) }

func WalkRules(node Node, filtersAndFn ...any) error {
	return internal.WalkRules(node, filtersAndFn...)
}

func WalkAtRules(node Node, filtersAndFn ...any) error {
	return internal.WalkAtRules(node, filtersAndFn...)
}

func WalkDecls(node Node, filtersAndFn ...any) error {
	return internal.WalkDecls(node, filtersAndFn...)
}

func WalkComments(node Node, fn func(*Comment) error) error {
	return internal.WalkComments(node, fn)
}
