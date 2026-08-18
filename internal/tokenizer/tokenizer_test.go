package tokenizer

import (
	"reflect"
	"strings"
	"testing"
)

func tokenizeAll(t *testing.T, input string, opts Options, nextOpts NextOptions) []Token {
	t.Helper()
	tok := New(input, opts)
	var tokens []Token
	for !tok.EOF() {
		token, err := tok.Next(nextOpts)
		if err != nil {
			t.Fatalf("tokenize %q: %v", input, err)
		}
		tokens = append(tokens, token)
	}
	return tokens
}

func TestTokenizerNextBackAndEOF(t *testing.T) {
	input := `@media screen { color: url("a;b"); /* c */ }`
	tok := New(input, Options{})

	first, err := tok.Next(NextOptions{})
	if err != nil || first.Kind != "at-word" || first.Text(input) != "@media" {
		t.Fatalf("unexpected first token: %#v err=%v", first, err)
	}
	tok.Back(first)
	again, err := tok.Next(NextOptions{})
	if err != nil || again != first {
		t.Fatalf("expected backed token, got %#v err=%v", again, err)
	}

	var kinds []string
	for !tok.EOF() {
		token, err := tok.Next(NextOptions{})
		if err != nil {
			break
		}
		kinds = append(kinds, token.Kind)
	}
	if len(kinds) == 0 || kinds[len(kinds)-1] != "}" {
		t.Fatalf("unexpected token stream: %#v", kinds)
	}
	if !tok.EOF() {
		t.Fatal("expected EOF after consuming all tokens")
	}
}

func TestTokenizerErrorsAndHelpers(t *testing.T) {
	tok := New(`"unterminated`, Options{})
	if _, err := tok.Next(NextOptions{}); err == nil || !strings.Contains(err.Error(), "Unclosed string") {
		t.Fatalf("expected unclosed string error, got %v", err)
	}

	tok = New(`/* missing`, Options{})
	if _, err := tok.Next(NextOptions{}); err == nil || !strings.Contains(err.Error(), "Unclosed comment") {
		t.Fatalf("expected unclosed comment error, got %v", err)
	}

	tok = New(`url(foo`, Options{})
	if _, err := tok.Next(NextOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := tok.Next(NextOptions{}); err == nil || !strings.Contains(err.Error(), "Unclosed bracket") {
		t.Fatalf("expected unclosed bracket error, got %v", err)
	}
}

func TestTokenizerMapsPostCSSTokensToInternalKinds(t *testing.T) {
	tok := New(" \n/* c */ @media : ; { } [ ] ( ) .a", Options{})
	want := []string{"space", "comment", "space", "at-word", "space", ":", "space", ";", "space", "{", "space", "}", "space", "[", "space", "]", "space", "brackets", "space", "word"}
	var got []string
	for !tok.EOF() {
		token, err := tok.Next(NextOptions{})
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, token.Kind)
	}
	if len(got) != len(want) {
		t.Fatalf("token count mismatch: got=%d want=%d (%#v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("token[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestTokenizerCategoriesAndRanges(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []Token
	}{
		{name: "empty", input: "", want: nil},
		{name: "space", input: "\r\n \f\t", want: []Token{{Kind: "space", Start: 0, End: 4}}},
		{name: "word", input: "aa!bb", want: []Token{
			{Kind: "word", Start: 0, End: 1},
			{Kind: "word", Start: 2, End: 4},
		}},
		{name: "control", input: "{:;}[]", want: []Token{
			{Kind: "{", Start: 0, End: 0},
			{Kind: ":", Start: 1, End: 1},
			{Kind: ";", Start: 2, End: 2},
			{Kind: "}", Start: 3, End: 3},
			{Kind: "[", Start: 4, End: 4},
			{Kind: "]", Start: 5, End: 5},
		}},
		{name: "at-word", input: "@media ", want: []Token{
			{Kind: "at-word", Start: 0, End: 5},
			{Kind: "space", Start: 6, End: 6},
		}},
		{name: "comment", input: "/* c */", want: []Token{{Kind: "comment", Start: 0, End: 6}}},
		{name: "string", input: `"a\"b"`, want: []Token{{Kind: "string", Start: 0, End: 5}}},
		{name: "url", input: "url(foo)", want: []Token{
			{Kind: "word", Start: 0, End: 2},
			{Kind: "brackets", Start: 3, End: 7},
		}},
		{name: "parentheses", input: "(foo)", want: []Token{{Kind: "brackets", Start: 0, End: 4}}},
		{name: "escape", input: `\26 B`, want: []Token{
			{Kind: "word", Start: 0, End: 3},
			{Kind: "word", Start: 4, End: 4},
		}},
		{name: "utf8", input: "中🔥", want: []Token{{Kind: "word", Start: 0, End: len("中🔥") - 1}}},
		{name: "quoted-url", input: `url(")")`, want: []Token{
			{Kind: "word", Start: 0, End: 2},
			{Kind: "(", Start: 3, End: 3},
			{Kind: "string", Start: 4, End: 6},
			{Kind: ")", Start: 7, End: 7},
		}},
		{name: "hex-escape", input: `\0a \09 \z `, want: []Token{
			{Kind: "word", Start: 0, End: 3},
			{Kind: "word", Start: 4, End: 7},
			{Kind: "word", Start: 8, End: 9},
			{Kind: "space", Start: 10, End: 10},
		}},
		{name: "unclosed-paren", input: "(", want: []Token{{Kind: "(", Start: 0, End: 0}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tokenizeAll(t, tt.input, Options{}, NextOptions{}); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("tokens = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestTokenizerSplitsWordAtBangWithoutLosingBang(t *testing.T) {
	tok := New("aa!bb", Options{})
	want := []Token{
		{Kind: "word", Start: 0, End: 1},
		{Kind: "word", Start: 2, End: 4},
	}
	for index, expected := range want {
		got, err := tok.Next(NextOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if got != expected {
			t.Fatalf("token[%d] = %#v, want %#v", index, got, expected)
		}
	}
}

func TestTokenizerPositionUsesByteOffsets(t *testing.T) {
	tok := New("Three tokens", Options{})
	if got := tok.Position(); got != 0 {
		t.Fatalf("position() = %d, want 0", got)
	}
	for _, want := range []int{5, 6, 12} {
		if _, err := tok.Next(NextOptions{}); err != nil {
			t.Fatal(err)
		}
		if got := tok.Position(); got != want {
			t.Fatalf("position() = %d, want %d", got, want)
		}
	}
}

func TestTokenizerIgnoreUnclosedPerToken(t *testing.T) {
	input := "How's it going ("
	got := tokenizeAll(t, input, Options{}, NextOptions{IgnoreUnclosed: true})
	want := []Token{
		{Kind: "word", Start: 0, End: 2},
		{Kind: "string", Start: 3, End: 4},
		{Kind: "space", Start: 5, End: 5},
		{Kind: "word", Start: 6, End: 7},
		{Kind: "space", Start: 8, End: 8},
		{Kind: "word", Start: 9, End: 13},
		{Kind: "space", Start: 14, End: 14},
		{Kind: "(", Start: 15, End: 15},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tokens = %#v, want %#v", got, want)
	}
}

func TestTokenizerComplicatedBrackets(t *testing.T) {
	input := "(())(\"\")(/**/)(\\\\)(\n)("
	got := tokenizeAll(t, input, Options{}, NextOptions{})
	wantKinds := []string{"(", "(", ")", ")", "(", "string", ")", "(", "comment", ")", "(", "word", ")", "(", "space", ")", "("}
	if len(got) != len(wantKinds) {
		t.Fatalf("token count = %d (%#v), want %d", len(got), got, len(wantKinds))
	}
	for index, kind := range wantKinds {
		if got[index].Kind != kind {
			t.Fatalf("token[%d] = %#v, want kind %q", index, got[index], kind)
		}
	}
}

func TestTokenizerIgnoreUnclosedString(t *testing.T) {
	tok := New(`"unterminated`, Options{})
	token, err := tok.Next(NextOptions{IgnoreUnclosed: true})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token.Kind != "string" || token.Text(`"unterminated`) != `"u` {
		t.Fatalf("unexpected token: %#v", token)
	}
}

func TestTokenizerIgnoreErrors(t *testing.T) {
	tests := []struct {
		name  string
		input string
		kind  string
	}{
		{name: "string", input: `"x`, kind: "string"},
		{name: "comment", input: "/* x", kind: "comment"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tokens := tokenizeAll(t, tt.input, Options{IgnoreErrors: true}, NextOptions{})
			if len(tokens) != 1 || tokens[0].Kind != tt.kind {
				t.Fatalf("tokens = %#v, want one %q token", tokens, tt.kind)
			}
		})
	}
}

// hasBadParenContent replaces the `.[\r\n"'(/\\]` regexp; keep the byte scan
// pinned to that pattern's semantics, notably that `.` does not match `\n`.
func TestHasBadParenContent(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{input: "", want: false},
		{input: "(a)", want: false},
		{input: "(", want: false},
		{input: "((", want: true},
		{input: "(a/b)", want: true},
		{input: `(a"b)`, want: true},
		{input: "(a'b)", want: true},
		{input: `(a\b)`, want: true},
		{input: "(a\rb)", want: true},
		{input: "(a\nb)", want: true},
		{input: "\n/", want: false},
		{input: "\n\n", want: false},
		{input: "中/", want: true},
	}
	for _, tt := range tests {
		if got := hasBadParenContent(tt.input); got != tt.want {
			t.Fatalf("hasBadParenContent(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestTokenizerErrorsUseUTF16Columns(t *testing.T) {
	tok := New("中🔥\"", Options{})
	if _, err := tok.Next(NextOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := tok.Next(NextOptions{}); err == nil || !strings.Contains(err.Error(), ":1:4: Unclosed string") {
		t.Fatalf("expected UTF-16 error position, got %v", err)
	}
}
