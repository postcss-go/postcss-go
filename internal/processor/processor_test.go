package processor

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/go-sourcemap/sourcemap"
	"postcss-go/internal/ast"
	"postcss-go/internal/result"
)

type testSourceMap struct {
	Sources        []string  `json:"sources"`
	SourcesContent []*string `json:"sourcesContent"`
	Mappings       string    `json:"mappings"`
}

func TestProcessorUsePrepareAndFromOption(t *testing.T) {
	var events []string

	p := New().Use(Plugin{
		Name: "prepared",
		Prepare: func(res *result.Result) Visitor {
			events = append(events, "prepare")
			return Visitor{
				Root: func(root *ast.Root, res *result.Result) error {
					events = append(events, "root")
					if !strings.HasSuffix(root.Source().Input.From(), "input.css") {
						t.Fatalf("expected source file to propagate, got %q", root.Source().Input.From())
					}
					return nil
				},
				DeclarationExit: func(decl *ast.Declaration, res *result.Result) error {
					events = append(events, "decl-exit:"+decl.Prop)
					return nil
				},
			}
		},
	})

	res, err := p.Process(".a { color: red; }", Options{From: "input.css"})
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	if got := res.CSS; !strings.Contains(got, "color: red;") {
		t.Fatalf("unexpected css output: %q", got)
	}
	if !reflect.DeepEqual(events, []string{"prepare", "root", "decl-exit:color"}) {
		t.Fatalf("unexpected events: %#v", events)
	}
}

func TestProcessorPropagatesVisitorErrors(t *testing.T) {
	sentinel := errors.New("stop")
	p := New(Plugin{
		Name: "boom",
		Visitor: Visitor{
			Rule: func(rule *ast.Rule, result *result.Result) error {
				return sentinel
			},
		},
	})
	_, err := p.Process(".a {}")
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected sentinel error, got %v", err)
	}
}

func TestProcessorMapsAnonymousInput(t *testing.T) {
	res, err := New().Process(".a { color: red; }", Options{Map: true, To: "out.css"})
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	var sourceMap testSourceMap
	if err := json.Unmarshal([]byte(res.Map), &sourceMap); err != nil {
		t.Fatalf("invalid source map: %v", err)
	}
	if len(sourceMap.Sources) != 1 || sourceMap.Sources[0] != "<no source>" {
		t.Fatalf("expected anonymous source mapping, got %#v", sourceMap.Sources)
	}
	if sourceMap.Mappings == "" {
		t.Fatal("expected anonymous mappings")
	}
	if len(sourceMap.SourcesContent) != 1 || sourceMap.SourcesContent[0] == nil ||
		*sourceMap.SourcesContent[0] != ".a { color: red; }" {
		t.Fatalf("unexpected anonymous source content: %#v", sourceMap.SourcesContent)
	}
}

func TestProcessorMapsUnsourcedNodes(t *testing.T) {
	p := New(Plugin{
		Name: "insert",
		Visitor: Visitor{
			Rule: func(rule *ast.Rule, result *result.Result) error {
				rule.Append(ast.NewDeclaration("background", "blue"))
				return nil
			},
		},
	})

	res, err := p.Process(".a { color: red; }", Options{
		From: "input.css",
		To:   "out.css",
		Map:  true,
	})
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	var sourceMap testSourceMap
	if err := json.Unmarshal([]byte(res.Map), &sourceMap); err != nil {
		t.Fatalf("invalid source map: %v", err)
	}
	if len(sourceMap.Sources) != 2 || sourceMap.Sources[1] != "<no source>" {
		t.Fatalf("expected an explicit unsourced mapping, got %#v", sourceMap.Sources)
	}
	if sourceMap.Mappings == "" {
		t.Fatal("expected sourced and unsourced mappings")
	}
	if len(sourceMap.SourcesContent) != 2 || sourceMap.SourcesContent[1] != nil {
		t.Fatalf("expected null content for unsourced nodes: %#v", sourceMap.SourcesContent)
	}
}

func TestProcessorSourceMapUsesUTF16ColumnsAndEncodedPaths(t *testing.T) {
	tempDir := t.TempDir()
	inputFile := filepath.Join(tempDir, "源🔥.css")
	outputFile := filepath.Join(tempDir, "dist", "output.css")
	css := ".🔥 { color: 红; }"

	res, err := New().Process(css, Options{From: inputFile, To: outputFile, Map: true})
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	var sourceMap testSourceMap
	if err := json.Unmarshal([]byte(res.Map), &sourceMap); err != nil {
		t.Fatalf("invalid source map: %v", err)
	}
	if len(sourceMap.Sources) != 1 ||
		!strings.Contains(sourceMap.Sources[0], "%E6%BA%90%F0%9F%94%A5.css") {
		t.Fatalf("expected URL-encoded non-ASCII source path, got %#v", sourceMap.Sources)
	}
	if len(sourceMap.SourcesContent) != 1 || sourceMap.SourcesContent[0] == nil ||
		*sourceMap.SourcesContent[0] != css {
		t.Fatalf("unexpected non-ASCII source content: %#v", sourceMap.SourcesContent)
	}
	consumer, err := sourcemap.Parse(outputFile+".map", []byte(res.Map))
	if err != nil {
		t.Fatalf("parse generated source map: %v", err)
	}
	_, _, line, column, ok := consumer.Source(2, 2)
	if !ok || line != 1 || column != 6 {
		t.Fatalf("unexpected UTF-16 declaration mapping: line=%d column=%d ok=%v", line, column, ok)
	}
}

func TestProcessorComposesPreviousMapAndRemovesAnnotation(t *testing.T) {
	const previousMap = `{
		"version": 3,
		"file": "generated.css",
		"sources": ["original.css"],
		"sourcesContent": [".a {\n  color: red;\n}"],
		"names": [],
		"mappings": "AAAA;EACE"
	}`
	css := ".a {\n  color: blue;\n}\n/*# sourceMappingURL=generated.css.map */"
	res, err := New().Process(css, Options{
		From:           "generated.css",
		To:             "out.css",
		Map:            true,
		PreviousMap:    previousMap,
		PreviousMapURL: "generated.css.map",
	})
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	if strings.Contains(res.CSS, "sourceMappingURL") {
		t.Fatalf("expected old source map annotation to be removed: %q", res.CSS)
	}
	var sourceMap testSourceMap
	if err := json.Unmarshal([]byte(res.Map), &sourceMap); err != nil {
		t.Fatalf("invalid source map: %v", err)
	}
	if len(sourceMap.Sources) != 1 || sourceMap.Sources[0] != "original.css" {
		t.Fatalf("expected composed original source, got %#v", sourceMap.Sources)
	}
	if len(sourceMap.SourcesContent) != 1 || sourceMap.SourcesContent[0] == nil ||
		!strings.Contains(*sourceMap.SourcesContent[0], "color: red") {
		t.Fatalf("unexpected composed source content: %#v", sourceMap.SourcesContent)
	}
	consumer, err := sourcemap.Parse("out.css.map", []byte(res.Map))
	if err != nil {
		t.Fatalf("parse generated source map: %v", err)
	}
	file, _, line, column, ok := consumer.Source(2, 2)
	if !ok || !strings.HasSuffix(file, "original.css") || line != 2 || column != 2 {
		t.Fatalf("unexpected composed declaration mapping: file=%q line=%d column=%d ok=%v", file, line, column, ok)
	}
}

func TestProcessorPreservesMissingPreviousSourceContent(t *testing.T) {
	const previousMap = `{
		"version": 3,
		"sources": ["original.css"],
		"names": [],
		"mappings": "AAAA"
	}`
	res, err := New().Process(".a {}", Options{
		From:           "generated.css",
		To:             "out.css",
		Map:            true,
		PreviousMap:    previousMap,
		PreviousMapURL: "generated.css.map",
	})
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}
	var sourceMap struct {
		SourcesContent []*string `json:"sourcesContent"`
	}
	if err := json.Unmarshal([]byte(res.Map), &sourceMap); err != nil {
		t.Fatalf("invalid source map: %v", err)
	}
	if len(sourceMap.SourcesContent) != 1 || sourceMap.SourcesContent[0] != nil {
		t.Fatalf("expected missing source content to remain null, got %#v", sourceMap.SourcesContent)
	}
}

func TestProcessorLoadsInlinePreviousMapAnnotation(t *testing.T) {
	const previousMap = `{"version":3,"sources":["original.css"],"sourcesContent":["a{}"],"names":[],"mappings":"AAAA"}`
	annotation := base64.StdEncoding.EncodeToString([]byte(previousMap))
	css := "a{}\n/*# sourceMappingURL=data:application/json;base64," + annotation + " */"

	res, err := New().Process(css, Options{From: "generated.css", To: "out.css", Map: true})
	if err != nil {
		t.Fatalf("process inline previous map: %v", err)
	}
	var sourceMap testSourceMap
	if err := json.Unmarshal([]byte(res.Map), &sourceMap); err != nil {
		t.Fatalf("decode result map: %v", err)
	}
	if len(sourceMap.Sources) != 1 || sourceMap.Sources[0] != "original.css" {
		t.Fatalf("expected inline map composition, got %#v", sourceMap.Sources)
	}
}

func TestProcessorLoadsExternalPreviousMapAnnotation(t *testing.T) {
	tempDir := t.TempDir()
	cssFile := filepath.Join(tempDir, "generated.css")
	mapFile := cssFile + ".map"
	previousMap := `{"version":3,"sources":["original.css"],"sourcesContent":["a{}"],"names":[],"mappings":"AAAA"}`
	if err := os.WriteFile(mapFile, []byte(previousMap), 0o600); err != nil {
		t.Fatalf("write previous map: %v", err)
	}

	res, err := New().Process("a{}\n/*# sourceMappingURL=generated.css.map */", Options{
		From: cssFile,
		To:   filepath.Join(tempDir, "out.css"),
		Map:  true,
	})
	if err != nil {
		t.Fatalf("process external previous map: %v", err)
	}
	var sourceMap testSourceMap
	if err := json.Unmarshal([]byte(res.Map), &sourceMap); err != nil {
		t.Fatalf("decode result map: %v", err)
	}
	if len(sourceMap.Sources) != 1 || !strings.HasSuffix(sourceMap.Sources[0], "original.css") {
		t.Fatalf("expected external map composition, got %#v", sourceMap.Sources)
	}
}

func TestProcessorCanDisablePreviousMapAndPreserveAnnotation(t *testing.T) {
	css := "a{}\n/*# sourceMappingURL=old.css.map */"
	res, err := New().Process(css, Options{
		From:                "generated.css",
		To:                  "out.css",
		Map:                 true,
		PreviousMapDisabled: true,
		PreserveAnnotation:  true,
	})
	if err != nil {
		t.Fatalf("process with annotation preserved: %v", err)
	}
	if !strings.Contains(res.CSS, "sourceMappingURL=old.css.map") {
		t.Fatalf("expected annotation to remain, got %q", res.CSS)
	}
	var sourceMap testSourceMap
	if err := json.Unmarshal([]byte(res.Map), &sourceMap); err != nil {
		t.Fatalf("decode result map: %v", err)
	}
	if len(sourceMap.Sources) != 1 || !strings.HasSuffix(sourceMap.Sources[0], "generated.css") {
		t.Fatalf("previous map must be disabled, got %#v", sourceMap.Sources)
	}
}

func TestProcessorFollowsMutationSafeTraversal(t *testing.T) {
	var visited []string

	p := New(Plugin{
		Name: "mutating",
		Visitor: Visitor{
			Declaration: func(decl *ast.Declaration, result *result.Result) error {
				visited = append(visited, decl.Prop)
				switch decl.Prop {
				case "color":
					if _, err := decl.CloneBefore(ast.NewDeclaration("-webkit-color", decl.Value)); err != nil {
						return err
					}
					if _, err := decl.CloneAfter(ast.NewDeclaration("background", "blue")); err != nil {
						return err
					}
				case "z-index":
					decl.Remove()
				}
				return nil
			},
		},
	})

	res, err := p.Process(".a { color: red; z-index: 1; }")
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}

	if !reflect.DeepEqual(visited, []string{"color", "background", "z-index"}) {
		t.Fatalf("unexpected visit order: %#v", visited)
	}
	if got := res.CSS; got != ".a {\n  -webkit-color: red;\n  color: red;\n  background: blue;\n}" {
		t.Fatalf("unexpected css output: %q", got)
	}
}

func TestProcessorDispatchesNamedVisitors(t *testing.T) {
	var events []string

	p := New(Plugin{
		Name: "named",
		Visitor: Visitor{
			AtRule: func(rule *ast.AtRule, result *result.Result) error {
				events = append(events, "atrule:"+rule.Name)
				return nil
			},
			AtRuleNamed: map[string]func(*ast.AtRule, *result.Result) error{
				"media": func(rule *ast.AtRule, result *result.Result) error {
					events = append(events, "atrule-named:"+rule.Name)
					return nil
				},
			},
			AtRuleExit: func(rule *ast.AtRule, result *result.Result) error {
				events = append(events, "atrule-exit:"+rule.Name)
				return nil
			},
			AtRuleExitNamed: map[string]func(*ast.AtRule, *result.Result) error{
				"media": func(rule *ast.AtRule, result *result.Result) error {
					events = append(events, "atrule-exit-named:"+rule.Name)
					return nil
				},
			},
			Declaration: func(decl *ast.Declaration, result *result.Result) error {
				events = append(events, "decl:"+decl.Prop)
				return nil
			},
			DeclarationProp: map[string]func(*ast.Declaration, *result.Result) error{
				"color": func(decl *ast.Declaration, result *result.Result) error {
					events = append(events, "decl-prop:"+decl.Prop)
					return nil
				},
			},
			DeclarationExit: func(decl *ast.Declaration, result *result.Result) error {
				events = append(events, "decl-exit:"+decl.Prop)
				return nil
			},
			DeclarationExitProp: map[string]func(*ast.Declaration, *result.Result) error{
				"color": func(decl *ast.Declaration, result *result.Result) error {
					events = append(events, "decl-exit-prop:"+decl.Prop)
					return nil
				},
			},
		},
	})

	_, err := p.Process("@media screen { .a { color: red; width: 1px; } }")
	if err != nil {
		t.Fatalf("process failed: %v", err)
	}

	want := []string{
		"atrule:media",
		"atrule-named:media",
		"decl:color",
		"decl-prop:color",
		"decl-exit:color",
		"decl-exit-prop:color",
		"decl:width",
		"decl-exit:width",
		"atrule-exit:media",
		"atrule-exit-named:media",
	}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("unexpected named visitor events\nwant: %#v\ngot:  %#v", want, events)
	}
}
