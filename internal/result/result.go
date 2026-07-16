package result

import (
	"fmt"
	"strings"

	"postcss-go/internal/ast"
	"postcss-go/internal/source"
)

type Warning struct {
	Type      string
	Text      string
	Plugin    string
	Node      ast.Node
	Index     int
	EndIndex  int
	Word      string
	Line      int
	Column    int
	EndLine   int
	EndColumn int
}

type WarnOptions struct {
	Node     ast.Node
	Plugin   string
	Index    int
	EndIndex int
	Word     string
	Start    *source.Position
	End      *source.Position
}

type Result struct {
	Root       *ast.Root
	CSS        string
	Map        string
	Messages   []Warning
	LastPlugin string
}

func (r *Result) Warn(text string, optsList ...WarnOptions) Warning {
	var opts WarnOptions
	if len(optsList) > 0 {
		opts = optsList[0]
	}
	plugin := opts.Plugin
	if plugin == "" {
		plugin = r.LastPlugin
	}
	warning := Warning{
		Type:     "warning",
		Text:     text,
		Plugin:   plugin,
		Node:     opts.Node,
		Index:    opts.Index,
		EndIndex: opts.EndIndex,
		Word:     opts.Word,
	}
	applyWarningPosition(&warning, opts)
	r.Messages = append(r.Messages, warning)
	return warning
}

func (r *Result) Warnings() []Warning {
	out := make([]Warning, 0, len(r.Messages))
	for _, warning := range r.Messages {
		if warning.Type == "warning" {
			out = append(out, warning)
		}
	}
	return out
}

func (r *Result) String() string {
	return r.CSS
}

func (w Warning) String() string {
	if w.Line > 0 && w.Column > 0 {
		var builder strings.Builder
		if w.Plugin != "" {
			builder.WriteString(w.Plugin)
			builder.WriteString(": ")
		}
		if w.Node != nil && w.Node.Source() != nil && w.Node.Source().Input != nil {
			builder.WriteString(w.Node.Source().Input.From())
		} else {
			builder.WriteString("<css input>")
		}
		builder.WriteString(fmt.Sprintf(":%d:%d: %s", w.Line, w.Column, w.Text))
		return builder.String()
	}
	if w.Plugin == "" {
		return w.Text
	}
	return fmt.Sprintf("%s: %s", w.Plugin, w.Text)
}

func applyWarningPosition(warning *Warning, opts WarnOptions) {
	if opts.Start != nil {
		warning.Line = opts.Start.Line
		warning.Column = opts.Start.Column
	}
	if opts.End != nil {
		warning.EndLine = opts.End.Line
		warning.EndColumn = opts.End.Column
	}
	if warning.Node == nil || warning.Node.Source() == nil || warning.Node.Source().Input == nil {
		return
	}

	location := warning.Node.Source()
	start := location.Start
	end := location.End

	if opts.Start != nil {
		start = *opts.Start
	}
	if opts.End != nil {
		end = *opts.End
	}

	if opts.Word != "" {
		if wordStart, wordEnd, ok := astLocateWord(warning.Node, opts.Word); ok {
			start = wordStart
			end = wordEnd
		}
	} else if opts.Index > 0 || opts.EndIndex > 0 {
		if indexStart, indexEnd, ok := astLocateIndex(warning.Node, opts.Index, opts.EndIndex); ok {
			start = indexStart
			end = indexEnd
		}
	}

	warning.Line = start.Line
	warning.Column = start.Column
	warning.EndLine = end.Line
	warning.EndColumn = end.Column
}

func astLocateWord(node ast.Node, word string) (source.Position, source.Position, bool) {
	location := node.Source()
	if location == nil || location.Input == nil || word == "" {
		return source.Position{}, source.Position{}, false
	}

	nodeRange := node.Range()
	if nodeRange.End < nodeRange.Start || nodeRange.Start < 0 || nodeRange.End > len(location.Input.CSS) {
		return source.Position{}, source.Position{}, false
	}
	text := location.Input.CSS[nodeRange.Start:nodeRange.End]
	index := strings.Index(text, word)
	if index < 0 {
		return source.Position{}, source.Position{}, false
	}
	start := location.Input.FromOffset(nodeRange.Start + index)
	end := location.Input.FromOffset(nodeRange.Start + index + len(word))
	return start, end, true
}

func astLocateIndex(node ast.Node, index, endIndex int) (source.Position, source.Position, bool) {
	location := node.Source()
	if location == nil || location.Input == nil {
		return source.Position{}, source.Position{}, false
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
