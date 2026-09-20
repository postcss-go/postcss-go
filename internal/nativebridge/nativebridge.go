// Package nativebridge owns the operations exposed through the native Node
// addon. internal/nativeaddon only adapts this API to a small C ABI.
package nativebridge

import (
	"encoding/json"
	"fmt"

	"github.com/postcss-go/postcss-go/internal/postcss"
	"github.com/postcss-go/postcss-go/internal/result"
)

// Operation identifies an operation on the private Go/C boundary.
type Operation uint8

const (
	Parse            Operation = 0
	Stringify        Operation = 1
	Process          Operation = 2
	NoWork           Operation = 3
	StringifyBuilder Operation = 4
)

type stringifyResult struct {
	CSS     string `json:"css"`
	Map     string `json:"map,omitempty"`
	MapFile string `json:"mapFile,omitempty"`
}

type processResult struct {
	CSS      string    `json:"css"`
	Map      string    `json:"map,omitempty"`
	MapFile  string    `json:"mapFile,omitempty"`
	Messages []warning `json:"messages,omitempty"`
}

type warning struct {
	Type   string `json:"type"`
	Text   string `json:"text"`
	Plugin string `json:"plugin,omitempty"`
}

var errBinaryAST = fmt.Errorf("binary AST frames are removed; use handle sessions")

// Call executes one native operation. The two byte slices are interpreted
// according to the operation, keeping transport details out of addon.c.
func Call(operation Operation, first, second []byte) ([]byte, error) {
	switch operation {
	case Parse, Stringify, StringifyBuilder:
		return nil, errBinaryAST
	case Process:
		return process(string(first), second)
	case NoWork:
		return noWork(string(first), second)
	default:
		return nil, fmt.Errorf("unknown native operation %d", operation)
	}
}

func process(css string, optionsJSON []byte) ([]byte, error) {
	var options postcss.ProcessOptions
	if len(optionsJSON) > 0 {
		if err := json.Unmarshal(optionsJSON, &options); err != nil {
			return nil, err
		}
	}
	processed, err := postcss.New().Process(css, options)
	if err != nil {
		return nil, err
	}
	return json.Marshal(processResult{
		CSS:      processed.CSS,
		Map:      processed.Map,
		MapFile:  processed.MapFile,
		Messages: warnings(processed.Messages),
	})
}

func noWork(css string, optionsJSON []byte) ([]byte, error) {
	var options postcss.ProcessOptions
	if len(optionsJSON) > 0 {
		if err := json.Unmarshal(optionsJSON, &options); err != nil {
			return nil, err
		}
	}
	processed, err := postcss.NoWork(css, options)
	if err != nil {
		return nil, err
	}
	return json.Marshal(stringifyResult{
		CSS:     processed.CSS,
		Map:     processed.Map,
		MapFile: processed.MapFile,
	})
}

func warnings(messages []result.Warning) []warning {
	if len(messages) == 0 {
		return nil
	}
	output := make([]warning, 0, len(messages))
	for _, message := range messages {
		output = append(output, warning{
			Type:   message.Type,
			Text:   message.Text,
			Plugin: message.Plugin,
		})
	}
	return output
}
