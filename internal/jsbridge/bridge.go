package jsbridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/postcss-go/postcss-go/internal/ast"
	postcss "github.com/postcss-go/postcss-go/internal/postcss"
	"github.com/postcss-go/postcss-go/internal/stringifier"
)

type Request struct {
	Command string      `json:"command"`
	CSS     string      `json:"css,omitempty"`
	AST     *NodeDTO    `json:"ast,omitempty"`
	Options RequestOpts `json:"options,omitempty"`
}

type RequestOpts = postcss.ProcessOptions

type Response struct {
	OK       bool         `json:"ok"`
	CSS      string       `json:"css,omitempty"`
	Map      string       `json:"map,omitempty"`
	MapFile  string       `json:"mapFile,omitempty"`
	Root     *NodeDTO     `json:"root,omitempty"`
	Messages []WarningDTO `json:"messages,omitempty"`
	Error    *ErrorDTO    `json:"error,omitempty"`
}

type ErrorDTO struct {
	Code      int            `json:"code"`
	Message   string         `json:"message"`
	Name      string         `json:"name,omitempty"`
	Reason    string         `json:"reason,omitempty"`
	Line      int            `json:"line,omitempty"`
	Column    int            `json:"column,omitempty"`
	EndLine   int            `json:"endLine,omitempty"`
	EndColumn int            `json:"endColumn,omitempty"`
	Source    string         `json:"source,omitempty"`
	File      string         `json:"file,omitempty"`
	Plugin    string         `json:"plugin,omitempty"`
	Input     *ErrorInputDTO `json:"input,omitempty"`
}

type ErrorInputDTO struct {
	Source           string `json:"source,omitempty"`
	File             string `json:"file,omitempty"`
	Line             int    `json:"line"`
	Column           int    `json:"column"`
	Offset           int    `json:"offset"`
	SourceMapPresent bool   `json:"sourceMapPresent,omitempty"`
}

type WarningDTO struct {
	Type   string `json:"type"`
	Text   string `json:"text"`
	Plugin string `json:"plugin,omitempty"`
}

type NodeDTO struct {
	Type      string             `json:"type"`
	Selector  string             `json:"selector,omitempty"`
	Name      string             `json:"name,omitempty"`
	Params    string             `json:"params,omitempty"`
	Block     bool               `json:"block,omitempty"`
	Prop      string             `json:"prop,omitempty"`
	Value     string             `json:"value,omitempty"`
	Important bool               `json:"important,omitempty"`
	Text      string             `json:"text"`
	Nodes     []*NodeDTO         `json:"nodes,omitempty"`
	Source    *SourceLocationDTO `json:"source,omitempty"`
	Raws      ast.Raws           `json:"raws,omitempty"`
}

type SourcePositionDTO struct {
	Line   int `json:"line"`
	Column int `json:"column"`
	Offset int `json:"offset"`
}

type SourceLocationDTO struct {
	Start  SourcePositionDTO `json:"start"`
	End    SourcePositionDTO `json:"end"`
	File   string            `json:"file,omitempty"`
	CSS    string            `json:"css,omitempty"`
	Map    string            `json:"map,omitempty"`
	MapURL string            `json:"mapUrl,omitempty"`
}

type ParseParams struct {
	CSS     string      `json:"css"`
	Options RequestOpts `json:"options,omitempty"`
}

type ParseResult struct {
	Root *NodeDTO `json:"root"`
}

type ProcessParams struct {
	CSS     string      `json:"css"`
	Options RequestOpts `json:"options,omitempty"`
}

type ProcessResult struct {
	CSS      string       `json:"css"`
	Map      string       `json:"map,omitempty"`
	MapFile  string       `json:"mapFile,omitempty"`
	Root     *NodeDTO     `json:"root"`
	Messages []WarningDTO `json:"messages,omitempty"`
}

type NoWorkParams = ProcessParams

type NoWorkResult struct {
	CSS     string `json:"css"`
	Map     string `json:"map,omitempty"`
	MapFile string `json:"mapFile,omitempty"`
}

type StringifyParams struct {
	AST     *NodeDTO      `json:"ast"`
	FlatAST []FlatNodeDTO `json:"flatAst,omitempty"`
	Builder bool          `json:"builder,omitempty"`
	Options RequestOpts   `json:"options,omitempty"`
}

type FlatNodeDTO struct {
	Node       *NodeDTO `json:"node"`
	ChildCount int      `json:"childCount"`
}

type StringifyResult struct {
	CSS     string                    `json:"css"`
	Map     string                    `json:"map,omitempty"`
	MapFile string                    `json:"mapFile,omitempty"`
	Parts   []stringifier.BuilderPart `json:"parts"`
}

func Execute(req Request) Response {
	switch req.Command {
	case "parse":
		result, err := ParseRPC(context.Background(), ParseParams{CSS: req.CSS, Options: req.Options})
		if err != nil {
			return errorResponse(err)
		}
		return Response{OK: true, Root: result.Root}
	case "process":
		result, err := ProcessRPC(context.Background(), ProcessParams{CSS: req.CSS, Options: req.Options})
		if err != nil {
			return errorResponse(err)
		}
		return Response{OK: true, CSS: result.CSS, Map: result.Map, MapFile: result.MapFile, Root: result.Root, Messages: result.Messages}
	case "noWork":
		result, err := NoWorkRPC(context.Background(), NoWorkParams{CSS: req.CSS, Options: req.Options})
		if err != nil {
			return errorResponse(err)
		}
		return Response{OK: true, CSS: result.CSS, Map: result.Map, MapFile: result.MapFile}
	case "stringify":
		result, err := StringifyRPC(context.Background(), StringifyParams{AST: req.AST, Options: req.Options})
		if err != nil {
			return errorResponse(err)
		}
		return Response{OK: true, CSS: result.CSS, Map: result.Map, MapFile: result.MapFile}
	default:
		return errorResponse(fmt.Errorf("unsupported command %q", req.Command))
	}
}

func ParseRPC(_ context.Context, params ParseParams) (*ParseResult, error) {
	root, err := postcss.ParseWithOptions(params.CSS, postcss.ParseOptions{
		From:         params.Options.From,
		SourceMap:    []byte(params.Options.PreviousMap),
		SourceMapURL: params.Options.PreviousMapURL,
		TrackSource:  true,
	})
	if err != nil {
		return nil, err
	}
	dto, err := ToDTO(root)
	if err != nil {
		return nil, err
	}
	return &ParseResult{Root: dto}, nil
}

func ProcessRPC(_ context.Context, params ProcessParams) (*ProcessResult, error) {
	result, err := postcss.New().Process(params.CSS, params.Options)
	if err != nil {
		return nil, err
	}
	dto, err := ToDTO(result.Root)
	if err != nil {
		return nil, err
	}
	return &ProcessResult{
		CSS:      result.CSS,
		Map:      result.Map,
		MapFile:  result.MapFile,
		Root:     dto,
		Messages: warningsToDTO(result.Messages),
	}, nil
}

func NoWorkRPC(_ context.Context, params NoWorkParams) (*NoWorkResult, error) {
	result, err := postcss.NoWork(params.CSS, params.Options)
	if err != nil {
		return nil, err
	}
	return &NoWorkResult{CSS: result.CSS, Map: result.Map, MapFile: result.MapFile}, nil
}

func StringifyRPC(_ context.Context, params StringifyParams) (*StringifyResult, error) {
	var node ast.Node
	var err error
	if len(params.FlatAST) > 0 {
		node, err = FromFlatDTO(params.FlatAST)
	} else if params.AST != nil {
		node, err = FromDTO(params.AST)
	} else {
		return nil, fmt.Errorf("missing ast payload")
	}
	if err != nil {
		return nil, err
	}
	stringified, err := postcss.StringifyWithOptions(node, params.Options)
	if err != nil {
		return nil, err
	}
	result := &StringifyResult{
		CSS:     stringified.CSS,
		Map:     stringified.Map,
		MapFile: stringified.MapFile,
	}
	if params.Builder {
		result.Parts = stringifier.StringifyWithBuilder(node)
	}
	return result, nil
}

func ToJSON(resp Response) ([]byte, error) {
	return json.Marshal(resp)
}

func ToDTO(node ast.Node) (*NodeDTO, error) {
	return toDTO(node, true)
}

// SourceToBridgeDTO applies the PostCSS-facing source-column adjustments used by
// ToDTO. The binary codec calls this while walking a live AST so it can skip
// allocating an intermediate NodeDTO tree.
func SourceToBridgeDTO(
	loc *postcss.SourceLocation,
	nodeEnd, block, preserveEndColumn, includeInput bool,
) *SourceLocationDTO {
	var dto SourceLocationDTO
	if !FillSourceDTO(&dto, loc, nodeEnd, block, preserveEndColumn, includeInput) {
		return nil
	}
	return &dto
}

// RuleSourceToBridgeDTO reports a rule's own-semicolon end the way PostCSS
// does: line/column on the semicolon character, offset one past it. The parser
// may include a following line break in the recorded end offset; walk that
// back so neither column nor offset consumes the newline.
func RuleSourceToBridgeDTO(
	loc *postcss.SourceLocation,
	hasOwnSemicolon, includeInput bool,
) *SourceLocationDTO {
	if !hasOwnSemicolon {
		return sourceToDTO(loc, true, true, false, includeInput)
	}
	dto := sourceToDTO(loc, false, false, false, includeInput)
	if dto == nil {
		return nil
	}
	if loc.Input == nil || len(loc.Input.CSS) == 0 || dto.End.Offset <= dto.Start.Offset {
		if dto.End.Column > 1 {
			dto.End.Column--
		}
		return dto
	}
	offset := min(dto.End.Offset-1, len(loc.Input.CSS)-1)
	for offset > dto.Start.Offset && (loc.Input.CSS[offset] == '\n' || loc.Input.CSS[offset] == '\r') {
		offset--
	}
	position := loc.Input.FromOffset(offset)
	dto.End.Line = position.Line
	dto.End.Column = position.Column
	dto.End.Offset = offset + 1
	return dto
}

// FillSourceDTO writes PostCSS-facing source-column adjustments into dst without
// allocating a DTO. It reports false when loc is nil.
func FillSourceDTO(
	dst *SourceLocationDTO,
	loc *postcss.SourceLocation,
	nodeEnd, block, preserveEndColumn, includeInput bool,
) bool {
	if loc == nil {
		return false
	}
	sourceToDTOInto(dst, loc, nodeEnd, block, preserveEndColumn, includeInput)
	return true
}

// SourceFromBridgeDTO rebuilds a Go source location from a bridge DTO, sharing
// inherited input across siblings the same way FromDTO does.
func SourceFromBridgeDTO(
	loc *SourceLocationDTO,
	inheritedInput *postcss.Input,
) (*postcss.Input, *postcss.SourceLocation, error) {
	return sourceFromDTO(loc, inheritedInput)
}

func toDTO(node ast.Node, includeInput bool) (*NodeDTO, error) {
	switch current := node.(type) {
	case *ast.Document:
		nodes, err := childrenToDTO(current.Children(), false)
		if err != nil {
			return nil, err
		}
		return &NodeDTO{Type: string(ast.NodeDocument), Nodes: nodes, Source: sourceToDTO(current.Source(), false, false, false, includeInput), Raws: ast.CloneRaws(current.RawFormattingReadOnly())}, nil
	case *ast.Root:
		nodes, err := childrenToDTO(current.Children(), false)
		if err != nil {
			return nil, err
		}
		return &NodeDTO{Type: string(ast.NodeRoot), Nodes: nodes, Source: sourceToDTO(current.Source(), false, false, false, includeInput), Raws: ast.CloneRaws(current.RawFormattingReadOnly())}, nil
	case *ast.Rule:
		nodes, err := childrenToDTO(current.Children(), false)
		if err != nil {
			return nil, err
		}
		ownSemicolon, _ := current.RawFormattingReadOnly()["ownSemicolon"].(string)
		ruleSource := RuleSourceToBridgeDTO(current.Source(), ownSemicolon != "", includeInput)
		return &NodeDTO{
			Type:     string(ast.NodeRule),
			Selector: current.Selector,
			Nodes:    nodes,
			Source:   ruleSource,
			Raws:     ast.CloneRaws(current.RawFormattingReadOnly()),
		}, nil
	case *ast.AtRule:
		nodes, err := childrenToDTO(current.Children(), false)
		if err != nil {
			return nil, err
		}
		return &NodeDTO{
			Type:   string(ast.NodeAtRule),
			Name:   current.Name,
			Params: current.Params,
			Block:  current.Block,
			Nodes:  nodes,
			Source: sourceToDTO(current.Source(), true, current.Block, false, includeInput),
			Raws:   ast.CloneRaws(current.RawFormattingReadOnly()),
		}, nil
	case *ast.Declaration:
		return &NodeDTO{
			Type:      string(ast.NodeDecl),
			Prop:      current.Prop,
			Value:     current.Value,
			Important: current.Important,
			Source:    sourceToDTO(current.Source(), true, false, false, includeInput),
			Raws:      ast.CloneRaws(current.RawFormattingReadOnly()),
		}, nil
	case *ast.Comment:
		preserveEndColumn := current.Source() != nil && current.Source().Input != nil && current.Source().Input.HasSourceMap()
		commentSource := sourceToDTO(current.Source(), true, false, preserveEndColumn, includeInput)
		return &NodeDTO{
			Type:   string(ast.NodeComment),
			Text:   current.Text,
			Source: commentSource,
			Raws:   ast.CloneRaws(current.RawFormattingReadOnly()),
		}, nil
	default:
		return nil, fmt.Errorf("unsupported node type %T", node)
	}
}

func FromDTO(dto *NodeDTO) (ast.Node, error) {
	return fromDTO(dto, nil)
}

// FromFlatDTO rebuilds a preorder AST without recursive JSON nesting. The
// compatibility bridge uses this form so deeply nested, valid PostCSS trees do
// not hit encoding/json's maximum nesting depth.
func FromFlatDTO(nodes []FlatNodeDTO) (ast.Node, error) {
	if len(nodes) == 0 || nodes[0].Node == nil {
		return nil, fmt.Errorf("empty flat ast")
	}
	root, err := fromDTO(nodes[0].Node, nil)
	if err != nil {
		return nil, err
	}
	type frame struct {
		container ast.Container
		input     *postcss.Input
		remaining int
	}
	stack := make([]frame, 0, 32)
	if nodes[0].ChildCount > 0 {
		container, ok := root.(ast.Container)
		if !ok {
			return nil, fmt.Errorf("flat ast node %q cannot have children", nodes[0].Node.Type)
		}
		stack = append(stack, frame{container: container, input: sourceInput(root, nil), remaining: nodes[0].ChildCount})
	}

	for index := 1; index < len(nodes); index++ {
		for len(stack) > 0 && stack[len(stack)-1].remaining == 0 {
			stack = stack[:len(stack)-1]
		}
		if len(stack) == 0 {
			return nil, fmt.Errorf("flat ast has an unexpected node at index %d", index)
		}
		entry := nodes[index]
		if entry.Node == nil || entry.ChildCount < 0 {
			return nil, fmt.Errorf("invalid flat ast node at index %d", index)
		}
		parent := &stack[len(stack)-1]
		child, childErr := fromDTO(entry.Node, parent.input)
		if childErr != nil {
			return nil, childErr
		}
		ast.AppendParsed(parent.container, child)
		parent.remaining--
		if entry.ChildCount > 0 {
			container, ok := child.(ast.Container)
			if !ok {
				return nil, fmt.Errorf("flat ast node %q cannot have children", entry.Node.Type)
			}
			stack = append(stack, frame{container: container, input: sourceInput(child, parent.input), remaining: entry.ChildCount})
		}
	}

	for len(stack) > 0 && stack[len(stack)-1].remaining == 0 {
		stack = stack[:len(stack)-1]
	}
	if len(stack) != 0 {
		return nil, fmt.Errorf("flat ast ended before all children were provided")
	}
	return root, nil
}

func sourceInput(node ast.Node, fallback *postcss.Input) *postcss.Input {
	if source := node.Source(); source != nil && source.Input != nil {
		return source.Input
	}
	return fallback
}

func fromDTO(dto *NodeDTO, inheritedInput *postcss.Input) (ast.Node, error) {
	if dto == nil {
		return nil, fmt.Errorf("nil node dto")
	}
	switch dto.Type {
	case string(ast.NodeDocument):
		node := ast.NewDocument()
		input, source, err := sourceFromDTO(dto.Source, inheritedInput)
		if err != nil {
			return nil, err
		}
		children, err := childrenFromDTO(dto.Nodes, input)
		if err != nil {
			return nil, err
		}
		node.Append(children...)
		node.SetSource(source)
		node.Raws = ast.CloneRaws(dto.Raws)
		return node, nil
	case string(ast.NodeRoot):
		node := ast.NewRoot()
		input, source, err := sourceFromDTO(dto.Source, inheritedInput)
		if err != nil {
			return nil, err
		}
		children, err := childrenFromDTO(dto.Nodes, input)
		if err != nil {
			return nil, err
		}
		node.Append(children...)
		node.SetSource(source)
		node.Raws = ast.CloneRaws(dto.Raws)
		return node, nil
	case string(ast.NodeRule):
		node := ast.NewRule(dto.Selector)
		input, source, err := sourceFromDTO(dto.Source, inheritedInput)
		if err != nil {
			return nil, err
		}
		children, err := childrenFromDTO(dto.Nodes, input)
		if err != nil {
			return nil, err
		}
		node.Append(children...)
		node.SetSource(source)
		node.Raws = ast.CloneRaws(dto.Raws)
		return node, nil
	case string(ast.NodeAtRule):
		node := ast.NewAtRule(dto.Name, dto.Params)
		node.Block = dto.Block
		input, source, err := sourceFromDTO(dto.Source, inheritedInput)
		if err != nil {
			return nil, err
		}
		children, err := childrenFromDTO(dto.Nodes, input)
		if err != nil {
			return nil, err
		}
		node.Append(children...)
		node.SetSource(source)
		node.Raws = ast.CloneRaws(dto.Raws)
		return node, nil
	case string(ast.NodeDecl):
		node := ast.NewDeclaration(dto.Prop, dto.Value)
		node.Important = dto.Important
		_, source, err := sourceFromDTO(dto.Source, inheritedInput)
		if err != nil {
			return nil, err
		}
		node.SetSource(source)
		node.Raws = ast.CloneRaws(dto.Raws)
		return node, nil
	case string(ast.NodeComment):
		node := ast.NewComment(dto.Text)
		_, source, err := sourceFromDTO(dto.Source, inheritedInput)
		if err != nil {
			return nil, err
		}
		node.SetSource(source)
		node.Raws = ast.CloneRaws(dto.Raws)
		return node, nil
	default:
		return nil, fmt.Errorf("unsupported dto type %q", dto.Type)
	}
}

func childrenToDTO(nodes []ast.Node, includeInput bool) ([]*NodeDTO, error) {
	out := make([]*NodeDTO, 0, len(nodes))
	for _, child := range nodes {
		dto, err := toDTO(child, includeInput)
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	return out, nil
}

func childrenFromDTO(nodes []*NodeDTO, input *postcss.Input) ([]ast.Node, error) {
	out := make([]ast.Node, 0, len(nodes))
	for _, child := range nodes {
		node, err := fromDTO(child, input)
		if err != nil {
			return nil, err
		}
		out = append(out, node)
	}
	return out, nil
}

func sourceToDTO(loc *postcss.SourceLocation, nodeEnd, block, preserveEndColumn, includeInput bool) *SourceLocationDTO {
	var dto SourceLocationDTO
	if loc == nil {
		return nil
	}
	sourceToDTOInto(&dto, loc, nodeEnd, block, preserveEndColumn, includeInput)
	return &dto
}

func sourceToDTOInto(dto *SourceLocationDTO, loc *postcss.SourceLocation, nodeEnd, block, preserveEndColumn, includeInput bool) {
	*dto = SourceLocationDTO{
		Start: SourcePositionDTO{
			Line:   loc.Start.Line,
			Column: loc.Start.Column,
			Offset: loc.Start.Offset,
		},
		End: SourcePositionDTO{
			Line:   loc.End.Line,
			Column: loc.End.Column,
			Offset: loc.End.Offset,
		},
	}
	adjustedEndColumn := false
	if block && loc.Input != nil {
		if end, ok := findBlockEnd(loc.Input.CSS, loc.Start.Offset); ok {
			if end > dto.End.Offset {
				position := loc.Input.FromOffset(end)
				dto.End = SourcePositionDTO{Line: position.Line, Column: position.Column, Offset: position.Offset}
			} else if dto.End.Offset > end {
				position := loc.Input.FromOffset(dto.End.Offset - 1)
				blockEnd := loc.Input.FromOffset(end - 1)
				if preserveEndColumn {
					dto.End.Line = blockEnd.Line
					dto.End.Column = blockEnd.Column
					adjustedEndColumn = true
				} else if position.Line == blockEnd.Line {
					dto.End.Line = position.Line
					dto.End.Column = position.Column - 1
					adjustedEndColumn = true
				}
			}
		}
	}
	if loc.Input != nil {
		dto.File = loc.Input.File
		if includeInput {
			dto.CSS = loc.Input.CSS
			dto.MapURL = loc.Input.File
		}
	}
	if nodeEnd && !preserveEndColumn && !adjustedEndColumn && dto.End.Offset > dto.Start.Offset && dto.End.Column > 1 {
		dto.End.Column--
	}
}

func findBlockEnd(css string, start int) (int, bool) {
	paren, square, depth := 0, 0, 0
	var quote byte
	for index := start; index < len(css); index++ {
		ch := css[index]
		if quote != 0 {
			if ch == '\\' {
				index++
			} else if ch == quote {
				quote = 0
			}
			continue
		}
		if ch == '\\' {
			index++
			continue
		}
		if ch == '\'' || ch == '"' {
			quote = ch
			continue
		}
		if paren == 0 && square == 0 && ch == '/' && index+1 < len(css) && css[index+1] == '*' {
			if end := strings.Index(css[index+2:], "*/"); end >= 0 {
				index += end + 3
				continue
			}
			return 0, false
		}
		switch ch {
		case '(':
			paren++
		case ')':
			if paren > 0 {
				paren--
			}
		case '[':
			square++
		case ']':
			if square > 0 {
				square--
			}
		case '{':
			if depth == 0 {
				if paren == 0 && square == 0 {
					depth = 1
				}
			} else {
				depth++
			}
		case '}':
			if depth > 0 {
				depth--
				if depth == 0 {
					return index + 1, true
				}
			}
		}
	}
	return 0, false
}

func sourceFromDTO(loc *SourceLocationDTO, inheritedInput *postcss.Input) (*postcss.Input, *postcss.SourceLocation, error) {
	if loc == nil {
		return inheritedInput, nil, nil
	}
	input := inheritedInput
	if input == nil || loc.CSS != "" || loc.Map != "" {
		var err error
		input, err = postcss.NewInput(loc.CSS, postcss.ParseOptions{
			From:         loc.File,
			SourceMap:    []byte(loc.Map),
			SourceMapURL: loc.MapURL,
		})
		if err != nil {
			return nil, nil, fmt.Errorf("decode source location input: %w", err)
		}
	}
	return input, &postcss.SourceLocation{
		Start: postcss.Position{Line: loc.Start.Line, Column: loc.Start.Column, Offset: loc.Start.Offset},
		End:   postcss.Position{Line: loc.End.Line, Column: loc.End.Column, Offset: loc.End.Offset},
		Input: input,
	}, nil
}

func warningsToDTO(warnings []postcss.Warning) []WarningDTO {
	out := make([]WarningDTO, 0, len(warnings))
	for _, warning := range warnings {
		out = append(out, WarningDTO{
			Type:   warning.Type,
			Text:   warning.Text,
			Plugin: warning.Plugin,
		})
	}
	return out
}

func errorResponse(err error) Response {
	detail := ErrorDTOFromError(err)
	return Response{OK: false, Error: detail}
}

// ErrorDTO converts errors for both JSON-RPC transports. Keeping this in the
// bridge package prevents --single and the long-lived RPC server from drifting.
func ErrorDTOFromError(err error) *ErrorDTO {
	detail := &ErrorDTO{Code: -32000, Message: err.Error()}
	var syntaxErr *postcss.CssSyntaxError
	if errors.As(err, &syntaxErr) {
		detail.Name = "CssSyntaxError"
		detail.Reason = syntaxErr.Reason
		detail.Line = syntaxErr.Line
		detail.Column = syntaxErr.Column
		detail.EndLine = syntaxErr.EndLine
		detail.EndColumn = syntaxErr.EndColumn
		detail.Source = syntaxErr.Source
		detail.File = syntaxErr.File
		detail.Plugin = syntaxErr.Plugin
		if syntaxErr.Input != nil {
			detail.Input = &ErrorInputDTO{Source: syntaxErr.Input.Source, File: syntaxErr.Input.File, Line: syntaxErr.Input.Line, Column: syntaxErr.Input.Column, Offset: syntaxErr.Input.Offset, SourceMapPresent: syntaxErr.Input.SourceMapPresent}
		}
		if syntaxErr.Input != nil && syntaxErr.Input.SourceMapPresent {
			detail.Column = max(detail.Column-1, 0)
			if detail.EndColumn > 0 {
				detail.EndColumn = max(detail.EndColumn-1, 0)
			}
		}
	}
	return detail
}
