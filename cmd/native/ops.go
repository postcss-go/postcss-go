package main

import (
	"encoding/json"

	"postcss-go/internal/codec"
	"postcss-go/internal/jsbridge"
	"postcss-go/internal/postcss"
	"postcss-go/internal/stringifier"
)

// parseAST parses CSS and returns the binary AST codec payload.
func parseAST(css, from string) ([]byte, error) {
	opts := postcss.ParseOptions{TrackSource: true}
	if from != "" {
		opts.From = from
	}
	root, err := postcss.ParseWithOptions(css, opts)
	if err != nil {
		return nil, err
	}
	return codec.EncodeAST(root)
}

// stringifyAST decodes a binary AST and returns the stringify JSON payload
// ({"css":..., "map":...} or with builder parts when requested).
func stringifyAST(astBytes, optionsJSON []byte) ([]byte, error) {
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
	result := &jsbridge.StringifyResult{}
	if options.Map || options.MapAuto {
		stringified, err := stringifier.StringifyWithSourceMap(node, stringifier.SourceMapOptions{
			From:               options.From,
			To:                 options.To,
			MapFile:            options.MapFile,
			SourceMapFrom:      options.SourceMapFrom,
			SourcesContent:     options.SourcesContent,
			Absolute:           options.Absolute,
			PreserveAnnotation: options.PreserveAnnotation,
		})
		if err != nil {
			return nil, err
		}
		result.CSS = stringified.CSS
		result.Map = stringified.Map
	} else {
		result.CSS = postcss.Stringify(node)
	}
	return json.Marshal(result)
}

// processCSS runs the engine process path and returns JSON that embeds the
// binary AST under "rootBin" instead of a DTO tree.
func processCSS(css string, optionsJSON []byte) ([]byte, error) {
	params := jsbridge.ProcessParams{CSS: css}
	if len(optionsJSON) > 0 {
		if err := json.Unmarshal(optionsJSON, &params.Options); err != nil {
			return nil, err
		}
	}
	result, err := jsbridge.ProcessRPC(nil, params)
	if err != nil {
		return nil, err
	}
	encoded, err := codec.EncodeDTO(result.Root)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{
		"css":      result.CSS,
		"map":      result.Map,
		"messages": result.Messages,
		"rootBin":  encoded,
	})
}

// noWorkCSS runs the no-plugin map path and returns its JSON payload.
func noWorkCSS(css string, optionsJSON []byte) ([]byte, error) {
	params := jsbridge.NoWorkParams{CSS: css}
	if len(optionsJSON) > 0 {
		if err := json.Unmarshal(optionsJSON, &params.Options); err != nil {
			return nil, err
		}
	}
	result, err := jsbridge.NoWorkRPC(nil, params)
	if err != nil {
		return nil, err
	}
	return json.Marshal(result)
}

// fitPayload copies payload into out when capacity is enough. It always returns
// the payload length; callers compare against capacity to know if a copy happened.
func fitPayload(out []byte, payload []byte) int {
	if len(out) >= len(payload) {
		copy(out, payload)
	}
	return len(payload)
}
