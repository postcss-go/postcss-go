// Package nativebridge owns the operations exposed through the native Node
// addon. internal/nativeaddon only adapts this API to a small C ABI.
package nativebridge

import (
	"encoding/json"
	"fmt"

	"postcss-go/internal/codec"
	"postcss-go/internal/postcss"
	"postcss-go/internal/result"
)

// Operation identifies an operation on the private Go/C boundary.
type Operation uint8

const (
	Parse     Operation = 0
	Stringify Operation = 1
	Process   Operation = 2
	NoWork    Operation = 3
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
	RootBin  []byte    `json:"rootBin"`
}

type warning struct {
	Type   string `json:"type"`
	Text   string `json:"text"`
	Plugin string `json:"plugin,omitempty"`
}

// Call executes one native operation. The two byte slices are interpreted
// according to the operation, keeping transport details out of addon.c.
func Call(operation Operation, first, second []byte) ([]byte, error) {
	switch operation {
	case Parse:
		return parse(string(first), string(second))
	case Stringify:
		return stringify(first, second)
	case Process:
		return process(string(first), second)
	case NoWork:
		return noWork(string(first), second)
	default:
		return nil, fmt.Errorf("unknown native operation %d", operation)
	}
}

func parse(css, from string) ([]byte, error) {
	options := postcss.ParseOptions{TrackSource: true}
	if from != "" {
		options.From = from
	}
	root, err := postcss.ParseWithOptions(css, options)
	if err != nil {
		return nil, err
	}
	return codec.EncodeAST(root)
}

func stringify(astBytes, optionsJSON []byte) ([]byte, error) {
	node, err := codec.DecodeAST(astBytes)
	if err != nil {
		return nil, err
	}
	var options postcss.ProcessOptions
	if len(optionsJSON) > 0 {
		if err := json.Unmarshal(optionsJSON, &options); err != nil {
			return nil, err
		}
	}
	stringified, err := postcss.StringifyWithOptions(node, options)
	if err != nil {
		return nil, err
	}
	return json.Marshal(stringifyResult{
		CSS:     stringified.CSS,
		Map:     stringified.Map,
		MapFile: stringified.MapFile,
	})
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
	encoded, err := codec.EncodeAST(processed.Root)
	if err != nil {
		return nil, err
	}
	return json.Marshal(processResult{
		CSS:      processed.CSS,
		Map:      processed.Map,
		MapFile:  processed.MapFile,
		Messages: warnings(processed.Messages),
		RootBin:  encoded,
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
