package jsbridge

import (
	"reflect"
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
