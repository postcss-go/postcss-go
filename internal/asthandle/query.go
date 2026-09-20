package asthandle

import (
	"encoding/json"
	"strings"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/jsbridge"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
)

type queryOptions struct {
	Index       int    `json:"index"`
	EndIndex    int    `json:"endIndex"`
	Word        string `json:"word"`
	Prop        string `json:"prop"`
	DefaultType string `json:"defaultType"`
	KeepBetween bool   `json:"keepBetween"`
	Child       uint32 `json:"child"`
	StartLine   int    `json:"startLine"`
	StartColumn int    `json:"startColumn"`
	StartOffset int    `json:"startOffset"`
	EndLine     int    `json:"endLine"`
	EndColumn   int    `json:"endColumn"`
	EndOffset   int    `json:"endOffset"`
	HasIndex    bool   `json:"hasIndex"`
	HasEndIndex bool   `json:"hasEndIndex"`
	HasStart    bool   `json:"hasStart"`
	HasEnd      bool   `json:"hasEnd"`
	HasStartOff bool   `json:"hasStartOffset"`
	HasEndOff   bool   `json:"hasEndOffset"`
}

type queryPosition struct {
	Line   int `json:"line"`
	Column int `json:"column"`
	Offset int `json:"offset"`
}

// Query runs a read-only or small-mutation node helper that used to live in TypeScript.
func (s *Session) Query(handle Handle, kind, optionsJSON string) (string, error) {
	node, err := s.lookup(handle)
	if err != nil {
		return "", err
	}
	var opts queryOptions
	if optionsJSON != "" {
		if err := json.Unmarshal([]byte(optionsJSON), &opts); err != nil {
			return "", ErrInvalidArgument
		}
	}
	switch kind {
	case "root":
		return s.encodeHandle(s.Identity(node.Root()))
	case "next":
		return s.encodeOptionalHandle(node.Next())
	case "prev":
		return s.encodeOptionalHandle(node.Prev())
	case "index":
		parent := node.Parent()
		if parent == nil {
			return "0", nil
		}
		return jsonInt(parent.Index(node)), nil
	case "cleanRaws":
		cleanRaws(node, opts.KeepBetween)
		s.markDirty(handle)
		return "null", nil
	case "setBlock":
		if at, ok := node.(*ast.AtRule); ok {
			at.Block = true
			s.markDirty(handle)
		}
		return "null", nil
	case "raw":
		encoded, err := json.Marshal(inferRaw(node, opts.Prop, opts.DefaultType))
		if err != nil {
			return "", err
		}
		return string(encoded), nil
	case "rangeBy":
		start, end := rangeBy(node, opts)
		encoded, err := json.Marshal(map[string]queryPosition{"start": start, "end": end})
		if err != nil {
			return "", err
		}
		return string(encoded), nil
	case "positionBy":
		start, _ := positionBy(node, opts)
		encoded, err := json.Marshal(start)
		if err != nil {
			return "", err
		}
		return string(encoded), nil
	case "positionInside":
		encoded, err := json.Marshal(positionInside(node, opts.Index))
		if err != nil {
			return "", err
		}
		return string(encoded), nil
	default:
		return "", ErrInvalidArgument
	}
}

func (s *Session) encodeHandle(handle Handle) (string, error) {
	encoded, err := json.Marshal(uint32(handle))
	return string(encoded), err
}

func (s *Session) encodeOptionalHandle(node ast.Node) (string, error) {
	if node == nil {
		return "0", nil
	}
	return s.encodeHandle(s.Identity(node))
}

func jsonInt(value int) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func rangeBy(node ast.Node, opts queryOptions) (queryPosition, queryPosition) {
	start, end := defaultRange(node)
	if opts.Word != "" {
		if wordStart, wordEnd, ok := astLocateWord(node, opts.Word); ok {
			return wordStart, wordEnd
		}
	} else {
		if opts.HasStart {
			start = queryPosition{Line: opts.StartLine, Column: opts.StartColumn, Offset: opts.StartOffset}
			if !opts.HasStartOff {
				start.Offset = offsetFromLineColumn(node, opts.StartLine, opts.StartColumn)
			}
		} else if opts.HasIndex {
			start = positionInside(node, opts.Index)
		}
		if opts.HasEnd {
			end = queryPosition{Line: opts.EndLine, Column: opts.EndColumn, Offset: opts.EndOffset}
			if !opts.HasEndOff {
				end.Offset = offsetFromLineColumn(node, opts.EndLine, opts.EndColumn)
			}
		} else if opts.HasEndIndex {
			end = positionInside(node, opts.EndIndex)
		} else if opts.HasIndex {
			end = positionInside(node, opts.Index+1)
		}
	}
	if end.Line < start.Line || (end.Line == start.Line && end.Column <= start.Column) {
		end = queryPosition{Line: start.Line, Column: start.Column + 1, Offset: start.Offset + 1}
	}
	return start, end
}

func positionBy(node ast.Node, opts queryOptions) (queryPosition, queryPosition) {
	if opts.HasIndex {
		return positionInside(node, opts.Index), queryPosition{}
	}
	if opts.Word != "" {
		if located, _, ok := astLocateWord(node, opts.Word); ok {
			return located, queryPosition{}
		}
	}
	start, _ := defaultRange(node)
	return start, queryPosition{}
}

func positionInside(node ast.Node, index int) queryPosition {
	if index < 0 {
		index = 0
	}
	start, _ := defaultRange(node)
	location := node.Source()
	if location == nil || location.Input == nil {
		return queryPosition{Line: start.Line, Column: start.Column + index, Offset: start.Offset + index}
	}
	css := location.Input.CSS
	if location.Input.Document != "" {
		css = location.Input.Document
	}
	offset := start.Offset
	end := offset + index
	if end > len(css) {
		end = len(css)
	}
	if offset < 0 {
		offset = 0
	}
	line, column := start.Line, start.Column
	for i := offset; i < end && i < len(css); i++ {
		if css[i] == '\n' {
			column = 1
			line++
		} else {
			column++
		}
	}
	return queryPosition{Line: line, Column: column, Offset: end}
}

func defaultRange(node ast.Node) (queryPosition, queryPosition) {
	dto := postcssSource(node)
	if dto == nil {
		return queryPosition{Line: 1, Column: 1, Offset: 0}, queryPosition{Line: 1, Column: 2, Offset: 1}
	}
	start := queryPosition{Line: dto.Start.Line, Column: dto.Start.Column, Offset: dto.Start.Offset}
	// PostCSS rangeBy reports an exclusive end column; the DTO end is inclusive.
	end := queryPosition{Line: dto.End.Line, Column: dto.End.Column + 1, Offset: dto.End.Offset}
	return start, end
}

func postcssSource(node ast.Node) *jsbridge.SourceLocationDTO {
	switch current := node.(type) {
	case *ast.Rule:
		own, _ := ast.LookupRawString(current, "ownSemicolon")
		return jsbridge.RuleSourceToBridgeDTO(current.Source(), own != "", false)
	case *ast.AtRule:
		return jsbridge.SourceToBridgeDTO(current.Source(), true, current.Block, false, false)
	default:
		return jsbridge.SourceToBridgeDTO(node.Source(), node.Type() != ast.NodeRoot && node.Type() != ast.NodeDocument, false, false, false)
	}
}

func offsetFromLineColumn(node ast.Node, line, column int) int {
	location := node.Source()
	if location == nil || location.Input == nil {
		return 0
	}
	offset, err := location.Input.FromLineAndColumn(line, column)
	if err != nil {
		return 0
	}
	return offset
}

func astLocateWord(node ast.Node, word string) (queryPosition, queryPosition, bool) {
	location := node.Source()
	if location == nil || location.Input == nil || word == "" {
		return queryPosition{}, queryPosition{}, false
	}
	nodeRange := node.Range()
	if nodeRange.End < nodeRange.Start || nodeRange.Start < 0 || nodeRange.End > len(location.Input.CSS) {
		return queryPosition{}, queryPosition{}, false
	}
	text := location.Input.CSS[nodeRange.Start:nodeRange.End]
	index := strings.Index(text, word)
	if index < 0 {
		return queryPosition{}, queryPosition{}, false
	}
	start := location.Input.FromOffset(nodeRange.Start + index)
	end := location.Input.FromOffset(nodeRange.Start + index + len(word))
	return toQueryPosition(start), toQueryPosition(end), true
}

func toQueryPosition(position sourcemap.Position) queryPosition {
	return queryPosition{Line: position.Line, Column: position.Column, Offset: position.Offset}
}

func cleanRaws(node ast.Node, keepBetween bool) {
	ast.DeleteRaw(node, "before")
	ast.DeleteRaw(node, "after")
	if !keepBetween {
		ast.DeleteRaw(node, "between")
	}
	container, ok := node.(ast.Container)
	if !ok {
		return
	}
	for _, child := range container.Children() {
		cleanRaws(child, keepBetween)
	}
}
