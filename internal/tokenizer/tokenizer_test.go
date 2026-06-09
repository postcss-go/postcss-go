package tokenizer

import (
	"strings"
	"testing"
)

func TestTokenizerNextBackAndEOF(t *testing.T) {
	input := `@media screen { color: url("a;b"); /* c */ }`
	tok := New(input)

	first, err := tok.Next()
	if err != nil || first.Kind != "at-word" || first.Text(input) != "@media" {
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

	tok = New(`url(foo`)
	if _, err := tok.Next(); err == nil || !strings.Contains(err.Error(), "unclosed bracket") {
		t.Fatalf("expected unclosed bracket error, got %v", err)
	}
}

func TestTokenizerMapsCommunityTokensToInternalKinds(t *testing.T) {
	tok := New(" \n/* c */ @media : ; { } [ ] ( ) .a")
	want := []string{"space", "comment", "space", "at-word", "space", ":", "space", ";", "space", "{", "space", "}", "space", "[", "space", "]", "space", "(", "space", ")", "space", "word", "word"}
	var got []string
	for {
		token, err := tok.Next()
		if err != nil {
			break
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
