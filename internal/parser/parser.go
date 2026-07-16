package parser

import (
	"fmt"
	"strings"

	"postcss-go/internal/ast"
	"postcss-go/internal/source"
	"postcss-go/internal/tokenizer"
)

type Parser struct {
	input       string
	tok         *tokenizer.Tokenizer
	root        *ast.Root
	src         *source.Input
	stmtBuf     []tokenizer.Token
	trackSource bool
}

func Parse(css string, opts source.Options) (*ast.Root, error) {
	input, err := source.NewInput(css, opts)
	if err != nil {
		return nil, err
	}
	p := &Parser{
		input:       css,
		tok:         tokenizer.New(css, tokenizer.Options{}),
		root:        ast.NewRoot(),
		src:         input,
		stmtBuf:     make([]tokenizer.Token, 0, 32),
		trackSource: input.TracksSource(),
	}
	if err := p.parseInto(p.root, false); err != nil {
		return nil, err
	}
	p.root.SetRange(ast.SourceRange{Start: 0, End: len(css)})
	if p.trackSource {
		p.root.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(css))))
	}
	return p.root, nil
}

func (p *Parser) parseInto(container ast.Container, stopOnBrace bool) error {
	for !p.tok.EOF() {
		tokens, endBlock, err := p.collectStatement(stopOnBrace)
		if err != nil {
			return err
		}
		if len(tokens) == 0 && !endBlock {
			continue
		}
		if len(tokens) == 0 && endBlock {
			return nil
		}
		if err := p.buildNode(container, tokens); err != nil {
			return err
		}
		if endBlock {
			return nil
		}
	}
	if stopOnBrace {
		return fmt.Errorf("unexpected end of input: missing closing brace")
	}
	return nil
}

func (p *Parser) collectStatement(stopOnBrace bool) ([]tokenizer.Token, bool, error) {
	tokens := p.stmtBuf[:0]
	depth := 0

	for !p.tok.EOF() {
		token, err := p.tok.Next(tokenizer.NextOptions{})
		if err != nil {
			break
		}

		switch token.Kind {
		case "{":
			if depth == 0 {
				tokens = append(tokens, token)
				p.stmtBuf = tokens
				return tokens, false, nil
			}
			depth++
		case "}":
			if depth == 0 {
				if stopOnBrace {
					p.stmtBuf = tokens
					return tokens, true, nil
				}
				return nil, false, p.syntaxError("unexpected closing brace", token.Start)
			}
			depth--
		case ";":
			if depth == 0 {
				tokens = append(tokens, token)
				p.stmtBuf = tokens
				return tokens, false, nil
			}
		}

		tokens = append(tokens, token)
	}

	p.stmtBuf = tokens
	return tokens, false, nil
}

func (p *Parser) buildNode(container ast.Container, tokens []tokenizer.Token) error {
	trimmed := trimSpaceTokens(tokens)
	if len(trimmed) == 0 {
		return nil
	}
	last := trimmed[len(trimmed)-1]

	switch last.Kind {
	case "{":
		header := trimSpaceTokens(trimmed[:len(trimmed)-1])
		if len(header) == 0 {
			return p.syntaxError("empty block header", last.Start)
		}
		if header[0].Kind == "at-word" {
			node := p.makeAtRule(header)
			node.Block = true
			container.Append(node)
			return p.parseInto(node, true)
		}
		node := p.makeRule(header)
		container.Append(node)
		return p.parseInto(node, true)
	case ";":
		body := trimSpaceTokens(trimmed[:len(trimmed)-1])
		if len(body) == 0 {
			return nil
		}
		if body[0].Kind == "at-word" {
			container.Append(p.makeAtRule(body))
			return nil
		}
		if body[0].Kind == "comment" && len(body) == 1 {
			container.Append(p.makeComment(body[0]))
			return nil
		}
		decl, err := p.makeDeclaration(body)
		if err != nil {
			return err
		}
		container.Append(decl)
		return nil
	default:
		if len(trimmed) == 1 && trimmed[0].Kind == "comment" {
			container.Append(p.makeComment(trimmed[0]))
			return nil
		}
		decl, err := p.makeDeclaration(trimmed)
		if err != nil {
			return err
		}
		container.Append(decl)
		return nil
	}
}

func (p *Parser) makeRule(tokens []tokenizer.Token) *ast.Rule {
	selector := p.tokensText(tokens)
	node := ast.NewRule(strings.TrimSpace(selector))
	node.SetRange(ast.SourceRange{Start: tokens[0].Start, End: tokens[len(tokens)-1].End})
	p.attachSource(node, tokens[0].Start, tokens[len(tokens)-1].End+1)
	return node
}

func (p *Parser) makeAtRule(tokens []tokenizer.Token) *ast.AtRule {
	name := strings.TrimPrefix(tokens[0].Text(p.input), "@")
	params := strings.TrimSpace(p.tokensText(tokens[1:]))
	node := ast.NewAtRule(name, params)
	node.SetRange(ast.SourceRange{Start: tokens[0].Start, End: tokens[len(tokens)-1].End})
	p.attachSource(node, tokens[0].Start, tokens[len(tokens)-1].End+1)
	return node
}

func (p *Parser) makeComment(token tokenizer.Token) *ast.Comment {
	raw := token.Text(p.input)
	text := strings.TrimSuffix(strings.TrimPrefix(raw, "/*"), "*/")
	node := ast.NewComment(strings.TrimSpace(text))
	node.SetRange(ast.SourceRange{Start: token.Start, End: token.End})
	p.attachSource(node, token.Start, token.End+1)
	return node
}

func (p *Parser) makeDeclaration(tokens []tokenizer.Token) (*ast.Declaration, error) {
	colon := topLevelColon(tokens)
	if colon < 0 {
		return nil, p.syntaxError(fmt.Sprintf("expected declaration, got %q", p.tokensText(tokens)), tokens[0].Start)
	}
	prop := strings.TrimSpace(p.tokensText(tokens[:colon]))
	value := strings.TrimSpace(p.tokensText(tokens[colon+1:]))
	if prop == "" {
		return nil, p.syntaxError("empty declaration property", tokens[0].Start)
	}
	important := false
	lower := strings.ToLower(value)
	if strings.HasSuffix(lower, "!important") {
		important = true
		value = strings.TrimSpace(value[:len(value)-len("!important")])
	}
	node := ast.NewDeclaration(prop, value)
	node.Important = important
	node.SetRange(ast.SourceRange{Start: tokens[0].Start, End: tokens[len(tokens)-1].End})
	p.attachSource(node, tokens[0].Start, tokens[len(tokens)-1].End+1)
	return node, nil
}

func (p *Parser) attachSource(node ast.Node, start, end int) {
	if !p.trackSource {
		return
	}
	node.SetSource(p.location(start, end))
}

func (p *Parser) tokensText(tokens []tokenizer.Token) string {
	if len(tokens) == 0 {
		return ""
	}
	if len(tokens) == 1 {
		return tokens[0].Text(p.input)
	}

	var builder strings.Builder
	builder.Grow(tokens[len(tokens)-1].End - tokens[0].Start + 1)
	for _, token := range tokens {
		builder.WriteString(token.Text(p.input))
	}
	return builder.String()
}

func trimSpaceTokens(tokens []tokenizer.Token) []tokenizer.Token {
	start := 0
	end := len(tokens)
	for start < end && tokens[start].Kind == "space" {
		start++
	}
	for end > start && tokens[end-1].Kind == "space" {
		end--
	}
	return tokens[start:end]
}

func topLevelColon(tokens []tokenizer.Token) int {
	for index, token := range tokens {
		if token.Kind == ":" {
			return index
		}
	}
	return -1
}

func (p *Parser) syntaxError(message string, offset int) error {
	return p.src.ErrorAtOffset(message, offset, "")
}

func (p *Parser) location(start, end int) *source.Location {
	return p.src.Location(p.src.FromOffset(start), p.src.FromOffset(end))
}
