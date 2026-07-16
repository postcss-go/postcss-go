package jsbridge

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"postcss-go/internal/tokenizer"
)

func TestLegacyTokenPreservesRPCShape(t *testing.T) {
	input := `@media { color: red; }`
	tests := []struct {
		name  string
		token tokenizer.Token
		want  []any
	}{
		{name: "word", token: tokenizer.Token{Kind: "word", Start: 16, End: 18}, want: []any{"word", "red", 16, 18}},
		{name: "space", token: tokenizer.Token{Kind: "space", Start: 6, End: 6}, want: []any{"space", " "}},
		{name: "control", token: tokenizer.Token{Kind: ";", Start: 19, End: 19}, want: []any{";", ";", 19}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := legacyToken(input, tt.token); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("legacyToken() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestTokenizeRPCSessionCompatibility(t *testing.T) {
	ctx := context.Background()
	opened, err := TokenizeOpenRPC(ctx, TokenizeOpenParams{CSS: "@media { color: red; }"})
	if err != nil {
		t.Fatal(err)
	}
	id := opened.ID
	t.Cleanup(func() {
		delete(tokenizeSessions, id)
	})

	next, err := TokenizeNextRPC(ctx, TokenizeNextParams{ID: id})
	if err != nil {
		t.Fatal(err)
	}
	want := []any{"at-word", "@media", 0, 5}
	if !reflect.DeepEqual(next.Token, want) {
		t.Fatalf("first token = %#v, want %#v", next.Token, want)
	}

	position, err := TokenizePositionRPC(ctx, TokenizeSessionParams{ID: id})
	if err != nil || position.Value != 6 {
		t.Fatalf("position = %#v, err = %v", position, err)
	}

	if _, err := TokenizeBackRPC(ctx, TokenizeBackParams{ID: id, Token: next.Token}); err != nil {
		t.Fatal(err)
	}
	eof, err := TokenizeEOFRPC(ctx, TokenizeSessionParams{ID: id})
	if err != nil || eof.Value {
		t.Fatalf("EOF after back = %#v, err = %v", eof, err)
	}
	backed, err := TokenizeNextRPC(ctx, TokenizeNextParams{ID: id})
	if err != nil || !reflect.DeepEqual(backed.Token, want) {
		t.Fatalf("backed token = %#v, err = %v", backed, err)
	}

	for {
		next, err = TokenizeNextRPC(ctx, TokenizeNextParams{ID: id})
		if err != nil {
			t.Fatal(err)
		}
		if next.Token == nil {
			break
		}
	}
	eof, err = TokenizeEOFRPC(ctx, TokenizeSessionParams{ID: id})
	if err != nil || !eof.Value {
		t.Fatalf("EOF = %#v, err = %v", eof, err)
	}

	if _, err := TokenizeCloseRPC(ctx, TokenizeSessionParams{ID: id}); err != nil {
		t.Fatal(err)
	}
	if _, err := TokenizeEOFRPC(ctx, TokenizeSessionParams{ID: id}); err == nil || !strings.Contains(err.Error(), "unknown tokenize session") {
		t.Fatalf("expected unknown-session error, got %v", err)
	}
}
