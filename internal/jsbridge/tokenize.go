package jsbridge

import (
	"context"
	"fmt"
	"sync/atomic"

	"github.com/creachadair/jrpc2/handler"
	"postcss-go/internal/tokenize"
)

var nextTokenizeSessionID int64

type tokenizeSession struct {
	processor *tokenize.Processor
}

type TokenizeOpenParams struct {
	CSS     string           `json:"css"`
	File    string           `json:"file,omitempty"`
	Options tokenize.Options `json:"options,omitempty"`
}

type TokenizeOpenResult struct {
	ID int64 `json:"id"`
}

type TokenizeSessionParams struct {
	ID int64 `json:"id"`
}

type TokenizeNextParams struct {
	ID      int64                `json:"id"`
	Options tokenize.NextOptions `json:"options,omitempty"`
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
	input := &tokenize.Input{CSS: params.CSS, File: params.File}
	tokenizeSessions[id] = &tokenizeSession{
		processor: tokenize.New(input, params.Options),
	}
	return &TokenizeOpenResult{ID: id}, nil
}

func TokenizeNextRPC(_ context.Context, params TokenizeNextParams) (*TokenizeNextResult, error) {
	session, err := tokenizeSessionByID(params.ID)
	if err != nil {
		return nil, err
	}
	token, err := session.processor.NextToken(params.Options)
	if err != nil {
		return nil, err
	}
	return &TokenizeNextResult{Token: token}, nil
}

func TokenizeBackRPC(_ context.Context, params TokenizeBackParams) (struct{}, error) {
	session, err := tokenizeSessionByID(params.ID)
	if err != nil {
		return struct{}{}, err
	}
	session.processor.Back(params.Token)
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
	return &TokenizeBoolResult{Value: session.processor.EndOfFile()}, nil
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
