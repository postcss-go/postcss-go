package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

func TestHandleSingleRequest(t *testing.T) {
	request := `{"jsonrpc":"2.0","id":7,"method":"parse","params":{"css":"a { color: red; }"}}`
	response, err := handleSingleRequest([]byte(request))
	if err != nil {
		t.Fatalf("handle request: %v", err)
	}
	var message struct {
		ID     int `json:"id"`
		Result struct {
			Root struct {
				Type string `json:"type"`
			} `json:"root"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response, &message); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if message.ID != 7 || message.Result.Root.Type != "root" {
		t.Fatalf("unexpected response: %s", strings.TrimSpace(string(response)))
	}
}

func TestHandleSingleRequestAcceptsLargeCSS(t *testing.T) {
	request, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      8,
		"method":  "parse",
		"params":  map[string]string{"css": "a{--value:" + strings.Repeat("x", 70_000) + ";}"},
	})
	if err != nil {
		t.Fatalf("marshal large request: %v", err)
	}
	response, err := handleSingleRequest(request)
	if err != nil {
		t.Fatalf("handle large request: %v", err)
	}
	var message struct {
		Error *singleError `json:"error"`
	}
	if err := json.Unmarshal(response, &message); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if message.Error != nil {
		t.Fatalf("large request failed: %+v", message.Error)
	}
}

func TestHandleSingleRequestMethodsAndErrors(t *testing.T) {
	methods := []struct {
		name   string
		params any
	}{
		{name: "process", params: map[string]any{"css": "a { color: red; }"}},
		{name: "noWork", params: map[string]any{"css": "a { color: red; }"}},
		{name: "stringify", params: map[string]any{
			"ast": map[string]any{"type": "root", "nodes": []any{
				map[string]any{"type": "rule", "selector": "a", "nodes": []any{
					map[string]any{"type": "decl", "prop": "color", "value": "red"},
				}},
			}},
		}},
		{name: "tokenize", params: map[string]any{"css": "a { color: red; }"}},
	}
	for _, method := range methods {
		t.Run(method.name, func(t *testing.T) {
			request, err := json.Marshal(map[string]any{
				"jsonrpc": "2.0",
				"id":      1,
				"method":  method.name,
				"params":  method.params,
			})
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			response, err := handleSingleRequest(request)
			if err != nil {
				t.Fatalf("handle: %v", err)
			}
			var message struct {
				Error  *singleError    `json:"error"`
				Result json.RawMessage `json:"result"`
			}
			if err := json.Unmarshal(response, &message); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if message.Error != nil || len(message.Result) == 0 {
				t.Fatalf("unexpected response: %s", response)
			}
		})
	}

	if _, err := handleSingleRequest([]byte(`{`)); err == nil {
		t.Fatal("expected invalid JSON error")
	}

	badMethod, err := handleSingleRequest([]byte(`{"jsonrpc":"2.0","id":1,"method":"missing","params":{}}`))
	if err != nil {
		t.Fatalf("handle unsupported: %v", err)
	}
	var unsupported struct {
		Error *singleError `json:"error"`
	}
	if err := json.Unmarshal(badMethod, &unsupported); err != nil || unsupported.Error == nil {
		t.Fatalf("expected unsupported method error, got %s", badMethod)
	}

	detail := singleErrorFrom(errors.New("bridge boom"))
	if detail == nil || !strings.Contains(detail.Message, "bridge boom") {
		t.Fatalf("unexpected singleErrorFrom: %#v", detail)
	}
}

func TestNopWriteCloser(t *testing.T) {
	var closer nopWriteCloser
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	os.Stdout = w
	defer func() {
		os.Stdout = old
		_ = r.Close()
	}()

	n, err := closer.Write([]byte("hello"))
	if err != nil || n != 5 {
		t.Fatalf("Write = %d, %v", n, err)
	}
	if err := closer.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	_ = w.Close()
	got, _ := io.ReadAll(r)
	if string(got) != "hello" {
		t.Fatalf("stdout got %q", got)
	}
}

func TestRPCMethodsMap(t *testing.T) {
	methods := rpcMethods()
	for _, name := range []string{"parse", "process", "noWork", "stringify", "tokenize"} {
		if _, ok := methods[name]; !ok {
			t.Fatalf("missing rpc method %q", name)
		}
	}
}

func TestRunSingleProcessesRequests(t *testing.T) {
	inR, inW, err := os.Pipe()
	if err != nil {
		t.Fatalf("stdin pipe: %v", err)
	}
	outR, outW, err := os.Pipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}

	oldIn, oldOut := os.Stdin, os.Stdout
	os.Stdin, os.Stdout = inR, outW
	defer func() {
		os.Stdin, os.Stdout = oldIn, oldOut
		_ = inR.Close()
		_ = outR.Close()
	}()

	done := make(chan error, 1)
	go func() { done <- runSingle() }()

	request := `{"jsonrpc":"2.0","id":9,"method":"parse","params":{"css":"a{}"}}` + "\n"
	if _, err := inW.Write([]byte(request)); err != nil {
		t.Fatalf("write request: %v", err)
	}
	_ = inW.Close()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("runSingle: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("runSingle timed out")
	}
	_ = outW.Close()
	output, err := io.ReadAll(outR)
	if err != nil {
		t.Fatalf("read stdout: %v", err)
	}
	if !bytes.Contains(output, []byte(`"id":9`)) || !bytes.Contains(output, []byte(`"type":"root"`)) {
		t.Fatalf("unexpected runSingle output: %s", output)
	}
}

func TestMainSingleModeExitsCleanly(t *testing.T) {
	inR, inW, err := os.Pipe()
	if err != nil {
		t.Fatalf("stdin pipe: %v", err)
	}
	outR, outW, err := os.Pipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}
	errR, errW, err := os.Pipe()
	if err != nil {
		t.Fatalf("stderr pipe: %v", err)
	}

	oldArgs, oldIn, oldOut, oldErr := os.Args, os.Stdin, os.Stdout, os.Stderr
	os.Args = []string{"bridge", "--single"}
	os.Stdin, os.Stdout, os.Stderr = inR, outW, errW
	defer func() {
		os.Args, os.Stdin, os.Stdout, os.Stderr = oldArgs, oldIn, oldOut, oldErr
		_ = inR.Close()
		_ = outR.Close()
		_ = errR.Close()
	}()

	_ = inW.Close()
	main()
	_ = outW.Close()
	_ = errW.Close()
}

func TestRunRPCServerAndMain(t *testing.T) {
	inR, inW, err := os.Pipe()
	if err != nil {
		t.Fatalf("stdin pipe: %v", err)
	}
	outR, outW, err := os.Pipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}

	oldIn, oldOut := os.Stdin, os.Stdout
	os.Stdin, os.Stdout = inR, outW
	defer func() {
		os.Stdin, os.Stdout = oldIn, oldOut
		_ = inR.Close()
		_ = outR.Close()
	}()

	done := make(chan error, 1)
	go func() { done <- run() }()
	_ = inW.Close()

	select {
	case err := <-done:
		if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, os.ErrClosed) &&
			!strings.Contains(err.Error(), "closed") && !strings.Contains(err.Error(), "EOF") {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run timed out")
	}
	_ = outW.Close()
}

func TestRunSinglePropagatesHandleErrors(t *testing.T) {
	inR, inW, err := os.Pipe()
	if err != nil {
		t.Fatalf("stdin pipe: %v", err)
	}
	outR, outW, err := os.Pipe()
	if err != nil {
		t.Fatalf("stdout pipe: %v", err)
	}

	oldIn, oldOut := os.Stdin, os.Stdout
	os.Stdin, os.Stdout = inR, outW
	defer func() {
		os.Stdin, os.Stdout = oldIn, oldOut
		_ = inR.Close()
		_ = outR.Close()
	}()

	done := make(chan error, 1)
	go func() { done <- runSingle() }()

	if _, err := inW.Write([]byte("{\n")); err != nil {
		t.Fatalf("write bad request: %v", err)
	}
	_ = inW.Close()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected runSingle to fail on invalid JSON")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("runSingle timed out")
	}
	_ = outW.Close()
}
