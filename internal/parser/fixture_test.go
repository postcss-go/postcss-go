package parser

import (
	"testing"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
)

func TestParseFixtureSimpleRule(t *testing.T) {
	root, err := Parse(".a { color: black; }", sourcemap.Options{From: "a.css"})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if len(root.Children()) != 1 {
		t.Fatalf("expected 1 child, got %d", len(root.Children()))
	}
	rule, ok := root.Children()[0].(*ast.Rule)
	if !ok {
		t.Fatalf("expected rule node, got %T", root.Children()[0])
	}
	if rule.Selector != ".a" {
		t.Fatalf("selector = %q, want %q", rule.Selector, ".a")
	}
	if len(rule.Children()) != 1 {
		t.Fatalf("expected 1 declaration, got %d", len(rule.Children()))
	}
	decl, ok := rule.Children()[0].(*ast.Declaration)
	if !ok {
		t.Fatalf("expected declaration, got %T", rule.Children()[0])
	}
	if decl.Prop != "color" || decl.Value != "black" {
		t.Fatalf("unexpected declaration: %#v", decl)
	}
}

func TestParseFixtureAtRuleBlock(t *testing.T) {
	root, err := Parse("@media screen { .a { color: red; } }", sourcemap.Options{})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	atRule, ok := root.Children()[0].(*ast.AtRule)
	if !ok {
		t.Fatalf("expected at-rule, got %T", root.Children()[0])
	}
	if atRule.Name != "media" || !atRule.Block {
		t.Fatalf("unexpected at-rule: %#v", atRule)
	}
}
