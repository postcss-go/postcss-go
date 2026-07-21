package source

import (
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf16"

	"github.com/go-sourcemap/sourcemap"
	"postcss-go/internal/csserrors"
	"postcss-go/internal/pathutil"
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
	From         string
	Document     string
	SourceMapURL string
	SourceMap    []byte
	TrackSource  bool
}

type Input struct {
	CSS           string
	Document      string
	File          string
	HasBOM        bool
	lineIdx       []int
	consumer      *sourcemap.Consumer
	originCache   map[string]*Input
	originContent map[string]bool
	contentKnown  bool
	trackSource   bool
}

type sourceMapMetadata struct {
	SourceRoot     string            `json:"sourceRoot"`
	Sources        []string          `json:"sources"`
	SourcesContent []json.RawMessage `json:"sourcesContent"`
	Sections       []struct {
		Map json.RawMessage `json:"map"`
	} `json:"sections"`
}

func NewInput(css string, opts Options) (*Input, error) {
	if css == "" {
		css = ""
	}
	input := &Input{CSS: css, Document: css, trackSource: opts.TrackSource}
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
		if isSourceURI(opts.From) || pathutil.IsAbsoluteSourcePath(opts.From) {
			input.File = opts.From
		} else {
			abs, err := filepath.Abs(opts.From)
			if err != nil {
				return nil, err
			}
			input.File = abs
		}
	}
	if len(opts.SourceMap) > 0 {
		consumer, err := sourcemap.Parse(opts.SourceMapURL, opts.SourceMap)
		if err != nil {
			return nil, err
		}
		input.consumer = consumer
		input.originContent = sourceMapContentAvailability(opts.SourceMap, opts.SourceMapURL, input.File)
	}
	return input, nil
}

func isSourceURI(value string) bool {
	if pathutil.IsAbsoluteSourcePath(value) {
		return false
	}
	u, err := url.Parse(value)
	return err == nil && u.Scheme != ""
}

func (i *Input) TracksSource() bool {
	return i.File != "" || i.consumer != nil || i.trackSource
}

func (i *Input) From() string {
	if i.File != "" {
		return i.File
	}
	return "<css input>"
}

func (i *Input) SourceContentAvailable() bool {
	return i.contentKnown || i.originContent == nil
}

func (i *Input) Error(message string, line, column int, plugin string) *csserrors.SyntaxError {
	offset, _ := i.FromLineAndColumn(line, column)
	return i.errorAtPosition(message, line, column, offset, plugin)
}

func (i *Input) errorAtPosition(message string, line, column, offset int, plugin string) *csserrors.SyntaxError {
	inputInfo := &csserrors.InputInfo{Source: i.CSS, File: i.File, Line: line, Column: column, Offset: offset, SourceMapPresent: i.consumer != nil}
	if source, mappedInput, mappedLine, mappedColumn, ok := i.origin(line, column); ok {
		err := csserrors.New(message, mappedLine, mappedColumn, source, mappedInput.File, plugin)
		inputInfo.SourceMapPresent = true
		err.Input = inputInfo
		return err
	}
	err := csserrors.New(message, line, column, i.CSS, i.File, plugin)
	err.Input = inputInfo
	return err
}

func (i *Input) ErrorAtOffset(message string, offset int, plugin string) *csserrors.SyntaxError {
	pos := i.FromOffset(offset)
	return i.errorAtPosition(message, pos.Line, pos.Column, offset, plugin)
}

// Origin maps a position in this input through its previous source map. The
// returned input represents the original source when a mapping is available.
// Lines and columns use PostCSS's one-based convention.
func (i *Input) Origin(line, column int) (string, *Input, int, int, bool) {
	return i.origin(line, column)
}

func (i *Input) FromOffset(offset int) Position {
	i.ensureLineIndex()
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
		Column: utf16Column(i.CSS[i.lineIdx[line]:offset]) + 1,
		Offset: offset,
	}
}

func (i *Input) FromLineAndColumn(line, column int) (int, error) {
	i.ensureLineIndex()
	if line <= 0 || line > len(i.lineIdx) {
		return 0, fmt.Errorf("line out of range: %d", line)
	}
	lineStart := i.lineIdx[line-1]
	lineEnd := len(i.CSS)
	if line < len(i.lineIdx) {
		lineEnd = i.lineIdx[line] - 1
	}
	offset, ok := byteOffsetForUTF16Column(i.CSS[lineStart:lineEnd], column-1)
	if !ok {
		return 0, fmt.Errorf("column out of range: %d", column)
	}
	return lineStart + offset, nil
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

func (i *Input) ensureLineIndex() {
	if i.lineIdx != nil {
		return
	}
	i.buildLineIndex()
}

func (i *Input) String() string {
	return strings.TrimSpace(i.CSS)
}

func (i *Input) Location(start, end Position) *Location {
	startInput := i
	endInput := i
	startPos := start
	endPos := end

	if _, mappedInput, line, column, ok := i.origin(start.Line, start.Column); ok {
		startInput = mappedInput
		startPos = Position{Line: line, Column: column, Offset: resolveOffset(mappedInput, line, column, start.Offset)}
	}
	if _, mappedInput, line, column, ok := i.origin(end.Line, end.Column); ok {
		endInput = mappedInput
		endPos = Position{Line: line, Column: column, Offset: resolveOffset(mappedInput, line, column, end.Offset)}
	}
	if startInput == endInput {
		return &Location{Start: startPos, End: endPos, Input: startInput}
	}
	return &Location{Start: start, End: end, Input: i}
}

func resolveOffset(input *Input, line, column, fallback int) int {
	if input.CSS == "" {
		return fallback
	}
	if offset, err := input.FromLineAndColumn(line, column); err == nil {
		return offset
	}
	return fallback
}

func (i *Input) origin(line, column int) (string, *Input, int, int, bool) {
	if i.consumer == nil {
		return "", nil, 0, 0, false
	}
	file, _, originalLine, originalColumn, ok := i.consumer.Source(line, max(column-1, 0))
	if !ok {
		return "", nil, 0, 0, false
	}
	contentKnown := i.originContentAvailable(file)
	content := i.consumer.SourceContent(file)
	resolvedFile := i.resolveOriginFile(file)
	return content, i.cachedOriginInput(resolvedFile, content, contentKnown), originalLine, originalColumn + 1, true
}

func utf16Column(text string) int {
	column := 0
	for _, r := range text {
		column += utf16.RuneLen(r)
	}
	return column
}

func byteOffsetForUTF16Column(text string, target int) (int, bool) {
	if target < 0 {
		return 0, false
	}
	column := 0
	for offset, r := range text {
		if column == target {
			return offset, true
		}
		column += utf16.RuneLen(r)
		if column > target {
			return 0, false
		}
	}
	return len(text), column == target
}

func (i *Input) cachedOriginInput(file, content string, contentKnown bool) *Input {
	if i.originCache == nil {
		i.originCache = map[string]*Input{}
	}
	key := file + "\x00" + content
	if input, ok := i.originCache[key]; ok {
		return input
	}
	input := &Input{
		CSS:           content,
		Document:      content,
		File:          file,
		originContent: map[string]bool{},
		contentKnown:  contentKnown,
	}
	input.buildLineIndex()
	i.originCache[key] = input
	return input
}

func (i *Input) originContentAvailable(file string) bool {
	if i.originContent == nil {
		return false
	}
	if i.originContent[sourcePathKey(file)] {
		return true
	}
	resolved := i.resolveOriginFile(file)
	return i.originContent[sourcePathKey(resolved)]
}

func (i *Input) resolveOriginFile(file string) string {
	if u, err := url.Parse(file); err == nil && u.Scheme != "" && !pathutil.IsWindowsDrivePath(file) {
		if u.Scheme == "file" {
			return filepath.FromSlash(u.Path)
		}
		return file
	}
	if pathutil.IsAbsoluteSourcePath(file) {
		return normalizeSourcePath(file)
	}
	mapURL := i.consumer.SourcemapURL()
	if u, err := url.Parse(mapURL); err == nil && u.Scheme != "" && !pathutil.IsWindowsDrivePath(mapURL) {
		if u.Scheme != "file" {
			return file
		}
		mapURL = filepath.FromSlash(u.Path)
	}
	base := filepath.Dir(mapURL)
	if mapURL == "" && i.File != "" {
		base = filepath.Dir(i.File)
	}
	resolved, err := filepath.Abs(filepath.Join(base, file))
	if err != nil {
		return filepath.Clean(filepath.Join(base, file))
	}
	return resolved
}

func sourceMapContentAvailability(raw []byte, mapURL, inputFile string) map[string]bool {
	result := map[string]bool{}
	var metadata sourceMapMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return result
	}
	for index, source := range metadata.Sources {
		if index < len(metadata.SourcesContent) && string(metadata.SourcesContent[index]) != "null" {
			result[sourcePathKey(resolveMapSource(source, metadata.SourceRoot, mapURL, inputFile))] = true
		}
	}
	for _, section := range metadata.Sections {
		for source, available := range sourceMapContentAvailability(section.Map, mapURL, inputFile) {
			result[source] = available
		}
	}
	return result
}

func resolveMapSource(source, sourceRoot, mapURL, inputFile string) string {
	if u, err := url.Parse(source); err == nil && u.Scheme != "" && !pathutil.IsWindowsDrivePath(source) {
		return source
	}
	if sourceRoot != "" {
		if root, err := url.Parse(sourceRoot); err == nil && root.Scheme != "" {
			return root.ResolveReference(&url.URL{Path: source}).String()
		}
		if strings.HasPrefix(sourceRoot, "/") {
			source = path.Join(sourceRoot, source)
		} else {
			source = filepath.Join(sourceRoot, source)
		}
	}
	if pathutil.IsAbsoluteSourcePath(source) {
		return normalizeSourcePath(source)
	}
	base := filepath.Dir(mapURL)
	if u, err := url.Parse(mapURL); err == nil && u.Scheme == "file" && !pathutil.IsWindowsDrivePath(mapURL) {
		base = filepath.Dir(filepath.FromSlash(u.Path))
	} else if mapURL == "" && inputFile != "" {
		base = filepath.Dir(inputFile)
	}
	resolved, err := filepath.Abs(filepath.Join(base, source))
	if err != nil {
		return filepath.Clean(filepath.Join(base, source))
	}
	return resolved
}

func normalizeSourcePath(value string) string {
	return pathutil.NormalizeSourcePath(value)
}

func sourcePathKey(value string) string {
	normalized := normalizeSourcePath(value)
	if pathutil.IsWindowsDrivePath(normalized) {
		return strings.ToLower(filepath.Clean(normalized))
	}
	return normalized
}
