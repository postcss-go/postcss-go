package jsbridge

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/postcss-go/postcss-go/internal/tokenizer"
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
		_, _ = TokenizeCloseRPC(ctx, TokenizeSessionParams{ID: id})
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

func TestTokenizeRPCSessionUsesUTF16Offsets(t *testing.T) {
	ctx := context.Background()
	opened, err := TokenizeOpenRPC(ctx, TokenizeOpenParams{CSS: "中🔥"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = TokenizeCloseRPC(ctx, TokenizeSessionParams{ID: opened.ID})
	})

	next, err := TokenizeNextRPC(ctx, TokenizeNextParams{ID: opened.ID})
	if err != nil {
		t.Fatal(err)
	}
	want := []any{"word", "中🔥", 0, 2}
	if !reflect.DeepEqual(next.Token, want) {
		t.Fatalf("token = %#v, want %#v", next.Token, want)
	}

	position, err := TokenizePositionRPC(ctx, TokenizeSessionParams{ID: opened.ID})
	if err != nil || position.Value != 3 {
		t.Fatalf("position = %#v, err = %v", position, err)
	}
}

func TestTokenizeBatchRPCPreservesIgnoredUnclosedError(t *testing.T) {
	result, err := TokenizeBatchRPC(context.Background(), TokenizeBatchParams{CSS: " /*"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Error == nil || result.ErrorIndex != 1 {
		t.Fatalf("result error = %#v at index %d", result.Error, result.ErrorIndex)
	}
	if len(result.Tokens) != 2 || result.Tokens[1][0] != "comment" {
		t.Fatalf("tokens = %#v, want ignored comment token", result.Tokens)
	}
}

func TestTokenizeBatchRPCUsesUTF16Offsets(t *testing.T) {
	result, err := TokenizeBatchRPC(context.Background(), TokenizeBatchParams{CSS: "中🔥"})
	if err != nil {
		t.Fatal(err)
	}
	wantToken := []any{"word", "中🔥", 0, 2}
	if len(result.Tokens) != 1 || !reflect.DeepEqual(result.Tokens[0], wantToken) {
		t.Fatalf("tokens = %#v, want %#v", result.Tokens, [][]any{wantToken})
	}
	if len(result.Positions) != 1 || result.Positions[0] != 3 {
		t.Fatalf("positions = %#v, want [3]", result.Positions)
	}
}

func TestTokenizeBatchRPCPastEOFPosition(t *testing.T) {
	result, err := TokenizeBatchRPC(context.Background(), TokenizeBatchParams{CSS: "/* unclosed"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Error == nil || result.ErrorIndex != 0 {
		t.Fatalf("result error = %#v at index %d", result.Error, result.ErrorIndex)
	}
	wantToken := []any{"comment", "/* unclosed", 0, 11}
	if len(result.Tokens) != 1 || !reflect.DeepEqual(result.Tokens[0], wantToken) {
		t.Fatalf("tokens = %#v, want %#v", result.Tokens, [][]any{wantToken})
	}
	if len(result.Positions) != 1 || result.Positions[0] != 12 {
		t.Fatalf("positions = %#v, want [12] (one past UTF-16 EOF)", result.Positions)
	}
}

func TestMakeUTF16TableFillsEveryByte(t *testing.T) {
	input := "中🔥"
	table := makeUTF16Table(input)
	if len(table) != len(input)+1 {
		t.Fatalf("table length = %d, want %d", len(table), len(input)+1)
	}
	for offset := 0; offset <= len(input); offset++ {
		if table[offset] < 0 {
			t.Fatalf("hole or invalid value at byte %d: %d", offset, table[offset])
		}
	}
	if got := utf16Offset(table, len(input), len(input)+1); got != 4 {
		t.Fatalf("past-EOF utf16 offset = %d, want 4", got)
	}
	if got := utf16Offset(table, len(input), -1); got != 0 {
		t.Fatalf("negative utf16 offset = %d, want 0", got)
	}
}

func TestTokenizeRPCUnknownSessionErrors(t *testing.T) {
	ctx := context.Background()
	if _, err := TokenizeNextRPC(ctx, TokenizeNextParams{ID: -1}); err == nil {
		t.Fatal("expected unknown session on next")
	}
	if _, err := TokenizeBackRPC(ctx, TokenizeBackParams{ID: -1}); err == nil {
		t.Fatal("expected unknown session on back")
	}
	if _, err := TokenizePositionRPC(ctx, TokenizeSessionParams{ID: -1}); err == nil {
		t.Fatal("expected unknown session on position")
	}
}
