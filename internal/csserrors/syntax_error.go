package csserrors

import (
	"fmt"
	"strings"
)

type SyntaxError struct {
	Reason    string
	File      string
	Source    string
	Plugin    string
	Line      int
	Column    int
	EndLine   int
	EndColumn int
	Input     *InputInfo
	message   string
}

// InputInfo describes the location in the input that produced the error.
// It is kept as one value so callers do not have to infer whether the
// position belongs to the mapped source or the current input.
type InputInfo struct {
	Source           string
	File             string
	Line             int
	Column           int
	Offset           int
	SourceMapPresent bool
}

func New(reason string, line, column int, source, file, plugin string) *SyntaxError {
	err := &SyntaxError{
		Reason: reason,
		File:   file,
		Source: source,
		Plugin: plugin,
		Line:   line,
		Column: column,
	}
	err.setMessage()
	return err
}

func (e *SyntaxError) Error() string {
	return e.message
}

func (e *SyntaxError) String() string {
	code := e.ShowSourceCode()
	if code != "" {
		return "CssSyntaxError: " + e.message + "\n\n" + code + "\n"
	}
	return "CssSyntaxError: " + e.message
}

func (e *SyntaxError) ShowSourceCode() string {
	if e.Source == "" || e.Line <= 0 {
		return ""
	}
	lines := strings.Split(e.Source, "\n")
	start := max(e.Line-3, 0)
	end := min(e.Line+2, len(lines))
	width := len(fmt.Sprintf("%d", end))
	var out []string
	for i := start; i < end; i++ {
		number := i + 1
		gutter := fmt.Sprintf(" %*d | ", width, number)
		line := lines[i]
		if number == e.Line {
			out = append(out, ">"+gutter+line)
			if e.Column > 0 {
				out = append(out, " "+strings.Repeat(" ", len(gutter)+e.Column-1)+"^")
			}
		} else {
			out = append(out, " "+gutter+line)
		}
	}
	return strings.Join(out, "\n")
}

func (e *SyntaxError) setMessage() {
	var builder strings.Builder
	if e.Plugin != "" {
		builder.WriteString(e.Plugin)
		builder.WriteString(": ")
	}
	if e.File != "" {
		builder.WriteString(e.File)
	} else {
		builder.WriteString("<css input>")
	}
	if e.Line > 0 && e.Column > 0 {
		builder.WriteString(fmt.Sprintf(":%d:%d", e.Line, e.Column))
	}
	builder.WriteString(": ")
	builder.WriteString(e.Reason)
	e.message = builder.String()
}
