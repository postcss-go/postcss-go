package ast

import (
	"errors"
	"reflect"
	"testing"
)

func TestWalkHelpers(t *testing.T) {
	root := NewRoot()
	rule := NewRule(".a")
	rule.Append(NewDeclaration("color", "red"), NewComment("c"))
	atRule := NewAtRule("media", "screen")
	atRule.Block = true
	atRule.Append(NewRule(".b"))
	root.Append(rule, atRule)

	var types []NodeType
	if err := Walk(root, func(node Node) error {
		types = append(types, node.Type())
		return nil
	}); err != nil {
		t.Fatalf("walk failed: %v", err)
	}
	want := []NodeType{NodeRoot, NodeRule, NodeDecl, NodeComment, NodeAtRule, NodeRule}
	if !reflect.DeepEqual(types, want) {
		t.Fatalf("unexpected walk order: %#v", types)
	}

	var rules []string
	_ = WalkRules(root, func(rule *Rule) error {
		rules = append(rules, rule.Selector)
		return nil
	})
	if !reflect.DeepEqual(rules, []string{".a", ".b"}) {
		t.Fatalf("unexpected rule selectors: %#v", rules)
	}

	var atRules []string
	_ = WalkAtRules(root, func(rule *AtRule) error {
		atRules = append(atRules, rule.Name)
		return nil
	})
	if !reflect.DeepEqual(atRules, []string{"media"}) {
		t.Fatalf("unexpected at-rules: %#v", atRules)
	}

	var decls []string
	_ = WalkDecls(root, func(decl *Declaration) error {
		decls = append(decls, decl.Prop)
		return nil
	})
	if !reflect.DeepEqual(decls, []string{"color"}) {
		t.Fatalf("unexpected declarations: %#v", decls)
	}

	var comments []string
	_ = WalkComments(root, func(comment *Comment) error {
		comments = append(comments, comment.Text)
		return nil
	})
	if !reflect.DeepEqual(comments, []string{"c"}) {
		t.Fatalf("unexpected comments: %#v", comments)
	}
}

func TestWalkStopsOnError(t *testing.T) {
	root := NewRoot()
	root.Append(NewRule(".a"))
	sentinel := errors.New("stop")
	err := Walk(root, func(node Node) error {
		if node.Type() == NodeRule {
			return sentinel
		}
		return nil
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected sentinel error, got %v", err)
	}
}
