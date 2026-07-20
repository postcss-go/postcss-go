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
	"postcss-go/internal/jsbridge"
	postcss "postcss-go/internal/postcss"
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
	srv := jrpc2.NewServer(jsbridge.Assigner(), nil).Start(channel.Line(os.Stdin, nopWriteCloser{}))
	return srv.Wait()
}

type singleRequest struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type singleError struct {
	Code      int    `json:"code"`
	Message   string `json:"message"`
	Name      string `json:"name,omitempty"`
	Reason    string `json:"reason,omitempty"`
	Line      int    `json:"line,omitempty"`
	Column    int    `json:"column,omitempty"`
	EndLine   int    `json:"endLine,omitempty"`
	EndColumn int    `json:"endColumn,omitempty"`
	Source    string `json:"source,omitempty"`
	File      string `json:"file,omitempty"`
	Plugin    string `json:"plugin,omitempty"`
}

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

	var result any
	var callErr error
	switch request.Method {
	case "parse":
		var params jsbridge.ParseParams
		callErr = json.Unmarshal(request.Params, &params)
		if callErr == nil {
			result, callErr = jsbridge.ParseRPC(context.Background(), params)
		}
	case "process":
		var params jsbridge.ProcessParams
		callErr = json.Unmarshal(request.Params, &params)
		if callErr == nil {
			result, callErr = jsbridge.ProcessRPC(context.Background(), params)
		}
	case "stringify":
		var params jsbridge.StringifyParams
		callErr = json.Unmarshal(request.Params, &params)
		if callErr == nil {
			result, callErr = jsbridge.StringifyRPC(context.Background(), params)
		}
	default:
		callErr = fmt.Errorf("unsupported method %q in single-request mode", request.Method)
	}

	response := singleResponse{JSONRPC: "2.0", ID: request.ID, Result: result}
	if callErr != nil {
		response.Result = nil
		response.Error = singleErrorFrom(callErr)
	}
	return json.Marshal(response)
}

func singleErrorFrom(err error) *singleError {
	response := &singleError{Code: -32000, Message: err.Error()}
	var syntaxErr *postcss.CssSyntaxError
	if errors.As(err, &syntaxErr) {
		response.Name = "CssSyntaxError"
		response.Reason = syntaxErr.Reason
		response.Line = syntaxErr.Line
		response.Column = syntaxErr.Column
		response.EndLine = syntaxErr.EndLine
		response.EndColumn = syntaxErr.EndColumn
		response.Source = syntaxErr.Source
		response.File = syntaxErr.File
		response.Plugin = syntaxErr.Plugin
	}
	return response
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
