package processor

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"postcss-go/internal/ast"
	"postcss-go/internal/parser"
	"postcss-go/internal/result"
	"postcss-go/internal/source"
	"postcss-go/internal/stringifier"
)

type Options struct {
	From                string
	To                  string
	Map                 bool
	MapFile             string
	PreviousMap         string
	PreviousMapURL      string
	PreviousMapDisabled bool
	SourceMapFrom       string
	SourcesContent      *bool
	Absolute            bool
	PreserveAnnotation  bool
}

var sourceMapAnnotationPattern = regexp.MustCompile(`(?s)/\*\s*# sourceMappingURL=(.*?)\*/`)

type Visitor struct {
	Once                func(*ast.Root, *result.Result) error
	OnceExit            func(*ast.Root, *result.Result) error
	Root                func(*ast.Root, *result.Result) error
	RootExit            func(*ast.Root, *result.Result) error
	Rule                func(*ast.Rule, *result.Result) error
	RuleExit            func(*ast.Rule, *result.Result) error
	AtRule              func(*ast.AtRule, *result.Result) error
	AtRuleNamed         map[string]func(*ast.AtRule, *result.Result) error
	AtRuleExit          func(*ast.AtRule, *result.Result) error
	AtRuleExitNamed     map[string]func(*ast.AtRule, *result.Result) error
	Declaration         func(*ast.Declaration, *result.Result) error
	DeclarationProp     map[string]func(*ast.Declaration, *result.Result) error
	DeclarationExit     func(*ast.Declaration, *result.Result) error
	DeclarationExitProp map[string]func(*ast.Declaration, *result.Result) error
	Comment             func(*ast.Comment, *result.Result) error
	CommentExit         func(*ast.Comment, *result.Result) error
}

type Plugin struct {
	Name    string
	Prepare func(*result.Result) Visitor
	Visitor
}

type Processor struct {
	plugins []Plugin
}

func New(plugins ...Plugin) *Processor {
	return &Processor{plugins: append([]Plugin(nil), plugins...)}
}

func (p *Processor) Use(plugin Plugin) *Processor {
	p.plugins = append(p.plugins, plugin)
	return p
}

func (p *Processor) Process(css string, optsList ...Options) (*result.Result, error) {
	var opts Options
	if len(optsList) > 0 {
		opts = optsList[0]
	}
	previousMap, previousMapURL, err := previousSourceMap(css, opts)
	if err != nil {
		return nil, err
	}
	root, err := parser.Parse(css, source.Options{
		From:         opts.From,
		SourceMap:    []byte(previousMap),
		SourceMapURL: previousMapURL,
		TrackSource:  opts.Map,
	})
	if err != nil {
		return nil, err
	}
	res := &result.Result{Root: root}

	visitors := make([]Plugin, 0, len(p.plugins))
	for _, plugin := range p.plugins {
		active := plugin
		if plugin.Prepare != nil {
			active.Visitor = plugin.Prepare(res)
		}
		visitors = append(visitors, active)
	}

	for _, plugin := range visitors {
		res.LastPlugin = plugin.Name
		if plugin.Once != nil {
			if err := plugin.Once(root, res); err != nil {
				return nil, err
			}
		}
	}

	if err := walk(root, res, visitors); err != nil {
		return nil, err
	}

	for _, plugin := range visitors {
		res.LastPlugin = plugin.Name
		if plugin.OnceExit != nil {
			if err := plugin.OnceExit(root, res); err != nil {
				return nil, err
			}
		}
	}

	if opts.Map {
		stringified, err := stringifier.StringifyWithSourceMap(root, stringifier.SourceMapOptions{
			From:               opts.From,
			To:                 opts.To,
			MapFile:            opts.MapFile,
			SourceMapFrom:      opts.SourceMapFrom,
			SourcesContent:     opts.SourcesContent,
			Absolute:           opts.Absolute,
			PreserveAnnotation: opts.PreserveAnnotation,
		})
		if err != nil {
			return nil, err
		}
		res.CSS = stringified.CSS
		res.Map = stringified.Map
		return res, nil
	}

	res.CSS = stringifier.Stringify(root)
	return res, nil
}

func previousSourceMap(css string, opts Options) (string, string, error) {
	if opts.PreviousMap != "" || opts.PreviousMapDisabled {
		return opts.PreviousMap, opts.PreviousMapURL, nil
	}
	matches := sourceMapAnnotationPattern.FindAllStringSubmatch(css, -1)
	if len(matches) == 0 {
		return "", "", nil
	}
	annotation := strings.TrimSpace(matches[len(matches)-1][1])
	if strings.HasPrefix(annotation, "data:") {
		decoded, err := decodeInlineSourceMap(annotation)
		if err != nil {
			return "", "", fmt.Errorf("invalid inline source map: %w", err)
		}
		return decoded, opts.From, nil
	}

	mapFile, ok := sourceMapFile(annotation, opts.From)
	if !ok || !strings.EqualFold(filepath.Ext(mapFile), ".map") {
		return "", "", nil
	}
	raw, err := os.ReadFile(mapFile)
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", nil
		}
		return "", "", fmt.Errorf("read previous source map: %w", err)
	}
	raw = []byte(strings.TrimSpace(string(raw)))
	if !json.Valid(raw) {
		return "", "", nil
	}
	return string(raw), mapFile, nil
}

func decodeInlineSourceMap(annotation string) (string, error) {
	comma := strings.IndexByte(annotation, ',')
	if comma < 0 {
		return "", fmt.Errorf("missing data URI payload")
	}
	metadata, payload := annotation[:comma], annotation[comma+1:]
	if !strings.HasPrefix(strings.ToLower(metadata), "data:application/json") {
		return "", fmt.Errorf("unsupported media type")
	}
	if strings.HasSuffix(strings.ToLower(metadata), ";base64") {
		decoded, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return "", err
		}
		return string(decoded), nil
	}
	decoded, err := url.PathUnescape(payload)
	if err != nil {
		return "", err
	}
	return decoded, nil
}

func sourceMapFile(annotation, from string) (string, bool) {
	parsed, err := url.Parse(annotation)
	if err != nil {
		return "", false
	}
	if parsed.Scheme != "" {
		if parsed.Scheme != "file" {
			return "", false
		}
		return filepath.FromSlash(parsed.Path), true
	}
	if fromURL, err := url.Parse(from); err == nil && fromURL.Scheme != "" {
		if fromURL.Scheme != "file" {
			return "", false
		}
		from = filepath.FromSlash(fromURL.Path)
	}
	if filepath.IsAbs(annotation) {
		return annotation, true
	}
	if from == "" {
		return annotation, true
	}
	return filepath.Join(filepath.Dir(from), filepath.FromSlash(annotation)), true
}

func walk(node ast.Node, res *result.Result, plugins []Plugin) error {
	for _, plugin := range plugins {
		res.LastPlugin = plugin.Name
		if err := dispatchEnter(plugin, node, res); err != nil {
			return err
		}
	}

	container, ok := node.(ast.Container)
	if ok {
		if err := ast.Each(container, func(child ast.Node, _ int) error {
			return walk(child, res, plugins)
		}); err != nil {
			return err
		}
	}

	for _, plugin := range plugins {
		res.LastPlugin = plugin.Name
		if err := dispatchExit(plugin, node, res); err != nil {
			return err
		}
	}

	return nil
}

func dispatchEnter(plugin Plugin, node ast.Node, res *result.Result) error {
	switch current := node.(type) {
	case *ast.Root:
		if plugin.Root != nil {
			return plugin.Root(current, res)
		}
	case *ast.Rule:
		if plugin.Rule != nil {
			return plugin.Rule(current, res)
		}
	case *ast.AtRule:
		if plugin.AtRule != nil {
			if err := plugin.AtRule(current, res); err != nil {
				return err
			}
		}
		if plugin.AtRuleNamed != nil {
			if handler := plugin.AtRuleNamed[current.Name]; handler != nil {
				return handler(current, res)
			}
		}
	case *ast.Declaration:
		if plugin.Declaration != nil {
			if err := plugin.Declaration(current, res); err != nil {
				return err
			}
		}
		if plugin.DeclarationProp != nil {
			if handler := plugin.DeclarationProp[current.Prop]; handler != nil {
				return handler(current, res)
			}
		}
	case *ast.Comment:
		if plugin.Comment != nil {
			return plugin.Comment(current, res)
		}
	}
	return nil
}

func dispatchExit(plugin Plugin, node ast.Node, res *result.Result) error {
	switch current := node.(type) {
	case *ast.Root:
		if plugin.RootExit != nil {
			return plugin.RootExit(current, res)
		}
	case *ast.Rule:
		if plugin.RuleExit != nil {
			return plugin.RuleExit(current, res)
		}
	case *ast.AtRule:
		if plugin.AtRuleExit != nil {
			if err := plugin.AtRuleExit(current, res); err != nil {
				return err
			}
		}
		if plugin.AtRuleExitNamed != nil {
			if handler := plugin.AtRuleExitNamed[current.Name]; handler != nil {
				return handler(current, res)
			}
		}
	case *ast.Declaration:
		if plugin.DeclarationExit != nil {
			if err := plugin.DeclarationExit(current, res); err != nil {
				return err
			}
		}
		if plugin.DeclarationExitProp != nil {
			if handler := plugin.DeclarationExitProp[current.Prop]; handler != nil {
				return handler(current, res)
			}
		}
	case *ast.Comment:
		if plugin.CommentExit != nil {
			return plugin.CommentExit(current, res)
		}
	}
	return nil
}
