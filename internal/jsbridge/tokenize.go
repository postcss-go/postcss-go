package jsbridge

import (
	"context"
	"fmt"
	"sync/atomic"

	"github.com/creachadair/jrpc2/handler"
	"postcss-go/internal/tokenizer"
)

var nextTokenizeSessionID int64

type tokenizeSession struct {
	input     string
	processor *tokenizer.Tokenizer
	returned  [][]any
}

type TokenizeOpenParams struct {
	CSS     string            `json:"css"`
	File    string            `json:"file,omitempty"`
	Options tokenizer.Options `json:"options,omitempty"`
}

type TokenizeOpenResult struct {
	ID int64 `json:"id"`
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

var tokenizeSessions = map[int64]*tokenizeSession{}

func tokenizeAssigner() handler.Map {
	return handler.Map{
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
	tokenizeSessions[id] = &tokenizeSession{
		input:     params.CSS,
		processor: tokenizer.New(params.CSS, options),
		returned:  make([][]any, 0),
	}
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
	return &TokenizeNextResult{Token: legacyToken(session.input, token)}, nil
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
	return &TokenizeIntResult{Value: session.processor.Position()}, nil
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

func TokenizeCloseRPC(_ context.Context, params TokenizeSessionParams) (struct{}, error) {
	if _, ok := tokenizeSessions[params.ID]; !ok {
		return struct{}{}, fmt.Errorf("unknown tokenize session %d", params.ID)
	}
	delete(tokenizeSessions, params.ID)
	return struct{}{}, nil
}

func tokenizeSessionByID(id int64) (*tokenizeSession, error) {
	session, ok := tokenizeSessions[id]
	if !ok {
		return nil, fmt.Errorf("unknown tokenize session %d", id)
	}
	return session, nil
}
