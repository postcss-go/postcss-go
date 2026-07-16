package tokenize

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"postcss-go/internal/csserrors"
)

func isWordEndRune(r rune) bool {
	switch r {
	case '\t', '\n', '\f', '\r', ' ', '!', '"', '#', '\'', '(', ')', ':', ';', '@', '[', '\\', ']', '{', '}':
		return true
	default:
		return false
	}
}

func findWordEnd(css string, start int) int {
	for i := start; i < len(css); {
		r, size := utf8.DecodeRuneInString(css[i:])
		if isWordEndRune(r) {
			return i
		}
		if r == '/' && i+size < len(css) && css[i+size] == '*' {
			return i
		}
		i += size
	}
	return len(css)
}

const (
	singleQuote = '\''
	doubleQuote = '"'
	backslash   = '\\'
	slash       = '/'
	newline     = '\n'
	space       = ' '
	feed        = '\f'
	tab         = '\t'
	cr          = '\r'
	openSquare  = '['
	closeSquare = ']'
	openParen   = '('
	closeParen  = ')'
	openCurly   = '{'
	closeCurly  = '}'
	semicolon   = ';'
	asterisk    = '*'
	colon       = ':'
	at          = '@'
)

var (
	reAtEnd      = regexp.MustCompile(`[\t\n\f\r "#'()/;[\\\]{}]`)
	reBadBracket = regexp.MustCompile(`.[\r\n"'(/\\]`)
	reHexEscape  = regexp.MustCompile(`(?i)[\da-f]`)
)

type Options struct {
	IgnoreErrors bool
}

type NextOptions struct {
	IgnoreUnclosed bool
}

type Token []any

type Input struct {
	CSS  string
	File string
}

func (i *Input) ValueOf() string {
	return i.CSS
}

func (i *Input) Error(reason string, offset int) error {
	line, column := offsetToLineColumn(i.CSS, offset)
	return csserrors.New(reason, line, column, i.CSS, i.File, "")
}

type Processor struct {
	input        *Input
	ignore       bool
	css          string
	length       int
	pos          int
	buffer       []Token
	returned     []Token
	lastBadParen int
}

func New(input *Input, opts Options) *Processor {
	return &Processor{
		input:        input,
		ignore:       opts.IgnoreErrors,
		css:          input.ValueOf(),
		length:       len(input.ValueOf()),
		lastBadParen: -1,
	}
}

func (p *Processor) Position() int {
	return p.pos
}

func (p *Processor) EndOfFile() bool {
	return len(p.returned) == 0 && p.pos >= p.length
}

func (p *Processor) Back(token Token) {
	p.returned = append(p.returned, token)
}

func (p *Processor) NextToken(opts NextOptions) (Token, error) {
	if len(p.returned) > 0 {
		last := p.returned[len(p.returned)-1]
		p.returned = p.returned[:len(p.returned)-1]
		return last, nil
	}
	if p.pos >= p.length {
		return nil, nil
	}

	ignoreUnclosed := opts.IgnoreUnclosed
	code := runeAt(p.css, p.pos)

	var current Token

	switch code {
	case newline, space, tab, cr, feed:
		next := p.pos
		for {
			next++
			if next >= p.length {
				break
			}
			nextCode := runeAt(p.css, next)
			if nextCode != space && nextCode != newline && nextCode != tab && nextCode != cr && nextCode != feed {
				break
			}
		}
		current = Token{"space", p.css[p.pos:next]}
		p.pos = next - 1

	case openSquare, closeSquare, openCurly, closeCurly, colon, semicolon, closeParen:
		control := string(code)
		current = Token{control, control, p.pos}

	case openParen:
		prev := ""
		if len(p.buffer) > 0 {
			prev = tokenString(p.buffer[len(p.buffer)-1], 1)
		}
		n := runeAt(p.css, p.pos+1)
		if prev == "url" && n != singleQuote && n != doubleQuote && n != space && n != newline && n != tab && n != feed && n != cr {
			next := p.pos
			var escaped bool
			for {
				idx := strings.Index(p.css[next+1:], ")")
				if idx == -1 {
					if p.ignore || ignoreUnclosed {
						next = p.pos
						break
					}
					return nil, p.unclosed("bracket")
				}
				next += idx + 1
				escapePos := next
				for escapePos > 0 && runeAt(p.css, escapePos-1) == backslash {
					escapePos--
					escaped = !escaped
				}
				if !escaped {
					break
				}
			}
			current = Token{"brackets", p.css[p.pos : next+1], p.pos, next}
			p.pos = next
		} else if p.pos <= p.lastBadParen {
			current = Token{"(", "(", p.pos}
		} else {
			idx := strings.Index(p.css[p.pos+1:], ")")
			if idx == -1 {
				p.lastBadParen = p.length
				current = Token{"(", "(", p.pos}
			} else {
				next := p.pos + 1 + idx
				content := p.css[p.pos : next+1]
				if reBadBracket.MatchString(content) {
					p.lastBadParen = next
					current = Token{"(", "(", p.pos}
				} else {
					current = Token{"brackets", content, p.pos, next}
					p.pos = next
				}
			}
		}

	case singleQuote, doubleQuote:
		quote := code
		next := p.pos
		var escaped bool
		quoteStr := string(quote)
		for {
			idx := strings.Index(p.css[next+1:], quoteStr)
			if idx == -1 {
				if p.ignore || ignoreUnclosed {
					next = p.pos + 1
					break
				}
				return nil, p.unclosed("string")
			}
			next += idx + 1
			escapePos := next
			for escapePos > 0 && runeAt(p.css, escapePos-1) == backslash {
				escapePos--
				escaped = !escaped
			}
			if !escaped {
				break
			}
		}
		current = Token{"string", p.css[p.pos : next+1], p.pos, next}
		p.pos = next

	case at:
		reAtEnd.Longest()
		loc := reAtEnd.FindStringIndex(p.css[p.pos+1:])
		var next int
		if loc == nil {
			next = p.length - 1
		} else {
			next = p.pos + loc[0]
		}
		current = Token{"at-word", p.css[p.pos : next+1], p.pos, next}
		p.pos = next

	case backslash:
		next := p.pos
		escape := true
		for runeAt(p.css, next+1) == backslash {
			next++
			escape = !escape
		}
		nextCode := runeAt(p.css, next+1)
		if escape && nextCode != slash && nextCode != space && nextCode != newline && nextCode != tab && nextCode != cr && nextCode != feed {
			next++
			if next < p.length && reHexEscape.MatchString(string(runeAt(p.css, next))) {
				for next+1 < p.length && reHexEscape.MatchString(string(runeAt(p.css, next+1))) {
					next++
				}
				if next+1 < p.length && runeAt(p.css, next+1) == space {
					next++
				}
			}
		}
		current = Token{"word", p.css[p.pos : next+1], p.pos, next}
		p.pos = next

	default:
		if code == slash && runeAt(p.css, p.pos+1) == asterisk {
			idx := strings.Index(p.css[p.pos+2:], "*/")
			var next int
			if idx == -1 {
				if p.ignore || ignoreUnclosed {
					next = p.length - 1
				} else {
					return nil, p.unclosed("comment")
				}
			} else {
				next = p.pos + idx + 3 - 1
			}
			current = Token{"comment", p.css[p.pos : next+1], p.pos, next}
			p.pos = next
		} else {
			endIdx := findWordEnd(p.css, p.pos+1)
			var next int
			if endIdx >= p.length {
				next = p.length - 1
			} else {
				next = endIdx - 1
			}
			current = Token{"word", p.css[p.pos : next+1], p.pos, next}
			p.buffer = append(p.buffer, current)
			p.pos = next
		}
	}

	p.pos++
	return current, nil
}

func (p *Processor) unclosed(what string) error {
	return p.input.Error("Unclosed "+what, p.pos)
}

func runeAt(s string, index int) rune {
	if index < 0 || index >= len(s) {
		return 0
	}
	r, _ := utf8.DecodeRuneInString(s[index:])
	return r
}

func tokenString(token Token, index int) string {
	if len(token) <= index {
		return ""
	}
	if value, ok := token[index].(string); ok {
		return value
	}
	return ""
}

func offsetToLineColumn(css string, offset int) (int, int) {
	if offset < 0 {
		offset = 0
	}
	if offset > len(css) {
		offset = len(css)
	}
	line := 1
	column := 1
	for index, r := range css {
		if index >= offset {
			break
		}
		if r == '\n' {
			line++
			column = 1
		} else {
			column += utf16.RuneLen(r)
		}
	}
	return line, column
}

func TokenizeAll(css string, opts Options) ([]Token, error) {
	input := &Input{CSS: css}
	processor := New(input, opts)
	var tokens []Token
	for !processor.EndOfFile() {
		token, err := processor.NextToken(NextOptions{})
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

func FormatTokens(tokens []Token) string {
	parts := make([]string, 0, len(tokens))
	for _, token := range tokens {
		parts = append(parts, fmt.Sprint(token))
	}
	return strings.Join(parts, ", ")
}
