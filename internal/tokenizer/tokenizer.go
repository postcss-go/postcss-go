package tokenizer

import (
	"fmt"
	"io"

	parsepkg "github.com/tdewolff/parse/v2"
	css "github.com/tdewolff/parse/v2/css"
)

type Token struct {
	Kind  string
	Start int
	End   int
}

// Text returns the token slice from the original CSS input without copying.
func (token Token) Text(input string) string {
	if token.Start < 0 || token.End+1 > len(input) {
		return ""
	}
	return input[token.Start : token.End+1]
}

type Tokenizer struct {
	input string
	back  []Token
	lex   *css.Lexer
	src   *parsepkg.Input
}

func New(input string) *Tokenizer {
	src := parsepkg.NewInputString(input)
	return &Tokenizer{
		input: input,
		src:   src,
		lex:   css.NewLexer(src),
	}
}

func (t *Tokenizer) Next() (Token, error) {
	if len(t.back) > 0 {
		last := t.back[len(t.back)-1]
		t.back = t.back[:len(t.back)-1]
		return last, nil
	}

	tt, data := t.lex.Next()
	if err := t.lex.Err(); err == io.EOF {
		switch tt {
		case css.StringToken:
			if len(data) > 0 && (data[0] == '"' || data[0] == '\'') && data[len(data)-1] != data[0] {
				return Token{}, fmt.Errorf("unclosed string at offset %d", t.src.Offset()-len(data))
			}
		case css.URLToken:
			if len(data) == 0 || data[len(data)-1] != ')' {
				return Token{}, fmt.Errorf("unclosed bracket at offset %d", t.src.Offset()-len(data))
			}
		case css.CommentToken:
			if len(data) < 2 || string(data[len(data)-2:]) != "*/" {
				return Token{}, fmt.Errorf("unclosed comment at offset %d", t.src.Offset()-len(data))
			}
		}
	}
	if tt == css.BadStringToken {
		return Token{}, fmt.Errorf("unclosed string at offset %d", t.src.Offset()-len(data))
	}
	if tt == css.BadURLToken {
		return Token{}, fmt.Errorf("unclosed bracket at offset %d", t.src.Offset()-len(data))
	}
	if tt == css.ErrorToken {
		if err := t.lex.Err(); err != nil {
			if err == io.EOF {
				return Token{}, fmt.Errorf("eof")
			}
			return Token{}, err
		}
		return Token{}, fmt.Errorf("eof")
	}

	end := t.src.Offset() - 1
	start := end - len(data) + 1
	return Token{
		Kind:  mapTokenKind(tt),
		Start: start,
		End:   end,
	}, nil
}

func (t *Tokenizer) Back(token Token) {
	t.back = append(t.back, token)
}

func (t *Tokenizer) EOF() bool {
	return len(t.back) == 0 && t.src.Offset() >= len(t.input) && t.lex.Err() == io.EOF
}

func mapTokenKind(tt css.TokenType) string {
	switch tt {
	case css.WhitespaceToken:
		return "space"
	case css.CommentToken:
		return "comment"
	case css.AtKeywordToken:
		return "at-word"
	case css.LeftBraceToken:
		return "{"
	case css.RightBraceToken:
		return "}"
	case css.ColonToken:
		return ":"
	case css.SemicolonToken:
		return ";"
	case css.LeftParenthesisToken:
		return "("
	case css.RightParenthesisToken:
		return ")"
	case css.LeftBracketToken:
		return "["
	case css.RightBracketToken:
		return "]"
	default:
		return "word"
	}
}
