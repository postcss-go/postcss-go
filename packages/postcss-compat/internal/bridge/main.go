// Command bridge is a private upstream-compatibility test harness. It is not
// built, shipped, or selected by postcss-go.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/creachadair/jrpc2"
	"github.com/creachadair/jrpc2/channel"
	"github.com/creachadair/jrpc2/handler"
	"postcss-go/internal/jsbridge"
)

type nopWriteCloser struct{}

func (nopWriteCloser) Write(p []byte) (int, error) {
	return os.Stdout.Write(p)
}

func (nopWriteCloser) Close() error {
	return nil
}

func main() {
	var err error
	if len(os.Args) > 1 && os.Args[1] == "--single" {
		err = runSingle()
	} else {
		err = run()
	}
	if err != nil && !errors.Is(err, os.ErrClosed) {
		_, _ = fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run() error {
	srv := jrpc2.NewServer(rpcMethods(), nil).Start(channel.Line(os.Stdin, nopWriteCloser{}))
	return srv.Wait()
}

func rpcMethods() handler.Map {
	return handler.Map{
		"parse":             handler.New(jsbridge.ParseRPC),
		"process":           handler.New(jsbridge.ProcessRPC),
		"noWork":            handler.New(jsbridge.NoWorkRPC),
		"stringify":         handler.New(jsbridge.StringifyRPC),
		"tokenize":          handler.New(jsbridge.TokenizeBatchRPC),
		"tokenize.open":     handler.New(jsbridge.TokenizeOpenRPC),
		"tokenize.next":     handler.New(jsbridge.TokenizeNextRPC),
		"tokenize.back":     handler.New(jsbridge.TokenizeBackRPC),
		"tokenize.position": handler.New(jsbridge.TokenizePositionRPC),
		"tokenize.eof":      handler.New(jsbridge.TokenizeEOFRPC),
		"tokenize.close":    handler.New(jsbridge.TokenizeCloseRPC),
	}
}

type singleRequest struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type singleError = jsbridge.ErrorDTO
type singleErrorInput = jsbridge.ErrorInputDTO

type singleResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *singleError    `json:"error,omitempty"`
}

func handleSingleRequest(data []byte) ([]byte, error) {
	var request singleRequest
	if err := json.Unmarshal(data, &request); err != nil {
		return nil, err
	}

	result, callErr := dispatchSingle(request.Method, request.Params)

	response := singleResponse{JSONRPC: "2.0", ID: request.ID, Result: result}
	if callErr != nil {
		response.Result = nil
		response.Error = singleErrorFrom(callErr)
	}
	return json.Marshal(response)
}

func dispatchSingle(method string, raw json.RawMessage) (any, error) {
	switch method {
	case "parse":
		return callSingle(raw, jsbridge.ParseRPC)
	case "process":
		return callSingle(raw, jsbridge.ProcessRPC)
	case "noWork":
		return callSingle(raw, jsbridge.NoWorkRPC)
	case "stringify":
		return callSingle(raw, jsbridge.StringifyRPC)
	case "tokenize":
		return callSingle(raw, jsbridge.TokenizeBatchRPC)
	case "tokenize.open":
		return callSingle(raw, jsbridge.TokenizeOpenRPC)
	case "tokenize.next":
		return callSingle(raw, jsbridge.TokenizeNextRPC)
	case "tokenize.back":
		return callSingle(raw, jsbridge.TokenizeBackRPC)
	case "tokenize.position":
		return callSingle(raw, jsbridge.TokenizePositionRPC)
	case "tokenize.eof":
		return callSingle(raw, jsbridge.TokenizeEOFRPC)
	case "tokenize.close":
		return callSingle(raw, jsbridge.TokenizeCloseRPC)
	default:
		return nil, fmt.Errorf("unsupported method %q in single-request mode", method)
	}
}

func callSingle[P any, R any](raw json.RawMessage, fn func(context.Context, P) (R, error)) (any, error) {
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	var params P
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, err
	}
	return fn(context.Background(), params)
}

func singleErrorFrom(err error) *singleError {
	return jsbridge.ErrorDTOFromError(err)
}

func runSingle() error {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()
	for scanner.Scan() {
		response, err := handleSingleRequest(scanner.Bytes())
		if err != nil {
			return err
		}
		if _, err := writer.Write(append(response, '\n')); err != nil {
			return err
		}
		if err := writer.Flush(); err != nil {
			return err
		}
	}
	return scanner.Err()
}
