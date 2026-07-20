package parser

import (
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
	pending     map[ast.Container]string
	blockStarts map[ast.Container]int
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
		pending:     make(map[ast.Container]string),
		blockStarts: make(map[ast.Container]int),
	}
	p.root.RawFormatting()["after"] = ""
	if err := p.parseInto(p.root, false); err != nil {
		return nil, err
	}
	if len(p.root.Children()) > 0 {
		if _, ok := p.root.RawFormattingReadOnly()["semicolon"]; !ok {
			p.root.RawFormatting()["semicolon"] = false
		}
	}
	p.root.SetRange(ast.SourceRange{Start: 0, End: len(css)})
	if p.trackSource {
		p.root.SetSource(input.Location(input.FromOffset(0), input.FromOffset(len(css))))
	}
	return p.root, nil
}

func (p *Parser) parseInto(container ast.Container, stopOnBrace bool) error {
	if _, ok := container.RawFormattingReadOnly()["after"]; !ok {
		container.RawFormatting()["after"] = ""
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
				if _, ok := container.RawFormattingReadOnly()["semicolon"]; !ok {
					container.RawFormatting()["semicolon"] = false
				}
			}
			container.RawFormatting()["after"] = ""
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
					if atRule, ok := children[len(children)-1].(*ast.AtRule); ok && !atRule.Block {
						atRule.RawFormatting()["between"] = blockTrailing
						blockTrailing = ""
					} else if decl, ok := children[len(children)-1].(*ast.Declaration); ok && strings.HasPrefix(decl.Prop, "--") {
						if raw, ok := decl.RawFormattingReadOnly()["value"].(ast.RawValue); ok {
							if strings.Contains(raw.Raw, "*/") {
								raw.Raw += blockTrailing
								decl.RawFormatting()["value"] = raw
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
				if existing, ok := container.RawFormattingReadOnly()["after"].(string); ok {
					container.RawFormatting()["after"] = existing + blockTrailing
				} else {
					container.RawFormatting()["after"] = blockTrailing
				}
			}
			if len(container.Children()) > 0 {
				if _, ok := container.RawFormattingReadOnly()["semicolon"]; !ok {
					container.RawFormatting()["semicolon"] = false
				}
			}
			return nil
		}
	}
	if stopOnBrace {
		return p.syntaxError("Unclosed block: missing closing brace", p.blockStarts[container])
	}
	return nil
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
			container.RawFormatting()["after"] = spaces
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
			p.pending[container] = tokensText(p.input, leading[lastComment:])
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
			node.RawFormatting()["before"] = p.takePendingBefore(container, leadingSpace(p.input, tokens))
			node.RawFormatting()["between"] = ""
			if p.trackSource {
				node.SetSource(p.location(last.Start, last.End+1))
			}
			container.Append(node)
			p.blockStarts[node] = last.Start
			return p.parseInto(node, true)
		}
		if header[0].Kind == "at-word" {
			node := p.makeAtRule(header)
			node.Block = true
			node.RawFormatting()["before"] = p.takePendingBefore(container, leadingSpace(p.input, tokens))
			setAtRuleBetween(node, p.input, rawHeader)
			container.Append(node)
			container.RawFormatting()["semicolon"] = false
			p.blockStarts[node] = header[0].Start
			return p.parseInto(node, true)
		}
		if isCustomPropertyBlock(p.input, header) {
			return p.appendCustomPropertyBlock(container, tokens, header, last)
		}
		node := p.makeRule(header)
		node.RawFormatting()["before"] = p.takePendingBefore(container, leadingSpace(p.input, tokens))
		node.RawFormatting()["between"] = trailingFormatting(p.input, rawHeader)
		container.Append(node)
		container.RawFormatting()["semicolon"] = false
		p.blockStarts[node] = header[0].Start
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
			node.RawFormatting()["before"] = p.takePendingBefore(container, leadingSpace(p.input, tokens))
			setAtRuleBetween(node, p.input, rawBody)
			p.extendSourceTo(node, tokens[len(tokens)-1].Start+1)
			container.Append(node)
			container.RawFormatting()["semicolon"] = true
			return nil
		}
		if body[0].Kind == "comment" && len(body) == 1 {
			node := p.makeComment(body[0])
			node.RawFormatting()["before"] = p.takePendingBefore(container, leadingSpace(p.input, tokens))
			container.Append(node)
			return nil
		}
		if err := p.appendDeclaration(container, rawBody, true, tokens[len(tokens)-1].Start+1); err != nil {
			return err
		}
		container.RawFormatting()["semicolon"] = true
		return nil
	default:
		if trimmed[0].Kind == "at-word" {
			if p.tokensText(trimmed[0:1]) == "@" {
				return p.syntaxError("At-rule without name", trimmed[0].Start)
			}
			node := p.makeAtRule(trimmed)
			node.RawFormatting()["before"] = p.takePendingBefore(container, leadingSpace(p.input, tokens))
			if len(trimmed) == 1 && p.trackSource {
				node.SetSource(p.location(trimmed[0].Start, trimmed[0].Start))
			}
			container.Append(node)
			return nil
		}
		if len(trimmed) == 1 && trimmed[0].Kind == "comment" {
			node := p.makeComment(trimmed[0])
			node.RawFormatting()["before"] = leadingSpace(p.input, tokens)
			container.Append(node)
			return nil
		}
		if err := p.appendDeclaration(container, tokens, false, -1); err != nil {
			return err
		}
		container.RawFormatting()["semicolon"] = false
		return nil
	}
}

func (p *Parser) freeSemicolon(container ast.Container, tokens []tokenizer.Token) error {
	children := container.Children()
	if len(children) == 0 {
		p.pending[container] += tokensText(p.input, tokens)
		return nil
	}
	prev := children[len(children)-1]
	switch node := prev.(type) {
	case *ast.Rule:
		own := tokensText(p.input, tokens)
		if existing, ok := node.RawFormattingReadOnly()["ownSemicolon"].(string); ok {
			node.RawFormatting()["ownSemicolon"] = existing + own
		} else {
			node.RawFormatting()["ownSemicolon"] = own
		}
		if node.Source() != nil {
			end := p.tok.Position()
			if strings.HasPrefix(own, " ") {
				end++
			}
			p.extendSourceTo(node, end)
		}
	case *ast.Declaration:
		container.RawFormatting()["semicolon"] = true
		text := tokensText(p.input, tokens)
		if existing, ok := container.RawFormattingReadOnly()["after"].(string); ok {
			container.RawFormatting()["after"] = existing + text
		} else {
			container.RawFormatting()["after"] = text
		}
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
				if raw, ok := decl.RawFormattingReadOnly()["value"].(ast.RawValue); ok && strings.HasPrefix(decl.Prop, "--") {
					decl.Value = raw.Raw
					delete(decl.RawFormatting(), "value")
				}
				decl.RawFormatting()["before"] = p.takePendingBefore(container, leadingSpace(p.input, tokens))
				container.Append(decl)
				if terminated {
					p.extendSourceTo(decl, semicolonStart+1)
					container.RawFormatting()["semicolon"] = true
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
	if existing, ok := decl.RawFormattingReadOnly()["before"].(string); ok {
		declBefore += existing
	}
	decl.RawFormatting()["before"] = declBefore
	if pending := p.pending[container]; pending != "" {
		decl.RawFormatting()["before"] = pending + decl.RawFormattingReadOnly()["before"].(string)
		delete(p.pending, container)
	}
	container.Append(decl)
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
			node.RawFormatting()["before"] = before
			container.Append(node)
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
			node.RawFormatting()["before"] = before
			container.Append(node)
			before = ""
		}
	}
}

func (p *Parser) takePendingBefore(container ast.Container, before string) string {
	if pending := p.pending[container]; pending != "" {
		delete(p.pending, container)
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
	selector := strings.TrimSpace(cleanSelectorValue(p.input, selectorTokens))
	rawSelector = strings.TrimPrefix(rawSelector, "\ufeff")
	selector = strings.TrimPrefix(selector, "\ufeff")
	node := ast.NewRule(selector)
	if trailingText := p.tokensText(trailing); trailingText != "" {
		node.RawFormatting()["between"] = trailingText
	}
	if rawSelector != selector {
		node.RawFormatting()["selector"] = ast.RawValue{Raw: rawSelector, Value: selector}
	}
	node.SetRange(ast.SourceRange{Start: selectorTokens[0].Start, End: selectorTokens[len(selectorTokens)-1].End})
	p.attachSource(node, selectorTokens[0].Start, selectorTokens[len(selectorTokens)-1].End+1)
	return node
}

func cleanSelectorValue(input string, tokens []tokenizer.Token) string {
	var builder strings.Builder
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
				builder.WriteString(token.Text(input))
			}
			continue
		}
		builder.WriteString(token.Text(input))
	}
	return builder.String()
}

func (p *Parser) makeAtRule(tokens []tokenizer.Token) *ast.AtRule {
	name := strings.TrimPrefix(tokens[0].Text(p.input), "@")
	paramTokens := append([]tokenizer.Token(nil), tokens[1:]...)
	between := takeSpacesAndCommentsFromEnd(p.input, &paramTokens)
	afterName := ""
	params := ""
	var paramsRaw ast.RawValue
	hasParamsRaw := false
	if len(paramTokens) > 0 {
		afterName = takeSpacesAndCommentsFromStart(p.input, &paramTokens)
		rawParams := p.tokensText(paramTokens)
		params = strings.TrimSpace(cleanAtRuleParams(p.input, paramTokens))
		if rawParams != params && params != "" {
			paramsRaw = ast.RawValue{Raw: rawParams, Value: params}
			hasParamsRaw = true
		}
	}
	node := ast.NewAtRule(name, params)
	node.RawFormatting()["afterName"] = afterName
	node.RawFormatting()["between"] = between
	if hasParamsRaw {
		node.RawFormatting()["params"] = paramsRaw
	}
	node.SetRange(ast.SourceRange{Start: tokens[0].Start, End: tokens[len(tokens)-1].End})
	p.attachSource(node, tokens[0].Start, tokens[len(tokens)-1].End+1)
	return node
}

func setAtRuleBetween(node *ast.AtRule, input string, tokens []tokenizer.Token) {
	raws := node.RawFormatting()
	if _, ok := raws["between"]; !ok {
		raws["between"] = trailingFormatting(input, tokens)
		return
	}
	appendRawString(raws, "between", trailingSpace(input, tokens))
}

func appendRawString(raws ast.Raws, key, suffix string) {
	if suffix == "" {
		return
	}
	if value, ok := raws[key].(string); ok {
		raws[key] = value + suffix
		return
	}
	raws[key] = suffix
}

func (p *Parser) makeComment(token tokenizer.Token) *ast.Comment {
	raw := token.Text(p.input)
	text := strings.TrimSuffix(strings.TrimPrefix(raw, "/*"), "*/")
	trimmed := strings.TrimSpace(text)
	node := ast.NewComment(trimmed)
	if trimmed == "" {
		node.RawFormatting()["left"] = text
		node.RawFormatting()["right"] = ""
	} else {
		left := text[:strings.Index(text, trimmed)]
		rightStart := strings.LastIndex(text, trimmed) + len(trimmed)
		node.RawFormatting()["left"] = left
		node.RawFormatting()["right"] = text[rightStart:]
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
	allowValueColons := strings.Contains(strings.ToLower(p.tokensText(tokens[colon+1:])), "progid:")
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
	prop := strings.TrimSpace(p.tokensText(tokens[:betweenStart]))
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
	rawValueText := strings.TrimSpace(p.tokensText(valueTokens))
	value := rawValueText
	if !customProperty {
		value = strings.TrimSpace(cleanDeclarationValue(p.input, valueTokens))
	} else {
		cleaned := cleanCustomPropertyValue(p.input, valueTokens)
		if important {
			importantRaw = strings.TrimLeft(importantRaw, " \t\r\n")
			for index, token := range originalValueTokens {
				text := strings.ToLower(token.Text(p.input))
				if text == "!important" || (text == "important" && index > 0 && originalValueTokens[index-1].Text(p.input) == "!") {
					prefix := originalValueTokens[:index]
					if len(prefix) > 0 {
						rawValueText = p.tokensText(prefix)
						value = strings.TrimSpace(cleanDeclarationValue(p.input, prefix))
						if strings.TrimSpace(value) == "" {
							value = cleanDeclarationValue(p.input, prefix)
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
				cleaned = cleanDeclarationValue(p.input, valueTokens)
			}
		}
		if strings.TrimSpace(cleaned) == "" && cleaned != "" {
			rawValueText = p.tokensText(valueTokens)
			value = cleaned
		}
	}
	node := ast.NewDeclaration(prop, value)
	if propertyPrefixRaw != "" {
		node.RawFormatting()["before"] = propertyPrefixRaw
	}
	node.RawFormatting()["between"] = p.tokensText(tokens[betweenStart:valueStart])
	if customProperty && strings.TrimSpace(value) == "" {
		node.RawFormatting()["between"] = strings.TrimRight(node.RawFormattingReadOnly()["between"].(string), " \t\r\n")
	}
	node.Important = important
	trailing := trailingSpace(p.input, original)
	if important {
		importantSuffix := importantRaw + trailing
		if importantSuffix != " !important" {
			node.RawFormatting()["important"] = importantSuffix
		}
		if rawValueText != value {
			if customProperty && strings.HasSuffix(rawValueText, "*/") {
				rawValueText += " "
			}
			node.RawFormatting()["value"] = ast.RawValue{Raw: rawValueText, Value: value}
		}
	} else if rawValueText != value || trailing != "" {
		node.RawFormatting()["value"] = ast.RawValue{Raw: rawValueText + trailing, Value: value}
	}
	if customProperty && value == "" && trailing != "" {
		node.Value = trailing
		delete(node.RawFormatting(), "value")
	}
	node.SetRange(ast.SourceRange{Start: tokens[0].Start, End: tokens[len(tokens)-1].End})
	p.attachSource(node, tokens[0].Start, tokens[len(tokens)-1].End+1)
	return node, nil
}

func tokensText(input string, tokens []tokenizer.Token) string {
	if len(tokens) == 0 {
		return ""
	}
	if len(tokens) == 1 {
		return tokens[0].Text(input)
	}
	var builder strings.Builder
	builder.Grow(tokens[len(tokens)-1].End - tokens[0].Start + 1)
	for _, token := range tokens {
		builder.WriteString(token.Text(input))
	}
	return builder.String()
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

func cleanDeclarationValue(input string, tokens []tokenizer.Token) string {
	var builder strings.Builder
	for index, token := range tokens {
		if token.Kind != "comment" {
			builder.WriteString(token.Text(input))
			continue
		}
		if index > 0 && index+1 < len(tokens) && tokens[index-1].Kind == "word" && strings.HasPrefix(tokens[index+1].Text(input), "(") {
			builder.WriteString(token.Text(input))
		}
	}
	return builder.String()
}

func cleanCustomPropertyValue(input string, tokens []tokenizer.Token) string {
	var builder strings.Builder
	hasComment := false
	for _, token := range tokens {
		if token.Kind == "comment" {
			hasComment = true
			continue
		}
		builder.WriteString(token.Text(input))
	}
	if builder.Len() == 0 && hasComment {
		return " "
	}
	return builder.String()
}

func cleanAtRuleParams(input string, tokens []tokenizer.Token) string {
	var builder strings.Builder
	for _, token := range tokens {
		if token.Kind != "comment" {
			builder.WriteString(token.Text(input))
			continue
		}
	}
	return builder.String()
}

func (p *Parser) attachSource(node ast.Node, start, end int) {
	if !p.trackSource {
		return
	}
	node.SetSource(p.location(start, end))
}

func (p *Parser) extendSourceTo(node ast.Node, end int) {
	if !p.trackSource || node.Source() == nil {
		return
	}
	start := node.Source().Start.Offset
	node.SetRange(ast.SourceRange{Start: start, End: end})
	node.SetSource(p.location(start, end))
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

func (p *Parser) location(start, end int) *source.Location {
	return p.src.Location(p.src.FromOffset(start), p.src.FromOffset(end))
}
