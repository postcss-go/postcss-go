package result

import (
	"fmt"

	"postcss-go/internal/ast"
)

type Warning struct {
	Type   string
	Text   string
	Plugin string
	Node   ast.Node
}

type Result struct {
	Root       *ast.Root
	CSS        string
	Messages   []Warning
	LastPlugin string
}

func (r *Result) Warn(text string) Warning {
	warning := Warning{
		Type:   "warning",
		Text:   text,
		Plugin: r.LastPlugin,
	}
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
	if w.Plugin == "" {
		return w.Text
	}
	return fmt.Sprintf("%s: %s", w.Plugin, w.Text)
}
