package processor

import (
	"postcss-go/internal/ast"
	"postcss-go/internal/parser"
	"postcss-go/internal/result"
	"postcss-go/internal/source"
	"postcss-go/internal/stringifier"
)

type Options struct {
	From string
}

type Visitor struct {
	Once            func(*ast.Root, *result.Result) error
	OnceExit        func(*ast.Root, *result.Result) error
	Root            func(*ast.Root, *result.Result) error
	RootExit        func(*ast.Root, *result.Result) error
	Rule            func(*ast.Rule, *result.Result) error
	RuleExit        func(*ast.Rule, *result.Result) error
	AtRule          func(*ast.AtRule, *result.Result) error
	AtRuleExit      func(*ast.AtRule, *result.Result) error
	Declaration     func(*ast.Declaration, *result.Result) error
	DeclarationExit func(*ast.Declaration, *result.Result) error
	Comment         func(*ast.Comment, *result.Result) error
	CommentExit     func(*ast.Comment, *result.Result) error
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
	root, err := parser.Parse(css, source.Options{From: opts.From})
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

	res.CSS = stringifier.Stringify(root)
	return res, nil
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
		children := append([]ast.Node(nil), container.Children()...)
		for _, child := range children {
			if err := walk(child, res, plugins); err != nil {
				return err
			}
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
			return plugin.AtRule(current, res)
		}
	case *ast.Declaration:
		if plugin.Declaration != nil {
			return plugin.Declaration(current, res)
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
			return plugin.AtRuleExit(current, res)
		}
	case *ast.Declaration:
		if plugin.DeclarationExit != nil {
			return plugin.DeclarationExit(current, res)
		}
	case *ast.Comment:
		if plugin.CommentExit != nil {
			return plugin.CommentExit(current, res)
		}
	}
	return nil
}
