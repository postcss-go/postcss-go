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
