package tokenizer

import (
	"strings"
	"testing"
)

func TestTokenizerNextBackAndEOF(t *testing.T) {
	tok := New(`@media screen { color: url("a;b"); /* c */ }`)

	first, err := tok.Next()
	if err != nil || first.Kind != "at-word" || first.Value != "@media" {
		t.Fatalf("unexpected first token: %#v err=%v", first, err)
	}
	tok.Back(first)
	again, err := tok.Next()
	if err != nil || again != first {
		t.Fatalf("expected backed token, got %#v err=%v", again, err)
	}

	var kinds []string
	for !tok.EOF() {
		token, err := tok.Next()
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
	tok := New(`"unterminated`)
	if _, err := tok.Next(); err == nil || !strings.Contains(err.Error(), "unclosed string") {
		t.Fatalf("expected unclosed string error, got %v", err)
	}

	tok = New(`/* missing`)
	if _, err := tok.Next(); err == nil || !strings.Contains(err.Error(), "unclosed comment") {
		t.Fatalf("expected unclosed comment error, got %v", err)
	}

	tok = New(`value[abc`)
	if _, err := tok.Next(); err == nil || !strings.Contains(err.Error(), "unclosed bracket") {
		t.Fatalf("expected unclosed bracket error, got %v", err)
	}

	if !isPunct('{') || !isStop(':') || !isWordStop(';') || !isWhitespace(' ') {
		t.Fatal("expected helper predicates to classify tokens")
	}
}
