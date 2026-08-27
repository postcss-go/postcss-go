package ast

import (
	"errors"
	"reflect"
	"regexp"
	"testing"

	csserrors "github.com/postcss-go/postcss-go/internal/csserrors"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
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
	if err := WalkRules(root, 1, func(*Rule) error { return nil }); err == nil {
		t.Fatal("expected invalid rule filter to fail")
	}
	if err := WalkAtRules(root, true, func(*AtRule) error { return nil }); err == nil {
		t.Fatal("expected invalid atrule filter to fail")
	}
}

func TestWalkStringFiltersAndEachFallback(t *testing.T) {
	root := NewRoot()
	rule := NewRule(".exact")
	rule.Append(NewDeclaration("color", "red"), NewDeclaration("margin", "0"))
	atRule := NewAtRule("media", "all")
	atRule.Block = true
	root.Append(rule, atRule)

	var props []string
	if err := WalkDecls(root, "color", func(decl *Declaration) error {
		props = append(props, decl.Prop)
		return nil
	}); err != nil {
		t.Fatalf("string decl filter: %v", err)
	}
	if !reflect.DeepEqual(props, []string{"color"}) {
		t.Fatalf("unexpected props: %#v", props)
	}

	var rules []string
	if err := WalkRules(root, regexp.MustCompile(`exact`), func(rule *Rule) error {
		rules = append(rules, rule.Selector)
		return nil
	}); err != nil {
		t.Fatalf("regexp rule filter: %v", err)
	}
	if !reflect.DeepEqual(rules, []string{".exact"}) {
		t.Fatalf("unexpected rules: %#v", rules)
	}

	var names []string
	if err := WalkAtRules(root, "media", func(rule *AtRule) error {
		names = append(names, rule.Name)
		return nil
	}); err != nil {
		t.Fatalf("string atrule filter: %v", err)
	}
	if !reflect.DeepEqual(names, []string{"media"}) {
		t.Fatalf("unexpected atrules: %#v", names)
	}

	plain := &plainContainer{nodes: []Node{NewRule(".plain")}}
	var seen []string
	if err := Each(plain, func(node Node, index int) error {
		seen = append(seen, node.(*Rule).Selector)
		if index != 0 {
			t.Fatalf("unexpected index %d", index)
		}
		return nil
	}); err != nil {
		t.Fatalf("each fallback: %v", err)
	}
	if !reflect.DeepEqual(seen, []string{".plain"}) {
		t.Fatalf("unexpected each fallback visit: %#v", seen)
	}
	sentinel := errors.New("stop-each")
	if err := Each(plain, func(Node, int) error { return sentinel }); !errors.Is(err, sentinel) {
		t.Fatalf("expected each fallback error, got %v", err)
	}
}

// plainContainer implements Container without iterator tracking so Each uses
// the non-mutating fallback path.
type plainContainer struct {
	nodes []Node
}

func (p *plainContainer) Type() NodeType                   { return NodeRoot }
func (p *plainContainer) Parent() Container                { return nil }
func (p *plainContainer) SetParent(Container)              {}
func (p *plainContainer) Range() SourceRange               { return SourceRange{} }
func (p *plainContainer) SetRange(SourceRange)             {}
func (p *plainContainer) Source() *sourcemap.Location      { return nil }
func (p *plainContainer) SetSource(*sourcemap.Location)    {}
func (p *plainContainer) RawFormatting() Raws              { return Raws{} }
func (p *plainContainer) RawFormattingReadOnly() Raws      { return nil }
func (p *plainContainer) Children() []Node                 { return p.nodes }
func (p *plainContainer) Append(...Node)                   {}
func (p *plainContainer) Prepend(...Node)                  {}
func (p *plainContainer) InsertBefore(Node, ...Node) error { return nil }
func (p *plainContainer) InsertAfter(Node, ...Node) error  { return nil }
func (p *plainContainer) RemoveChild(Node) error           { return nil }
func (p *plainContainer) Index(Node) int                   { return -1 }
func (p *plainContainer) First() Node                      { return nil }
func (p *plainContainer) Last() Node                       { return nil }
func (p *plainContainer) RemoveAll()                       {}
func (p *plainContainer) Some(func(Node) bool) bool        { return false }
func (p *plainContainer) Every(func(Node) bool) bool       { return true }
func (p *plainContainer) Root() Node                       { return p }
func (p *plainContainer) Next() Node                       { return nil }
func (p *plainContainer) Prev() Node                       { return nil }
func (p *plainContainer) Remove() Node                     { return p }
func (p *plainContainer) ReplaceWith(...Node) error        { return nil }
func (p *plainContainer) Clone() Node                      { return p }
func (p *plainContainer) CloneBefore(...Node) (Node, error) {
	return p, nil
}
func (p *plainContainer) CloneAfter(...Node) (Node, error) { return p, nil }
func (p *plainContainer) Before(...Node) error             { return nil }
func (p *plainContainer) After(...Node) error              { return nil }
func (p *plainContainer) Error(string, ...ErrorOptions) *csserrors.SyntaxError {
	return nil
}
