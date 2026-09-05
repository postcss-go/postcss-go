package stringifier

import (
	"encoding/json"
	"strings"
)

type noWorkMapPayload struct {
	Version        int               `json:"version"`
	Sources        []string          `json:"sources"`
	Names          []string          `json:"names"`
	Mappings       string            `json:"mappings"`
	File           string            `json:"file,omitempty"`
	SourcesContent []*string         `json:"sourcesContent,omitempty"`
	SourceRoot     string            `json:"sourceRoot,omitempty"`
	Sections       []json.RawMessage `json:"sections,omitempty"`
}

// ClearSourceMapAnnotations mirrors the raw-CSS annotation cleanup used by
// PostCSS's no-work map generator. Only `sourceMappingURL` comments are
// removed; other `/*#...*/` comments (for example `#region`) are kept.
// Leading newlines and horizontal whitespace before each annotation are
// removed; trailing whitespace-only suffixes are dropped.
func ClearSourceMapAnnotations(css string) string {
	searchEnd := len(css)
	for {
		start := strings.LastIndex(css[:searchEnd], "/*#")
		if start < 0 {
			return css
		}
		endOffset := strings.Index(css[start+3:], "*/")
		if endOffset < 0 {
			searchEnd = start
			continue
		}
		if body := strings.TrimSpace(css[start+3 : start+3+endOffset]); !strings.HasPrefix(body, "sourceMappingURL=") {
			searchEnd = start
			continue
		}
		end := start + 3 + endOffset + 2
		for start > 0 && isAnnotationLeadByte(css[start-1]) {
			start--
		}
		suffix := css[end:]
		if strings.TrimSpace(suffix) == "" {
			suffix = ""
		}
		css = css[:start] + suffix
		searchEnd = len(css)
	}
}

func isAnnotationLeadByte(ch byte) bool {
	switch ch {
	case '\n', '\r', ' ', '\t':
		return true
	default:
		return false
	}
}

// NoWorkWithSourceMap generates the identity map used when a processor has no
// plugins. A previous map is retained rather than remapping the unchanged CSS.
func NoWorkWithSourceMap(
	css string,
	previousMap string,
	opts SourceMapOptions,
) (StringifyResult, error) {
	cleaned := css
	if !opts.PreserveAnnotation {
		cleaned = ClearSourceMapAnnotations(css)
	}

	payload, err := noWorkPayload(cleaned, previousMap, opts)
	if err != nil {
		return StringifyResult{}, err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return StringifyResult{}, err
	}
	return StringifyResult{CSS: cleaned, Map: string(encoded)}, nil
}

func noWorkPayload(css, previousMap string, opts SourceMapOptions) (noWorkMapPayload, error) {
	outputFile := opts.To
	if outputFile == "" {
		outputFile = opts.From
		if outputFile == "" {
			outputFile = "to.css"
		}
	}
	mapFile := opts.MapFile
	if mapFile == "" {
		mapFile = outputFile + ".map"
	}
	mapDir := pathDirectory(mapFile)

	if previousMap != "" {
		var payload noWorkMapPayload
		if err := json.Unmarshal([]byte(previousMap), &payload); err != nil {
			return noWorkMapPayload{}, err
		}
		payload.File = outputPath(outputFile, mapDir)
		if payload.Names == nil {
			payload.Names = []string{}
		}
		if opts.SourcesContent != nil && !*opts.SourcesContent {
			payload.SourcesContent = nil
		}
		return payload, nil
	}

	source := opts.SourceMapFrom
	if source == "" {
		source = opts.From
	}
	if source == "" {
		source = noSource
	}
	source = sourcePath(source, mapDir, opts.Absolute && source != opts.SourceMapFrom)

	payload := noWorkMapPayload{
		Version:  3,
		Sources:  []string{source},
		Names:    []string{},
		Mappings: "AAAA",
		File:     outputPath(outputFile, mapDir),
	}
	if opts.SourcesContent == nil || *opts.SourcesContent {
		content := css
		payload.SourcesContent = []*string{&content}
	}
	return payload, nil
}

func SourceMapEOL(css string) string {
	if strings.Contains(css, "\r\n") {
		return "\r\n"
	}
	return "\n"
}
