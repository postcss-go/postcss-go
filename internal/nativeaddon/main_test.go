package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"postcss-go/internal/csserrors"
	"postcss-go/internal/jsbridge"
)

func TestFitPayload(t *testing.T) {
	payload := []byte("hello-world")

	t.Run("short buffer reports needed size without write", func(t *testing.T) {
		out := make([]byte, 4)
		n := fitPayload(out, payload)
		if n != len(payload) {
			t.Fatalf("want %d, got %d", len(payload), n)
		}
		if !bytes.Equal(out, make([]byte, 4)) {
			t.Fatalf("short buffer was mutated: %q", out)
		}
	})

	t.Run("large enough buffer copies payload", func(t *testing.T) {
		out := make([]byte, len(payload)+8)
		n := fitPayload(out, payload)
		if n != len(payload) || !bytes.Equal(out[:len(payload)], payload) {
			t.Fatalf("n=%d out=%q", n, out)
		}
	})
}

func TestMainIsCallable(t *testing.T) {
	// main is intentionally empty for the c-archive entrypoint.
	main()
}

func TestNativeErrorMessageMarksOnlySyntaxErrors(t *testing.T) {
	syntaxError := csserrors.New("Unknown word", 1, 2, "a{?", "input.css", "")
	message := nativeErrorMessage(syntaxError)
	if !strings.HasPrefix(message, cssSyntaxErrorPrefix) {
		t.Fatalf("syntax error missing marker: %q", message)
	}
	payload := strings.TrimPrefix(message, cssSyntaxErrorPrefix)
	var dto jsbridge.ErrorDTO
	if err := json.Unmarshal([]byte(payload), &dto); err != nil {
		t.Fatalf("syntax error payload is not JSON: %v (%q)", err, message)
	}
	if dto.Name != "CssSyntaxError" || dto.Reason != "Unknown word" || dto.Line != 1 || dto.Column != 2 {
		t.Fatalf("unexpected syntax error payload: %#v", dto)
	}
	if dto.Source != "" || (dto.Input != nil && dto.Input.Source != "") {
		t.Fatalf("native syntax error payload must omit source: %#v", dto)
	}
	if strings.Contains(payload, "a{?") {
		t.Fatalf("syntax error leaked source into the N-API slot: %q", message)
	}

	plain := errors.New("source map could not be loaded")
	if got := nativeErrorMessage(plain); got != plain.Error() {
		t.Fatalf("plain error was changed: %q", got)
	}
}

func TestWriteErrorReportsRequiredCapacity(t *testing.T) {
	err := errors.New("source map could not be loaded")
	want := len(err.Error())

	if got := int(writeError(nil, 0, err)); got != want {
		t.Fatalf("want required capacity %d, got %d", want, got)
	}
}
