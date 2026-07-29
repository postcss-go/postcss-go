package main

import (
	"encoding/json"
	"strings"
	"testing"
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
