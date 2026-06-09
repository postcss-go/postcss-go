package source

import (
	"fmt"
	"path/filepath"
	"strings"

	"postcss-go/internal/csserrors"
)

type Position struct {
	Line   int
	Column int
	Offset int
}

type Location struct {
	Start Position
	End   Position
	Input *Input
}

type Options struct {
	From     string
	Document string
}

type Input struct {
	CSS      string
	Document string
	File     string
	HasBOM   bool
	lineIdx  []int
}

func NewInput(css string, opts Options) (*Input, error) {
	if css == "" {
		css = ""
	}
	input := &Input{CSS: css, Document: css}
	if strings.HasPrefix(css, "\uFEFF") || strings.HasPrefix(css, "\uFFFE") {
		runes := []rune(css)
		input.HasBOM = true
		input.CSS = string(runes[1:])
		input.Document = input.CSS
	}
	if opts.Document != "" {
		input.Document = opts.Document
	}
	if opts.From != "" {
		if filepath.IsAbs(opts.From) {
			input.File = opts.From
		} else {
			abs, err := filepath.Abs(opts.From)
			if err != nil {
				return nil, err
			}
			input.File = abs
		}
	}
	input.buildLineIndex()
	return input, nil
}

func (i *Input) From() string {
	if i.File != "" {
		return i.File
	}
	return "<css input>"
}

func (i *Input) Error(message string, line, column int, plugin string) *csserrors.SyntaxError {
	return csserrors.New(message, line, column, i.CSS, i.File, plugin)
}

func (i *Input) ErrorAtOffset(message string, offset int, plugin string) *csserrors.SyntaxError {
	pos := i.FromOffset(offset)
	return i.Error(message, pos.Line, pos.Column, plugin)
}

func (i *Input) FromOffset(offset int) Position {
	if offset < 0 {
		offset = 0
	}
	if offset > len(i.CSS) {
		offset = len(i.CSS)
	}
	line := 0
	lo, hi := 0, len(i.lineIdx)-1
	for lo <= hi {
		mid := (lo + hi) / 2
		if i.lineIdx[mid] <= offset {
			line = mid
			lo = mid + 1
		} else {
			hi = mid - 1
		}
	}
	return Position{
		Line:   line + 1,
		Column: offset - i.lineIdx[line] + 1,
		Offset: offset,
	}
}

func (i *Input) FromLineAndColumn(line, column int) (int, error) {
	if line <= 0 || line > len(i.lineIdx) {
		return 0, fmt.Errorf("line out of range: %d", line)
	}
	return i.lineIdx[line-1] + column - 1, nil
}

func (i *Input) buildLineIndex() {
	i.lineIdx = []int{0}
	for idx, ch := range i.CSS {
		if ch == '\n' {
			i.lineIdx = append(i.lineIdx, idx+1)
		}
	}
	if len(i.lineIdx) == 0 {
		i.lineIdx = []int{0}
	}
}

func (i *Input) String() string {
	return strings.TrimSpace(i.CSS)
}
