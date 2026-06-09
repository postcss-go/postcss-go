package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"postcss-go/internal/jsbridge"
)

func main() {
	if err := run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run() error {
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		return fmt.Errorf("read stdin: %w", err)
	}

	var req jsbridge.Request
	if err := json.Unmarshal(input, &req); err != nil {
		return writeResponse(jsbridge.Response{
			OK:    false,
			Error: &jsbridge.ErrorDTO{Message: fmt.Sprintf("decode request: %v", err)},
		})
	}

	return writeResponse(jsbridge.Execute(req))
}

func writeResponse(resp jsbridge.Response) error {
	data, err := jsbridge.ToJSON(resp)
	if err != nil {
		return fmt.Errorf("encode response: %w", err)
	}
	if _, err := os.Stdout.Write(data); err != nil {
		return fmt.Errorf("write stdout: %w", err)
	}
	return nil
}
