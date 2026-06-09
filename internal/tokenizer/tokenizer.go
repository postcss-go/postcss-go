package tokenizer

import (
	"fmt"
	"strings"
	"unicode"
)

type Token struct {
	Kind  string
	Value string
	Start int
	End   int
}

type Tokenizer struct {
	input string
	pos   int
	back  []Token
}

func New(input string) *Tokenizer {
	return &Tokenizer{input: input}
}

func (t *Tokenizer) Next() (Token, error) {
	if len(t.back) > 0 {
		last := t.back[len(t.back)-1]
		t.back = t.back[:len(t.back)-1]
		return last, nil
	}
	if t.pos >= len(t.input) {
		return Token{}, fmt.Errorf("eof")
	}

	start := t.pos
	ch := t.input[t.pos]

	switch {
	case isWhitespace(ch):
		for t.pos < len(t.input) && isWhitespace(t.input[t.pos]) {
			t.pos++
		}
		return Token{Kind: "space", Value: t.input[start:t.pos], Start: start, End: t.pos - 1}, nil
	case ch == '/' && t.hasPrefix("/*"):
		end := strings.Index(t.input[t.pos+2:], "*/")
		if end < 0 {
			return Token{}, fmt.Errorf("unclosed comment at offset %d", start)
		}
		t.pos += end + 4
		return Token{Kind: "comment", Value: t.input[start:t.pos], Start: start, End: t.pos - 1}, nil
	case ch == '"' || ch == '\'':
		token, err := t.readString(ch)
		if err != nil {
			return Token{}, err
		}
		return token, nil
	case ch == '@':
		t.pos++
		for t.pos < len(t.input) && !isStop(t.input[t.pos]) {
			t.pos++
		}
		return Token{Kind: "at-word", Value: t.input[start:t.pos], Start: start, End: t.pos - 1}, nil
	case isPunct(ch):
		t.pos++
		return Token{Kind: string(ch), Value: string(ch), Start: start, End: start}, nil
	default:
		token, err := t.readWord()
		if err != nil {
			return Token{}, err
		}
		return token, nil
	}
}

func (t *Tokenizer) Back(token Token) {
	t.back = append(t.back, token)
}

func (t *Tokenizer) EOF() bool {
	return len(t.back) == 0 && t.pos >= len(t.input)
}

func (t *Tokenizer) readString(quote byte) (Token, error) {
	start := t.pos
	t.pos++
	for t.pos < len(t.input) {
		ch := t.input[t.pos]
		if ch == '\\' {
			t.pos += 2
			continue
		}
		t.pos++
		if ch == quote {
			return Token{Kind: "string", Value: t.input[start:t.pos], Start: start, End: t.pos - 1}, nil
		}
	}
	return Token{}, fmt.Errorf("unclosed string at offset %d", start)
}

func (t *Tokenizer) readWord() (Token, error) {
	start := t.pos
	for t.pos < len(t.input) {
		ch := t.input[t.pos]
		if ch == '/' && t.pos+1 < len(t.input) && t.input[t.pos+1] == '*' {
			break
		}
		if ch == '\\' {
			t.pos += 2
			continue
		}
		if ch == '(' {
			t.pos++
			if err := t.skipBalanced('(', ')'); err != nil {
				return Token{}, err
			}
			continue
		}
		if ch == '[' {
			t.pos++
			if err := t.skipBalanced('[', ']'); err != nil {
				return Token{}, err
			}
			continue
		}
		if isWordStop(ch) {
			break
		}
		t.pos++
	}
	return Token{Kind: "word", Value: t.input[start:t.pos], Start: start, End: t.pos - 1}, nil
}

func (t *Tokenizer) skipBalanced(open, close byte) error {
	depth := 1
	for t.pos < len(t.input) {
		ch := t.input[t.pos]
		if ch == '\\' {
			t.pos += 2
			continue
		}
		if ch == '"' || ch == '\'' {
			if _, err := t.readString(ch); err != nil {
				return err
			}
			continue
		}
		t.pos++
		switch ch {
		case open:
			depth++
		case close:
			depth--
			if depth == 0 {
				return nil
			}
		}
	}
	return fmt.Errorf("unclosed bracket at offset %d", t.pos)
}

func (t *Tokenizer) hasPrefix(prefix string) bool {
	return strings.HasPrefix(t.input[t.pos:], prefix)
}

func isWhitespace(ch byte) bool {
	return unicode.IsSpace(rune(ch))
}

func isPunct(ch byte) bool {
	switch ch {
	case '{', '}', ':', ';', '(', ')', '[', ']':
		return true
	default:
		return false
	}
}

func isStop(ch byte) bool {
	return isWhitespace(ch) || isPunct(ch) || ch == '"' || ch == '\'' || ch == '/'
}

func isWordStop(ch byte) bool {
	return isWhitespace(ch) || ch == '{' || ch == '}' || ch == ':' || ch == ';'
}
