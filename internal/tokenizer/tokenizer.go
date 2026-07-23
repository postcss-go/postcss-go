package tokenizer

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"postcss-go/internal/sourcemap"
)

type Options struct {
	IgnoreErrors bool
	File         string
}

type NextOptions struct {
	IgnoreUnclosed bool
}

type Token struct {
	Kind  string
	Start int
	End   int
}

func (token Token) Text(input string) string {
	if token.Start < 0 || token.End < token.Start || token.Start >= len(input) {
		return ""
	}
	end := min(token.End+1, len(input))
	return input[token.Start:end]
}

type Tokenizer struct {
	input        string
	back         []Token
	pos          int
	buffer       []Token
	lastBadParen int
	ignore       bool
	source       *sourcemap.Input
}

func New(input string, opts Options) *Tokenizer {
	return &Tokenizer{
		input:        input,
		ignore:       opts.IgnoreErrors,
		lastBadParen: -1,
		source:       &sourcemap.Input{CSS: input, File: opts.File},
	}
}

func (t *Tokenizer) Next(opts NextOptions) (Token, error) {
	if len(t.back) > 0 {
		last := t.back[len(t.back)-1]
		t.back = t.back[:len(t.back)-1]
		return last, nil
	}
	if t.pos >= len(t.input) {
		return Token{}, nil
	}

	start := t.pos
	code := runeAt(t.input, start)
	var token Token

	switch {
	case isSpace(code):
		end := start + runeSize(t.input, start)
		for end < len(t.input) && isSpace(runeAt(t.input, end)) {
			end += runeSize(t.input, end)
		}
		token = Token{Kind: "space", Start: start, End: end - 1}
	case isControl(code):
		token = Token{Kind: string(code), Start: start, End: start}
	case code == '(':
		var err error
		token, err = t.parenthesis(start, opts.IgnoreUnclosed)
		if err != nil {
			return Token{}, err
		}
	case code == '\'' || code == '"':
		var err error
		token, err = t.stringToken(start, code, opts.IgnoreUnclosed)
		if err != nil {
			return Token{}, err
		}
	case code == '@':
		end := start + runeSize(t.input, start)
		for end < len(t.input) && !isAtWordEnd(runeAt(t.input, end)) {
			end += runeSize(t.input, end)
		}
		token = Token{Kind: "at-word", Start: start, End: end - 1}
	case code == '\\':
		end := t.escapeEnd(start)
		token = Token{Kind: "word", Start: start, End: end}
	default:
		if code == '/' && runeAt(t.input, start+1) == '*' {
			end := strings.Index(t.input[start+2:], "*/")
			if end < 0 {
				if !t.ignore && !opts.IgnoreUnclosed {
					return Token{}, t.unclosed("comment", start)
				}
				// PostCSS's ignored-unclosed comment token uses an end offset one
				// past the input length; preserve that legacy range here.
				end = len(t.input)
			} else {
				end = start + 2 + end + 1
			}
			token = Token{Kind: "comment", Start: start, End: end}
		} else {
			end := findWordEnd(t.input, start+runeSize(t.input, start))
			token = Token{Kind: "word", Start: start, End: end - 1}
			t.buffer = append(t.buffer, token)
		}
	}

	t.pos = token.End + 1
	return token, nil
}

func (t *Tokenizer) Back(token Token) { t.back = append(t.back, token) }

func (t *Tokenizer) Position() int { return t.pos }

func (t *Tokenizer) EOF() bool { return len(t.back) == 0 && t.pos >= len(t.input) }

func (t *Tokenizer) parenthesis(start int, ignoreUnclosed bool) (Token, error) {
	prev := ""
	if len(t.buffer) > 0 {
		prev = t.buffer[len(t.buffer)-1].Text(t.input)
	}
	next := runeAt(t.input, start+1)
	if prev == "url" && !isQuoteOrSpace(next) {
		end := findClosingParen(t.input, start)
		if end < 0 {
			if !t.ignore && !ignoreUnclosed {
				return Token{}, t.unclosed("bracket", start)
			}
			return Token{Kind: "brackets", Start: start, End: start}, nil
		}
		return Token{Kind: "brackets", Start: start, End: end}, nil
	}
	if start <= t.lastBadParen {
		return Token{Kind: "(", Start: start, End: start}, nil
	}
	end := findClosingParen(t.input, start)
	if end < 0 {
		t.lastBadParen = len(t.input)
		return Token{Kind: "(", Start: start, End: start}, nil
	}
	content := t.input[start : end+1]
	if badParenContent.MatchString(content) {
		t.lastBadParen = end
		return Token{Kind: "(", Start: start, End: start}, nil
	}
	return Token{Kind: "brackets", Start: start, End: end}, nil
}

func (t *Tokenizer) stringToken(start int, quote rune, ignoreUnclosed bool) (Token, error) {
	end := findClosingQuote(t.input, start, quote)
	if end < 0 {
		if !t.ignore && !ignoreUnclosed {
			return Token{}, t.unclosed("string", start)
		}
		return Token{Kind: "string", Start: start, End: start + 1}, nil
	}
	return Token{Kind: "string", Start: start, End: end}, nil
}

func (t *Tokenizer) escapeEnd(start int) int {
	end := start
	escaped := true
	for next := start + 1; next < len(t.input) && runeAt(t.input, next) == '\\'; next++ {
		end = next
		escaped = !escaped
	}
	next := end + 1
	nextCode := runeAt(t.input, next)
	if escaped && next < len(t.input) && nextCode != '/' && !isSpace(nextCode) {
		end = next
		if isHex(runeAt(t.input, end)) {
			for end+1 < len(t.input) && isHex(runeAt(t.input, end+1)) {
				end++
			}
			if runeAt(t.input, end+1) == ' ' {
				end++
			}
		}
	}
	return end
}

func (t *Tokenizer) unclosed(what string, offset int) error {
	return t.source.ErrorAtOffset("Unclosed "+what, offset, "")
}

var badParenContent = regexp.MustCompile(`.[\r\n"'(/\\]`)

func findWordEnd(css string, start int) int {
	for index := start; index < len(css); {
		r, size := utf8.DecodeRuneInString(css[index:])
		if isWordEnd(r) || (r == '/' && runeAt(css, index+size) == '*') {
			return index
		}
		index += size
	}
	return len(css)
}

func findClosingParen(css string, start int) int {
	for index := start + 1; index < len(css); index++ {
		if css[index] != ')' {
			continue
		}
		escaped := false
		for slash := index - 1; slash >= 0 && css[slash] == '\\'; slash-- {
			escaped = !escaped
		}
		if !escaped {
			return index
		}
	}
	return -1
}

func findClosingQuote(css string, start int, quote rune) int {
	for index := start + 1; index < len(css); index++ {
		if runeAt(css, index) != quote {
			continue
		}
		escaped := false
		for slash := index - 1; slash >= 0 && css[slash] == '\\'; slash-- {
			escaped = !escaped
		}
		if !escaped {
			return index
		}
	}
	return -1
}

func isSpace(r rune) bool {
	return r == ' ' || r == '\n' || r == '\r' || r == '\t' || r == '\f'
}

func isControl(r rune) bool {
	switch r {
	case '{', '}', ':', ';', '[', ']', ')':
		return true
	default:
		return false
	}
}

func isWordEnd(r rune) bool {
	switch r {
	case '\t', '\n', '\f', '\r', ' ', '!', '"', '#', '\'', '(', ')', ':', ';', '@', '[', '\\', ']', '{', '}':
		return true
	default:
		return false
	}
}

func isAtWordEnd(r rune) bool { return isWordEnd(r) || r == '/' }

func isQuoteOrSpace(r rune) bool { return r == '\'' || r == '"' || isSpace(r) }

func isHex(r rune) bool {
	return r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F'
}

func runeAt(s string, index int) rune {
	if index < 0 || index >= len(s) {
		return 0
	}
	r, _ := utf8.DecodeRuneInString(s[index:])
	return r
}

func runeSize(s string, index int) int {
	if index < 0 || index >= len(s) {
		return 1
	}
	_, size := utf8.DecodeRuneInString(s[index:])
	return size
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
