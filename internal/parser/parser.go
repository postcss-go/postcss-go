package parser

import (
	"strings"

	"github.com/postcss-go/postcss-go/internal/ast"
	"github.com/postcss-go/postcss-go/internal/sourcemap"
	"github.com/postcss-go/postcss-go/internal/tokenizer"
)

type Parser struct {
	input         string
	tok           *tokenizer.Tokenizer
	root          *ast.Root
	src           *sourcemap.Input
	stmtBuf       []tokenizer.Token
	paramScratch  []tokenizer.Token
	valueScratch  strings.Builder
	trackSource   bool
	pendingBefore string
	blockStart    int
}

func Parse(css string, opts sourcemap.Options) (*ast.Root, error) {
	input, err := sourcemap.NewInput(css, opts)
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
	p.root.Nodes = make([]ast.Node, 0, estimateTopLevelCapacity(len(css)))
	if err := p.parseInto(p.root, false); err != nil {
		return nil, err
	}
	if len(p.root.Children()) > 0 {
		if !ast.HasRaw(p.root, "semicolon") {
			ast.SetRawBool(p.root, "semicolon", false)
		}
	}
	p.root.SetRange(ast.SourceRange{Start: 0, End: len(css)})
	if p.trackSource {
		p.root.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(css))))
	}
	return p.root, nil
}

func (p *Parser) parseInto(container ast.Container, stopOnBrace bool) error {
	savedPending := p.pendingBefore
	savedBlock := p.blockStart
	p.pendingBefore = ""
	defer func() {
		p.pendingBefore = savedPending
		p.blockStart = savedBlock
	}()
	if !ast.HasRaw(container, "after") {
		ast.SetRawString(container, "after", "")
	}
	for !p.tok.EOF() {
		tokens, endBlock, err := p.collectStatement(stopOnBrace)
		if err != nil {
			return err
		}
		if len(tokens) == 0 && !endBlock {
			continue
		}
		if len(tokens) == 0 && endBlock {
			if len(container.Children()) > 0 {
				if !ast.HasRaw(container, "semicolon") {
					ast.SetRawBool(container, "semicolon", false)
				}
			}
			ast.SetRawString(container, "after", "")
			return nil
		}
		var blockTrailing string
		if endBlock {
			end := len(tokens)
			for end > 0 && tokens[end-1].Kind == "space" {
				end--
			}
			blockTrailing = tokensText(p.input, tokens[end:])
			if end < len(tokens) {
				tokens = tokens[:end]
			}
		}
		if err := p.buildNode(container, tokens); err != nil {
			return err
		}
		if endBlock {
			if blockTrailing != "" {
				if children := container.Children(); len(children) > 0 {
					if atRule, ok := children[len(children)-1].(*ast.AtRule); ok && !atRule.Block && !containerHasSemicolon(container) {
						ast.SetRawString(atRule, "between", blockTrailing)
						blockTrailing = ""
					} else if decl, ok := children[len(children)-1].(*ast.Declaration); ok && strings.HasPrefix(decl.Prop, "--") {
						if raw, ok := ast.LookupRaw(decl, "value"); ok {
							if value, ok := raw.(ast.RawValue); ok && strings.Contains(value.Raw, "*/") {
								value.Raw += blockTrailing
								ast.SetRawValue(decl, "value", value)
								blockTrailing = ""
							}
						} else if decl.Value == "" {
							decl.Value = blockTrailing
							blockTrailing = ""
						}
					}
				}
			}
			if blockTrailing != "" {
				after := blockTrailing
				if text, ok := ast.LookupRawString(container, "after"); ok {
					after = text + blockTrailing
				}
				ast.SetRawString(container, "after", after)
			}
			if len(container.Children()) > 0 {
				if !ast.HasRaw(container, "semicolon") {
					ast.SetRawBool(container, "semicolon", false)
				}
			}
			return nil
		}
	}
	if stopOnBrace {
		return p.syntaxError("Unclosed block: missing closing brace", p.blockStart)
	}
	return nil
}

func containerHasSemicolon(container ast.Container) bool {
	value, ok := ast.LookupRawBool(container, "semicolon")
	return ok && value
}

func (p *Parser) collectStatement(stopOnBrace bool) ([]tokenizer.Token, bool, error) {
	tokens := p.stmtBuf[:0]
	depth := 0
	parenDepth := 0
	squareDepth := 0
	bracketStart := -1

	for !p.tok.EOF() {
		token, err := p.tok.Next(tokenizer.NextOptions{})
		if err != nil {
			return nil, false, err
		}

		switch token.Kind {
		case "(":
			if parenDepth == 0 && squareDepth == 0 {
				bracketStart = token.Start
			}
			parenDepth++
		case ")":
			if parenDepth > 0 {
				parenDepth--
				if parenDepth == 0 && squareDepth == 0 {
					bracketStart = -1
				}
			}
		case "[":
			if parenDepth == 0 && squareDepth == 0 {
				bracketStart = token.Start
			}
			squareDepth++
		case "]":
			if squareDepth > 0 {
				squareDepth--
				if parenDepth == 0 && squareDepth == 0 {
					bracketStart = -1
				}
			}
		case "{":
			if parenDepth > 0 || squareDepth > 0 {
				tokens = append(tokens, token)
				continue
			}
			if depth == 0 && parenDepth == 0 && squareDepth == 0 {
				tokens = append(tokens, token)
				p.stmtBuf = tokens
				return tokens, false, nil
			}
			depth++
		case "}":
			if parenDepth > 0 || squareDepth > 0 {
				tokens = append(tokens, token)
				continue
			}
			if depth == 0 {
				if stopOnBrace {
					p.stmtBuf = tokens
					return tokens, true, nil
				}
				return nil, false, p.syntaxError("Unexpected }: unexpected closing brace", token.Start)
			}
			depth--
		case ";":
			if depth == 0 && parenDepth == 0 && squareDepth == 0 {
				tokens = append(tokens, token)
				p.stmtBuf = tokens
				return tokens, false, nil
			}
		}

		tokens = append(tokens, token)
	}
	if bracketStart >= 0 {
		return nil, false, p.syntaxError("Unclosed bracket", bracketStart)
	}

	p.stmtBuf = tokens
	return tokens, false, nil
}

func (p *Parser) buildNode(container ast.Container, tokens []tokenizer.Token) error {
	trimmed := trimSpaceTokens(tokens)
	if len(trimmed) == 0 {
		if spaces := tokensText(p.input, tokens); spaces != "" {
			ast.SetRawString(container, "after", spaces)
		}
		return nil
	}
	leading, body := splitLeadingFormatting(tokens)
	for _, token := range leading {
		if token.Kind == "comment" {
			p.appendLeadingComments(container, leading)
			lastComment := 0
			for index, item := range leading {
				if item.Kind == "comment" {
					lastComment = index + 1
				}
			}
			p.pendingBefore = tokensText(p.input, leading[lastComment:])
			tokens = body
			trimmed = trimSpaceTokens(tokens)
			break
		}
	}
	if len(trimmed) == 0 {
		return nil
	}
	last := trimmed[len(trimmed)-1]

	switch last.Kind {
	case "{":
		rawHeader := trimmed[:len(trimmed)-1]
		header := trimSpaceTokens(rawHeader)
		if len(header) == 0 {
			node := ast.NewRule("")
			ast.SetRawString(node, "before", p.takePendingBefore(container, leadingSpace(p.input, tokens)))
			ast.SetRawString(node, "between", "")
			if p.trackSource {
				p.attachSource(node, last.Start, last.End+1)
			}
			ast.AppendParsed(container, node)
			p.blockStart = last.Start
			return p.parseInto(node, true)
		}
		if header[0].Kind == "at-word" {
			node := p.makeAtRule(header)
			node.Block = true
			ast.SetRawString(node, "before", p.takePendingBefore(container, leadingSpace(p.input, tokens)))
			setAtRuleBetween(node, p.input, rawHeader)
			ast.AppendParsed(container, node)
			ast.SetRawBool(container, "semicolon", false)
			p.blockStart = header[0].Start
			return p.parseInto(node, true)
		}
		if isCustomPropertyBlock(p.input, header) {
			return p.appendCustomPropertyBlock(container, tokens, header, last)
		}
		node := p.makeRule(header)
		ast.SetRawString(node, "before", p.takePendingBefore(container, leadingSpace(p.input, tokens)))
		ast.SetRawString(node, "between", trailingFormatting(p.input, rawHeader))
		ast.AppendParsed(container, node)
		ast.SetRawBool(container, "semicolon", false)
		p.blockStart = header[0].Start
		return p.parseInto(node, true)
	case ";":
		end := len(tokens)
		for end > 0 && tokens[end-1].Kind != ";" {
			end--
		}
		if end == 0 {
			return nil
		}
		rawBody := tokens[:end-1]
		body := trimSpaceTokens(rawBody)
		if len(body) == 0 {
			return p.freeSemicolon(container, tokens[:end])
		}
		if body[0].Kind == "at-word" {
			if p.tokensText(body[0:1]) == "@" {
				return p.syntaxError("At-rule without name", body[0].Start)
			}
			node := p.makeAtRule(body)
			ast.SetRawString(node, "before", p.takePendingBefore(container, leadingSpace(p.input, tokens)))
			setAtRuleBetween(node, p.input, rawBody)
			p.extendSourceTo(node, tokens[len(tokens)-1].Start+1)
			ast.AppendParsed(container, node)
			ast.SetRawBool(container, "semicolon", true)
			return nil
		}
		if body[0].Kind == "comment" && len(body) == 1 {
			node := p.makeComment(body[0])
			ast.SetRawString(node, "before", p.takePendingBefore(container, leadingSpace(p.input, tokens)))
			ast.AppendParsed(container, node)
			return nil
		}
		if err := p.appendDeclaration(container, rawBody, true, tokens[len(tokens)-1].Start+1); err != nil {
			return err
		}
		ast.SetRawBool(container, "semicolon", true)
		return nil
	default:
		if trimmed[0].Kind == "at-word" {
			if p.tokensText(trimmed[0:1]) == "@" {
				return p.syntaxError("At-rule without name", trimmed[0].Start)
			}
			node := p.makeAtRule(trimmed)
			ast.SetRawString(node, "before", p.takePendingBefore(container, leadingSpace(p.input, tokens)))
			if len(trimmed) == 1 && p.trackSource {
				p.attachSource(node, trimmed[0].Start, trimmed[0].Start)
			}
			ast.AppendParsed(container, node)
			return nil
		}
		if len(trimmed) == 1 && trimmed[0].Kind == "comment" {
			node := p.makeComment(trimmed[0])
			ast.SetRawString(node, "before", leadingSpace(p.input, tokens))
			ast.AppendParsed(container, node)
			return nil
		}
		if err := p.appendDeclaration(container, tokens, false, -1); err != nil {
			return err
		}
		ast.SetRawBool(container, "semicolon", false)
		return nil
	}
}

func (p *Parser) freeSemicolon(container ast.Container, tokens []tokenizer.Token) error {
	children := container.Children()
	if len(children) == 0 {
		p.pendingBefore += tokensText(p.input, tokens)
		return nil
	}
	prev := children[len(children)-1]
	switch node := prev.(type) {
	case *ast.Rule:
		own := tokensText(p.input, tokens)
		if text, ok := ast.LookupRawString(node, "ownSemicolon"); ok {
			ast.SetRawString(node, "ownSemicolon", text+own)
		} else {
			ast.SetRawString(node, "ownSemicolon", own)
		}
		if node.Source() != nil {
			end := p.tok.Position()
			if strings.HasPrefix(own, " ") {
				end++
			}
			p.extendSourceTo(node, end)
		}
	case *ast.Declaration:
		ast.SetRawBool(container, "semicolon", true)
		text := tokensText(p.input, tokens)
		after := text
		if existing, ok := ast.LookupRawString(container, "after"); ok {
			after = existing + text
		}
		ast.SetRawString(container, "after", after)
	}
	return nil
}

func isCustomPropertyBlock(input string, tokens []tokenizer.Token) bool {
	return topLevelColon(tokens) >= 0 && strings.HasPrefix(strings.TrimSpace(tokensText(input, tokens)), "--")
}

func (p *Parser) appendCustomPropertyBlock(container ast.Container, tokens, header []tokenizer.Token, open tokenizer.Token) error {
	block := []tokenizer.Token{open}
	depth := 1
	for !p.tok.EOF() {
		token, err := p.tok.Next(tokenizer.NextOptions{})
		if err != nil {
			return err
		}
		block = append(block, token)
		switch token.Kind {
		case "{":
			depth++
		case "}":
			depth--
			if depth == 0 {
				trailing := make([]tokenizer.Token, 0, 2)
				terminated := false
				semicolonStart := -1
				for !p.tok.EOF() {
					next, err := p.tok.Next(tokenizer.NextOptions{})
					if err != nil {
						return err
					}
					if next.Kind == "space" || next.Kind == "comment" {
						trailing = append(trailing, next)
						continue
					}
					if next.Kind == ";" {
						terminated = true
						semicolonStart = next.Start
					} else {
						p.tok.Back(next)
					}
					break
				}
				propertyTokens := append([]tokenizer.Token{}, tokens...)
				propertyTokens = append(propertyTokens, block[1:]...)
				propertyTokens = append(propertyTokens, trailing...)
				decl, err := p.makeDeclaration(propertyTokens)
				if err != nil {
					return err
				}
				if raw, ok := ast.LookupRaw(decl, "value"); ok {
					if value, ok := raw.(ast.RawValue); ok && strings.HasPrefix(decl.Prop, "--") {
						decl.Value = value.Raw
						ast.DeleteRaw(decl, "value")
					}
				}
				ast.SetRawString(decl, "before", p.takePendingBefore(container, leadingSpace(p.input, tokens)))
				ast.AppendParsed(container, decl)
				if terminated {
					p.extendSourceTo(decl, semicolonStart+1)
					ast.SetRawBool(container, "semicolon", true)
				}
				return nil
			}
		}
	}
	return p.syntaxError("missing closing brace", open.Start)
}

func (p *Parser) appendDeclaration(container ast.Container, tokens []tokenizer.Token, withSemicolon bool, sourceEnd int) error {
	prefix, body := splitLeadingFormatting(tokens)
	if len(body) > 1 && body[0].Kind == ":" && topLevelColon(body[1:]) >= 0 {
		prefix = append(prefix, body[0])
		body = body[1:]
	}
	p.appendLeadingComments(container, prefix)

	declTokens := body
	var trailing []tokenizer.Token
	if !withSemicolon {
		colon := topLevelColon(body)
		custom := colon >= 0 && strings.HasPrefix(strings.TrimSpace(p.tokensText(body[:colon])), "--")
		if custom {
			declTokens, trailing = splitTrailingSpaces(body)
		} else {
			declTokens, trailing = splitTrailingFormatting(body)
		}
	}
	if len(trimSpaceTokens(declTokens)) == 0 {
		p.appendTrailingComments(container, trailing)
		return nil
	}

	decl, err := p.makeDeclaration(declTokens)
	if err != nil {
		return err
	}
	if sourceEnd >= 0 {
		p.extendSourceTo(decl, sourceEnd)
	}
	declBefore := trailingSpace(p.input, prefix)
	if strings.Contains(p.tokensText(prefix), ":") {
		declBefore = p.tokensText(prefix)
	}
	if text, ok := ast.LookupRawString(decl, "before"); ok {
		declBefore += text
	}
	ast.SetRawString(decl, "before", declBefore)
	if pending := p.pendingBefore; pending != "" {
		if text, ok := ast.LookupRawString(decl, "before"); ok {
			ast.SetRawString(decl, "before", pending+text)
		} else {
			ast.SetRawString(decl, "before", pending)
		}
		p.pendingBefore = ""
	}
	ast.AppendParsed(container, decl)
	p.appendTrailingComments(container, trailing)
	return nil
}

func (p *Parser) appendLeadingComments(container ast.Container, tokens []tokenizer.Token) {
	before := ""
	for _, token := range tokens {
		switch token.Kind {
		case "space":
			before += token.Text(p.input)
		case "comment":
			node := p.makeComment(token)
			ast.SetRawString(node, "before", before)
			ast.AppendParsed(container, node)
			before = ""
		}
	}
}

func (p *Parser) appendTrailingComments(container ast.Container, tokens []tokenizer.Token) {
	before := ""
	for _, token := range tokens {
		switch token.Kind {
		case "space":
			before += token.Text(p.input)
		case "comment":
			node := p.makeComment(token)
			ast.SetRawString(node, "before", before)
			ast.AppendParsed(container, node)
			before = ""
		}
	}
}

func (p *Parser) takePendingBefore(_ ast.Container, before string) string {
	if pending := p.pendingBefore; pending != "" {
		p.pendingBefore = ""
		return pending + before
	}
	return before
}

func splitLeadingFormatting(tokens []tokenizer.Token) (prefix, body []tokenizer.Token) {
	start := 0
	for start < len(tokens) && (tokens[start].Kind == "space" || tokens[start].Kind == "comment") {
		start++
	}
	return tokens[:start], tokens[start:]
}

func splitTrailingFormatting(tokens []tokenizer.Token) (body, trailing []tokenizer.Token) {
	end := len(tokens)
	for end > 0 && (tokens[end-1].Kind == "space" || tokens[end-1].Kind == "comment") {
		end--
	}
	return tokens[:end], tokens[end:]
}

func splitTrailingSpaces(tokens []tokenizer.Token) (body, trailing []tokenizer.Token) {
	end := len(tokens)
	for end > 0 && tokens[end-1].Kind == "space" {
		end--
	}
	return tokens[:end], tokens[end:]
}

func (p *Parser) makeRule(tokens []tokenizer.Token) *ast.Rule {
	selectorTokens, trailing := splitTrailingFormatting(tokens)
	rawSelector := p.tokensText(selectorTokens)
	selector := trimSpaceASCII(p.cleanSelectorValue(selectorTokens))
	rawSelector = strings.TrimPrefix(rawSelector, "\ufeff")
	selector = strings.TrimPrefix(selector, "\ufeff")
	node := ast.NewRule(selector)
	node.Nodes = make([]ast.Node, 0, 4)
	if trailingText := p.tokensText(trailing); trailingText != "" {
		ast.SetRawString(node, "between", trailingText)
	}
	if rawSelector != selector {
		ast.SetRawValue(node, "selector", ast.RawValue{Raw: rawSelector, Value: selector})
	}
	node.SetRange(ast.SourceRange{Start: selectorTokens[0].Start, End: selectorTokens[len(selectorTokens)-1].End})
	p.attachSource(node, selectorTokens[0].Start, selectorTokens[len(selectorTokens)-1].End+1)
	return node
}

func (p *Parser) cleanSelectorValue(tokens []tokenizer.Token) string {
	p.valueScratch.Reset()
	for index, token := range tokens {
		if token.Kind == "comment" {
			prev := "empty"
			if index > 0 {
				prev = tokens[index-1].Kind
			}
			next := "empty"
			if index+1 < len(tokens) {
				next = tokens[index+1].Kind
			}
			if prev != "space" && prev != "empty" && next != "space" && next != "empty" {
				p.valueScratch.WriteString(token.Text(p.input))
			}
			continue
		}
		p.valueScratch.WriteString(token.Text(p.input))
	}
	return p.valueScratch.String()
}

func (p *Parser) makeAtRule(tokens []tokenizer.Token) *ast.AtRule {
	name := strings.TrimPrefix(tokens[0].Text(p.input), "@")
	p.paramScratch = append(p.paramScratch[:0], tokens[1:]...)
	paramTokens := p.paramScratch
	between := takeSpacesAndCommentsFromEnd(p.input, &paramTokens)
	afterName := ""
	params := ""
	var paramsRaw ast.RawValue
	hasParamsRaw := false
	if len(paramTokens) > 0 {
		afterName = takeSpacesAndCommentsFromStart(p.input, &paramTokens)
		rawParams := p.tokensText(paramTokens)
		params = trimSpaceASCII(p.cleanAtRuleParams(paramTokens))
		if rawParams != params && params != "" {
			paramsRaw = ast.RawValue{Raw: rawParams, Value: params}
			hasParamsRaw = true
		}
	}
	node := ast.NewAtRule(name, params)
	ast.SetRawString(node, "afterName", afterName)
	ast.SetRawString(node, "between", between)
	if hasParamsRaw {
		ast.SetRawValue(node, "params", paramsRaw)
	}
	node.SetRange(ast.SourceRange{Start: tokens[0].Start, End: tokens[len(tokens)-1].End})
	p.attachSource(node, tokens[0].Start, tokens[len(tokens)-1].End+1)
	return node
}

func setAtRuleBetween(node *ast.AtRule, input string, tokens []tokenizer.Token) {
	if !ast.HasRaw(node, "between") {
		ast.SetRawString(node, "between", trailingFormatting(input, tokens))
		return
	}
	if suffix := trailingSpace(input, tokens); suffix != "" {
		if text, ok := ast.LookupRawString(node, "between"); ok {
			ast.SetRawString(node, "between", text+suffix)
			return
		}
		ast.SetRawString(node, "between", suffix)
	}
}

func appendRawString(node ast.Node, key, suffix string) {
	if suffix == "" {
		return
	}
	if text, ok := ast.LookupRawString(node, key); ok {
		ast.SetRawString(node, key, text+suffix)
		return
	}
	ast.SetRawString(node, key, suffix)
}

func (p *Parser) makeComment(token tokenizer.Token) *ast.Comment {
	raw := token.Text(p.input)
	text := strings.TrimSuffix(strings.TrimPrefix(raw, "/*"), "*/")
	trimmed := strings.TrimSpace(text)
	node := ast.NewComment(trimmed)
	if trimmed == "" {
		ast.SetRawString(node, "left", text)
		ast.SetRawString(node, "right", "")
	} else {
		left := text[:strings.Index(text, trimmed)]
		rightStart := strings.LastIndex(text, trimmed) + len(trimmed)
		ast.SetRawString(node, "left", left)
		ast.SetRawString(node, "right", text[rightStart:])
	}
	node.SetRange(ast.SourceRange{Start: token.Start, End: token.End})
	p.attachSource(node, token.Start, token.End+1)
	return node
}

func (p *Parser) makeDeclaration(tokens []tokenizer.Token) (*ast.Declaration, error) {
	original := tokens
	for len(tokens) > 0 && (tokens[0].Kind == "space" || tokens[0].Kind == "comment") {
		tokens = tokens[1:]
	}
	tokens = trimSpaceTokens(tokens)
	colon := topLevelColon(tokens)
	if colon < 0 {
		return nil, p.syntaxError("Unknown word: expected declaration", tokens[0].Start)
	}
	parenDepth, squareDepth, braceDepth := 0, 0, 0
	allowValueColons := tokensContainProgid(p.input, tokens[colon+1:])
	for index := colon + 1; index < len(tokens); index++ {
		switch tokens[index].Kind {
		case "(":
			parenDepth++
		case ")":
			if parenDepth > 0 {
				parenDepth--
			}
		case "[":
			squareDepth++
		case "]":
			if squareDepth > 0 {
				squareDepth--
			}
		case "{":
			braceDepth++
		case "}":
			if braceDepth > 0 {
				braceDepth--
			}
		}
		if parenDepth > 0 || squareDepth > 0 || braceDepth > 0 {
			continue
		}
		if tokens[index].Kind == ":" && !allowValueColons {
			if index == colon+1 {
				return nil, p.syntaxError("Double colon", tokens[index].Start)
			}
			valueEnd := index - 1
			for valueEnd >= 0 && (tokens[valueEnd].Kind == "space" || tokens[valueEnd].Kind == "comment") {
				valueEnd--
			}
			if valueEnd > colon {
				valueEnd--
				for valueEnd > colon && (tokens[valueEnd].Kind == "space" || tokens[valueEnd].Kind == "comment") {
					valueEnd--
				}
			}
			offset := tokens[index].Start
			if valueEnd > colon {
				offset = tokens[valueEnd].End + 1
				if tokens[valueEnd].Kind == ")" || tokens[valueEnd].Kind == "]" || tokens[valueEnd].Kind == "}" {
					offset = tokens[valueEnd].End
				}
			}
			return nil, p.syntaxError("Missed semicolon", offset)
		}
	}
	betweenStart := colon
	for betweenStart > 0 && (tokens[betweenStart-1].Kind == "space" || tokens[betweenStart-1].Kind == "comment") {
		betweenStart--
	}
	prop := trimSpaceASCII(p.tokensText(tokens[:betweenStart]))
	propertyPrefixRaw := ""
	if prop == "" {
		return nil, p.syntaxError("Unknown word: expected declaration", tokens[0].Start)
	}
	if strings.ContainsAny(prop, " \t\n\r") && !strings.Contains(prop, "\\") {
		for index := 1; index < colon; index++ {
			if tokens[index].Kind == "word" {
				return nil, p.syntaxError("Unknown word", tokens[index].Start)
			}
		}
	}
	propertyPrefix := strings.TrimLeft(prop, "*_")
	if propertyPrefix != prop {
		nodePrefix := prop[:len(prop)-len(propertyPrefix)]
		prop = propertyPrefix
		// PostCSS keeps legacy declaration hacks in raws.before.
		// The caller combines this with indentation/leading whitespace.
		propertyPrefixRaw = nodePrefix
	}
	customProperty := strings.HasPrefix(prop, "--")
	valueStart := colon + 1
	if !customProperty {
		for valueStart < len(tokens) && (tokens[valueStart].Kind == "space" || tokens[valueStart].Kind == "comment") {
			valueStart++
		}
	} else {
		probe := valueStart
		for probe < len(tokens) && tokens[probe].Kind == "space" {
			probe++
		}
		if probe < len(tokens) && tokens[probe].Kind == "comment" {
			afterComment := probe + 1
			for afterComment < len(tokens) && tokens[afterComment].Kind == "space" {
				afterComment++
			}
			if afterComment < len(tokens) && !strings.EqualFold(tokens[afterComment].Text(p.input), "!important") && !strings.EqualFold(tokens[afterComment].Text(p.input), "important") {
				valueStart = probe
			}
		} else if probe < len(tokens) && !strings.EqualFold(tokens[probe].Text(p.input), "!important") && !strings.EqualFold(tokens[probe].Text(p.input), "important") {
			valueStart = probe
		}
	}
	valueTokens := tokens[valueStart:]
	originalValueTokens := valueTokens
	important := false
	importantRaw := ""
	valueTokens, important, importantRaw = splitImportant(p.input, valueTokens)
	if customProperty && important {
		for index, token := range originalValueTokens {
			if strings.EqualFold(token.Text(p.input), "!important") && index > 0 && originalValueTokens[index-1].Kind == "comment" {
				valueTokens = originalValueTokens[:index]
				importantRaw = token.Text(p.input)
				break
			}
		}
	}
	rawValueText := trimSpaceASCII(p.tokensText(valueTokens))
	value := rawValueText
	if !customProperty {
		value = trimSpaceASCII(p.cleanDeclarationValue(valueTokens))
	} else {
		cleaned := p.cleanCustomPropertyValue(valueTokens)
		if important {
			importantRaw = strings.TrimLeft(importantRaw, " \t\r\n")
			for index, token := range originalValueTokens {
				text := strings.ToLower(token.Text(p.input))
				if text == "!important" || (text == "important" && index > 0 && originalValueTokens[index-1].Text(p.input) == "!") {
					prefix := originalValueTokens[:index]
					if len(prefix) > 0 {
						rawValueText = p.tokensText(prefix)
						value = trimSpaceASCII(p.cleanDeclarationValue(prefix))
						if strings.TrimSpace(value) == "" {
							value = p.cleanDeclarationValue(prefix)
						}
					}
					break
				}
			}
			if cleaned == "" {
				for _, token := range originalValueTokens {
					if token.Kind != "space" {
						break
					}
					valueTokens = append([]tokenizer.Token{token}, valueTokens...)
				}
				cleaned = p.cleanDeclarationValue(valueTokens)
			}
		}
		if trimSpaceASCII(cleaned) == "" && cleaned != "" {
			rawValueText = p.tokensText(valueTokens)
			value = cleaned
		}
	}
	node := ast.NewDeclaration(prop, value)
	if propertyPrefixRaw != "" {
		ast.SetRawString(node, "before", propertyPrefixRaw)
	}
	between := p.tokensText(tokens[betweenStart:valueStart])
	if customProperty && trimSpaceASCII(value) == "" {
		between = strings.TrimRight(between, " \t\r\n")
	}
	ast.SetRawString(node, "between", between)
	node.Important = important
	trailing := trailingSpace(p.input, original)
	if important {
		importantSuffix := importantRaw + trailing
		if importantSuffix != " !important" {
			ast.SetRawString(node, "important", importantSuffix)
		}
		if rawValueText != value {
			if customProperty && strings.HasSuffix(rawValueText, "*/") {
				rawValueText += " "
			}
			ast.SetRawValue(node, "value", ast.RawValue{Raw: rawValueText, Value: value})
		}
	} else if rawValueText != value || trailing != "" {
		ast.SetRawValue(node, "value", ast.RawValue{Raw: rawValueText + trailing, Value: value})
	}
	if customProperty && value == "" && trailing != "" {
		node.Value = trailing
		ast.DeleteRaw(node, "value")
	}
	node.SetRange(ast.SourceRange{Start: tokens[0].Start, End: tokens[len(tokens)-1].End})
	p.attachSource(node, tokens[0].Start, tokens[len(tokens)-1].End+1)
	return node, nil
}

func tokensContainProgid(input string, tokens []tokenizer.Token) bool {
	for index, token := range tokens {
		if strings.Contains(strings.ToLower(token.Text(input)), "progid:") {
			return true
		}
		if strings.EqualFold(token.Text(input), "progid") && index+1 < len(tokens) && tokens[index+1].Kind == ":" {
			return true
		}
	}
	return false
}

func tokensText(input string, tokens []tokenizer.Token) string {
	if len(tokens) == 0 {
		return ""
	}
	first := tokens[0]
	if len(tokens) == 1 {
		return first.Text(input)
	}
	last := tokens[len(tokens)-1]
	for i := 1; i < len(tokens); i++ {
		if tokens[i].Start != tokens[i-1].End+1 {
			var builder strings.Builder
			builder.Grow(last.End - first.Start + 1)
			for _, token := range tokens {
				builder.WriteString(token.Text(input))
			}
			return builder.String()
		}
	}
	end := last.End + 1
	if end > len(input) {
		end = len(input)
	}
	return input[first.Start:end]
}

func leadingSpace(input string, tokens []tokenizer.Token) string {
	return leadingKinds(input, tokens, "space")
}

func trailingSpace(input string, tokens []tokenizer.Token) string {
	return trailingKinds(input, tokens, "space")
}

func trailingFormatting(input string, tokens []tokenizer.Token) string {
	return trailingKinds(input, tokens, "space", "comment")
}

func leadingKinds(input string, tokens []tokenizer.Token, kinds ...string) string {
	start := 0
	for start < len(tokens) && kindIn(tokens[start].Kind, kinds...) {
		start++
	}
	return tokensText(input, tokens[:start])
}

func trailingKinds(input string, tokens []tokenizer.Token, kinds ...string) string {
	end := len(tokens)
	for end > 0 && kindIn(tokens[end-1].Kind, kinds...) {
		end--
	}
	return tokensText(input, tokens[end:])
}

func kindIn(kind string, kinds ...string) bool {
	for _, candidate := range kinds {
		if kind == candidate {
			return true
		}
	}
	return false
}

func takeSpacesAndCommentsFromStart(input string, tokens *[]tokenizer.Token) string {
	start := 0
	current := *tokens
	for start < len(current) && (current[start].Kind == "space" || current[start].Kind == "comment") {
		start++
	}
	text := tokensText(input, current[:start])
	*tokens = current[start:]
	return text
}

func takeSpacesAndCommentsFromEnd(input string, tokens *[]tokenizer.Token) string {
	current := *tokens
	end := len(current)
	for end > 0 && (current[end-1].Kind == "space" || current[end-1].Kind == "comment") {
		end--
	}
	text := tokensText(input, current[end:])
	*tokens = current[:end]
	return text
}

func splitImportant(input string, tokens []tokenizer.Token) ([]tokenizer.Token, bool, string) {
	end := len(tokens)
	for end > 0 && (tokens[end-1].Kind == "space" || tokens[end-1].Kind == "comment") {
		end--
	}
	if end == 0 {
		return tokens, false, ""
	}
	last := tokens[end-1]
	text := last.Text(input)
	if strings.EqualFold(text, "!important") {
		start := end - 1
		// Spaces before !important belong to raws.important, while a
		// comment immediately before it remains part of the value's raw.
		for start > 0 && tokens[start-1].Kind == "space" {
			start--
		}
		return tokens[:start], true, tokensText(input, tokens[start:])
	}
	if !strings.EqualFold(text, "important") {
		return tokens, false, ""
	}
	index := end - 2
	for index >= 0 {
		kind := tokens[index].Kind
		if kind == "space" || kind == "comment" {
			index--
			continue
		}
		word := tokens[index].Text(input)
		if word == "!" || strings.HasPrefix(strings.ToLower(word), "!") {
			start := index
			for start > 0 && tokens[start-1].Kind == "space" {
				start--
			}
			return tokens[:start], true, tokensText(input, tokens[start:])
		}
		break
	}
	return tokens, false, ""
}

func (p *Parser) cleanDeclarationValue(tokens []tokenizer.Token) string {
	for index, token := range tokens {
		if token.Kind != "comment" {
			continue
		}
		keep := index > 0 && index+1 < len(tokens) && tokens[index-1].Kind == "word" && strings.HasPrefix(tokens[index+1].Text(p.input), "(")
		if keep {
			continue
		}
		p.valueScratch.Reset()
		for i, item := range tokens {
			if item.Kind != "comment" {
				p.valueScratch.WriteString(item.Text(p.input))
				continue
			}
			if i > 0 && i+1 < len(tokens) && tokens[i-1].Kind == "word" && strings.HasPrefix(tokens[i+1].Text(p.input), "(") {
				p.valueScratch.WriteString(item.Text(p.input))
			}
		}
		return p.valueScratch.String()
	}
	return tokensText(p.input, tokens)
}

func (p *Parser) cleanCustomPropertyValue(tokens []tokenizer.Token) string {
	hasComment := false
	for _, token := range tokens {
		if token.Kind == "comment" {
			hasComment = true
			break
		}
	}
	if !hasComment {
		return tokensText(p.input, tokens)
	}
	p.valueScratch.Reset()
	for _, token := range tokens {
		if token.Kind == "comment" {
			continue
		}
		p.valueScratch.WriteString(token.Text(p.input))
	}
	if p.valueScratch.Len() == 0 {
		return " "
	}
	return p.valueScratch.String()
}

func (p *Parser) cleanAtRuleParams(tokens []tokenizer.Token) string {
	for _, token := range tokens {
		if token.Kind != "comment" {
			continue
		}
		p.valueScratch.Reset()
		for _, item := range tokens {
			if item.Kind != "comment" {
				p.valueScratch.WriteString(item.Text(p.input))
			}
		}
		return p.valueScratch.String()
	}
	return tokensText(p.input, tokens)
}

func estimateTopLevelCapacity(cssLen int) int {
	if cssLen < 4096 {
		return 32
	}
	return cssLen / 100
}

func trimSpaceASCII(value string) string {
	start, end := 0, len(value)
	for start < end && isASCIISpace(value[start]) {
		start++
	}
	for end > start && isASCIISpace(value[end-1]) {
		end--
	}
	if start == 0 && end == len(value) {
		return value
	}
	return value[start:end]
}

func isASCIISpace(ch byte) bool {
	return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch == '\f'
}

func cleanDeclarationValue(input string, tokens []tokenizer.Token) string {
	return (&Parser{input: input}).cleanDeclarationValue(tokens)
}

func cleanCustomPropertyValue(input string, tokens []tokenizer.Token) string {
	return (&Parser{input: input}).cleanCustomPropertyValue(tokens)
}

func (p *Parser) attachSource(node ast.Node, start, end int) {
	if !p.trackSource {
		return
	}
	var loc sourcemap.Location
	p.src.FillLocation(p.src.FromOffset(start), p.src.FromOffset(end), &loc)
	node.SetSource(&loc)
}

func (p *Parser) extendSourceTo(node ast.Node, end int) {
	if !p.trackSource || node.Source() == nil {
		return
	}
	start := node.Source().Start.Offset
	node.SetRange(ast.SourceRange{Start: start, End: end})
	var loc sourcemap.Location
	p.src.FillLocation(p.src.FromOffset(start), p.src.FromOffset(end), &loc)
	node.SetSource(&loc)
}

func (p *Parser) tokensText(tokens []tokenizer.Token) string {
	return tokensText(p.input, tokens)
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
	file := strings.ToLower(p.src.File)
	if strings.HasPrefix(message, "Unknown word") {
		switch {
		case strings.HasSuffix(file, ".scss"):
			message += "; try postcss-scss"
		case strings.HasSuffix(file, ".sass"):
			message += "; try postcss-sass"
		case strings.HasSuffix(file, ".less"):
			message += "; try postcss-less"
		}
	}
	return p.src.ErrorAtOffset(message, offset, "")
}
