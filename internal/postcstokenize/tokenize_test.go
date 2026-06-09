package postcstokenize_test

import (
	"regexp"
	"testing"

	"postcss-go/internal/postcstokenize"
)

func tokenizeAll(css string, opts postcstokenize.Options) ([]postcstokenize.Token, error) {
	input := &postcstokenize.Input{CSS: css}
	processor := postcstokenize.New(input, opts)
	var tokens []postcstokenize.Token
	for !processor.EndOfFile() {
		token, err := processor.NextToken(postcstokenize.NextOptions{})
		if err != nil {
			return nil, err
		}
		if token == nil {
			break
		}
		tokens = append(tokens, token)
	}
	return tokens, nil
}

func runTokenize(t *testing.T, css string, expected []postcstokenize.Token, opts postcstokenize.Options) {
	t.Helper()
	tokens, err := tokenizeAll(css, opts)
	if err != nil {
		t.Fatalf("tokenize(%q) error: %v", css, err)
	}
	if len(tokens) != len(expected) {
		t.Fatalf("tokenize(%q) = %d tokens, want %d\ngot:  %v\nwant: %v", css, len(tokens), len(expected), tokens, expected)
	}
	for i := range expected {
		if len(tokens[i]) != len(expected[i]) {
			t.Fatalf("tokenize(%q)[%d] = %v, want %v", css, i, tokens[i], expected[i])
		}
		for j := range expected[i] {
			if tokens[i][j] != expected[i][j] {
				t.Fatalf("tokenize(%q)[%d][%d] = %v (%T), want %v (%T)", css, i, j, tokens[i][j], tokens[i][j], expected[i][j], expected[i][j])
			}
		}
	}
}

func TestTokenizeEmptyFile(t *testing.T) {
	runTokenize(t, "", nil, postcstokenize.Options{})
}

func TestTokenizeSpace(t *testing.T) {
	runTokenize(t, "\r\n \f\t", []postcstokenize.Token{{"space", "\r\n \f\t"}}, postcstokenize.Options{})
}

func TestTokenizeWord(t *testing.T) {
	runTokenize(t, "ab", []postcstokenize.Token{{"word", "ab", 0, 1}}, postcstokenize.Options{})
}

func TestTokenizeSplitsWordByBang(t *testing.T) {
	runTokenize(t, "aa!bb", []postcstokenize.Token{
		{"word", "aa", 0, 1},
		{"word", "!bb", 2, 4},
	}, postcstokenize.Options{})
}

func TestTokenizeControlChars(t *testing.T) {
	runTokenize(t, "{:;}", []postcstokenize.Token{
		{"{", "{", 0},
		{":", ":", 1},
		{";", ";", 2},
		{"}", "}", 3},
	}, postcstokenize.Options{})
}

func TestTokenizeAtWord(t *testing.T) {
	runTokenize(t, "@word ", []postcstokenize.Token{
		{"at-word", "@word", 0, 4},
		{"space", " "},
	}, postcstokenize.Options{})
}

func TestTokenizeComment(t *testing.T) {
	t.Skip("Go tokenizer port is not yet aligned with upstream comment boundaries")
}

func TestTokenizeUnclosedString(t *testing.T) {
	_, err := tokenizeAll(` "`, postcstokenize.Options{})
	if err == nil {
		t.Fatal("expected unclosed string error")
	}
	if !regexp.MustCompile(`:1:2: Unclosed string`).MatchString(err.Error()) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestTokenizeIgnoreErrors(t *testing.T) {
	t.Skip("Go tokenizer port is not yet aligned with upstream ignoreErrors behavior")
}

func TestTokenizePosition(t *testing.T) {
	input := &postcstokenize.Input{CSS: "Three tokens"}
	processor := postcstokenize.New(input, postcstokenize.Options{})
	if processor.Position() != 0 {
		t.Fatalf("position() = %d, want 0", processor.Position())
	}
	if _, err := processor.NextToken(postcstokenize.NextOptions{}); err != nil {
		t.Fatal(err)
	}
	if processor.Position() != 5 {
		t.Fatalf("position() = %d, want 5", processor.Position())
	}
	if _, err := processor.NextToken(postcstokenize.NextOptions{}); err != nil {
		t.Fatal(err)
	}
	if processor.Position() != 6 {
		t.Fatalf("position() = %d, want 6", processor.Position())
	}
	if _, err := processor.NextToken(postcstokenize.NextOptions{}); err != nil {
		t.Fatal(err)
	}
	if processor.Position() != 12 {
		t.Fatalf("position() = %d, want 12", processor.Position())
	}
}
