package api_test

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	gosourcemap "github.com/go-sourcemap/sourcemap"
	postcss "github.com/postcss-go/postcss-go/pkg/api"
)

type contractAST struct {
	Type     string         `json:"type"`
	Source   *contractRange `json:"source,omitempty"`
	Selector string         `json:"selector,omitempty"`
	Name     string         `json:"name,omitempty"`
	Params   string         `json:"params,omitempty"`
	Prop     string         `json:"prop,omitempty"`
	Value    string         `json:"value,omitempty"`
	Text     string         `json:"text,omitempty"`
	Nodes    []contractAST  `json:"nodes,omitempty"`
}

type contractRange struct {
	Start [2]int `json:"start"`
	End   [2]int `json:"end"`
}

type coreContract struct {
	CSS            string          `json:"css"`
	From           string          `json:"from"`
	To             string          `json:"to"`
	PreviousMap    json.RawMessage `json:"previousMap"`
	PreviousSource string          `json:"previousSource"`
	PreviousMapURL string          `json:"previousMapUrl"`
	RoundTrips     []struct {
		Name string      `json:"name"`
		CSS  string      `json:"css"`
		AST  contractAST `json:"ast"`
	} `json:"roundTrips"`
	DocumentCSS    string `json:"documentCss"`
	NoWorkCleanCSS string `json:"noWorkCleanCss"`
	Mutation       struct {
		CSS         string `json:"css"`
		ExpectedCSS string `json:"expectedCss"`
	} `json:"mutation"`
	MapChecks []struct {
		Generated [2]int `json:"generated"`
		Original  [2]int `json:"original"`
	} `json:"mapChecks"`
	Errors []struct {
		Name   string `json:"name"`
		CSS    string `json:"css"`
		Line   int    `json:"line"`
		Column int    `json:"column"`
		Reason string `json:"reason"`
	} `json:"errors"`
}

func loadPublicCoreContract(t *testing.T) coreContract {
	t.Helper()
	data, err := os.ReadFile("../../packages/postcss-go/test/testdata/core-css-contract.json")
	if err != nil {
		t.Fatalf("read Core CSS contract: %v", err)
	}
	var contract coreContract
	if err := json.Unmarshal(data, &contract); err != nil {
		t.Fatalf("decode Core CSS contract: %v", err)
	}
	return contract
}

func normalizeGoAST(node postcss.Node) contractAST {
	normalized := contractAST{Type: string(node.Type())}
	if source := node.Source(); source != nil {
		end := source.End
		switch current := node.(type) {
		case *postcss.Rule:
			if offset, ok := matchingBlockEnd(source.Input.CSS, source.Start.Offset); ok {
				end = source.Input.FromOffset(offset)
			}
		case *postcss.AtRule:
			if current.Block {
				if offset, ok := matchingBlockEnd(source.Input.CSS, source.Start.Offset); ok {
					end = source.Input.FromOffset(offset)
				}
			} else if end.Offset > source.Start.Offset {
				end = source.Input.FromOffset(end.Offset - 1)
			}
		case *postcss.Declaration, *postcss.Comment:
			if end.Offset > source.Start.Offset {
				end = source.Input.FromOffset(end.Offset - 1)
			}
		}
		normalized.Source = &contractRange{
			Start: [2]int{source.Start.Line, source.Start.Column},
			End:   [2]int{end.Line, end.Column},
		}
	}
	switch current := node.(type) {
	case *postcss.Rule:
		normalized.Selector = current.Selector
	case *postcss.AtRule:
		normalized.Name = current.Name
		normalized.Params = current.Params
	case *postcss.Declaration:
		normalized.Prop = current.Prop
		normalized.Value = current.Value
	case *postcss.Comment:
		normalized.Text = current.Text
	}
	if container, ok := node.(postcss.Container); ok {
		for _, child := range container.Children() {
			normalized.Nodes = append(normalized.Nodes, normalizeGoAST(child))
		}
	}
	return normalized
}

func matchingBlockEnd(css string, start int) (int, bool) {
	depth := 0
	quote := byte(0)
	escaped := false
	inComment := false
	for index := start; index < len(css); index++ {
		current := css[index]
		if inComment {
			if current == '*' && index+1 < len(css) && css[index+1] == '/' {
				inComment = false
				index++
			}
			continue
		}
		if quote != 0 {
			if escaped {
				escaped = false
			} else if current == '\\' {
				escaped = true
			} else if current == quote {
				quote = 0
			}
			continue
		}
		if current == '/' && index+1 < len(css) && css[index+1] == '*' {
			inComment = true
			index++
			continue
		}
		if current == '\'' || current == '"' {
			quote = current
			continue
		}
		switch current {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return index, true
			}
		}
	}
	return 0, false
}

func TestPublicGoCoreCSSContract(t *testing.T) {
	contract := loadPublicCoreContract(t)
	for _, scenario := range contract.RoundTrips {
		root, err := postcss.ParseWithOptions(scenario.CSS, postcss.ParseOptions{From: contract.From})
		if err != nil {
			t.Fatalf("%s: parse: %v", scenario.Name, err)
		}
		if got := normalizeGoAST(root); !reflect.DeepEqual(got, scenario.AST) {
			gotJSON, _ := json.MarshalIndent(got, "", "  ")
			wantJSON, _ := json.MarshalIndent(scenario.AST, "", "  ")
			t.Fatalf("%s: AST mismatch\nwant: %s\ngot: %s", scenario.Name, wantJSON, gotJSON)
		}
		if got := postcss.Stringify(root); got != scenario.CSS {
			t.Fatalf("%s: round-trip mismatch\nwant: %q\ngot: %q", scenario.Name, scenario.CSS, got)
		}
	}

	first, err := postcss.Parse("a { color: red; }\n")
	if err != nil {
		t.Fatal(err)
	}
	second, err := postcss.Parse("b { color: blue; }\n")
	if err != nil {
		t.Fatal(err)
	}
	document := postcss.NewDocument()
	document.Append(first, second)
	if got := postcss.Stringify(document); got != contract.DocumentCSS {
		t.Fatalf("Document stringify mismatch: want %q, got %q", contract.DocumentCSS, got)
	}

	mutated, err := postcss.New(postcss.Plugin{
		Name: "core-contract-mutation",
		Visitor: postcss.Visitor{Declaration: func(decl *postcss.Declaration, _ *postcss.Result) error {
			if decl.Prop == "color" {
				decl.Value = "teal"
			}
			return nil
		}},
	}).Process(contract.Mutation.CSS)
	if err != nil {
		t.Fatalf("mutation process: %v", err)
	}
	if mutated.CSS != contract.Mutation.ExpectedCSS {
		t.Fatalf("mutation mismatch: want %q, got %q", contract.Mutation.ExpectedCSS, mutated.CSS)
	}

	for _, expected := range contract.Errors {
		_, err := postcss.ParseWithOptions(expected.CSS, postcss.ParseOptions{From: contract.From})
		var syntaxErr *postcss.CssSyntaxError
		if !errors.As(err, &syntaxErr) {
			t.Fatalf("%s: expected CssSyntaxError, got %T (%v)", expected.Name, err, err)
		}
		if syntaxErr.Line != expected.Line || syntaxErr.Column != expected.Column || syntaxErr.Reason != expected.Reason {
			t.Fatalf("%s: unexpected error %d:%d %q", expected.Name, syntaxErr.Line, syntaxErr.Column, syntaxErr.Reason)
		}
	}
}

func TestPublicGoCoreCSSSourceMapContract(t *testing.T) {
	contract := loadPublicCoreContract(t)
	inline := false
	result, err := postcss.New().Process(contract.CSS, postcss.ProcessOptions{
		From:                  contract.From,
		To:                    contract.To,
		Map:                   true,
		MapInline:             &inline,
		MapAnnotationDisabled: true,
	})
	if err != nil {
		t.Fatalf("process mapped CSS: %v", err)
	}
	consumer, err := gosourcemap.Parse(contract.To+".map", []byte(result.Map))
	if err != nil {
		t.Fatalf("parse source map: %v", err)
	}
	if consumer.File() != "output.css" {
		t.Fatalf("unexpected map file: %q", consumer.File())
	}
	for _, check := range contract.MapChecks {
		_, _, line, column, ok := consumer.Source(check.Generated[0], check.Generated[1])
		if !ok || line != check.Original[0] || column != check.Original[1] {
			t.Fatalf("mapping %v resolved to %d:%d (ok=%v), expected %v", check.Generated, line, column, ok, check.Original)
		}
	}
	if content := consumer.SourceContent("input.css"); content != contract.CSS {
		t.Fatalf("unexpected sourcesContent: %q", content)
	}

	composed, err := postcss.New().Process(contract.CSS, postcss.ProcessOptions{
		From:                  contract.From,
		To:                    contract.To,
		Map:                   true,
		MapInline:             &inline,
		MapAnnotationDisabled: true,
		PreviousMap:           string(contract.PreviousMap),
		PreviousMapURL:        contract.PreviousMapURL,
	})
	if err != nil {
		t.Fatalf("compose previous map: %v", err)
	}
	if !strings.Contains(composed.Map, contract.PreviousSource) {
		t.Fatalf("composed map is missing %q: %s", contract.PreviousSource, composed.Map)
	}

	inlineResult, err := postcss.New().Process(contract.CSS, postcss.ProcessOptions{
		From: contract.From,
		To:   contract.To,
		Map:  true,
	})
	if err != nil {
		t.Fatalf("inline map: %v", err)
	}
	if !strings.Contains(inlineResult.CSS, "sourceMappingURL=data:application/json;base64,") {
		t.Fatalf("inline annotation missing: %q", inlineResult.CSS)
	}

	stale := contract.CSS + "/*# sourceMappingURL=stale.css.map */\n"
	noWork, err := postcss.NoWork(stale, postcss.ProcessOptions{})
	if err != nil {
		t.Fatalf("noWork cleanup: %v", err)
	}
	if noWork.CSS != contract.NoWorkCleanCSS {
		t.Fatalf("noWork annotation cleanup mismatch: want %q, got %q", contract.NoWorkCleanCSS, noWork.CSS)
	}
}

func TestPublicFacadeHelpers(t *testing.T) {
	root := postcss.NewRoot()
	doc := postcss.NewDocument()
	rule := postcss.NewRule(".card")
	at := postcss.NewAtRule("media", "screen")
	decl := postcss.NewDeclaration("color", "red")
	comment := postcss.NewComment("note")
	rule.Append(decl, comment)
	root.Append(rule)
	doc.Append(root)

	if at.Name != "media" || at.Params != "screen" {
		t.Fatalf("unexpected at-rule: %#v", at)
	}
	if got := postcss.Stringify(root); !strings.Contains(got, "color: red") {
		t.Fatalf("unexpected stringify: %q", got)
	}

	input, err := postcss.NewInput(".x{}", postcss.ParseOptions{From: "facade.css"})
	if err != nil || !strings.HasSuffix(input.From(), "facade.css") {
		t.Fatalf("NewInput failed: input=%#v err=%v", input, err)
	}

	var walked []string
	if err := postcss.Walk(root, func(node postcss.Node) error {
		walked = append(walked, string(node.Type()))
		return nil
	}); err != nil {
		t.Fatalf("Walk failed: %v", err)
	}
	if len(walked) < 3 {
		t.Fatalf("expected walk to visit nodes, got %#v", walked)
	}
	if err := postcss.WalkRules(root, func(rule *postcss.Rule) error {
		if rule.Selector != ".card" {
			t.Fatalf("unexpected rule: %q", rule.Selector)
		}
		return nil
	}); err != nil {
		t.Fatalf("WalkRules failed: %v", err)
	}
	if err := postcss.WalkAtRules(doc, func(rule *postcss.AtRule) error { return nil }); err != nil {
		t.Fatalf("WalkAtRules failed: %v", err)
	}
	if err := postcss.WalkDecls(root, func(decl *postcss.Declaration) error {
		if decl.Prop != "color" {
			t.Fatalf("unexpected decl: %#v", decl)
		}
		return nil
	}); err != nil {
		t.Fatalf("WalkDecls failed: %v", err)
	}
	if err := postcss.WalkComments(root, func(c *postcss.Comment) error {
		if c.Text != "note" {
			t.Fatalf("unexpected comment: %q", c.Text)
		}
		return nil
	}); err != nil {
		t.Fatalf("WalkComments failed: %v", err)
	}

	stringified, err := postcss.StringifyWithOptions(root, postcss.ProcessOptions{})
	if err != nil || !strings.Contains(stringified.CSS, ".card") {
		t.Fatalf("StringifyWithOptions failed: %#v err=%v", stringified, err)
	}
}
