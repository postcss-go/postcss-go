package jsbridge

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"unicode/utf8"

	"postcss-go/internal/tokenizer"

	"github.com/creachadair/jrpc2/handler"
)

var nextTokenizeSessionID int64

type TokenizeOpenParams struct {
	CSS     string            `json:"css"`
	File    string            `json:"file,omitempty"`
	Options tokenizer.Options `json:"options,omitempty"`
}

type TokenizeOpenResult struct {
	ID int64 `json:"id"`
}

type tokenizeSession struct {
	input     string
	utf16     []int
	processor *tokenizer.Tokenizer
	returned  [][]any
}

type TokenizeSessionParams struct {
	ID int64 `json:"id"`
}

type TokenizeNextParams struct {
	ID      int64                 `json:"id"`
	Options tokenizer.NextOptions `json:"options,omitempty"`
}

type TokenizeNextResult struct {
	Token []any `json:"token,omitempty"`
}

type TokenizeBackParams struct {
	ID    int64 `json:"id"`
	Token []any `json:"token"`
}

type TokenizeBoolResult struct {
	Value bool `json:"value"`
}

type TokenizeIntResult struct {
	Value int `json:"value"`
}

// TokenizeBatchParams is used by the compatibility layer's synchronous bridge.
// The long-lived RPC surface keeps the session methods above for callers that
// need incremental tokenization; the single-request compatibility bridge uses
// this snapshot form because a new process is used for each request.
type TokenizeBatchParams struct {
	CSS            string            `json:"css"`
	File           string            `json:"file,omitempty"`
	Options        tokenizer.Options `json:"options,omitempty"`
	IgnoreUnclosed bool              `json:"ignoreUnclosed,omitempty"`
}

type TokenizeBatchResult struct {
	Tokens     [][]any   `json:"tokens"`
	Positions  []int     `json:"positions"`
	Error      *ErrorDTO `json:"error,omitempty"`
	ErrorIndex int       `json:"errorIndex"`
}

var (
	tokenizeSessions   = map[int64]*tokenizeSession{}
	tokenizeSessionsMu sync.Mutex
)

func tokenizeAssigner() handler.Map {
	return handler.Map{
		"tokenize":          handler.New(TokenizeBatchRPC),
		"tokenize.open":     handler.New(TokenizeOpenRPC),
		"tokenize.next":     handler.New(TokenizeNextRPC),
		"tokenize.back":     handler.New(TokenizeBackRPC),
		"tokenize.position": handler.New(TokenizePositionRPC),
		"tokenize.eof":      handler.New(TokenizeEOFRPC),
		"tokenize.close":    handler.New(TokenizeCloseRPC),
	}
}

func TokenizeOpenRPC(_ context.Context, params TokenizeOpenParams) (*TokenizeOpenResult, error) {
	id := atomic.AddInt64(&nextTokenizeSessionID, 1)
	options := params.Options
	options.File = params.File
	tokenizeSessionsMu.Lock()
	tokenizeSessions[id] = &tokenizeSession{
		input:     params.CSS,
		utf16:     makeUTF16Table(params.CSS),
		processor: tokenizer.New(params.CSS, options),
		returned:  make([][]any, 0),
	}
	tokenizeSessionsMu.Unlock()
	return &TokenizeOpenResult{ID: id}, nil
}

func TokenizeNextRPC(_ context.Context, params TokenizeNextParams) (*TokenizeNextResult, error) {
	session, err := tokenizeSessionByID(params.ID)
	if err != nil {
		return nil, err
	}
	if len(session.returned) > 0 {
		last := session.returned[len(session.returned)-1]
		session.returned = session.returned[:len(session.returned)-1]
		return &TokenizeNextResult{Token: last}, nil
	}
	token, err := session.processor.Next(params.Options)
	if err != nil {
		return nil, err
	}
	if token.Kind == "" {
		return &TokenizeNextResult{}, nil
	}
	return &TokenizeNextResult{Token: legacyTokenUTF16(session.input, session.utf16, token)}, nil
}

// TokenizeBatchRPC returns the complete compatibility-shaped token stream in one
// pass. If strict tokenization fails, it records the error index and continues
// with unclosed input ignored so the JS wrapper can implement
// nextToken({ ignoreUnclosed }) without a second RPC or a second scan.
func TokenizeBatchRPC(_ context.Context, params TokenizeBatchParams) (*TokenizeBatchResult, error) {
	options := params.Options
	options.File = params.File
	return tokenizeBatch(params.CSS, options, params.IgnoreUnclosed || options.IgnoreErrors), nil
}

func tokenizeBatch(input string, options tokenizer.Options, ignoreUnclosed bool) *TokenizeBatchResult {
	tok := tokenizer.New(input, options)
	utf16 := makeUTF16Table(input)
	result := &TokenizeBatchResult{Tokens: make([][]any, 0), Positions: make([]int, 0)}
	ignore := ignoreUnclosed
	for !tok.EOF() {
		token, err := tok.Next(tokenizer.NextOptions{IgnoreUnclosed: ignore})
		if err != nil {
			if result.Error == nil {
				result.Error = ErrorDTOFromError(err)
				result.ErrorIndex = len(result.Tokens)
			}
			ignore = true
			continue
		}
		if token.Kind == "" {
			break
		}
		result.Tokens = append(result.Tokens, legacyTokenUTF16(input, utf16, token))
		result.Positions = append(result.Positions, utf16Offset(utf16, len(input), tok.Position()))
	}
	return result
}

func TokenizeBackRPC(_ context.Context, params TokenizeBackParams) (struct{}, error) {
	session, err := tokenizeSessionByID(params.ID)
	if err != nil {
		return struct{}{}, err
	}
	session.returned = append(session.returned, params.Token)
	return struct{}{}, nil
}

func TokenizePositionRPC(_ context.Context, params TokenizeSessionParams) (*TokenizeIntResult, error) {
	session, err := tokenizeSessionByID(params.ID)
	if err != nil {
		return nil, err
	}
	return &TokenizeIntResult{Value: utf16Offset(session.utf16, len(session.input), session.processor.Position())}, nil
}

func TokenizeEOFRPC(_ context.Context, params TokenizeSessionParams) (*TokenizeBoolResult, error) {
	session, err := tokenizeSessionByID(params.ID)
	if err != nil {
		return nil, err
	}
	return &TokenizeBoolResult{Value: len(session.returned) == 0 && session.processor.EOF()}, nil
}

func legacyToken(input string, token tokenizer.Token) []any {
	text := token.Text(input)
	switch token.Kind {
	case "space":
		return []any{"space", text}
	case "word", "at-word", "comment", "brackets", "string":
		return []any{token.Kind, text, token.Start, token.End}
	default:
		return []any{token.Kind, text, token.Start}
	}
}

func legacyTokenUTF16(input string, table []int, token tokenizer.Token) []any {
	start := utf16Offset(table, len(input), token.Start)
	end := token.End
	if end < len(input) {
		end = utf16Offset(table, len(input), end+1) - 1
	} else {
		end = utf16Offset(table, len(input), end)
	}
	text := token.Text(input)
	switch token.Kind {
	case "space":
		return []any{"space", text}
	case "word", "at-word", "comment", "brackets", "string":
		return []any{token.Kind, text, start, end}
	default:
		return []any{token.Kind, text, start}
	}
}

func makeUTF16Table(input string) []int {
	table := make([]int, len(input)+1)
	utf16 := 0
	for index := 0; index < len(input); {
		r, size := utf8.DecodeRuneInString(input[index:])
		for offset := 0; offset < size; offset++ {
			table[index+offset] = utf16
		}
		if r > 0xffff {
			utf16 += 2
		} else {
			utf16++
		}
		index += size
		table[index] = utf16
	}
	table[len(input)] = utf16
	return table
}

func utf16Offset(table []int, inputLen, offset int) int {
	if offset < 0 {
		return 0
	}
	if offset <= inputLen {
		return table[offset]
	}
	return table[inputLen] + offset - inputLen
}

func TokenizeCloseRPC(_ context.Context, params TokenizeSessionParams) (struct{}, error) {
	tokenizeSessionsMu.Lock()
	defer tokenizeSessionsMu.Unlock()
	if _, ok := tokenizeSessions[params.ID]; !ok {
		return struct{}{}, fmt.Errorf("unknown tokenize session %d", params.ID)
	}
	delete(tokenizeSessions, params.ID)
	return struct{}{}, nil
}

func tokenizeSessionByID(id int64) (*tokenizeSession, error) {
	tokenizeSessionsMu.Lock()
	defer tokenizeSessionsMu.Unlock()
	session, ok := tokenizeSessions[id]
	if !ok {
		return nil, fmt.Errorf("unknown tokenize session %d", id)
	}
	return session, nil
}
