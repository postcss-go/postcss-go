package ast

import (
	"fmt"
	"regexp"
)

var (
	errWalkerSignature = fmt.Errorf("walker expects callback or filter plus callback")
	errWalkerFilter    = fmt.Errorf("walker filter must be a string or regexp")
)

func Each(container Container, fn func(Node, int) error) error {
	tracked, ok := container.(iteratorContainer)
	if !ok {
		for index, child := range container.Children() {
			if err := fn(child, index); err != nil {
				return err
			}
		}
		return nil
	}

	iterator := tracked.nextIterator()
	defer tracked.dropIterator(iterator)

	for tracked.iteratorIndex(iterator) < len(container.Children()) {
		index := tracked.iteratorIndex(iterator)
		if err := fn(container.Children()[index], index); err != nil {
			return err
		}
		tracked.advanceIterator(iterator)
	}
	return nil
}

func Walk(node Node, fn func(Node) error) error {
	if err := fn(node); err != nil {
		return err
	}
	container, ok := node.(Container)
	if !ok {
		return nil
	}
	return Each(container, func(child Node, _ int) error {
		return Walk(child, fn)
	})
}

func WalkRules(node Node, filtersAndFn ...any) error {
	filter, fn, err := resolveWalker(filtersAndFn, matchRule)
	if err != nil {
		return err
	}
	return Walk(node, func(current Node) error {
		rule, ok := current.(*Rule)
		if !ok || !filter(rule) {
			return nil
		}
		return fn(rule)
	})
}

func WalkAtRules(node Node, filtersAndFn ...any) error {
	filter, fn, err := resolveWalker(filtersAndFn, matchAtRule)
	if err != nil {
		return err
	}
	return Walk(node, func(current Node) error {
		atRule, ok := current.(*AtRule)
		if !ok || !filter(atRule) {
			return nil
		}
		return fn(atRule)
	})
}

func WalkDecls(node Node, filtersAndFn ...any) error {
	filter, fn, err := resolveWalker(filtersAndFn, matchDeclaration)
	if err != nil {
		return err
	}
	return Walk(node, func(current Node) error {
		decl, ok := current.(*Declaration)
		if !ok || !filter(decl) {
			return nil
		}
		return fn(decl)
	})
}

func WalkComments(node Node, fn func(*Comment) error) error {
	return Walk(node, func(current Node) error {
		comment, ok := current.(*Comment)
		if !ok {
			return nil
		}
		return fn(comment)
	})
}

func resolveWalker[T Node](
	filtersAndFn []any,
	matcher func(any) (func(T) bool, error),
) (func(T) bool, func(T) error, error) {
	if len(filtersAndFn) == 0 || len(filtersAndFn) > 2 {
		return nil, nil, errWalkerSignature
	}

	callback, ok := filtersAndFn[len(filtersAndFn)-1].(func(T) error)
	if !ok {
		return nil, nil, errWalkerSignature
	}

	if len(filtersAndFn) == 1 {
		return func(T) bool { return true }, callback, nil
	}

	filter, err := matcher(filtersAndFn[0])
	if err != nil {
		return nil, nil, err
	}
	return filter, callback, nil
}

func matchDeclaration(filter any) (func(*Declaration) bool, error) {
	switch value := filter.(type) {
	case string:
		return func(decl *Declaration) bool { return decl.Prop == value }, nil
	case *regexp.Regexp:
		return func(decl *Declaration) bool { return value.MatchString(decl.Prop) }, nil
	default:
		return nil, errWalkerFilter
	}
}

func matchRule(filter any) (func(*Rule) bool, error) {
	switch value := filter.(type) {
	case string:
		return func(rule *Rule) bool { return rule.Selector == value }, nil
	case *regexp.Regexp:
		return func(rule *Rule) bool { return value.MatchString(rule.Selector) }, nil
	default:
		return nil, errWalkerFilter
	}
}

func matchAtRule(filter any) (func(*AtRule) bool, error) {
	switch value := filter.(type) {
	case string:
		return func(rule *AtRule) bool { return rule.Name == value }, nil
	case *regexp.Regexp:
		return func(rule *AtRule) bool { return value.MatchString(rule.Name) }, nil
	default:
		return nil, errWalkerFilter
	}
}
