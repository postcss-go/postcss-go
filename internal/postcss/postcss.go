package postcss

import (
	"postcss-go/internal/ast"
	csserrors "postcss-go/internal/csserrors"
	"postcss-go/internal/parser"
	"postcss-go/internal/processor"
	"postcss-go/internal/result"
	"postcss-go/internal/source"
	"postcss-go/internal/stringifier"
)

type Node = ast.Node
type Container = ast.Container
type NodeType = ast.NodeType
type SourceRange = ast.SourceRange
type Raws = ast.Raws
type RawValue = ast.RawValue
type Position = source.Position
type SourceLocation = source.Location

const (
	NodeRoot    = ast.NodeRoot
	NodeRule    = ast.NodeRule
	NodeAtRule  = ast.NodeAtRule
	NodeDecl    = ast.NodeDecl
	NodeComment = ast.NodeComment
)

type Root = ast.Root
type Rule = ast.Rule
type AtRule = ast.AtRule
type Declaration = ast.Declaration
type Comment = ast.Comment

type ProcessOptions = processor.Options
type ParseOptions = source.Options
type ErrorOptions = ast.ErrorOptions
type Processor = processor.Processor
type Plugin = processor.Plugin
type Visitor = processor.Visitor
type Result = result.Result
type Warning = result.Warning
type CssSyntaxError = csserrors.SyntaxError
type Input = source.Input

func New(plugins ...Plugin) *Processor {
	return processor.New(plugins...)
}

func Parse(css string) (*Root, error) {
	return parser.Parse(css, source.Options{})
}

func ParseWithOptions(css string, opts ParseOptions) (*Root, error) {
	return parser.Parse(css, opts)
}

func Stringify(node Node) string {
	return stringifier.Stringify(node)
}

func NewRoot() *Root {
	return ast.NewRoot()
}

func NewRule(selector string) *Rule {
	return ast.NewRule(selector)
}

func NewAtRule(name, params string) *AtRule {
	return ast.NewAtRule(name, params)
}

func NewDeclaration(prop, value string) *Declaration {
	return ast.NewDeclaration(prop, value)
}

func NewComment(text string) *Comment {
	return ast.NewComment(text)
}

func NewInput(css string, opts ParseOptions) (*Input, error) {
	return source.NewInput(css, opts)
}

func Walk(node Node, fn func(Node) error) error {
	return ast.Walk(node, fn)
}

func WalkRules(node Node, filtersAndFn ...any) error {
	return ast.WalkRules(node, filtersAndFn...)
}

func WalkAtRules(node Node, filtersAndFn ...any) error {
	return ast.WalkAtRules(node, filtersAndFn...)
}

func WalkDecls(node Node, filtersAndFn ...any) error {
	return ast.WalkDecls(node, filtersAndFn...)
}

func WalkComments(node Node, fn func(*Comment) error) error {
	return ast.WalkComments(node, fn)
}
