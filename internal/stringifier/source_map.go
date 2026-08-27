package stringifier

import (
	"encoding/json"
	"net/url"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
	"github.com/postcss-go/postcss-go/internal/utils"
)

const vlqChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const noSource = "<no source>"

// isURI is retained as a package-local compatibility helper for tests and
// callers in this package; the path classification lives in utils.
func isURI(value string) bool { return utils.IsURI(value) }

type sourceMapWriter struct {
	builder            strings.Builder
	mapBuilder         strings.Builder
	line               int
	column             int
	mapLine            int
	lastGenColumn      int
	lastSource         int
	lastSourceLine     int
	lastSourceCol      int
	needComma          bool
	sourceIndexes      map[string]int
	sources            []string
	sourcesContent     map[string]*string
	sourceOverride     string
	preserveAnnotation bool
	cache              renderCache
}

type sourceMapPayload struct {
	Version        int       `json:"version"`
	File           string    `json:"file,omitempty"`
	Sources        []string  `json:"sources"`
	SourcesContent []*string `json:"sourcesContent,omitempty"`
	Names          []string  `json:"names"`
	Mappings       string    `json:"mappings"`
}

func newSourceMapWriter(sourceOverride ...string) *sourceMapWriter {
	override := ""
	if len(sourceOverride) > 0 {
		override = sourceOverride[0]
	}
	return &sourceMapWriter{
		sourceIndexes:  map[string]int{},
		sourcesContent: map[string]*string{},
		sourceOverride: override,
	}
}

func (w *sourceMapWriter) String() string {
	return w.builder.String()
}

func (w *sourceMapWriter) renderCache() *renderCache {
	return &w.cache
}

func (w *sourceMapWriter) writeByte(ch byte) {
	w.builder.WriteByte(ch)
	if ch == '\n' {
		w.line++
		w.column = 0
		return
	}
	w.column++
}

func (w *sourceMapWriter) writeString(text string) {
	w.builder.WriteString(text)
	for i := 0; i < len(text); {
		c := text[i]
		if c == '\n' {
			w.line++
			w.column = 0
			i++
			continue
		}
		if c < utf8.RuneSelf {
			w.column++
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(text[i:])
		w.column += utf16.RuneLen(r)
		i += size
	}
}

func (w *sourceMapWriter) AddMapping(node ast.Node) {
	location := node.Source()
	if location == nil || location.Input == nil {
		w.addMapping(noSource, nil, 0, 0)
		return
	}
	w.addLocationMapping(location, location.Start, w.line, w.column)
}

func (w *sourceMapWriter) AddMappingAt(node ast.Node, position sourcemap.Position) {
	location := node.Source()
	if location == nil || location.Input == nil {
		w.addMapping(noSource, nil, 0, 0)
		return
	}
	w.addLocationMapping(location, position, w.line, w.column)
}

func (w *sourceMapWriter) AddEndMapping(node ast.Node) {
	location := node.Source()
	if location == nil || location.Input == nil {
		w.addMappingAtGenerated(noSource, nil, 0, 0, w.line, max(w.column-1, 0))
		return
	}
	position := location.End
	if node.Type() == ast.NodeDecl && position.Offset > 0 && position.Offset <= len(location.Input.CSS) && location.Input.CSS[position.Offset-1] == ';' {
		position = location.Input.FromOffset(position.Offset - 1)
	}
	w.addLocationMapping(location, position, w.line, max(w.column-1, 0))
}

func (w *sourceMapWriter) addLocationMapping(location *sourcemap.Location, position sourcemap.Position, genLine, genColumn int) {
	input := location.Input
	if _, mappedInput, line, column, ok := input.Origin(position.Line, position.Column); ok {
		input = mappedInput
		position.Line = line
		position.Column = column
	}

	sourceName := input.From()
	if w.sourceOverride != "" {
		sourceName = w.sourceOverride
	}
	if sourceName == "" || sourceName == "<css input>" {
		sourceName = noSource
	}
	if sourceName != noSource && !utils.IsURI(sourceName) {
		if strings.HasPrefix(sourceName, "/") {
			sourceName = path.Clean(sourceName)
		} else {
			sourceName = filepath.Clean(sourceName)
		}
	}
	content := input.CSS
	var sourceContent *string
	if input.SourceContentAvailable() {
		sourceContent = &content
	}
	w.addMappingAtGenerated(sourceName, sourceContent, max(position.Line-1, 0), max(position.Column-1, 0), genLine, genColumn)
}

func (w *sourceMapWriter) addMappingAtGenerated(source string, content *string, sourceLine, sourceCol, genLine, genColumn int) {
	sourceIndex, ok := w.sourceIndexes[source]
	if !ok {
		sourceIndex = len(w.sources)
		w.sourceIndexes[source] = sourceIndex
		w.sources = append(w.sources, source)
		w.sourcesContent[source] = content
	} else if w.sourcesContent[source] == nil && content != nil {
		w.sourcesContent[source] = content
	}
	for w.mapLine < genLine {
		w.mapBuilder.WriteByte(';')
		w.mapLine++
		w.lastGenColumn = 0
		w.needComma = false
	}
	if w.needComma {
		w.mapBuilder.WriteByte(',')
	}
	writeVLQ(&w.mapBuilder, genColumn-w.lastGenColumn)
	writeVLQ(&w.mapBuilder, sourceIndex-w.lastSource)
	writeVLQ(&w.mapBuilder, sourceLine-w.lastSourceLine)
	writeVLQ(&w.mapBuilder, sourceCol-w.lastSourceCol)
	w.lastGenColumn = genColumn
	w.lastSource = sourceIndex
	w.lastSourceLine = sourceLine
	w.lastSourceCol = sourceCol
	w.needComma = true
}

func (w *sourceMapWriter) addMapping(source string, content *string, sourceLine, sourceCol int) {
	w.addMappingAtGenerated(source, content, sourceLine, sourceCol, w.line, w.column)
}

func (w *sourceMapWriter) sourceMap(opts SourceMapOptions) (string, error) {
	mapFile := opts.MapFile
	outputFile := opts.To
	if outputFile == "" {
		outputFile = opts.From
		if outputFile == "" {
			outputFile = "to.css"
		}
	}
	if mapFile == "" {
		mapFile = outputFile + ".map"
	}
	mapDir := pathDirectory(mapFile)

	sources := make([]string, len(w.sources))
	var sourcesContent []*string
	if opts.SourcesContent == nil || *opts.SourcesContent {
		sourcesContent = make([]*string, len(w.sources))
	}
	for index, source := range w.sources {
		sources[index] = sourcePath(source, mapDir, opts.Absolute && source != w.sourceOverride)
		if sourcesContent != nil {
			sourcesContent[index] = w.sourcesContent[source]
		}
	}
	payload := sourceMapPayload{
		Version:        3,
		File:           outputPath(outputFile, mapDir),
		Sources:        sources,
		SourcesContent: sourcesContent,
		Names:          []string{},
		Mappings:       w.mapBuilder.String(),
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func sourcePath(source, mapDir string, absolute bool) string {
	if source == noSource || utils.IsURI(source) {
		return source
	}
	if absolute {
		return fileURL(source)
	}
	if utils.IsURI(mapDir) {
		return (&url.URL{Path: filepath.ToSlash(source)}).EscapedPath()
	}
	return relativePath(mapDir, source)
}

func outputPath(outputFile, mapDir string) string {
	if utils.IsURI(outputFile) {
		return outputFile
	}
	if utils.IsURI(mapDir) {
		return (&url.URL{Path: filepath.ToSlash(outputFile)}).EscapedPath()
	}
	return relativePath(mapDir, outputFile)
}

func pathDirectory(value string) string {
	if strings.HasPrefix(value, "/") {
		return path.Dir(value)
	}
	if u, err := url.Parse(value); err == nil && u.Scheme != "" && !utils.IsWindowsDrivePath(value) {
		u.Path = filepath.ToSlash(filepath.Dir(filepath.FromSlash(u.Path)))
		return u.String()
	}
	return filepath.Dir(value)
}

func fileURL(path string) string {
	absolute := path
	if !filepath.IsAbs(absolute) && !strings.HasPrefix(absolute, "/") {
		if resolved, err := filepath.Abs(absolute); err == nil {
			absolute = resolved
		}
	}
	slashPath := filepath.ToSlash(absolute)
	if runtime.GOOS == "windows" && !strings.HasPrefix(slashPath, "/") {
		slashPath = "/" + slashPath
	}
	return (&url.URL{Scheme: "file", Path: slashPath}).String()
}

func relativePath(baseDir, target string) string {
	if filepath.IsAbs(target) && !filepath.IsAbs(baseDir) {
		if absoluteBase, err := filepath.Abs(baseDir); err == nil {
			baseDir = absoluteBase
		}
	} else if filepath.IsAbs(baseDir) && !filepath.IsAbs(target) {
		if absoluteTarget, err := filepath.Abs(target); err == nil {
			target = absoluteTarget
		}
	}
	relative, err := filepath.Rel(baseDir, target)
	if err != nil {
		relative = target
	}
	path := filepath.ToSlash(relative)
	return (&url.URL{Path: path}).EscapedPath()
}

func writeVLQ(builder *strings.Builder, value int) {
	vlq := value << 1
	if value < 0 {
		vlq = ((-value) << 1) | 1
	}
	for {
		digit := vlq & 31
		vlq >>= 5
		if vlq > 0 {
			digit |= 32
		}
		builder.WriteByte(vlqChars[digit])
		if vlq == 0 {
			return
		}
	}
}
