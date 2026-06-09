package jsbridge

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/creachadair/jrpc2/handler"
	"postcss-go/internal/ast"
	postcss "postcss-go/internal/postcss"
)

type Request struct {
	Command string      `json:"command"`
	CSS     string      `json:"css,omitempty"`
	AST     *NodeDTO    `json:"ast,omitempty"`
	Options RequestOpts `json:"options,omitempty"`
}

type RequestOpts struct {
	From string `json:"from,omitempty"`
}

type Response struct {
	OK       bool         `json:"ok"`
	CSS      string       `json:"css,omitempty"`
	Root     *NodeDTO     `json:"root,omitempty"`
	Messages []WarningDTO `json:"messages,omitempty"`
	Error    *ErrorDTO    `json:"error,omitempty"`
}

type ErrorDTO struct {
	Message string `json:"message"`
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
	Text      string             `json:"text,omitempty"`
	Nodes     []*NodeDTO         `json:"nodes,omitempty"`
	Source    *SourceLocationDTO `json:"source,omitempty"`
}

type SourcePositionDTO struct {
	Line   int `json:"line"`
	Column int `json:"column"`
	Offset int `json:"offset"`
}

type SourceLocationDTO struct {
	Start SourcePositionDTO `json:"start"`
	End   SourcePositionDTO `json:"end"`
	File  string            `json:"file,omitempty"`
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
	Root     *NodeDTO     `json:"root"`
	Messages []WarningDTO `json:"messages,omitempty"`
}

type StringifyParams struct {
	AST *NodeDTO `json:"ast"`
}

type StringifyResult struct {
	CSS string `json:"css"`
}

func Assigner() handler.Map {
	assigner := handler.Map{
		"parse":     handler.New(ParseRPC),
		"process":   handler.New(ProcessRPC),
		"stringify": handler.New(StringifyRPC),
	}
	for method, rpc := range tokenizeAssigner() {
		assigner[method] = rpc
	}
	return assigner
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
		return Response{OK: true, CSS: result.CSS, Root: result.Root, Messages: result.Messages}
	case "stringify":
		result, err := StringifyRPC(context.Background(), StringifyParams{AST: req.AST})
		if err != nil {
			return errorResponse(err)
		}
		return Response{OK: true, CSS: result.CSS}
	default:
		return errorResponse(fmt.Errorf("unsupported command %q", req.Command))
	}
}

func ParseRPC(_ context.Context, params ParseParams) (*ParseResult, error) {
	root, err := postcss.ParseWithOptions(params.CSS, postcss.ParseOptions{From: params.Options.From})
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
	result, err := postcss.New().Process(params.CSS, postcss.ProcessOptions{From: params.Options.From})
	if err != nil {
		return nil, err
	}
	dto, err := ToDTO(result.Root)
	if err != nil {
		return nil, err
	}
	return &ProcessResult{
		CSS:      result.CSS,
		Root:     dto,
		Messages: warningsToDTO(result.Messages),
	}, nil
}

func StringifyRPC(_ context.Context, params StringifyParams) (*StringifyResult, error) {
	if params.AST == nil {
		return nil, fmt.Errorf("missing ast payload")
	}
	node, err := FromDTO(params.AST)
	if err != nil {
		return nil, err
	}
	return &StringifyResult{CSS: postcss.Stringify(node)}, nil
}

func ToJSON(resp Response) ([]byte, error) {
	return json.Marshal(resp)
}

func ToDTO(node ast.Node) (*NodeDTO, error) {
	switch current := node.(type) {
	case *ast.Root:
		nodes, err := childrenToDTO(current.Children())
		if err != nil {
			return nil, err
		}
		return &NodeDTO{Type: string(ast.NodeRoot), Nodes: nodes, Source: sourceToDTO(current.Source())}, nil
	case *ast.Rule:
		nodes, err := childrenToDTO(current.Children())
		if err != nil {
			return nil, err
		}
		return &NodeDTO{
			Type:     string(ast.NodeRule),
			Selector: current.Selector,
			Nodes:    nodes,
			Source:   sourceToDTO(current.Source()),
		}, nil
	case *ast.AtRule:
		nodes, err := childrenToDTO(current.Children())
		if err != nil {
			return nil, err
		}
		return &NodeDTO{
			Type:   string(ast.NodeAtRule),
			Name:   current.Name,
			Params: current.Params,
			Block:  current.Block,
			Nodes:  nodes,
			Source: sourceToDTO(current.Source()),
		}, nil
	case *ast.Declaration:
		return &NodeDTO{
			Type:      string(ast.NodeDecl),
			Prop:      current.Prop,
			Value:     current.Value,
			Important: current.Important,
			Source:    sourceToDTO(current.Source()),
		}, nil
	case *ast.Comment:
		return &NodeDTO{
			Type:   string(ast.NodeComment),
			Text:   current.Text,
			Source: sourceToDTO(current.Source()),
		}, nil
	default:
		return nil, fmt.Errorf("unsupported node type %T", node)
	}
}

func FromDTO(dto *NodeDTO) (ast.Node, error) {
	switch dto.Type {
	case string(ast.NodeRoot):
		node := ast.NewRoot()
		children, err := childrenFromDTO(dto.Nodes)
		if err != nil {
			return nil, err
		}
		node.Append(children...)
		node.SetSource(sourceFromDTO(dto.Source))
		return node, nil
	case string(ast.NodeRule):
		node := ast.NewRule(dto.Selector)
		children, err := childrenFromDTO(dto.Nodes)
		if err != nil {
			return nil, err
		}
		node.Append(children...)
		node.SetSource(sourceFromDTO(dto.Source))
		return node, nil
	case string(ast.NodeAtRule):
		node := ast.NewAtRule(dto.Name, dto.Params)
		node.Block = dto.Block
		children, err := childrenFromDTO(dto.Nodes)
		if err != nil {
			return nil, err
		}
		node.Append(children...)
		node.SetSource(sourceFromDTO(dto.Source))
		return node, nil
	case string(ast.NodeDecl):
		node := ast.NewDeclaration(dto.Prop, dto.Value)
		node.Important = dto.Important
		node.SetSource(sourceFromDTO(dto.Source))
		return node, nil
	case string(ast.NodeComment):
		node := ast.NewComment(dto.Text)
		node.SetSource(sourceFromDTO(dto.Source))
		return node, nil
	default:
		return nil, fmt.Errorf("unsupported dto type %q", dto.Type)
	}
}

func childrenToDTO(nodes []ast.Node) ([]*NodeDTO, error) {
	out := make([]*NodeDTO, 0, len(nodes))
	for _, child := range nodes {
		dto, err := ToDTO(child)
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	return out, nil
}

func childrenFromDTO(nodes []*NodeDTO) ([]ast.Node, error) {
	out := make([]ast.Node, 0, len(nodes))
	for _, child := range nodes {
		node, err := FromDTO(child)
		if err != nil {
			return nil, err
		}
		out = append(out, node)
	}
	return out, nil
}

func sourceToDTO(loc *postcss.SourceLocation) *SourceLocationDTO {
	if loc == nil {
		return nil
	}
	dto := &SourceLocationDTO{
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
	if loc.Input != nil {
		dto.File = loc.Input.File
	}
	return dto
}

func sourceFromDTO(loc *SourceLocationDTO) *postcss.SourceLocation {
	if loc == nil {
		return nil
	}
	input, _ := postcss.NewInput("", postcss.ParseOptions{From: loc.File})
	return &postcss.SourceLocation{
		Start: postcss.Position{Line: loc.Start.Line, Column: loc.Start.Column, Offset: loc.Start.Offset},
		End:   postcss.Position{Line: loc.End.Line, Column: loc.End.Column, Offset: loc.End.Offset},
		Input: input,
	}
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
	return Response{
		OK:    false,
		Error: &ErrorDTO{Message: err.Error()},
	}
}
