package ast

import (
	"errors"
	"reflect"
	"regexp"
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

func TestWalkTracksMutationLikePostCSS(t *testing.T) {
	root := NewRoot()
	rule := NewRule(".a")
	color := NewDeclaration("color", "red")
	zIndex := NewDeclaration("z-index", "1")
	rule.Append(color, zIndex)
	root.Append(rule)

	var visited []string
	err := WalkDecls(root, func(decl *Declaration) error {
		visited = append(visited, decl.Prop)
		switch decl.Prop {
		case "color":
			if _, err := decl.CloneBefore(NewDeclaration("-webkit-color", decl.Value)); err != nil {
				return err
			}
			if _, err := decl.CloneAfter(NewDeclaration("background", "blue")); err != nil {
				return err
			}
		case "z-index":
			decl.Remove()
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk failed: %v", err)
	}

	if !reflect.DeepEqual(visited, []string{"color", "background", "z-index"}) {
		t.Fatalf("unexpected visit order: %#v", visited)
	}
	var props []string
	for _, child := range rule.Children() {
		props = append(props, child.(*Declaration).Prop)
	}
	if !reflect.DeepEqual(props, []string{"-webkit-color", "color", "background"}) {
		t.Fatalf("unexpected declaration order after mutation: %#v", props)
	}
}

func TestFilteredWalkHelpers(t *testing.T) {
	root := NewRoot()
	ruleA := NewRule(".a")
	ruleA.Append(NewDeclaration("color", "red"), NewComment("a"))
	ruleB := NewRule(".b")
	ruleB.Append(NewDeclaration("background-color", "blue"))
	atRuleA := NewAtRule("media", "screen")
	atRuleA.Block = true
	atRuleA.Append(ruleA)
	atRuleB := NewAtRule("supports", "(display: grid)")
	atRuleB.Block = true
	atRuleB.Append(ruleB)
	root.Append(atRuleA, atRuleB)

	var decls []string
	if err := WalkDecls(root, regexp.MustCompile(`color$`), func(decl *Declaration) error {
		decls = append(decls, decl.Prop)
		return nil
	}); err != nil {
		t.Fatalf("walk decls failed: %v", err)
	}
	if !reflect.DeepEqual(decls, []string{"color", "background-color"}) {
		t.Fatalf("unexpected filtered declarations: %#v", decls)
	}

	var rules []string
	if err := WalkRules(root, ".b", func(rule *Rule) error {
		rules = append(rules, rule.Selector)
		return nil
	}); err != nil {
		t.Fatalf("walk rules failed: %v", err)
	}
	if !reflect.DeepEqual(rules, []string{".b"}) {
		t.Fatalf("unexpected filtered rules: %#v", rules)
	}

	var atRules []string
	if err := WalkAtRules(root, regexp.MustCompile(`^m`), func(rule *AtRule) error {
		atRules = append(atRules, rule.Name)
		return nil
	}); err != nil {
		t.Fatalf("walk at-rules failed: %v", err)
	}
	if !reflect.DeepEqual(atRules, []string{"media"}) {
		t.Fatalf("unexpected filtered at-rules: %#v", atRules)
	}
}

func TestWalkRejectsInvalidFilterSignature(t *testing.T) {
	root := NewRoot()
	root.Append(NewRule(".a"))

	if err := WalkDecls(root, 123, func(*Declaration) error { return nil }); err == nil {
		t.Fatal("expected invalid decl filter to fail")
	}
	if err := WalkRules(root); err == nil {
		t.Fatal("expected missing rule callback to fail")
	}
	if err := WalkAtRules(root, ".a", ".b"); err == nil {
		t.Fatal("expected invalid at-rule callback signature to fail")
	}
}
