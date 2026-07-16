package tokenizer

import (
	"strings"
	"testing"
)

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

func TestTokenizerMapsCommunityTokensToInternalKinds(t *testing.T) {
	tok := New(" \n/* c */ @media : ; { } [ ] ( ) .a", Options{})
	want := []string{"space", "comment", "space", "at-word", "space", ":", "space", ";", "space", "{", "space", "}", "space", "[", "space", "]", "space", "(", "space", ")", "space", "word", "word"}
	var got []string
	for {
		token, err := tok.Next(NextOptions{})
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

func TestTokenizerErrorsUseUTF16Columns(t *testing.T) {
	tok := New("中🔥\"", Options{})
	if _, err := tok.Next(NextOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := tok.Next(NextOptions{}); err == nil || !strings.Contains(err.Error(), ":1:4: Unclosed string") {
		t.Fatalf("expected UTF-16 error position, got %v", err)
	}
}
